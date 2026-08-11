// Shared client data — one source of truth so a saved scan updates weight,
// body-fat, muscle, charts, and meal targets across every screen. Name, goal,
// diet, height, weight and body-fat are editable live and PERSISTED to the
// device (AsyncStorage), so your own stats survive relaunch. Swap for Supabase
// in the data migration.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ScanMetrics } from '../lib/inbodyMetrics';
import { MOCK_CLIENT } from '../lib/mockData';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { Goal, Diet } from '../lib/types';
import type { Allergen } from '../lib/meals';
import type { Injury } from '../lib/injuries';

export type CoachingMode = 'online' | 'inperson' | 'solo';
export interface ScanRec { id: string; takenAt: string; weightKg: number; bodyFatPct: number; skeletalMuscleKg: number; source: string; image?: string; metrics?: ScanMetrics }
interface Series { t: string; v: number }
interface Value {
  id: string; name: string; init: string; setName: (v: string) => void;
  dob: string; setDob: (v: string) => void;
  photo: string | null; setPhoto: (v: string | null) => void;
  heightCm: number; setHeightCm: (v: number) => void;
  goal: Goal; setGoal: (v: Goal) => void;
  coachingMode: CoachingMode; setCoachingMode: (v: CoachingMode) => void;
  diet: Diet; setDiet: (v: Diet) => void;
  avoid: Allergen[]; setAvoid: (v: Allergen[]) => void;
  injuries: Injury[]; addInjury: (v: Injury) => void; updateInjury: (id: string, patch: Partial<Injury>) => void; removeInjury: (id: string) => void;
  focusAreas: string[]; setFocusAreas: (v: string[]) => void;
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
  // NO mock data — always start empty. Real data loads from Supabase if user is authenticated.
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [heightCm, setHeightCm] = useState(170);
  const [goal, setGoal] = useState<Goal>('muscle');
  const [coachingMode, setCoachingMode] = useState<CoachingMode>('online');
  const [diet, setDiet] = useState<Diet>('balanced');
  const [avoid, setAvoid] = useState<Allergen[]>([]);
  const [injuries, setInjuries] = useState<Injury[]>([]);
  const [focusAreas, setFocusAreas] = useState<string[]>([]);
  const [scans, setScans] = useState<ScanRec[]>([]);
  const [scanMetrics, setScanMetrics] = useState<Record<string, ScanMetrics>>({});
  const [manualWeight, setManualWeight] = useState<number | null>(null);
  const [manualBodyFat, setManualBodyFat] = useState<number | null>(null);
  const [manualAt, setManualAt] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [sbUid, setSbUid] = useState<string | null>(null);
  const [nameSynced, setNameSynced] = useState(false);

