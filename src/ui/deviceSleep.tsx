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
import type { LoadStatus } from './loadStatus';

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
  const [status, setStatus] = useState<LoadStatus>('loading');
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
    setStatus('loading');
    try {
      const next = await readSleepFromDevices(wear.states, DEVICE_SLEEP_NIGHTS);
      setReads(next);
      setStatus('ready');
    } catch (e) {
      // readSleepFromDevices catches per provider, so reaching here means the
      // walk itself broke. Still not an empty night: still unknown.
      reportError('deviceSleep.read', e);
      setReads([]);
      setStatus('error');
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
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let id: string | null = null;
      try {
        // getSession() reads local storage rather than the network, and REJECTS
        // for nobody signed in — which is a true answer, not a failed read.
        const { data: sess } = await supabase.auth.getSession();
        id = sess?.session?.user?.id ?? null;
      } catch { /* no local session; treated as signed out below */ }
      if (cancelled) return;
      sentRef.current = new Set();
      if (!id || !USE_SUPABASE) { setUid(null); setStored([]); return; }
      setUid(id);
      const { data, error } = await supabase.from('device_sleep_nights')
        .select('night, minutes_asleep, provider, source_id, source_name, family, basis')
        .eq('user_id', id)
        .gte('night', recentNights(DEVICE_SLEEP_NIGHTS).slice(-1)[0] ?? '')
        .order('night', { ascending: false });
      if (cancelled) return;
      // A failed read leaves `stored` as it was and adds nothing. It must NOT
      // clear what is already held: an empty list here would take the week off
      // the screen, which is the exact disappearance this table exists to stop.
      if (error) { reportError('deviceSleep.stored', error); return; }
      const rows = (data ?? []).map(rowToStored).filter((n): n is StoredNight => n != null);
      setStored(rows);
    })();
    return () => { cancelled = true; };
  }, [authRev]);

  // What the devices said today, before anything kept is folded in. Kept
  // separate because only these may be written back — see below.
  const fresh = useMemo(
    () => mergeSleepNights(reads, recentNights(DEVICE_SLEEP_NIGHTS)),
    [reads],
  );

  const nights = useMemo(() => withStored(fresh, stored), [fresh, stored]);

  // ── Keeping what was measured ────────────────────────────────────────────
  //
  // Only after a read that actually succeeded, and only the nights a named
  // device measured. A night nobody recorded, and a night we failed to read,
  // are two different absences; neither becomes a row.
  useEffect(() => {
    if (!USE_SUPABASE || !uid || status !== 'ready') return;
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
  }, [uid, status, fresh]);

  return (
    <Ctx.Provider value={{ reads, nights, status, refresh: load }}>{children}</Ctx.Provider>
  );
}

export function useDeviceSleep(): DeviceSleepValue {
  const v = useContext(Ctx);
  // Deliberately not a silent empty default. A screen that reads this outside
  // the provider would render "no sleep recorded" — a statement about the
  // client — rather than failing where the mistake is.
  if (!v) throw new Error('useDeviceSleep must be used inside <DeviceSleepProvider>');
  return v;
}
