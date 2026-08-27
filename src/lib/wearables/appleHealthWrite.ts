// Writing completed Repple sessions back to Apple Health.
//
// Everything above this file reads FROM HealthKit. This is the only path that
// puts anything in, which makes it the only place in the app where a mistake
// lands in a record the person keeps for life and has to delete by hand, one
// row at a time, in Apple's Health app. The rules below are all downstream of
// that asymmetry.
//
// ── WHY THIS FILE HAS NO STATIC `react-native` IMPORT ───────────────────────
// The planning half — grouping, duration, activity, energy, distance, the
// ledger arithmetic — is pure and is covered by tests that compile under
// tsconfig.test.json and run in plain node. A top-level `import ... from
// 'react-native'` would drag the whole RN runtime into that process and the
// tests could not load the module at all. So the native bridge and AsyncStorage
// are reached through guarded lazy `require`s, exactly as `appleHealth.ts`
// already does for `react-native-health`.
import type { WorkoutEntry } from '../mockData';
import { zoneSecondsTotal } from '../hr';

/* ── 1. Sessions ───────────────────────────────────────────────────────────── */

// One session writes all of its exercises with the same `t` (documented on
// `WorkoutEntry.id`). A gym session is therefore a GROUP of rows, not a row: a
// push day is eight entries at one timestamp. Writing one HealthKit workout per
// entry would put eight workouts in Health for one trip to the gym, so the unit
// of writing is the group.

export interface SessionGroup {
  /** Idempotency key — see `sessionKey`. */
  key: string;
  /** The session's timestamp, as first seen in the log. */
  t: string;
  entries: WorkoutEntry[];
}

/**
 * The idempotency key for a session.
 *
 * It is the session timestamp, normalised through Date so that
 * `2026-08-01T10:00:00+00:00` and `2026-08-01T10:00:00.000Z` are one key rather
 * than two — a formatting difference must never read as a second session.
 *
 * WHY `t` AND NOT THE ROW IDS. Three reasons, in order of how badly each would
 * hurt:
 *   · There are N ids per session and only one workout to write, so an id-based
 *     key would have to pick one, and picking one makes the key depend on which
 *     exercise happens to sort first — which changes when a set is deleted.
 *   · `id` is assigned by the server and is ABSENT on a freshly logged entry
 *     (see `workoutLog.persist`). A key built from it would be undefined at
 *     write time and defined a second later, which is a recipe for writing the
 *     same session twice.
 *   · `t` is the identity of a session in this data model. It is stamped once,
 *     when the session is logged, and never edited afterwards.
 *
 * The trade this key makes deliberately: if a person adds a ninth exercise to
 * an already-written session, we do NOT write an updated workout — HealthKit
 * has no update-in-place for a saved workout anyway, so the only way to "fix"
 * it would be a second entry alongside the first. A missing edit is recoverable;
 * a duplicate in someone's health record is manual work for them.
 */
export function sessionKey(t: string): string {
  const ms = Date.parse(t);
  return 'hkw1|' + (Number.isFinite(ms) ? new Date(ms).toISOString() : String(t));
}

/** Group a log into sessions, newest first, preserving each session's entries. */
export function groupSessions(log: WorkoutEntry[]): SessionGroup[] {
  const by = new Map<string, SessionGroup>();
  for (const e of log) {
    if (!e || typeof e.t !== 'string' || !Number.isFinite(Date.parse(e.t))) continue;
    const key = sessionKey(e.t);
    const g = by.get(key);
    if (g) g.entries.push(e);
    else by.set(key, { key, t: e.t, entries: [e] });
  }
  return [...by.values()].sort((a, b) => Date.parse(b.t) - Date.parse(a.t));
}

/* ── 2. Duration ───────────────────────────────────────────────────────────── */

/** Where a session's length came from. Never rendered as if they were the same. */
export type DurationSource = 'zones' | 'cardio' | 'entered';

export interface SessionDuration {
  seconds: number;
  source: DurationSource;
}

