// Auto-progression — reads the workout log and suggests the next-session target
// for each strength lift using a "double progression" rule: work within a rep
// range, and when the top set clears the top of the range across the session,
// add load and reset reps; if it's mid-range, chase one more rep at the same
// weight; if it's low, hold or ease back. Pure functions over the log → OTA,
// and unit-testable. Cardio and bodyweight-only entries are skipped.
import type { WorkoutEntry } from './mockData';
import { est1RM } from './streaks';
import { liftLabel, liftDeltaIn, type WeightUnit } from './units';

export type ProgressAction = 'increase' | 'reps' | 'hold' | 'deload';

export interface ProgressionTip {
  exercise: string;
  lastWeight: number;   // heaviest working weight last session
  lastReps: number;     // reps achieved at that weight (best set)
  nextWeight: number;   // suggested load next session
  nextReps: string;     // suggested rep target next session
  action: ProgressAction;
  rationale: string;
  at: string;           // ISO of the session this is based on
}

// Lower-body / big compounds tolerate bigger jumps than small isolation lifts.
const BIG = /squat|deadlift|leg press|hip thrust|lunge|row|bench|pull-up|pulldown|press/i;
const SMALL = /curl|raise|fly|pushdown|extension|face pull|calf|crunch|plank/i;

const step = (name: string): number => (SMALL.test(name) && !BIG.test(name) ? 2.5 : BIG.test(name) ? 5 : 2.5);

// Group the log by exercise, newest session first, keeping only weighted sets.
function latestByExercise(log: WorkoutEntry[]): Map<string, WorkoutEntry> {
  const seen = new Map<string, WorkoutEntry>();
  const sorted = [...log].sort((a, b) => Date.parse(b.t) - Date.parse(a.t));
  for (const e of sorted) {
    if (!e.sets || !e.sets.length) continue;
    if (!e.sets.some(([r, w]) => (w ?? 0) > 0 && (r ?? 0) > 0)) continue;
    if (!seen.has(e.exercise)) seen.set(e.exercise, e);
  }
  return seen;
}

export function suggestProgression(log: WorkoutEntry[], topRange = 12, bottomRange = 8): ProgressionTip[] {
  const latest = latestByExercise(log);
  const tips: ProgressionTip[] = [];
  for (const [exercise, e] of latest) {
    const working = (e.sets || []).filter(([r, w]) => (w ?? 0) > 0 && (r ?? 0) > 0) as [number, number][];
    if (!working.length) continue;
    // Heaviest weight used, and the best reps achieved at that weight.
    const lastWeight = Math.max(...working.map(([, w]) => w));
    const atTop = working.filter(([, w]) => w === lastWeight);
    const lastReps = Math.max(...atTop.map(([r]) => r));
    // Did every top-weight set clear the top of the range?
    const allClearedTop = atTop.every(([r]) => r >= topRange);

    let action: ProgressAction, nextWeight = lastWeight, nextReps = `${bottomRange}-${topRange}`, rationale = '';
    if (allClearedTop) {
      action = 'increase';
      nextWeight = Math.round((lastWeight + step(exercise)) * 2) / 2;
      nextReps = `${bottomRange}-${topRange}`;
      rationale = `Cleared ${topRange}+ reps on every top set — add ${step(exercise)}kg and reset to ${bottomRange}.`;
    } else if (lastReps >= bottomRange) {
      action = 'reps';
      nextWeight = lastWeight;
      nextReps = `${Math.min(topRange, lastReps + 1)}+`;
      rationale = `In range at ${lastWeight}kg — hold the weight and chase one more rep (aim ${Math.min(topRange, lastReps + 1)}).`;
    } else if (lastReps >= Math.max(3, bottomRange - 3)) {
      action = 'hold';
      nextWeight = lastWeight;
      nextReps = `${bottomRange}-${topRange}`;
      rationale = `Just under range — repeat ${lastWeight}kg and build reps before adding load.`;
    } else {
      action = 'deload';
      nextWeight = Math.round((lastWeight * 0.9) * 2) / 2;
      nextReps = `${bottomRange}-${topRange}`;
      rationale = `Reps fell off — ease to ~${Math.round(lastWeight * 0.9)}kg and rebuild.`;
    }
    // RPE / "felt" signal: the hardest feel logged on the top-weight sets (captured
    // per set in session mode) governs how aggressively to progress.
    const feels = e.feel || [];
    const topFeels = (e.sets || [])
      .map((s, i) => ({ w: s[1], r: s[0], f: feels[i] }))
      .filter((x) => x.w === lastWeight && x.r > 0 && !!x.f)
      .map((x) => x.f);
    const feltHard = topFeels.includes('hard');
    const feltEasy = topFeels.length > 0 && topFeels.every((f) => f === 'easy');
    if (feltHard && action === 'increase') {
      action = 'reps'; nextWeight = lastWeight; nextReps = `${Math.min(topRange, lastReps)}+`;
      rationale = `Cleared the range but the top sets felt hard — hold ${lastWeight}kg and bank the reps before adding load.`;
    } else if (feltHard && action === 'reps') {
      action = 'hold'; nextWeight = lastWeight; nextReps = `${bottomRange}-${topRange}`;
      rationale = `In range but it felt hard — repeat ${lastWeight}kg to consolidate before progressing.`;
    } else if (feltEasy && action === 'reps') {
      action = 'increase'; nextWeight = Math.round((lastWeight + step(exercise)) * 2) / 2; nextReps = `${bottomRange}-${topRange}`;
      rationale = `In range and every top set felt easy — add ${step(exercise)}kg now.`;
    } else if (feltEasy && action === 'increase') {
      rationale = rationale + ' Top sets felt easy — add with confidence.';
    }
    tips.push({ exercise, lastWeight, lastReps, nextWeight, nextReps, action, rationale, at: e.t });
  }
  // Show the biggest lifts first (proxy: heaviest last weight).
  return tips.sort((a, b) => b.lastWeight - a.lastWeight);
}

