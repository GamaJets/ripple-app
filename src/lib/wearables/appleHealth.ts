// Apple Health (HealthKit) provider.
//
// HealthKit is native code — it only exists in a real build of Repple (a dev
// build or a store build), NOT in Expo Go. So every native call is lazy and
// guarded: in Expo Go this provider reports itself unavailable and the UI shows
// "needs the Repple app build" instead of crashing.
//
// Apple Watch data reaches us automatically: the watch syncs heart rate,
// calories, steps and workouts into the iPhone's Health app, and HealthKit
// reads from there — no separate watchOS target required to READ this data.
import { Platform, NativeModules } from 'react-native';
import type { WearableProvider, ProviderMeta, DailyMetrics, WorkoutSample, HrPoint } from './types';
import { emptyMetrics } from './types';
import { nightsFromIntervals, type SleepFamily, type SleepInterval, type SleepRead, type SleepReading } from '../sleepMerge';
import { canRememberSleepAsk, hasAskedForSleep, markSleepAsked, shouldAutoAskForSleep } from './sleepAccess';
import { canRememberGlucoseAsk, hasAskedForGlucose, markGlucoseAsked, shouldAutoAskForGlucose } from './glucoseAccess';
import { parseHealthSamples, type GlucoseRead, type GlucoseReading } from '../glucose';

const meta: ProviderMeta = {
  id: 'apple',
  name: 'Apple Watch',
  icon: '⌚',
  kind: 'healthkit',
  blurb: 'Heart rate, calories, steps & workouts via Apple Health',
  metrics: ['Heart rate', 'Active calories', 'Steps', 'Resting HR', 'Workouts'],
};

// ── Lazy native module load ────────────────────────────────────────────────
let HK: any = null;
let tried = false;
function hk(): any {
  if (tried) return HK;
  tried = true;
  try {
    const mod = require('react-native-health');
    HK = mod?.default ?? mod;
  } catch {
    HK = null; // package not installed yet
  }
  return HK;
}
/** True only in a real build where the native HealthKit module is compiled in. */
function nativePresent(): boolean {
  return Platform.OS === 'ios' && !!NativeModules.AppleHealthKit && !!hk();
}

function isoStartOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Promisified single HealthKit read; resolves null on any error. */
function read(method: string, options: any): Promise<any> {
  return new Promise((resolve) => {
    const k = hk();
    if (!k || typeof k[method] !== 'function') return resolve(null);
    try {
      k[method](options, (err: any, res: any) => resolve(err ? null : res));
    } catch {
      resolve(null);
    }
  });
}

/**
 * The exact permission set Repple asks for.
 *
 * WRITE is `[Workout]` and nothing else — deliberately.
 *
 * Saving a completed session (see `appleHealthWrite.ts`) creates a single
 * HKWorkout whose energy and distance are carried *inside* that object, not as
 * separate ActiveEnergyBurned / Distance samples. So workout share access is the
 * whole of what we need. Asking for ActiveEnergyBurned write as well would put a
 * toggle in front of the user for a permission the app never exercises, which is
 * how a permission sheet stops being believable.
 *
 * HealthKit never reveals READ denials — a declined read type simply returns
 * nothing, indistinguishable from no data. WRITE is different: `getAuthStatus`
 * reports it honestly, which is what lets `writeAuthStatus()` below treat a
 * refusal as its own state rather than as a failure.
 *
 * SleepAnalysis joined the read set for TF-01, where sleep has to come from
 * every device the client has rather than from the number they typed in. It is
 * also the read type where the "denials are invisible" rule bites hardest: a
 * client who declined sleep sharing gets exactly the same empty array as one
 * who simply did not wear the watch, so nothing downstream may turn an empty
 * sleep read into "you slept 0 hours" — it renders as a dash either way, with a
 * line pointing at Health ▸ Sharing.
 */
function permissionSet(k: any) {
  const P = k.Constants.Permissions;
  return {
    permissions: {
      read: [P.HeartRate, P.RestingHeartRate, P.ActiveEnergyBurned, P.StepCount, P.Workout, P.SleepAnalysis],
      write: [P.Workout],
    },
  };
}

