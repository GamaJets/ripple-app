// Daily habits + water tracker (Phase 7). Habit done-states persist to Supabase
// `habit_logs` per user per day (hydrate-or-fallback + optimistic write) with a
// defensive in-memory fallback so it never blanks/crashes. Water glass count is
// session-local (no counter column); its 'done' state persists like the rest.
//
// The habit list is seeded from a constant, so it is never empty and a failed
// read looked completely healthy — five habits, all unticked. A client who had
// already ticked four of them that morning opened the app to a blank card and
// re-did the day, and the coach's dashboard read the same unticked row as a
// missed day. `status` separates "you have not ticked anything today" from "we
// could not read what you ticked".
//
// The writes were fire-and-forget on both branches, so a tick the server refused
// stayed green until the next launch and then quietly reverted.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { LoadStatus } from './loadStatus';

export interface Habit { id: string; label: string; icon: string; done: boolean }

interface HabitsValue {
  habits: Habit[];
  /** Resolves true only once the tick (or un-tick) is stored server-side. False
   *  means the green tick on screen is local and will be gone tomorrow. */
  toggleHabit: (id: string) => Promise<boolean>;
  /** Whether today's ticks were read from the server. Under 'error' an unticked
   *  habit means unknown, not "not done". */
  status: LoadStatus;
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
  const [wHydrated, setWHydrated] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const waterGoal = 8;
  useEffect(() => { AsyncStorage.getItem('repple.water:' + today()).then((r) => { const n = r ? parseInt(r, 10) : 0; if (Number.isFinite(n) && n > 0) setWater(n); setWHydrated(true); }); }, []);
  useEffect(() => { if (!wHydrated) return; AsyncStorage.setItem('repple.water:' + today(), String(water)).catch(() => {}); }, [water, wHydrated]);

  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (cancelled) return;
        if (authErr) { setStatus('error'); return; }
        const id = auth?.user?.id;
        if (!id) { setStatus('ready'); return; }
        setUid(id);
        const { data, error } = await supabase.from('habit_logs').select('habit').eq('user_id', id).eq('done_on', today());
        if (cancelled) return;
        if (error) { setStatus('error'); return; }
        if (data && data.length) {
          const done = new Set(data.map((r: any) => r.habit));
          setHabits((p) => p.map((h) => ({ ...h, done: done.has(h.id) })));
        }
        setStatus('ready');
      } catch { if (!cancelled) setStatus('error'); }
    })();
    return () => { cancelled = true; };
  }, []);

  const persist = async (id: string, done: boolean): Promise<boolean> => {
    if (!USE_SUPABASE || !uid) return false;
    try {
      const { error } = done
        ? await supabase.from('habit_logs').upsert({ user_id: uid, habit: id, done_on: today() }, { onConflict: 'user_id,habit,done_on' })
        : await supabase.from('habit_logs').delete().eq('user_id', uid).eq('habit', id).eq('done_on', today());
      return !error;
    } catch { return false; }
  };

  const toggleHabit = async (id: string): Promise<boolean> => {
    const cur = habits.find((h) => h.id === id);
    if (!cur) return false;
    const nd = !cur.done;
    // The write used to run INSIDE the setHabits updater, which meant it could
    // fire twice under React's double-invoked updaters and had nowhere to put a
    // result. It is its own step now.
    setHabits((p) => p.map((h) => (h.id === id ? { ...h, done: nd } : h)));
    return persist(id, nd);
  };

  const addWater = () => setWater((w) => {
    const next = Math.min(w + 1, 20);
    if (next >= waterGoal) {
      setHabits((p) => {
        if (p.some((h) => h.id === 'water' && !h.done)) { void persist('water', true); }
        return p.map((h) => (h.id === 'water' ? { ...h, done: true } : h));
      });
    }
    return next;
  });
  const removeWater = () => setWater((w) => Math.max(0, w - 1));
  const doneCount = habits.filter((h) => h.done).length;

  return <Ctx.Provider value={{ habits, toggleHabit, status, doneCount, water, waterGoal, addWater, removeWater }}>{children}</Ctx.Provider>;
}

export function useHabits(): HabitsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useHabits must be used inside <HabitsProvider>');
  return v;
}
