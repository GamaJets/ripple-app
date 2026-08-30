// Common foods, as a person searches for them.
//
// ── Why this exists ───────────────────────────────────────────────────────
//
// "Search Foods" had two sources and neither covered the everyday case. Open
// Food Facts is a BRANDED database: it answers "Tesco Greek Style Yogurt 500g"
// and does badly at "chicken breast", because a chicken breast has no barcode.
// Alongside it sat a hard-coded list of TWELVE foods inside the screen file.
// Somebody logging an apple was searching a packaged-goods index for a piece
// of fruit.
//
// ── What the numbers are, and what they are not ───────────────────────────
//
// These are typical reference values for a stated portion — the figures a
// nutrition table gives for a food of that kind, not a measurement of the one
// in front of you. A chicken breast is 150 g here; yours might be 190 g. The
// UI labels this group "Common" and says so, because the alternative is
// somebody reading a generic average as though it were their own packet's
// label. A branded result, where one exists, is the more accurate answer and
// is why the remote search stays.
//
// Portions are written into the NAME rather than modelled as a unit system.
// That is what the screen already showed, it is how people describe what they
// ate, and a grams-and-servings model is a much larger thing that this does
// not need in order to be useful.
export interface CommonFood {
  /** Includes the portion, because the macros are for that portion. */
  n: string;
  k: number; p: number; c: number; f: number;
  /** Search aliases — what somebody types that is not in the name. */
  alias?: string;
}

