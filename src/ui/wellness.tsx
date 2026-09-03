// Wellness — the sleep log. (Hydration moved to useHabits; see below.)
//
// It starts EMPTY. This provider used to ship two invented sleep nights (7.5h
// and 6.5h, timestamped off Date.now() so they always read as "last night" and
// "the night before"). Recovery rendered them as the client's own history, and
// worse, dashboard.tsx fed the sleep average into readinessScore() — so the
// biggest number on the home screen was computed from two literals.
//
// ── The gap this file used to admit to, and no longer has ──────────────────
//
// The header here read: "Nothing here persists yet: a cup logged now is gone on
// relaunch. That is a gap, but an empty log the user fills is honest, where a
// pre-filled one is not." Both halves were true, and the second half made the
// first one liveable-with for a while. It stopped being liveable-with the
// moment readiness started reading this log, because the consequence is not
// "the Recovery list is short". It is this:
//
//   A client logs seven and a half hours on Monday morning. The home screen
//   computes a readiness score from it and shows them a number. They close the
//   app. They open it at lunchtime and it says "Log a night of sleep to see
//   your readiness" — about the night they just logged, which the app had a
//   figure for an hour ago. Nothing is broken and nothing says anything is
//   wrong; the state simply was not anywhere.
//
// And for a client with no watch or ring, this typed log is the ONLY sleep
// readiness has. src/lib/readiness.ts spends a paragraph explaining that it
// will not fill a missing night with a guess and will shorten its window
// instead — which is right, and which means an evaporating log does not degrade
// the score, it deletes it.
//
// So the nights go to `sleep_logs` now (supabase/parts/109), owner-scoped by
// auth.uid() and readable by nobody else, including the coach. That last part
// is deliberate and the migration argues it at length: device-measured sleep is
// already behind a per-client sharing switch (src/lib/wearables/sleepAccess.ts),
// and granting a blanket read of the TYPED nights would route around that
// switch for the one source a client without a wearable has.
//
// ── It still works with no signal, and now it says so ──────────────────────
//
// The app is used in gyms with no reception and that has to keep being true, so
// this follows the shape src/ui/availability.ts settled on: the device's saved
// copy goes on screen first, the server refreshes it, and `status` says which
// of the two is being looked at. 'ready' means the server confirmed these
// nights. 'error' means these came off this device and could not be checked —
// and, per src/ui/loadStatus.ts, an EMPTY list under 'error' means "we do not
// know what you have logged", never "you have logged nothing".
//
// A night logged offline keeps its place in the list under a `local:` id and is
// pushed up on the next launch that reaches the server. See
// src/lib/wellnessSync.ts for the merge, and for why a failed read (null) must
// not be treated as an empty answer ([]).
import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { capLimit, capped } from '../lib/rowCap';
import { adoptServerId, isPending, localId, mergeLog } from '../lib/wellnessSync';
import { classifyWrite } from '../lib/offlineQueue';
import { reportError } from '../lib/reportError';
import type { LoadStatus } from './loadStatus';
import { useAuthRevision } from './authRevision';
import { isFilableNight } from '../lib/sleepEntry';

export interface SleepEntry { id: string; at: string; hours: number; quality: number }

/* ── the bounds, and why they are here as well as in the column ────────────
 *
 * `sleep_logs.hours` is `check (hours > 0 and hours <= 24)` and `quality` is
 * `check (quality between 1 and 5)`, and part 109 says why: they are the range
 * in which the number can be a number of hours at all, not a judgement about
 * how much anybody should sleep.
 *
 * The column was doing the whole job on its own and that was the defect. A
 * fat-fingered 75 was filed OPTIMISTICALLY here first — that is what makes a
 * night logged in a basement survive — then refused by the CHECK with a 23514.
 * Nothing read the refusal. The entry kept its `local:` id, stayed in the list,
 * stayed in this device's cache, stayed counted in `unsent`, and was re-offered
 * to the server on every launch for the life of the install. Meanwhile 75 hours
 * sat in the client's sleep average and in readiness, which is the biggest
 * number on the home screen, and there was no second mutator anywhere in this
 * provider to take it out again.
 *
 * So the bound is checked before anything is filed. The screen's own gate is
 * still the first line — Recovery disables the button below 1 hour and with no
 * quality mark — and this is the second, exactly like the `if (!hours)` that
 * has always been below it.
 */
