// Sleep read from whatever devices a client has connected, for any screen.
//
// ── Why this is shared rather than loaded per screen ───────────────────────
//
// Recovery loaded it inline and was the only screen that did. Home computed
// readiness from the hand-typed wellness log alone, so a client with WHOOP
// connected, the sleep scope granted and a week of nights on record opened the
// app to "Log a night of sleep to see your readiness" while Recovery, one tap
// away, showed those nights. Reported as "whoop is connected and sleep is also
// there. its not updating the repple app."
//
// The fix is not another copy of the loader. Two screens deriving "last night"
// separately is how they come to disagree, which is the bug this codebase keeps
// finding in other shapes — so there is one loader and both read it.
//
// ── The two things this keeps that the inline version had ──────────────────
//
// Both were bugs before they were fixed, and both are easy to lose in an
// extraction:
//
//  · The effect is keyed on WHICH providers are connected, not on the states
//    object. That object is replaced on every 60-second sync, and keying on it
//    re-read the whole week each time.
//  · `linkRev` is the other half of that key. Reconnecting a device that was
//    ALREADY in the list does not change the list, so without it the effect
//    never re-ran and a stale "needs reconnecting" outlived the reconnect that
//    fixed it — reported verbatim as "Reconnected whoop and it says need to
//    connect whoop."
//
// ── And what it now keeps ──────────────────────────────────────────────────
//
// The nights are stored (supabase/parts/153) and read back on launch. Before
// that, a device-measured night existed only in the state below: a gym with no
// reception, an expired WHOOP token or simply signing in on a second handset
// took the whole week away, and readiness — which correctly refuses to score a
// night nobody recorded — went from 83 to a dash with nothing on screen to
// explain it. See src/lib/deviceSleepStore.ts for what a stored night is
// allowed to be, and for why a fresh reading always wins over a kept one.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { readSleepFromDevices, connectedProviders } from '../lib/wearables/sleep';
import { mergeSleepNights, recentNights, type MergedNight, type SleepRead } from '../lib/sleepMerge';
import { rowToStored, storableNights, storedToRow, withStored, type StoredNight } from '../lib/deviceSleepStore';
import { useWearables } from './wearables';
import { useLinkRevision } from '../lib/wearableLinkLedger';
import { reportError } from '../lib/reportError';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { useAuthRevision } from './authRevision';
import { worstStatus, type LoadStatus } from './loadStatus';
import { useRecoverRead } from './readRefresh';
import { useToday } from './today';
import { localDate } from '../lib/localDate';

/** How far back to read. A week is enough for a readiness average and short
 *  enough that a provider outage does not dominate it. */
export const DEVICE_SLEEP_NIGHTS = 7;

interface DeviceSleepValue {
  /** Per provider, including the ones that could not answer — a screen that
   *  wants to say WHY a night is missing needs the failures, not just the wins. */
  reads: SleepRead[];
  /** One entry per night in the window, newest first. `outcome` says whether
   *  anybody measured it; nothing here is ever inferred. */
  nights: MergedNight[];
  status: LoadStatus;
  /** Re-read now — after a reconnect, or a pull-to-refresh. */
  refresh: () => void;
}

const Ctx = createContext<DeviceSleepValue | null>(null);

