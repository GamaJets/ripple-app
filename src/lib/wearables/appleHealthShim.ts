// The react-native-health surface, served by a library that still registers.
//
// ── why this file exists ──────────────────────────────────────────────────
//
// `react-native-health@1.19.0` is a LEGACY-architecture module: no
// `codegenConfig`, no new-architecture markers in its podspec. React Native
// 0.86 runs the New Architecture and `newArchEnabled: false` in app.json is a
// no-op on that version, so the pod compiles and links — it is in Podfile.lock
// as RNAppleHealthKit — and the module never registers.
//
// The failure was invisible in a specific and cruel way. That package's entry
// point is:
//
//     const { AppleHealthKit } = require('react-native').NativeModules
//     export const HealthKit = Object.assign({}, AppleHealthKit, { Constants })
//
// With `AppleHealthKit` undefined, `Object.assign({}, undefined, {Constants})`
// yields an object carrying `Constants` and NOTHING ELSE. So every guard that
// asked "is the module here" got a truthy object with a truthy `Constants`, and
// only a call to an actual method revealed that the native half was missing.
// That is why the screen said "the module is not loaded in this build" while
// insisting a newer build would fix it. No build would. 1.19.0 is the last
// version that package will ever have.
//
// ── why a shim and not a rewrite ──────────────────────────────────────────
//
// appleHealth.ts and appleHealthWrite.ts are 1,339 lines, and almost all of it
// is hard-won behaviour with the reasons written down: the permission ask that
// records SleepAnalysis BEFORE calling so a failed ask cannot re-fire forever,
// the glucose read that deliberately passes no unit, the workout write that
// keeps one session to one entry. Ten native calls sit underneath all of it.
//
// Rewriting 1,339 lines to change 10 calls would have put every one of those
// decisions back in play. This file changes the 10 and leaves the rest alone.
//
// ── the two translations that matter ──────────────────────────────────────
//
// They are silent if wrong, which is the only reason they are called out here
// rather than left to the reader of each function:
//
//   `quantity`, not `value`. The new library returns QuantitySample.quantity.
//     Every consumer above — sumValues, avgValues, lastValue — reads `.value`.
//     Unmapped, they do not throw; they read undefined, `Number(undefined) ||
//     0` is 0, and the screen shows a confident zero for a day that had data.
//
//   Dates, not ISO strings. BaseSample carries real Date objects. The callers
//     do `Date.parse(w?.start ?? w?.startDate)`, which on a Date gives NaN, and
//     a NaN duration is silently dropped by the `isFinite` guards.
//
// Both produce a plausible empty screen rather than an error, which is the
// failure mode this codebase spends most of its comments trying to prevent.
import {
  requestAuthorization,
  getRequestStatusForAuthorization,
  isHealthDataAvailable,
  queryQuantitySamples,
  queryCategorySamples,
  queryWorkoutSamples,
  saveWorkoutSample,
} from '@kingstinct/react-native-healthkit';

/** ISO strings out, whatever the library hands back. */
const iso = (d: any): string | null => {
  if (d instanceof Date) return isFinite(d.getTime()) ? d.toISOString() : null;
  if (typeof d === 'string') return d;
  if (typeof d === 'number' && isFinite(d)) return new Date(d).toISOString();
  return null;
};

/**
 * The permission names react-native-health used, mapped to HealthKit's own
 * identifiers.
 *
 * Only the seven this app actually asks for. A wider map would be a claim that
 * the rest are wired up, and `permissionSet()` in appleHealth.ts is the list
 * that decides what the sheet shows.
 */
const READ_ID: Record<string, string> = {
  HeartRate: 'HKQuantityTypeIdentifierHeartRate',
  RestingHeartRate: 'HKQuantityTypeIdentifierRestingHeartRate',
  ActiveEnergyBurned: 'HKQuantityTypeIdentifierActiveEnergyBurned',
  StepCount: 'HKQuantityTypeIdentifierStepCount',
  SleepAnalysis: 'HKCategoryTypeIdentifierSleepAnalysis',
  BloodGlucose: 'HKQuantityTypeIdentifierBloodGlucose',
  Workout: 'HKWorkoutTypeIdentifier',
};

