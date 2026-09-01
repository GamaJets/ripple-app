// Health Connect (Android) — steps, heart rate, calories and workouts.
//
// ── What this closes ───────────────────────────────────────────────────────
//
// An Android member could sync nothing from their own phone but blood sugar.
// `healthConnect.ts` reads BloodGlucose and stops; `cloudProvider.ts` returned
// null for the Health Connect provider outright, and `registry.ts` advertised
// `metrics: []` against it. So half the platform got none of the wearable
// product: no steps, no heart rate, no calories, no workouts, no sleep, and no
// route to any of them short of buying a WHOOP.
//
// That is not a small gap. On iPhone, Garmin, Fitbit, Polar, Suunto and Zepp
// all write into Apple Health, and Repple reads them through it — the same
// vendors write into Health Connect on Android, and Repple read none of them.
// The Devices screen's own footnote says exactly this about Apple Health and
// had nothing to offer the other half of the userbase.
//
// ── ⚠ THIS NEEDS A NEW BINARY, AND THE CODE BELOW SAYS SO HONESTLY ─────────
//
// `react-native-health-connect` is already in the build. What is NOT in every
// build is the ANDROID MANIFEST DECLARATION for each record type: Android
// resolves `android.permission.health.READ_STEPS` and its five siblings at
// install time from the manifest, and a permission the manifest does not
// declare cannot be requested — `requestPermission` returns an empty grant set
// immediately, showing the person nothing at all.
//
// The declarations are in app.json's `android.permissions` as of this change,
// so the next build has them. Until that build is installed, this module is
// live and simply gets nothing back, and the CRITICAL part is what it says
// then. It does not say "you declined". An empty grant set on this platform is
// genuinely ambiguous — a decline and an undeclared permission are the same
// two values in the same order — and reporting one as the other would tell an
// Android member they refused something they were never offered, on a screen
// whose only control is a button that will go on doing nothing.
//
// So the outcome carries `'no-access'`, whose sentence names BOTH possibilities
// and names the one place that can tell them apart: Health Connect ▸ App
// permissions, which lists what Repple is allowed to ask for. That sentence is
// correct on today's binary and correct on the next one, and nothing has to be
// remembered or flipped when the build lands — the day the manifest declares
// the permissions, the request shows a real sheet and this module starts
// returning data with no code change at all.
//
// ── Why a separate file from healthConnect.ts ──────────────────────────────
//
// The permission SET is the product decision, and that file's header is an
// argument for keeping blood sugar alone: a Health Connect sheet listing six
// record types in order to ship one feature is a sheet people stop reading.
// That argument still stands, so the sets stay apart and are asked for at
// different moments — glucose when somebody opens the Blood Sugar screen,
// training when somebody taps Connect on Watch & Devices. Sharing one file
// would have made one set out of two, which is the thing being avoided.
//
// The native module itself is shared through `hcModule()`, because "is it in
// this binary" is one fact and two cached copies of it is two places to be
// wrong.
import { Platform } from 'react-native';
import { hcModule, healthConnectAvailability } from './healthConnect';
import type { DailyMetrics, WorkoutSample } from './types';
import { emptyMetrics } from './types';
import type { SleepRead, SleepReading } from '../sleepMerge';

/**
 * The record types the daily roll-up needs, and no more.
 *
 * Each one earns its place by feeding a field of `DailyMetrics` that a screen
 * already draws:
 *
 *   Steps                 DailyMetrics.steps        — Devices, dashboard
 *   HeartRate             heartRateAvg / Max        — Recovery's zone chart
 *   RestingHeartRate      heartRateResting          — Devices, Recovery
 *   ActiveCaloriesBurned  activeKcal                — the ENERGY ABOVE RESTING
 *   TotalCaloriesBurned   totalKcal                 — the whole day
 *   ExerciseSession       workoutMins, and the importable session list
 *   SleepSession          the nights readiness scores
 *
 * Active and total are BOTH asked for and kept apart, for the reason
 * DailyMetrics.activeKcal spells out at length: they differ by about 1,600 kcal
 * and folding one into the other put a mid-afternoon "1,309 kcal burned" in
 * front of somebody who had been at a desk all day. Health Connect is one of
 * the few stores that publishes both, so this is the one platform where the
 * distinction costs nothing to honour.
 *
 * There is no BloodGlucose here. See the header.
 */
