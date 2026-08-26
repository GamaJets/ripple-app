// Shared, reactive workout log. Persists to Supabase per signed-in user
// (hydrate on mount + optimistic insert on log). Starts empty: a new account has
// no workout history until the user logs one. Never seeds demo data.
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
  updateWorkout: (target: WorkoutEntry, next: Partial<WorkoutEntry>) => Promise<boolean>;
  removeWorkout: (entry: WorkoutEntry) => Promise<boolean>;
  /** Re-run the hydrate. Useful behind a "couldn't load — retry" affordance. */
  reload: () => void;
}

const Ctx = createContext<WorkoutLogValue | null>(null);

/** Narrow a query to one row: by primary key when we have it. */
const matchRow = (q: any, uid: string, e: WorkoutEntry) =>
  e.id ? q.eq('id', e.id) : q.eq('user_id', uid).eq('performed_at', e.t).eq('exercise', e.exercise);

export function WorkoutLogProvider({ children }: { children: React.ReactNode }) {
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
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (cancelled) return;
        if (authErr) { reportError('workoutLog.hydrate.auth', authErr); setStatus('error'); return; }
        const id = auth?.user?.id;
        // Genuinely signed out: there is no history to fetch, and saying so is
        // accurate rather than a swallowed failure.
        if (!id) { setStatus('ready'); return; }
        setUid(id);
        const { data, error } = await supabase
          .from('workouts').select('*').eq('user_id', id).order('performed_at', { ascending: false });
        if (cancelled) return;
        if (error) { reportError('workoutLog.hydrate', error); setStatus('error'); return; }
        // No rows means a genuinely empty history. Leave it empty — and, now,
        // say that it is empty rather than merely unknown.
        setLog(data && data.length ? data.map(rowToEntry) : []);
        setStatus('ready');
      } catch (e) { reportError('workoutLog.hydrate', e); if (!cancelled) setStatus('error'); }
    })();
    return () => { cancelled = true; };
  }, [reloadTick]);

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
  const addWorkouts = (entries: WorkoutEntry[]) => {
    if (!entries.length) return Promise.resolve(false);
    setLog((p) => [...entries, ...p]);
    return persist(entries);
  };

  const updateWorkout = async (target: WorkoutEntry, next: Partial<WorkoutEntry>): Promise<boolean> => {
    setLog((p) => p.map((e) => (e === target || (target.id && e.id === target.id) ? { ...e, ...next } : e)));
    if (!USE_SUPABASE || !uid) return false;
    const patch: Record<string, unknown> = {};
    if ('exercise' in next) patch.exercise = next.exercise;
    if ('t' in next) patch.performed_at = next.t;
    if ('sets' in next) patch.sets = next.sets ?? null;
    if ('feel' in next) patch.feel = next.feel ?? null;
    if ('cardio' in next) patch.cardio = next.cardio ?? null;
    if ('kcal' in next) patch.kcal = next.kcal ?? null;
    if ('zones' in next) patch.zones = next.zones ?? null;
    // Nothing to send is not a failure — the row already says what was asked.
    if (!Object.keys(patch).length) return true;
    try {
      const { error } = await matchRow(supabase.from('workouts').update(patch), uid, target);
      if (error) { reportError('workoutLog.update', error); return false; }
      return true;
    } catch (e) { reportError('workoutLog.update', e); return false; }
  };

  const removeWorkout = async (entry: WorkoutEntry): Promise<boolean> => {
    setLog((p) => { const i = p.indexOf(entry); return i >= 0 ? [...p.slice(0, i), ...p.slice(i + 1)] : p.filter((e) => !(e.t === entry.t && e.exercise === entry.exercise)); });
    if (!USE_SUPABASE || !uid) return false;
    try {
      // A delete that was refused leaves the row on the server while the screen
      // shows it gone; it reappears on the next launch with no explanation.
      const { error } = await matchRow(supabase.from('workouts').delete(), uid, entry);
      if (error) { reportError('workoutLog.remove', error); return false; }
      return true;
    } catch (e) { reportError('workoutLog.remove', e); return false; }
  };

  const reload = () => { setStatus('loading'); setReloadTick((n) => n + 1); };

  return <Ctx.Provider value={{ log, status, addWorkout, addWorkouts, updateWorkout, removeWorkout, reload }}>{children}</Ctx.Provider>;
}

export function useWorkoutLog(): WorkoutLogValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkoutLog must be used inside <WorkoutLogProvider>');
  return v;
}