// ── Legacy progressive-overload API (used by the Train tab & workout player) ──
// Preserved from the original progression module so workouts.tsx keeps working.

export interface RepRange { low: number; high: number }

/** Parse a program rep target: "6-8" → {6,8}; "12" → {12,12}; "45 sec" → null. */
export function parseRepRange(reps: string): RepRange | null {
  const m = reps.match(/(\d+)\s*-\s*(\d+)/);
  if (m) return { low: +m[1], high: +m[2] };
  const s = reps.match(/^\s*(\d+)\s*$/);
  if (s) return { low: +s[1], high: +s[1] };
  return null;
}

/** Most-recent logged sets for a given exercise name (newest entry wins). */
export function lastSetsFor(log: WorkoutEntry[], exerciseName: string): [number, number][] | undefined {
  const entries = log.filter((e) => e.exercise === exerciseName && e.sets && e.sets.length).sort((a, b) => b.t.localeCompare(a.t));
  return entries[0]?.sets;
}

export interface Suggestion { weight: number; up: boolean; reason: string }

/** Recommend the next working weight from the last session's sets. */
export function suggestNextWeight(
  lastSets: [number, number][] | undefined,
  range: RepRange | null,
  increment = 2.5,
  unit: WeightUnit = 'kg',
): Suggestion | null {
  if (!lastSets || lastSets.length === 0) return null;
  let topW = 0, repsAtTop = 0;
  for (const [r, w] of lastSets) {
    if (w > topW) { topW = w; repsAtTop = r; }
    else if (w === topW && r > repsAtTop) repsAtTop = r;
  }
  if (topW <= 0) return null;
  const round = (n: number) => Math.round(n * 2) / 2;
  // `weight` stays kilograms — it is fed straight back into the log, the
  // warm-up ramp and the PR check, all of which are metric. Only `reason` is
  // prose, and prose is read rather than computed on.
  const read = (kg: number) => liftLabel(kg, unit) ?? `${kg} ${unit}`;
  if (range && repsAtTop >= range.high) {
    return { weight: round(topW + increment), up: true, reason: `You hit ${repsAtTop} reps at ${read(topW)} — add ${liftDeltaIn(increment, unit) ?? increment} ${unit}` };
  }
  return { weight: round(topW), up: false, reason: range ? `Match ${read(topW)}, aim for ${range.high} reps` : `Match last: ${read(topW)}` };
}

/**
 * Convenience: suggestion for one program exercise given the log.
 *
 * ── Why this takes a unit ───────────────────────────────────────────────────
 *
 * `weight` has always been kilograms and the Train tab has always rendered it
 * through `liftLabel`, so the number a pounds member reads was right. The
 * SENTENCE beside it was not: `reason` was built here with "kg" written into
 * it, so a member set to pounds saw "132 lb" and, immediately to its right,
 * "You hit 8 reps at 60kg — add 2.5kg". Two figures for the same lift, in two
 * units, on one line, in front of their coach — and the one in kilograms looks
 * like the app has lost track of what they lift.
 *
 * The unit is a reading convention only. Nothing about the DECISION changes:
 * the increment ladder stays metric (see `feelStep` in the session runner for
 * why a second, imperial ladder would be a second progression model), and what
 * moves is the wording.
 */
export function suggestForExercise(log: WorkoutEntry[], exerciseName: string, reps: string, increment = 2.5, unit: WeightUnit = 'kg'): Suggestion | null {
  return suggestNextWeight(lastSetsFor(log, exerciseName), parseRepRange(reps), increment, unit);
}

/** Best estimated-1RM ever recorded for an exercise (for live PR detection). */
export function priorBest1RM(log: WorkoutEntry[], exerciseName: string): number {
  let best = 0;
  for (const e of log) {
    if (e.exercise !== exerciseName || !e.sets) continue;
    for (const [r, w] of e.sets) if (w && r) best = Math.max(best, est1RM(w, r));
  }
  return best;
}