const TRAINING_RECORDS = [
  'Steps',
  'HeartRate',
  'RestingHeartRate',
  'ActiveCaloriesBurned',
  'TotalCaloriesBurned',
  'ExerciseSession',
  'SleepSession',
] as const;

type TrainingRecord = (typeof TRAINING_RECORDS)[number];

const TRAINING_PERMS = TRAINING_RECORDS.map((recordType) => ({ accessType: 'read' as const, recordType }));

/**
 * The manifest permission each record type needs, so that the one thing a
 * reader has to check before the next Android build is written down in the
 * source rather than only in app.json.
 *
 * Nothing reads this at runtime, and that is deliberate: `Constants.expoConfig`
 * DOES carry app.json's permission list, and gating on it would look like an
 * honest probe while being the opposite one. An over-the-air update ships a new
 * expoConfig to an OLD binary, so the list would start claiming permissions the
 * installed manifest does not have — the gate would open on exactly the builds
 * it exists to protect. The outcome-based `'no-access'` answer below needs no
 * such guess.
 */
export const TRAINING_MANIFEST_PERMISSIONS: readonly string[] = [
  'android.permission.health.READ_STEPS',
  'android.permission.health.READ_HEART_RATE',
  'android.permission.health.READ_RESTING_HEART_RATE',
  'android.permission.health.READ_ACTIVE_CALORIES_BURNED',
  'android.permission.health.READ_TOTAL_CALORIES_BURNED',
  'android.permission.health.READ_EXERCISE',
  'android.permission.health.READ_SLEEP',
];

/**
 * What happened when we asked Health Connect for training data.
 *
 *   'ready'       we have access and read what was there.
 *   'unsupported' there is no Health Connect on this phone, or this is not
 *                 Android at all. A settled fact about the device.
 *   'no-access'   we asked and came away with nothing granted. Deliberately NOT
 *                 called 'denied' — see the header: on this platform a decline
 *                 and an undeclared manifest permission are indistinguishable,
 *                 and 'denied' would pick one and be wrong half the time.
 *   'error'       we had access and the read itself failed. The day is UNKNOWN,
 *                 not empty.
 */
export type TrainingAccess = 'ready' | 'unsupported' | 'no-access' | 'error';

export interface TrainingRead {
  access: TrainingAccess;
  /** Null under every access except 'ready'. Never a zeroed roll-up: a day of
   *  nulls and a day nobody could read are the same object otherwise, and every
   *  screen downstream would print the second as the first. */
  metrics: DailyMetrics | null;
  /** Sentence case, ending in a full stop. Null when access is 'ready'. */
  reason: string | null;
}

/** Whether there is anything on this phone to ask. */
export function trainingReadable(): boolean {
  return Platform.OS === 'android' && !!hcModule();
}

/**
 * The one sentence for 'no-access', so the Devices row, the connect alert and
 * the sleep list cannot grow three wordings of one fact — which is precisely
 * how Watch & Devices and Recovery came to contradict each other about WHOOP.
 *
 * It names both causes because both are live, and it names the screen that
 * settles which: Health Connect's own App permissions list shows what Repple
 * may ask for, so a member who sees Repple absent from it knows the build
 * cannot ask yet, and one who sees it there with the switches off knows it was
 * declined. That is a two-tap answer to a question this process cannot answer
 * at all.
 */
const NO_ACCESS =
  'Repple was not given access to your steps, heart rate, calories or workouts. '
  + 'Either it was declined, or this version of Repple cannot ask for them yet — '
  + 'Health Connect ▸ App permissions shows which, and it lists Repple only once a build that can ask is installed.';

/** Bring the client up. False is "it declined to start", which is an error and
 *  not a refusal — the same distinction healthConnect.ts draws. */
