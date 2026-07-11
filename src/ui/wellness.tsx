// Wellness — hydration (cups today) + sleep log. Reactive; hydration resets are
// manual for the demo. Swap for wearable/Supabase data later.
import { createContext, useContext, useState, type ReactNode } from 'react';

export interface SleepEntry { id: string; at: string; hours: number; quality: number }
let SEQ = 1;
const seedSleep: SleepEntry[] = [
  { id: 's0', at: new Date(Date.now() - 86400000).toISOString(), hours: 7.5, quality: 4 },
  { id: 's1', at: new Date(Date.now() - 2 * 86400000).toISOString(), hours: 6.5, quality: 3 },
];

interface WellnessValue {
  cups: number; goalCups: number;
  addCup: () => void; removeCup: () => void;
  sleep: SleepEntry[]; addSleep: (hours: number, quality: number) => void;
}
const Ctx = createContext<WellnessValue | null>(null);

export function WellnessProvider({ children }: { children: ReactNode }) {
  const [cups, setCups] = useState(3);
  const [sleep, setSleep] = useState<SleepEntry[]>(() => JSON.parse(JSON.stringify(seedSleep)));
  const addCup = () => setCups((c) => Math.min(20, c + 1));
  const removeCup = () => setCups((c) => Math.max(0, c - 1));
  const addSleep = (hours: number, quality: number) => { if (!hours) return; setSleep((p) => [{ id: 's' + SEQ++, at: new Date().toISOString(), hours, quality }, ...p]); };
  return <Ctx.Provider value={{ cups, goalCups: 8, addCup, removeCup, sleep, addSleep }}>{children}</Ctx.Provider>;
}
export function useWellness(): WellnessValue { const v = useContext(Ctx); if (!v) throw new Error('useWellness must be used inside <WellnessProvider>'); return v; }
