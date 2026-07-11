// Daily habits + water tracker (Phase 7). Reactive in-memory store, seeded with
// sensible defaults; swap for a Supabase `habit_logs` table later. Resets are a
// backend concern — in mock mode the day's state simply lives for the session.
import { createContext, useContext, useState, type ReactNode } from 'react';

export interface Habit { id: string; label: string; icon: string; done: boolean }

interface HabitsValue {
  habits: Habit[];
  toggleHabit: (id: string) => void;
  doneCount: number;
  water: number;          // glasses today
  waterGoal: number;
  addWater: () => void;
  removeWater: () => void;
}

const SEED: Habit[] = [
  { id: 'water', label: 'Hit water goal', icon: '💧', done: false },
  { id: 'steps', label: '10,000 steps', icon: '👟', done: false },
  { id: 'sleep', label: 'Sleep 7h+', icon: '😴', done: false },
  { id: 'protein', label: 'Protein target', icon: '🍗', done: false },
  { id: 'snacks', label: 'No late-night snacks', icon: '🌙', done: false },
];

const Ctx = createContext<HabitsValue | null>(null);

export function HabitsProvider({ children }: { children: ReactNode }) {
  const [habits, setHabits] = useState<Habit[]>(() => SEED.map((h) => ({ ...h })));
  const [water, setWater] = useState(0);
  const waterGoal = 8;

  const toggleHabit = (id: string) => setHabits((p) => p.map((h) => (h.id === id ? { ...h, done: !h.done } : h)));
  const addWater = () => setWater((w) => {
    const next = Math.min(w + 1, 20);
    if (next >= waterGoal) setHabits((p) => p.map((h) => (h.id === 'water' ? { ...h, done: true } : h)));
    return next;
  });
  const removeWater = () => setWater((w) => Math.max(0, w - 1));
  const doneCount = habits.filter((h) => h.done).length;

  return <Ctx.Provider value={{ habits, toggleHabit, doneCount, water, waterGoal, addWater, removeWater }}>{children}</Ctx.Provider>;
}

export function useHabits(): HabitsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useHabits must be used inside <HabitsProvider>');
  return v;
}
