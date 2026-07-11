// Shared client data — one source of truth so a saved scan updates weight,
// body-fat, muscle, charts, and meal targets across every screen. Goal and diet
// are live state too, so changing either re-targets macros, the meal plan and the
// workout program app-wide.
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { MOCK_CLIENT } from '../lib/mockData';
import type { Goal, Diet } from '../lib/types';

export interface ScanRec { id: string; takenAt: string; weightKg: number; bodyFatPct: number; skeletalMuscleKg: number; source: string; image?: string }
interface Series { t: string; v: number }
interface Value {
  id: string; name: string; init: string;
  dob: string; setDob: (v: string) => void;
  photo: string | null; setPhoto: (v: string | null) => void;
  heightCm: number; setHeightCm: (v: number) => void;
  goal: Goal; setGoal: (v: Goal) => void;
  diet: Diet; setDiet: (v: Diet) => void;
  activity: number; mealsPerDay: 3 | 4 | 5;
  weightKg: number; bodyFatPct: number; muscleKg: number; setWeightKg: (v: number) => void;
  scans: ScanRec[]; addScan: (s: ScanRec) => void;
  weightSeries: Series[]; bodyFatSeries: Series[]; muscleSeries: Series[];
}
const Ctx = createContext<Value | null>(null);

export function ClientDataProvider({ children }: { children: ReactNode }) {
  const base = MOCK_CLIENT;
  const [dob, setDob] = useState(base.dob);
  const [photo, setPhoto] = useState<string | null>(null);
  const [heightCm, setHeightCm] = useState(base.heightCm);
  const [goal, setGoal] = useState<Goal>(base.goal);
  const [diet, setDiet] = useState<Diet>(base.diet);
  const [scans, setScans] = useState<ScanRec[]>(base.scans.map((s) => ({ id: s.id, takenAt: s.takenAt, weightKg: s.weightKg, bodyFatPct: s.bodyFatPct, skeletalMuscleKg: s.skeletalMuscleKg, source: s.source })));
  const [manualWeight, setManualWeight] = useState<number | null>(null);

  const sorted = useMemo(() => [...scans].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt)), [scans]);
  const latest = sorted[sorted.length - 1];
  const weightKg = manualWeight != null ? manualWeight : latest.weightKg;

  const value: Value = {
    id: base.id, name: base.name, init: base.name.split(' ').map((x) => x[0]).join(''),
    dob, setDob, photo, setPhoto, heightCm, setHeightCm,
    goal, setGoal, diet, setDiet,
    activity: base.activity, mealsPerDay: base.mealsPerDay as 3 | 4 | 5,
    weightKg, bodyFatPct: latest.bodyFatPct, muscleKg: latest.skeletalMuscleKg, setWeightKg: (v) => setManualWeight(v),
    scans: sorted, addScan: (s) => { setScans((p) => [...p, s]); setManualWeight(null); },
    weightSeries: sorted.map((s) => ({ t: s.takenAt, v: s.weightKg })),
    bodyFatSeries: sorted.map((s) => ({ t: s.takenAt, v: s.bodyFatPct })),
    muscleSeries: sorted.map((s) => ({ t: s.takenAt, v: s.skeletalMuscleKg })),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useClientData(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error('useClientData must be used inside <ClientDataProvider>');
  return v;
}
