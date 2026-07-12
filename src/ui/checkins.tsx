// Weekly check-ins. Client submits weight + energy/sleep/mood/adherence + a note;
// the coach sees the latest on the client detail. Persists to Supabase per user
// (hydrate-or-seed + optimistic insert) with a defensive in-memory fallback.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';

export interface CheckIn {
  id: string; at: string;
  weightKg: number; energy: number; sleep: number; mood: number; adherence: number; note: string;
}

interface CheckInsValue {
  checkins: CheckIn[];
  latest: CheckIn | null;
  addCheckIn: (c: Omit<CheckIn, 'id' | 'at'>) => void;
}

let SEQ = 700;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); };
const SEED: CheckIn[] = [
  { id: 'ci0', at: daysAgo(7), weightKg: 68.0, energy: 4, sleep: 3, mood: 4, adherence: 4, note: 'Good week — sleep slipped mid-week but training felt strong.' },
];

const rowToCI = (r: any): CheckIn => ({ id: r.id, at: r.at, weightKg: Number(r.weight_kg), energy: r.energy, sleep: r.sleep, mood: r.mood, adherence: r.adherence, note: r.note ?? '' });
const ciToRow = (uid: string, c: CheckIn) => ({ user_id: uid, at: c.at, weight_kg: c.weightKg, energy: c.energy, sleep: c.sleep, mood: c.mood, adherence: c.adherence, note: c.note });

const Ctx = createContext<CheckInsValue | null>(null);

export function CheckInsProvider({ children }: { children: ReactNode }) {
  const [checkins, setCheckins] = useState<CheckIn[]>(() => JSON.parse(JSON.stringify(SEED)));
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const id = auth?.user?.id; if (!id || cancelled) return; setUid(id);
        const { data, error } = await supabase.from('check_ins').select('*').eq('user_id', id).order('at', { ascending: false });
        if (error || cancelled) return;
        if (data && data.length) setCheckins(data.map(rowToCI));
        else await supabase.from('check_ins').insert(SEED.map((c) => ciToRow(id, c)));
      } catch { /* stay on mock */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const addCheckIn: CheckInsValue['addCheckIn'] = (c) => {
    const entry: CheckIn = { ...c, id: `ci${SEQ++}`, at: new Date().toISOString() };
    setCheckins((p) => [entry, ...p]);
    if (USE_SUPABASE && uid) { try { supabase.from('check_ins').insert(ciToRow(uid, entry)).then(() => {}, () => {}); } catch { /* ignore */ } }
  };

  return <Ctx.Provider value={{ checkins, latest: checkins[0] ?? null, addCheckIn }}>{children}</Ctx.Provider>;
}

export function useCheckIns(): CheckInsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCheckIns must be used inside <CheckInsProvider>');
  return v;
}
