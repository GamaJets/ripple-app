// Body measurements — tape measurements the client logs over time (cm),
// complementing the InBody scans. Reactive; seeded with two entries so trends
// show on the demo. Swap for a Supabase `measurements` table in the migration.
import { createContext, useContext, useState, type ReactNode } from 'react';

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

interface MeasureValue {
  entries: MeasureEntry[];
  addEntry: (vals: Partial<Omit<MeasureEntry, 'id' | 'at'>>) => void;
}

const Ctx = createContext<MeasureValue | null>(null);

export function MeasurementsProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<MeasureEntry[]>(() => JSON.parse(JSON.stringify(seed)));

  const addEntry = (vals: Partial<Omit<MeasureEntry, 'id' | 'at'>>) => {
    const clean: Partial<MeasureEntry> = {};
    for (const { key } of METRICS) { const v = vals[key]; if (typeof v === 'number' && !isNaN(v) && v > 0) clean[key] = v; }
    if (Object.keys(clean).length === 0) return;
    const entry: MeasureEntry = { id: 'm' + SEQ++, at: new Date().toISOString(), ...clean };
    setEntries((p) => [entry, ...p].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)));
  };

  return <Ctx.Provider value={{ entries, addEntry }}>{children}</Ctx.Provider>;
}

export function useMeasurements(): MeasureValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMeasurements must be used inside <MeasurementsProvider>');
  return v;
}