export function DeviceSleepProvider({ children }: { children: ReactNode }) {
  const wear = useWearables();
  const linkRev = useLinkRevision();
  const authRev = useAuthRevision();
  const [reads, setReads] = useState<SleepRead[]>([]);
  // ── Two reads, two statuses ──────────────────────────────────────────────
  //
  // The device walk and the read of the kept nights are separate requests that
  // fail separately, and for a while only the walk's outcome was published.
  // A member signing in on a second handset holds nothing in memory, so when
  // WHOOP answered with last night alone and the stored-nights read was
  // refused, readiness was scored over ONE night under 'ready' — and
  // `deviceSleepTrust` in src/lib/readinessBreakdown.ts, which is handed this
  // status, told them the devices had read fine. The refused half was
  // invisible, and because `needsRefetch` only fires on 'error' nothing ever
  // went back for it.
  //
  // They are NOT one `setStatus` shared between the two effects. The effects
  // race — the walk is keyed on the connected devices, the stored read on the
  // auth revision — so a bare `setStatus('error')` from the stored read is
  // overwritten by the walk's 'ready' whenever the walk lands second, which is
  // the ordinary case. Each half records its own outcome and the published
  // status is the worse of them, which cannot be lost to ordering.
  const [walkStatus, setWalkStatus] = useState<LoadStatus>('loading');
  const [storedStatus, setStoredStatus] = useState<LoadStatus>('loading');
  const status = worstStatus(walkStatus, storedStatus);
  // The nights already kept for this account. Deliberately separate state from
  // `reads`: they answer different questions — what the devices say NOW, and
  // what they said before — and folding them together is how a stored night
  // would end up looking like a fresh measurement to the merge.
  const [stored, setStored] = useState<StoredNight[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  // What has already been sent, so a re-render does not re-send it. Keyed by
  // night and figure together, because a REVISED night must go up again — see
  // deviceSleepStore's note on WHOOP re-scoring a night after the fact.
  const sentRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    setWalkStatus('loading');
    try {
      const next = await readSleepFromDevices(wear.states, DEVICE_SLEEP_NIGHTS);
      setReads(next);
      setWalkStatus('ready');
    } catch (e) {
      // readSleepFromDevices catches per provider, so reaching here means the
      // walk itself broke. Still not an empty night: still unknown.
      reportError('deviceSleep.read', e);
      setReads([]);
      setWalkStatus('error');
    }
  }, [wear.states]);

  const connectedKey = connectedProviders(wear.states).map((p: { meta: { id: string } }) => p.meta.id).join(',');
  useEffect(() => { void load(); }, [connectedKey, linkRev]);

  // ── The nights already kept, before the devices are asked ────────────────
  //
  // Read first and read separately, so the week is on screen while the
  // providers are still being walked — and so it is still on screen when one of
  // them cannot be reached at all. This is the order src/ui/availability.ts
  // settled on and src/ui/wellness.tsx follows: the stored copy goes up, the
  // live read refreshes it, and `status` says which is being looked at.
  // Split out of the effect rather than left inside it, so `refresh` and the
  // recovery below can actually run it again. While it was inline the only
  // thing either of them re-ran was the device walk, and a stored read refused
  // once stayed refused for the life of the process — this provider is mounted
  // in app/_layout.tsx and never unmounts, so nothing else was ever going to
  // ask a second time.
  //
  // Superseded by generation rather than by a captured `cancelled` flag,
  // because there are now two callers and the later one has to win: a
  // pull-to-refresh landing while the launch read is still in flight must not
  // have the older answer write over it.
  const storedRun = useRef(0);
  const loadStored = useCallback(async () => {
    const run = ++storedRun.current;
    const live = () => storedRun.current === run;
    setStoredStatus('loading');
    let id: string | null = null;
    try {
      // getSession() reads local storage rather than the network, and REJECTS
      // for nobody signed in — which is a true answer, not a failed read.
      const { data: sess } = await supabase.auth.getSession();
      id = sess?.session?.user?.id ?? null;
    } catch { /* no local session; treated as signed out below */ }
    if (!live()) return;
    // Signed out, or a build with no backend: there is no kept week to read and
    // no absent server to misreport. 'ready' with nothing in it, which is the
    // same answer src/ui/deviceHrv.ts gives to the same question.
    if (!id || !USE_SUPABASE) { setUid(null); setStored([]); setStoredStatus('ready'); return; }
    setUid(id);
    const { data, error } = await supabase.from('device_sleep_nights')
      .select('night, minutes_asleep, provider, source_id, source_name, family, basis')
      .eq('user_id', id)
      .gte('night', recentNights(DEVICE_SLEEP_NIGHTS).slice(-1)[0] ?? '')
      .order('night', { ascending: false });
    if (!live()) return;
    // A failed read leaves `stored` as it was and adds nothing. It must NOT
    // clear what is already held: an empty list here would take the week off
    // the screen, which is the exact disappearance this table exists to stop.
    // What it does now is SAY so, which is the half that was missing — holding
    // the old rows silently under 'ready' is how one night got scored as a week.
    if (error) { reportError('deviceSleep.stored', error); setStoredStatus('error'); return; }
    const rows = (data ?? []).map(rowToStored).filter((n): n is StoredNight => n != null);
    setStored(rows);
    setStoredStatus('ready');
  }, []);

  useEffect(() => {
    // Cleared here and not inside `loadStored`, because a refresh is not a new
    // account: resetting it on every pull-to-refresh would re-send the whole
    // week to the server each time somebody dragged the screen down.
    sentRef.current = new Set();
    void loadStored();
    return () => { storedRun.current += 1; };
  }, [authRev, loadStored]);

  // What the devices said today, before anything kept is folded in. Kept
  // separate because only these may be written back — see below.
  /**
   * The run of nights this week covers.
   *
   * `useToday()` and not a bare `recentNights(DEVICE_SLEEP_NIGHTS)`, and it is
   * IN the dependency list. The clock read was inside a memo keyed `[reads]`,
   * and `reads` moves when a DEVICE answers, not when the day does — so the
   * seven night keys were the seven ending on the day this provider first
   * mounted. This provider is in app/_layout.tsx and wraps the whole app, so it
   * is never unmounted at all: a member who left the app open overnight had
   * last night missing from their sleep week entirely, and the week kept
   * sliding further behind every day the phone stayed in a pocket.
   *
   * `useToday` and not `useNow`, deliberately. `useNow` subscribes with
   * `useFocusEffect`, which needs a navigation context, and this provider sits
   * ABOVE the navigator in app/_layout.tsx — it would throw on mount. `useToday`
   * uses only AppState and a midnight timer, and a run of night keys is a
   * calendar question anyway. `localDate` turns the bare day back into LOCAL
   * midnight; `new Date('2026-09-04')` is UTC midnight, which is the day before
   * for every member west of Greenwich (src/lib/localDate.ts).
   */
  const today = useToday();

  const fresh = useMemo(
    () => mergeSleepNights(reads, recentNights(DEVICE_SLEEP_NIGHTS, localDate(today) ?? new Date())),
    [reads, today],
  );

  const nights = useMemo(() => withStored(fresh, stored), [fresh, stored]);

  // ── Keeping what was measured ────────────────────────────────────────────
  //
  // Only after a read that actually succeeded, and only the nights a named
  // device measured. A night nobody recorded, and a night we failed to read,
  // are two different absences; neither becomes a row.
  //
  // Gated on the WALK, not on the published status. What may be written back is
  // decided by whether the devices answered; a refused read of the kept nights
  // says nothing about tonight's measurement, and letting it hold up the write
  // would mean the one failure the table exists to survive also stopped the
  // table being filled.
  useEffect(() => {
    if (!USE_SUPABASE || !uid || walkStatus !== 'ready') return;
    const keep = storableNights(fresh).filter((n) => !sentRef.current.has(`${n.night}:${n.minutesAsleep}`));
    if (!keep.length) return;
    let cancelled = false;
    (async () => {
      const { error } = await supabase.from('device_sleep_nights')
        .upsert(keep.map((n) => storedToRow(uid, n)), { onConflict: 'user_id,night' });
      if (error) {
        // Not fatal and not silent. The week is correct on screen either way;
        // what is lost is only its durability, and the next launch that reaches
        // the server tries again because `sentRef` was never marked.
        reportError('deviceSleep.keep', error);
        return;
      }
      if (cancelled) return;
      for (const n of keep) sentRef.current.add(`${n.night}:${n.minutesAsleep}`);
      // Hold the same rows locally rather than re-reading them. A second read
      // would be a second answer to a question we have just answered, and the
      // two can disagree for a moment while PostgREST catches up.
      setStored((prev) => {
        const byNight = new Map(prev.map((n) => [n.night, n]));
        for (const n of keep) byNight.set(n.night, n);
        return [...byNight.values()];
      });
    })();
    return () => { cancelled = true; };
  }, [uid, walkStatus, fresh]);

  // ── When the signal comes back, this read is run again ───────────────────
  //
  // This provider was one of the ones `src/lib/readRefresh.ts` had not reached,
  // and it is a worse omission here than most because of what sits downstream:
  // `src/ui/readiness.ts` feeds the client's home screen, and it correctly
  // refuses to score a night nobody measured. So one failed walk over the
  // devices — a phone with no signal on the way in, a WHOOP call that did not
  // come back — turns readiness into a dash, and NOTHING re-runs it. `refresh`
  // existed and had exactly one caller: the pull-to-refresh on
  // app/(client)/recovery.tsx. Home has no such gesture, so a member looking at
  // the dash on the screen they actually open had no way to clear it short of
  // killing the app.
  //
  // The file's own header records this being reported in almost those words —
  // "whoop is connected and sleep is also there. its not updating the repple
  // app" — and again as "Reconnected whoop and it says need to connect whoop."
  // Both were fixed by making the effect re-run on a change nobody had to
  // notice. This is the third of those changes: coming back into signal.
  // Both halves, not just the walk. `refreshStale` only calls this while the
  // status is 'error', and a stored read that was refused is now one of the two
  // things that can put it there — so re-running the device walk alone would
  // arrive at a provider that is still in 'error' about the half nobody asked
  // again, and burn an attempt doing it.
  const refresh = useCallback(() => { void load(); void loadStored(); }, [load, loadStored]);

  useRecoverRead('deviceSleep', status, refresh);

  /**
   * Memoised, because an object literal here republished the context on every
   * render of this provider — and `wear.states` is replaced on every
   * sixty-second wearable sync, so that is not a rare event. Every consumer of
   * `useDeviceSleep` re-rendered on each of them whether or not a night had
   * changed. `refresh` is already a `useCallback` over two more of them, so it
   * is stable for as long as the connected devices are.
   */
  const value = useMemo(
    () => ({ reads, nights, status, refresh }),
    [reads, nights, status, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDeviceSleep(): DeviceSleepValue {
  const v = useContext(Ctx);
  // Deliberately not a silent empty default. A screen that reads this outside
  // the provider would render "no sleep recorded" — a statement about the
  // client — rather than failing where the mistake is.
  if (!v) throw new Error('useDeviceSleep must be used inside <DeviceSleepProvider>');
  return v;
}
