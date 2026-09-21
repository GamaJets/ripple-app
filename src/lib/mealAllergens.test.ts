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
  ALLERGENS, allergenGapNote, mealAllergens, mealRowSpoken, emptySlots, poolGaps,
  catalogSize, mealAt, buildPlan, planWeek, groceryFromWeek, swapIndex, searchMeals, catalogRepeatDay, slotsFor,
  dislikeFreeIndex, dislikeGapNote, dislikeGaps, excludedAllergens, mealDislikes, preferNotDisliked,
  readAllergenColumn, readDislikes, textDislikes, variantStep,
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
eq(emptySlots('vegan', ['Breakfast', 'Lunch', 'Dinner', 'Snack'], ['dairy']).length, 0,
  'and so can a whole vegan day');
eq(allergenGapNote(emptySlots('vegan', ['Breakfast', 'Lunch', 'Dinner', 'Snack'], ['dairy'])), null,
  'so the member is told nothing, which is the truth');

// The note names the slot, the allergen and what to do, and never claims the
// plan contains anything: the slot was left empty so that it would not.
{
  const note = allergenGapNote([{ slot: 'Breakfast', allergens: ['soy'] }])!;
  ok(/no breakfast in your plan/i.test(note), 'the note names the empty slot');
  ok(/soy/.test(note), 'and the allergen that is why');
  ok(/search real recipes/i.test(note) && /coach/i.test(note), 'and what to do instead');
  ok(!/still contains/i.test(note), 'and does not say the plan contains it, because it does not');
  ok(!/—/.test(note), 'with no em dash');
}

/* ── an allergen is never inside a generated meal ─────────────────────────── */
//
// `poolFilter` used to fall back to the UNFILTERED pool when the exclusions
// emptied one, and the member was served the allergen under a red warning.
// Now that slot is served EMPTY. Swept over every diet, every slot and every
// one of the 64 exclusion subsets: no generated meal contains an excluded
// allergen, and every slot that cannot be made safely is empty and named.
//
// Measured when this was written: 76 of the 1,280 combinations have no safe
// meal, every one of them a breakfast. Vegan breakfasts without soy are 32 of
// them (every vegan breakfast base is tofu or soy milk), paleo without egg and
// soy 16, meat 12, vegetarian and keto 8 each (dairy, egg and soy together, or
// dairy, gluten and egg for meat).
{
  const DIETS: Diet[] = ['meat', 'vegetarian', 'vegan', 'paleo', 'keto'];
  const SLOTS: Slot[] = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
  const ids = ALLERGENS.map((a) => a.id);
  let served = 0, unsafe = 0, empty = 0;
  const emptyAt = new Set<string>();
  for (let mask = 0; mask < (1 << ids.length); mask++) {
    const avoid = ids.filter((_, i) => (mask & (1 << i)) !== 0);
    for (const diet of DIETS) {
      for (const slot of SLOTS) {
        const size = catalogSize(diet, slot, avoid);
        const gaps = poolGaps(diet, slot, avoid);
        eq(size === 0, gaps.length > 0, `${diet}/${slot}/${avoid.join('+')}: an empty catalogue and a named gap are the same fact`);
        if (!size) {
          empty++;
          emptyAt.add(`${diet}/${slot}`);
          const m = mealAt(diet, slot, 7, avoid);
          ok(!!m.unfillable?.length && m.ing.length === 0 && m.k === 0 && m.steps.length === 0,
            `${diet}/${slot}/${avoid.join('+')}: an unfillable slot is served empty`);
          ok(gaps.every((a) => avoid.includes(a)) && m.n.includes(gaps.map((a) => ALLERGENS.find((x) => x.id === a)!.label.toLowerCase())[0]),
            `${diet}/${slot}/${avoid.join('+')}: and named after what it cannot be made without: ${m.n}`);
          eq(m.idx, 7, 'and the pick it was asked for is carried, not rewritten');
          continue;
        }
        // A spread across the whole catalogue, every dimension crossed.
        const step = Math.max(1, Math.floor(size / 97));
        for (let i = 0; i < size; i += step) {
          served++;
          const m = mealAt(diet, slot, i, avoid);
          if (m.unfillable || mealAllergens(m, avoid).length) unsafe++;
        }
      }
    }
  }
  ok(served > 100000, 'the sweep actually generated meals');
  eq(unsafe, 0, 'no generated meal contains an excluded allergen, in any diet, slot or combination');
  eq(empty, 76, 'and 76 of the 1,280 combinations have no safe meal to serve');
  eq([...emptyAt].sort().join(','), 'keto/Breakfast,meat/Breakfast,paleo/Breakfast,vegan/Breakfast,vegetarian/Breakfast',
    'every one of them a breakfast');
  // The member's own sentence for the common one.
  eq(mealAt('vegan', 'Breakfast', 0, ['soy']).n, 'No breakfast we can make without soy', 'a vegan avoiding soy is told why');
  eq(poolGaps('vegan', 'Breakfast', ['dairy', 'soy']).join(), 'soy', 'and dairy is not blamed for what soy did');
  eq(poolGaps('meat', 'Breakfast', ['dairy', 'gluten', 'shellfish', 'egg']).join(), 'dairy,gluten,egg',
    'a combination names the ones that fail together and not the bystander');
}