  // Load the user's saved profile on first mount.
  useEffect(() => { (async () => {
    try {
      if (USE_SUPABASE) {
        await AsyncStorage.removeItem(KEY);
      } else {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) {
          const p = JSON.parse(raw);
          if (typeof p.name === 'string' && p.name) setName(p.name);
          if (typeof p.dob === 'string' && p.dob) setDob(p.dob);
          if (typeof p.heightCm === 'number') setHeightCm(p.heightCm);
          if (typeof p.goal === 'string') setGoal(p.goal);
          if (p.coachingMode === 'online' || p.coachingMode === 'inperson' || p.coachingMode === 'solo') setCoachingMode(p.coachingMode);
          if (typeof p.diet === 'string') setDiet(p.diet);
          if (Array.isArray(p.avoid)) setAvoid(p.avoid);
          if (Array.isArray(p.injuries)) setInjuries(p.injuries);
          if (Array.isArray(p.focusAreas)) setFocusAreas(p.focusAreas);
          if (typeof p.weightKg === 'number') setManualWeight(p.weightKg);
          if (typeof p.bodyFatPct === 'number') setManualBodyFat(p.bodyFatPct);
          if (typeof p.manualAt === 'string') setManualAt(p.manualAt);
          if (typeof p.photo === 'string') setPhoto(p.photo);
        }
      }
    } catch {}
    setHydrated(true);
  })(); }, []);

  // Persist edits once hydrated (avoids clobbering saved data with defaults on boot).
  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(KEY, JSON.stringify({ name, dob, heightCm, goal, diet, avoid, injuries, focusAreas, coachingMode, weightKg: manualWeight, bodyFatPct: manualBodyFat, manualAt, photo })).catch(() => {});
  }, [hydrated, name, dob, heightCm, goal, diet, avoid, injuries, focusAreas, coachingMode, manualWeight, manualBodyFat, manualAt, photo]);

  // Pull the real signed-in user's name from the server BEFORE any push below is
  // allowed to run. This guards against a stale/cross-account name that was
  // cached locally on a shared/reused device (e.g. from a previous tester's
  // session) getting pushed up and overwriting a different real user's correct
  // profile name. Runs once per uid; resets if the signed-in uid changes.
  useEffect(() => {
    if (!USE_SUPABASE || !sbUid) return;
    let cancelled = false;
    setNameSynced(false);
    (async () => {
      try {
        const { data, error } = await supabase.from('profiles').select('full_name').eq('id', sbUid).single();
        if (!cancelled && !error && typeof data?.full_name === 'string' && data.full_name.trim()) {
          setName(data.full_name.trim());
        }
      } catch { /* keep whatever we have */ }
      if (!cancelled) setNameSynced(true);
    })();
    return () => { cancelled = true; };
  }, [sbUid]);

  // Publish identity + goal to the shared backend so a LINKED trainer sees the real
  // client (name/goal) instead of a placeholder. Best-effort & additive: it only
  // updates existing rows (no-ops when the client isn't linked to a trainer yet),
  // never clobbers how the client reads their own local data. Gated on nameSynced
  // so this can never fire with a name that hasn't been reconciled against the
  // signed-in user's real server-side profile first.
  useEffect(() => {
    if (!USE_SUPABASE || !sbUid || !hydrated || !nameSynced) return;
    try {
      supabase.from('profiles').update({ full_name: name }).eq('id', sbUid).then(() => {}, () => {});
      supabase.from('clients').update({ goal }).eq('id', sbUid).then(() => {}, () => {});
      supabase.from('clients').update({ diet, meals_per_day: 3, avoid }).eq('id', sbUid).then(() => {}, () => {});
    } catch { /* ignore */ }
  }, [name, goal, diet, avoid, sbUid, hydrated, nameSynced]);

  // Load locally-cached InBody composition metrics (keyed by scan date).
  useEffect(() => { (async () => { try { const raw = await AsyncStorage.getItem('repple.scanMetrics'); if (raw) setScanMetrics(JSON.parse(raw)); } catch { /* ignore */ } })(); }, []);
  // Sync body scans with Supabase (per user) — hydrate-or-seed, defensive.
  // Also re-runs on every auth state change (not just once at mount) — if the
  // Supabase session hasn't finished restoring yet at the exact moment this
  // effect first ran (common on a cold app launch), sbUid was never set and
  // never retried, silently leaving the user on empty/mock data. This mirrors
  // the same fix applied to coachProfile.tsx for the identical race.
  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    const loadForUser = async (id: string) => {
      setSbUid(id);
      try {
        const { data, error } = await supabase.from('scans').select('*').eq('client_id', id).order('taken_at', { ascending: true });
        if (error || cancelled) return;
        // Only ever show the user's own real scans — never seed demo scans into a live account.
        setScans((data || []).map((r: any) => ({ id: r.id, takenAt: r.taken_at, weightKg: Number(r.weight_kg), bodyFatPct: Number(r.body_fat_pct), skeletalMuscleKg: r.skeletal_muscle_kg != null ? Number(r.skeletal_muscle_kg) : 0, source: r.source ?? '', metrics: r.metrics ?? undefined })));
      } catch { /* stay on mock */ }
    };
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const id = auth?.user?.id;
        if (id && !cancelled) await loadForUser(id);
      } catch { /* stay on mock */ }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (cancelled) return;
      const id = session?.user?.id;
      if (id) loadForUser(id);
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  const sorted = useMemo(() => {
    const byDay: Record<string, ScanRec> = {};
    for (const s of scans) byDay[s.takenAt.slice(0, 10)] = s; // one InBody scan per day, latest added wins
    return Object.values(byDay).sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt)).map((s) => (s.metrics ? s : (scanMetrics[s.takenAt.slice(0, 10)] ? { ...s, metrics: scanMetrics[s.takenAt.slice(0, 10)] } : s)));
  }, [scans, scanMetrics]);
  const latest = sorted[sorted.length - 1] ?? { id: 'none', takenAt: new Date(0).toISOString(), weightKg: manualWeight ?? 70, bodyFatPct: manualBodyFat ?? 20, skeletalMuscleKg: 0, source: '' };
  // Single source of truth: the most RECENT of {manual edit, latest scan} wins.
  const manualIsCurrent = manualAt != null && Date.parse(manualAt) >= Date.parse(latest.takenAt);
  const weightKg = (manualWeight != null && manualIsCurrent) ? manualWeight : latest.weightKg;
  const bodyFatPct = (manualBodyFat != null && manualIsCurrent) ? manualBodyFat : latest.bodyFatPct;

  const value: Value = {
    id: sbUid ?? 'unknown', name, init: initials(name), setName,
    dob, setDob, photo, setPhoto, heightCm, setHeightCm,
    goal, setGoal, diet, setDiet, avoid, setAvoid,
    injuries,
    focusAreas, setFocusAreas,
    addInjury: (v) => setInjuries((p) => [v, ...p]),
    updateInjury: (id, patch) => setInjuries((p) => p.map((i) => (i.id === id ? { ...i, ...patch } : i))),
    removeInjury: (id) => setInjuries((p) => p.filter((i) => i.id !== id)),
    coachingMode, setCoachingMode,
    activity: 1.5, mealsPerDay: 3 as 3 | 4 | 5,
    weightKg, bodyFatPct, muscleKg: latest.skeletalMuscleKg,
    setWeightKg: (v) => { setManualWeight(v); setManualAt(new Date().toISOString()); }, setBodyFat: (v) => { setManualBodyFat(v); setManualAt(new Date().toISOString()); },
    scans: sorted, addScan: (s) => { setScans((p) => [...p, s]); if (s.metrics && Object.values(s.metrics).some((v) => v != null)) { setScanMetrics((prev) => { const nm = { ...prev, [s.takenAt.slice(0, 10)]: s.metrics! }; AsyncStorage.setItem('repple.scanMetrics', JSON.stringify(nm)).catch(() => {}); return nm; }); } setManualWeight(null); setManualBodyFat(null); if (USE_SUPABASE && sbUid) { try { supabase.from('scans').insert({ client_id: sbUid, taken_at: String(s.takenAt).slice(0, 10), weight_kg: s.weightKg, body_fat_pct: s.bodyFatPct, skeletal_muscle_kg: s.skeletalMuscleKg, source: s.source }).select('id').single().then((res: any) => { const rid = res && res.data && res.data.id; if (rid && s.metrics && Object.values(s.metrics).some((v) => v != null)) { supabase.from('scans').update({ metrics: s.metrics }).eq('id', rid).then(() => {}, () => {}); } }, () => {}); } catch { /* ignore */ } } },
    weightSeries: [...sorted.map((s) => ({ t: s.takenAt, v: s.weightKg })), ...(manualIsCurrent && manualWeight != null ? [{ t: manualAt as string, v: manualWeight }] : [])],
    bodyFatSeries: [...sorted.map((s) => ({ t: s.takenAt, v: s.bodyFatPct })), ...(manualIsCurrent && manualBodyFat != null ? [{ t: manualAt as string, v: manualBodyFat }] : [])],
    muscleSeries: sorted.map((s) => ({ t: s.takenAt, v: s.skeletalMuscleKg })),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useClientData(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error('useClientData must be used inside <ClientDataProvider>');
  return v;
}
