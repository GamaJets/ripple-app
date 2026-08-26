// Body measurements (cm) the client logs over time, complementing InBody scans.
// Persists to Supabase `measurements` (one row per body-part per date) with a
// hydrate-only: an empty result is an empty history, never a cue to seed.
//
// That rule was right and stays. What was missing is that a FAILED read reached
// the same `entries: []` by a different route, and the measurements screen then
// showed its "log your first measurement" empty state to a client with months of
// history — inviting them to start again from nothing and lose the trend the
// screen exists to show. `status` separates the two.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { LoadStatus } from './loadStatus';

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
  /** Whether `entries` is the server's answer. Under 'error' an empty list
   *  means the history could not be read, not that there is none. */
  status: LoadStatus;
  /** Resolves true only once the rows are on the server. False means the entry
   *  is on this phone for this session only. */
  addEntry: (vals: Partial<Omit<MeasureEntry, 'id' | 'at'>>) => Promise<boolean>;
}

const Ctx = createContext<MeasureValue | null>(null);

export function MeasurementsProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<MeasureEntry[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

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
        const { data, error } = await supabase.from('measurements').select('*').eq('user_id', id).order('taken_at', { ascending: false });
        if (cancelled) return;
        if (error) { setStatus('error'); return; }
        // Same rule as check-ins and the workout log: an empty result is an empty
        // history, not a cue to write fabricated measurements into Supabase.
        setEntries(data && data.length ? rowsToEntries(data) : []);
        setStatus('ready');
      } catch { if (!cancelled) setStatus('error'); }
    })();
    return () => { cancelled = true; };
  }, []);

  const addEntry = async (vals: Partial<Omit<MeasureEntry, 'id' | 'at'>>): Promise<boolean> => {
    const clean: Partial<MeasureEntry> = {};
    for (const { key } of METRICS) { const v = vals[key]; if (typeof v === 'number' && !isNaN(v) && v > 0) clean[key] = v; }
    if (Object.keys(clean).length === 0) return false;
    const entry: MeasureEntry = { id: 'm' + SEQ++, at: new Date().toISOString(), ...clean };
    setEntries((p) => [entry, ...p].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)));
    if (!USE_SUPABASE || !uid) return false;
    try {
      const { error } = await supabase.from('measurements').insert(entryToRows(uid, entry));
      return !error;
    } catch { return false; }
  };

  return <Ctx.Provider value={{ entries, status, addEntry }}>{children}</Ctx.Provider>;
}

export function useMeasurements(): MeasureValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMeasurements must be used inside <MeasurementsProvider>');
  return v;
}