/** The units each quantity read is taken in.
 *
 *  BloodGlucose is **mmol/L** and that is not a preference. RCTAppleHealthKit
 *  defaulted blood glucose to mmol/L, the column stores mmol/L, and
 *  `parseHealthSamples` in src/lib/glucose.ts assumes it — appleHealth.ts says
 *  so where it deliberately passes no unit. The new API has no default, so the
 *  unit that was implicit has to be stated. In mg/dL the same reading is about
 *  eighteen times larger, which is a plausible-looking number on a screen a
 *  diabetic reads. */
const UNIT: Record<string, string> = {
  HKQuantityTypeIdentifierHeartRate: 'count/min',
  HKQuantityTypeIdentifierRestingHeartRate: 'count/min',
  HKQuantityTypeIdentifierActiveEnergyBurned: 'kcal',
  HKQuantityTypeIdentifierStepCount: 'count',
  HKQuantityTypeIdentifierBloodGlucose: 'mmol/L',
};

const toAuth = (permSet: any) => {
  const read = (permSet?.permissions?.read ?? []) as string[];
  const write = (permSet?.permissions?.write ?? []) as string[];
  return {
    toRead: read.map((p) => READ_ID[p] ?? p).filter(Boolean) as any,
    toShare: write.map((p) => READ_ID[p] ?? p).filter(Boolean) as any,
  };
};

/** `{ startDate, endDate, limit, ascending }` in the old shape → the new one.
 *
 * ── the date range goes in `filter.date`, and getting that wrong is silent ──
 *
 * This first shipped as `filter: { startDate, endDate }`, which is not the
 * shape: FilterForSamplesBase carries `uuid`, `uuids`, `metadata`, `date`,
 * `workout` and `sources`, and a date range belongs under `date`. Unknown
 * properties are not an error — they are ignored — so every query ran with NO
 * predicate and returned the member's entire HealthKit history.
 *
 * On a real phone that read 1,208,596 active kcal and 16,265,668 steps "today",
 * while resting heart rate was correct at 54 bpm. That split is the tell and is
 * worth remembering: the readers that SUM samples were years out, the one that
 * takes the latest sample was right, because the newest sample is still today's.
 * A wrong filter does not look like a wrong filter. It looks like a wrong number.
 *
 * The `as any` on the call sites is what let this compile. The generic types
 * would have rejected it. */
const toQuery = (options: any) => {
  const start = options?.startDate ? new Date(options.startDate) : undefined;
  const end = options?.endDate ? new Date(options.endDate) : undefined;
  return {
    filter: { date: { startDate: start, endDate: end } },
    // The old API treated a missing limit as "everything" for aggregates and
    // as "nothing" for sample reads — appleHealth.ts documents that trap and
    // always passes one. Non-positive means all, which is the safe reading of
    // an absent limit here.
    limit: typeof options?.limit === 'number' ? options.limit : 0,
    ascending: options?.ascending !== false,
  };
};

/** A quantity read, in the shape the callers above already parse. */
async function quantity(id: string, options: any) {
  const rows = await queryQuantitySamples(id as any, {
    ...toQuery(options),
    unit: UNIT[id],
  } as any);
  return (rows ?? []).map((r: any) => ({
    value: r?.quantity,
    startDate: iso(r?.startDate),
    endDate: iso(r?.endDate),
  }));
}

/** Node-style `(err, res)` around a promise, because every caller is written
 *  that way and the point of this file is that they do not change. */
function cb<T>(p: Promise<T>, done: (err: any, res: T | null) => void): void {
  p.then((res) => done(null, res)).catch((e) => done(e ?? new Error('Apple Health did not answer'), null));
}

