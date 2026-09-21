// Which of a lifter's big lifts is furthest behind the others.
//
// ── the gap this closes ───────────────────────────────────────────────────
//
// app/(client)/standards.tsx grades five lifts against bodyweight and prints
// five independent rows. That is the whole of it, and it is the half of the
// product every strength-standards tool leads with: the reason somebody opens
// a standards screen is not to learn that their deadlift is Intermediate, it
// is to find out WHICH lift to put next Monday's attention on. Five rows do
// not answer that, because the five ladders are not the same ladder — an
// overhead press at 0.7× bodyweight is an Intermediate press and a squat at
// 0.7× is below the beginner standard. Read down the column, the press looks
// like the weak one. It is the strong one.
//
// So the comparison cannot be between ratios. It has to be between each lift's
// POSITION ON ITS OWN LADDER, which is what `standardScore` computes and what
// nothing in this app had.
//
// ── why the score is continuous and the level is not ──────────────────────
//
// `levelFor` in src/lib/strengthLevel.ts answers "which rung has this lift
// cleared" and returns an integer, which is the right answer for the bar that
// screen draws. It is the wrong input here, for a reason that would have made
// this feature quietly wrong: a lift one kilogram short of Advanced and a lift
// that has only just cleared Intermediate both return 2, so a lifter who is
// four fifths of the way up a rung would be told they are level with somebody
// at the bottom of it, and the lift actually furthest behind could be the one
// the sentence calls even. Rounding to rungs throws away most of the signal
// the comparison is made of.
//
// `standardScore` keeps it: 2.4 means "clearing Intermediate, two fifths of the
// way to Advanced". The integer part is exactly `levelFor`'s answer, so the two
// can never disagree about which rung a lift is on.
//
// ── what it refuses to say ────────────────────────────────────────────────
//
// Three refusals, and each one is a sentence this could otherwise have printed
// at somebody about their own body:
//
//   · fewer than two graded lifts is not a comparison. One lift cannot be
//     behind anything, and an ungraded lift — no bodyweight, or nothing on the
//     log for it — is an absence, never a zero. `gradeLift` already keeps those
//     three apart and this only ever reads its 'graded' answers.
//   · a gap under one full level is not named. An estimated 1RM is estimated:
//     it comes off a top set through a rep formula, and the difference between
//     2.4 and 2.9 is comfortably inside what a different day's sleep would move.
//     Naming a weakest lift out of that is picking a lift at random and telling
//     the member it is their weak point, which they would then train.
//   · nothing is extrapolated past the top rung. The multiples stop at Elite
//     and there is no sixth standard to measure a 3.5× deadlift against, so the
//     score caps — which makes two lifts that are both past Elite read as even,
//     and that is the honest answer rather than a race between two figures the
//     table cannot price.
//
// The caller has one more refusal to make and this file cannot make it for
// them: a truncated or failed training-log read under-states a best lift, and
// an under-stated lift is exactly what this function would name as the weak
// one. standards.tsx gates the whole block on `isWhole` of both reads for that
// reason — the same gate it already applies to every grade on the screen.

import { levelFor } from './strengthLevel';

/** One graded lift, ready to be compared: its name, its bodyweight ratio, and
 *  its own ladder. Built from `gradeLift`'s 'graded' answers and nothing else. */
export interface LiftStanding {
  readonly name: string;
  readonly ratio: number;
  /** Not `readonly number[]`, and not by oversight: `levelFor` in
   *  src/lib/strengthLevel.ts takes `number[]`, and widening a shared
   *  signature that four other callers depend on, to buy a guarantee this file
   *  could have had for free, is the wrong trade to make from here. Nothing
   *  below writes to it. */
  readonly mult: number[];
}

/**
 * How far up its own ladder a lift sits, as a continuous position.
 *
 * `-1` is the floor (a ratio of nothing), `0` is exactly the first standard,
 * `mult.length - 1` is the top one. Between two rungs it interpolates, so the
 * integer part is always `levelFor`'s answer and the fraction is the progress
 * toward the next rung.
 *
 * Null rather than a number for anything that cannot be positioned: a ratio
 * that is not a positive finite number, a ladder with fewer than two rungs, or
 * one whose rungs do not ascend. A malformed table silently producing a
 * plausible score is how a comparison starts naming the wrong lift, and there
 * is no score that means "this table is wrong".
 */