/**
 * Raise the permission sheet for the whole set above.
 *
 * It records that SleepAnalysis has been requested BEFORE calling, and that
 * ordering is the point rather than an accident — see `markSleepAsked`. Every
 * route that reaches initHealthKit goes through here (connect, the manual
 * button, the one automatic ask), so no caller can forget to write the fact
 * down and leave the automatic ask firing again on the next launch.
 */
function requestAuth(): Promise<void> {
  const k = hk();
  if (!k || !k.Constants) return Promise.reject(new Error('HealthKit is not available in this build.'));
  if (typeof k.initHealthKit !== 'function') return Promise.reject(new Error('The Apple Health module is not loaded in this build. A new build with the compatibility fix is needed.'));
  return markSleepAsked().then(
    () => new Promise<void>((resolve, reject) => {
      k.initHealthKit(permissionSet(k), (err: string) => (err ? reject(new Error(String(err))) : resolve()));
    }),
  );
}

/**
 * Ask again for the permission set.
 *
 * Anyone who connected Apple Health before writing existed was never shown the
 * workout-write toggle, because the old request sent `write: []`. `initHealthKit`
 * only prompts for types iOS has not yet decided on, so calling it again is
 * silent for everything already granted and raises the sheet for the new one.
 * Without this, an existing user could never reach the feature at all.
 *
 * Sleep is now in the same position: everyone who connected before TF-01 was
 * asked for heart rate, energy, steps and workouts and never for sleep, so
 * their sleep read comes back empty forever until this is called again.
 * `fetchSleep` now does that once, by itself, for exactly the people in that
 * state (see `wearables/sleepAccess.ts`). This stays exported for the manual
 * button, which is the route for somebody who declined and later changed their
 * mind — iOS will not show the sheet again for a decided type, but it does take
 * them to the right place to reconsider, and the automatic ask never fires
 * twice.
 */
export function requestHealthAuth(): Promise<void> {
  return requestAuth();
}

/** iOS + a real build with the native module compiled in. */
export function healthKitPresent(): boolean {
  return nativePresent();
}

/** HealthKit's own status codes for share (write) access. */
export type WriteAuth = 'granted' | 'denied' | 'undetermined' | 'unknown';

/**
 * Whether the user has allowed Repple to WRITE workouts.
 *
 * `unknown` is not a synonym for denied: it means the query itself did not
 * answer (old module, unexpected shape), and the caller must not present it as a
 * refusal the user made.
 */
export function writeAuthStatus(): Promise<WriteAuth> {
  return new Promise((resolve) => {
    const k = hk();
    if (!nativePresent() || !k || !k.Constants || typeof k.getAuthStatus !== 'function') return resolve('unknown');
    try {
      k.getAuthStatus(permissionSet(k), (err: any, res: any) => {
        if (err) return resolve('unknown');
        const w = res?.permissions?.write;
        if (!Array.isArray(w) || w.length === 0) return resolve('unknown');
        // permissionSet asks to write exactly one type, so index 0 is Workout.
        const code = Number(w[0]);
        resolve(code === 2 ? 'granted' : code === 1 ? 'denied' : code === 0 ? 'undetermined' : 'unknown');
      });
    } catch {
      resolve('unknown');
    }
  });
}

function sumValues(res: any): number | null {
  if (!Array.isArray(res) || res.length === 0) return null;
  return Math.round(res.reduce((s: number, x: any) => s + (Number(x?.value) || 0), 0));
}
function avgValues(res: any): number | null {
  if (!Array.isArray(res) || res.length === 0) return null;
  return Math.round(res.reduce((s: number, x: any) => s + (Number(x?.value) || 0), 0) / res.length);
}
function lastValue(res: any): number | null {
  if (!Array.isArray(res) || res.length === 0) return null;
  return Math.round(Number(res[res.length - 1]?.value) || 0);
}