/** One table, grouped only for reading. Values are per the portion named. */
export const COMMON_FOODS: CommonFood[] = [
  // ── Meat, fish, eggs ──────────────────────────────────────────────────
  { n: 'Chicken Breast, Grilled (150g)', k: 250, p: 47, c: 0, f: 5 },
  { n: 'Chicken Thigh, Skinless (150g)', k: 285, p: 39, c: 0, f: 14 },
  { n: 'Turkey Breast (150g)', k: 235, p: 45, c: 0, f: 5 },
  { n: 'Beef Mince, 5% Fat (150g)', k: 250, p: 40, c: 0, f: 10 },
  { n: 'Beef Steak, Sirloin (200g)', k: 400, p: 54, c: 0, f: 20 },
  { n: 'Lamb Chop (150g)', k: 400, p: 37, c: 0, f: 28 },
  { n: 'Pork Loin (150g)', k: 290, p: 40, c: 0, f: 14 },
  { n: 'Bacon, 2 Rashers', k: 120, p: 9, c: 0, f: 9 },
  { n: 'Salmon Fillet (160g)', k: 300, p: 34, c: 0, f: 18 },
  { n: 'Tuna, Tinned in Water (100g)', k: 110, p: 25, c: 0, f: 1 },
  { n: 'Cod Fillet (150g)', k: 125, p: 27, c: 0, f: 1 },
  { n: 'Prawns, Cooked (100g)', k: 100, p: 21, c: 1, f: 1 },
  { n: 'Egg, Whole, Large', k: 72, p: 6, c: 0, f: 5, alias: 'eggs' },
  { n: 'Egg White, Large', k: 17, p: 4, c: 0, f: 0 },

  // ── Dairy ─────────────────────────────────────────────────────────────
  { n: 'Greek Yogurt, 0% (200g)', k: 120, p: 20, c: 8, f: 0 },
  { n: 'Greek Yogurt, Full Fat (200g)', k: 200, p: 18, c: 8, f: 10 },
  { n: 'Milk, Semi-Skimmed (250ml)', k: 125, p: 9, c: 12, f: 4 },
  { n: 'Milk, Whole (250ml)', k: 160, p: 8, c: 12, f: 9 },
  { n: 'Cottage Cheese (200g)', k: 200, p: 24, c: 8, f: 8 },
  { n: 'Cheddar Cheese (30g)', k: 125, p: 7, c: 0, f: 10 },
  { n: 'Mozzarella (50g)', k: 150, p: 11, c: 1, f: 11 },
  { n: 'Feta (50g)', k: 132, p: 7, c: 2, f: 11 },
  { n: 'Butter (10g)', k: 74, p: 0, c: 0, f: 8 },

  // ── Grains, bread, pasta, rice ────────────────────────────────────────
  { n: 'Oats, Dry (60g)', k: 230, p: 8, c: 40, f: 5, alias: 'porridge' },
  { n: 'White Rice, Cooked (1 cup, 160g)', k: 205, p: 4, c: 45, f: 0 },
  { n: 'Brown Rice, Cooked (1 cup, 160g)', k: 215, p: 5, c: 45, f: 2 },
  { n: 'Pasta, Cooked (200g)', k: 260, p: 10, c: 52, f: 2 },
  { n: 'Wholemeal Bread, 1 Slice', k: 90, p: 4, c: 15, f: 1 },
  { n: 'White Bread, 1 Slice', k: 95, p: 3, c: 18, f: 1 },
  { n: 'Bagel, Plain', k: 250, p: 10, c: 48, f: 2 },
  { n: 'Tortilla Wrap, Large', k: 200, p: 6, c: 33, f: 5 },
  { n: 'Couscous, Cooked (180g)', k: 200, p: 7, c: 42, f: 0 },
  { n: 'Quinoa, Cooked (180g)', k: 220, p: 8, c: 39, f: 4 },
  { n: 'Potato, Boiled (200g)', k: 175, p: 4, c: 40, f: 0 },
  { n: 'Sweet Potato, Baked (200g)', k: 180, p: 4, c: 41, f: 0 },
  { n: 'Chips / Fries (150g)', k: 480, p: 6, c: 58, f: 25 },

  // ── Pulses and plant protein ──────────────────────────────────────────
  { n: 'Lentils, Cooked (200g)', k: 230, p: 18, c: 40, f: 1 },
  { n: 'Chickpeas, Cooked (200g)', k: 270, p: 15, c: 45, f: 4 },
  { n: 'Black Beans, Cooked (200g)', k: 265, p: 18, c: 47, f: 1 },
  { n: 'Baked Beans (200g)', k: 155, p: 10, c: 26, f: 1 },
  { n: 'Tofu, Firm (150g)', k: 185, p: 20, c: 4, f: 11 },
  { n: 'Tempeh (100g)', k: 195, p: 19, c: 8, f: 11 },
  { n: 'Hummus (50g)', k: 145, p: 4, c: 7, f: 11 },

  // ── Fruit ─────────────────────────────────────────────────────────────
  { n: 'Banana, Medium', k: 105, p: 1, c: 27, f: 0 },
  { n: 'Apple, Medium', k: 95, p: 0, c: 25, f: 0 },
  { n: 'Orange, Medium', k: 62, p: 1, c: 15, f: 0 },
  { n: 'Blueberries (100g)', k: 57, p: 1, c: 14, f: 0 },
  { n: 'Strawberries (100g)', k: 33, p: 1, c: 8, f: 0 },
  { n: 'Grapes (100g)', k: 69, p: 1, c: 18, f: 0 },
  { n: 'Mango (150g)', k: 90, p: 1, c: 22, f: 1 },
  { n: 'Pineapple (150g)', k: 75, p: 1, c: 20, f: 0 },
  { n: 'Avocado, Half', k: 160, p: 2, c: 9, f: 15 },
  { n: 'Dates, 3', k: 200, p: 2, c: 54, f: 0 },

  // ── Vegetables ────────────────────────────────────────────────────────
  { n: 'Broccoli (150g)', k: 51, p: 4, c: 10, f: 1 },
  { n: 'Spinach (100g)', k: 23, p: 3, c: 4, f: 0 },
  { n: 'Mixed Salad (100g)', k: 20, p: 2, c: 3, f: 0 },
  { n: 'Carrots (150g)', k: 62, p: 1, c: 14, f: 0 },
  { n: 'Peas (150g)', k: 125, p: 8, c: 21, f: 1 },
  { n: 'Sweetcorn (150g)', k: 130, p: 5, c: 29, f: 2 },
  { n: 'Tomato, Medium', k: 22, p: 1, c: 5, f: 0 },
  { n: 'Cucumber (100g)', k: 15, p: 1, c: 4, f: 0 },
  { n: 'Mushrooms (100g)', k: 22, p: 3, c: 3, f: 0 },
  { n: 'Onion, Medium', k: 44, p: 1, c: 10, f: 0 },

  // ── Nuts, seeds, fats ─────────────────────────────────────────────────
  { n: 'Almonds (30g)', k: 175, p: 6, c: 6, f: 15 },
  { n: 'Peanuts (30g)', k: 170, p: 8, c: 5, f: 15 },
  { n: 'Cashews (30g)', k: 165, p: 5, c: 9, f: 13 },
  { n: 'Walnuts (30g)', k: 195, p: 5, c: 4, f: 19 },
  { n: 'Peanut Butter (30g)', k: 180, p: 7, c: 6, f: 15 },
  { n: 'Chia Seeds (20g)', k: 97, p: 3, c: 8, f: 6 },
  { n: 'Olive Oil (1 tbsp)', k: 120, p: 0, c: 0, f: 14 },
  { n: 'Mayonnaise (1 tbsp)', k: 95, p: 0, c: 0, f: 10 },

  // ── Drinks and supplements ────────────────────────────────────────────
  { n: 'Whey Protein, 1 Scoop (30g)', k: 120, p: 24, c: 3, f: 2, alias: 'shake' },
  { n: 'Coffee, Black', k: 2, p: 0, c: 0, f: 0 },
  { n: 'Latte, Regular (350ml)', k: 190, p: 12, c: 18, f: 7 },
  { n: 'Cola (330ml can)', k: 139, p: 0, c: 35, f: 0, alias: 'coke' },
  { n: 'Diet Cola (330ml can)', k: 1, p: 0, c: 0, f: 0, alias: 'diet coke zero' },
  { n: 'Orange Juice (250ml)', k: 112, p: 2, c: 26, f: 0 },
  { n: 'Beer, Pint', k: 200, p: 2, c: 17, f: 0 },
  { n: 'Wine, Glass (175ml)', k: 145, p: 0, c: 4, f: 0 },

  // ── Things people actually eat and forget to log ──────────────────────
  { n: 'Protein Bar', k: 210, p: 20, c: 21, f: 7 },
  { n: 'Cereal Bar', k: 130, p: 2, c: 22, f: 4 },
  { n: 'Milk Chocolate (50g)', k: 265, p: 4, c: 29, f: 15 },
  { n: 'Crisps, Standard Bag (25g)', k: 130, p: 2, c: 13, f: 8 },
  { n: 'Biscuit, Digestive', k: 70, p: 1, c: 10, f: 3 },
  { n: 'Croissant', k: 230, p: 5, c: 26, f: 12 },
  { n: 'Toast with Butter, 1 Slice', k: 165, p: 4, c: 15, f: 9 },
  { n: 'Porridge with Milk (Bowl)', k: 290, p: 12, c: 45, f: 7 },
  { n: 'Ice Cream (100g)', k: 210, p: 4, c: 24, f: 11 },
];