// The rule and the sentence both live in src/lib/sleepEntry.ts, where they run
// under `npm test`. Re-exported here because this is where every caller already
// looks for them, and because a refusal the screen cannot word is a refusal the
// member experiences as silence.
export { MAX_SLEEP_HOURS, MAX_QUALITY, isFilableNight, sleepRefusal } from '../lib/sleepEntry';

/**
 * What happened to a night.
 *
 * Three outcomes rather than a boolean, and they are three different sentences.
 * `addSleep` used to answer `false` both for a night it REFUSED and for a night
 * it had filed on the phone with no server to send it to — which are opposite
 * facts about the member's own record, and the screen could not tell them
 * apart. Same shape as `logWorkouts`, for the same reason.
 */
export type SleepAdd = 'saved' | 'unsent' | 'refused';

/** Per-account, so signing out and back in as somebody else cannot show one
 *  client another client's nights off this device. `availability.ts` caches
 *  under a single key and has that flaw; a sleep log is more personal than a
 *  weekly grid, and the account id is known before the cache is read because
 *  `getSession()` reads local storage rather than the network. */
const cacheKey = (uid: string) => `repple.sleep:${uid}`;

interface WellnessValue {
  // Hydration used to live here as well, as a plain useState(0): not persisted,
  // and entirely separate from the water counter on the home screen, which is
  // stored per day under repple.water:<date> by useHabits. Adding a glass on
  // one screen left the other unchanged, and Recovery's count reset to zero on
  // every app restart. Both were reported. There is one store now — useHabits —
  // and Recovery reads it directly, so the two screens cannot drift again.
  sleep: SleepEntry[];
  /** 'saved' once the night is stored server-side. 'unsent' means the entry is
   *  on this phone and nowhere else — it is still shown, and it goes up on the
   *  next launch that reaches the server. 'refused' means it was NOT filed
   *  anywhere and the member has to be told why; see `sleepRefusal`. */
  addSleep: (hours: number, quality: number) => Promise<SleepAdd>;
  /**
   * Take a night back out.
   *
   * The second mutator this provider did not have. `addSleep` was the whole of
   * it, so every entry ever filed was permanent — a night typed as 12 when the
   * client meant 1.2 went on being a twelve-hour night in their average and in
   * their readiness score for as long as the account existed, and the only
   * remedy the app offered was to log more nights until it stopped mattering.
   *
   * Resolves true when the row is gone from the server (or was never on it,
   * which is the case for an unsent entry — there is nothing to delete and the
   * removal is complete). False means the row is still there and the caller
   * must NOT tell the client it went: it will come back on the next read, which
   * is the failure mode that makes people stop believing a delete button.
   */
  removeSleep: (id: string) => Promise<boolean>;
  /** Whether the nights on screen were confirmed by the server. Under 'error'
   *  an empty list means UNKNOWN and a non-empty one is this device's cached
   *  copy, not a confirmed current one. */
  status: LoadStatus;
  /**
   * Read the sleep log again.
   *
   * A real re-read: it bumps the key the load effect is on, so the same query
   * runs and `status` ends at whatever the server says this time. Nothing
   * queued on this device is dropped — the unsent nights are merged in after
   * the read as they are on any other pass.
   */
  reload: () => void;
  /** How many of `sleep` have not reached the server. Derived from the list
   *  rather than counted alongside it, because a count kept in its own state is
   *  a second answer to the same question and the two drift. */
  unsent: number;
}
const Ctx = createContext<WellnessValue | null>(null);

/** Rows out of `sleep_logs`, defensively. `hours` is numeric in Postgres, which
 *  supabase-js hands back as a string on some paths and a number on others, and
 *  a string reaching `sleep.reduce((a, s) => a + s.hours, 0)` on the Recovery
 *  screen concatenates instead of adding — "07.56.5" rather than 14. */
const rowToEntry = (r: any): SleepEntry => ({
  id: String(r.id),
  at: String(r.at ?? r.created_at ?? new Date().toISOString()),
  hours: Number(r.hours) || 0,
  quality: Number(r.quality) || 0,
});

