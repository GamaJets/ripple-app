// Wellness — hydration (cups today) + sleep log.
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
  cups: number; goalCups: number;
  addCup: () => void; removeCup: () => void;
  sleep: SleepEntry[]; addSleep: (hours: number, quality: number) => void;
}
const Ctx = createContext<WellnessValue | null>(null);

export function WellnessProvider({ children }: { children: ReactNode }) {
  const [cups, setCups] = useState(0);
  const [sleep, setSleep] = useState<SleepEntry[]>(() => JSON.parse(JSON.stringify(seedSleep)));
  const addCup = () => setCups((c) => Math.min(20, c + 1));
  const removeCup = () => setCups((c) => Math.max(0, c - 1));
  const addSleep = (hours: number, quality: number) => { if (!hours) return; setSleep((p) => [{ id: 's' + SEQ++, at: new Date().toISOString(), hours, quality }, ...p]); };
  return <Ctx.Provider value={{ cups, goalCups: 8, addCup, removeCup, sleep, addSleep }}>{children}</Ctx.Provider>;
}
export function useWellness(): WellnessValue { const v = useContext(Ctx); if (!v) throw new Error('useWellness must be used inside <WellnessProvider>'); return v; }
