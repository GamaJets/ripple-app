// Shared, reactive workout log. Persists to Supabase per signed-in user
// (hydrate on mount + optimistic insert on log). Starts empty: a new account has
// no workout history until the user logs one. Never seeds demo data.
import { createContext, useContext, useEffect, useState } from 'react';
import type { WorkoutEntry } from '../lib/mockData';
import { rowToEntry, entryToRow } from '../lib/workoutRow';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';

interface WorkoutLogValue {
  log: WorkoutEntry[];
  addWorkout: (entry: WorkoutEntry) => void;
  addWorkouts: (entries: WorkoutEntry[]) => void;
  updateWorkout: (target: WorkoutEntry, next: Partial<WorkoutEntry>) => void;
  removeWorkout: (entry: WorkoutEntry) => void;
  /** State how long a whole session ran, or clear it back to unknown.
   *  Session-scoped: see the comment on the implementation. */
  setSessionMins: (t: string, mins: number | null) => void;
}

const Ctx = createContext<WorkoutLogValue | null>(null);

/** Narrow a query to one row: by primary key when we have it. */
const matchRow = (q: any, uid: string, e: WorkoutEntry) =>
  e.id ? q.eq('id', e.id) : q.eq('user_id', uid).eq('performed_at', e.t).eq('exercise', e.exercise);

export function WorkoutLogProvider({ children }: { children: React.ReactNode }) {
  const [log, setLog] = useState<WorkoutEntry[]>([]);
  const [uid, setUid] = useState<string | null>(null);

  // Hydrate from Supabase — never throws, never seeds.
  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const id = auth?.user?.id;
        if (!id || cancelled) return;
        setUid(id);
        const { data, error } = await supabase
          .from('workouts').select('*').eq('user_id', id).order('performed_at', { ascending: false });
        if (error || cancelled) return;
        // No rows means a genuinely empty history. Leave it empty.
        setLog(data && data.length ? data.map(rowToEntry) : []);
      } catch (e) { reportError('workoutLog.hydrate', e); }
    })();
    return () => { cancelled = true; };
  }, []);

  // Insert, then adopt the ids the server assigns so the new entries can be
  // edited straight away rather than only after the next reload.
  const persist = (entries: WorkoutEntry[]) => {
    if (!USE_SUPABASE || !uid || !entries.length) return;
    try {
      supabase.from('workouts').insert(entries.map((e) => entryToRow(uid, e))).select().then(
        ({ data }: any) => {
          if (!data || !data.length) return;
          setLog((prev) => {
            const next = [...prev];
            for (const row of data) {
              const i = next.findIndex((x) => !x.id && x.t === row.performed_at && x.exercise === row.exercise);
              if (i >= 0) next[i] = { ...next[i], id: row.id };
            }
            return next;
          });
        },
        (e: unknown) => reportError('workoutLog.persist', e),
      );
    } catch (e) { reportError('workoutLog.persist', e); }
  };
  const addWorkout = (entry: WorkoutEntry) => { setLog((p) => [entry, ...p]); persist([entry]); };
  const addWorkouts = (entries: WorkoutEntry[]) => { if (entries.length) { setLog((p) => [...entries, ...p]); persist(entries); } };
  const updateWorkout = (target: WorkoutEntry, next: Partial<WorkoutEntry>) => {
    setLog((p) => p.map((e) => (e === target || (target.id && e.id === target.id) ? { ...e, ...next } : e)));
    if (!USE_SUPABASE || !uid) return;
    const patch: Record<string, unknown> = {};
    if ('exercise' in next) patch.exercise = next.exercise;
    if ('t' in next) patch.performed_at = next.t;
    if ('sets' in next) patch.sets = next.sets ?? null;
    if ('feel' in next) patch.feel = next.feel ?? null;
    if ('cardio' in next) patch.cardio = next.cardio ?? null;
    if ('kcal' in next) patch.kcal = next.kcal ?? null;
    if ('zones' in next) patch.zones = next.zones ?? null;
    if ('sessionMins' in next) patch.session_mins = next.sessionMins ?? null;
    if (!Object.keys(patch).length) return;
    try {
      matchRow(supabase.from('workouts').update(patch), uid, target)
        .then(() => {}, (e: unknown) => reportError('workoutLog.update', e));
    } catch (e) { reportError('workoutLog.update', e); }
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
   */
  const setSessionMins = (t: string, mins: number | null) => {
    const v = mins == null ? null : Math.round(mins);
    if (v != null && (!Number.isFinite(v) || v <= 0)) return;
    setLog((p) => p.map((e) => (e.t === t ? { ...e, sessionMins: v ?? undefined } : e)));
    if (!USE_SUPABASE || !uid) return;
    try {
      supabase.from('workouts').update({ session_mins: v })
        .eq('user_id', uid).eq('performed_at', t)
        .then(() => {}, (e: unknown) => reportError('workoutLog.setSessionMins', e));
    } catch (e) { reportError('workoutLog.setSessionMins', e); }
  };
  const removeWorkout = (entry: WorkoutEntry) => {
    setLog((p) => { const i = p.indexOf(entry); return i >= 0 ? [...p.slice(0, i), ...p.slice(i + 1)] : p.filter((e) => !(e.t === entry.t && e.exercise === entry.exercise)); });
    if (USE_SUPABASE && uid) {
      try {
        matchRow(supabase.from('workouts').delete(), uid, entry)
          .then(() => {}, (e: unknown) => reportError('workoutLog.remove', e));
      } catch (e) { reportError('workoutLog.remove', e); }
    }
  };

  return <Ctx.Provider value={{ log, addWorkout, addWorkouts, updateWorkout, removeWorkout, setSessionMins }}>{children}</Ctx.Provider>;
}

export function useWorkoutLog(): WorkoutLogValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkoutLog must be used inside <WorkoutLogProvider>');
  return v;
}
