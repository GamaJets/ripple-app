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
import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ScanMetrics } from '../lib/inbodyMetrics';
import { manualBeatsScan } from '../lib/bodyFigures';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { readCoachingMode, readDiet, type CoachingMode, type Goal, type Diet } from '../lib/types';
import type { Allergen } from '../lib/meals';
import type { Injury } from '../lib/injuries';
import { reportError } from '../lib/reportError';
import { isDeviceAvatar } from '../lib/avatarImage';
import { worstStatus, type LoadStatus } from './loadStatus';
import { useReadDeadline } from './readDeadline';
import { capLimit, capped } from '../lib/rowCap';
import { registerFlush } from '../lib/offlineQueue';
import { writeFailure } from '../lib/wroteRows';
import { useRecoverRead } from './readRefresh';
import { readMyProfileRow, readMyClientRow, forgetMyRows } from './myProfile';

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
  /**
   * Record a weight AND wait for the server to confirm it.
   *
   * `setWeightKg` is local state plus the debounced push six hundred
   * milliseconds later, whose only outcome is `saveFailed` — which the weekly
   * check-in never read, so it printed "your weight has been updated" over a
   * write nobody had asked the server about. That figure drives the macro
   * target, the goal projection, the meal plan's seed and the coach's console,
   * and it was the one write on that screen with no confirmation at all.
   *
   * Resolves true only on a row the server said it changed. False means the
   * figure is on this phone and nowhere else — and under Supabase the local
   * cache is cleared at the next launch, so false is not "it will go up later".
   */
  saveWeightNow: (kg: number) => Promise<boolean>;
  scans: ScanRec[];
  /** Resolves true only once the scan row is on the server. False means the
   *  scan is on this phone for this session and will be gone at relaunch — the
   *  local cache is cleared on launch when the backend is on. */
  addScan: (s: ScanRec) => Promise<boolean>;
  /**
   * Correct a scan that was entered wrong, by id.
   *
   * ── Why this had to exist ────────────────────────────────────────────────
   *
   * There was no way to change a scan and no `.delete()` against `scans`
   * anywhere in the app, so a mistyped weight was permanent. That is not merely
   * an untidy row: the LATEST scan is what `weightKg`, `bodyFatPct` and
   * `muscleKg` resolve to, and those drive the client's calorie and macro
   * targets, every body chart, the standards screen and the report their coach
   * reads. A finger slip that entered 87 kg as 187 kg re-tuned the meal plan
   * around it and there was nothing anybody could do about it from inside the
   * app.
   *
   * Resolves true only once the change is on the server, for the same reason
   * `addScan` does: an edit that only ever happened in memory is undone by the
   * next launch, and the caller has to be able to say so.
   */
  updateScan: (id: string, patch: { takenAt?: string; weightKg?: number; bodyFatPct?: number; skeletalMuscleKg?: number | null }) => Promise<boolean>;
  /** Remove a scan for good, by id. Resolves true only once the row is gone
   *  from the server — a local-only removal reappears at the next launch, which
   *  is worse than never having removed it. */
  deleteScan: (id: string) => Promise<boolean>;
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
  /**
   * Read the profile and the scan history again.
   *
   * A real re-read: it re-runs both server effects in this provider, so
   * `profileStatus` and `scansStatus` go back through 'loading' and end at
   * whatever the server says this time. It is not a state reset — nothing local
   * is cleared, and a refused read leaves the fields on screen exactly where
   * they were with the status saying they are not confirmed.
   *
   * Added because this is the provider behind the client's name, height, goal,
   * injuries, weight, body fat and every scan-derived figure in the app, and a
   * profile read that failed at launch had no way back at all short of killing
   * the app — the retry loop in the profile effect gives up after its attempts
   * and then nothing runs again until the signed-in uid changes.
   */
  reload: () => void;
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
  // Always starts empty. Real data loads from Supabase for a signed-in user;
  // there is nothing to fall back to for anyone else.
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
  // What the rest of the app is told, which is the above with an ending on it.
  //
  // Neither of those two can leave 'loading' unless a request SETTLES, and no
  // request in this app carries a timeout (src/lib/readDeadline.ts). The
  // profile read is worse off than most: its three attempts are sequential
  // `await`s, so a socket that accepts and then says nothing never even reaches
  // the second one, and the loop that would have published 'error' after the
  // third is unreachable. A member on a captive-portal wifi was left with
  // Lifting Tools saying "Reading your measurements…" and Profile showing
  // nothing, indefinitely, on a provider that mounts once per launch.
  //
  // The reads themselves are deliberately untouched. This provider's own header
  // sets out what happened the last time a failed read and a live write were
  // allowed to interleave — the member's recorded injuries overwritten with
  // blanks — and `nameSynced` still arms the push only on a read that actually
  // landed. All that changes is the sentence on screen while nothing answers.
  const publishedProfileStatus = useReadDeadline(profileStatus);
  const publishedScansStatus = useReadDeadline(scansStatus);
  const [saveFailed, setSaveFailed] = useState(false);
  /** Bumped by `reload`, and read by both server effects below. A counter, so
   *  two pulls in a row are two reads. */
  const [readTick, setReadTick] = useState(0);
  const reload = useCallback(() => setReadTick((n) => n + 1), []);
  /**
   * Bumped to make the push effect below run again without anything having
   * changed.
   *
   * The profile write is the one that carries `injuries`, and an injury is the
   * field in this app with a safety meaning: it is what makes a plan avoid a
   * movement. Until this existed, a client who disclosed a knee with no signal
   * had it saved to this device (the local cache effect above) and re-sent only
   * when something else in the profile changed, or at the next launch. It now
   * also goes on the reconnect edge and on returning to the foreground, through
   * src/lib/offlineQueue.ts · `flushAll`.
   *
   * A tick rather than a queued intent, and that is the right shape here: this
   * write is an UPDATE of the whole row from state, so "send it again" and
   * "send the current state" are the same instruction — there is nothing to
   * queue that state is not already holding.
   */
  const [pushTick, setPushTick] = useState(0);

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
          if (typeof p.diet === 'string') setDiet(readDiet(p.diet));
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
    // One pass at both halves of the profile read, reporting back whether
    // either half failed. Split out of the effect body because that answer now
    // decides more than a status line — see the loop underneath it.
    const readOnce = async (): Promise<boolean> => {
      // Either read failing means the profile on screen is partly or wholly
      // defaults. Tracked rather than swallowed, because the push effect below
      // is about to publish whatever is on screen back to the server.
      let failed = false;
      // Shared with the three other providers reading this same row on the
      // same launch — src/ui/myProfile.ts. It was `.single()` here, which
      // reports a MISSING row as the error PGRST116; the shared read is
      // `maybeSingle`, because tenant.tsx and settings.tsx both have honest
      // answers for a row that is not there. This call site does not: it arms
      // an UPDATE of the whole `clients` row off a successful read, and a
      // profiles row it never saw is not something to arm a write over. So the
      // absence is turned back into a failure HERE, explicitly, rather than
      // being inherited from a `.single()` nobody would think to look at.
      const profOut = await readMyProfileRow(sbUid);
      if (!profOut.ok) { reportError('clientData.hydrate.profiles', profOut.error); failed = true; }
      else if (profOut.value == null) {
        reportError('clientData.hydrate.profiles', new Error('no profiles row for the signed-in account'));
        failed = true;
      }
      else if (!cancelled) {
        {
          const data = profOut.value;
          const fromProfile = typeof data.full_name === 'string' ? data.full_name.trim() : '';
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
          if (typeof data.avatar === 'string' && data.avatar) setPhoto(data.avatar);
        }
      }

      // Read the rest of the profile back BEFORE the push effect below is allowed
      // to run. Without this the local state is still at its defaults (the local
      // cache is cleared on launch when USE_SUPABASE is on), and the push would
      // overwrite the user's real goal/diet/allergens on the server with those
      // defaults on every single app launch.
      try {
        const cOut = await readMyClientRow(sbUid);
        // Branched on `ok` rather than on a truthy error, because an outcome
        // carries whatever was thrown and `throw undefined` is legal.
        const cFailed = !cOut.ok;
        const c = cOut.ok ? cOut.value : null;
        // maybeSingle, not single. `single()` treats NO ROW as the error
        // PGRST116, and having no `clients` row is not a failure — it is the
        // normal, permanent state of every coach and every gym owner, because
        // provision_profile() gives a trainer signup a `trainers` row and no
        // client one. So this reported 'error' on every coach launch, for ever,
        // and being structural it never cleared: the whole coach app ran with a
        // profile read it believed had failed. A row that is genuinely absent
        // now comes back as null with no error, which is the true answer.
        if (!cOut.ok) { reportError('clientData.hydrate.clients', cOut.error); failed = true; }
        if (!cancelled && !cFailed && c) {
          const r = c as any;
          if (typeof r.dob === 'string' && r.dob) setDob(r.dob);
          if (r.height_cm != null && !Number.isNaN(Number(r.height_cm))) setHeightCm(Number(r.height_cm));
          if (typeof r.goal === 'string' && r.goal) setGoal(r.goal as Goal);
          // `readDiet`, not `as Diet`. The column is plain text; the union is
          // five values; and a value outside it reaches `mealAt`, whose pools
          // for an unknown diet are empty and which then reads `.n` off null —
          // a TypeError out of render that takes the whole nutrition screen.
          if (typeof r.diet === 'string' && r.diet) setDiet(readDiet(r.diet));
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
              // Counted, not just error-checked: an UPDATE that matches no row
              // comes back 204 with `error: null`, and the whole point of this
              // write is that the server is the only copy the coach's roster
              // and the console read. A promotion that silently landed nowhere
              // leaves a hybrid client reading as in-person to everybody but
              // themselves — which is the state this block exists to end.
              // Deliberately does NOT forget the shared read (src/ui/myProfile.ts).
              // This runs in the middle of the launch fan-out, and dropping the
              // rows here would send the providers still waiting on them back to
              // the server one at a time — which is the thing being fixed. It is
              // safe only because `mode` is read by nothing but this provider,
              // which already holds `agreed`; a promotion of any column another
              // reader takes would have to forget.
              const mRes = await supabase.from('clients').update({ mode: agreed }, { count: 'exact' }).eq('id', sbUid);
              const mWhy = writeFailure('Your coaching mode', mRes);
              if (mWhy) reportError('clientData.promoteMode', mRes.error ?? new Error(mWhy));
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

      return failed;
    };

    (async () => {
      // `setNameSynced(true)` is what ARMS the push effect below, and it used
      // to fire on the failure path too — the status went to 'error' and the
      // write was armed anyway, in the same statement. What that armed is not a
      // retry of the read: it is an UPDATE of the whole `clients` row, 600ms
      // later, from whatever is in state. Under USE_SUPABASE the local cache is
      // cleared at launch, so after a failed read that state is the DEFAULTS.
      // A transient timeout on the SELECT followed by a healthy UPDATE — an
      // ordinary way for one request in a pair to go — therefore overwrote
      // goal, diet, avoid, mode, focus_areas, the four goal columns, the manual
      // measurements and `injuries` with blanks, server-side, silently, and the
      // screen said nothing because the write itself succeeded. `injuries` is
      // the field in this app with a safety meaning: it is what makes the plan
      // avoid a movement, and it would have been erased by a read that failed.
      //
      // So the push is armed only by a read that actually landed. A failure is
      // retried a couple of times first, because a session that never arms the
      // push is a session whose profile edits never reach the server and whose
      // owner is not told that — the far smaller loss of the two, but still a
      // loss, and a timeout that clears on the second attempt costs nothing.
      // If every attempt fails the status stays 'error' and the write stays
      // disarmed: leaving the server's copy alone is the only safe answer when
      // we do not know what the server's copy says.
      const attempts = 3;
      for (let attempt = 1; attempt <= attempts && !cancelled; attempt++) {
        const failed = await readOnce();
        if (cancelled) return;
        if (!failed) { setProfileStatus('ready'); setNameSynced(true); return; }
        // 'error' is published only once there is nothing left to try. An
        // attempt with another one behind it is still a read in flight, and
        // saying 'error' in between would flash "we couldn't read your profile"
        // across every screen that reads this status and then take it back.
        if (attempt === attempts) { setProfileStatus('error'); return; }
        await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    })();
    return () => { cancelled = true; };
  }, [sbUid, readTick]);

  // Publish the profile to the shared backend: it is the durable store (the local
  // cache is cleared on launch when USE_SUPABASE is on) and a LINKED trainer reads
  // it to see the real client instead of a placeholder. Update-only, so it no-ops
  // rather than inventing rows. Gated on nameSynced, which is set only once BOTH
  // the profiles and clients rows have been read back SUCCESSFULLY — otherwise
  // this fires while state is still at its defaults and overwrites the user's
  // real settings, a read that failed leaving state at those defaults just as
  // surely as a read that has not come back yet.
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
        // nameSynced, so both reads have already landed and both succeeded.
        try { await AsyncStorage.setItem(MODE_KEY, coachingMode); } catch { /* the mode still applies this session; only the restore across launches is lost */ }
        // Both results are now inspected. Refusing to look was what let a
        // client's edited goal, diet or allergen list disappear at the next
        // launch with the screen having said nothing.
        // An UPDATE that matched NO ROWS is not an error in PostgREST — it
        // resolves with `error: null` and an empty result. So checking only
        // `error` catches a refused write and misses a write that was allowed
        // to run and then filtered away to nothing by row-level security, or
        // aimed at an id that has no row. Both leave the screen saying the
        // change is saved.
        //
        // That is the more dangerous half here, because one of the columns is
        // `injuries`. A client discloses a knee, the update matches zero rows,
        // `saveFailed` stays false, and they are told their coach has been
        // informed. Nothing downstream can tell that apart from a disclosure
        // that landed.
        //
        // `count: 'exact'` makes the row count the answer instead.
        try {
          const [{ error: pErr, count: pCount }, { error: cErr, count: cCount }] = await Promise.all([
            // `avatar` is a URL other accounts fetch, or nothing. It used to be
            // whatever the picker handed back, which on a phone is a path inside
            // THIS handset — the coach then read that path out of a shared row
            // and drew a blank circle, and the member, whose own device could
            // open its own file, had no way to know. src/ui/avatarUpload.ts is
            // where a photo becomes a URL now; this is the second lock on the
            // door, and it also clears the device paths already stored.
            supabase.from('profiles').update({ full_name: name, avatar: isDeviceAvatar(photo) ? null : photo }, { count: 'exact' }).eq('id', sbUid),
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
            }, { count: 'exact' }).eq('id', sbUid),
          ]);
          if (pErr) reportError('clientData.push.profiles', pErr);
          if (cErr) reportError('clientData.push.clients', cErr);
          // A zero count is reported the same way a refusal is, because to the
          // person on the screen it is the same thing: what they typed is not
          // on the server. `null` means the count was not returned at all,
          // which is not evidence of failure and must not be treated as one.
          const pMissed = pCount === 0;
          const cMissed = cCount === 0;
          if (pMissed) reportError('clientData.push.profiles', new Error('update matched no rows'));
          if (cMissed) reportError('clientData.push.clients', new Error('update matched no rows'));
          setSaveFailed(!!(pErr || cErr || pMissed || cMissed));
        } catch (e) { reportError('clientData.push', e); setSaveFailed(true); }
        // Both rows have just changed underneath the shared read that the other
        // providers take their copy of this person from. Outside the try, so it
        // runs on the failure path too: a write that threw may still have
        // landed, and the safe move on "we do not know" is to make the next
        // reader ask the server. src/ui/myProfile.ts.
        forgetMyRows(sbUid);
      })();
    }, 600);
    return () => clearTimeout(timer);
  }, [name, photo, dob, heightCm, goal, diet, avoid, mealsPerDay, stepGoal, sleepGoalHours, waterGoalGlasses, coachingMode, injuries, focusAreas, manualWeight, manualBodyFat, manualAt, sbUid, hydrated, nameSynced, pushTick]);

  // Try the profile write again when the app can reach the server again.
  //
  // Only when the last one FAILED. A tick on every reconnect would rewrite an
  // unchanged row on every walk out of a lift, and this write is six hundred
  // milliseconds of debounce away from two full-table updates.
  useEffect(() => registerFlush('clientProfile', () => {
    if (saveFailed) setPushTick((n) => n + 1);
  }), [saveFailed]);

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
        // Only ever show the user's own real scans — nothing is ever seeded.
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
  }, [readTick]);

  /**
   * The weight, written and confirmed, rather than typed and hoped for.
   *
   * The local state moves first — the screens the member is looking at are
   * about to be right either way — and then the row is updated with
   * `count: 'exact'`, because an UPDATE that matched no rows is not an error in
   * PostgREST and this codebase has shipped that mistake four times. The
   * debounced push runs afterwards with the same values and is idempotent.
   *
   * No queue: `manual_weight_kg` is a single column that a later check-in
   * overwrites, and a stale weight replayed after a newer one would move the
   * member's macro target backwards. The caller says "on this phone only"
   * instead, which is the truth.
   */
  const saveWeightNow = useCallback(async (kg: number): Promise<boolean> => {
    const at = new Date().toISOString();
    setManualWeight(kg);
    setManualAt(at);
    if (!USE_SUPABASE || !sbUid) return false;
    try {
      const { error, count } = await supabase
        .from('clients')
        .update({ manual_weight_kg: kg, manual_at: at }, { count: 'exact' })
        .eq('id', sbUid);
      if (error) { reportError('clientData.saveWeightNow', error); return false; }
      // `null` means the count did not come back, which is not evidence of
      // failure — the same reading the debounced push takes of it.
      if (count === 0) {
        reportError('clientData.saveWeightNow', new Error('update matched no rows'));
        return false;
      }
      return true;
    } catch (e) {
      reportError('clientData.saveWeightNow', e);
      return false;
    }
  }, [sbUid]);

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
  // Single source of truth: the most RECENT of {manual edit, latest scan} wins,
  // compared by CALENDAR DAY with the scan taking the tie. See manualBeatsScan
  // — the previous comparison put a full timestamp against a date column, so a
  // figure typed yesterday evening beat a scan dated today.
  const manualIsCurrent = manualBeatsScan(manualAt, latest?.takenAt ?? null);
  const weightKg = (manualWeight != null && manualIsCurrent) ? manualWeight : (latest ? latest.weightKg : null);
  const bodyFatPct = (manualBodyFat != null && manualIsCurrent) ? manualBodyFat : (latest ? latest.bodyFatPct : null);

  // ── Why this value is memoised and its writers go through a ref ──────────
  //
  // This provider used to publish a plain object literal, rebuilt on every
  // render — and with it eight fresh functions and three fresh arrays. That is
  // the defect src/ui/roster.tsx documents at length: `useClientData()` handed
  // back a different value every time, so a consumer keying an effect on it, or
  // on any array off it, re-ran that effect for a body record nobody had
  // touched. src/ui/badgeWatch.tsx keys its unlock check on `cd.weightSeries`
  // and was re-running it on every render of this provider for exactly that
  // reason.
  //
  // The writers are hoisted out and handed through a ref rather than frozen in
  // a `useCallback`: `deleteScan` needs the CURRENT `scans` to put a row back
  // after a refused delete, and every one of them needs the current `sbUid`, so
  // freezing the implementations would freeze that state with them — the same
  // bug one level down.
  const addInjury: Value['addInjury'] = (v) => setInjuries((prev) => [v, ...prev]);
  const updateInjury: Value['updateInjury'] = (id, patch) => setInjuries((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const removeInjury: Value['removeInjury'] = (id) => setInjuries((prev) => prev.filter((i) => i.id !== id));
  const setWeightKg: Value['setWeightKg'] = (v) => { setManualWeight(v); setManualAt(new Date().toISOString()); };
  const setBodyFat: Value['setBodyFat'] = (v) => { setManualBodyFat(v); setManualAt(new Date().toISOString()); };
  const addScan: Value['addScan'] = async (s: ScanRec): Promise<boolean> => {
      setScans((p) => [...p, s]);
      if (s.metrics && Object.values(s.metrics).some((v) => v != null)) {
        setScanMetrics((prev) => { const nm = { ...prev, [s.takenAt.slice(0, 10)]: s.metrics! }; AsyncStorage.setItem('repple.scanMetrics', JSON.stringify(nm)).catch(() => {}); return nm; });
      }
      setManualWeight(null); setManualBodyFat(null);
      if (!USE_SUPABASE || !sbUid) return false;
      try {
        const { data, error } = await supabase.from('scans').insert({ client_id: sbUid, taken_at: String(s.takenAt).slice(0, 10), weight_kg: s.weightKg, body_fat_pct: s.bodyFatPct, skeletal_muscle_kg: s.skeletalMuscleKg, source: s.source }).select('id').single();
        if (error || !data?.id) { reportError('clientData.addScan', error); return false; }
        // The caller's id was a local one ('s' + Date.now()); the row's id is
        // the server's. They are swapped here rather than left to diverge,
        // because `updateScan` and `deleteScan` address rows BY ID and a scan
        // added this session would otherwise carry an id no row has — so
        // correcting a scan you had just typed, which is when a typo is
        // actually noticed, would silently match nothing.
        setScans((p) => p.map((row) => (row.id === s.id ? { ...row, id: String(data.id) } : row)));
        if (s.metrics && Object.values(s.metrics).some((v) => v != null)) {
          // The composition breakdown is a second write against the row we just
          // made. Losing it costs the InBody detail, not the scan, so the scan
          // still counts as stored — but the failure is recorded rather than
          // discarded.
          // Counted for the same reason every other write on this row is: a
          // 204 over zero rows is how the composition breakdown goes missing
          // with nothing recorded anywhere, and the scan then reads as stored
          // WITH its InBody detail when only half of it landed.
          const mRes = await supabase.from('scans').update({ metrics: s.metrics }, { count: 'exact' }).eq('id', data.id);
          const mWhy = writeFailure('The composition breakdown for that scan', mRes);
          if (mWhy) reportError('clientData.addScan.metrics', mRes.error ?? new Error(mWhy));
        }
        return true;
      } catch (e) { reportError('clientData.addScan', e); return false; }
  };
  const updateScan: Value['updateScan'] = async (id, patch): Promise<boolean> => {
      // Applied locally first, exactly as addScan does, so the correction is on
      // screen while the write is in flight — and reported honestly afterwards
      // rather than assumed.
      setScans((p) => p.map((row) => (row.id === id ? {
        ...row,
        takenAt: patch.takenAt ?? row.takenAt,
        weightKg: patch.weightKg ?? row.weightKg,
        bodyFatPct: patch.bodyFatPct ?? row.bodyFatPct,
        skeletalMuscleKg: patch.skeletalMuscleKg !== undefined ? patch.skeletalMuscleKg : row.skeletalMuscleKg,
      } : row)));
      // A manual weight typed after the scan was taken would otherwise go on
      // beating the corrected figure (see manualBeatsScan) — so the same clear
      // addScan does is done here, because a correction is a statement that the
      // scan is now the right answer.
      setManualWeight(null); setManualBodyFat(null);
      if (!USE_SUPABASE || !sbUid) return false;
      const row: Record<string, unknown> = {};
      if (patch.takenAt !== undefined) row.taken_at = String(patch.takenAt).slice(0, 10);
      if (patch.weightKg !== undefined) row.weight_kg = patch.weightKg;
      if (patch.bodyFatPct !== undefined) row.body_fat_pct = patch.bodyFatPct;
      if (patch.skeletalMuscleKg !== undefined) row.skeletal_muscle_kg = patch.skeletalMuscleKg;
      if (!Object.keys(row).length) return true;
      try {
        // `.eq('client_id', sbUid)` as well as the id. RLS already scopes this
        // to the signed-in account, so the clause changes nothing about what is
        // permitted — it is here so that a bug handing this an id from another
        // account fails to match rather than relying on the policy as the only
        // thing between a client and somebody else's body record.
        //
        // `.select('id')` so the count is readable. An update matching NO rows
        // is not an error in PostgREST, and without this a correction to a scan
        // that had already been deleted elsewhere would report success.
        const { data, error } = await supabase.from('scans').update(row).eq('id', id).eq('client_id', sbUid).select('id');
        if (error) { reportError('clientData.updateScan', error); return false; }
        return Array.isArray(data) && data.length > 0;
      } catch (e) { reportError('clientData.updateScan', e); return false; }
  };
  const deleteScan: Value['deleteScan'] = async (id): Promise<boolean> => {
      const before = scans;
      setScans((p) => p.filter((row) => row.id !== id));
      if (!USE_SUPABASE || !sbUid) return false;
      try {
        const { data, error } = await supabase.from('scans').delete().eq('id', id).eq('client_id', sbUid).select('id');
        if (error || !Array.isArray(data) || data.length === 0) {
          // Put it back. A scan that is still on the server and gone from the
          // screen is the worst of the three states: the client believes it is
          // deleted, their coach still sees it, and the next launch brings it
          // back with no explanation. Restoring makes the failure visible at
          // the moment the caller can still say so.
          setScans(before);
          if (error) reportError('clientData.deleteScan', error);
          return false;
        }
        return true;
      } catch (e) {
        setScans(before);
        reportError('clientData.deleteScan', e);
        return false;
      }
  };
  const impl = useRef({ addInjury, updateInjury, removeInjury, setWeightKg, setBodyFat, addScan, updateScan, deleteScan });
  impl.current = { addInjury, updateInjury, removeInjury, setWeightKg, setBodyFat, addScan, updateScan, deleteScan };
  const addInjuryStable = useCallback((...a: Parameters<typeof addInjury>) => impl.current.addInjury(...a), []);
  const updateInjuryStable = useCallback((...a: Parameters<typeof updateInjury>) => impl.current.updateInjury(...a), []);
  const removeInjuryStable = useCallback((...a: Parameters<typeof removeInjury>) => impl.current.removeInjury(...a), []);
  const setWeightKgStable = useCallback((...a: Parameters<typeof setWeightKg>) => impl.current.setWeightKg(...a), []);
  const setBodyFatStable = useCallback((...a: Parameters<typeof setBodyFat>) => impl.current.setBodyFat(...a), []);
  const addScanStable = useCallback((...a: Parameters<typeof addScan>) => impl.current.addScan(...a), []);
  const updateScanStable = useCallback((...a: Parameters<typeof updateScan>) => impl.current.updateScan(...a), []);
  const deleteScanStable = useCallback((...a: Parameters<typeof deleteScan>) => impl.current.deleteScan(...a), []);

  // The three charted series. Memoised for the same reason the value is: each
  // used to be a freshly-built array on every render, and a chart keyed on one
  // of them re-drew for a scan history that had not changed.
  const weightSeries = useMemo(
    () => [...sorted.map((s) => ({ t: s.takenAt, v: s.weightKg })), ...(manualIsCurrent && manualWeight != null ? [{ t: manualAt as string, v: manualWeight }] : [])],
    [sorted, manualIsCurrent, manualWeight, manualAt],
  );
  const bodyFatSeries = useMemo(
    () => [...sorted.map((s) => ({ t: s.takenAt, v: s.bodyFatPct })), ...(manualIsCurrent && manualBodyFat != null ? [{ t: manualAt as string, v: manualBodyFat }] : [])],
    [sorted, manualIsCurrent, manualBodyFat, manualAt],
  );
  // Scans that reported no muscle figure contribute no POINT, rather than a
  // point at zero. A charted zero is not a small reading, it is a cliff: it
  // dominates the axis and reads as total muscle loss between two scans.
  const muscleSeries = useMemo(
    () => sorted.flatMap((s) => (s.skeletalMuscleKg != null ? [{ t: s.takenAt, v: s.skeletalMuscleKg }] : [])),
    [sorted],
  );
  // The combined view: 'error' the moment either half failed, because a
  // profile screen shows both at once and cannot honestly present half of it
  // as the client's own data. 'partial' rolls up the same way — a truncated
  // scan history makes the profile's total change since starting a figure
  // over an unknown fraction of the record.
  const status = worstStatus(publishedProfileStatus, publishedScansStatus);

  const value = useMemo<Value>(() => ({
    id: sbUid ?? 'unknown', name, init: initials(name), setName,
    dob, setDob, photo, setPhoto, heightCm, setHeightCm,
    goal, setGoal, diet, setDiet, avoid, setAvoid,
    injuries,
    focusAreas, setFocusAreas,
    addInjury: addInjuryStable, updateInjury: updateInjuryStable, removeInjury: removeInjuryStable,
    coachingMode, setCoachingMode, coachLinked,
    activity: 1.5, mealsPerDay, setMealsPerDay,
    stepGoal, setStepGoal, sleepGoalHours, setSleepGoalHours, waterGoalGlasses, setWaterGoalGlasses,
    weightKg, bodyFatPct, muscleKg: latest ? latest.skeletalMuscleKg : null,
    setWeightKg: setWeightKgStable, setBodyFat: setBodyFatStable,
    saveWeightNow,
    scans: sorted,
    addScan: addScanStable, updateScan: updateScanStable, deleteScan: deleteScanStable,
    weightSeries, bodyFatSeries, muscleSeries,
    profileStatus: publishedProfileStatus, scansStatus: publishedScansStatus, saveFailed, reload,
    status,
  }), [
    sbUid, name, setName, dob, setDob, photo, setPhoto, heightCm, setHeightCm,
    goal, setGoal, diet, setDiet, avoid, setAvoid, injuries, focusAreas, setFocusAreas,
    addInjuryStable, updateInjuryStable, removeInjuryStable,
    coachingMode, setCoachingMode, coachLinked, mealsPerDay, setMealsPerDay,
    stepGoal, setStepGoal, sleepGoalHours, setSleepGoalHours, waterGoalGlasses, setWaterGoalGlasses,
    weightKg, bodyFatPct, latest, setWeightKgStable, setBodyFatStable, saveWeightNow, sorted,
    addScanStable, updateScanStable, deleteScanStable,
    weightSeries, bodyFatSeries, muscleSeries,
    publishedProfileStatus, publishedScansStatus, saveFailed, reload, status,
  ]);
  // Re-run these reads when the signal comes back, without the member having
  // to know the app is stuck and think to pull down. src/lib/readRefresh.ts.
  useRecoverRead('clientData', status, reload);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useClientData(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error('useClientData must be used inside <ClientDataProvider>');
  return v;
}