export const DURATION_SOURCE_LABEL: Record<DurationSource, string> = {
  zones: 'measured from your heart rate',
  cardio: 'recorded with the cardio entry',
  entered: 'the length you entered',
};

/**
 * How long the session ran — or null, which is a real answer.
 *
 * Three sources, in this order, and nothing else:
 *   1. `zones` — seconds counted from an actual heart-rate series, so it spans
 *      the whole session including the rests. Summed across the group would
 *      double-count (the same series is attached per entry), so it is the
 *      largest, not the total.
 *   2. `cardio.mins` — the recorded length of the cardio blocks, summed: two
 *      pieces at one timestamp are consecutive parts of one session, not
 *      overlapping ones.
 *   3. `sessionMins` — what the person typed. Evidence from whoever was there.
 *
 * What is NOT here, and must never be: a nominal length for a strength session,
 * anything inferred from how long a screen was open, and anything scaled from
 * set count or volume. All three would produce a number that looks measured.
 *
 * Returning null is the point of the function. A session with no length cannot
 * be written, and the screen says so.
 */
export function sessionDuration(entries: WorkoutEntry[]): SessionDuration | null {
  let zoneSecs = 0;
  for (const e of entries) {
    if (!e.zones) continue;
    const total = zoneSecondsTotal(e.zones);
    if (Number.isFinite(total) && total > zoneSecs) zoneSecs = total;
  }
  if (zoneSecs > 0) return { seconds: Math.round(zoneSecs), source: 'zones' };

  let cardioSecs = 0;
  for (const e of entries) {
    const mins = e.cardio?.mins;
    if (typeof mins === 'number' && Number.isFinite(mins) && mins > 0) cardioSecs += mins * 60;
  }
  if (cardioSecs > 0) return { seconds: Math.round(cardioSecs), source: 'cardio' };

  for (const e of entries) {
    const mins = e.sessionMins;
    if (typeof mins === 'number' && Number.isFinite(mins) && mins > 0) {
      return { seconds: Math.round(mins * 60), source: 'entered' };
    }
  }
  return null;
}

/* ── 3. Activity ───────────────────────────────────────────────────────────── */

/**
 * The activity strings the native bridge actually understands.
 *
 * THIS SET IS A SAFETY RAIL, NOT DOCUMENTATION. `RCTAppleHealthKit
 * +Utils.m/hkWorkoutActivityTypeFromOptions` looks the string up in a dictionary
 * and, when it misses, falls back to its default argument — which
 * `workout_save` passes as `HKWorkoutActivityTypeAmericanFootball`. A typo, or a
 * value from the TypeScript `HealthActivity` enum that the Objective-C
 * dictionary happens not to carry, is therefore not an error: it is silently
 * recorded in the person's Health app as a game of American football. Every
 * string is checked against this set before it reaches the bridge, and a miss
 * refuses the write.
 *
 * Mirrors `getStringToWorkoutActivityTypeDictionary` in react-native-health
 * 1.19.0. `Other` is in the bridge but missing from the shipped `HealthActivity`
 * enum, which is why activity is typed as a plain string here.
 */
