// Shared, reactive workout log. Persists to Supabase per signed-in user
// (hydrate on mount + optimistic insert on log). Starts empty: a new account has
// no workout history until the user logs one. Never seeds sample data.
//
// ── Why this hook now reports a status, and why the writes return a boolean ──
//
// `log: []` used to be the answer to two completely different questions. One is
// "you have not logged anything yet", which is true of every new account. The
// other is "the read came back with an error and we swallowed it" — a refused
// RLS policy, a dropped connection on a gym's wifi, an auth session that had not
// finished restoring. The hydrate below returned early in both cases and the
// state stayed at its initial `[]`, so Train, the streak counter, the challenge
// leaderboard and the coach's adherence figures all reported an empty history as
// the user's actual history. A client who had trained every day for a month
// could be shown a zero streak and told to start one.
//
// The same hole existed on the way out. The insert's result was never inspected
// for `error` — supabase-js resolves with `{ data, error }` rather than throwing,
// so a rejected write looked exactly like a successful one that returned no
// rows. The entry stayed in local state, the screen said it was logged, and it
// existed on that phone and nowhere else until the next launch cleared it.
import { createContext, useContext, useEffect, useState } from 'react';
import type { WorkoutEntry } from '../lib/mockData';
import { rowToEntry, entryToRow } from '../lib/workoutRow';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import type { LoadStatus } from './loadStatus';
import { capLimit, capped } from '../lib/rowCap';
import { useAuthRevision } from './authRevision';

interface WorkoutLogValue {
  log: WorkoutEntry[];
  /** Whether `log` is what the server holds. Under 'error' an empty `log` means
   *  the history could not be read, NOT that there is no history. */
  status: LoadStatus;
  /** Resolves true only once the row is on the server. False means the entry
   *  lives on this device only and will not survive a relaunch — the caller
   *  must not tell the user it is saved. */
  addWorkout: (entry: WorkoutEntry) => Promise<boolean>;
  addWorkouts: (entries: WorkoutEntry[]) => Promise<boolean>;
  /**
   * Send entries that are ALREADY in `log` to the server again.
   *
   * `addWorkouts` puts its entries into `log` before it asks the server, which
   * is right — the sets are on screen the instant they are typed. But it makes
   * a second attempt at the same session impossible without duplicating them
   * locally: retrying through `addWorkouts` prepends a second copy of every
   * exercise, so a client on gym wifi who taps "Try again" watches their
   * workout appear twice and cannot tell which one is real.
   *
   * This is the insert on its own. Same rules as `addWorkouts` — resolves true
   * only once the rows are on the server, and adopts the ids it gets back so
   * the entries become editable — with nothing added to `log`, because the
   * caller's entries are in there already.
   *
   * Only ever for entries whose first write was REFUSED. An entry that has an
   * `id` is on the server and must not be sent again; those are filtered out
   * here rather than trusted to the caller, because a duplicated session is
   * indistinguishable from two real ones the day after.
   */
  retryWorkouts: (entries: WorkoutEntry[]) => Promise<boolean>;
  /** Correct an entry that is already logged. Resolves true only once the
   *  server holds the correction, and `log` is left untouched when it does not
   *  — so the screen never shows a figure the row disagrees with. */
  updateWorkout: (target: WorkoutEntry, next: Partial<WorkoutEntry>) => Promise<boolean>;
  /** Resolves true only when the row was actually deleted. The entry stays in
   *  `log` on false, rather than vanishing and returning at the next launch. */
  removeWorkout: (entry: WorkoutEntry) => Promise<boolean>;
  /** Re-run the hydrate. Useful behind a "couldn't load — retry" affordance. */
  reload: () => void;
  /** State how long a whole session ran, or clear it back to unknown.
   *  Session-scoped: see the comment on the implementation. Resolves true only
   *  once the server has the number — a length that never saved is what decides
   *  whether the session can be written to Apple Health. */
  setSessionMins: (t: string, mins: number | null) => Promise<boolean>;
}

const Ctx = createContext<WorkoutLogValue | null>(null);

/** Narrow a query to one row: by primary key when we have it. */
const matchRow = (q: any, uid: string, e: WorkoutEntry) =>
  e.id ? q.eq('id', e.id) : q.eq('user_id', uid).eq('performed_at', e.t).eq('exercise', e.exercise);

