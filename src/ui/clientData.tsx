// Shared client data — one source of truth so a saved scan updates weight,
// body-fat, muscle, charts, and meal targets across every screen. Name, goal,
// diet, height, weight and body-fat are editable live and PERSISTED to the
// device (AsyncStorage), so your own stats survive relaunch. Swap for Supabase
// in the data migration.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ScanMetrics } from '../lib/inbodyMetrics';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { Goal, Diet } from '../lib/types';
import type { Allergen } from '../lib/meals';
import type { Injury } from '../lib/injuries';
import { reportError } from '../lib/reportError';

export type CoachingMode = 'online' | 'inperson' | 'solo';
export interface ScanRec { id: string; takenAt: string; weightKg: number; bodyFatPct: number; skeletalMuscleKg: number; source: string; image?: string; metrics?: ScanMetrics }
interface Series { t: string; v: number }
interface Value {
  id: string; name: string; init: string; setName: (v: string) => void;
  dob: string; setDob: (v: string) => void;
  photo: string | null; setPhoto: (v: string | null) => void;
  /** null until the client tells us. Defaulted to 170 and rendered on their
   *  profile as their own height. */
  heightCm: number | null; setHeightCm: (v: number) => void;
  goal: Goal; setGoal: (v: Goal) => void;
  coachingMode: CoachingMode; setCoachingMode: (v: CoachingMode) => void;
  diet: Diet; setDiet: (v: Diet) => void;
  avoid: Allergen[]; setAvoid: (v: Allergen[]) => void;
  injuries: Injury[]; addInjury: (v: Injury) => void; updateInjury: (id: string, patch: Partial<Injury>) => void; removeInjury: (id: string) => void;
  focusAreas: string[]; setFocusAreas: (v: string[]) => void;
  activity: number;
  mealsPerDay: 3 | 4 | 5; setMealsPerDay: (v: 3 | 4 | 5) => void;
  /** null until there is a scan or a manual entry. These used to fall back to
   *  70 kg / 20% / 0 kg, which the dashboard, profile, scans, report, standards
   *  and the macro calculator all rendered and computed against as though the
   *  client had been measured. */
  weightKg: number | null; bodyFatPct: number | null; muscleKg: number | null;
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
  const [heightCm, setHeightCm] = useState<number | null>(null);
  const [goal, setGoal] = useState<Goal>('muscle');
  const [coachingMode, setCoachingMode] = useState<CoachingMode>('online');
  const [diet, setDiet] = useState<Diet>('meat');
  const [avoid, setAvoid] = useState<Allergen[]>([]);
  const [injuries, setInjuries] = useState<Injury[]>([]);
  const [focusAreas, setFocusAreas] = useState<string[]>([]);
  const [mealsPerDay, setMealsPerDay] = useState<3 | 4 | 5>(3);
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
          if (p.mealsPerDay === 3 || p.mealsPerDay === 4 || p.mealsPerDay === 5) setMealsPerDay(p.mealsPerDay);
        }
      }
    } catch {}
    setHydrated(true);
  })(); }, []);

  // Persist edits once hydrated (avoids clobbering saved data with defaults on boot).
  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(KEY, JSON.stringify({ name, dob, heightCm, goal, diet, avoid, injuries, focusAreas, coachingMode, mealsPerDay, weightKg: manualWeight, bodyFatPct: manualBodyFat, manualAt, photo })).catch(() => {});
  }, [hydrated, name, dob, heightCm, goal, diet, avoid, injuries, focusAreas, coachingMode, mealsPerDay, manualWeight, manualBodyFat, manualAt, photo]);

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
        const { data, error } = await supabase.from('profiles').select('full_name, avatar').eq('id', sbUid).single();
        if (!cancelled && !error) {
          if (typeof data?.full_name === 'string' && data.full_name.trim()) setName(data.full_name.trim());
          if (typeof data?.avatar === 'string' && data.avatar) setPhoto(data.avatar);
        }
      } catch (e) { reportError('clientData.hydrate.profiles', e); }

      // Read the rest of the profile back BEFORE the push effect below is allowed
      // to run. Without this the local state is still at its defaults (the local
      // cache is cleared on launch when USE_SUPABASE is on), and the push would
      // overwrite the user's real goal/diet/allergens on the server with those
      // defaults on every single app launch.
      try {
        const { data: c, error: cErr } = await supabase
          .from('clients')
          .select('dob, height_cm, goal, diet, avoid, mode, injuries, focus_areas, manual_weight_kg, manual_body_fat_pct, manual_at, meals_per_day')
          .eq('id', sbUid).single();
        if (!cancelled && !cErr && c) {
          const r = c as any;
          if (typeof r.dob === 'string' && r.dob) setDob(r.dob);
          if (r.height_cm != null && !Number.isNaN(Number(r.height_cm))) setHeightCm(Number(r.height_cm));
          if (typeof r.goal === 'string' && r.goal) setGoal(r.goal as Goal);
          if (typeof r.diet === 'string' && r.diet) setDiet(r.diet as Diet);
          if (Array.isArray(r.avoid)) setAvoid(r.avoid);
          if (r.mode === 'online' || r.mode === 'inperson' || r.mode === 'solo') setCoachingMode(r.mode);
          if (Array.isArray(r.injuries)) setInjuries(r.injuries);
          if (Array.isArray(r.focus_areas)) setFocusAreas(r.focus_areas);
          if (r.manual_weight_kg != null && !Number.isNaN(Number(r.manual_weight_kg))) setManualWeight(Number(r.manual_weight_kg));
          if (r.manual_body_fat_pct != null && !Number.isNaN(Number(r.manual_body_fat_pct))) setManualBodyFat(Number(r.manual_body_fat_pct));
          if (typeof r.manual_at === 'string' && r.manual_at) setManualAt(r.manual_at);
          if (r.meals_per_day === 3 || r.meals_per_day === 4 || r.meals_per_day === 5) setMealsPerDay(r.meals_per_day);
        }
      } catch (e) { reportError('clientData.hydrate.clients', e); }

      if (!cancelled) setNameSynced(true);
    })();
    return () => { cancelled = true; };
  }, [sbUid]);

  // Publish the profile to the shared backend: it is the durable store (the local
  // cache is cleared on launch when USE_SUPABASE is on) and a LINKED trainer reads
  // it to see the real client instead of a placeholder. Update-only, so it no-ops
  // rather than inventing rows. Gated on nameSynced, which is now set only after
  // BOTH the profiles and clients rows have been read back — otherwise this fires
  // while state is still at its defaults and overwrites the user's real settings.
  // Debounced so typing doesn't fire a write per keystroke; one round-trip per table.
  useEffect(() => {
    if (!USE_SUPABASE || !sbUid || !hydrated || !nameSynced) return;
    const timer = setTimeout(() => {
      try {
        supabase.from('profiles').update({ full_name: name, avatar: photo }).eq('id', sbUid).then(() => {}, () => {});
        supabase.from('clients').update({
          dob: dob || null,
          height_cm: heightCm,
          goal, diet, avoid,
          meals_per_day: mealsPerDay,
          mode: coachingMode,
          injuries,
          focus_areas: focusAreas,
          manual_weight_kg: manualWeight ?? null,
          manual_body_fat_pct: manualBodyFat ?? null,
          manual_at: manualAt || null,
        }).eq('id', sbUid).then(() => {}, () => {});
      } catch { /* ignore */ }
    }, 600);
    return () => clearTimeout(timer);
  }, [name, photo, dob, heightCm, goal, diet, avoid, mealsPerDay, coachingMode, injuries, focusAreas, manualWeight, manualBodyFat, manualAt, sbUid, hydrated, nameSynced]);

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
  // No placeholder body. When there is no scan, weight/body fat come from a
  // manual entry if there is one and are null otherwise - callers decide what
  // to show. The old fallback object handed out 70 kg and 20% body fat, and
  // every downstream calculation treated them as measurements.
  const latest = sorted[sorted.length - 1] ?? null;
  // Single source of truth: the most RECENT of {manual edit, latest scan} wins.
  const manualIsCurrent = manualAt != null && (latest == null || Date.parse(manualAt) >= Date.parse(latest.takenAt));
  const weightKg = (manualWeight != null && manualIsCurrent) ? manualWeight : (latest ? latest.weightKg : null);
  const bodyFatPct = (manualBodyFat != null && manualIsCurrent) ? manualBodyFat : (latest ? latest.bodyFatPct : null);

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
    activity: 1.5, mealsPerDay, setMealsPerDay,
    weightKg, bodyFatPct, muscleKg: latest ? latest.skeletalMuscleKg : null,
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
