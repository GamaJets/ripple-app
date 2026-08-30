// Shared client data — one source of truth so a saved scan updates weight,
// body-fat, muscle, charts, and meal targets across every screen. Name, goal,
// diet, height, weight and body-fat are editable live and PERSISTED to the
// device (AsyncStorage), so your own stats survive relaunch. Swap for Supabase
// in the data migration.
//
// ── Three failures this provider could not report ──────────────────────────
//
// When USE_SUPABASE is on, the local cache is DELETED on launch (see the first
// effect) and the server becomes the only copy of the client's profile. That
// makes every silent failure here permanent rather than temporary:
//
//   · the profiles/clients reads land in `reportError` and then return, leaving
//     name, goal, diet, allergens and injuries at their constructed defaults.
//     A vegetarian with a nut allergy is shown, and fed meal plans, as a
//     meat-eating client with no allergens — the defaults are plausible enough
//     that nothing looks broken.
//   · the scans read returns early on error, leaving `scans: []`. weightKg,
//     bodyFatPct and muscleKg then go null and every screen says the client has
//     never been measured. The charts show nothing to a client with a year of
//     scans.
//   · the debounced push back to the server is fire-and-forget:
//     `.then(() => {}, () => {})` on both tables, with `error` never read. A
//     profile edit the server refuses is kept on screen, is not in the cache
//     (it was deleted at launch), and is gone at the next relaunch.
//
// `status`, `scansStatus` and `saveFailed` make each of those visible. The
// values themselves are unchanged: nothing here starts guessing.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ScanMetrics } from '../lib/inbodyMetrics';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { readCoachingMode, type CoachingMode, type Goal, type Diet } from '../lib/types';
import type { Allergen } from '../lib/meals';
import type { Injury } from '../lib/injuries';
import { reportError } from '../lib/reportError';
import { worstStatus, type LoadStatus } from './loadStatus';
import { capLimit, capped } from '../lib/rowCap';

