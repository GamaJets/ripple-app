// There is no such thing as negative nothing.
//
// The client Progress hero read "−0% since Aug 25, 2026". The code behind it was
// `${bfMove <= 0 ? '−' : '+'}${Math.abs(bfMove)}%`, so a body-fat reading that
// had not moved at all came out with a minus in front of it — and a small drop
// in body fat is exactly the kind of small drop somebody is pleased about. The
// app congratulated a member for a change that did not happen.
//
// That site is fixed. This module exists because it was one of about twenty:
// every screen that shows a movement had written its own sign expression, and
// each one had to remember the same four things independently. They did not.
//
// ── The four things a movement has to get right ────────────────────────────
//
//  1. Zero is its own case, and it is a WORD. `x <= 0 ? '−' : '+'`,
//     `x >= 0 ? '+' : '−'` and `x > 0 ? '+' : '−'` all put a sign on nothing;
//     which sign depends only on which way the author happened to write it.
//
//  2. Zero means the FORMATTED figure, not the raw one. A true change of
//     0.04 kg formats as "0.0" and then gets a sign, which is the same lie one
//     step later: the figure says nothing moved and the sign says something
//     did. Worse in pounds, where `weightDeltaIn` rounds to whole pounds and a
//     real 0.2 kg gain becomes "+0 lb". So the zero test below runs on the
//     value AFTER rounding to the same decimals it will be printed to, and
//     there is exactly one rounding in play rather than two that disagree.
//
//  3. A delta names the day it is measured FROM. "+2 kg" against what, and
//     since when? `since` is a REQUIRED field rather than an optional one for
//     that reason: passing `since: null` is a statement that this particular
//     site genuinely names no baseline (because a heading above it already
//     does), and it has to be written down rather than forgotten.
//
//  4. A delta of Infinity or NaN is not a movement. `(a - b) / b` with b at
//     zero produces both, and `fig()` in src/ui/kit.tsx catches them at render
//     — but a sentence built by string interpolation never reaches `fig()`,
//     and prints "+Infinity% vs last month" instead. Anything unreadable takes
//     the no-baseline arm here, not a signed one.
//
// ── And the fifth thing, which is not arithmetic ───────────────────────────
//
// Losing weight is progress for one member and a problem for another. The app
// records a goal — Fat Loss, Tone, Build Muscle — and `goalWants` below is the
// only place that says which direction of travel is good for whom. Where the
// goal does not decide it, the answer is `undefined` and the screen shows a
// neutral mark: silence is honest, and congratulating somebody for moving away
// from their own goal is not.
import type { Goal } from './types';

/** U+2212 MINUS. The app prints this, not a hyphen — a hyphen at figure size
 *  next to a digit reads as a dash in the sentence rather than a sign. */
export const MINUS = '−';

/** What a movement is measured in, and how it is said. */
export interface DeltaOpts {
  /**
   * The day the movement is measured FROM, already formatted — "Aug 25" — or
   * `null` where this site deliberately names no baseline because something
   * else on screen already does. Required, so that a site with no baseline is
   * a decision somebody made rather than one nobody noticed.
   */
  since: string | null;
  /** "kg", "%", "cm". Joined without a space for "%" and for a "/wk" style rate. */
  unit?: string | null;
  /** Decimals the figure is printed to, and therefore the precision at which
   *  "nothing moved" is judged. One, like every `*DeltaIn` in ./units. */
  decimals?: number;
  /** Wording when the figure rounds to nothing. */
  noChange?: string;
  /** Wording when there is no earlier reading to measure against, or the
   *  arithmetic produced something unreadable. */
  noBaseline?: string;
}

const DEFAULT_DECIMALS = 1;

/** A unit that butts straight against the digits rather than taking a space. */
const JOINED = /^[%°]|^\//;

/**
 * Rounds by MAGNITUDE and puts the sign back, so that −0.05 and +0.05 round the
 * same distance. `roundTo` in ./units nudges by Number.EPSILON before rounding,
 * which is right for a reading but asymmetric for a difference: it would send
 * +0.05 up to 0.1 and −0.05 in to −0.0, and a movement that reads as nothing in
 * one direction and something in the other is a bias with a sign on it.
 */
function round(n: number, dp: number): number {
  const f = 10 ** dp;
  const r = Math.round((Math.abs(n) + Number.EPSILON) * f) / f;
  return n < 0 ? -r : r;
}

/** The movement as it will actually be printed, or null if there is none to
 *  print. Callers that lay the sign and the figure out in separate elements use
 *  this with `deltaSign`; everything else uses `deltaLabel`. */
export function deltaFigure(value: number | null | undefined, decimals = DEFAULT_DECIMALS): number | null {
  if (value == null || typeof value !== 'number' || !Number.isFinite(value)) return null;
  return round(value, decimals);
}

/** Did the figure the reader will see actually move? False for a raw 0.04 that
 *  prints as 0.0, which is the whole point. */
