// ── What a shopping-list line puts in a basket ───────────────────────────────
//
// The list summed a week's ingredients and printed the sum: "Jasmine rice (dry)
// 810g", "Garlic 3 clove". Nobody buys 810 g of rice. They buy a 1 kg bag, and
// they buy a bulb of garlic. So a line now says what to pick up, rounded UP to
// whole packs, and keeps the exact amount the plan needs beside it, so a
// member who already has half a bag in the cupboard can see what they need.
//
// ── The table is data, and deliberately short ────────────────────────────────
//
// Every size below is a common supermarket size for that food (UK own-brand
// shelves, which the app's ingredient names already follow: courgette, cod
// fillet, passata). Where the usual sizes vary widely, or the food is sold
// loose or by weight at a counter (meat, fish, most fresh produce, protein
// powder), there is NO entry, and the line says the weight or count plainly
// rather than inventing a pack. Where a food comes in a couple of common
// sizes, the smaller is used, so rounding up to whole packs never leaves
// anybody short.
//
// `size` is how much of the PLAN'S unit one pack yields, which is not always
// what is printed on it: a 400 g tin of chickpeas holds about 240 g drained,
// and the recipes measure drained. `text` is what is printed on it.

export interface Pack { size: number; text: string; one: string; many?: string }

/** item → unit → pack. Keyed by the ingredient names in src/lib/meals.ts. */
const PACKS: Record<string, Record<string, Pack>> = {
  // Dry goods: bags and boxes.
  'White rice (dry)': { g: { size: 1000, text: '1 kg', one: 'bag' } },
  'Brown rice (dry)': { g: { size: 1000, text: '1 kg', one: 'bag' } },
  'Jasmine rice (dry)': { g: { size: 1000, text: '1 kg', one: 'bag' } },
  'Quinoa (dry)': { g: { size: 300, text: '300 g', one: 'bag' } },
  'Wholewheat pasta': { g: { size: 500, text: '500 g', one: 'bag' } },
  'Couscous': { g: { size: 500, text: '500 g', one: 'bag' } },
  'Soba noodles': { g: { size: 250, text: '250 g', one: 'pack' } },
  'Rolled oats': { g: { size: 1000, text: '1 kg', one: 'bag' } },
  'Granola': { g: { size: 500, text: '500 g', one: 'box', many: 'boxes' } },
  // An 800 g loaf is about twenty slices; sixteen, so a loaf is never short.
  'Wholegrain bread': { slice: { size: 16, text: '', one: 'loaf', many: 'loaves' } },
  // Tins, measured drained.
  'Chickpeas': { g: { size: 240, text: '400 g', one: 'tin' } },
  'Black beans': { g: { size: 240, text: '400 g', one: 'tin' } },
  'Cooked lentils': { g: { size: 240, text: '400 g', one: 'tin' } },
  'Tuna': { g: { size: 100, text: '145 g', one: 'tin' } },
  'Tomato passata': { g: { size: 500, text: '500 g', one: 'carton' } },
  // Chilled.
  'Eggs': { '': { size: 6, text: '', one: 'box of 6', many: 'boxes of 6' } },
  'Milk': { ml: { size: 1000, text: '1 litre', one: 'bottle' } },
  'Soy milk': { ml: { size: 1000, text: '1 litre', one: 'carton' } },
  'Greek yogurt': { g: { size: 500, text: '500 g', one: 'tub' } },
  'Yogurt': { g: { size: 500, text: '500 g', one: 'tub' } },
  'Cottage cheese': { g: { size: 300, text: '300 g', one: 'tub' } },
  'Hummus': { g: { size: 200, text: '200 g', one: 'tub' } },
  'Halloumi': { g: { size: 225, text: '225 g', one: 'block' } },
  'Paneer': { g: { size: 200, text: '200 g', one: 'block' } },
  'Cheddar': { g: { size: 200, text: '200 g', one: 'block' } },
  'Feta': { g: { size: 200, text: '200 g', one: 'block' } },
  'Butter': { g: { size: 250, text: '250 g', one: 'block' } },
  'Firm tofu': { g: { size: 280, text: '280 g', one: 'block' } },
  'Tempeh': { g: { size: 200, text: '200 g', one: 'block' } },
  // Jars.
  'Peanut butter': { g: { size: 340, text: '340 g', one: 'jar' } },
  'Almond butter': { g: { size: 170, text: '170 g', one: 'jar' } },
  'Honey': { g: { size: 340, text: '340 g', one: 'jar' } },
  'Pesto': { g: { size: 190, text: '190 g', one: 'jar' } },
  'Olive oil': { ml: { size: 500, text: '500 ml', one: 'bottle' } },
  // Bags of nuts, a bar of chocolate.
  'Mixed nuts': { g: { size: 200, text: '200 g', one: 'bag' } },
  'Almonds': { g: { size: 200, text: '200 g', one: 'bag' } },
  'Dark chocolate': { g: { size: 100, text: '100 g', one: 'bar' } },
  // Produce that is sold in a pack more often than loose.
  'Spinach': { g: { size: 200, text: '200 g', one: 'bag' } },
  'Kale': { g: { size: 200, text: '200 g', one: 'bag' } },
  'Cherry tomatoes': { g: { size: 250, text: '250 g', one: 'punnet' } },
  // A bulb is ten or more cloves; eight, so a bulb is never short.
  'Garlic': { clove: { size: 8, text: '', one: 'bulb' } },
};