// ── Sleep ───────────────────────────────────────────────────────────────────
//
// HealthKit is not one device. It is the phone's record of whatever every app
// and watch on this person's account wrote into it, and each sample carries the
// bundle id and display name of whoever wrote it. A client with an Apple Watch
// and an Oura ring has BOTH nights sitting in here, disagreeing, under two
// different sourceIds — which is precisely the TF-01 complaint, and the reason
// this returns one reading per source rather than one number per night. Picking
// between them is not this file's job; see src/lib/sleepMerge.ts.
//
// The `value` strings below are the ones RCTAppleHealthKit+Queries.m actually
// emits (INBED, ASLEEP, CORE, DEEP, REM, AWAKE, UNKNOWN) — read out of the
// installed native module, not assumed.
//
// AWAKE and UNKNOWN are excluded deliberately: AWAKE is time in bed not
// sleeping, and counting it would inflate every night on a watch running
// watchOS 9 or later while leaving older records alone, so two clients would
// get differently-defined figures under the same label.
const ASLEEP_VALUES = new Set(['ASLEEP', 'CORE', 'DEEP', 'REM']);
const IN_BED_VALUES = new Set(['INBED']);

/**
 * Best-effort guess at what kind of device wrote a sample.
 *
 * Deliberately best-effort: the family decides which of two REAL figures is
 * shown first and whether two rows are allowed to vouch for each other — never
 * what a figure is. An unrecognised writer falls to 'unknown', and two unknowns
 * are treated as one device, so a wrong guess can only ever under-claim
 * corroboration. Matching on the bundle id and the display name together
 * because third-party apps are inconsistent about which one carries the brand.
 */
function familyOf(sourceId: string, sourceName: string): SleepFamily {
  const s = `${sourceId} ${sourceName}`.toLowerCase();
  if (s.includes('oura')) return 'oura';
  if (s.includes('whoop')) return 'whoop';
  if (s.includes('fitbit')) return 'fitbit';
  if (s.includes('garmin')) return 'garmin';
  if (s.includes('watch')) return 'watch';
  if (s.includes('iphone')) return 'phone';
  return 'unknown';
}

/**
 * A HealthKit read that can tell the three cases apart.
 *
 * The `read()` helper above resolves null for a missing method AND for a failed
 * query AND has no way to say "it worked and there was nothing", which is fine
 * for a metric that renders as a dash but not for sleep: an empty night and an
 * unreadable night are different sentences on the Recovery screen, and merging
 * them is the bug this whole feature is being fixed for.
 */
function readSleepRows(options: any): Promise<{ ok: true; rows: any[] } | { ok: false; missing?: boolean; reason: string }> {
  return new Promise((resolve) => {
    const k = hk();
    if (!k || typeof k.getSleepSamples !== 'function') {
      return resolve({ ok: false, missing: true, reason: 'This build’s Apple Health module has no sleep reader — a native rebuild adds it.' });
    }
    try {
      k.getSleepSamples(options, (err: any, res: any) => {
        if (err) return resolve({ ok: false, reason: String(err?.message || err) });
        resolve({ ok: true, rows: Array.isArray(res) ? res : [] });
      });
    } catch (e: any) {
      resolve({ ok: false, reason: String(e?.message || e) });
    }
  });
}

/** The one automatic permission ask, shared across concurrent sleep reads. */
let sleepAskInFlight: Promise<void> | null = null;

/**
 * The window and options for a sleep query.
 *
 * Split out because the read now happens twice on one path — once, and again
 * after the permission sheet — and two copies of a limit that must not be
 * omitted is how one of them ends up omitted. Sample reads need an explicit
 * limit or react-native-health returns an empty array, the same trap fetchToday
 * documents. A week of staged sleep is a few hundred samples per source; 20000
 * is far above any real record and still bounded.
 */
function sleepQuery(sinceDays: number) {
  const start = new Date();
  start.setDate(start.getDate() - Math.max(1, sinceDays));
  start.setHours(0, 0, 0, 0);
  return { startDate: start.toISOString(), endDate: new Date().toISOString(), limit: 20000, ascending: true };
}

/**
 * Sleep samples turned into one reading per writer per night.
 *
 * Grouped by writer first, then by what that writer measured. A source that
 * stages sleep and also writes "in bed" contributes only its staged rows; one
 * that writes nothing but "in bed" still contributes, marked as such.
 */