export const HK_WRITE_ACTIVITIES: ReadonlySet<string> = new Set([
  'AmericanFootball', 'Archery', 'AustralianFootball', 'Badminton', 'Baseball', 'Basketball',
  'Bowling', 'Boxing', 'Climbing', 'Cricket', 'CrossTraining', 'Curling', 'Cycling', 'Dance',
  'DanceInspiredTraining', 'Elliptical', 'EquestrianSports', 'Fencing', 'Fishing',
  'FunctionalStrengthTraining', 'Golf', 'Gymnastics', 'Handball', 'Hiking', 'Hockey', 'Hunting',
  'Lacrosse', 'MartialArts', 'MindAndBody', 'MixedMetabolicCardioTraining', 'PaddleSports', 'Play',
  'PreparationAndRecovery', 'Racquetball', 'Rowing', 'Rugby', 'Running', 'Sailing', 'SkatingSports',
  'SnowSports', 'Soccer', 'Softball', 'Squash', 'StairClimbing', 'SurfingSports', 'Swimming',
  'TableTennis', 'Tennis', 'TrackAndField', 'TraditionalStrengthTraining', 'Volleyball', 'Walking',
  'WaterFitness', 'WaterPolo', 'WaterSports', 'Wrestling', 'Yoga', 'Barre', 'CoreTraining',
  'CrossCountrySkiing', 'DownhillSkiing', 'Flexibility', 'HighIntensityIntervalTraining', 'JumpRope',
  'Kickboxing', 'Pilates', 'Snowboarding', 'Stairs', 'StepTraining', 'WheelchairWalkPace',
  'WheelchairRunPace', 'TaiChi', 'MixedCardio', 'HandCycling', 'DiscSports', 'FitnessGaming',
  'CardioDance', 'SocialDance', 'Pickleball', 'Cooldown', 'Other',
]);

/**
 * Repple's exercise vocabulary → a HealthKit activity.
 *
 * Roughly the inverse of `HK_TO_EXERCISE` in appleHealth.ts, so a session
 * imported from the watch and written back keeps the same name. Keys are
 * lower-cased; lookup is case-insensitive.
 *
 * Only unambiguous names appear. "Circuit" is not here even though the read
 * mapping folds two HealthKit types into it, because folding two into one is
 * lossless in the direction that only has to display a label and lossy in the
 * direction that writes a record.
 */
const EXERCISE_TO_HK: Record<string, string> = {
  'treadmill / run': 'Running', run: 'Running', running: 'Running', jog: 'Running',
  walk: 'Walking', walking: 'Walking', hike: 'Hiking', hiking: 'Hiking',
  cycling: 'Cycling', cycle: 'Cycling', bike: 'Cycling', 'exercise bike': 'Cycling',
  'assault bike': 'Cycling', 'air bike': 'Cycling', spin: 'Cycling', spinning: 'Cycling',
  rowing: 'Rowing', row: 'Rowing', erg: 'Rowing',
  elliptical: 'Elliptical', 'cross trainer': 'Elliptical',
  stairs: 'Stairs', stairmaster: 'StairClimbing', 'stair climber': 'StairClimbing',
  swim: 'Swimming', swimming: 'Swimming',
  yoga: 'Yoga', pilates: 'Pilates', barre: 'Barre', 'tai chi': 'TaiChi',
  core: 'CoreTraining', 'core training': 'CoreTraining',
  stretching: 'Flexibility', mobility: 'Flexibility', flexibility: 'Flexibility',
  cooldown: 'Cooldown', 'cool down': 'Cooldown',
  boxing: 'Boxing', kickboxing: 'Kickboxing', 'martial arts': 'MartialArts',
  'jump rope': 'JumpRope', skipping: 'JumpRope',
  hiit: 'HighIntensityIntervalTraining',
  climbing: 'Climbing', bouldering: 'Climbing',
  dance: 'Dance', cardio: 'MixedCardio',
  strength: 'TraditionalStrengthTraining', lifting: 'TraditionalStrengthTraining',
  weights: 'TraditionalStrengthTraining',
};

export interface SessionActivity {
  /** A string guaranteed to be in HK_WRITE_ACTIVITIES. */
  activity: string;
  /** Whether we could name the sport, or fell back to the honest generic. */
  specific: boolean;
  /** What to tell the user this will appear as. */
  label: string;
}

/** One entry's activity, or null when it does not name one we recognise. */
function entryActivity(e: WorkoutEntry): string | null {
  const name = String(e.exercise || '').trim().toLowerCase();
  const mapped = EXERCISE_TO_HK[name];
  if (mapped) return mapped;
  // A row with sets and no cardio block is resistance work. That is structure,
  // not a guess about the name: `sets` is [reps, kg] pairs and nothing else
  // in this app produces them.
  if (Array.isArray(e.sets) && e.sets.length > 0 && !e.cardio) return 'TraditionalStrengthTraining';
  return null;
}

