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
  catalogSize, mealAt,
  type Allergen, type Slot,
} from './meals';
import { readDiet, type Diet } from './types';

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

/* ── the foods that ARE the allergen and never say so ────────────────────── */
//
// A word test only finds an allergen that is spelled out, and four components
// in src/lib/meals.ts spell out something else entirely. Every one of them was
// served to a member who had excluded it, on a plate the planner had filtered
// FOR them, with no mark on the row — because `mealAllergens` reads the same
// words the pool filter does and found nothing in either.
//
// These are the rows, exactly as they appear in the component tables.

ok(has('dairy', 'halloumi', 'Halloumi'), 'halloumi is a cheese');
ok(has('dairy', 'paneer', 'Paneer'), 'paneer is a cheese');
ok(has('gluten', 'seitan', 'Seitan'), 'seitan is wheat gluten — the word is a synonym for it');
// Softer than seitan and made the same way the file says to make it: Japanese
// curry sauce is thickened with a wheat-flour roux, and this component's only
// ingredient is the words "Curry sauce", which no word test can tell from a
// gluten-free one. Adding it changes no poolGaps warning — checked by hashing
// every diet x every subset of the six allergens with and without the rule.
ok(has('gluten', 'Katsu curry', 'Curry sauce'), 'katsu curry sauce is a wheat-flour roux');
ok(has('dairy', 'Pesto', 'Pesto'), 'pesto has parmesan in it, which is why its own diet list excludes vegan');
ok(has('nuts', 'Pesto', 'Pesto'), 'and pine nuts');
ok(has('soy', 'Teriyaki', 'Teriyaki sauce'), 'teriyaki is a soy-sauce glaze');

// Through the assembled dish, which is the string a member actually reads —
// `mealAt` composes "Harissa halloumi with roast potatoes & kale" and the mark
// under it is read off that whole name plus its ingredients.
ok(has('dairy', 'Harissa halloumi with roast potatoes & kale', 'Halloumi', 'Harissa'),
  'the mark survives into the composed dinner name');
ok(has('gluten', 'Teriyaki seitan with white rice & broccoli', 'Seitan', 'Teriyaki sauce'),
  'and so does the gluten in a vegan protein');

// The same matcher is what `dishAllergens` runs over a restaurant dish and a
// search result, where there are no ingredients at all and the NAME is the
// whole of the evidence. src/lib/restaurant.ts ships both of these.
ok(has('dairy', 'Halloumi & quinoa salad'), 'a dish named for its cheese is marked from the name alone');
ok(has('soy', 'Chicken teriyaki + rice'), 'and so is the teriyaki on the Eating Out list');

// Nothing widened by accident: these are the words the additions sit closest to.
ok(!has('dairy', 'pan-seared cod', 'Cod fillet'), 'nothing else picked up a dairy mark');
ok(!has('gluten', 'white rice', 'White rice (dry)'), 'and rice is still not gluten');

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

/* ── exclusions that only fail TOGETHER ──────────────────────────────────── */
//
// `poolFilter` filters against the whole exclusion list at once and falls back
// to the UNFILTERED pool when that empties one. `poolGaps` asked each allergen
// ALONE. So a pair that empties a pool only in combination — dairy alone leaves
// something, gluten alone leaves something, dairy and gluten together leave
// nothing — produced a plan built from the very components the member excluded,
// with `allergenGapNote` returning null and no banner anywhere.
//
// The invariant, asserted over every diet, every slot and every subset of the
// six exclusions: if a generated meal contains something the member excluded,
// the member is TOLD. Not "which allergen" — that is a judgement — but that the
// filter was not honoured. A silent plan with dairy in it is the failure.

{
  const DIETS: Diet[] = ['meat', 'vegetarian', 'vegan', 'paleo', 'keto'];
  const SLOTS: Slot[] = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
  const ids = ALLERGENS.map((a) => a.id);
  let silent = 0;
  let checked = 0;
  // Every non-empty subset of the six.
  for (let mask = 1; mask < (1 << ids.length); mask++) {
    const avoid = ids.filter((_, i) => (mask & (1 << i)) !== 0);
    for (const diet of DIETS) {
      for (const slot of SLOTS) {
        const size = catalogSize(diet, slot, avoid);
        const gaps = poolGaps(diet, slot, avoid);
        // A sample across the catalogue rather than all of it: the pools are a
        // mixed radix, so the first few indices already cross every dimension
        // that can carry an excluded component.
        for (let i = 0; i < Math.min(size, 12); i++) {
          checked++;
          const meal = mealAt(diet, slot, i, avoid);
          const inIt = mealAllergens(meal, avoid);
          if (inIt.length && gaps.length === 0) silent++;
        }
      }
    }
  }
  ok(checked > 0, 'the sweep actually generated meals');
  eq(silent, 0,
    'no generated meal contains an excluded allergen while the member is told nothing — the combination case used to be exactly this');
}


/* ── a diet the union does not have ──────────────────────────────────────── */
//
// `clients.diet` is a text column and `Diet` is a five-member union, and
// src/ui/clientData.tsx used to cast one to the other. A row holding anything
// else left every component pool empty, and `mealAt` assembled the meal by
// reading `.n` off those pools — a TypeError out of render, taking the whole
// nutrition screen with it. `readDiet` closes the ingress; this asserts the
// second lock, because a crash inside render is worse than any wrong meal.

{
  eq(readDiet('balanced'), 'meat', 'an unrecognised diet reads as the column’s own default');
  eq(readDiet('vegan'), 'vegan', 'and a real one is untouched');
  eq(readDiet(null), 'meat', 'as is a null');
  let threw = false;
  try {
    // Cast deliberately: this is the shape of a row that has been in the
    // database, not a shape the type system allows.
    const meal = mealAt('balanced' as Diet, 'Breakfast', 0, []);
    ok(typeof meal.n === 'string', 'a meal is still produced');
  } catch { threw = true; }
  ok(!threw, 'and nothing throws out of the meal builder for a diet with no components');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('mealAllergens: ok');