function sleepReadings(rows: any[]): SleepReading[] {
  const bySource = new Map<string, { name: string; asleep: SleepInterval[]; inBed: SleepInterval[] }>();
  for (const row of rows) {
    const value = String(row?.value ?? '').toUpperCase();
    const start = row?.startDate ?? row?.start;
    const end = row?.endDate ?? row?.end;
    if (!start || !end) continue;
    const isAsleep = ASLEEP_VALUES.has(value);
    const isInBed = IN_BED_VALUES.has(value);
    if (!isAsleep && !isInBed) continue;
    const sourceId = String(row?.sourceId ?? row?.sourceName ?? 'unknown');
    const name = String(row?.sourceName ?? sourceId);
    let bucket = bySource.get(sourceId);
    if (!bucket) { bucket = { name, asleep: [], inBed: [] }; bySource.set(sourceId, bucket); }
    (isAsleep ? bucket.asleep : bucket.inBed).push({ start: String(start), end: String(end) });
  }

  const readings: SleepReading[] = [];
  for (const [sourceId, bucket] of bySource) {
    const staged = bucket.asleep.length > 0;
    const nights = nightsFromIntervals(staged ? bucket.asleep : bucket.inBed);
    for (const n of nights) {
      readings.push({
        provider: 'apple',
        sourceId,
        sourceName: bucket.name,
        family: familyOf(sourceId, bucket.name),
        basis: staged ? 'asleep' : 'in-bed',
        night: n.night,
        minutesAsleep: n.minutesAsleep,
      });
    }
  }
  return readings;
}

// Map HealthKit's workout activity names onto Repple's exercise vocabulary so an
// imported session lines up with the in-app cardio / mobility catalog. Anything we
// don't recognise keeps its Health label.
const HK_TO_EXERCISE: Record<string, string> = {
  Running: 'Treadmill / Run', Walking: 'Walk', Hiking: 'Walk',
  Cycling: 'Cycling', 'Indoor Cycling': 'Cycling',
  Rowing: 'Rowing', Elliptical: 'Elliptical',
  'Stair Climbing': 'Stairs', Stairs: 'Stairs', StairClimbing: 'Stairs',
  Swimming: 'Swim', Yoga: 'Yoga', Pilates: 'Pilates', 'Mind And Body': 'Pilates',
  'Core Training': 'Core', 'High Intensity Interval Training': 'Circuit',
  'Functional Strength Training': 'Circuit', 'Traditional Strength Training': 'Strength',
  Cooldown: 'Stretching', Flexibility: 'Stretching', 'Mixed Cardio': 'Cardio', Dance: 'Dance',
};
function mapActivity(name: string): string {
  return HK_TO_EXERCISE[name] || name || 'Workout';
}

// Named rather than inlined on the provider so the sleep reader can give the
// same sentence when it declines, instead of a second wording for the same
// situation drifting away from this one.
function unavailable(): string | null {
  if (Platform.OS !== 'ios') return 'Apple Health is iPhone-only.';
  if (nativePresent()) return null;
  return 'Needs the Repple app build (Apple Health can’t run inside Expo Go).';
}