/**
 * The activity for a whole session.
 *
 * Unanimous → that activity. Anything else — a mix of sports, or a name we do
 * not recognise — → `Other`, HealthKit's own generic. That is the honest
 * answer: a push day followed by twenty minutes on the bike is not a cycling
 * workout, and calling it one would be a guess written into a health record.
 * `specific: false` is passed to the UI so the screen can say up front that the
 * session will appear as "Other", rather than letting the person discover it in
 * the Health app afterwards.
 */
export function sessionActivity(entries: WorkoutEntry[]): SessionActivity {
  const seen = new Set<string>();
  let unmapped = false;
  for (const e of entries) {
    const a = entryActivity(e);
    if (a) seen.add(a);
    else unmapped = true;
  }
  if (!unmapped && seen.size === 1) {
    const activity = [...seen][0];
    if (HK_WRITE_ACTIVITIES.has(activity)) {
      return { activity, specific: true, label: humanActivity(activity) };
    }
  }
  return { activity: 'Other', specific: false, label: 'Other' };
}

/** "TraditionalStrengthTraining" → "Traditional Strength Training". */
export function humanActivity(a: string): string {
  return a.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/* ── 4. Energy and distance ────────────────────────────────────────────────── */

/**
 * The session's energy in kilocalories, or null.
 *
 * Written ONLY when every entry in the session carries a kcal figure. A partial
 * sum is the subtle version of inventing data: 120 kcal presented as the total
 * for a session that also contained seven unmeasured lifts is a wrong number,
 * not an incomplete one, once HealthKit has it. Omitting energy leaves the
 * workout showing no energy, which is true.
 *
 * Never an estimate from bodyweight, MET tables or duration.
 */
export function sessionKcal(entries: WorkoutEntry[]): number | null {
  if (!entries.length) return null;
  let total = 0;
  for (const e of entries) {
    const k = e.kcal;
    if (typeof k !== 'number' || !Number.isFinite(k) || k <= 0) return null;
    total += k;
  }
  return Math.round(total);
}

const KM_PER: Record<string, number> = { km: 1, k: 1, mi: 1.609344, mile: 1.609344, miles: 1.609344, m: 0.001 };

/**
 * The session's distance in metres, or null.
 *
 * Only when exactly ONE entry in the session recorded a positive distance.
 * Summing across a bike leg and a row would put a single meaningless total on a
 * workout that HealthKit is already going to file as "Other", and `dist: 0` is
 * how the watch importer spells "the device did not report one" — so zero is
 * absence here, never a measurement of standing still.
 */
export function sessionDistanceMeters(entries: WorkoutEntry[]): number | null {
  const found: number[] = [];
  for (const e of entries) {
    const c = e.cardio;
    if (!c) continue;
    const d = Number(c.dist);
    if (!Number.isFinite(d) || d <= 0) continue;
    const factor = KM_PER[String(c.unit || '').trim().toLowerCase()];
    if (factor == null) continue; // an unrecognised unit is not a distance we can state
    found.push(d * factor * 1000);
  }
  return found.length === 1 ? Math.round(found[0]) : null;
}

/* ── 5. The plan ───────────────────────────────────────────────────────────── */

export interface PlannedWorkout {
  key: string;
  t: string;
  startISO: string;
  endISO: string;
  seconds: number;
  durationSource: DurationSource;
  activity: string;
  activityLabel: string;
  activitySpecific: boolean;
  kcal: number | null;
  distanceMeters: number | null;
  /** Exercise names in the session, for the UI to identify the row by. */
  exercises: string[];
}

export type SkipCode = 'no-duration' | 'unwritable-activity' | 'already-written';

export interface SkippedSession {
  key: string;
  t: string;
  exercises: string[];
  code: SkipCode;
  /** A sentence for the user. Says what is missing; offers no substitute. */
  reason: string;
}

export interface WritePlan {
  writable: PlannedWorkout[];
  skipped: SkippedSession[];
  /** How many sessions were left out purely because they are already in Health. */
  alreadyWritten: number;
}

const names = (entries: WorkoutEntry[]) => entries.map((e) => String(e.exercise || '').trim()).filter(Boolean);

/** Turn one session into a workout to write, or a stated reason it cannot be. */
export function planSession(g: SessionGroup): PlannedWorkout | SkippedSession {
  const exercises = names(g.entries);
  const dur = sessionDuration(g.entries);
  if (!dur) {
    return {
      key: g.key, t: g.t, exercises, code: 'no-duration',
      reason: 'No length recorded. Apple Health needs a start and an end, and nothing here measured one — enter how long this session ran and it can be written.',
    };
  }
  const act = sessionActivity(g.entries);
  if (!HK_WRITE_ACTIVITIES.has(act.activity)) {
    // Unreachable via sessionActivity, which already falls back to Other. Kept
    // because the cost of it ever becoming reachable is a workout mis-filed as
    // American football by the bridge's default.
    return {
      key: g.key, t: g.t, exercises, code: 'unwritable-activity',
      reason: `Apple Health has no activity matching “${act.activity}”, so this session cannot be filed accurately.`,
    };
  }
  const startMs = Date.parse(g.t);
  return {
    key: g.key,
    t: g.t,
    startISO: new Date(startMs).toISOString(),
    endISO: new Date(startMs + dur.seconds * 1000).toISOString(),
    seconds: dur.seconds,
    durationSource: dur.source,
    activity: act.activity,
    activityLabel: act.label,
    activitySpecific: act.specific,
    kcal: sessionKcal(g.entries),
    distanceMeters: sessionDistanceMeters(g.entries),
    exercises,
  };
}

/** A session already in Health, as remembered by the ledger. */
export interface LedgerRecord {
  /** ISO timestamp of the write. */
  at: string;
  /** HealthKit's UUID for the saved workout, when the bridge returned one. */
  uuid: string | null;
  activity: string;
  seconds: number;
}
export type Ledger = Record<string, LedgerRecord>;

/**
 * What would be written, what would be skipped and why.
 *
 * Pure: the ledger is passed in rather than read, so the whole decision is
 * testable without a device.
 */
export function planWrite(log: WorkoutEntry[], ledger: Ledger): WritePlan {
  const writable: PlannedWorkout[] = [];
  const skipped: SkippedSession[] = [];
  let alreadyWritten = 0;
  for (const g of groupSessions(log)) {
    if (ledger[g.key]) { alreadyWritten++; continue; }
    const r = planSession(g);
    if ('code' in r) skipped.push(r); else writable.push(r);
  }
  return { writable, skipped, alreadyWritten };
}

/* ── 6. Reporting what happened ────────────────────────────────────────────── */

export interface WrittenSession { key: string; activityLabel: string; t: string; uuid: string | null }
export interface FailedSession { key: string; activityLabel: string; t: string; reason: string }

export type WriteResult =
  | { state: 'unavailable'; reason: string }
  | { state: 'denied'; reason: string }
  | {
      state: 'done';
      written: WrittenSession[];
      failed: FailedSession[];
      skipped: SkippedSession[];
      alreadyWritten: number;
    };

/**
 * One sentence describing the outcome, honestly.
 *
 * The rule this exists to enforce: a run in which some sessions failed must
 * never read as a success. "Wrote 5 of 9" says the number attempted and the
 * number that landed, and the caller lists the failures underneath.
 */
export function summariseResult(r: WriteResult): string {
  if (r.state === 'unavailable') return r.reason;
  if (r.state === 'denied') return r.reason;
  const attempted = r.written.length + r.failed.length;
  const parts: string[] = [];
  if (attempted === 0) {
    parts.push(r.alreadyWritten > 0 || r.skipped.length > 0
      ? 'Nothing new to write.'
      : 'No sessions to write.');
  } else if (r.failed.length === 0) {
    parts.push(`Wrote ${r.written.length} ${r.written.length === 1 ? 'session' : 'sessions'} to Apple Health.`);
  } else {
    parts.push(`Wrote ${r.written.length} of ${attempted} sessions to Apple Health — ${r.failed.length} failed.`);
  }
  if (r.alreadyWritten > 0) parts.push(`${r.alreadyWritten} already there.`);
  if (r.skipped.length > 0) {
    parts.push(`${r.skipped.length} ${r.skipped.length === 1 ? 'session has' : 'sessions have'} no recorded length and cannot be written.`);
  }
  return parts.join(' ');
}

/* ── 7. The native side ────────────────────────────────────────────────────── */

const LEDGER_KEY = 'repple.hk.written';

/**
 * Load one of the three native modules this file needs, or null if it is not
 * there. Still lazy, still never throws — but no longer dynamic.
 *
 * `require(mod)` with a variable does not survive Metro. The bundler resolves
 * requires statically at build time, so it cannot follow a name it only learns
 * at runtime, and it refuses the file outright:
 *
 *   SyntaxError: appleHealthWrite.ts:467: Invalid call at line 467: require(mod)
 *
 * That failed the Bundle JavaScript phase of EVERY production build — client,
 * coach and owner alike — while development builds carried on working, because
 * a dev client loads JS from Metro at runtime and never bundles it. So the
 * three apps could still be developed and could no longer be shipped, and
 * nothing said so until someone tried to build for the store.
 *
 * The names are literals now, one branch each, which is what lets Metro see
 * them. The try/catch stays: on a build where a module genuinely is absent,
 * this must return null rather than take the app down.
 */
type NativeMod = 'storage' | 'react-native' | 'health';

function lazy(mod: NativeMod): any {
  try {
    let m: any = null;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    if (mod === 'storage') m = require('@react-native-async-storage/async-storage');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    else if (mod === 'react-native') m = require('react-native');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    else if (mod === 'health') m = require('react-native-health');
    return m?.default ?? m;
  } catch {
    return null;
  }
}

function storage(): any {
  const s = lazy('storage');
  return s && typeof s.getItem === 'function' ? s : null;
}

/** The sessions already written, remembered across launches. Never throws. */
export async function readLedger(): Promise<Ledger> {
  const s = storage();
  if (!s) return {};
  try {
    const raw = await s.getItem(LEDGER_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Ledger) : {};
  } catch {
    return {};
  }
}

/**
 * Record a write BEFORE trusting anything else to remember it.
 *
 * Written one session at a time rather than batched at the end: if the app is
 * killed mid-run, everything already in Health is already in the ledger, and
 * the next run does not duplicate it.
 */
async function appendLedger(key: string, rec: LedgerRecord): Promise<void> {
  const s = storage();
  if (!s) return;
  try {
    const led = await readLedger();
    led[key] = rec;
    await s.setItem(LEDGER_KEY, JSON.stringify(led));
  } catch {
    /* a ledger we cannot persist is handled by the caller refusing to continue */
  }
}

/** Whether the ledger can actually be persisted here. */
export function ledgerAvailable(): boolean {
  return storage() != null;
}

function nativeHk(): any {
  const rn = lazy('react-native');
  if (!rn || rn.Platform?.OS !== 'ios') return null;
  if (!rn.NativeModules?.AppleHealthKit) return null;
  const k = lazy('health');
  return k && typeof k.saveWorkout === 'function' ? k : null;
}

/** Why writing is impossible in this binary, or null if it is possible. */
export function writeUnavailableReason(): string | null {
  const rn = lazy('react-native');
  if (!rn) return 'Apple Health is only available in the Repple app.';
  if (rn.Platform?.OS !== 'ios') return 'Writing to Apple Health is iPhone-only — Health does not exist on this platform.';
  if (!rn.NativeModules?.AppleHealthKit) {
    return 'Needs the Repple app build. HealthKit is native code and is not present in Expo Go or the iOS Simulator without it.';
  }
  if (!nativeHk()) return 'The Apple Health module in this build cannot save workouts. A newer build is needed.';
  if (!ledgerAvailable()) {
    return 'Repple cannot remember what it has already written on this device, so it will not write — the risk is duplicate workouts you would have to delete by hand.';
  }
  return null;
}

/** Save one workout. Resolves with the HealthKit UUID, or rejects with a reason. */
function saveOne(p: PlannedWorkout): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const k = nativeHk();
    if (!k) return reject(new Error('The Apple Health module is not available.'));
    if (!HK_WRITE_ACTIVITIES.has(p.activity)) {
      // Second guard on purpose. The bridge turns an unknown activity into
      // American football rather than an error, so this must never get through.
      return reject(new Error(`Refusing to write an activity Apple Health does not define (“${p.activity}”).`));
    }
    const options: Record<string, unknown> = {
      type: p.activity,
      startDate: p.startISO,
      endDate: p.endISO,
    };
    if (p.kcal != null) {
      // react-native-health's unit table has `calorie` (a small calorie) and no
      // `kilocalorie`, and an unrecognised unit makes the bridge drop the
      // quantity silently. 1 kcal is exactly 1000 cal, so this conversion is
      // lossless — and passing the kcal figure with unit `calorie` would have
      // filed a 400 kcal session as 0.4 kcal.
      options.energyBurned = p.kcal * 1000;
      options.energyBurnedUnit = 'calorie';
    }
    if (p.distanceMeters != null) {
      options.distance = p.distanceMeters;
      options.distanceUnit = 'meter';
    }
    try {
      k.saveWorkout(options, (err: any, res: any) => {
        if (err) return reject(new Error(typeof err === 'string' ? err : err?.message || 'Apple Health refused the write.'));
        resolve(typeof res === 'string' ? res : null);
      });
    } catch (e: any) {
      reject(new Error(e?.message || 'Apple Health refused the write.'));
    }
  });
}