/**
 * Search the common foods.
 *
 * Word-prefix matching, not substring: "rice" should find Brown Rice and not
 * every food with those letters somewhere inside it. Matches earlier in the
 * name rank higher, so typing "chicken" leads with Chicken Breast rather than
 * whatever happens to be first in the table.
 *
 * ── Every word typed has to land ──────────────────────────────────────────
 *
 * The query is split on the same boundaries as the name, and each word must
 * prefix-match a word of the food. This started as a single-token match against
 * the whole trimmed string, which meant no word in any name began with
 * "chicken breast" — a space cannot be inside a word — so the two most obvious
 * queries a person types, "chicken breast" and "greek yogurt", matched nothing
 * at all and fell through to a packaged-goods index. A single-word query scores
 * exactly as it did before; a phrase is now a narrower question rather than an
 * unanswerable one.
 */
export function searchCommonFoods(query: string, limit = 12): CommonFood[] {
  const terms = (query || '').trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!terms.length) return [];
  const scored: { f: CommonFood; score: number }[] = [];
  for (const f of COMMON_FOODS) {
    const name = f.n.toLowerCase();
    const hay = `${name} ${f.alias ?? ''}`;
    const words = hay.split(/[^a-z0-9]+/).filter(Boolean);
    // Where the FIRST word typed landed decides how early the match is; the
    // rest only have to land somewhere, because people type the qualifier in
    // whatever order they think of it ("yogurt greek" is the same question).
    let at = -1;
    let whole = true;
    let all = true;
    for (const term of terms) {
      const i = words.findIndex((w) => w.startsWith(term));
      if (i === -1) { all = false; break; }
      if (words[i] !== term) whole = false;
      if (at === -1) at = i;
    }
    if (!all) continue;
    // Earlier word wins; a whole-word match beats a prefix of a longer word.
    scored.push({ f, score: at * 10 + (whole ? 0 : 1) });
  }
  scored.sort((a, b) => a.score - b.score || a.f.n.localeCompare(b.f.n));
  return scored.slice(0, limit).map((s) => s.f);
}
