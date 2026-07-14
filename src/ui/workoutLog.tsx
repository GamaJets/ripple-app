// Shared, reactive workout log. Persists to Supabase per signed-in user when
// available (hydrate-or-seed on mount + optimistic insert on log), and always
// falls back to the in-memory mock so the app never blanks or crashes offline.
import { createContext, useContext, useEffect, useState } from 'react';
import { MOCK_CLIENT, type WorkoutEntry } from '../lib/mockData';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';

interface WorkoutLogValue {
  log: WorkoutEntry[];
  addWorkout: (entry: WorkoutEntry) => void;
  addWorkouts: (entries: WorkoutEntry[]) => void;
  removeWorkout: (entry: WorkoutEntry) => void;
}

const Ctx = createContext<WorkoutLogValue | null>(null);

const rowToEntry = (r: any): WorkoutEntry => ({
  t: r.performed_at, exercise: r.exercise,
  sets: r.sets ?? undefined, cardio: r.cardio ?? undefined, kcal: r.kcal ?? undefined,
});
const entryToRow = (uid: string, e: WorkoutEntry) => ({
  user_id: uid, performed_at: e.t, exercise: e.exercise,
  sets: e.sets ?? null, cardio: e.cardio ?? null, kcal: e.kcal ?? null,
});

export function WorkoutLogProvider({ children }: { children: React.ReactNode }) {
  const [log, setLog] = useState<WorkoutEntry[]>(() => JSON.parse(JSON.stringify(MOCK_CLIENT.log)));
  const [uid, setUid] = useState<string | null>(null);

  // Hydrate from Supabase (or seed it with the demo history) — never throws.
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
        if (data && data.length) {
          setLog(data.map(rowToEntry));
        } else {
          // First run for this user: seed the demo history so it persists.
          await supabase.from('workouts').insert(MOCK_CLIENT.log.map((e) => entryToRow(id, e)));
        }
      } catch { /* stay on local mock */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const persist = (entries: WorkoutEntry[]) => {
    if (!USE_SUPABASE || !uid || !entries.length) return;
    try { supabase.from('workouts').insert(entries.map((e) => entryToRow(uid, e))).then(() => {}, () => {}); } catch { /* ignore */ }
  };
  const addWorkout = (entry: WorkoutEntry) => { setLog((p) => [entry, ...p]); persist([entry]); };
  const addWorkouts = (entries: WorkoutEntry[]) => { if (entries.length) { setLog((p) => [...entries, ...p]); persist(entries); } };
  const removeWorkout = (entry: WorkoutEntry) => {
    setLog((p) => { const i = p.indexOf(entry); return i >= 0 ? [...p.slice(0, i), ...p.slice(i + 1)] : p.filter((e) => !(e.t === entry.t && e.exercise === entry.exercise)); });
    if (USE_SUPABASE && uid) {
      try { supabase.from('workouts').delete().eq('user_id', uid).eq('performed_at', entry.t).eq('exercise', entry.exercise).then(() => {}, () => {}); } catch { /* ignore */ }
    }
  };

  return <Ctx.Provider value={{ log, addWorkout, addWorkouts, removeWorkout }}>{children}</Ctx.Provider>;
}

export function useWorkoutLog(): WorkoutLogValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkoutLog must be used inside <WorkoutLogProvider>');
  return v;
}
