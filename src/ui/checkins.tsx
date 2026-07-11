// Weekly check-ins (Phase 7). Client submits weight + energy/sleep/mood/adherence
// ratings + a note; the coach sees the latest one on the client detail. Reactive
// in-memory store, seeded with one prior check-in; swap for a Supabase table later.
import { createContext, useContext, useState, type ReactNode } from 'react';

export interface CheckIn {
  id: string;
  at: string;
  weightKg: number;
  energy: number;    // 1-5
  sleep: number;     // 1-5
  mood: number;      // 1-5
  adherence: number; // 1-5
  note: string;
}

interface CheckInsValue {
  checkins: CheckIn[];         // newest first
  latest: CheckIn | null;
  addCheckIn: (c: Omit<CheckIn, 'id' | 'at'>) => void;
}

let SEQ = 700;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); };

const Ctx = createContext<CheckInsValue | null>(null);

export function CheckInsProvider({ children }: { children: ReactNode }) {
  const [checkins, setCheckins] = useState<CheckIn[]>([
    { id: 'ci0', at: daysAgo(7), weightKg: 68.0, energy: 4, sleep: 3, mood: 4, adherence: 4, note: 'Good week — sleep slipped mid-week but training felt strong.' },
  ]);
  const addCheckIn: CheckInsValue['addCheckIn'] = (c) =>
    setCheckins((p) => [{ ...c, id: `ci${SEQ++}`, at: new Date().toISOString() }, ...p]);
  return <Ctx.Provider value={{ checkins, latest: checkins[0] ?? null, addCheckIn }}>{children}</Ctx.Provider>;
}

export function useCheckIns(): CheckInsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCheckIns must be used inside <CheckInsProvider>');
  return v;
}
