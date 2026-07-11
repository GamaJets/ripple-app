// ── Progressive-overload engine ──────────────────────────────────────────────
// Turns the workout history into a recommended next working weight per exercise,
// so the program auto-adjusts instead of staying static. Pure + deterministic.
import type { WorkoutEntry } from './mockData';
import { est1RM } from './streaks';

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

/**
 * Recommend the next working weight from the last session's sets.
 * If the top set reached the top of the rep range, add an increment (overload);
 * otherwise hold the weight and chase more reps first.
 */
export function suggestNextWeight(
  lastSets: [number, number][] | undefined,
  range: RepRange | null,
  increment = 2.5
): Suggestion | null {
  if (!lastSets || lastSets.length === 0) return null;
  let topW = 0, repsAtTop = 0;
  for (const [r, w] of lastSets) {
    if (w > topW) { topW = w; repsAtTop = r; }
    else if (w === topW && r > repsAtTop) repsAtTop = r;
  }
  if (topW <= 0) return null;
  const round = (n: number) => Math.round(n * 2) / 2; // nearest 0.5 kg
  if (range && repsAtTop >= range.high) {
    return { weight: round(topW + increment), up: true, reason: `You hit ${repsAtTop} reps at ${topW}kg — add ${increment}kg` };
  }
  return { weight: round(topW), up: false, reason: range ? `Match ${topW}kg, aim for ${range.high} reps` : `Match last: ${topW}kg` };
}

/** Convenience: suggestion for one program exercise given the log. */
export function suggestForExercise(log: WorkoutEntry[], exerciseName: string, reps: string, increment = 2.5): Suggestion | null {
  return suggestNextWeight(lastSetsFor(log, exerciseName), parseRepRange(reps), increment);
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