export function WellnessProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  const [readTick, setReadTick] = useState(0);
  const reload = useCallback(() => setReadTick((n) => n + 1), []);
  const [sleep, setSleepState] = useState<SleepEntry[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  // The list as it stands right now, for the async paths.
  //
  // Every mutation here goes through `setSleep`, which writes the ref and the
  // state together, so `listRef.current` is what an insert that resolves three
  // seconds from now should be merging into. The alternative — a functional
  // updater — is the shape this codebase has twice had to unpick: React
  // double-invokes updaters in development, so a network call or a cache write
  // placed inside one fires twice, and an updater is no place for either. See
  // the notes on toggleHabit and markWaterDone in habits.tsx.
  const listRef = useRef<SleepEntry[]>([]);
  // False once a read has come back truncated. Writing a short log over the
  // good cached one would turn a temporary gap into this device's idea of the
  // client's history — the same reasoning availability.ts gives for not caching
  // a truncated week.
  const cacheable = useRef(true);

  const setSleep = (next: SleepEntry[], owner: string | null) => {
    listRef.current = next;
    setSleepState(next);
    if (owner && cacheable.current) {
      AsyncStorage.setItem(cacheKey(owner), JSON.stringify(next)).catch(() => { /* the nights are correct this session either way */ });
    }
  };

  /** Write one entry and adopt the id the server gave it. Returns false for
   *  every reason the row is not on the server, which the caller reports as
   *  "this phone only" — never as a failure the user has to redo.
   *
   *  A REFUSAL is not one of those reasons any more. `classifyWrite` reads the
   *  evidence supabase-js hands back — a SQLSTATE means Postgres parsed the row
   *  and declined it, no code at all means nobody answered — and a row the
   *  database has declined will be declined every time it is offered. Left in
   *  the list it is a night in the client's average that no server will ever
   *  hold, retried on every launch for the life of the install. So it comes
   *  out. See src/lib/offlineQueue.ts, which was written for exactly this
   *  shape of bug in the food log. */
  const send = async (owner: string, e: SleepEntry): Promise<boolean> => {
    try {
      const { data, error } = await supabase.from('sleep_logs')
        .insert({ user_id: owner, at: e.at, hours: e.hours, quality: e.quality })
        .select('id').single();
      const sid = data?.id;
      // `.single()` sets `error` when no row comes back, so a refused insert
      // cannot arrive here looking like a successful one — but `sid` is checked
      // anyway, because adopting `undefined` as an id would quietly turn a
      // pending entry into one nothing will ever retry.
      if (error || !sid) {
        if (error && classifyWrite(error as any, 0) === 'refused') {
          reportError('wellness.sleepRefused', error, { hours: e.hours, quality: e.quality });
          setSleep(listRef.current.filter((x) => x.id !== e.id), owner);
        }
        return false;
      }
      setSleep(adoptServerId(listRef.current, e.id, String(sid)), owner);
      return true;
    } catch { return false; }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // No session is a true answer, not a failed check. getUser() REJECTS when
      // nobody is signed in, and treating that as an error latched sibling
      // providers into 'error' on the first tick — before anybody had signed in
      // — where they stayed, because the effect never ran a second time.
      let id: string | null = null;
      try {
        const { data: sess } = await supabase.auth.getSession();
        id = sess?.session?.user?.id ?? null;
      } catch { /* no local session; treated as signed out below */ }
      if (cancelled) return;

      cacheable.current = true;

      // Signed out, or a build with no backend at all: this device IS the
      // store, so what is on screen is authoritative and there is no absent
      // server to misreport. Nothing is read from the cache either — a cache
      // key needs an account, and there is no account.
      if (!id || !USE_SUPABASE) { setUid(null); setSleep([], null); setStatus('ready'); return; }
      setUid(id);

      // The device's copy, first and fast. This is what a client in a basement
      // gym sees, and it goes up before the network is even attempted.
      let local: SleepEntry[] = [];
      try {
        const raw = await AsyncStorage.getItem(cacheKey(id));
        if (raw) local = (JSON.parse(raw) as any[]).map(rowToEntry);
      } catch { /* no usable cache; the server read below is the only source */ }
      if (cancelled) return;
      if (local.length) setSleep(mergeLog<SleepEntry>(null, local).entries, null);

      try {
        const { data, error } = await supabase.from('sleep_logs')
          .select('id, at, hours, quality')
          .eq('user_id', id)
          .order('at', { ascending: false })
          .limit(capLimit());
        if (cancelled) return;
        // This early return IS the point. The cached nights stay on screen and
        // `status` records that they were not checked, rather than the screen
        // presenting a stale copy as a confirmed one.
        if (error) { setStatus('error'); return; }
        const page = capped(data);
        if (page.truncated) cacheable.current = false;
        const m = mergeLog<SleepEntry>(page.rows.map(rowToEntry), local);
        setSleep(m.entries, id);
        setStatus(page.truncated ? 'partial' : 'ready');

        // Anything logged while offline goes up now. A failure here is neither
        // fatal nor silent: the entry keeps its local id, stays in the list,
        // stays counted in `unsent`, and is tried again on the next launch.
        // Unless the server REFUSED it, in which case `send` takes it out —
        // that entry is not waiting for signal, it is waiting for nothing.
        for (const e of m.pending) {
          if (cancelled) return;
          await send(id, e);
        }
      } catch { if (!cancelled) setStatus('error'); /* offline: the cached copy stands, and now says so */ }
    })();
    return () => { cancelled = true; };
  }, [authRev, readTick]);

  const addSleep = async (hours: number, quality: number): Promise<SleepAdd> => {
    // Unchanged from the in-memory version, and load-bearing: tapping "Log
    // Sleep" without touching either control used to file a night the client
    // never had, which then became their sleep average and fed readiness. The
    // screen disables the button for the same reason; this is the second line.
    //
    // The bound is checked with it now, and BEFORE anything is filed locally.
    // See `isFilableNight`: the optimistic write is what makes a night logged
    // with no signal survive, and it is also what made a 75 permanent — the
    // column refused it, nothing read the refusal, and 75 hours stayed in the
    // average and in readiness for ever. A night that cannot be stored is not
    // filed at all rather than filed and quietly disowned.
    // 'refused' and not `false`: nothing has been filed, here or anywhere, and
    // the screen owes the member a sentence saying so.
    if (!hours) return 'refused';
    if (!isFilableNight(hours, quality)) return 'refused';
    const e: SleepEntry = { id: localId(), at: new Date().toISOString(), hours, quality };
    // Optimistic, and cached immediately — a night logged in a lift has to
    // survive the app being killed before the network ever comes back.
    setSleep(mergeLog<SleepEntry>(null, [e, ...listRef.current]).entries, uid);
    // Filed on the phone, with no server to send it to. That is 'unsent', which
    // is a night the member HAS logged — not a refusal.
    if (!USE_SUPABASE || !uid) return 'unsent';
    return (await send(uid, e)) ? 'saved' : 'unsent';
  };

  /**
   * Take one night back out.
   *
   * Optimistic like everything else here, and then honest about what happened:
   * a delete the server refuses puts the entry back, because a row that is
   * still in `sleep_logs` will be read again on the next launch and a client
   * who watched it disappear and then return has been told two different things
   * about their own record.
   *
   * An entry that never reached the server has no row to delete. Removing it
   * from the list IS the whole of the deletion, and that is reported as a
   * success rather than as "nothing was deleted" — which would be true of the
   * server and false of what the client asked for.
   *
   * `.eq('user_id', uid)` alongside the id, for the reason clientData's
   * updateScan gives about the same clause: RLS already scopes this to the
   * signed-in account, so it changes nothing about what is permitted — it is
   * there so a bug handing this an id from another account matches nothing
   * rather than relying on the policy as the only thing in the way.
   */
  const removeSleep = async (id: string): Promise<boolean> => {
    const before = listRef.current;
    const target = before.find((e) => e.id === id);
    if (!target) return true;                 // already gone; nothing to undo
    setSleep(before.filter((e) => e.id !== id), uid);
    if (isPending(target.id) || !USE_SUPABASE || !uid) return true;
    try {
      // `.select('id')` so the count is readable. A delete that matches no rows
      // is a 204 with `error: null` over PostgREST — see src/lib/wroteRows.ts —
      // so "no error" is not evidence that anything was deleted.
      const { data, error } = await supabase.from('sleep_logs')
        .delete().eq('id', target.id).eq('user_id', uid).select('id');
      if (error) {
        reportError('wellness.removeSleep', error);
        setSleep(before, uid);
        return false;
      }
      // Zero rows means the row is not this account's, or is already gone. The
      // second is success and the first must not be reported as one, and they
      // are indistinguishable from here — so the entry goes back and the caller
      // is told the delete did not land. A night that really had gone comes
      // back off the next read as absent anyway.
      if (!data || data.length === 0) { setSleep(before, uid); return false; }
      return true;
    } catch (e) {
      reportError('wellness.removeSleep', e);
      setSleep(before, uid);
      return false;
    }
  };

  const unsent = useMemo(() => sleep.filter((e) => isPending(e.id)).length, [sleep]);

  return <Ctx.Provider value={{ sleep, addSleep, removeSleep, status, unsent, reload }}>{children}</Ctx.Provider>;
}
export function useWellness(): WellnessValue { const v = useContext(Ctx); if (!v) throw new Error('useWellness must be used inside <WellnessProvider>'); return v; }
