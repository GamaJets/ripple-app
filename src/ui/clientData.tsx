// Shared client data — one source of truth so a saved scan updates weight,
// body-fat, muscle, charts, and meal targets across every screen. Name, goal,
// diet, height, weight and body-fat are editable live and PERSISTED to the
// device (AsyncStorage), so your own stats survive relaunch. Swap for Supabase
// in the data migration.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MOCK_CLIENT } from '../lib/mockData';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { Goal, Diet } from '../lib/types';

export type CoachingMode = 'online' | 'inperson' | 'solo';
export interface ScanRec { id: string; takenAt: string; weightKg: number; bodyFatPct: number; skeletalMuscleKg: number; source: string; image?: string }
interface Series { t: string; v: number }
interface Value {
  id: string; name: string; init: string; setName: (v: string) => void;
  dob: string; setDob: (v: string) => void;
  photo: string | null; setPhoto: (v: string | null) => void;
  heightCm: number; setHeightCm: (v: number) => void;
  goal: Goal; setGoal: (v: Goal) => void;
  coachingMode: CoachingMode; setCoachingMode: (v: CoachingMode) => void;
  diet: Diet; setDiet: (v: Diet) => void;
  activity: number; mealsPerDay: 3 | 4 | 5;
  weightKg: number; bodyFatPct: number; muscleKg: number;
  setWeightKg: (v: number) => void; setBodyFat: (v: number) => void;
  scans: ScanRec[]; addScan: (s: ScanRec) => void;
  weightSeries: Series[]; bodyFatSeries: Series[]; muscleSeries: Series[];
}
const Ctx = createContext<Value | null>(null);
const KEY = 'repple.profile';

const initials = (n: string) => n.trim().split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase() || 'Y';

export function ClientDataProvider({ children }: { children: ReactNode }) {
  const base = MOCK_CLIENT;
  const [name, setName] = useState(base.name);
  const [dob, setDob] = useState(base.dob);
  const [photo, setPhoto] = useState<string | null>(null);
  const [heightCm, setHeightCm] = useState(base.heightCm);
  const [goal, setGoal] = useState<Goal>(base.goal);
  const [coachingMode, setCoachingMode] = useState<CoachingMode>('online');
  const [diet, setDiet] = useState<Diet>(base.diet);
  const [scans, setScans] = useState<ScanRec[]>(base.scans.map((s) => ({ id: s.id, takenAt: s.takenAt, weightKg: s.weightKg, bodyFatPct: s.bodyFatPct, skeletalMuscleKg: s.skeletalMuscleKg, source: s.source })));
  const [manualWeight, setManualWeight] = useState<number | null>(null);
  const [manualBodyFat, setManualBodyFat] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [sbUid, setSbUid] = useState<string | null>(null);

  // Load the user's saved profile on first mount.
  useEffect(() => { (async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p.name === 'string' && p.name) setName(p.name);
        if (typeof p.dob === 'string' && p.dob) setDob(p.dob);
        if (typeof p.heightCm === 'number') setHeightCm(p.heightCm);
        if (typeof p.goal === 'string') setGoal(p.goal);
        if (p.coachingMode === 'online' || p.coachingMode === 'inperson' || p.coachingMode === 'solo') setCoachingMode(p.coachingMode);
        if (typeof p.diet === 'string') setDiet(p.diet);
        if (typeof p.weightKg === 'number') setManualWeight(p.weightKg);
        if (typeof p.bodyFatPct === 'number') setManualBodyFat(p.bodyFatPct);
        if (typeof p.photo === 'string') setPhoto(p.photo);
      }
    } catch {}
    setHydrated(true);
  })(); }, []);

  // Persist edits once hydrated (avoids clobbering saved data with defaults on boot).
  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(KEY, JSON.stringify({ name, dob, heightCm, goal, diet, coachingMode, weightKg: manualWeight, bodyFatPct: manualBodyFat, photo })).catch(() => {});
  }, [hydrated, name, dob, heightCm, goal, diet, coachingMode, manualWeight, manualBodyFat, photo]);

  // Sync body scans with Supabase (per user) — hydrate-or-seed, defensive.
  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const id = auth?.user?.id; if (!id || cancelled) return; setSbUid(id);
        const { data, error } = await supabase.from('scans').select('*').eq('client_id', id).order('taken_at', { ascending: true });
        if (error || cancelled) return;
        if (data && data.length) {
          setScans(data.map((r: any) => ({ id: r.id, takenAt: r.taken_at, weightKg: Number(r.weight_kg), bodyFatPct: Number(r.body_fat_pct), skeletalMuscleKg: r.skeletal_muscle_kg != null ? Number(r.skeletal_muscle_kg) : 0, source: r.source ?? '' })));
        } else {
          await supabase.from('scans').insert(base.scans.map((sc) => ({ client_id: id, taken_at: String(sc.takenAt).slice(0, 10), weight_kg: sc.weightKg, body_fat_pct: sc.bodyFatPct, skeletal_muscle_kg: sc.skeletalMuscleKg, source: sc.source })));
        }
      } catch { /* stay on mock */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const sorted = useMemo(() => [...scans].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt)), [scans]);
  const latest = sorted[sorted.length - 1];
  const weightKg = manualWeight != null ? manualWeight : latest.weightKg;
  const bodyFatPct = manualBodyFat != null ? manualBodyFat : latest.bodyFatPct;

  const value: Value = {
    id: base.id, name, init: initials(name), setName,
    dob, setDob, photo, setPhoto, heightCm, setHeightCm,
    goal, setGoal, diet, setDiet,
    coachingMode, setCoachingMode,
    activity: base.activity, mealsPerDay: base.mealsPerDay as 3 | 4 | 5,
    weightKg, bodyFatPct, muscleKg: latest.skeletalMuscleKg,
    setWeightKg: (v) => setManualWeight(v), setBodyFat: (v) => setManualBodyFat(v),
    scans: sorted, addScan: (s) => { setScans((p) => [...p, s]); setManualWeight(null); setManualBodyFat(null); if (USE_SUPABASE && sbUid) { try { supabase.from('scans').insert({ client_id: sbUid, taken_at: String(s.takenAt).slice(0, 10), weight_kg: s.weightKg, body_fat_pct: s.bodyFatPct, skeletal_muscle_kg: s.skeletalMuscleKg, source: s.source }).then(() => {}, () => {}); } catch { /* ignore */ } } },
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