export function WorkoutLogProvider({ children }: { children: React.ReactNode }) {
  const authRev = useAuthRevision();
  const [log, setLog] = useState<WorkoutEntry[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [reloadTick, setReloadTick] = useState(0);

  // Hydrate from Supabase — never throws, never seeds, and now never claims an
  // empty history it did not actually read.
  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        // The auth call has an error channel of its own. Failing to establish
        // WHO the user is is not the same as their having no workouts, and it is
        // the likelier failure on a cold launch with bad signal.
        const { data: sess } = await supabase.auth.getSession();
        if (cancelled) return;
        // No session means no log to read, not a log we failed to read. This is
        // the provider behind "We couldn't read your training log" on Home.
        if (!sess?.session) { setStatus('ready'); return; }
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (cancelled) return;
        if (authErr) { reportError('workoutLog.hydrate.auth', authErr); setStatus('error'); return; }
        const id = auth?.user?.id;
        // Genuinely signed out: there is no history to fetch, and saying so is
        // accurate rather than a swallowed failure.
        if (!id) { setStatus('ready'); return; }
        setUid(id);
        // One row per set, not per session, so this is the fastest-growing read
        // a single client has: four sessions a week at twenty sets apiece passes
        // a thousand rows inside three months. It was unbounded, and the whole
        // of Home is computed from it — the streak, the personal records, the
        // week's volume. Every one of those would have gone quietly wrong.
        //
        // Newest-first was already the order and is the right one to cap on: the
        // screens that read this care about now. What a capped page cannot
        // support is `longestStreak` or a lifetime total, which is what 'partial'
        // exists to tell them.
        const { data, error } = await supabase
          .from('workouts').select('*').eq('user_id', id)
          .order('performed_at', { ascending: false }).order('id', { ascending: false }).limit(capLimit());
        if (cancelled) return;
        if (error) { reportError('workoutLog.hydrate', error); setStatus('error'); return; }
        const page = capped(data);
        // No rows means a genuinely empty history. Leave it empty — and, now,
        // say that it is empty rather than merely unknown.
        setLog(page.rows.length ? page.rows.map(rowToEntry) : []);
        setStatus(page.truncated ? 'partial' : 'ready');
      } catch (e) { reportError('workoutLog.hydrate', e); if (!cancelled) setStatus('error'); }
    })();
    return () => { cancelled = true; };
  }, [reloadTick, authRev]);

  // Insert, then adopt the ids the server assigns so the new entries can be
  // edited straight away rather than only after the next reload.
  const persist = async (entries: WorkoutEntry[]): Promise<boolean> => {
    if (!USE_SUPABASE || !uid || !entries.length) return false;
    try {
      const { data, error } = await supabase
        .from('workouts').insert(entries.map((e) => entryToRow(uid, e))).select();
      // This is the line the whole rewrite is for. `error` was never read, so a
      // policy refusal and a successful write were the same event to the caller.
      if (error) { reportError('workoutLog.persist', error); return false; }
      if (data && data.length) {
        setLog((prev) => {
          const next = [...prev];
          for (const row of data) {
            const i = next.findIndex((x) => !x.id && x.t === row.performed_at && x.exercise === row.exercise);
            if (i >= 0) next[i] = { ...next[i], id: row.id };
          }
          return next;
        });
      }
      return true;
    } catch (e) { reportError('workoutLog.persist', e); return false; }
  };

  const addWorkout = (entry: WorkoutEntry) => { setLog((p) => [entry, ...p]); return persist([entry]); };
  // The insert with no optimistic add — see the contract above. `id` present
  // means the row already exists, and re-inserting it is how one session
  // becomes two.
  const retryWorkouts = (entries: WorkoutEntry[]) => {
    const unsaved = entries.filter((e) => !e.id);
    return unsaved.length ? persist(unsaved) : Promise.resolve(false);
  };
  const addWorkouts = (entries: WorkoutEntry[]) => {
    if (!entries.length) return Promise.resolve(false);
    setLog((p) => [...entries, ...p]);
    return persist(entries);
  };

  const updateWorkout = async (target: WorkoutEntry, next: Partial<WorkoutEntry>): Promise<boolean> => {
    const apply = () => setLog((p) => p.map((e) => (e === target || (target.id && e.id === target.id) ? { ...e, ...next } : e)));
    // With no backend the in-memory log is the whole record, so applying it here
    // is the entire write — and still `false`, because it will not survive the
    // relaunch and the caller must not say "saved".
    if (!USE_SUPABASE || !uid) { apply(); return false; }
    const patch: Record<string, unknown> = {};
    if ('exercise' in next) patch.exercise = next.exercise;
    if ('t' in next) patch.performed_at = next.t;
    if ('sets' in next) patch.sets = next.sets ?? null;
    if ('feel' in next) patch.feel = next.feel ?? null;
    if ('cardio' in next) patch.cardio = next.cardio ?? null;
    if ('kcal' in next) patch.kcal = next.kcal ?? null;
    if ('zones' in next) patch.zones = next.zones ?? null;
    if ('sessionMins' in next) patch.session_mins = next.sessionMins ?? null;
    // Nothing to send is not a failure — the row already says what was asked.
    if (!Object.keys(patch).length) return true;
    try {
      // `.select('id')` and a row count, not just `error`. This is the same hole
      // the header describes, on the correction path: an UPDATE whose filter
      // matches nothing SUCCEEDS in PostgREST, having changed zero rows — so an
      // entry the client no longer owns, or one whose id never made it back from
      // the insert, reported a clean save and reverted at the next launch. See
      // `setClientMode` in src/ui/roster.tsx, which is where this was found.
      const { data, error } = await matchRow(supabase.from('workouts').update(patch), uid, target).select('id');
      if (error || !data || !data.length) { reportError('workoutLog.update', error); return false; }
      // Applied only now. The calendar's volume, sets and kcal columns are
      // derived from `log`, so they follow the correction the moment it is real
      // — and stay on the old figures, correctly, when it is not.
      apply();
      return true;
    } catch (e) { reportError('workoutLog.update', e); return false; }
  };

  /**
   * How long a session ran.
   *
   * Scoped to the session, not the row. One session writes all of its exercises
   * with the same `performed_at` (see `WorkoutEntry.id`), so its length is a
   * fact about the group: every row in it carries the same number and they are
   * set together, in ONE statement matched on (user_id, performed_at), rather
   * than eight round trips for an eight-exercise push day.
   *
   * `null` clears it back to unknown. That state has to stay reachable —
   * "nobody has said how long this was" is a real answer and is what stops a
   * session being written to Apple Health, so a mistyped 5 must be erasable
   * rather than only correctable to another number.
   *
   * A non-positive or unparseable value is rejected, not coerced: 0 minutes is
   * an unfinished form, and Health would take it as a real event lasting no
   * time at all.
   *
   * Returns whether the server took it. It was fire-and-forget, which put it in
   * the same bracket as everything else in this provider: the length sat on
   * screen, never reached the row, and came back blank at the next launch with
   * the Apple Health write silently unavailable and nothing saying why.
   */
  const setSessionMins = async (t: string, mins: number | null): Promise<boolean> => {
    const v = mins == null ? null : Math.round(mins);
    if (v != null && (!Number.isFinite(v) || v <= 0)) return false;
    setLog((p) => p.map((e) => (e.t === t ? { ...e, sessionMins: v ?? undefined } : e)));
    if (!USE_SUPABASE || !uid) return false;
    try {
      // Row count again: matching on (user_id, performed_at) is how a session's
      // rows are found, and a `t` that no longer exists on the server matches
      // none of them without raising anything.
      const { data, error } = await supabase.from('workouts').update({ session_mins: v })
        .eq('user_id', uid).eq('performed_at', t).select('id');
      if (error || !data || !data.length) { reportError('workoutLog.setSessionMins', error); return false; }
      return true;
    } catch (e) { reportError('workoutLog.setSessionMins', e); return false; }
  };

  const removeWorkout = async (entry: WorkoutEntry): Promise<boolean> => {
    const drop = () => setLog((p) => { const i = p.indexOf(entry); return i >= 0 ? [...p.slice(0, i), ...p.slice(i + 1)] : p.filter((e) => !(e.t === entry.t && e.exercise === entry.exercise)); });
    if (!USE_SUPABASE || !uid) { drop(); return false; }
    try {
      // A delete that was refused leaves the row on the server while the screen
      // shows it gone; it reappears on the next launch with no explanation. So
      // the entry now leaves `log` only once the server confirms — and a DELETE
      // matching nothing is not an error in PostgREST, it succeeds having
      // removed zero rows, so the returned rows are what proves it happened.
      const { data, error } = await matchRow(supabase.from('workouts').delete(), uid, entry).select('id');
      if (error || !data || !data.length) { reportError('workoutLog.remove', error); return false; }
      drop();
      return true;
    } catch (e) { reportError('workoutLog.remove', e); return false; }
  };

  const reload = () => { setStatus('loading'); setReloadTick((n) => n + 1); };

  return <Ctx.Provider value={{ log, status, addWorkout, addWorkouts, retryWorkouts, updateWorkout, removeWorkout, setSessionMins, reload }}>{children}</Ctx.Provider>;
}

export function useWorkoutLog(): WorkoutLogValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkoutLog must be used inside <WorkoutLogProvider>');
  return v;
}