// Declared in src/lib/types.ts alongside the labels and the two predicates the
// screens branch on; re-exported because every client screen imports it from
// here and the shape of the union is not this provider's to own.
export type { CoachingMode };
// `skeletalMuscleKg` is null when the scan did not report one — see the note on
// `Scan` in src/lib/types.ts. It is not `| undefined`: the difference between
// "this scan measured no muscle" and "this object has not been filled in" is
// one the screens need, and a missing key reads as the second.
export interface ScanRec { id: string; takenAt: string; weightKg: number; bodyFatPct: number; skeletalMuscleKg: number | null; source: string; image?: string; metrics?: ScanMetrics }
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
  /** Whether a coach is actually LINKED, which is a different question from
   *  `coachingMode` — that is what the client said they wanted, this is whether
   *  anybody is coaching them. Screens kept conflating the two: the home screen
   *  offered "Work with a coach" only to people whose mode was 'solo', so
   *  somebody who chose online coaching and had not found a coach yet was shown
   *  no way to find one anywhere on it.
   *
   *  null means unread, never "no coach" — under a failed read a screen should
   *  offer the way in rather than hide it, because hiding it is the failure
   *  being fixed and showing it to somebody already coached costs them a tap. */
  coachLinked: boolean | null;
  diet: Diet; setDiet: (v: Diet) => void;
  avoid: Allergen[]; setAvoid: (v: Allergen[]) => void;
  injuries: Injury[]; addInjury: (v: Injury) => void; updateInjury: (id: string, patch: Partial<Injury>) => void; removeInjury: (id: string) => void;
  focusAreas: string[]; setFocusAreas: (v: string[]) => void;
  activity: number;
  mealsPerDay: 3 | 4 | 5; setMealsPerDay: (v: 3 | 4 | 5) => void;
  /** Daily step, nightly sleep and daily water targets. null means the client
   *  has not set one, and it stays null: the checklist renders no row rather
   *  than one built on a figure nobody chose, which is what "10,000 steps" was
   *  for everybody — and "8 glasses", which outlived the other two because it
   *  was a lone constant in the habits provider rather than a line in the seed
   *  list. Pass null to any setter to clear it.
   *
   *  Water is read further than the other two: the checklist states it, the
   *  Recovery hero draws an arc against it and readinessScore divides by it, so
   *  a null has to survive all the way out to those screens rather than being
   *  softened into a number on the way. */
  stepGoal: number | null; setStepGoal: (v: number | null) => void;
  sleepGoalHours: number | null; setSleepGoalHours: (v: number | null) => void;
  waterGoalGlasses: number | null; setWaterGoalGlasses: (v: number | null) => void;
  /** null until there is a scan or a manual entry. These used to fall back to
   *  70 kg / 20% / 0 kg, which the dashboard, profile, scans, report, standards
   *  and the macro calculator all rendered and computed against as though the
   *  client had been measured. */
  weightKg: number | null; bodyFatPct: number | null; muscleKg: number | null;
  setWeightKg: (v: number) => void; setBodyFat: (v: number) => void;
  scans: ScanRec[];
  /** Resolves true only once the scan row is on the server. False means the
   *  scan is on this phone for this session and will be gone at relaunch — the
   *  local cache is cleared on launch when the backend is on. */
  addScan: (s: ScanRec) => Promise<boolean>;
  weightSeries: Series[]; bodyFatSeries: Series[]; muscleSeries: Series[];
  /** Whether the signed-in user's profile AND scans were both read from the
   *  server. Under 'error' the fields above are defaults and nulls that were
   *  never confirmed — a screen must not present them as the client's answers. */
  status: LoadStatus;
  /** Whether `scans` is the server's answer specifically. Under 'error' an
   *  empty `scans` (and the null weight/body-fat/muscle that follow from it)
   *  means unknown, not "never measured". */
  scansStatus: LoadStatus;
  /** Whether the profile read succeeded — name, dob, height, goal, diet,
   *  allergens, injuries, focus areas, meals per day. */
  profileStatus: LoadStatus;
  /** True when the last push of the profile to the server was refused or could
   *  not be sent. The edit is on screen but not stored anywhere durable, and
   *  the local cache is cleared on launch, so it will be lost. */
  saveFailed: boolean;
}
const Ctx = createContext<Value | null>(null);
const KEY = 'repple.profile';
// The client's own answer to how they are coached, on this device.
//
// `clients.mode` holds all four answers since part 57 widened it, so this is no
// longer where 'hybrid' and 'solo' live — the column is. What it still does is
// carry the answers stored on devices during the period when the column could
// not take them: those clients have a truthful 'hybrid' or 'solo' here and a
// narrowed one on the server, and the hydrate below promotes the fuller answer
// once rather than reconciling it on every launch forever.
//
// It is deliberately NOT part of the `repple.profile` blob: that blob is
// deleted on every launch when the backend is on, and a value wiped before it
// is read is decoration.
//
// It never overrides the server, it only fills in what the server cannot say —
// and only where the server does not contradict it.
const MODE_KEY = 'repple.coachingMode';

