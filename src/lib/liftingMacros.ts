// The macro guidance on the lifting-tools screen, worked out in grams for the
// person reading it.
//
// ── What TF-15 was actually asking for ──────────────────────────────────────
//
// The Macros tab of Client · Lifting tools was a static textbook table:
// "Protein · 4 kcal/g · Muscle repair · 1.8–2.2 g/kg lean mass", "Fat · 9 kcal/g
// · Hormones · ~0.8–1 g/kg bodyweight". Correct, and useless at the rack —
// acting on it means knowing your lean mass, which means knowing your body fat,
// multiplying it out, and doing all of that on figures the app is already
// holding. So the tab was three taps to a page of arithmetic homework. That is
// what "a third tab nobody opens" means, and why the answer is not a fourth
// calculator but the same two lines of guidance resolved against this client's
// own recorded weight and body fat.
//
// The multipliers below are deliberately the ones printed in that table rather
// than a second opinion: the table stays on screen underneath as the working,
// so the client can see where their numbers came from.
//
// ── Why this returns null rather than a default ─────────────────────────────
//
// `clientData` hands out `weightKg` and `bodyFatPct` as null until there is a
// scan or a manual entry, because they used to fall back to 70 kg / 20% and
// half the app rendered that as though the client had been measured. A macro
// target is the sharpest version of that failure — it is a number somebody eats
// to — so an absent figure ends the calculation here. The screen shows the
// prompt to record measurements; it never shows grams derived from a body
// nobody has.

/** g of protein per kg of LEAN mass per day. The table's own range. */
export const PROTEIN_G_PER_KG_LEAN = { low: 1.8, high: 2.2 } as const;

/** g of fat per kg of TOTAL bodyweight per day. The table's own range. */
export const FAT_G_PER_KG_BODYWEIGHT = { low: 0.8, high: 1.0 } as const;

/** A daily range in grams. `low` and `high` are both whole grams. */
export interface GramRange { low: number; high: number }

export interface LiftingMacros {
  /** Fat-free mass, to one decimal, the figure the protein range is built on. */
  leanMassKg: number;
  /** Daily protein, in grams, from lean mass. */
  protein: GramRange;
  /** Daily fat, in grams, from total bodyweight. */
  fat: GramRange;
  /**
   * The protein range split across the day's meals, or null when the meal count
   * is not a usable number. Null rather than falling back to three: how many
   * times a day somebody eats is their answer, not ours.
   */
  proteinPerMeal: GramRange | null;
}

/** A finite number strictly inside (lo, hi). Rejects NaN, Infinity and strings. */
const inRange = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > lo && v < hi;

/**
 * Work the table's guidance out in grams for one client.
 *
 * Returns null — not zeroes — when there is nothing honest to compute from:
 * either figure missing, a weight outside anything a person weighs, or a body
 * fat percentage that is not a percentage. A caller that renders zeroes from a
 * null is making the same claim the placeholder body used to.
 *
 * @param weightKg    total bodyweight, or null when none is on record
 * @param bodyFatPct  body fat percentage, or null when none is on record
 * @param mealsPerDay how many times a day they eat; anything else drops
 *                    `proteinPerMeal` without affecting the daily figures
 */
export function liftingMacros(
  weightKg: number | null | undefined,
  bodyFatPct: number | null | undefined,
  mealsPerDay?: number | null,
): LiftingMacros | null {
  // 400 kg and 0 kg are both "somebody typed something wrong", and 100% body fat
  // makes lean mass zero, which would print a 0 g protein target as advice.
  if (!inRange(weightKg, 0, 400)) return null;
  if (!inRange(bodyFatPct, -1, 100)) return null;

  const leanKg = weightKg * (1 - bodyFatPct / 100);
  const protein = {
    low: Math.round(leanKg * PROTEIN_G_PER_KG_LEAN.low),
    high: Math.round(leanKg * PROTEIN_G_PER_KG_LEAN.high),
  };
  const fat = {
    low: Math.round(weightKg * FAT_G_PER_KG_BODYWEIGHT.low),
    high: Math.round(weightKg * FAT_G_PER_KG_BODYWEIGHT.high),
  };
  // Rounded per meal from the daily total, so the per-meal figures never imply a
  // day that adds up to more protein than the range above them.
  const meals = inRange(mealsPerDay, 0, 13) ? Math.round(mealsPerDay) : null;
  const proteinPerMeal = meals && meals > 0
    ? { low: Math.round(protein.low / meals), high: Math.round(protein.high / meals) }
    : null;

  return { leanMassKg: +leanKg.toFixed(1), protein, fat, proteinPerMeal };
}

/** "126–154 g", or "126 g" when a rounded range collapses to one number. */
export function rangeLabel(r: GramRange, unit = 'g'): string {
  return r.low === r.high ? `${r.low} ${unit}` : `${r.low}–${r.high} ${unit}`;
}
