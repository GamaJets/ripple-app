// What the meal engine calls dairy, and the six things it used to call dairy
// that are not. Compile with tsc, run with node.
//
// The dairy matcher was `/milk|yogurt|yoghurt|cheese|whey|butter|cream|greek/`
// with no word boundary anywhere in it, so `butternut squash` matched `butter`,
// `peanut butter` and `almond butter` matched it too, and the three `Soy milk`
// breakfasts matched `milk`. A member who ticked Dairy lost all of them from
// their pool, and where that emptied a required pool `allergenGapNote` told
// them their plan still contained dairy when it contained none.
//
// So this file asserts both halves and neither is optional: the lookalikes are
// NOT dairy, and everything that genuinely is dairy still is. A matcher that
// stopped flagging butter would be a far worse bug than the one being fixed.
import {
  ALLERGENS, allergenGapNote, mealAllergens, planGaps, poolGaps,
  type Allergen,
} from './meals';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const EVERY: Allergen[] = ALLERGENS.map((a) => a.id);
/** What the engine thinks is in a dish, tested through the exported surface a
 *  screen actually calls. */
const found = (n: string, ...items: string[]): Allergen[] =>
  mealAllergens({ n, ing: items.map((i) => [i, 1, 'g', 'Pantry & Other'] as [string, number, string, 'Pantry & Other']) }, EVERY);
const has = (a: Allergen, n: string, ...items: string[]) => found(n, ...items).includes(a);

/* ── the lookalikes: not dairy ─────────────────────────────────────────── */

// Every one of these is a real row in src/lib/meals.ts.
ok(!has('dairy', 'butternut squash', 'Butternut squash'), 'butternut squash is a vegetable');
ok(!has('dairy', 'peanut butter', 'Peanut butter'), 'peanut butter is not dairy');
ok(!has('dairy', '+ almond butter', 'Almond butter'), 'almond butter is not dairy');
ok(!has('dairy', 'nut-butter toast', 'Wholegrain bread', 'Peanut butter'), 'a hyphenated nut-butter is not dairy either');
ok(!has('dairy', 'overnight oats', 'Rolled oats', 'Soy milk'), 'soy milk is a bean');
ok(!has('dairy', 'chia pudding', 'Chia seeds', 'Soy milk'), 'and it is still a bean in a pudding');
ok(!has('dairy', 'pea-protein shake', 'Pea protein', 'Soy milk'), 'the vegan shake contains no dairy');
ok(!has('dairy', 'curry', 'Coconut milk'), 'coconut milk is not dairy');
ok(!has('dairy', 'porridge', 'Oat milk'), 'oat milk is not dairy');

// The lookalike strip must not cost them their REAL allergen. A nut butter is
// still nuts and soy milk is still soy — losing that would trade one silent
// exclusion for a genuinely dangerous one.
ok(has('nuts', 'peanut butter', 'Peanut butter'), 'peanut butter is still nuts');
ok(has('nuts', '+ almond butter', 'Almond butter'), 'almond butter is still nuts');
ok(has('nuts', 'nut-butter toast', 'Wholegrain bread', 'Peanut butter'), 'nut-butter toast is still nuts');
ok(has('soy', 'overnight oats', 'Rolled oats', 'Soy milk'), 'soy milk is still soy');
ok(has('gluten', 'nut-butter toast', 'Wholegrain bread', 'Peanut butter'), 'and the bread under it is still gluten');

/* ── the real thing: still dairy ───────────────────────────────────────── */

ok(has('dairy', 'oats', 'Rolled oats', 'Milk'), 'milk is dairy');
ok(has('dairy', 'cauliflower mash', 'Cauliflower', 'Butter'), 'butter is dairy');
ok(has('dairy', 'Garlic-butter', 'Butter', 'Garlic'), 'garlic butter is dairy');
ok(has('dairy', 'protein shake', 'Whey protein', 'Milk'), 'whey is dairy');
ok(has('dairy', 'greek yogurt', 'Greek yogurt'), 'greek yogurt is dairy');
ok(has('dairy', 'cottage cheese', 'Cottage cheese'), 'cheese is dairy');
ok(has('dairy', 'yoghurt bowl', 'Natural yoghurt'), 'the other spelling is dairy');
ok(has('dairy', 'pancakes', 'Buttermilk'), 'buttermilk is dairy, and neither boundary finds it on its own');
ok(has('dairy', 'creamy mushroom sauce', 'Double cream'), 'cream is dairy');
ok(has('dairy', 'ice cream', 'Ice cream'), 'and so is ice cream');

// The direction the matcher errs in, said as an assertion so a later edit
// cannot quietly reverse it: a dairy word this file has never heard of in
// front of another word still counts as dairy.
ok(has('dairy', 'kefir milk drink', 'Kefir milk'), 'an unrecognised prefix still leaves the dairy word flagged');

/* ── and what the member is told ───────────────────────────────────────── */

// The whole point of the fix. A vegan plan excluding dairy contains no dairy,
// so there is no gap to report and no sentence claiming otherwise.
eq(poolGaps('vegan', 'Breakfast', ['dairy']).length, 0, 'a vegan breakfast can be built without dairy');
eq(planGaps('vegan', ['Breakfast', 'Lunch', 'Dinner', 'Snack'], ['dairy']).length, 0,
  'and so can a whole vegan day');
eq(allergenGapNote(planGaps('vegan', ['Breakfast', 'Lunch', 'Dinner', 'Snack'], ['dairy'])), null,
  'so the member is told nothing, which is the truth');

// The note itself is unchanged and still names what it found. This is the
// sentence somebody with a real allergy reads, so it is asserted here too.
const note = allergenGapNote(['dairy']);
ok(!!note && note.includes('dairy'), 'a real gap still names the allergen');
ok(!!note && /check every dish/i.test(note), 'and still tells them to check');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('mealAllergens: ok');
