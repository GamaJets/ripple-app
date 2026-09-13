// The second, finer rule for pounds — the one the composition table needed
// before it could be converted at all.
//
// ── the argument this replaces ─────────────────────────────────────────────
//
// app/(client)/scans.tsx carried a comment saying the body-composition table
// was deliberately NOT converted, and the reason given was sound:
//
//   "its segmental lean masses are carried to two decimals, a grain of 0.01 kg
//    that whole pounds (the honest grain for a body weight, see
//    src/lib/units.ts) cannot represent at all. Converting these would need a
//    second, finer rule for pounds than the rest of the app uses, and two rules
//    for the same unit is how a client ends up seeing the same reading two
//    ways."
//
// Both halves are true. What does not follow is the conclusion. A member who
// reads in pounds was shown their weight as 163 lb at the top of the screen and
// their fat mass as 11.8 kg four inches below it, on the one screen whose whole
// subject is that body — and "the sheet printed it that way" is an explanation
// of the app's filing system, not an answer to "how much of me is fat".
//
// So the second rule is written down here, once, and it is a rule rather than a
// per-metric table: two rules for the same unit is only a hazard while they are
// allowed to disagree about the same value, and these two cannot, because they
// do not print the same values. `weightIn` prints a BODY WEIGHT — `scans.weight_kg`,
// stored to one decimal. This prints the figures inside `scans.metrics`, which
// that column is not one of.
//
// ── the rule ───────────────────────────────────────────────────────────────
//
// Print the finest decimal place whose STEP is still no finer than the grain of
// the stored reading. A metric stored to `d` decimals in kilograms has a grain
// of 10^-d kg; in pounds that same physical grain is 10^-d / KG_PER_LB, about
// 2.2 times larger. The finest power-of-ten step not finer than that is what
// gets printed:
//
//   kg decimals   kg grain    same grain in lb   printed in lb
//   ───────────   ────────    ────────────────   ─────────────
//        0          1 kg          2.20 lb          whole lb      (visceral fat
//                                                                 level, kcal —
//                                                                 not masses at
//                                                                 all; see below)
//        1        0.1 kg          0.22 lb          whole lb      fat mass, lean
//                                                                 mass, trunk,
//                                                                 protein
//        2       0.01 kg         0.022 lb          0.1 lb        arms, legs,
//                                                                 minerals
//
// The middle row is the one that matters: it lands on exactly what `weightIn`
// already does with a one-decimal kilogram — whole pounds — so the two rules
// agree everywhere they could be compared, and the finer rule is finer only
// where the record is genuinely finer. A tenth of a pound under a 0.1 kg
// reading would be a digit the reading cannot support; a whole pound under a
// 0.01 kg reading would throw away a digit the reading has.
//
// Rounding UP to the finer place was the other candidate and is wrong: 0.1 lb
// under a 0.22 lb grain invents half a step of precision, and this app's
// standing rule (src/lib/units.ts, `weightDeltaIn`) is that a movement too
// small to show in the reader's unit is reported as no movement, never as a
// digit nobody measured.
//
// ── what is NOT converted, and why that is not an oversight ────────────────
//
// A composition table is not thirteen weights. It carries a visceral fat LEVEL,
// an InBody SCORE, a BMR in kcal, and a total body water in LITRES, and none of
// those has a pound to be read in — litres least of all, because a litre of
// body water is a volume the sheet reports as a volume, and turning it into a
// mass would be this module inventing a measurement rather than converting one.
// `isConvertibleMass` is the gate, and it asks the metric's own declared unit
// rather than guessing from its key name.
import { KG_PER_LB, type WeightUnit } from './units';

/**
 * Whether a metric's declared unit is a mass this module can read out in the
 * member's own unit.
 *
 * Asked of `MetricDef.unit` from src/lib/inbodyMetrics.ts — 'kg', 'L', 'kcal',
 * 'lvl', 'pts' — rather than of the metric's key, so a metric added later says
 * what it is instead of being guessed at by the shape of its name. That is the
 * same contract `MetricDef.from` on the trends screen was written to.
 */
export function isConvertibleMass(defUnit: string): boolean {
  return defUnit === 'kg';
}

/**
 * The unit a metric is actually printed in, for the member reading it.
 *
 * Returned as the string that goes on screen beside the figure, because the
 * house rule is that a converted figure never appears without the unit it is
 * in — and the commonest way that rule gets broken is a screen converting the
 * number and leaving the label it already had.
 */
export function compositionUnitOf(defUnit: string, unit: WeightUnit): string {
  return isConvertibleMass(defUnit) ? unit : defUnit;
}

/**
 * How many decimal places this metric is printed to, in the member's own unit.
 *
 * Derived from KG_PER_LB rather than written out as a table, so the rule in the
 * header is the thing that runs. `Math.log10` of the converted grain gives the
 * power of ten the step sits at; `Math.floor` takes the finest step that is
 * still no finer than the grain, and the clamp at zero stops a coarse metric
 * (a whole-kilogram grain is 2.2 lb) from asking to be rounded to TENS of
 * pounds, which is a precision loss rather than an honesty gain.
 */
export function compositionDecimals(kgDecimals: number, unit: WeightUnit): number {
  const dp = Math.max(0, Math.trunc(kgDecimals) || 0);
  if (unit === 'kg') return dp;
  const grainLb = 10 ** -dp / KG_PER_LB;
  return Math.max(0, Math.floor(-Math.log10(grainLb)));
}

/**
 * Rounds by MAGNITUDE and puts the sign back.
 *
 * The same choice `deltaLabel` makes and for the same reason: rounding a
 * difference with `Math.round` sends +0.05 up and −0.05 in to −0, so a movement
 * reads as something in one direction and nothing in the other. A bias with a
 * sign on it is worse than either answer.
 */
function round(n: number, dp: number): number {
  const f = 10 ** dp;
  const r = Math.round((Math.abs(n) + Number.EPSILON) * f) / f;
  return n < 0 ? -r : r;
}

/**
 * One stored composition reading, in the member's unit, at the grain above.
 *
 * null in, null out — never 0. A metric the sheet did not carry is absent, and
 * a zero lean mass is a reading nobody has ever taken.
 */
export function compositionIn(
  kg: number | null | undefined,
  unit: WeightUnit,
  kgDecimals: number,
): number | null {
  if (kg == null || !Number.isFinite(kg)) return null;
  const dp = compositionDecimals(kgDecimals, unit);
  return round(unit === 'lb' ? kg / KG_PER_LB : kg, dp);
}

/**
 * A CHANGE between two composition readings, in the member's unit.
 *
 * The span is converted once, exactly as `weightDeltaIn` converts a weight
 * span once: converting the two ends and subtracting those reports a real
 * 0.4 kg gain as "1 lb" one month and "0 lb" the next off the back of nothing
 * the member did, depending only on where the two readings happened to fall
 * against a pound boundary.
 *
 * A change that rounds to nothing at this grain comes back as 0, which is what
 * `deltaLabel` turns into the words "no change" rather than into a signed zero.
 * That is the intended outcome and not a loss: at whole pounds, a fat mass that
 * moved 0.2 kg has not moved a pound, and telling somebody it did would be the
 * app reporting its own rounding as a result.
 */
export function compositionDeltaIn(
  deltaKg: number | null | undefined,
  unit: WeightUnit,
  kgDecimals: number,
): number | null {
  if (deltaKg == null || !Number.isFinite(deltaKg)) return null;
  const dp = compositionDecimals(kgDecimals, unit);
  return round(unit === 'lb' ? deltaKg / KG_PER_LB : deltaKg, dp);
}