async function initialized(): Promise<boolean> {
  const k = hcModule();
  if (!k || typeof k.initialize !== 'function') return false;
  try { return (await k.initialize()) === true; } catch { return false; }
}

/**
 * Which of the training record types Repple may currently read.
 *
 * Returns an empty array for "none", and null for "the question itself did not
 * answer" — not a synonym, exactly as `hasGlucosePermission` insists next door.
 * A caller that read null as "none granted" would put a refusal in front of
 * somebody who never refused anything.
 */
export async function grantedTrainingRecords(): Promise<TrainingRecord[] | null> {
  const k = hcModule();
  if (!k || typeof k.getGrantedPermissions !== 'function') return null;
  try {
    const granted = await k.getGrantedPermissions();
    if (!Array.isArray(granted)) return null;
    return TRAINING_RECORDS.filter((r) =>
      granted.some((p: any) => p?.recordType === r && p?.accessType === 'read'));
  } catch {
    return null;
  }
}

/**
 * Raise the Health Connect sheet for the training set.
 *
 * Resolves with what was actually granted afterwards, asked fresh rather than
 * taken from the request's own return value: the request does not resolve at
 * all if the app is killed while the sheet is up, and `getGrantedPermissions`
 * is authoritative whether or not it settled.
 *
 * PARTIAL grants are a real and common outcome here — Health Connect lets
 * somebody tick steps and leave heart rate — so this returns the list rather
 * than a boolean, and the readers below simply skip what they were not given.
 * A member who shares their steps and not their heart rate gets their steps.
 */
export async function requestTrainingAccess(): Promise<TrainingRecord[]> {
  const k = hcModule();
  if (!k || typeof k.requestPermission !== 'function') return [];
  try {
    if (!(await initialized())) return [];
    await k.requestPermission(TRAINING_PERMS);
  } catch {
    // A throw here is the sheet failing to appear, which leaves the grant set
    // exactly as it was — so the answer is still whatever is granted now.
  }
  return (await grantedTrainingRecords()) ?? [];
}

/* ── reading ──────────────────────────────────────────────────────────────── */

/** Local midnight today, as Health Connect wants it: an instant, not a date. */
function todayWindow(): { operator: 'between'; startTime: string; endTime: string } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return { operator: 'between', startTime: start.toISOString(), endTime: new Date().toISOString() };
}

/** How many records one read will accept. A heart-rate series is the big one:
 *  a watch writing every few seconds produces thousands in a day, and the
 *  average only needs enough of them to be an average. */
const PAGE_SIZE = 1000;

/** Every record of one type in a window, or null when the read did not answer.
 *  Null is not an empty day — that distinction is the whole of src/ui/loadStatus
 *  and it is why this does not return `[]` on failure. */