/**
 * Write every writable session in the log that is not already in Health.
 *
 * Nothing here happens on its own — the caller is a button the person pressed.
 *
 * `auth` is passed in rather than queried so this stays testable and so the
 * screen decides how to ask. A denial is a state, not an error: the person is
 * allowed to say no, and the result says so plainly instead of throwing.
 */
export async function writeSessions(
  log: WorkoutEntry[],
  auth: 'granted' | 'denied' | 'undetermined' | 'unknown',
  onProgress?: (done: number, total: number) => void,
): Promise<WriteResult> {
  const blocked = writeUnavailableReason();
  if (blocked) return { state: 'unavailable', reason: blocked };
  if (auth === 'denied') {
    return {
      state: 'denied',
      reason: 'Apple Health is not allowing Repple to add workouts. Turn it on in Health ▸ Sharing ▸ Apps ▸ Repple ▸ Workouts, then try again.',
    };
  }

  const ledger = await readLedger();
  const plan = planWrite(log, ledger);
  const written: WrittenSession[] = [];
  const failed: FailedSession[] = [];

  let done = 0;
  for (const p of plan.writable) {
    try {
      const uuid = await saveOne(p);
      // Ledger first-and-immediately: the workout exists in Health from the
      // moment the callback fires, whatever happens to the rest of this loop.
      await appendLedger(p.key, { at: new Date().toISOString(), uuid, activity: p.activity, seconds: p.seconds });
      written.push({ key: p.key, activityLabel: p.activityLabel, t: p.t, uuid });
    } catch (e: any) {
      failed.push({ key: p.key, activityLabel: p.activityLabel, t: p.t, reason: e?.message || 'Apple Health refused the write.' });
    }
    onProgress?.(++done, plan.writable.length);
  }

  return { state: 'done', written, failed, skipped: plan.skipped, alreadyWritten: plan.alreadyWritten };
}