export const appleHealth: WearableProvider = {
  meta,
  isAvailable: () => nativePresent(),
  unavailableReason: unavailable,

  async connect() {
    if (Platform.OS !== 'ios') throw new Error('Apple Health is iPhone-only.');
    if (!nativePresent()) throw new Error('Open the Repple dev build to connect Apple Health — it can’t read HealthKit inside Expo Go.');
    await requestAuth();
  },

  async disconnect() {
    // HealthKit has no revoke API; the user manages access in iOS Settings ▸ Health.
    // We just drop the local connection flag (handled by the context).
  },

  async fetchToday(): Promise<DailyMetrics | null> {
    if (!nativePresent()) return null;
    const options = { startDate: isoStartOfToday(), endDate: new Date().toISOString() };
    // Sample-based reads need an explicit limit — without it react-native-health
    // returns an empty array (aggregate reads like getStepCount do not).
    const sampleOpts = { ...options, limit: 10000, ascending: true };
    const [active, steps, hr, rhr, workouts] = await Promise.all([
      read('getActiveEnergyBurned', sampleOpts),
      read('getStepCount', options),
      read('getHeartRateSamples', sampleOpts),
      read('getRestingHeartRateSamples', { ...sampleOpts, ascending: false }),
      read('getSamples', { ...options, type: 'Workout', limit: 100 }),
    ]);
    const m = emptyMetrics('apple');
    m.activeKcal = sumValues(active);
    m.steps = steps && typeof steps.value === 'number' ? Math.round(steps.value) : sumValues(steps);
    m.heartRateAvg = avgValues(hr);
    m.heartRateLatest = lastValue(hr);
    m.heartRateResting = lastValue(rhr);
    if (Array.isArray(workouts) && workouts.length) {
      const mins = workouts.reduce((s: number, w: any) => {
        const a = Date.parse(w?.start ?? w?.startDate);
        const b = Date.parse(w?.end ?? w?.endDate);
        return s + (isFinite(a) && isFinite(b) ? (b - a) / 60000 : 0);
      }, 0);
      m.workoutMins = Math.round(mins) || null;
    }
    return m;
  },

  // Individual completed workouts (e.g. an Apple Watch Pilates or cycling session),
  // for one-tap import into the training log. HealthKit distance is in metres.
  async fetchWorkouts(sinceDays = 14): Promise<WorkoutSample[]> {
    if (!nativePresent()) return [];
    const start = new Date();
    start.setDate(start.getDate() - Math.max(1, sinceDays));
    start.setHours(0, 0, 0, 0);
    const res = await read('getSamples', { startDate: start.toISOString(), endDate: new Date().toISOString(), type: 'Workout', limit: 200 });
    if (!Array.isArray(res)) return [];
    const out: WorkoutSample[] = [];
    for (const w of res) {
      const a = Date.parse(w?.start ?? w?.startDate);
      const b = Date.parse(w?.end ?? w?.endDate);
      if (!isFinite(a)) continue;
      const mins = isFinite(b) && b > a ? Math.round((b - a) / 60000) : 0;
      if (mins <= 0) continue;
      const raw = String(w?.activityName ?? w?.activityId ?? 'Workout');
      const kcalN = Number(w?.calories);
      const distN = Number(w?.distance); // metres
      const startIso = new Date(a).toISOString();
      out.push({
        id: `apple-${startIso}-${raw}`,
        activity: mapActivity(raw),
        rawActivity: raw,
        start: startIso,
        mins,
        kcal: isFinite(kcalN) && kcalN > 0 ? Math.round(kcalN) : null,
        distanceKm: isFinite(distN) && distN > 0 ? Math.round(distN / 10) / 100 : null,
        source: 'apple',
      });
    }
    out.sort((x, y) => Date.parse(y.start) - Date.parse(x.start));
    return out;
  },

  // Recent nights, one reading per device that wrote into Health.
  //
  // Sources are kept apart rather than pooled. Pooling would union an Oura
  // night with an Apple Watch night into one longer stretch — a figure neither
  // device reported and nobody could check — and would also destroy the only
  // thing the client asked for, which is knowing where the number came from.
  async fetchSleep(sinceDays = 7): Promise<SleepRead> {
    if (!nativePresent()) {
      return { provider: 'apple', status: 'unsupported', readings: [], reason: unavailable() ?? 'Apple Health is not available in this build.' };
    }
    const res = await readSleepRows(sleepQuery(sinceDays));
    if (!res.ok) {
      return {
        provider: 'apple',
        status: res.missing ? 'unsupported' : 'error',
        readings: [],
        reason: res.reason,
      };
    }
    let readings = sleepReadings(res.rows);

    // The one automatic ask (TF-01, gap 2).
    //
    // Everybody who connected Health before sleep shipped was never asked for
    // SleepAnalysis, and HealthKit answers an unrequested read with an empty
    // array rather than an error — so their sleep is blank forever and nothing
    // in the response says why. `shouldAutoAskForSleep` is what separates that
    // case from a genuinely empty week, and it does it on a fact we own rather
    // than one HealthKit will not tell us: whether Repple has ever put
    // SleepAnalysis in front of this person. Once, then never again
    // automatically — including if they decline, because a sheet that comes
    // back after you have answered it is worse than the blank list. The manual
    // button on Recovery stays for anyone who changes their mind.
    const auto = shouldAutoAskForSleep({
      present: true,
      canRemember: canRememberSleepAsk(),
      alreadyAsked: await hasAskedForSleep(),
      readOk: true,
      readingCount: readings.length,
    });
    if (auto) {
      // Recovery and Devices both read sleep on mount, and the persisted flag
      // is only written once the storage promise resolves — so two screens
      // opening together could both see "never asked" and both raise a sheet.
      // The in-flight promise makes them share one ask for the life of the
      // process; the persisted flag covers every launch after this one.
      //
      // A refusal is an answer, not a failure: requestAuth has already recorded
      // that we asked, so there is nothing to recover from and nothing to
      // report. The re-read below simply finds whatever the person allowed.
      if (!sleepAskInFlight) sleepAskInFlight = requestAuth().catch(() => { /* declined, or the sheet never appeared */ });
      await sleepAskInFlight;
      const again = await readSleepRows(sleepQuery(sinceDays));
      // A second read that fails leaves the FIRST read's answer standing. That
      // read succeeded, so the week is still known to be empty; downgrading it
      // to an error here would report a failure that did not happen.
      if (again.ok) readings = sleepReadings(again.rows);
    }

    // 'ready' with no readings is a real answer — Health was readable and holds
    // no sleep for this window. It is not the same as the 'error' above, and
    // the Recovery screen says something different for each.
    return { provider: 'apple', status: 'ready', readings };
  },

  // Heart-rate samples in a window (a workout session, or a whole day) for the
  // zone chart. Downsamples to <=180 points so the SVG stays light.
  async fetchHeartRateSeries(startISO: string, endISO: string): Promise<HrPoint[]> {
    if (!nativePresent()) return [];
    const res = await read('getHeartRateSamples', { startDate: startISO, endDate: endISO, limit: 10000, ascending: true });
    if (!Array.isArray(res)) return [];
    const raw: HrPoint[] = [];
    for (const r of res) {
      const bpm = Number(r?.value);
      const t = r?.startDate ?? r?.start ?? r?.endDate;
      if (isFinite(bpm) && bpm > 0 && t) raw.push({ t: new Date(t).toISOString(), bpm: Math.round(bpm) });
    }
    raw.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
    const MAX = 180;
    if (raw.length <= MAX) return raw;
    const step = Math.ceil(raw.length / MAX);
    return raw.filter((_, i) => i % step === 0);
  },
};