/**
 * The object `hk()` returns.
 *
 * Deliberately shaped as react-native-health shaped itself, INCLUDING that a
 * missing method is simply absent — `readSleepRows` and `readGlucoseRows`
 * both branch on `typeof k.getSleepSamples !== 'function'` to tell "this build
 * cannot" from "it failed", and that distinction is load-bearing on screen.
 */
export const AppleHealthCompat = {
  Constants: {
    Permissions: Object.keys(READ_ID).reduce<Record<string, string>>((a, k) => { a[k] = k; return a; }, {}),
  },

  initHealthKit(permSet: any, done: (err: any) => void) {
    requestAuthorization(toAuth(permSet))
      // A refusal is not an error here: HealthKit answers an unrequested read
      // with an empty array rather than a failure, and appleHealth.ts is built
      // on that. Resolving lets the existing "asked, got nothing" paths run.
      .then(() => done(null))
      .catch((e) => done(e?.message ?? String(e)));
  },

  getAuthStatus(permSet: any, done: (err: any, res: any) => void) {
    cb(getRequestStatusForAuthorization(toAuth(permSet)) as any, done);
  },

  getHeartRateSamples: (o: any, d: any) => cb(quantity(READ_ID.HeartRate, o), d),
  getRestingHeartRateSamples: (o: any, d: any) => cb(quantity(READ_ID.RestingHeartRate, o), d),
  getActiveEnergyBurned: (o: any, d: any) => cb(quantity(READ_ID.ActiveEnergyBurned, o), d),
  getBloodGlucoseSamples: (o: any, d: any) => cb(quantity(READ_ID.BloodGlucose, o), d),

  /** Aggregate, not samples: the caller reads `res.value` first and only falls
   *  back to summing. Summed here so both readings agree. */
  getStepCount(o: any, d: any) {
    cb(
      quantity(READ_ID.StepCount, { ...o, limit: 0 }).then((rows) => ({
        value: rows.reduce((s, r) => s + (Number(r.value) || 0), 0),
      })),
      d,
    );
  },

  getSleepSamples(o: any, d: any) {
    cb(
      queryCategorySamples(READ_ID.SleepAnalysis as any, toQuery(o) as any).then((rows) =>
        (rows ?? []).map((r: any) => ({
          value: r?.value,
          startDate: iso(r?.startDate),
          endDate: iso(r?.endDate),
        })),
      ),
      d,
    );
  },

  /** `getSamples({ type: 'Workout' })` was the only use of getSamples. */
  getSamples(o: any, d: any) {
    if (String(o?.type ?? '') !== 'Workout') return d(null, []);
    cb(
      queryWorkoutSamples(toQuery(o) as any).then((rows) =>
        (rows ?? []).map((w: any) => ({
          start: iso(w?.startDate ?? w?.start),
          end: iso(w?.endDate ?? w?.end),
          activityName: w?.workoutActivityType ?? w?.activityName,
          activityId: w?.workoutActivityType ?? w?.activityId,
          calories: w?.totalEnergyBurned?.quantity ?? w?.calories,
          distance: w?.totalDistance?.quantity ?? w?.distance,
        })),
      ),
      d,
    );
  },

  saveWorkout(options: any, d: any) {
    const start = options?.startDate ? new Date(options.startDate) : new Date();
    const end = options?.endDate ? new Date(options.endDate) : start;
    cb(
      saveWorkoutSample(
        options?.type as any,
        [] as any,
        start,
        end,
        {
          ...(typeof options?.energyBurned === 'number' ? { totalEnergyBurned: options.energyBurned } : null),
          ...(typeof options?.distance === 'number' ? { totalDistance: options.distance } : null),
        } as any,
      ) as any,
      d,
    );
  },
};

/** Whether HealthKit exists on this device at all. Replaces the
 *  `NativeModules.AppleHealthKit` presence checks, which can no longer answer
 *  the question — that key is undefined even when the framework is present. */
export function healthKitPresent(): boolean {
  try { return isHealthDataAvailable(); } catch { return false; }
}
