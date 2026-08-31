// Loading a barbell, in the unit the client's gym actually stocks.
//
// ── Why this is not a conversion ───────────────────────────────────────────
//
// Everything else in this app that shows a weight to an imperial reader
// converts a stored kilogram figure at the edge — see src/lib/units.ts. Plate
// maths cannot work that way, and the header of that file says so: it left
// lifted loads out of TF-37 on the grounds that "barbell plates are metric
// hardware and app/(client)/tools.tsx does plate maths against a metric rack".
//
// The rack is the point. A plate is a physical object, not a reading. Converting
// the metric answer gives a pounds reader a bar loaded with 11.34 lb plates and
// a 44.1 lb bar — a set of hardware that exists in no gym on earth, printed as
// an instruction to go and pick it up. So each unit gets the denominations that
// unit is sold in, and the arithmetic is done natively in it.
//
// The house rule that the record is metric is not broken by this: nothing here
// is stored. app/(client)/tools.tsx still reads what the client typed through
// `readLift`, which is the same kilogram round trip a logged set makes, and only
// then hands the figure here to be broken into plates. What that means in
// practice is that a pounds reader's target is honoured to the half pound — the
// grain a pair of 1.25 lb fractionals produces — and never to a finer one.
//
// ── Where the denominations come from ─────────────────────────────────────
//
// Kilograms: the IWF/IPF competition set — 25, 20, 15, 10, 5, 2.5, 1.25 kg. The
// 0.5 kg and 0.25 kg change plates are deliberately left out; they live in a
// referee's box, not on a commercial gym rack, and offering them would produce
// loads nobody can actually build.
//
// Pounds: the standard American commercial set — 45, 35, 25, 10, 5, 2.5 lb, plus
// the 1.25 lb fractional pair. There is no 20 lb or 15 lb plate in that set, so
// the gap between 25 and 10 is real hardware rather than an omission here, and a
// greedy fill has to live with it. The 1.25 lb pair is included because
// src/lib/units.ts already reasons about it by name — it is what makes the
// half-pound display grain honest ("a pair of 1.25 lb fractionals is a 2.5 lb
// jump, and the 47.5 lb and 52.5 lb bars that produces are ordinary gym
// numbers").
//
// Bars: 20 kg and 15 kg are the men's and women's Olympic bars. 45 lb and 35 lb
// are their American counterparts, and they are NOT the same bars converted — a
// US 45 lb bar is 20.41 kg, a 20 kg bar is 44.09 lb. Printing "44.1 kg bar" or
// "44.09 lb bar" would be describing a bar the client is not holding.
import type { WeightUnit } from './units';

/** The bars on the rack, standard first. Index-addressed by the screen so that
 *  flipping unit swaps a 20 kg bar for a 45 lb one rather than leaving a
 *  selected "20" that means nothing in pounds. */
export const BARS: Record<WeightUnit, readonly number[]> = {
  kg: [20, 15],
  lb: [45, 35],
};

/** Plate denominations, heaviest first — the order a greedy fill needs and the
 *  order they are loaded onto the sleeve. */
export const PLATES: Record<WeightUnit, readonly number[]> = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
  lb: [45, 35, 25, 10, 5, 2.5, 1.25],
};

/**
 * Above any bar that can be loaded, in either unit, and here only as a loop
 * guard: the fill below adds plates one at a time, so a target arriving as 1e9
 * — a paste, a bug upstream — would spin for a very long time before answering.
 * `readLift` in src/lib/units.ts refuses anything over 600 kg / 1300 lb long
 * before this, so nothing a person types reaches it.
 */
const MAX_TARGET = 2000;

/**
 * Hundredths, so the fill is integer arithmetic and `exact` below is an integer
 * comparison rather than a float equality.
 *
 * Honesty about what this does and does not buy: every denomination on both
 * racks today (2.5, 1.25, …) happens to be exactly representable in binary, so
 * a float fill would give the same answers, and a mutation removing this
 * rounding does NOT fail the test file. It is here because that is a property
 * of the current plate list rather than of the fill — the moment somebody adds a
 * denomination that is not a power-of-two fraction, a float `total === target`
 * starts reporting a bar that loads perfectly as "closest loadable", which is a
 * warning about a number the client asked for and got.
 */
const H = 100;
const hun = (n: number) => Math.round(n * H);

export interface BarLoad {
  /** What goes on ONE sleeve, in the client's unit — the sum of `plates`. */
  perSide: number;
  /** The plates for one sleeve, heaviest first. */
  plates: number[];
  /** What the bar weighs once those are on, both sleeves plus the bar. */
  total: number;
  /** True when `total` is the target exactly. False means the rack cannot make
   *  the number asked for, which is a thing the screen has to SAY rather than
   *  quietly rounding to. */
  exact: boolean;
}

/**
 * Break a target load into plates for one side of the bar.
 *
 * Greedy, heaviest first, which is both the optimal fill for these
 * denominations and the order somebody loads a sleeve. Never overshoots: a
 * target the rack cannot make comes back as the closest load UNDER it with
 * `exact: false`, because a bar loaded heavier than asked is a rep the client
 * did not agree to.
 *
 * Returns null for a target that is not a usable number, and for one lighter
 * than the bar — "load 15 kg on a 20 kg bar" has no answer, and answering 0
 * would present the empty bar as if it were what was asked for.
 */
export function loadBar(
  target: number | null | undefined,
  bar: number,
  unit: WeightUnit,
): BarLoad | null {
  if (target == null || !Number.isFinite(target)) return null;
  if (!Number.isFinite(bar) || bar <= 0) return null;
  if (target > MAX_TARGET) return null;
  if (target < bar) return null;

  const barH = hun(bar);
  // Floor rather than round: half a hundredth of a unit cannot be split across
  // two sleeves, and rounding it up would report a load heavier than the target.
  let remH = Math.floor((hun(target) - barH) / 2);

  const plates: number[] = [];
  let sideH = 0;
  for (const p of PLATES[unit]) {
    const pH = hun(p);
    while (remH >= pH) { plates.push(p); remH -= pH; sideH += pH; }
  }

  const totalH = barH + sideH * 2;
  return {
    perSide: sideH / H,
    plates,
    total: totalH / H,
    exact: totalH === hun(target),
  };
}