export function deltaMoved(value: number | null | undefined, decimals = DEFAULT_DECIMALS): boolean {
  const f = deltaFigure(value, decimals);
  return f != null && f !== 0;
}

/** The sign that belongs in front of the printed figure — and an empty string
 *  where the honest answer is that there is no sign, because nothing moved. */
export function deltaSign(value: number | null | undefined, decimals = DEFAULT_DECIMALS): '' | '+' | typeof MINUS {
  const f = deltaFigure(value, decimals);
  if (f == null || f === 0) return '';
  return f < 0 ? MINUS : '+';
}

/** The same decision as a direction glyph, for a chart. Empty where a chart
 *  should draw no arrow at all rather than pick one. */
export function deltaArrow(value: number | null | undefined, decimals = DEFAULT_DECIMALS): '' | '▲' | '▼' {
  const s = deltaSign(value, decimals);
  return s === '' ? '' : s === '+' ? '▲' : '▼';
}

/** The figure without its sign, printed the way a person writes it: 2, not 2.0. */
export function deltaMagnitude(value: number | null | undefined, decimals = DEFAULT_DECIMALS): string | null {
  const f = deltaFigure(value, decimals);
  return f == null ? null : String(Math.abs(f));
}

/**
 * The whole movement as one line: "−1.2 kg since Aug 25", "No change since
 * Aug 25", "No earlier reading".
 *
 * `value` is expected to already be in the reader's own unit — the `*DeltaIn`
 * converters in ./units convert the SPAN once rather than subtracting two
 * separately rounded ends, and doing that here instead would reintroduce the
 * bug those functions exist to prevent.
 */
export function deltaLabel(value: number | null | undefined, opts: DeltaOpts): string {
  const dp = opts.decimals ?? DEFAULT_DECIMALS;
  const since = opts.since ? ` since ${opts.since}` : '';
  const f = deltaFigure(value, dp);
  // No reading, or arithmetic that produced Infinity or NaN. Neither is a
  // movement, and neither may be given a sign and printed as one.
  if (f == null) return opts.noBaseline ?? 'No earlier reading';
  if (f === 0) return `${opts.noChange ?? 'No change'}${since}`;
  const u = opts.unit ? (JOINED.test(opts.unit) ? opts.unit : ` ${opts.unit}`) : '';
  return `${f < 0 ? MINUS : '+'}${Math.abs(f)}${u}${since}`;
}

// ── Which way is good, and for whom ────────────────────────────────────────

/** The body figures whose direction of travel a goal has an opinion about. */
export type BodyMetric = 'weight' | 'bodyFat' | 'muscle' | 'girth';

/**
 * The direction that counts as progress on this metric for this member — or
 * null where their goal does not settle it and the app should say nothing.
 *
 * Weight is the one that matters: it is down for Fat Loss, up for Build Muscle,
 * and genuinely undecided for Tone, whose whole point is recomposition at much
 * the same scale reading. Every screen in this app used to hardcode
 * `good: wDelta <= 0`, which told a member who had asked to build muscle that
 * gaining it was the wrong way round.
 *
 * Muscle is 'up' under every goal because nobody's goal is less of it. Body fat
 * and a tape measurement are 'down' for Fat Loss and Tone, and undecided during
 * a deliberate bulk, where a little of both is the expected cost of the muscle.
 */
export function goalWants(goal: Goal | null | undefined, metric: BodyMetric): 'up' | 'down' | null {
  if (metric === 'muscle') return 'up';
  if (metric === 'weight') return goal === 'fatloss' ? 'down' : goal === 'muscle' ? 'up' : null;
  // bodyFat and girth
  return goal === 'muscle' ? null : goal == null ? null : 'down';
}

/**
 * Whether this movement is progress towards this member's own goal.
 *
 * `undefined` — not false — where the question has no answer: no goal recorded,
 * a goal with no opinion on this metric, nothing read, or nothing moved. A
 * screen renders that as a neutral mark, because "not progress" and "we do not
 * know" are different things to say to somebody about their own body.
 */
export function movementIsProgress(
  value: number | null | undefined,
  goal: Goal | null | undefined,
  metric: BodyMetric,
  decimals = DEFAULT_DECIMALS,
): boolean | undefined {
  const want = goalWants(goal, metric);
  if (want == null) return undefined;
  const f = deltaFigure(value, decimals);
  if (f == null || f === 0) return undefined;
  return want === 'down' ? f < 0 : f > 0;
}

/**
 * A change expressed as a percentage of what came before — or null where there
 * is no "before" to be a percentage of.
 *
 * `(now - before) / before` is Infinity at before = 0 and NaN at 0/0, and both
 * of those have been interpolated straight into a sentence in this codebase's
 * history. A gym's first month has no previous month; "+Infinity% vs last
 * month" is not a way to say so.
 */
export function pctChange(now: number | null | undefined, before: number | null | undefined): number | null {
  if (now == null || before == null) return null;
  if (!Number.isFinite(now) || !Number.isFinite(before) || before === 0) return null;
  return ((now - before) / before) * 100;
}
