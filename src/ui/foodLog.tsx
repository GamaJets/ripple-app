// Shared food-log store — what the client actually ate today (via photo, barcode,
// AI description, or search), counting toward the day's macros. Persists to
// Supabase `food_logs` per client (hydrate today + optimistic) with a defensive
// in-memory fallback + demo seed. Shared by the Meals tab and the Food Log screen.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';

export type LogVia = 'search' | 'barcode' | 'photo' | 'manual';
export interface FoodEntry { id: string; name: string; kcal: number; protein: number; carbs: number; fat: number; via: LogVia }

interface FoodLogValue {
  entries: FoodEntry[];
  consumed: { kcal: number; protein: number; carbs: number; fat: number };
  addFood: (f: Omit<FoodEntry, 'id'>) => void;
  removeFood: (id: string) => void;
}

let SEQ = 300;
// Empty. This held a 130 kcal Greek yogurt marked "via search" that counted
// into the day's macro rings on every launch. The Supabase hydration below only
// clears it on the happy path — signed out, offline, or on any query error the
// early return left the seed standing, so a meal nobody ate was reported as
// eaten.
const SEED: FoodEntry[] = [];

const startOfTodayISO = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const rowToEntry = (r: any): FoodEntry => ({
  id: String(r.id), name: r.name, kcal: Math.round(r.kcal ?? 0),
  protein: Math.round(r.protein ?? 0), carbs: Math.round(r.carbs ?? 0), fat: Math.round(r.fat ?? 0),
  via: (['search', 'barcode', 'photo', 'manual'].includes(r.via) ? r.via : 'manual'),
});

const Ctx = createContext<FoodLogValue | null>(null);

export function FoodLogProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<FoodEntry[]>(() => JSON.parse(JSON.stringify(SEED)));
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const id = auth?.user?.id; if (!id || cancelled) return; setUid(id);
        const { data, error } = await supabase.from('food_logs').select('*')
          .eq('client_id', id).gte('logged_at', startOfTodayISO()).order('logged_at', { ascending: true });
        if (error || cancelled) return;
        setEntries(data && data.length ? data.map(rowToEntry) : []);
      } catch { /* leave the log empty rather than inventing entries */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const addFood: FoodLogValue['addFood'] = (f) => {
    const entry: FoodEntry = { ...f, id: 'fl' + SEQ++ };
    setEntries((p) => [...p, entry]);
    if (USE_SUPABASE && uid) {
      try {
        supabase.from('food_logs')
          .insert({ client_id: uid, name: f.name, kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat, via: f.via })
          .select().single()
          .then(({ data }) => { if (data) setEntries((p) => p.map((x) => (x.id === entry.id ? rowToEntry(data) : x))); }, () => {});
      } catch { /* keep optimistic */ }
    }
  };

  const removeFood: FoodLogValue['removeFood'] = (id) => {
    setEntries((p) => p.filter((x) => x.id !== id));
    if (USE_SUPABASE && !id.startsWith('fl')) { try { supabase.from('food_logs').delete().eq('id', id).then(() => {}, () => {}); } catch { /* ignore */ } }
  };

  const consumed = useMemo(() => entries.reduce((a, f) => ({ kcal: a.kcal + f.kcal, protein: a.protein + f.protein, carbs: a.carbs + f.carbs, fat: a.fat + f.fat }), { kcal: 0, protein: 0, carbs: 0, fat: 0 }), [entries]);

  return <Ctx.Provider value={{ entries, consumed, addFood, removeFood }}>{children}</Ctx.Provider>;
}

export function useFoodLog(): FoodLogValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFoodLog must be used inside <FoodLogProvider>');
  return v;
}