/* ── no stored index changes meaning ──────────────────────────────────────── */
//
// Meals are stored as integer positions in the filtered pools (a coach's plan,
// a member's swap). The fix changed what happens when a filtered pool is EMPTY
// and nothing else, so every catalogue that can be built must decode every
// index exactly as it did before. This digest was taken from the engine at
// d16a966, BEFORE the change: 1,204 buildable combinations, their sizes, and
// the meal at 32 points across each. Checked in full at the time too: all
// 3,125,472 indices of those catalogues decode to the same meal. If this
// fails, saved plans are pointing at different food.
{
  const DIETS: Diet[] = ['meat', 'vegetarian', 'vegan', 'paleo', 'keto'];
  const SLOTS: Slot[] = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
  const ids = ALLERGENS.map((a) => a.id);
  let h = 0x811c9dc5, combos = 0;
  const mix = (str: string) => { for (let j = 0; j < str.length; j++) { h ^= str.charCodeAt(j); h = Math.imul(h, 16777619) >>> 0; } };
  for (const d of DIETS) for (const s of SLOTS) for (let m = 0; m < 64; m++) {
    const av = ids.filter((_, i) => (m >> i) & 1);
    if (poolGaps(d, s, av).length) continue;
    combos++;
    const size = catalogSize(d, s, av);
    mix(`${d}/${s}/${m}:${size};`);
    for (let k = 0; k < 32; k++) { const x = mealAt(d, s, Math.floor((k * size) / 32), av); mix(x.n + '|' + x.k + ';'); }
  }
  eq(combos, 1204, 'the same 1,204 combinations can be built');
  eq(h.toString(16), '7f2e797c', 'and every one of them decodes its indices exactly as before');
}