// ── Blood glucose ───────────────────────────────────────────────────────────
//
// A CGM — a Dexcom directly, an Abbott Libre through its companion app —
// writes into Apple Health, so reading glucose is reading Health. No vendor
// contract, no per-brand key, and every monitor that reaches Health reaches
// Repple for free.
//
// DELIBERATELY NOT IN `permissionSet`. Adding BloodGlucose to the set every
// client is asked for on connect would put a Blood Glucose toggle in front of
// everybody, and almost nobody wears a CGM — which is exactly the thing the
// comment on `permissionSet` refuses to do for ActiveEnergyBurned write. A
// permission sheet listing things the app will not use is a sheet people stop
// reading. So glucose is asked for on its own, when the person turns the
// feature on, and `initHealthKit` only ever prompts for types iOS has not yet
// decided about — so this raises exactly one extra sheet, listing one type.

/** The one extra read type, asked for separately and only on request. */
function glucosePermissionSet(k: any) {
  const P = k.Constants.Permissions;
  return { permissions: { read: [P.BloodGlucose], write: [] } };
}

/**
 * Raise the sheet for blood glucose alone.
 *
 * Records the ask BEFORE calling, for the same reason `requestAuth` does:
 * `initHealthKit`'s callback does not fire if the app is backgrounded while
 * the sheet is up, and somebody who swipes a permission sheet away has
 * answered it. Recording the intent means at most one automatic ask per
 * device even if the app is killed mid-sheet.
 */
export function requestGlucoseAuth(): Promise<void> {
  const k = hk();
  if (!k || !k.Constants) return Promise.reject(new Error('HealthKit is not available in this build.'));
  if (typeof k.initHealthKit !== 'function') return Promise.reject(new Error('The Apple Health module is not loaded in this build.'));
  return markGlucoseAsked().then(
    () => new Promise<void>((resolve, reject) => {
      k.initHealthKit(glucosePermissionSet(k), (err: string) => (err ? reject(new Error(String(err))) : resolve()));
    }),
  );
}

