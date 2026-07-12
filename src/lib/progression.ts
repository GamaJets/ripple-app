// Auto-progression — reads the workout log and suggests the next-session target
// for each strength lift using a "double progression" rule: work within a rep
// range, and when the top set clears the top of the range across the session,
// add load and reset reps; if it's mid-range, chase one more rep at the same
// weight; if it's low, hold or ease back. Pure functions over the log → OTA,
// and unit-testable. Cardio and bodyweight-only entries are skipped.
import type { WorkoutEntry } from './mockData';
import { est1RM } from './streaks';

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
    tips.push({ exercise, lastWeight, lastReps, nextWeight, nextReps, action, rationale, at: e.t });
  }
  // Show the biggest lifts first (proxy: heaviest last weight).
  return tips.sort((a, b) => b.lastWeight - a.lastWeight);
}