// No name yet means no initial. The old fallback was a hardcoded 'Y' — a
// letter belonging to nobody, shown in the avatar of every user whose name
// had not loaded, which was everyone while the profiles read was failing.
const initials = (n: string) => n.trim().split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();

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
  const [coachLinked, setCoachLinked] = useState<boolean | null>(null);
  const [stepGoal, setStepGoal] = useState<number | null>(null);
  const [sleepGoalHours, setSleepGoalHours] = useState<number | null>(null);
  const [waterGoalGlasses, setWaterGoalGlasses] = useState<number | null>(null);
  const [scans, setScans] = useState<ScanRec[]>([]);
  const [scanMetrics, setScanMetrics] = useState<Record<string, ScanMetrics>>({});
  const [manualWeight, setManualWeight] = useState<number | null>(null);
  const [manualBodyFat, setManualBodyFat] = useState<number | null>(null);
  const [manualAt, setManualAt] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [sbUid, setSbUid] = useState<string | null>(null);
  const [nameSynced, setNameSynced] = useState(false);
  const [profileStatus, setProfileStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [scansStatus, setScansStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [saveFailed, setSaveFailed] = useState(false);

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
          setCoachingMode(readCoachingMode(p.coachingMode));
          if (typeof p.diet === 'string') setDiet(p.diet);
          if (Array.isArray(p.avoid)) setAvoid(p.avoid);
          if (Array.isArray(p.injuries)) setInjuries(p.injuries);
          if (Array.isArray(p.focusAreas)) setFocusAreas(p.focusAreas);
          if (typeof p.weightKg === 'number') setManualWeight(p.weightKg);
          if (typeof p.bodyFatPct === 'number') setManualBodyFat(p.bodyFatPct);
          if (typeof p.manualAt === 'string') setManualAt(p.manualAt);
          if (typeof p.photo === 'string') setPhoto(p.photo);
          if (p.mealsPerDay === 3 || p.mealsPerDay === 4 || p.mealsPerDay === 5) setMealsPerDay(p.mealsPerDay);
          if (typeof p.stepGoal === 'number') setStepGoal(p.stepGoal);
          if (typeof p.sleepGoalHours === 'number') setSleepGoalHours(p.sleepGoalHours);
          if (typeof p.waterGoalGlasses === 'number') setWaterGoalGlasses(p.waterGoalGlasses);
        }
      }
    } catch {}
    setHydrated(true);
  })(); }, []);

  // Persist edits once hydrated (avoids clobbering saved data with defaults on boot).
  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(KEY, JSON.stringify({ name, dob, heightCm, goal, diet, avoid, injuries, focusAreas, coachingMode, mealsPerDay, stepGoal, sleepGoalHours, waterGoalGlasses, weightKg: manualWeight, bodyFatPct: manualBodyFat, manualAt, photo })).catch(() => {});
  }, [hydrated, name, dob, heightCm, goal, diet, avoid, injuries, focusAreas, coachingMode, mealsPerDay, stepGoal, sleepGoalHours, waterGoalGlasses, manualWeight, manualBodyFat, manualAt, photo]);

  // Pull the real signed-in user's name from the server BEFORE any push below is
  // allowed to run. This guards against a stale/cross-account name that was
  // cached locally on a shared/reused device (e.g. from a previous tester's
  // session) getting pushed up and overwriting a different real user's correct
  // profile name. Runs once per uid; resets if the signed-in uid changes.
  useEffect(() => {
    if (!USE_SUPABASE || !sbUid) return;
    let cancelled = false;
    setNameSynced(false);
    setProfileStatus('loading');
    (async () => {
      // Either read failing means the profile on screen is partly or wholly
      // defaults. Tracked rather than swallowed, because the push effect below
      // is about to publish whatever is on screen back to the server.
      let failed = false;
      try {
        const { data, error } = await supabase.from('profiles').select('full_name, avatar').eq('id', sbUid).single();
        if (error) { reportError('clientData.hydrate.profiles', error); failed = true; }
        else if (!cancelled) {
          const fromProfile = typeof data?.full_name === 'string' ? data.full_name.trim() : '';
          if (fromProfile) setName(fromProfile);
          else {
            // The name signup collected, when the profiles row never received it.
            //
            // handle_new_user() copies raw_user_meta_data->>'full_name' into
            // profiles, but it ends `on conflict (id) do nothing`, and accounts
            // created before that trigger existed never got it at all. The home
            // screen greets people from profiles.full_name, so an account in
            // that state opened to "Good morning" and nothing after it — while
            // the name sat in the auth record the whole time. Reported exactly
            // that way.
            //
            // Read rather than assumed, and only used when the profile column
            // is genuinely blank: a name the client has since edited in the app
            // is theirs, and must not be reverted to whatever they typed at
            // signup. The push effect below persists whatever this sets, so the
            // gap closes permanently on the first launch after this ships.
            try {
              const { data: au } = await supabase.auth.getUser();
              const meta = au?.user?.user_metadata as Record<string, unknown> | undefined;
              const fromAuth = typeof meta?.full_name === 'string' ? meta.full_name.trim() : '';
              if (fromAuth && !cancelled) setName(fromAuth);
            } catch (e) {
              // no-error-ok: a name we could not recover leaves the greeting
              // without one, which is what it already did — never a failure
              // worth blocking the rest of the profile read for.
              reportError('clientData.hydrate.authName', e);
            }
          }
          if (typeof data?.avatar === 'string' && data.avatar) setPhoto(data.avatar);
        }
      } catch (e) { reportError('clientData.hydrate.profiles', e); failed = true; }

      // Read the rest of the profile back BEFORE the push effect below is allowed
      // to run. Without this the local state is still at its defaults (the local
      // cache is cleared on launch when USE_SUPABASE is on), and the push would
      // overwrite the user's real goal/diet/allergens on the server with those
      // defaults on every single app launch.
      try {
        const { data: c, error: cErr } = await supabase
          .from('clients')
          .select('dob, height_cm, goal, diet, avoid, mode, trainer_id, injuries, focus_areas, manual_weight_kg, manual_body_fat_pct, manual_at, meals_per_day, step_goal, sleep_goal_hours, water_goal_glasses')
          .eq('id', sbUid).single();
        if (cErr) { reportError('clientData.hydrate.clients', cErr); failed = true; }
        if (!cancelled && !cErr && c) {
          const r = c as any;
          if (typeof r.dob === 'string' && r.dob) setDob(r.dob);
          if (r.height_cm != null && !Number.isNaN(Number(r.height_cm))) setHeightCm(Number(r.height_cm));
          if (typeof r.goal === 'string' && r.goal) setGoal(r.goal as Goal);
          if (typeof r.diet === 'string' && r.diet) setDiet(r.diet as Diet);
          if (Array.isArray(r.avoid)) setAvoid(r.avoid);
          // Reconcile the server's two-value answer with the four-value one
          // the client actually gave (MODE_KEY above). The device is read
          // inline rather than from state because this effect is keyed on the
          // signed-in uid and can land before a separately-loaded flag has —
          // and a restore that loses that race reverts the setting silently,
          // which is the bug.
          // `trainer_id` is half of the coach link — the half `is_my_client`
          // reads, and the one end_coaching() clears — so it is the cheapest
          // true answer to "is anybody coaching me" and it is already in this
          // select.
          setCoachLinked(r.trainer_id != null);
          if (r.mode != null) {
            const stored = readCoachingMode(r.mode);
            const mine = readCoachingMode(await AsyncStorage.getItem(MODE_KEY).catch(() => null));
            const agreed =
              // 'hybrid' was written to the server as 'inperson'. Still true of
              // them while the server still says so; a coach who has since
              // moved them to online overrules it.
              mine === 'hybrid' && stored === 'inperson' ? 'hybrid'
              // 'solo' was not written at all — there was no truthful narrowing
              // for it — so the only corroboration available is that nobody is
              // coaching them. A linked trainer means the server is right and
              // this device is out of date.
              : mine === 'solo' && r.trainer_id == null ? 'solo'
              : stored;
            setCoachingMode(agreed);
            if (agreed !== mine) AsyncStorage.setItem(MODE_KEY, agreed).catch(() => {});
            // Promote it. The column can hold the fuller answer now, and until
            // it does this device is the only thing that knows: the coach's
            // roster and the console both read the server, so a hybrid client
            // reads as in-person to everybody but themselves, and a new phone
            // would silently take the narrowed value as the truth.
            if (agreed !== stored) {
              const { error: mErr } = await supabase.from('clients').update({ mode: agreed }).eq('id', sbUid);
              if (mErr) reportError('clientData.promoteMode', mErr);
            }
          }
          if (Array.isArray(r.injuries)) setInjuries(r.injuries);
          if (Array.isArray(r.focus_areas)) setFocusAreas(r.focus_areas);
          if (r.manual_weight_kg != null && !Number.isNaN(Number(r.manual_weight_kg))) setManualWeight(Number(r.manual_weight_kg));
          if (r.manual_body_fat_pct != null && !Number.isNaN(Number(r.manual_body_fat_pct))) setManualBodyFat(Number(r.manual_body_fat_pct));
          if (typeof r.manual_at === 'string' && r.manual_at) setManualAt(r.manual_at);
          if (r.meals_per_day === 3 || r.meals_per_day === 4 || r.meals_per_day === 5) setMealsPerDay(r.meals_per_day);
          // A null column is the client's real answer — "I have not set one" —
          // so it is assigned, not skipped. Skipping it would let a stale value
          // from the local cache survive a clearing on another device.
          setStepGoal(r.step_goal != null && Number.isFinite(Number(r.step_goal)) ? Number(r.step_goal) : null);
          setSleepGoalHours(r.sleep_goal_hours != null && Number.isFinite(Number(r.sleep_goal_hours)) ? Number(r.sleep_goal_hours) : null);
          setWaterGoalGlasses(r.water_goal_glasses != null && Number.isFinite(Number(r.water_goal_glasses)) ? Number(r.water_goal_glasses) : null);
        }
      } catch (e) { reportError('clientData.hydrate.clients', e); failed = true; }

      if (!cancelled) { setProfileStatus(failed ? 'error' : 'ready'); setNameSynced(true); }
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
      (async () => {
        // The full answer, kept in step with the narrowed one written below. It
        // lives here rather than in the local-cache effect because that one
        // fires as soon as the DEVICE has hydrated — before the server read has
        // come back — and would overwrite this with a default while the
        // reconcile above was still reading it. This effect is gated on
        // nameSynced, so both reads have already landed.
        try { await AsyncStorage.setItem(MODE_KEY, coachingMode); } catch { /* the mode still applies this session; only the restore across launches is lost */ }
        // Both results are now inspected. Refusing to look was what let a
        // client's edited goal, diet or allergen list disappear at the next
        // launch with the screen having said nothing.
        try {
          const [{ error: pErr }, { error: cErr }] = await Promise.all([
            supabase.from('profiles').update({ full_name: name, avatar: photo }).eq('id', sbUid),
            supabase.from('clients').update({
              dob: dob || null,
              height_cm: heightCm,
              goal, diet, avoid,
              meals_per_day: mealsPerDay,
              step_goal: stepGoal,
              sleep_goal_hours: sleepGoalHours,
              water_goal_glasses: waterGoalGlasses,
              // All four answers, whole. 'solo' used to be left out of this
              // update entirely: the constraint refused it, and that refusal
              // took the WHOLE row with it — one Postgres error and the name,
              // goal, diet, allergens and injuries on the screen were all
              // lost, reported as "nothing is updated".
              mode: coachingMode,
              injuries,
              focus_areas: focusAreas,
              manual_weight_kg: manualWeight ?? null,
              manual_body_fat_pct: manualBodyFat ?? null,
              manual_at: manualAt || null,
            }).eq('id', sbUid),
          ]);
          if (pErr) reportError('clientData.push.profiles', pErr);
          if (cErr) reportError('clientData.push.clients', cErr);
          setSaveFailed(!!(pErr || cErr));
        } catch (e) { reportError('clientData.push', e); setSaveFailed(true); }
      })();
    }, 600);
    return () => clearTimeout(timer);
  }, [name, photo, dob, heightCm, goal, diet, avoid, mealsPerDay, stepGoal, sleepGoalHours, waterGoalGlasses, coachingMode, injuries, focusAreas, manualWeight, manualBodyFat, manualAt, sbUid, hydrated, nameSynced]);

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
        // Read newest-first and turned back below, rather than the ascending
        // read this was. Ascending is what the charts want and descending is
        // which end to keep: a client who has scanned weekly for twenty years
        // has more than a thousand scans, and the ascending page would have been
        // their first twenty years and none of this one — a weight chart ending
        // in 2006 on a screen headed "your progress".
        const { data, error } = await supabase.from('scans').select('*')
          .eq('client_id', id).order('taken_at', { ascending: false }).order('id', { ascending: false }).limit(capLimit());
        if (cancelled) return;
        // `if (error || cancelled) return;` left scans at [] and therefore
        // weight, body fat and muscle at null — which every screen renders as
        // "not measured yet". Say instead that we do not know.
        if (error) { reportError('clientData.hydrate.scans', error); setScansStatus('error'); return; }
        const page = capped(data);
        // Only ever show the user's own real scans — never seed demo scans into a live account.
        setScans(page.rows.slice().reverse().map((r: any) => ({ id: r.id, takenAt: r.taken_at, weightKg: Number(r.weight_kg), bodyFatPct: Number(r.body_fat_pct), skeletalMuscleKg: r.skeletal_muscle_kg != null ? Number(r.skeletal_muscle_kg) : null, source: r.source ?? '', metrics: r.metrics ?? undefined })));
        setScansStatus(page.truncated ? 'partial' : 'ready');
      } catch (e) { reportError('clientData.hydrate.scans', e); if (!cancelled) setScansStatus('error'); }
    };
    (async () => {
      try {
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (cancelled) return;
        if (authErr) { reportError('clientData.hydrate.auth', authErr); setScansStatus('error'); setProfileStatus('error'); return; }
        const id = auth?.user?.id;
        // Signed out: there is no server-side profile or scan history to miss.
        if (!id) { setScansStatus('ready'); setProfileStatus('ready'); return; }
        if (!cancelled) await loadForUser(id);
      } catch (e) { reportError('clientData.hydrate.auth', e); if (!cancelled) { setScansStatus('error'); setProfileStatus('error'); } }
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
    coachingMode, setCoachingMode, coachLinked,
    activity: 1.5, mealsPerDay, setMealsPerDay,
    stepGoal, setStepGoal, sleepGoalHours, setSleepGoalHours, waterGoalGlasses, setWaterGoalGlasses,
    weightKg, bodyFatPct, muscleKg: latest ? latest.skeletalMuscleKg : null,
    setWeightKg: (v) => { setManualWeight(v); setManualAt(new Date().toISOString()); }, setBodyFat: (v) => { setManualBodyFat(v); setManualAt(new Date().toISOString()); },
    scans: sorted,
    // A scan is the single most consequential thing a client records: it moves
    // weight, body fat, muscle, every chart, and the macro targets they eat to.
    // The insert used to be fire-and-forget — `.then(res => …, () => {})`, with
    // `error` never read — so a refused write left the scan on screen, driving
    // all of that, until the next launch dropped it. Now the caller is told.
    addScan: async (s: ScanRec): Promise<boolean> => {
      setScans((p) => [...p, s]);
      if (s.metrics && Object.values(s.metrics).some((v) => v != null)) {
        setScanMetrics((prev) => { const nm = { ...prev, [s.takenAt.slice(0, 10)]: s.metrics! }; AsyncStorage.setItem('repple.scanMetrics', JSON.stringify(nm)).catch(() => {}); return nm; });
      }
      setManualWeight(null); setManualBodyFat(null);
      if (!USE_SUPABASE || !sbUid) return false;
      try {
        const { data, error } = await supabase.from('scans').insert({ client_id: sbUid, taken_at: String(s.takenAt).slice(0, 10), weight_kg: s.weightKg, body_fat_pct: s.bodyFatPct, skeletal_muscle_kg: s.skeletalMuscleKg, source: s.source }).select('id').single();
        if (error || !data?.id) { reportError('clientData.addScan', error); return false; }
        if (s.metrics && Object.values(s.metrics).some((v) => v != null)) {
          // The composition breakdown is a second write against the row we just
          // made. Losing it costs the InBody detail, not the scan, so the scan
          // still counts as stored — but the failure is recorded rather than
          // discarded.
          const { error: mErr } = await supabase.from('scans').update({ metrics: s.metrics }).eq('id', data.id);
          if (mErr) reportError('clientData.addScan.metrics', mErr);
        }
        return true;
      } catch (e) { reportError('clientData.addScan', e); return false; }
    },
    weightSeries: [...sorted.map((s) => ({ t: s.takenAt, v: s.weightKg })), ...(manualIsCurrent && manualWeight != null ? [{ t: manualAt as string, v: manualWeight }] : [])],
    bodyFatSeries: [...sorted.map((s) => ({ t: s.takenAt, v: s.bodyFatPct })), ...(manualIsCurrent && manualBodyFat != null ? [{ t: manualAt as string, v: manualBodyFat }] : [])],
    // Scans that reported no muscle figure contribute no POINT, rather than a
    // point at zero. A charted zero is not a small reading, it is a cliff: it
    // dominates the axis and reads as total muscle loss between two scans.
    muscleSeries: sorted.flatMap((s) => (s.skeletalMuscleKg != null ? [{ t: s.takenAt, v: s.skeletalMuscleKg }] : [])),
    profileStatus, scansStatus, saveFailed,
    // The combined view: 'error' the moment either half failed, because a
    // profile screen shows both at once and cannot honestly present half of it
    // as the client's own data. 'partial' rolls up the same way — a truncated
    // scan history makes the profile's total change since starting a figure
    // over an unknown fraction of the record.
    status: worstStatus(profileStatus, scansStatus),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useClientData(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error('useClientData must be used inside <ClientDataProvider>');
  return v;
}