/**
 * How a glucose read went.
 *
 * The same shape as SleepRead, and for the same reason: an empty list under
 * 'error' means "we could not ask", an empty list under 'ready' means "Health
 * holds nothing for this window", and a screen that renders those identically
 * is the recurring bug src/ui/loadStatus.ts exists to stop.
 *
 * It now lives in ../glucose so the Android reader returns the SAME type
 * rather than a look-alike — `app/(client)/glucose.tsx` chooses a provider and
 * then stops caring which one it got, and that only holds if there is one
 * type. Re-exported here because this module is where it was first defined and
 * an import of it from here must keep working.
 *
 * This provider never returns 'denied'. HealthKit answers a refused read with
 * the same empty array as an unrequested one, so a decline is not a fact iOS
 * gives us and must not be asserted.
 */
export type { GlucoseRead } from '../glucose';

/** Shared across screens so two mounting together raise one sheet, not two. */
let glucoseAskInFlight: Promise<void> | null = null;

function glucoseQuery(sinceDays: number) {
  const start = new Date();
  start.setDate(start.getDate() - Math.max(1, sinceDays));
  return {
    startDate: start.toISOString(),
    endDate: new Date().toISOString(),
    ascending: false,
    // A CGM writes a sample every five minutes: 288 a day, ~2,000 a week. The
    // cap is generous enough for a fortnight of continuous wear and finite
    // enough that a long-dormant sensor cannot return a year in one query.
    limit: 10000,
    // No `unit` — RCTAppleHealthKit defaults blood glucose to mmol/L, which is
    // what the column stores. Passing one would be the only way to make the
    // number mean something other than what parseHealthSamples assumes.
  };
}

/** Promisified glucose read that keeps "no such method" apart from "it failed". */
function readGlucoseRows(options: any): Promise<{ ok: true; rows: any[] } | { ok: false; missing?: boolean; reason: string }> {
  return new Promise((resolve) => {
    const k = hk();
    if (!k || typeof k.getBloodGlucoseSamples !== 'function') {
      return resolve({ ok: false, missing: true, reason: 'This build of Repple cannot read blood glucose from Apple Health yet.' });
    }
    try {
      k.getBloodGlucoseSamples(options, (err: any, res: any) => {
        if (err) return resolve({ ok: false, reason: 'Apple Health did not answer. Try again in a moment.' });
        resolve({ ok: true, rows: Array.isArray(res) ? res : [] });
      });
    } catch {
      resolve({ ok: false, reason: 'Apple Health did not answer. Try again in a moment.' });
    }
  });
}

/**
 * Recent glucose readings out of Apple Health.
 *
 * The automatic ask is the same mechanism sleep uses and rests on the same
 * fact: HealthKit answers an UNREQUESTED read with an empty array, exactly as
 * it answers a refused one, so nothing in the response can tell "never asked"
 * from "declined" from "no sensor". The one thing that can is whether Repple
 * has ever put BloodGlucose in front of this person on this device, and we
 * know that because we make the call.
 */
export async function fetchGlucose(sinceDays = 7): Promise<GlucoseRead> {
  if (!nativePresent()) {
    return { status: 'unsupported', readings: [], reason: 'Apple Health is not available in this build.' };
  }
  const res = await readGlucoseRows(glucoseQuery(sinceDays));
  if (!res.ok) {
    return { status: res.missing ? 'unsupported' : 'error', readings: [], reason: res.reason };
  }
  let readings = parseHealthSamples(res.rows);

  const auto = shouldAutoAskForGlucose({
    present: true,
    canRemember: canRememberGlucoseAsk(),
    alreadyAsked: await hasAskedForGlucose(),
    readOk: true,
    readingCount: readings.length,
  });
  if (auto) {
    if (!glucoseAskInFlight) glucoseAskInFlight = requestGlucoseAuth().catch(() => { /* declined, or the sheet never appeared */ });
    await glucoseAskInFlight;
    const again = await readGlucoseRows(glucoseQuery(sinceDays));
    // A second read that fails leaves the first read's answer standing — that
    // read succeeded, so the window is still known to be empty, and calling it
    // an error here would report a failure that did not happen.
    if (again.ok) readings = parseHealthSamples(again.rows);
  }

  return { status: 'ready', readings };
}
