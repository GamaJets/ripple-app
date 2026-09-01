// How much of it you ate, and what to do when a figure is missing.
//
// ── The two defects this file is written against ───────────────────────────
//
// 1. NOBODY WAS ASKED HOW MUCH. A search row logged straight through on one
//    tap, and the barcode sheet logged whatever basis Open Food Facts happened
//    to return — "100 g", "1 serving", "330 ml" — with no multiplier anywhere.
//    So a member who ate half a packet, or two of them, recorded one of them,
//    and the day's remaining calories were wrong by exactly the amount they
//    were not asked about. Only the photo sheet and Eating Out offered
//    portions.
//
//    src/lib/foodSearch.ts is right that inventing a multiplier would be "a
//    figure nobody chose". The answer is not to invent one. It is to ask.
//
// 2. A MISSING MACRO WAS RECORDED AS ZERO. `foodAI.parseFoodText` and
//    `vision.analyzeMeal` both coerced an absent protein, carb or fat figure to
//    0 with `?? 0`, so a model that returned calories and nothing else recorded
//    a zero-protein meal — which then fed the day's remaining-macro figures a
//    member eats against. A zero is a measurement. "We were not told" is not a
//    zero, and this app does not let one stand in for the other.
//
// ── Why the whole food is refused, and not just the missing part ───────────
//
// `food_logs` stores protein, carbs and fat as NOT NULL columns. There is no
// row that can say "1,200 kcal, protein unknown" — so a food with a gap in it
// either goes in with a fabricated zero, which is defect 2, or it does not go
// in until somebody supplies the figure. `scaleFood` returns null for exactly
// that reason: the caller cannot log this yet and must say what is missing.
//
// The person supplying it is the member, in a box, which makes the figure
// testimony rather than a guess by the app. A member who types 0 has SAID
// zero — that is a different fact from the app assuming it, and it is the same
// distinction `bw` draws about an empty load box.

/** A food as a source describes it, before anybody says how much they ate.
 *
 *  The three macros are nullable and the calories are not, because a source
 *  that cannot say how many calories something has has not identified a food at
 *  all — every reader already refuses those. */
export interface FoodFacts {
  name: string;
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  /** What the figures are FOR: '100 g', '1 serving', '330 ml'. Null when the
   *  source does not say, which is the ordinary case for a common food whose
   *  name already carries its portion ("Chicken Breast, Grilled (170 g)"). */
  basis?: string | null;
}

/** A food with every figure in it, ready to be written to `food_logs`. */
export interface ScaledFood {
  name: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

/** The multipliers offered as taps. A free box handles everything else — three
 *  and a bit packets of rice is a real thing to have eaten and a fixed ladder
 *  cannot hold every rung. */
export const QUANTITIES = [0.5, 1, 1.5, 2, 3] as const;

/** The largest multiple anybody is plausibly recording in one row. Past this a
 *  figure is far likelier to be a fumbled decimal — 15 for 1.5 — than fifteen
 *  servings, and the refusal says so rather than logging 18,000 kcal. */
export const MAX_QUANTITY = 20;

export type QuantityRead = { ok: true; qty: number } | { ok: false; reason: string };

/**
 * A typed quantity, or the reason it is refused.
 *
 * `readNumber`'s discipline, and its comma: the decimal key on most European
 * keyboards is a comma, and `parseFloat('1,5')` is 1 — which would log two
 * thirds of what somebody ate and tell them it was all of it.
 */
export function readQuantity(text: string): QuantityRead {
  const raw = (text ?? '').trim().replace(',', '.');
  if (!raw) return { ok: false, reason: 'How much of it did you have? Type a number, like 1 or 1.5.' };
  if (!/^\d*\.?\d+$/.test(raw)) return { ok: false, reason: 'Type how many portions, like 1, 1.5 or 0.5.' };
  const q = parseFloat(raw);
  if (!Number.isFinite(q) || q <= 0) return { ok: false, reason: 'A portion has to be more than nothing.' };
  if (q > MAX_QUANTITY) {
    return { ok: false, reason: `That is ${q} portions. If you meant a decimal, type it with a point — 1.5 rather than 15.` };
  }
  return { ok: true, qty: q };
}

/** Which of the three macros the source did not give us. Empty when it gave us
 *  all of them, which is the ordinary case for a branded product. */
export function missingMacros(f: FoodFacts): ('protein' | 'carbs' | 'fat')[] {
  const out: ('protein' | 'carbs' | 'fat')[] = [];
  if (f.protein == null) out.push('protein');
  if (f.carbs == null) out.push('carbs');
  if (f.fat == null) out.push('fat');
  return out;
}

/**
 * What to say about the figures that are missing, or null when none are.
 *
 * It names them, because "some macros are missing" sends somebody hunting
 * across four boxes to find out which. And it says why the food cannot be
 * logged without them rather than leaving the disabled button to explain
 * itself.
 */
export function missingMacroNote(f: FoodFacts): string | null {
  const missing = missingMacros(f);
  if (!missing.length) return null;
  const names = missing.length === 1 ? missing[0]
    : missing.length === 2 ? `${missing[0]} and ${missing[1]}`
    : `${missing[0]}, ${missing[1]} and ${missing[2]}`;
  const is = missing.length === 1 ? 'was' : 'were';
  return `The ${names} ${is} not read, so ${missing.length === 1 ? 'it is' : 'they are'} blank rather than nought. Fill ${missing.length === 1 ? 'it' : 'them'} in and this can be logged — a zero we made up would count against your day as if it had been measured.`;
}

/**
 * The food as it was eaten, or null when a figure is still missing.
 *
 * Rounded once, at the end, on the scaled figure — not scaled from a rounded
 * one. Half of a 137 kcal item is 69 rather than 68, and a member logging the
 * same half-packet twice a day should not lose two calories a day to the order
 * of two operations.
 */
export function scaleFood(f: FoodFacts, qty: number): ScaledFood | null {
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if (f.protein == null || f.carbs == null || f.fat == null) return null;
  return {
    name: portionName(f.name, qty, f.basis ?? null),
    kcal: Math.round(f.kcal * qty),
    protein: Math.round(f.protein * qty),
    carbs: Math.round(f.carbs * qty),
    fat: Math.round(f.fat * qty),
  };
}

/**
 * How a scaled food is named in the log.
 *
 * The multiple goes in the name, because the row a member reads back a week
 * later shows a name and a calorie figure and nothing else — and "Greek Yogurt
 * (100 g)" at 260 kcal, with no ×2 anywhere, reads as a mistake in the app
 * rather than as two pots.
 *
 * A single portion is left alone. Writing "1 ×" in front of every food would be
 * noise on the ninety per cent case, and the basis is already in the name where
 * the source gave one.
 */
export function portionName(name: string, qty: number, basis: string | null): string {
  const clean = (name || 'Food').trim() || 'Food';
  if (qty === 1) return clean;
  const q = Number.isInteger(qty) ? String(qty) : String(Math.round(qty * 100) / 100);
  return basis ? `${clean} — ${q} × ${basis}` : `${clean} — ${q} portions`;
}

/** The label under the quantity control: what one portion IS, when the source
 *  said. Null when it did not, and then the control says "portions" and claims
 *  nothing about what one of them weighs. */
export function basisLabel(basis: string | null | undefined): string | null {
  const b = (basis ?? '').trim();
  return b ? `per ${b}` : null;
}
