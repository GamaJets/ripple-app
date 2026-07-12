// Daily habits + water tracker (Phase 7). Habit done-states persist to Supabase
// `habit_logs` per user per day (hydrate-or-fallback + optimistic write) with a
// defensive in-memory fallback so it never blanks/crashes. Water glass count is
// session-local (no counter column); its 'done' state persists like the rest.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';

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

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const Ctx = createContext<HabitsValue | null>(null);

export function HabitsProvider({ children }: { children: ReactNode }) {
  const [habits, setHabits] = useState<Habit[]>(() => SEED.map((h) => ({ ...h })));
  const [water, setWater] = useState(0);
  const [uid, setUid] = useState<string | null>(null);
  const waterGoal = 8;

  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const id = auth?.user?.id;
        if (!id || cancelled) return;
        setUid(id);
        const { data, error } = await supabase.from('habit_logs').select('habit').eq('user_id', id).eq('done_on', today());
        if (error || cancelled) return;
        if (data && data.length) {
          const done = new Set(data.map((r: any) => r.habit));
          setHabits((p) => p.map((h) => ({ ...h, done: done.has(h.id) })));
        }
      } catch { /* stay on in-memory */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const persist = (id: string, done: boolean) => {
    if (!USE_SUPABASE || !uid) return;
    try {
      if (done) supabase.from('habit_logs').upsert({ user_id: uid, habit: id, done_on: today() }, { onConflict: 'user_id,habit,done_on' }).then(() => {}, () => {});
      else supabase.from('habit_logs').delete().eq('user_id', uid).eq('habit', id).eq('done_on', today()).then(() => {}, () => {});
    } catch { /* ignore */ }
  };

  const toggleHabit = (id: string) => setHabits((p) => p.map((h) => {
    if (h.id === id) { const nd = !h.done; persist(id, nd); return { ...h, done: nd }; }
    return h;
  }));

  const addWater = () => setWater((w) => {
    const next = Math.min(w + 1, 20);
    if (next >= waterGoal) setHabits((p) => p.map((h) => {
      if (h.id === 'water' && !h.done) persist('water', true);
      return h.id === 'water' ? { ...h, done: true } : h;
    }));
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
