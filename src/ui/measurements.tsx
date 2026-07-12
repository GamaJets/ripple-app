// Body measurements (cm) the client logs over time, complementing InBody scans.
// Persists to Supabase `measurements` (one row per body-part per date) with a
// hydrate-or-seed pattern + defensive in-memory fallback.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';

export interface MeasureEntry {
  id: string; at: string;
  waist?: number; chest?: number; arm?: number; thigh?: number; hips?: number;
}

export const METRICS: { key: keyof Omit<MeasureEntry, 'id' | 'at'>; label: string }[] = [
  { key: 'waist', label: 'Waist' },
  { key: 'chest', label: 'Chest' },
  { key: 'arm', label: 'Arm' },
  { key: 'thigh', label: 'Thigh' },
  { key: 'hips', label: 'Hips' },
];

let SEQ = 1;
const seed: MeasureEntry[] = [
  { id: 'm-seed1', at: new Date(Date.now() - 35 * 86400000).toISOString(), waist: 82, chest: 98, arm: 31, thigh: 58, hips: 96 },
  { id: 'm-seed2', at: new Date(Date.now() - 5 * 86400000).toISOString(), waist: 79, chest: 99, arm: 32, thigh: 57, hips: 94 },
];

const dateOf = (iso: string) => iso.slice(0, 10);
// group flat rows [{taken_at, kind, value}] into MeasureEntry per date
function rowsToEntries(rows: any[]): MeasureEntry[] {
  const byDate: Record<string, MeasureEntry> = {};
  for (const r of rows) {
    const d = r.taken_at as string;
    byDate[d] = byDate[d] || { id: 'm-' + d, at: d };
    (byDate[d] as any)[r.kind] = Number(r.value);
  }
  return Object.values(byDate).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
function entryToRows(uid: string, e: MeasureEntry) {
  const rows: any[] = [];
  for (const { key } of METRICS) { const v = e[key]; if (typeof v === 'number') rows.push({ user_id: uid, taken_at: dateOf(e.at), kind: key, value: v }); }
  return rows;
}

interface MeasureValue {
  entries: MeasureEntry[];
  addEntry: (vals: Partial<Omit<MeasureEntry, 'id' | 'at'>>) => void;
}

const Ctx = createContext<MeasureValue | null>(null);

export function MeasurementsProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<MeasureEntry[]>(() => JSON.parse(JSON.stringify(seed)));
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const id = auth?.user?.id; if (!id || cancelled) return; setUid(id);
        const { data, error } = await supabase.from('measurements').select('*').eq('user_id', id).order('taken_at', { ascending: false });
        if (error || cancelled) return;
        if (data && data.length) setEntries(rowsToEntries(data));
        else { const rows = seed.flatMap((e) => entryToRows(id, e)); if (rows.length) await supabase.from('measurements').insert(rows); }
      } catch { /* stay on mock */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const addEntry = (vals: Partial<Omit<MeasureEntry, 'id' | 'at'>>) => {
    const clean: Partial<MeasureEntry> = {};
    for (const { key } of METRICS) { const v = vals[key]; if (typeof v === 'number' && !isNaN(v) && v > 0) clean[key] = v; }
    if (Object.keys(clean).length === 0) return;
    const entry: MeasureEntry = { id: 'm' + SEQ++, at: new Date().toISOString(), ...clean };
    setEntries((p) => [entry, ...p].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)));
    if (USE_SUPABASE && uid) { try { supabase.from('measurements').insert(entryToRows(uid, entry)).then(() => {}, () => {}); } catch { /* ignore */ } }
  };

  return <Ctx.Provider value={{ entries, addEntry }}>{children}</Ctx.Provider>;
}

export function useMeasurements(): MeasureValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMeasurements must be used inside <MeasurementsProvider>');
  return v;
}
