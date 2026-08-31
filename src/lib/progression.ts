// Auto-progression — reads the workout log and suggests the next-session target
// for each strength lift using a "double progression" rule: work within a rep
// range, and when the top set clears the top of the range across the session,
// add load and reset reps; if it's mid-range, chase one more rep at the same
// weight; if it's low, hold or ease back. Pure functions over the log → OTA,
// and unit-testable. Cardio and bodyweight-only entries are skipped.
import type { WorkoutEntry } from './mockData';
import { est1RM } from './streaks';
import { liftLabel, liftDeltaIn, plain, type WeightUnit } from './units';

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

/**
 * ── Why this takes a unit, and why it has no default ──────────────────────
 *
 * `rationale` is prose a member reads, and it was built here with "kg" written
 * into the template — seven times. A member set to pounds opened Targets and
 * read "Target Load 132 lb" in the panel with "In range at 60kg" printed
 * directly underneath it: one lift, two units, one card. Nothing was stored
 * wrong, which is why it survived so long.
 *
 * The parameter is `unit?: WeightUnit` and NOT `unit: WeightUnit = 'kg'`. A
 * default here would be the same defect wearing a parameter — `money()` in
 * src/lib/gymRecord.ts lost its `= 'AED'` for exactly this reason, and this is
 * a pure module with no member in scope to guess about. Every caller that
 * renders `rationale` passes the member's own unit; a caller that has none gets
 * a sentence with the LOAD left out rather than a sentence in a unit nobody
 * chose. The unit-free wording is deliberately still useful advice ("repeat the
 * same weight and build reps") rather than a dash, because unlike an amount of
 * money, the coaching decision does not depend on the unit at all.
 *
 * The DECISION is untouched: the increment ladder stays metric — 2.5 kg is a
 * plate pair, not a converted number — and `lastWeight` / `nextWeight` stay
 * kilograms, because the Targets screen renders them through `liftIn` and the
 * workout log is metric. Only the wording moves.
 */
export function suggestProgression(
  log: WorkoutEntry[],
  unit?: WeightUnit,
  topRange = 12,
  bottomRange = 8,
): ProgressionTip[] {
  /** A stored load as the member reads it, or null when nobody has told us how
   *  they read. Null is what selects the unit-free wording below. */
  const load = (kg: number) => (unit ? liftLabel(kg, unit) : null);
  /** A progression step as the member reads it. Converted as a SPAN, so a
   *  2.5 kg bump is "5.5 lb" every week rather than 5 or 6 depending on where
   *  the two loads happened to sit inside their rounding. */
  const bump = (kg: number) => {
    if (!unit) return null;
    const v = liftDeltaIn(kg, unit);
    return v == null ? null : `${plain(v)} ${unit}`;
  };
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

    const at = load(lastWeight);
    let action: ProgressAction, nextWeight = lastWeight, nextReps = `${bottomRange}-${topRange}`, rationale = '';
    if (allClearedTop) {
      action = 'increase';
      nextWeight = Math.round((lastWeight + step(exercise)) * 2) / 2;
      nextReps = `${bottomRange}-${topRange}`;
      const add = bump(step(exercise));
      rationale = `Cleared ${topRange}+ reps on every top set — add ${add ?? 'a step'} and reset to ${bottomRange}.`;
    } else if (lastReps >= bottomRange) {
      action = 'reps';
      nextWeight = lastWeight;
      nextReps = `${Math.min(topRange, lastReps + 1)}+`;
      rationale = `In range${at ? ` at ${at}` : ''} — hold the weight and chase one more rep (aim ${Math.min(topRange, lastReps + 1)}).`;
    } else if (lastReps >= Math.max(3, bottomRange - 3)) {
      action = 'hold';
      nextWeight = lastWeight;
      nextReps = `${bottomRange}-${topRange}`;
      rationale = `Just under range — repeat ${at ?? 'the same weight'} and build reps before adding load.`;
    } else {
      action = 'deload';
      nextWeight = Math.round((lastWeight * 0.9) * 2) / 2;
      nextReps = `${bottomRange}-${topRange}`;
      // The figure named is the one the card shows as the target, not a second
      // rounding of the same 10% — two numbers a rep apart on one card is how a
      // member decides the suggestion is guesswork.
      const easeTo = load(nextWeight);
      rationale = easeTo
        ? `Reps fell off — ease to ~${easeTo} and rebuild.`
        : 'Reps fell off — ease off about 10% and rebuild.';
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
      rationale = `Cleared the range but the top sets felt hard — hold ${at ?? 'the same weight'} and bank the reps before adding load.`;
    } else if (feltHard && action === 'reps') {
      action = 'hold'; nextWeight = lastWeight; nextReps = `${bottomRange}-${topRange}`;
      rationale = `In range but it felt hard — repeat ${at ?? 'the same weight'} to consolidate before progressing.`;
    } else if (feltEasy && action === 'reps') {
      action = 'increase'; nextWeight = Math.round((lastWeight + step(exercise)) * 2) / 2; nextReps = `${bottomRange}-${topRange}`;
      rationale = `In range and every top set felt easy — add ${bump(step(exercise)) ?? 'a step'} now.`;
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
  // No `= 'kg'`. That default was an invented unit in a pure module — the same
  // shape as `money(cents, currency = 'AED')`, which this codebase already had
  // to unpick after it reached disk. An omitted unit now means "nobody has told
  // us how this member reads", and the sentence below leaves the load out
  // rather than stating it in a unit nobody chose.
  unit?: WeightUnit,
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
  const read = (kg: number) => (unit ? liftLabel(kg, unit) : null);
  const top = read(topW);
  if (range && repsAtTop >= range.high) {
    const add = unit ? `${plain(liftDeltaIn(increment, unit) ?? increment)} ${unit}` : 'a step';
    return {
      weight: round(topW + increment),
      up: true,
      reason: `You hit ${repsAtTop} reps at ${top ?? 'your top weight'} — add ${add}`,
    };
  }
  return {
    weight: round(topW),
    up: false,
    reason: range
      ? `Match ${top ?? 'your last top weight'}, aim for ${range.high} reps`
      : `Match last: ${top ?? 'your last top weight'}`,
  };
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
export function suggestForExercise(log: WorkoutEntry[], exerciseName: string, reps: string, increment = 2.5, unit?: WeightUnit): Suggestion | null {
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