/**
 * The small flavourings: a spice mix, a jar of sauce, the oil. A week of
 * dinners uses 20 g of each, and listed among the vegetables as "Harissa 60 g"
 * they read as a shop to do. They are a store-cupboard check instead: most
 * members already have them, and the list says so under its own heading.
 */
const CUPBOARD = new Set([
  'Cajun spice', 'Mixed herbs', 'Peri-peri sauce', 'Harissa', 'Teriyaki sauce',
  'Curry sauce', 'Salsa', 'Pesto', 'Turmeric', 'Olive oil', 'Honey',
]);

export const CUPBOARD_HEAD = 'Store Cupboard';

export function isCupboard(item: string): boolean {
  return CUPBOARD.has(item);
}

/** Units counted in whole things, which the list rounds up. */
const COUNTED = ['', 'piece', 'slice', 'clove', 'rasher', 'scoop', 'cup', 'pinch'];

/** The exact amount, rounded only as far as anybody measures it. */
export function roundNeed(qty: number, unit: string): number {
  if (unit === 'g' || unit === 'ml') return Math.round(qty / 10) * 10;
  if (COUNTED.includes(unit)) return Math.ceil(qty - 1e-9);
  return Math.round(qty * 10) / 10;
}

const plural = (unit: string, n: number) =>
  n === 1 || !unit || unit === 'g' || unit === 'ml' ? unit : unit === 'pinch' ? 'pinches' : unit + 's';

/**
 * How the amount the plan needs reads: "810 g", "1.26 kg", "3 cloves", "2".
 * `fmt` formats the figure, so a screen can pass its locale's formatter.
 */
export function needText(qty: number, unit: string, fmt: (n: number, places: number) => string = (n, p) => String(+n.toFixed(p))): string {
  if (unit === 'g' && qty >= 1000) return `${fmt(qty / 1000, 2)} kg`;
  if (unit === 'ml' && qty >= 1000) return `${fmt(qty / 1000, 2)} litres`;
  const u = plural(unit, qty);
  return u ? `${fmt(qty, 1)} ${u}` : fmt(qty, 1);
}

/**
 * What to put in the basket for `qty` of an item, or null when it has no
 * sensible pack (see the table) and the amount itself is the line.
 * Always rounded UP: a list that leaves you short is the worse mistake.
 */
export function packFor(item: string, qty: number, unit: string): string | null {
  const pack = PACKS[item]?.[unit];
  if (!pack || !(qty > 0)) return null;
  const n = Math.max(1, Math.ceil(qty / pack.size - 1e-9));
  const name = n === 1 ? pack.one : (pack.many ?? pack.one + 's');
  if (!pack.text) return `${n} ${name}`;
  return n === 1 ? `${pack.text} ${name}` : `${n} × ${pack.text} ${name}`;
}
