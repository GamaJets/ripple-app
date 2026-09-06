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
  authorizationStatusFor,
  AuthorizationStatus,
  isHealthDataAvailable,
  queryQuantitySamples,
  queryCategorySamples,
  queryWorkoutSamples,
  saveWorkoutSample,
  CategoryValueSleepAnalysis,
  WorkoutActivityType,
} from '@kingstinct/react-native-healthkit';

/** ISO strings out, whatever the library hands back. */
const iso = (d: any): string | null => {
  if (d instanceof Date) return isFinite(d.getTime()) ? d.toISOString() : null;
  if (typeof d === 'string') return d;
  if (typeof d === 'number' && isFinite(d)) return new Date(d).toISOString();
  return null;
};

/**
 * Who wrote the sample, in the two fields the callers read.
 *
 * The third silent translation, and the one with no visible symptom at all.
 * BaseObject carries `uuid` and `sourceRevision.source` (`{ name,
 * bundleIdentifier }`); react-native-health flattened those onto every row as
 * `id`, `sourceId` and `sourceName`, and the first version of this file dropped
 * all three. Nothing threw, because every consumer of them is written to
 * tolerate their absence — and each one then does something quietly wrong:
 *
 *   · `sleepReadings()` in appleHealth.ts groups by `sourceId` and falls back to
 *     the literal string 'unknown'. With every row unattributed, an Oura night
 *     and an Apple Watch night land in ONE bucket and are merged into a single
 *     longer stretch — the exact outcome the comment above `fetchSleep` says
 *     must never happen, and the whole of what TF-01 asked for.
 *   · `parseHealthSamples()` in glucose.ts collapses duplicates by `id`. With
 *     no id there is nothing to collapse by, so every re-read of Health inserts
 *     the same CGM samples again — that function's own comment puts a week of
 *     wearing one at 2,000 duplicate rows.
 *
 * `sourceRevision.source` is a nitro hybrid object rather than a plain record,
 * so it is read defensively: a throwing getter here would take out a whole read
 * that is otherwise fine.
 */
const sourceOf = (r: any): { sourceId: string | null; sourceName: string | null } => {
  try {
    const s = r?.sourceRevision?.source;
    const id = typeof s?.bundleIdentifier === 'string' ? s.bundleIdentifier : null;
    const name = typeof s?.name === 'string' ? s.name : null;
    return { sourceId: id, sourceName: name };
  } catch {
    return { sourceId: null, sourceName: null };
  }
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
    // The store's own uuid, under the name react-native-health gave it.
    // `parseHealthSamples` in src/lib/glucose.ts deduplicates by this and by
    // nothing else; see `sourceOf` above.
    id: typeof r?.uuid === 'string' ? r.uuid : null,
    ...sourceOf(r),
  }));
}

/** Node-style `(err, res)` around a promise, because every caller is written
 *  that way and the point of this file is that they do not change. */
function cb<T>(p: Promise<T>, done: (err: any, res: T | null) => void): void {
  p.then((res) => done(null, res)).catch((e) => done(e ?? new Error('Apple Health did not answer'), null));
}

/**
 * A sleep sample's `value`, as a WORD rather than as a number.
 *
 * The fourth translation, and it is the same defect as `quantity` vs `value`
 * one layer down: a real difference in the two libraries' shapes that produces
 * an empty screen instead of an error.
 *
 * `HKCategorySample.value` is an integer, and the new library forwards it as
 * one — `serializeCategorySample` in the pod's Serializers.swift writes
 * `value: Double(sample.value)`, and the declared type is the numeric enum
 * `CategoryValueSleepAnalysis` (inBed 0, asleepUnspecified 1, awake 2,
 * asleepCore 3, asleepDeep 4, asleepREM 5). RCTAppleHealthKit turned the same
 * integer into one of the strings INBED / ASLEEP / CORE / DEEP / REM / AWAKE /
 * UNKNOWN before handing it over, and `sleepReadings()` in appleHealth.ts is
 * written against those strings: it does `String(row.value).toUpperCase()` and
 * tests membership of ASLEEP_VALUES and IN_BED_VALUES.
 *
 * Unmapped, every row arrives as "0".."5", matches neither set, and is skipped
 * by the `continue` two lines later. So the read SUCCEEDS, returns hundreds of
 * real samples, and produces zero readings — which reaches the Recovery screen
 * as a measured night of no sleep at all, from a watch that recorded one. That
 * is precisely the confusion `readSleepRows` was built to prevent (an empty
 * night and an unreadable night are different sentences) defeated one layer
 * below it, where it cannot tell.
 *
 * Anything outside the enum is UNKNOWN rather than guessed. appleHealth.ts
 * counts neither UNKNOWN nor AWAKE as sleep, so an unrecognised value can only
 * ever be left out — never added to a night.
 */
