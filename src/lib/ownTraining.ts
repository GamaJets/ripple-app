// Reading a workout log back as days, and a day's sets back as one line.
//
// Both of these are wanted by the coach's own training screen
// (app/(trainer)/my-training.tsx), and both are the kind of thing that is
// obvious to write inline and quietly wrong once it ships, so they live here
// where a test can hold them.
//
// ── Why the grouping is not `e.t.slice(0, 10)` ─────────────────────────────
//
// A workout's `performed_at` is a timestamp, not a date, and slicing the first
// ten characters off an ISO string reads it in UTC. src/lib/localDate.ts
// documents what that costs: west of Greenwich an evening session lands on the
// following day, so a coach who trained on Friday night in New York is shown
// two Saturdays and no Friday. `dayKeyOf` reads the instant in the reader's own
// zone, which is the day they actually trained on, and it is reused here rather
// than re-derived.
//
// An entry whose timestamp cannot be read is DROPPED rather than filed under
// today. A row with a broken date is not a session that happened this morning,
// and putting it there would invent a training day out of a parsing failure.
//
// ── Why the sets line collapses runs ───────────────────────────────────────
//
// A `sets` array is one pair per set, so five sets of eight is five identical
// entries. Printed one by one that is "8 × 60 kg · 8 × 60 kg · 8 × 60 kg · …",
// which is how nobody writes down a workout. Consecutive identical pairs
// collapse to "5 × 8 @ 60 kg" — the "@" deliberately, not a second separator;
// see the note beside the line that builds it, which explains why " · " is
// reserved for BETWEEN groups. (This example read "5 × 8 · 60 kg", using the
// group separator for the load and contradicting that reasoning seventy lines
// before it was given.) Only CONSECUTIVE pairs merge, because a drop set
// that comes back up to the opening weight is a different session from one that
// did not, and merging across the gap would hide it.
import type { WorkoutEntry } from './mockData';
import { dayKeyOf } from './entryEdit';
import { liftLabel, type WeightUnit } from './units';

/** A local calendar day and everything logged on it, newest entry first. */
export interface TrainingDay {
  /** `YYYY-MM-DD` in the reader's own timezone. */
  day: string;
  entries: WorkoutEntry[];
}

/**
 * A log split into the days it was performed on, newest day first.
 *
 * The order is stated rather than inherited. `useWorkoutLog` already hands back
 * newest-first rows, but a screen that renders "Today" at the top must not be
 * relying on the provider's ORDER BY staying what it is — a reversed page would
 * silently put last month at the top of a screen headed "Recent".
 */
export function trainingDays(log: WorkoutEntry[]): TrainingDay[] {
  const byDay = new Map<string, WorkoutEntry[]>();
  for (const e of log) {
    const day = dayKeyOf(e.t);
    if (!day) continue;
    const bucket = byDay.get(day);
    if (bucket) bucket.push(e);
    else byDay.set(day, [e]);
  }
  return [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, entries]) => ({
      day,
      // Newest first inside the day too, so an exercise added five minutes ago
      // is at the top of the day it belongs to rather than the bottom.
      entries: [...entries].sort((x, y) => Date.parse(y.t) - Date.parse(x.t)),
    }));
}

/**
 * One line describing what was actually lifted, in the unit the reader has
 * chosen. Null when there is nothing to describe.
 *
 * Null rather than an empty string, and null rather than "0 sets": a cardio
 * entry carries no `sets` at all, and a screen handed "" would render a blank
 * where it expected a sentence. The caller decides what absence looks like.
 *
 * A load of zero is a bodyweight set — pull-ups, press-ups — and prints as the
 * reps alone. units.ts says the same thing from the other side: `liftIn` keeps
 * a 0 rather than nulling it, precisely so the screens can tell "no external
 * load" from "nobody recorded the load", and printing "8 × 0 kg" would state a
 * weight that was never on the bar.
 */
export function setsSummary(
  sets: [number, number][] | undefined | null,
  unit: WeightUnit,
): string | null {
  if (!sets || !sets.length) return null;
  const parts: string[] = [];
  let i = 0;
  while (i < sets.length) {
    const [reps, kg] = sets[i];
    let run = 1;
    while (i + run < sets.length && sets[i + run][0] === reps && sets[i + run][1] === kg) run++;
    // `kg` may be 0, null or undefined off a jsonb column that has held all
    // three. Only a real, positive load gets printed.
    const load = kg ? liftLabel(kg, unit) : null;
    // Sets × reps @ load, which is how it is written on a gym notepad. The "@"
    // rather than a second "×" so that "3 × 8 @ 60 kg" cannot be read as three
    // multiplications, and " · " between groups so the two separators never
    // stand for the same relationship.
    parts.push(load ? `${run} × ${reps} @ ${load}` : `${run} × ${reps}`);
    i += run;
  }
  return parts.join(' · ');
}