/* ── an empty slot, all the way down ──────────────────────────────────────── */
{
  const same = (a: unknown, b: unknown, msg: string) => eq(JSON.stringify(a), JSON.stringify(b), msg);
  const input = {
    id: 'u-vegan-soy', weightKg: 64, bodyFatPct: 26, activity: 1.5, goal: 'fatloss' as const,
    diet: 'vegan' as Diet, mealsPerDay: 4 as const, avoid: ['soy'] as Allergen[],
  };
  const full = buildPlan({ ...input, avoid: [] });
  const built = buildPlan(input);
  const empty = built.plan.filter((m) => m.unfillable);
  eq(empty.length, 1, 'a vegan avoiding soy has one empty slot');
  eq(empty[0].slot, 'Breakfast', 'and it is breakfast');
  eq(empty[0].K, 0, 'which carries no calories');
  eq(empty[0].servings, 0, 'and no servings');
  ok((empty[0].slotKcal ?? 0) > 0, 'but knows its share, for a recipe put in it');
  eq(built.tot.K, built.plan.reduce((a, m) => a + m.K, 0), 'the day total is the meals actually served');
  ok(built.aim < built.target.kcal, 'and the served meals aim at their share, not the whole day');
  ok(Math.abs(built.tot.K - built.aim) < Math.abs(built.tot.K - built.target.kcal), 'so the total does not read as a full day');
  eq(full.aim, full.target.kcal, 'a full day still aims at the whole target');
  same(built.plan.filter((m) => !m.unfillable).map((m) => mealAllergens(m, ['soy']).length), [0, 0, 0], 'and nothing served has soy in it');
  same(emptySlots('vegan', slotsFor(4), ['soy']), [{ slot: 'Breakfast', allergens: ['soy'] }], 'the screen is told which slot and why');

  // A week, a month, and the shopping for them.
  const week = planWeek(input, undefined, 7);
  ok(week.every((day) => day[0].unfillable && day[0].ing.length === 0), 'every day of the week has the same empty breakfast');
  const groc = groceryFromWeek(week);
  const items = Object.values(groc.byDept).flat().map((g) => g!.item.toLowerCase());
  ok(!items.some((i) => /tofu|soy/.test(i)), 'the grocery list buys no soy');
  eq(groc.mealCount, new Set(week.flat().filter((m) => !m.unfillable).map((m) => m.n)).size, 'and counts only meals that are served');
  eq(planWeek(input, undefined, 30).length, 30, 'a month plans through an empty slot without failing');
  eq(catalogRepeatDay('vegan', 'Breakfast', ['soy']), Infinity, 'an empty slot never repeats');

  // Swapping into and out of it.
  eq(swapIndex('vegan', 'Breakfast', 12, ['soy']), 12, 'swapping an empty slot keeps its pick rather than crashing');
  ok(Number.isInteger(swapIndex('vegan', 'Breakfast', 12, ['soy'], ['banana'])), 'with dislikes too');
  same(searchMeals('vegan', 'Breakfast', '', 40, ['soy']), [], 'there is nothing to search in it');
  same(searchMeals('vegan', 'Breakfast', 'oats', 40, ['soy'], ['banana']), [], 'nothing, with a query and dislikes');
  // A pick stored before the member disclosed soy is served empty, and comes
  // back as the same meal if the exclusion is ever lifted.
  const stored = buildPlan({ ...input, avoid: [], mealOverride: { 0: 123 } }).plan[0];
  const now = buildPlan({ ...input, mealOverride: { 0: 123 } }).plan[0];
  ok(!!now.unfillable, 'a stored breakfast pick is not served over a soy exclusion');
  eq(now.idx, 123, 'and the pick itself is untouched');
  eq(buildPlan({ ...input, avoid: [], mealOverride: { 0: now.idx } }).plan[0].n, stored.n, 'so it means the same meal again without the exclusion');
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

/* ── and what the row says out loud ────────────────────────────────────── */

// The mark on the row is worth nothing to the member who cannot see it. All
// three meal lists in app/(client)/nutrition.tsx are `<Pressable>`s, which
// React Native renders `accessible={true}` — one element, whose
// `accessibilityLabel` REPLACES its children rather than adding to them. All
// three carried `accessibilityLabel={m.n}`, so the dish name was the whole of
// what a screen reader was told and the "Contains dairy" line beneath it was
// silent. These assertions are about the sentence, not about the matcher.

eq(mealRowSpoken({ slot: 'Lunch', name: 'Harissa halloumi', allergens: ['dairy'], kcal: '520' }),
  "Lunch. Harissa halloumi. Contains dairy. 520 kcal",
  'the warning is in the sentence, after the dish and before the figure');

eq(mealRowSpoken({ slot: 'Lunch', name: 'Grilled chicken and rice', allergens: [], kcal: '520' }),
  'Lunch. Grilled chicken and rice. 520 kcal',
  'and a dish with nothing in it says nothing — no empty clause, no "contains none"');

eq(mealRowSpoken({ slot: 'Breakfast', coachPick: true, name: 'Oats', allergens: ['dairy', 'gluten'], kcal: '410' }),
  "Breakfast. Coach's pick. Oats. Contains dairy and gluten. 410 kcal",
  'two exclusions are joined with "and", and the coach kicker keeps its place');

// The snack list has no slot and the week grid has no kicker; both drop the
// clause rather than leaving a gap in the sentence.
eq(mealRowSpoken({ name: 'Trail mix', allergens: ['nuts'], kcal: '150' }),
  'Trail mix. Contains nuts. 150 kcal', 'a row with no slot is still a sentence');
eq(mealRowSpoken({ name: 'Trail mix' }), 'Trail mix', 'and a bare name survives being the only thing there is');

// The figure is the CALLER's — the three lists format it differently (`num()`
// on two of them, raw on the other) and the rule is that the ear hears what the
// eye reads. A blank one is dropped rather than voiced as a bare unit.
eq(mealRowSpoken({ name: 'Trail mix', kcal: '1,150' }), 'Trail mix. 1,150 kcal',
  'the caller’s own formatting is what gets said');
eq(mealRowSpoken({ name: 'Trail mix', kcal: '' }), 'Trail mix', 'an empty figure is not "kcal" on its own');
eq(mealRowSpoken({ name: 'Trail mix', kcal: null }), 'Trail mix', 'and neither is a null one');

// Straight off the engine, so the sentence is tested against a dish that
// really does carry the thing rather than against a hand-written array.
{
  const meal = mealAt('meat', 'Breakfast', 0, []);
  const inIt = mealAllergens(meal, EVERY);
  const said = mealRowSpoken({ slot: meal.slot, name: meal.n, allergens: inIt, kcal: String(meal.k) });
  ok(said.startsWith(`${meal.slot}. ${meal.n}`), 'a real meal leads with its slot and its name');

  // ── this loop used to be unable to fail ────────────────────────────────
  //
  // It was `ok(said.includes(a) || said.toLowerCase().includes('contains'))`.
  // The second disjunct is CONSTANT across the loop — `mealRowSpoken` writes
  // the word "Contains" whenever there is any allergen at all — so once the
  // sentence said "Contains" every iteration passed whatever it named, and a
  // dish whose dairy mark had been dropped would have gone through. Nothing
  // asserted the loop ran either, so a `mealAllergens` that returned nothing
  // passed by running zero times.
  //
  // The same shape as the four `process.exit(1)` epilogues found mid-file
  // earlier tonight, and worse in one way: those at least reported. This one
  // was counted as coverage of a SAFETY surface.
  ok(inIt.length > 0,
    `the breakfast this asserts over must actually carry an allergen — ${meal.n} carried ${inIt.length}`);
  for (const a of inIt) {
    ok(said.includes(a === 'nuts' ? 'nuts' : a),
      `and every allergen the engine found on ${meal.n} is NAMED in the sentence, not merely implied by the word "Contains"`);
  }
}

// ── the member's list and their coach's notes ────────────────────────────
//
// supabase/parts/3240: `avoid` is the member's own and only they may change
// it; `coach_avoid` is what they told their coach. What is excluded is the
// UNION, so a coach can add a restriction and has no way to subtract one.
{
  const same = (a: unknown, b: unknown, msg: string) => eq(JSON.stringify(a), JSON.stringify(b), msg);
  same(excludedAllergens(['nuts'], ['dairy']), ['dairy', 'nuts'], 'the union of the two lists is what is excluded');
  same(excludedAllergens(['nuts'], []), ['nuts'], 'a coach with no notes cannot take the member’s nut allergy out');
  same(excludedAllergens([], ['shellfish']), ['shellfish'], 'a coach note is excluded even when the member declared nothing');
  same(excludedAllergens(['nuts'], ['nuts']), ['nuts'], 'the same allergen on both lists is one exclusion');
  // Unread is UNKNOWN, never empty. A coach list that failed to load leaves
  // the full list unknown, and every consumer refuses on null.
  eq(excludedAllergens(['nuts'], null), null, 'an unread coach list makes the whole exclusion list unknown');
  eq(excludedAllergens(null, ['nuts']), null, 'and so does an unread member list');
  eq(readAllergenColumn(undefined), null, 'a column the read never returned is unread, not empty');
  same(readAllergenColumn(null), [], 'a column read back as SQL null is read, and holds nothing');
  eq(readAllergenColumn('nuts'), null, 'a column that is not a list is unreadable, so unknown');
  same(readAllergenColumn(['nuts', 'kryptonite', 'dairy']), ['dairy', 'nuts'], 'an unknown word is dropped, the known ones kept');
  eq(excludedAllergens(readAllergenColumn(['nuts']), readAllergenColumn(undefined)), null,
    'a row read WITHOUT coach_avoid does not become "the coach noted nothing"');

  // And through the planner: an allergen only the coach recorded is kept out
  // of the member's catalogue exactly as their own would be.
  const union = excludedAllergens([], ['nuts'])!;
  for (const slot of ['Breakfast', 'Lunch', 'Dinner', 'Snack'] as Slot[]) {
    const size = catalogSize('vegan', slot, union);
    for (let i = 0; i < 60; i++) {
      const m = mealAt('vegan', slot, (i * 97) % size, union);
      ok(!mealAllergens(m, ['nuts']).length,
        `a coach-noted nut allergy keeps nuts out of ${slot} ${m.n}`);
    }
  }
}

// ── dislikes: relaxed when nothing is left; an allergen never is ────────────
{
  const same = (a: unknown, b: unknown, msg: string) => eq(JSON.stringify(a), JSON.stringify(b), msg);
  same(textDislikes('Mushroom risotto', ['mushrooms']), ['mushrooms'], 'a plural dislike finds the singular');
  same(textDislikes('Kalamata olive salad', ['olives']), ['olives'], '"olives" finds "olive"');
  same(textDislikes('Roast tomatoes', ['tomato']), ['tomato'], 'a singular dislike finds the plural');
  same(textDislikes('Beetroot hummus', ['ham']), [], 'a whole word only: "ham" is not in "hummus"');
  same(readDislikes([' Mushrooms ', 'mushrooms', '', 7]), ['mushrooms'], 'dislikes are trimmed, lower-cased and de-duplicated');
  eq(readDislikes(undefined), null, 'an unread dislike list is unknown');

  // Honoured where it can be: a spread of dinners, none with salmon in.
  const size = catalogSize('meat', 'Dinner', []);
  const step = variantStep('meat', 'Dinner', []);
  for (let d = 0; d < 40; d++) {
    const m = mealAt('meat', 'Dinner', dislikeFreeIndex('meat', 'Dinner', d * step, [], ['salmon']), []);
    ok(!mealDislikes(m, ['salmon']).length, `a salmon dislike is honoured: ${m.n}`);
  }
  eq(dislikeFreeIndex('meat', 'Dinner', 5, [], []), 5 % size, 'no dislikes, no change to the index');
  same(dislikeGaps('meat', ['Dinner'], [], ['salmon']), [], 'a dislike that could be honoured is not reported');

  // Keto breakfasts without egg leave two bases: chia pudding and cottage
  // cheese. Disliking both empties that pool. The DISLIKE gives way, and the
  // eggs the allergen took out do not come back.
  const avoid: Allergen[] = ['egg'];
  const both = ['chia', 'cottage'];
  const ksize = catalogSize('keto', 'Breakfast', avoid);
  for (let i = 0; i < ksize; i += 7) {
    const m = mealAt('keto', 'Breakfast', dislikeFreeIndex('keto', 'Breakfast', i, avoid, both), avoid);
    ok(m.n.length > 0, 'a relaxed dislike still serves a meal rather than nothing');
    same(mealAllergens(m, avoid), [], `relaxing a dislike never brings back an excluded allergen: ${m.n}`);
  }
  same(dislikeGaps('keto', ['Breakfast'], avoid, both), both, 'and the relaxed dislikes are named');
  ok(!!dislikeGapNote(both) && !/[\u2014]/.test(dislikeGapNote(both)!), 'said in a sentence, with no em dash');
  eq(dislikeGapNote([]), null, 'nothing to say when every dislike was honoured');

  const rows = [
    { n: 'Mushroom omelette', ing: [['Mushrooms', 50, 'g']] as [string, number, string][] },
    { n: 'Plain omelette', ing: [['Eggs', 2, '']] as [string, number, string][] },
  ];
  same(preferNotDisliked(rows, ['mushroom']).rows.map((r) => r.n), ['Plain omelette'], 'a disliked row is left out while there is another');
  const only = preferNotDisliked([rows[0]], ['mushroom']);
  ok(only.relaxed && only.rows.length === 1, 'and handed back, flagged as relaxed, when it is all there is');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('mealAllergens: ok');