export function standardScore(ratio: number, mult: number[]): number | null {
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  if (mult.length < 2) return null;
  for (let i = 0; i < mult.length; i++) {
    if (!Number.isFinite(mult[i]) || mult[i] <= 0) return null;
    if (i > 0 && mult[i] <= mult[i - 1]) return null;
  }
  // Below the first standard: a fraction of the way to it, floored at -1 so a
  // ratio approaching zero approaches the bottom of the scale rather than
  // running off it.
  if (ratio < mult[0]) return ratio / mult[0] - 1;
  const top = mult.length - 1;
  // At or past the last rung. Deliberately flat: see the header.
  if (ratio >= mult[top]) return top;
  const lvl = levelFor(ratio, mult);
  // `lvl` is 0…top-1 here — `ratio >= mult[0]` was established above and
  // `ratio < mult[top]` two lines up — so both rungs below exist.
  const lo = mult[lvl];
  const hi = mult[lvl + 1];
  return lvl + (ratio - lo) / (hi - lo);
}

/** How far apart two lifts must sit before one is called behind the other.
 *  One full rung of the five-level scale. See the header for why not less. */
export const MIN_GAP_LEVELS = 1;

/**
 * The comparison, or the reason there is not one.
 *
 * `'behind'` carries the lift that is furthest back AND the one it is furthest
 * back from, because "your press is behind" is a claim with no stated basis and
 * the whole point of this screen is that a grade is a ratio rather than a
 * verdict. `levels` is the gap in rungs, to one decimal.
 */
export type BalanceRead =
  /** Fewer than two lifts could be graded, so nothing can be compared. */
  | { kind: 'too-few' }
  /** Graded, compared, and no lift is a full level behind the strongest. */
  | { kind: 'even' }
  | { kind: 'behind'; name: string; aheadName: string; levels: number };

/**
 * Which lift is furthest behind the strongest, among the ones that graded.
 *
 * Ties are broken by the order given, which on standards.tsx is the order of
 * `STRENGTH_LIFTS` — stable, so the sentence does not change between renders of
 * identical data. A lift whose score cannot be computed is dropped rather than
 * scored zero: a table this file cannot read is not a lift the member is bad at.
 */
export function weakestLift(lifts: readonly LiftStanding[]): BalanceRead {
  const scored: { name: string; score: number }[] = [];
  for (const l of lifts) {
    const score = standardScore(l.ratio, l.mult);
    if (score != null) scored.push({ name: l.name, score });
  }
  if (scored.length < 2) return { kind: 'too-few' };
  let low = scored[0];
  let high = scored[0];
  for (const s of scored) {
    if (s.score < low.score) low = s;
    if (s.score > high.score) high = s;
  }
  const gap = high.score - low.score;
  if (gap < MIN_GAP_LEVELS) return { kind: 'even' };
  return {
    kind: 'behind',
    name: low.name,
    aheadName: high.name,
    levels: Math.round(gap * 10) / 10,
  };
}

/**
 * The sentence, or null where there is nothing to say.
 *
 * Written here rather than on the screen so the words and the arithmetic that
 * licenses them stay in one file and are asserted together. It names both lifts
 * and the size of the gap, and it never tells anybody what to do about it: what
 * the app knows is that two lifts sit a long way apart on their own ladders,
 * and "train your press" is a coaching instruction this screen is not entitled
 * to give — the screen's own footer already says these standards vary by age,
 * sex and training history.
 */
export function balanceLine(read: BalanceRead): string | null {
  if (read.kind === 'too-few') return null;
  if (read.kind === 'even') {
    return 'Your graded lifts all sit within about a level of each other. Nothing is lagging the rest.';
  }
  const rungs = read.levels === 1 ? 'about a level' : `about ${read.levels} levels`;
  return `Of the lifts we could grade, your ${read.name} sits furthest back, ${rungs} below your ${read.aheadName} on their own scales. Ratios are not comparable between lifts, so this compares each one against its own standard.`;
}
