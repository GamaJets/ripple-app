// Wellness — the sleep log. (Hydration moved to useHabits; see below.)
//
// Both start EMPTY. This provider used to ship two invented sleep nights (7.5h
// and 6.5h, timestamped off Date.now() so they always read as "last night" and
// "the night before") and three cups of water nobody drank. Recovery rendered
// them as the client's own history, and worse, dashboard.tsx fed the sleep
// average into readinessScore() — so the biggest number on the home screen was
// computed from two literals.
//
// Nothing here persists yet: a cup logged now is gone on relaunch. That is a
// gap, but an empty log the user fills is honest, where a pre-filled one is not.
import { createContext, useContext, useState, type ReactNode } from 'react';

export interface SleepEntry { id: string; at: string; hours: number; quality: number }
let SEQ = 1;
const seedSleep: SleepEntry[] = [];

interface WellnessValue {
  // Hydration used to live here as well, as a plain useState(0): not persisted,
  // and entirely separate from the water counter on the home screen, which is
  // stored per day under repple.water:<date> by useHabits. Adding a glass on
  // one screen left the other unchanged, and Recovery's count reset to zero on
  // every app restart. Both were reported. There is one store now — useHabits —
  // and Recovery reads it directly, so the two screens cannot drift again.
  sleep: SleepEntry[]; addSleep: (hours: number, quality: number) => void;
}
const Ctx = createContext<WellnessValue | null>(null);

export function WellnessProvider({ children }: { children: ReactNode }) {
  const [sleep, setSleep] = useState<SleepEntry[]>(() => JSON.parse(JSON.stringify(seedSleep)));
  const addSleep = (hours: number, quality: number) => { if (!hours) return; setSleep((p) => [{ id: 's' + SEQ++, at: new Date().toISOString(), hours, quality }, ...p]); };
  return <Ctx.Provider value={{ sleep, addSleep }}>{children}</Ctx.Provider>;
}
export function useWellness(): WellnessValue { const v = useContext(Ctx); if (!v) throw new Error('useWellness must be used inside <WellnessProvider>'); return v; }