const SLEEP_VALUE: Record<number, string> = {
  [CategoryValueSleepAnalysis.inBed]: 'INBED',
  [CategoryValueSleepAnalysis.asleepUnspecified]: 'ASLEEP',
  [CategoryValueSleepAnalysis.awake]: 'AWAKE',
  [CategoryValueSleepAnalysis.asleepCore]: 'CORE',
  [CategoryValueSleepAnalysis.asleepDeep]: 'DEEP',
  [CategoryValueSleepAnalysis.asleepREM]: 'REM',
};
const sleepWord = (v: unknown): string => {
  const n = Number(v);
  return (Number.isFinite(n) && SLEEP_VALUE[n]) || 'UNKNOWN';
};

/**
 * A workout's activity, as a NAME rather than as a number.
 *
 * Same shape of mistake again. `WorkoutSample.workoutActivityType` is the
 * numeric `WorkoutActivityType` enum; react-native-health's `getSamples`
 * published `activityName` as a string ('Running', 'TraditionalStrengthTraining'
 * …). `mapActivity()` in appleHealth.ts looks the name up in HK_TO_EXERCISE and
 * falls back to the raw value, so an unmapped number does not throw — it puts
 * the string "45" in the activity column of the import list and writes
 * `apple-<date>-45` as the row's stable id.
 *
 * The enum's own reverse lookup is the source, upper-cased on the first letter
 * to match the vocabulary HK_WRITE_ACTIVITIES and EXERCISE_TO_HK in
 * appleHealthWrite.ts already use — so a session imported from the watch and
 * written back keeps one name, which is what that file's comment promises.
 */
const activityName = (v: unknown): string => {
  const n = Number(v);
  const raw = Number.isFinite(n) ? (WorkoutActivityType as any)[n] : undefined;
  return typeof raw === 'string' && raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Workout';
};
/** The inverse, for the write path. Built from the same enum, so the two
 *  directions cannot drift apart. */