async function read(recordType: TrainingRecord, window: ReturnType<typeof todayWindow>): Promise<any[] | null> {
  const k = hcModule();
  if (!k || typeof k.readRecords !== 'function') return null;
  try {
    const res = await k.readRecords(recordType, { timeRangeFilter: window, ascendingOrder: false, pageSize: PAGE_SIZE });
    return Array.isArray(res?.records) ? res.records : [];
  } catch {
    return null;
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Today's roll-up out of Health Connect.
 *
 * Every field is independently nullable and independently gated on its own
 * permission, because Health Connect grants per record type. A member who
 * shared steps and withheld heart rate gets a steps figure and a null heart
 * rate — not a refusal for the whole day, and not a heart rate of zero.
 */
export async function fetchTrainingToday(): Promise<TrainingRead> {
  if (!trainingReadable()) {
    return {
      access: 'unsupported',
      metrics: null,
      reason: Platform.OS === 'android'
        ? 'This build of Repple cannot read Health Connect. It is part of the app itself, so it arrives with a new version rather than in an update.'
        : 'Health Connect is Android’s health store, so there is nothing on this phone for it to read.',
    };
  }

  const availability = await healthConnectAvailability();
  if (availability !== 'ready') {
    return {
      access: 'unsupported',
      metrics: null,
      reason: availability === 'needs-update'
        ? 'Health Connect on this phone is too old to answer. Updating it in the Play Store is all it needs.'
        : availability === 'absent'
          ? 'This phone has no Health Connect for Repple to read. On Android 14 and later it is built in; before that it installs from the Play Store.'
          : 'Health Connect did not say whether it is available on this phone, so nothing was read.',
    };
  }

  if (!(await initialized())) {
    return { access: 'error', metrics: null, reason: 'Health Connect did not start. Try again in a moment.' };
  }

  const granted = await grantedTrainingRecords();
  // Null is "we could not ask the question", which is an error about our read
  // and not a statement about their permissions. It must not borrow the
  // no-access sentence, which tells somebody to go and change a setting.
  if (granted == null) {
    return { access: 'error', metrics: null, reason: 'Health Connect did not say what Repple may read, so nothing was read.' };
  }
  if (granted.length === 0) return { access: 'no-access', metrics: null, reason: NO_ACCESS };

  const window = todayWindow();
  const m = emptyMetrics('googlefit');
  const may = (r: TrainingRecord) => granted.includes(r);
  // Every read that was permitted and still failed. Collected rather than
  // thrown, because one dead record type must not delete the six that answered
  // — but it also must not vanish: `partial` below is how the caller learns the
  // day is short.
  let failed = 0;
  let attempted = 0;

  if (may('Steps')) {
    attempted++;
    const rows = await read('Steps', window);
    if (rows == null) failed++;
    else {
      // Health Connect stores steps as COUNTED INTERVALS, not a running total,
      // so the day's figure is the sum. Taking the newest record — the shape
      // that works for resting heart rate two blocks down — would report the
      // last few minutes of walking as the whole day.
      let total = 0;
      let any = false;
      for (const r of rows) { const c = num(r?.count); if (c != null) { total += c; any = true; } }
      m.steps = any ? Math.round(total) : null;
    }
  }

  if (may('HeartRate')) {
    attempted++;
    const rows = await read('HeartRate', window);
    if (rows == null) failed++;
    else {
      // Each record carries a `samples` array of {time, beatsPerMinute}. The
      // mean is over SAMPLES rather than over records: records are batched by
      // the writing app at whatever cadence it likes, so averaging record
      // averages would weight a batch of two the same as a batch of two
      // hundred.
      let sum = 0, n = 0, max = 0;
      let latest: { at: number; bpm: number } | null = null;
      for (const r of rows) {
        for (const s of (Array.isArray(r?.samples) ? r.samples : [])) {
          const bpm = num(s?.beatsPerMinute);
          if (bpm == null || bpm <= 0) continue;
          sum += bpm; n++;
          if (bpm > max) max = bpm;
          const at = Date.parse(String(s?.time ?? ''));
          if (Number.isFinite(at) && (!latest || at > latest.at)) latest = { at, bpm };
        }
      }
      m.heartRateAvg = n ? Math.round(sum / n) : null;
      m.heartRateMax = max > 0 ? Math.round(max) : null;
      m.heartRateLatest = latest ? Math.round(latest.bpm) : null;
    }
  }

  if (may('RestingHeartRate')) {
    attempted++;
    const rows = await read('RestingHeartRate', window);
    if (rows == null) failed++;
    // Newest first from the read, so the first row with a figure is today's
    // most recent. A resting heart rate is a single daily measurement rather
    // than an interval, so there is nothing to sum.
    else m.heartRateResting = rows.map((r) => num(r?.beatsPerMinute)).find((v) => v != null && v > 0) ?? null;
  }

  if (may('ActiveCaloriesBurned')) {
    attempted++;
    const rows = await read('ActiveCaloriesBurned', window);
    if (rows == null) failed++;
    else {
      // `energy` is an object carrying its own unit. Reading `.inKilocalories`
      // rather than `.value` is not optional: `.value` is whatever unit the
      // writer chose, and a joules figure taken as kilocalories is out by a
      // factor of four thousand.
      let total = 0, any = false;
      for (const r of rows) { const v = num(r?.energy?.inKilocalories); if (v != null) { total += v; any = true; } }
      m.activeKcal = any ? Math.round(total) : null;
    }
  }

  if (may('TotalCaloriesBurned')) {
    attempted++;
    const rows = await read('TotalCaloriesBurned', window);
    if (rows == null) failed++;
    else {
      let total = 0, any = false;
      for (const r of rows) { const v = num(r?.energy?.inKilocalories); if (v != null) { total += v; any = true; } }
      m.totalKcal = any ? Math.round(total) : null;
    }
  }

  if (may('ExerciseSession')) {
    attempted++;
    const rows = await read('ExerciseSession', window);
    if (rows == null) failed++;
    else {
      let mins = 0, any = false;
      for (const r of rows) {
        const a = Date.parse(String(r?.startTime ?? ''));
        const b = Date.parse(String(r?.endTime ?? ''));
        if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
        mins += (b - a) / 60000; any = true;
      }
      m.workoutMins = any ? Math.round(mins) : null;
    }
  }

  // No zone seconds, no HRV, no recovery score and no strain. Health Connect
  // publishes none of them: `HeartRateVariabilityRmssd` exists as a record type
  // but is written by almost nothing, and deriving zones here would need the
  // member's max heart rate, which lives in a different provider entirely. A
  // field left null renders as unknown, which is what it is.

  if (attempted > 0 && failed === attempted) {
    // Every read we were allowed to make failed. There is no honest roll-up in
    // that, and returning one full of nulls would render as a day on which the
    // member did nothing.
    return { access: 'error', metrics: null, reason: 'Health Connect did not answer. Try again in a moment.' };
  }
  return { access: 'ready', metrics: m, reason: null };
}

/**
 * Completed sessions, for importing into the training log.
 *
 * Returns an empty list both for "no access" and for "nothing recorded", which
 * is a compromise the daily roll-up above does not make — and it is safe here
 * only because the sole caller (`fetchWorkouts` on the provider contract) has
 * no channel for a reason and treats the list as an offer rather than as a
 * record. Nothing is stated to the member from its emptiness.
 */
export async function fetchTrainingWorkouts(sinceDays = 14): Promise<WorkoutSample[]> {
  if (!trainingReadable()) return [];
  if (!(await initialized())) return [];
  const granted = await grantedTrainingRecords();
  if (!granted?.includes('ExerciseSession')) return [];

  const start = new Date();
  start.setDate(start.getDate() - Math.max(1, sinceDays));
  const rows = await read('ExerciseSession', { operator: 'between', startTime: start.toISOString(), endTime: new Date().toISOString() });
  if (rows == null) return [];

  const out: WorkoutSample[] = [];
  for (const r of rows) {
    const a = Date.parse(String(r?.startTime ?? ''));
    const b = Date.parse(String(r?.endTime ?? ''));
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    // Health Connect names the activity with an integer enum and, when the
    // writing app bothered, a free-text title. The title is preferred because
    // it is what the member saw in the app they recorded it in; the enum is
    // kept as the raw label so a mapping can be added later without the import
    // having silently discarded what the device said.
    const label = String(r?.title || '').trim();
    const raw = label || `Exercise ${r?.exerciseType ?? ''}`.trim();
    out.push({
      // Health Connect's own record id, which is stable across reads — so
      // re-importing the same session is a no-op rather than a duplicate.
      id: `hc-${String(r?.metadata?.id ?? `${a}`)}`,
      activity: label || 'Workout',
      rawActivity: raw,
      start: new Date(a).toISOString(),
      mins: Math.round((b - a) / 60000),
      // Energy is not on the session record in Health Connect — it is a
      // separate ActiveCaloriesBurned series over the same window — so this is
      // null rather than a figure derived from duration, which would be an
      // invented calorie count attached to a real session.
      kcal: null,
      distanceKm: null,
      avgHr: null,
      maxHr: null,
      source: 'googlefit',
    });
  }
  out.sort((x, y) => Date.parse(y.start) - Date.parse(x.start));
  return out;
}

/**
 * Recent nights out of Health Connect.
 *
 * Returns a `SleepRead` for the reason the contract in types.ts gives: "this
 * device recorded nothing" and "we could not ask this device" must arrive as
 * different answers, or a failed read becomes a night of no sleep in the
 * readiness average.
 *
 * A night's key is the LOCAL DAY the person woke up on, derived here on the
 * phone for the same reason `vendorSleep.ts` derives it here rather than in the
 * edge function: the calendar belongs to the reader's clock.
 */
export async function fetchTrainingSleep(sinceDays = 7): Promise<SleepRead> {
  const unsupported = (reason: string): SleepRead => ({ provider: 'googlefit', status: 'unsupported', readings: [], reason });
  if (!trainingReadable()) {
    return unsupported(Platform.OS === 'android'
      ? 'This build of Repple cannot read Health Connect.'
      : 'Health Connect is Android’s health store, so there is nothing on this phone for it to read.');
  }
  if (!(await initialized())) {
    return { provider: 'googlefit', status: 'error', readings: [], reason: 'Health Connect did not start, so these nights are unknown rather than empty.' };
  }
  const granted = await grantedTrainingRecords();
  if (granted == null) {
    return { provider: 'googlefit', status: 'error', readings: [], reason: 'Health Connect did not say what Repple may read, so these nights are unknown rather than empty.' };
  }
  // Not an error and not an empty week: Repple has not been given sleep, which
  // is a fact about access rather than about what the member slept.
  if (!granted.includes('SleepSession')) return unsupported(NO_ACCESS);

  const start = new Date();
  start.setDate(start.getDate() - Math.max(1, sinceDays));
  const rows = await read('SleepSession', { operator: 'between', startTime: start.toISOString(), endTime: new Date().toISOString() });
  if (rows == null) {
    return { provider: 'googlefit', status: 'error', readings: [], reason: 'Health Connect did not answer, so these nights are unknown rather than empty.' };
  }

  // One night per local wake day, longest session winning. A phone that records
  // a nap and a night on the same day would otherwise contribute whichever came
  // back first, and a twenty-minute nap standing in for eight hours is the kind
  // of figure readiness would act on.
  const byNight = new Map<string, SleepReading>();
  for (const r of rows) {
    const a = Date.parse(String(r?.startTime ?? ''));
    const b = Date.parse(String(r?.endTime ?? ''));
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    const woke = new Date(b);
    const p = (n: number) => String(n).padStart(2, '0');
    const night = `${woke.getFullYear()}-${p(woke.getMonth() + 1)}-${p(woke.getDate())}`;
    const minutesAsleep = Math.round((b - a) / 60000);
    if (minutesAsleep <= 0) continue;
    // Whatever wrote the session, named as it named itself. Health Connect
    // records which app supplied a record, and a member with a Garmin and a
    // Samsung watch both writing here needs the merge to be able to tell them
    // apart — `sourceId` is what src/lib/sleepMerge keys independence on, so
    // collapsing every Android record onto one id would make two devices
    // corroborating look like one device repeating itself.
    const app = String(r?.metadata?.dataOrigin ?? '').trim();
    const cur = byNight.get(night);
    if (!cur || minutesAsleep > cur.minutesAsleep) {
      byNight.set(night, {
        provider: 'googlefit',
        sourceId: app || 'health-connect',
        sourceName: app || 'Health Connect',
        // 'phone' rather than 'watch': Health Connect is a STORE, and the app
        // that wrote the record may be a ring, a watch or a phone. Claiming a
        // family we cannot establish would give this reading a rank in the
        // merge it has not earned.
        family: 'phone',
        // A SleepSession's start and end bracket time IN BED. Health Connect
        // publishes stages separately and most writers omit them, so calling
        // this 'asleep' would overstate every Android night by the twenty
        // minutes it takes to fall asleep — and sleepMerge ranks 'asleep' above
        // 'in-bed' precisely so that an honest in-bed figure loses to a
        // measured one rather than beating it.
        basis: 'in-bed',
        night,
        minutesAsleep,
      });
    }
  }
  return {
    provider: 'googlefit',
    status: 'ready',
    readings: [...byNight.values()].sort((x, y) => (x.night < y.night ? 1 : -1)),
  };
}
