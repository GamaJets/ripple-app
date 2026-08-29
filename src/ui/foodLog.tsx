// Shared food-log store — what the client actually ate today (via photo, barcode,
// AI description, or search), counting toward the day's macros. Persists to
// Supabase `food_logs` per client (hydrate today + optimistic) with a defensive
// in-memory fallback that starts empty. Shared by the Meals tab and the Food Log screen.
//
// An empty food log is not a neutral fact here: the Meals tab reads `consumed`
// straight into the day's macro rings and the "remaining" figures the client
// eats against. When the hydrate below failed — a refused read, a dropped
// connection in a gym basement — it returned early and left `entries` at `[]`,
// so a client who had logged breakfast and lunch was shown their full day's
// calories still remaining and told to eat them again. `status` is what lets the
// Meals tab say "we couldn't load today's log" instead of "you have eaten
// nothing".
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { LoadStatus } from './loadStatus';
import { useAuthRevision } from './authRevision';

export type LogVia = 'search' | 'barcode' | 'photo' | 'manual';
export interface FoodEntry { id: string; name: string; kcal: number; protein: number; carbs: number; fat: number; via: LogVia }

interface FoodLogValue {
  entries: FoodEntry[];
  consumed: { kcal: number; protein: number; carbs: number; fat: number };
  /** Whether today's log is what the server holds. Under 'error' `consumed`
   *  is a floor, not a total — there may be entries we could not read, so
   *  "remaining" is an overestimate and must not be presented as a target. */
  status: LoadStatus;
  /** Resolves true only once the entry is on the server. False means it counts
   *  toward today's macros on this phone only and is gone on relaunch. */
  addFood: (f: Omit<FoodEntry, 'id'>) => Promise<boolean>;
  /** Resolves true only when the row was actually deleted. A refused delete
   *  brings the food back — and its calories with it — after a relaunch. */
  removeFood: (id: string) => Promise<boolean>;
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
  const authRev = useAuthRevision();
  const [entries, setEntries] = useState<FoodEntry[]>(() => JSON.parse(JSON.stringify(SEED)));
  const [uid, setUid] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        // No session is a true answer, not a failed check. getUser() REJECTS
        // when nobody is signed in, and treating that as an error latched this
        // provider into 'error' on the first tick — before anybody had signed
        // in — where it stayed, because the effect never ran a second time.
        const { data: sess } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!sess?.session) { setStatus('ready'); return; }
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (cancelled) return;
        if (authErr) { setStatus('error'); return; }
        const id = auth?.user?.id;
        if (!id) { setStatus('ready'); return; }
        setUid(id);
        const { data, error } = await supabase.from('food_logs').select('*')
          .eq('client_id', id).gte('logged_at', startOfTodayISO()).order('logged_at', { ascending: true });
        if (cancelled) return;
        if (error) { setStatus('error'); return; }
        setEntries(data && data.length ? data.map(rowToEntry) : []);
        setStatus('ready');
      } catch { if (!cancelled) setStatus('error'); /* leave the log empty rather than inventing entries */ }
    })();
    return () => { cancelled = true; };
  }, [authRev]);

  const addFood: FoodLogValue['addFood'] = async (f) => {
    const entry: FoodEntry = { ...f, id: 'fl' + SEQ++ };
    setEntries((p) => [...p, entry]);
    if (!USE_SUPABASE || !uid) return false;
    try {
      // The old `.then(({ data }) => …, () => {})` never looked at `error`, so a
      // refused insert and a successful one were the same event: either way the
      // optimistic entry stayed on screen counting toward the day's macros.
      const { data, error } = await supabase.from('food_logs')
        .insert({ client_id: uid, name: f.name, kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat, via: f.via })
        .select().single();
      if (error || !data) return false;
      setEntries((p) => p.map((x) => (x.id === entry.id ? rowToEntry(data) : x)));
      return true;
    } catch { return false; }
  };

  const removeFood: FoodLogValue['removeFood'] = async (id) => {
    setEntries((p) => p.filter((x) => x.id !== id));
    // An 'fl' id is optimistic-only and never reached the server, so dropping it
    // locally is the entire removal.
    if (id.startsWith('fl')) return true;
    if (!USE_SUPABASE) return false;
    try {
      const { error } = await supabase.from('food_logs').delete().eq('id', id);
      return !error;
    } catch { return false; }
  };

  const consumed = useMemo(() => entries.reduce((a, f) => ({ kcal: a.kcal + f.kcal, protein: a.protein + f.protein, carbs: a.carbs + f.carbs, fat: a.fat + f.fat }), { kcal: 0, protein: 0, carbs: 0, fat: 0 }), [entries]);

  return <Ctx.Provider value={{ entries, consumed, status, addFood, removeFood }}>{children}</Ctx.Provider>;
}

export function useFoodLog(): FoodLogValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFoodLog must be used inside <FoodLogProvider>');
  return v;
}
