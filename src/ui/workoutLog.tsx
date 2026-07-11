// Shared, reactive workout log. Seeded from mock history; guided sessions and
// manual logs append to it so streaks, PRs, the Train day-detail and the coach's
// client view all update live. Swap the seed for Supabase queries later.
import { createContext, useContext, useState } from 'react';
import { MOCK_CLIENT, type WorkoutEntry } from '../lib/mockData';

interface WorkoutLogValue {
  log: WorkoutEntry[];
  addWorkout: (entry: WorkoutEntry) => void;
  addWorkouts: (entries: WorkoutEntry[]) => void;
}

const Ctx = createContext<WorkoutLogValue | null>(null);

export function WorkoutLogProvider({ children }: { children: React.ReactNode }) {
  const [log, setLog] = useState<WorkoutEntry[]>(() => JSON.parse(JSON.stringify(MOCK_CLIENT.log)));
  const addWorkout = (entry: WorkoutEntry) => setLog((p) => [entry, ...p]);
  const addWorkouts = (entries: WorkoutEntry[]) => { if (entries.length) setLog((p) => [...entries, ...p]); };
  return <Ctx.Provider value={{ log, addWorkout, addWorkouts }}>{children}</Ctx.Provider>;
}

export function useWorkoutLog(): WorkoutLogValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkoutLog must be used inside <WorkoutLogProvider>');
  return v;
}