const activityType = (name: unknown): number | null => {
  const want = String(name ?? '').toLowerCase();
  if (!want) return null;
  for (const [k, v] of Object.entries(WorkoutActivityType as any)) {
    if (typeof v === 'number' && k.toLowerCase() === want) return v;
  }
  return null;
};

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

  /**
   * The fifth silent translation, and the one that cost a member the sentence
   * telling them how to undo their own refusal.
   *
   * This was `getRequestStatusForAuthorization(...)`, which is a different
   * question with a different answer shape. That call returns ONE number for
   * the whole request — HKAuthorizationRequestStatus: unknown 0, shouldRequest
   * 1, unnecessary 2 — meaning "would the sheet show anything if I asked
   * again". `writeAuthStatus()` in appleHealth.ts reads
   * `res.permissions.write[0]`, which on a bare number is `undefined`, so it
   * took the `!Array.isArray(w)` branch and resolved 'unknown' on EVERY
   * handset, for ever, whatever the member had chosen.
   *
   * Two things followed on the Devices screen, and both are silent:
   *
   *   · The `hkAuth === 'denied'` Notice — the only place in the app that says
   *     "Health ▸ Sharing ▸ Apps ▸ Repple ▸ turn on Workouts" — could never
   *     render. A member who tapped Don't Allow on the workout toggle instead
   *     watched every session land in the `failed` list under the generic
   *     "Apple Health refused the write", with no route to the switch that
   *     would fix it. `writeSessions` has a whole 'denied' state written for
   *     this and it was unreachable.
   *   · `writeHk` re-asked authorisation on every single tap, because
   *     'unknown' is neither 'granted' nor 'denied'.
   *
   * `authorizationStatusFor` is the right question: HKAuthorizationStatus per
   * type — notDetermined 0, sharingDenied 1, sharingAuthorized 2 — which is
   * exactly the numbering react-native-health published and exactly what
   * `writeAuthStatus()` already decodes.
   *
   * It is synchronous and it throws on an identifier this OS version does not
   * know, so each type is asked for separately and a throw becomes 0 — which
   * `writeAuthStatus` reads as 'undetermined', the honest answer to "we could
   * not find out" for a type that has not been decided.
   *
   * The `read` array is filled in the same way and MUST NOT be trusted:
   * HealthKit deliberately refuses to reveal read authorisation and answers
   * sharingDenied for a granted read type, which is precisely why
   * `permissionSet()` in appleHealth.ts documents read denials as invisible and
   * why nothing reads this half. It is present because the old bridge's shape
   * had it, and a caller reaching for `permissions.read` should find a list
   * rather than `undefined` and quietly conclude something from its absence.
   */
  getAuthStatus(permSet: any, done: (err: any, res: any) => void) {
    const statusOf = (id: string): number => {
      try {
        const s = authorizationStatusFor(id as any);
        return typeof s === 'number' ? s : AuthorizationStatus.notDetermined;
      } catch {
        return AuthorizationStatus.notDetermined;
      }
    };
    try {
      const { toRead, toShare } = toAuth(permSet);
      done(null, {
        permissions: {
          read: (toRead as string[]).map(statusOf),
          write: (toShare as string[]).map(statusOf),
        },
      });
    } catch (e) {
      done(e ?? new Error('Apple Health did not answer'), null);
    }
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
          // A word, not the raw integer — see SLEEP_VALUE.
          value: sleepWord(r?.value),
          startDate: iso(r?.startDate),
          endDate: iso(r?.endDate),
          id: typeof r?.uuid === 'string' ? r.uuid : null,
          // Without these every writer collapses into one bucket called
          // 'unknown' and two devices' nights are merged. See `sourceOf`.
          ...sourceOf(r),
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
          // A name, not the enum's number — see `activityName`. `activityId`
          // keeps the number, which is what its name says it is and what the
          // old bridge put there.
          activityName: activityName(w?.workoutActivityType),
          activityId: w?.workoutActivityType ?? w?.activityId,
          calories: w?.totalEnergyBurned?.quantity ?? w?.calories,
          distance: w?.totalDistance?.quantity ?? w?.distance,
          ...sourceOf(w),
        })),
      ),
      d,
    );
  },

  /**
   * ── the totals were being sent under names nothing reads ──────────────────
   *
   * `WorkoutTotals` is `{ distance?: number; energyBurned?: number }` — two
   * keys, and neither is what was here. This sent `totalEnergyBurned` and
   * `totalDistance`, which are the field names on the workout that COMES BACK,
   * not on the object that goes in. Unknown properties on a nitro struct are
   * dropped, exactly as they are on a query filter, so every session Repple
   * wrote into Apple Health arrived with no energy and no distance on it —
   * silently, and only visible by opening Health and looking at a workout that
   * says nothing but its duration.
   *
   * The units are stated by the pod rather than chosen here: WorkoutsModule.swift
   * builds `HKQuantity(unit: .kilocalorie(), ...)` and `HKQuantity(unit: .meter(),
   * ...)` from these two numbers. appleHealthWrite.ts passes SMALL calories
   * (`p.kcal * 1000`, with `energyBurnedUnit: 'calorie'`) because that is what
   * react-native-health's unit table required, so the conversion belongs here,
   * with the rest of the translation. Passing that figure through untouched
   * would file a 400 kcal session as 400,000.
   *
   * And the activity is the numeric enum, not the name. `p.activity` is a
   * string ('Running'); `initializeWorkoutActivityType` takes the raw value, and
   * a string has none. An activity this build cannot name is REFUSED rather than
   * defaulted — appleHealthWrite.ts records that the old bridge filed an
   * unrecognised activity as American Football, and inventing a sport in
   * somebody's health record is not a thing to do quietly.
   */
  saveWorkout(options: any, d: any) {
    const start = options?.startDate ? new Date(options.startDate) : new Date();
    const end = options?.endDate ? new Date(options.endDate) : start;
    const type = activityType(options?.type);
    if (type == null) {
      return d(new Error(`Apple Health has no workout type called “${String(options?.type ?? '')}”.`), null);
    }
    // Small calories in (the unit appleHealthWrite states), kilocalories out.
    const kcal = typeof options?.energyBurned === 'number' && isFinite(options.energyBurned)
      ? (String(options?.energyBurnedUnit ?? 'calorie') === 'calorie' ? options.energyBurned / 1000 : options.energyBurned)
      : null;
    const metres = typeof options?.distance === 'number' && isFinite(options.distance) ? options.distance : null;
    cb(
      saveWorkoutSample(
        type as any,
        [] as any,
        start,
        end,
        {
          ...(kcal != null && kcal > 0 ? { energyBurned: kcal } : null),
          ...(metres != null && metres > 0 ? { distance: metres } : null),
        } as any,
      )
        // The uuid, which is what react-native-health resolved and what
        // `saveOne` in appleHealthWrite.ts stores in the ledger — it takes a
        // string or nothing, and the proxy object was reaching it as nothing,
        // so every written session was recorded with no HealthKit id against it.
        .then((w: any) => (typeof w?.uuid === 'string' ? w.uuid : null)) as any,
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
