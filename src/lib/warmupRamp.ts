// The sets you do before the set that counts.
//
// ── what this is for ──────────────────────────────────────────────────────
//
// Hevy, Strong and JEFIT all offer a warm-up ladder off the working weight,
// and the reason is not that the arithmetic is hard. It is that it is done
// standing at a rack, between sets, by somebody whose attention is on the next
// lift — and the failure mode is not a wrong number, it is skipping the warm-up
// because working three percentages out was one thing too many.
//
// Repple already had both halves and never joined them: `setMethods.ts` has a
// `warmup` tag for labelling a set as one, and `app/(client)/tools.tsx` prints
// a percentage table off an estimated 1RM. Neither answers "what do I actually
// put on the bar first".
//
// ── why the percentages are of the WORKING weight ─────────────────────────
//
// Not of a one-rep max. A lifter knows what they are about to lift for their
// top set — it is on the plan, or it is what they did last week — and most
// never compute a 1RM at all. Taking the ramp off the working weight means the
// answer is available on every lift, including the ones where a 1RM is
// meaningless (a dumbbell lateral raise has no honest single).
//
// ── the rounding is the whole feature ─────────────────────────────────────
//
// 40% of 102.5 kg is 41, and 41 kg cannot be loaded on a barbell. A ramp of
// numbers you cannot make is worse than no ramp: it is read once, found to be
// nonsense, and the feature is never opened again. Every rung is rounded to
// something the equipment can actually hold, and the caller says what the
// smallest jump is because that is a fact about the gym's plates and not about
// the lifter.
//
// Bodyweight and machine work are refused rather than approximated — see
// `warmupRamp`'s own contract. A machine's stack is not a set of plates and its
// increments are whatever the manufacturer chose.

/** One rung of the ladder. */
export interface WarmupSet {
  /** What to load, in the same unit the working weight was given in. */
  weight: number;
  /** How many reps. Fewer as the weight rises — the point is to warm the
   *  movement, not to spend the session on it. */
  reps: number;
  /** The share of the working weight this rung is, for the label. Whole. */
  pct: number;
}

/**
 * The ladder, in the order it is performed.
 *
 * The shape is the one every strength coach writes down and it is deliberately
 * not configurable: four rungs at 40/55/70/85 per cent, dropping from eight
 * reps to two. A screen offering a choice of ramp schemes is a screen asking a
 * question the lifter opened it to avoid.
 *
 * `step` is the smallest change the equipment can make — 2.5 kg for a barbell
 * with the usual plates, 5 lb imperial, and a caller with fractional plates can
 * say so. Every rung is rounded DOWN to a multiple of it: a rung that rounds up
 * can exceed the next rung on a light working weight, producing a ladder that
 * goes backwards.
 *
 * Returns an empty array, never a fabricated ladder, when:
 *
 *   · the working weight is not a positive finite number — nothing to take a
 *     share of;
 *   · the step is not positive — the caller does not know the equipment, and a
 *     ramp rounded to nothing is a list of unloadable numbers;
 *   · the working weight is at or below two steps — there is no room for a
 *     ladder under it, and "warm up with the empty bar" is advice this module
 *     cannot give because it does not know what the bar weighs.
 *
 * Rungs that collapse onto the same loadable weight are dropped, so a light
 * lift gives two or three rungs rather than four identical ones.
 */
export function warmupRamp(workingWeight: number, step: number): WarmupSet[] {
  if (!Number.isFinite(workingWeight) || workingWeight <= 0) return [];
  if (!Number.isFinite(step) || step <= 0) return [];
  // Two steps of headroom. Below that the rungs cannot be told apart from each
  // other or from the working set.
  if (workingWeight <= step * 2) return [];

  const RUNGS: Array<{ pct: number; reps: number }> = [
    { pct: 40, reps: 8 },
    { pct: 55, reps: 5 },
    { pct: 70, reps: 3 },
    { pct: 85, reps: 2 },
  ];

  const out: WarmupSet[] = [];
  let last = 0;
  for (const r of RUNGS) {
    // Down, not nearest: see the header. A rung that rounds up can land on or
    // above the rung after it.
    const raw = (workingWeight * r.pct) / 100;
    const weight = Math.floor(raw / step) * step;
    // Rounding leaves some rungs equal on a light lift, and a ladder with the
    // same weight twice reads as a mistake in the app rather than as a short
    // ladder. Only strictly heavier rungs are kept.
    if (weight <= last) continue;
    // Never at or above the working set: that is not a warm-up, it is the set.
    if (weight >= workingWeight) continue;
    out.push({ weight, reps: r.reps, pct: r.pct });
    last = weight;
  }
  return out;
}

/**
 * The sentence under the ladder, or null when there is no ladder.
 *
 * Separate from the rungs because it is about what this app is NOT saying: the
 * ramp is a convention, not a prescription derived from the lifter, and a
 * screen that prints four weights with no such line reads as instruction.
 */
export function warmupNote(sets: WarmupSet[], unit: string): string | null {
  if (!sets.length) return null;
  return `A common ramp to ${sets[sets.length - 1].pct}% before your working set, rounded down to the nearest ${unit} you can load. Take as long as you need between them.`;
}

/**
 * Why there is no ladder, for a screen that has to say something.
 *
 * Four causes and they are not the same. "Too light to ramp" is a fact about
 * the lift; the other three are facts about what the screen was given, and a
 * lifter should not be told their lift is too light when the truth is that
 * nobody typed a weight.
 */
export function warmupRefusal(workingWeight: number, step: number): string | null {
  if (!Number.isFinite(workingWeight) || workingWeight <= 0) {
    return 'Type the weight of your working set and the ramp appears.';
  }
  if (!Number.isFinite(step) || step <= 0) {
    return 'This needs to know the smallest plate change you can make before it can suggest weights you could actually load.';
  }
  if (workingWeight <= step * 2) {
    return 'That is light enough that a ramp would not change the weight much. Do a set or two of the movement and go.';
  }
  return null;
}
