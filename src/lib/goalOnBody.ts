// The one sentence a body screen puts under a figure to say what it is aiming at.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// `goalTargets.ts` has computed target, remaining and reached for a while, and
// `goalTracker` has stored them on the server for a while, and `useGoalTracker`
// was imported by exactly two screens: Goals, and Nutrition. So a member could
// set a target weight and then look at Composition Trends — the screen whose
// entire subject is their weight moving — and find no mention of it. Their
// scan history, their charts and the number they are working toward were three
// facts in two places that never met.
//
// Pure, and separate from both screens, for the reason this codebase keeps
// re-learning: two screens deriving the same sentence separately is two
// sentences, and the second one is always the one that gets it wrong. Progress
// and Composition Trends have already disagreed once about the same body on the
// same day (see the header of app/(client)/body-trends.tsx), and that is
// precisely the pair of screens this line goes on.
//
// ── What it will not say ───────────────────────────────────────────────────
//
// It returns null rather than inventing anything, in four cases, and each of
// them is a claim it would otherwise be making:
//
//   · no goal for this metric — saying "no target" would be fine, but this
//     module cannot tell "you have set none" from "we could not read them",
//     and the caller can. So the caller owns that sentence and this owns the
//     one that needs a target to exist.
//   · a custom goal, which is a sentence and not a number. Percentages of
//     sentences are how "progress" stops meaning anything (goalTargets.ts).
//   · no readings, so there is nothing to be a distance from.
//   · a remaining distance too small to show at the grain it prints in. "0.0 kg
//     to go" is not a target, it is a rounding artefact standing where an
//     achievement should be, and it reads as being stuck one decimal short
//     forever.
import { progressOf, type GoalTarget, type Point } from './goalTargets';
import type { WeightUnit } from './units';
import { weightIn } from './units';

export interface GoalOnBody {
  /** The target itself, in the reader's unit, for printing beside the figure. */
  target: number;
  /** The unit `target` and `remaining` are stated in — 'kg', 'lb' or '%'. */
  unit: string;
  /**
   * How far there is still to go, ALWAYS POSITIVE and always in `unit`.
   *
   * Unsigned deliberately. `deltaLabel` is the house rule for a signed movement
   * and this is not one: "3.2 kg to go" is a distance, and rendering it as
   * "-3.2 kg" would put a minus sign in front of somebody gaining muscle
   * toward a target above them. Null once the target is reached.
   */
  remaining: number | null;
  reached: boolean;
  /** Sentence case, no trailing full stop — the caller punctuates. */
  note: string;
}

/** Below this the remaining distance is a rounding artefact, not a gap. Stated
 *  at the grain the figure prints in: one decimal place. */
const SHOWABLE = 0.05;

/**
 * What to say about `goal` given the readings behind `series`.
 *
 * `weight` says whether the stored figures are kilograms — so that the target,
 * which is stored in kilograms like every other mass in this app, is read out
 * in the member's own unit rather than being printed as a metric number under a
 * pounds figure. Body fat is a percentage in every unit system and passes
 * through untouched.
 */
export function goalOnBody(
  goal: GoalTarget | null | undefined,
  series: readonly Point[],
  opts: { weight: boolean; unit: string; wu: WeightUnit },
): GoalOnBody | null {
  if (!goal) return null;
  const p = progressOf(goal, series);
  // Null covers the custom goal, the goal with no target value and the member
  // with no readings — three different reasons, one honest answer: there is no
  // distance to state.
  if (!p) return null;

  const conv = (v: number): number | null => (opts.weight ? weightIn(v, opts.wu) : Math.round(v * 10) / 10);
  const target = conv(p.target);
  if (target == null) return null;
  const unit = opts.weight ? opts.wu : opts.unit;

  if (p.reached) {
    return { target, unit, remaining: null, reached: true, note: `target of ${target} ${unit} reached` };
  }

  // Converted as a SPAN, once, rather than as the difference between two
  // converted endpoints. A 0.4 kg gap is 0.88 lb, and two figures each rounded
  // into pounds before subtracting report it as either nothing or two pounds
  // depending on nothing but where they happened to fall — the same argument
  // `weightDeltaIn` exists for, and the same one body-trends.tsx already makes
  // about its own delta.
  const gapKg = Math.abs(p.remaining);
  const gap = conv(gapKg);
  if (gap == null) return null;
  if (!(gap >= SHOWABLE)) {
    // Within a rounding step of the target and not across it. Saying "0.0 kg to
    // go" is worse than saying nothing; saying "reached" would be claiming
    // something `progressOf` explicitly did not.
    return { target, unit, remaining: null, reached: false, note: `target ${target} ${unit}, all but there` };
  }
  return {
    target,
    unit,
    remaining: gap,
    reached: false,
    note: `${gap} ${unit} to go — target ${target} ${unit}`,
  };
}

/**
 * The goal of a given kind out of the member's list, or null.
 *
 * ACHIEVED GOALS ARE STILL RETURNED. A member who hit 80 kg and left the goal
 * marked achieved has a target that is still the answer to "what am I aiming
 * at", and hiding the line the moment they reach it removes the one piece of
 * good news the screen had to give. `sortGoals` puts open goals first, so the
 * live one wins when there are both.
 */
export function goalOfKind(goals: readonly GoalTarget[] | null | undefined, kind: string): GoalTarget | null {
  if (!goals?.length) return null;
  return goals.find((g) => g.kind === kind) ?? null;
}
