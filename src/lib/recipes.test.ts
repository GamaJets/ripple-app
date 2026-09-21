// Run with the rest: `npm test`. Alone:
//   npx tsc -p tsconfig.test.json && node .tmp/lib/recipes.test.js
import {
  dietParam, intolerancesParam, typeParam, readRecipeRequest, searchParams, requestKey,
  trimRecipe, trimSearch, upstreamRefusal, rateWindow, MAX_RESULTS, DEFAULT_RESULTS, KCAL_BAND,
  type RecipeWire, type RecipeSearchRequest,
} from './recipeWire';
import {
  toRecipeMeal, toRecipeMeals, portionRecipe, deptForAisle, recipeAllergens, recipeRef, readRecipeRef, isRecipeMeal,
  readRecipeReply, readRecipeDetailReply, recipeLoadStatus, searchBody,
  RECIPE_ATTRIBUTION, RECIPE_DISCLAIMER, type RecipeContext,
} from './recipes';
import { ALLERGENS, buildPlan, groceryFromWeek, mealAt, type PlanInput } from './meals';
import { isWhole } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const same = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── a Spoonacular result, in THEIR shape ────────────────────────────────────
 * Hand-built to the field names in their docs' own example (recipe 716429),
 * not copied from it: the terms forbid storing their data, and a fixture in a
 * repository is storage. The dish, the figures and the publisher are invented. */
const RAW = {
  id: 9001, title: 'Test Kitchen Garlic Pasta', image: 'http://img.example.test/9001-556x370.jpg',
  servings: 2, readyInMinutes: 45, sourceName: 'A Test Kitchen', creditsText: 'A Test Kitchen',
  sourceUrl: 'http://kitchen.example.test/garlic-pasta', spoonacularSourceUrl: 'https://library.example.test/garlic-pasta-9001',
  pricePerServing: 163.15, winePairing: { pairedWines: ['x'] }, healthScore: 19,
  nutrition: { nutrients: [
    { name: 'Calories', amount: 584.46, unit: 'kcal' }, { name: 'Fat', amount: 19.83, unit: 'g' },
    { name: 'Saturated Fat', amount: 4.1, unit: 'g' }, { name: 'Carbohydrates', amount: 83.7, unit: 'g' },
    { name: 'Net Carbohydrates', amount: 77, unit: 'g' }, { name: 'Protein', amount: 19.2, unit: 'g' },
  ] },
  extendedIngredients: [
    { aisle: 'Milk, Eggs, Other Dairy', amount: 1, unit: 'tbsp', name: 'butter', nameClean: 'butter', measures: { metric: { amount: 1, unitShort: 'Tbsp' } } },
    { aisle: 'Produce', amount: 2, unit: 'cups', name: 'cauliflower florets', measures: { metric: { amount: 473.176, unitShort: 'ml' } } },
    { aisle: 'Pasta and Rice;Ethnic Foods', amount: 6, unit: 'ounces', name: 'pasta', measures: { metric: { amount: 170.097, unitShort: 'g' } } },
    { aisle: 'Produce', amount: 1, unit: '', name: 'lemon', measures: { metric: { amount: 1, unitShort: '' } } },
    { aisle: 'Spices and Seasonings', unit: '', name: 'salt' },
    { aisle: null, amount: 3 },
  ],
  analyzedInstructions: [{ name: '', steps: [{ number: 1, step: 'Boil the pasta.' }, { number: 2, step: ' Toss with the rest. ' }, { number: 3, step: '' }] }],
};
const CTX: RecipeContext = { slot: 'Dinner', diet: 'vegetarian', avoid: [] };

/* ── Repple's words as Spoonacular's ─────────────────────────────────────── */

eq(dietParam('meat'), null, 'eating meat is the absence of a restriction and sends none');
eq(dietParam('keto'), 'ketogenic', "keto is their 'ketogenic'");
same(['vegetarian', 'vegan', 'paleo'].map((d) => dietParam(d as 'vegan')), ['vegetarian', 'vegan', 'paleo'], 'the other three are spelled as theirs are');
same(intolerancesParam(['nuts']), ['Tree Nut', 'Peanut'], 'Nuts is BOTH of theirs — a peanut is a legume to a botanist and a nut to somebody with an EpiPen');
same(intolerancesParam(ALLERGENS.map((a) => a.id)), ['Dairy', 'Gluten', 'Tree Nut', 'Peanut', 'Shellfish', 'Egg', 'Soy'],
  'every exclusion Repple offers has a translation — a new pill with none would come back []');
eq(intolerancesParam(ALLERGENS.map((a) => a.id)).length, ALLERGENS.length + 1, 'and none of them is silently dropped');
eq(typeParam('Lunch'), 'main course', 'they have no lunch');
eq(typeParam('Dinner'), 'main course', 'or dinner');
eq(typeParam('Snack'), 'snack', 'but they do have snacks');

/* ── the request is read, not trusted ────────────────────────────────────── */

const good = readRecipeRequest({ action: 'search', slot: 'Lunch', diet: 'vegan', avoid: ['soy', 'dairy'], query: '  chickpea   curry ', targetKcal: 600, number: 99 });
ok(good.ok, 'a well-formed search is accepted');
if (good.ok && good.req.action === 'search') {
  eq(good.req.query, 'chickpea curry', 'the words are trimmed and collapsed');
  eq(good.req.number, MAX_RESULTS, 'ninety-nine dishes is clamped — each one costs points');
  same(good.req.avoid, ['dairy', 'soy'], 'exclusions come out in one order, so one search has one cache key');
  const p = searchParams(good.req);
  eq(p.diet, 'vegan', 'diet reaches the query');
  eq(p.intolerances, 'Dairy,Soy', 'and so do the exclusions');
  eq(p.minCalories, String(Math.round(600 * KCAL_BAND.low)), 'a target sets the low edge of the band');
  eq(p.maxCalories, String(Math.round(600 * KCAL_BAND.high)), 'and the high one');
  ok(!('apiKey' in p), 'the key is NEVER a query parameter — it goes in a header, out of every log');
  ok(p.fillIngredients === 'true' && p.addRecipeNutrition === 'true' && p.addRecipeInstructions === 'true',
    'everything comes back in the one search: 0.11 points a dish here against 1.1 for a detail call each');
}
const bare = readRecipeRequest({ action: 'search', slot: 'Breakfast', diet: 'meat' });
ok(bare.ok, 'avoid, query, targetKcal and number are all optional');
if (bare.ok && bare.req.action === 'search') {
  eq(bare.req.number, DEFAULT_RESULTS, 'no number is the default, not zero and not a hundred');
  const p = searchParams(bare.req);
  ok(!('minCalories' in p) && !('maxCalories' in p), 'no target, no nutrient filter — that filter costs a whole extra point');
  ok(!('diet' in p) && !('intolerances' in p) && !('query' in p), 'and nothing is sent that was not asked for');
}
ok(!readRecipeRequest({ action: 'search', slot: 'Lunch', diet: 'vegann' }).ok, "a misspelled diet is REFUSED — read as 'no restriction' it is a vegan shown chicken");

// Cuisine: a closed list, passed to Spoonacular joined, refused when unknown.
const indian = readRecipeRequest({ action: 'search', slot: 'Dinner', diet: 'meat', cuisines: ['Thai', 'Indian'] });
ok(indian.ok && indian.req.action === 'search' && searchParams(indian.req).cuisine === 'Indian,Thai', 'chosen cuisines reach the search, in the list\'s order');
ok(!readRecipeRequest({ action: 'search', slot: 'Dinner', diet: 'meat', cuisines: ['Martian'] }).ok, 'a cuisine outside the list is refused, not passed through');
ok(bare.ok && bare.req.action === 'search' && searchParams(bare.req).cuisine === undefined, 'no cuisine chosen is any cuisine');
ok(!readRecipeRequest({ action: 'search', slot: 'Lunch', diet: 'vegan', avoid: ['sesame'] }).ok, 'an exclusion that cannot be translated is refused, never dropped');
ok(!readRecipeRequest({ action: 'search', slot: 'Brunch', diet: 'vegan' }).ok, 'so is a slot Repple does not plan');
ok(!readRecipeRequest({ action: 'search', slot: 'Lunch', diet: 'vegan', avoid: 'dairy' }).ok, 'and an avoid that is not a list');
ok(!readRecipeRequest({ action: 'detail', id: '12; drop' }).ok, 'a detail id is a positive integer or nothing — it becomes part of a URL');
ok(!readRecipeRequest({ action: 'random' }).ok && !readRecipeRequest(null).ok, 'unknown actions and non-objects are refused');
const long = readRecipeRequest({ action: 'search', slot: 'Lunch', diet: 'meat', query: 'x'.repeat(500) });
ok(long.ok && long.req.action === 'search' && long.req.query.length === 80, 'the search box cannot post an essay to a third party');
const REQ: RecipeSearchRequest = { action: 'search', slot: 'Lunch', diet: 'vegan', avoid: ['soy', 'dairy'], query: 'Curry', targetKcal: null, number: 8 };
eq(requestKey(REQ), requestKey({ ...REQ, avoid: ['dairy', 'soy'], query: 'curry' }), 'the same search in a different order is the same search');
ok(requestKey(REQ) !== requestKey({ ...REQ, avoid: ['dairy'] }), 'and one fewer exclusion is NOT — a cache that ignored it would serve soy to somebody avoiding it');

/* ── trimming ────────────────────────────────────────────────────────────── */

const wire = trimRecipe(RAW)!;
ok(wire != null, 'a recipe trims');
same(Object.keys(wire).sort(), ['carbs', 'creditsText', 'fat', 'id', 'image', 'ingredients', 'kcal', 'protein', 'readyInMinutes', 'servings', 'sourceUrl', 'steps', 'title'],
  'the payload is the trimmed one and nothing else — no price, no wine, no scores');
eq(wire.kcal, 584.46, 'calories are the nutrient NAMED Calories');
eq(wire.fat, 19.83, "fat is 'Fat', not 'Saturated Fat'");
eq(wire.carbs, 83.7, "carbs are 'Carbohydrates', not 'Net Carbohydrates'");
eq(wire.image, 'https://img.example.test/9001-556x370.jpg', 'an http image is upgraded — the app will not load it otherwise');
eq(wire.sourceUrl, 'http://kitchen.example.test/garlic-pasta', 'the credit link is the ORIGINAL publisher, as the terms require');
eq(wire.creditsText, 'A Test Kitchen', 'with their name');
same(wire.steps, ['Boil the pasta.', 'Toss with the rest.'], 'steps are trimmed and the empty one is not a step');
eq(wire.ingredients.length, 5, 'an ingredient with no name is not an ingredient');
eq(wire.ingredients[4].amount, null, '"salt" with no amount is NULL, not 0');
eq(trimRecipe({ ...RAW, sourceUrl: '', spoonacularSourceUrl: RAW.spoonacularSourceUrl })!.sourceUrl, RAW.spoonacularSourceUrl, 'no original link falls back to their page for the dish, not to nothing');
eq(trimRecipe({ ...RAW, nutrition: undefined })!.kcal, null, 'no nutrition block is null figures, never zeros');
eq(trimRecipe({ ...RAW, id: undefined }), null, 'no id is not a recipe');
eq(trimRecipe({ ...RAW, title: '  ' }), null, 'nor is no title');
same(trimRecipe({ ...RAW, analyzedInstructions: [], instructions: '<ol><li>Boil.</li><li>Serve.</li></ol>' })!.steps, ['Boil.', 'Serve.'], 'an HTML method is split on its markup');
const fromNutrition = trimRecipe({ ...RAW, extendedIngredients: undefined, nutrition: { ...RAW.nutrition, ingredients: [{ name: 'pasta', amount: 85, unit: 'g' }] } })!;
same(fromNutrition.ingredients.map((i) => [i.name, i.amount, i.aisle]), [['pasta', 85, null]], 'with no extendedIngredients the nutrition block still names them — aisle null, not invented');

const searched = trimSearch({ results: [RAW, { nope: true }, RAW], totalResults: 312 });
ok(searched.ok && searched.value.recipes.length === 2 && searched.value.unreadable === 1 && searched.value.total === 312,
  'a result that is not a recipe is COUNTED, not silently dropped');
const none = trimSearch({ results: [], totalResults: 0 });
ok(none.ok && none.value.recipes.length === 0, 'an empty results list is a search that worked and matched nothing');
ok(!trimSearch({ status: 'failure', message: 'x' }).ok && !trimSearch(null).ok, 'a body with NO results list is a shape failure — never an empty search');

/* ── mapping to a Meals row ──────────────────────────────────────────────── */

const meal = toRecipeMeal(wire, CTX)!;
ok(meal != null, 'a whole recipe becomes a row');
same([meal.n, meal.slot, meal.diet, meal.idx, meal.source, meal.sourceId], ['Test Kitchen Garlic Pasta', 'Dinner', 'vegetarian', -1, 'spoonacular', 9001],
  'the row carries its slot and diet from the ASK, and an idx no catalogue dish can have');
same([meal.k, meal.p, meal.c, meal.f], [584, 19, 84, 20], 'macros are per serving, rounded as the generated ones are whole');
ok(meal.ico.length > 0, 'there is something to draw when the photograph does not load');
ok(isRecipeMeal(meal) && !isRecipeMeal(mealAt('vegetarian', 'Dinner', 0)), 'a recipe is tellable from a generated dish');
same(meal.ing, [
  ['Butter', 0.5, 'Tbsp', 'Dairy & Eggs'],
  ['Cauliflower florets', 237, 'ml', 'Vegetables'],
  ['Pasta', 85, 'g', 'Grains & Bread'],
  ['Lemon', 0.5, '', 'Fruits'],
], 'ingredients are PER SERVING (the recipe serves 2), metric, and in Repple departments');
same(meal.unmeasured, ['Salt'], 'an ingredient with no amount is named, not listed as 0 of something');
same(meal.credit, { name: 'A Test Kitchen', url: 'http://kitchen.example.test/garlic-pasta' }, 'credit is a name AND a link');
eq(toRecipeMeal({ ...wire, creditsText: null, sourceUrl: null }, CTX)!.credit, null, 'nobody to credit is null, not an invented publisher');
same(toRecipeMeal(wire, { ...CTX, measures: 'original' })!.ing[2], ['Pasta', 3, 'ounces', 'Grains & Bread'], 'the as-written measures are there for a member who cooks in them');

// null is not zero
eq(toRecipeMeal({ ...wire, kcal: null }, CTX), null, 'no calories is not a 0 kcal dish — it is not a row');
eq(toRecipeMeal({ ...wire, protein: null }, CTX), null, 'nor is a dish missing any one macro');
eq(toRecipeMeal({ ...wire, servings: null }, CTX), null, 'with no serving count the ingredients cannot be divided, so the grocery list would buy for four');
ok(toRecipeMeal({ ...wire, fat: 0 }, CTX) != null, 'a REAL zero is kept — fat-free is a fact');
same(toRecipeMeals([wire, { ...wire, id: 2, kcal: null }, { ...wire, id: 3 }], CTX).dropped, 1, 'the dropped are counted');

// departments
eq(deptForAisle('Produce', 'baby spinach'), 'Vegetables', 'produce is a vegetable unless it is named as a fruit');
eq(deptForAisle('Produce', 'avocado'), 'Fruits', 'avocado is filed where src/lib/meals.ts files it, so one list has one heading for it');
eq(deptForAisle('Nut butters, Jams, and Honey', 'peanut butter'), 'Nuts & Seeds', 'a third of that aisle is nuts');
eq(deptForAisle('Nut butters, Jams, and Honey', 'honey'), 'Pantry & Other', 'and the rest is not');
eq(deptForAisle('Oil, Vinegar, Salad Dressing', 'olive oil'), 'Fats & Oils', 'oil is a fat');
eq(deptForAisle('Oil, Vinegar, Salad Dressing', 'balsamic vinegar'), 'Pantry & Other', 'vinegar is not');
eq(deptForAisle('Ethnic Foods;Seafood', 'prawns'), 'Meat & Seafood', 'of several aisles, the first that means something wins');
eq(deptForAisle(null, 'mystery'), 'Pantry & Other', 'no aisle is Other, which is what Other is for');
eq(deptForAisle('Gourmet', 'truffle'), 'Pantry & Other', 'and so is an aisle Repple has no heading for');

/* ── allergens: the remote filter is never trusted alone ─────────────────── */

const avoiding: RecipeContext = { ...CTX, avoid: ['dairy', 'gluten', 'shellfish'] };
same(toRecipeMeal(wire, avoiding)!.flagged, ['dairy', 'gluten'], 'a dish that slipped through their filter is MARKED with what it contains, and only that');
same(toRecipeMeal(wire, CTX)!.flagged, [], 'nothing avoided, nothing flagged');
const greased = { ...wire, title: 'Roast Squash', ingredients: [
  { name: 'butternut squash', amount: 400, unit: 'g', metricAmount: 400, metricUnit: 'g', aisle: 'Produce' },
  { name: 'butter', amount: null, unit: '', metricAmount: null, metricUnit: '', aisle: 'Milk, Eggs, Other Dairy' },
] };
same(toRecipeMeal(greased, { ...CTX, avoid: ['dairy'] })!.flagged, ['dairy'], '"butter, for greasing" has no amount and is exactly as much dairy');
same(toRecipeMeal({ ...greased, ingredients: [greased.ingredients[0]] }, { ...CTX, avoid: ['dairy'] })!.flagged, [],
  'and it is the SAME matcher the generated dishes use — butternut is not butter here either');
same(toRecipeMeal({ ...wire, title: 'Prawn Linguine' }, { ...CTX, avoid: ['shellfish'] })!.flagged, ['shellfish'], 'the title is read too');
// A dish read before the member ticked Dairy is still on screen, or in their
// plan, after they tick it. `flagged` is the answer as of the read; the screens
// ask again with today's exclusions rather than draw yesterday's.
const readClean = toRecipeMeal(greased, CTX)!;
same(readClean.flagged, [], 'read with nothing excluded, nothing was flagged');
same(recipeAllergens(readClean, ['dairy']), ['dairy'], 'asked again under a new exclusion, the unmeasured butter is found without another read');
same(recipeAllergens(toRecipeMeal(greased, { ...CTX, avoid: ['dairy'] })!, []), [], 'and an exclusion lifted is a mark lifted');

/* ── portioning: exactly buildPlan's arithmetic ──────────────────────────── */

const CLIENT: PlanInput = { id: 'c1', weightKg: 68, bodyFatPct: 20, activity: 1.4, goal: 'fatloss', diet: 'vegetarian', mealsPerDay: 4 };
const built = buildPlan(CLIENT);
ok(built.plan.length === 4 && built.plan.some((r) => r.servings !== 1), 'the plan this is compared against is a real one, and actually scaled');
for (const row of built.plan) {
  // A recipe with the generated dish's per-serving figures, portioned to the
  // slot share that dish occupies, must land exactly where it did.
  const stand = portionRecipe({ ...meal, k: row.k, p: row.p, c: row.c, f: row.f }, row.k * row.servings, row.pos);
  same([stand.servings, stand.K, stand.P, stand.C, stand.F, stand.pos], [row.servings, row.K, row.P, row.C, row.F, row.pos],
    `a recipe swapped into the ${row.slot} slot is portioned exactly as buildPlan portioned the dish it replaces`);
}
const third = portionRecipe(meal, 400, 2);
same([third.servings, third.K, third.P], [0.75, 438, 14], '584 kcal into a 400 kcal slot is three quarters, in quarters');
eq(portionRecipe(meal, 100, 0).servings, 0.5, 'never under half a serving, as buildPlan never is');
eq(portionRecipe(meal, 5000, 0).servings, 8.5, 'and upward without a cap, as buildPlan is');
same([portionRecipe(meal, null, 0).servings, portionRecipe(meal, 0, 0).servings], [1, 1], 'no target is one serving as written, not a division by nothing');
const bought = groceryFromWeek([[portionRecipe(meal, meal.k * 2, 0)]]);
same(bought.byDept['Grains & Bread'], [{ item: 'Pasta', qty: 170, unit: 'g', buy: null }], 'a portioned recipe is a PlannedMeal to the grocery list: two servings, 170 g');
// The per-serving trap, shopped: `ing` is per serving and so is `k`, from the
// same divisor, which is the only reason multiplying one by `servings` and
// adding the other to a day total describe the same plate.
ok(!JSON.stringify(bought.byDept).includes('Salt'), '"salt, to taste" is not bought as 0 g of salt');
same(bought.unmeasured, ['Salt'], 'it is named on its own heading instead, where there is no quantity to be wrong about');
same(groceryFromWeek([[portionRecipe(meal, null, 0)]]).unmeasured, ['Salt'], 'however the recipe is portioned — an amount nobody gave does not scale');
const generatedOnly = groceryFromWeek([buildPlan({ id: 'c1', weightKg: 70, bodyFatPct: 20, activity: 1.4, goal: 'tone', diet: 'meat', mealsPerDay: 3 }).plan]);
same(generatedOnly.unmeasured, [], 'and a week of generated dishes has none: every one of their ingredients is measured');

/* ── what may be stored ──────────────────────────────────────────────────── */

const ref = recipeRef(meal);
same(Object.keys(ref).sort(), ['image', 'source', 'sourceId', 'title'], 'id, title, image URL — the three the terms exempt, and NOT the macros or ingredients');
same(readRecipeRef(JSON.parse(JSON.stringify(ref))), ref, 'a ref round-trips through storage');
eq(readRecipeRef({ ...ref, sourceId: '9001' }), null, 'a stored ref is read, not trusted');
eq(readRecipeRef({ ...ref, source: 'elsewhere' }), null, 'and one from another library is not one of these');
eq(readRecipeRef(null), null, 'nor is nothing');

/* ── the three failure states, and the two that are not failures ─────────── */

const okReply = (body: unknown) => ({ answered: true, ok: true, body });
const refusal = (error: string, more: Record<string, unknown> = {}) => ({ answered: true, ok: false, body: { error, ...more } });

const whole = readRecipeReply(okReply({ recipes: [wire, { ...wire, id: 2 }], total: 40, unreadable: 0 }), CTX);
ok(whole.status === 'ready' && whole.meals.length === 2 && whole.total === 40, 'every dish a row: ready');
const empty = readRecipeReply(okReply({ recipes: [], total: 0, unreadable: 0 }), CTX);
ok(empty.status === 'ready' && empty.meals.length === 0, 'nothing matched is READY with no rows — the one honest empty list');
const part = readRecipeReply(okReply({ recipes: [wire, { ...wire, id: 2, kcal: null }], total: 40, unreadable: 1 }), CTX);
ok(part.status === 'partial' && part.meals.length === 1 && part.dropped === 2, 'rows lost here and results lost on the server are both counted: partial');
ok(isWhole(recipeLoadStatus(whole)) && !isWhole(recipeLoadStatus(part)), 'and a partial search is not whole to the gate every other figure goes through');

// 1 · not configured
const off = readRecipeReply(refusal('recipes_not_configured'), CTX);
eq(off.status, 'not-configured', 'FAILURE ONE: the owner has not set the key');
ok(!('meals' in off), 'and it carries no list at all, so it cannot be drawn as nothing found');
eq(readRecipeReply(refusal('recipes_key_refused'), CTX).status, 'not-configured', 'a key Spoonacular refuses reads the same to a member — it is the owner who is told apart');
// 2 · limited
const slow = readRecipeReply(refusal('recipes_rate_limited', { retryAfterS: 42 }), CTX);
ok(slow.status === 'limited' && slow.why === 'you' && slow.retryAfterS === 42, 'FAILURE TWO: limited — this person, with the wait');
const spent = readRecipeReply(refusal('recipes_quota_spent'), CTX);
ok(spent.status === 'limited' && spent.why === 'quota' && spent.retryAfterS === null, 'the day is spent, and no wait is invented');
const busy = readRecipeReply(refusal('recipes_busy'), CTX);
ok(busy.status === 'limited' && busy.why === 'busy', "or it is Spoonacular's per-second limit");
ok(!('meals' in slow) && !('meals' in spent), 'neither carries a list');
// 3 · failed
const dead = readRecipeReply({ answered: false, ok: false, body: null }, CTX);
ok(dead.status === 'error' && dead.why === 'unreachable', 'FAILURE THREE: nothing answered');
ok(!('meals' in dead), 'and a failed read is never an empty list');
const shape = readRecipeReply(okReply({ results: [] }), CTX);
ok(shape.status === 'error' && shape.why === 'unreadable', 'a 200 with no recipes list is unreadable, NOT an empty ready');
ok(readRecipeReply(okReply(null), CTX).status === 'error', 'as is a 200 with no body');
const out = readRecipeReply(refusal('signed_out'), CTX);
ok(out.status === 'error' && out.why === 'signed-out', 'signed out is said as itself — it is the one a member can fix');
eq(readRecipeReply(refusal('something_new_from_a_newer_function'), CTX).status, 'error', 'a code this build has never heard of is an error, never a success');
const all = [off, slow, spent, busy, dead, shape, out];
ok(all.every((r) => !isWhole(recipeLoadStatus(r)) && recipeLoadStatus(r) === 'error'), 'none of them is whole');
eq(new Set(all.map((r) => ('message' in r ? r.message : ''))).size, all.length, 'and each has its OWN sentence — not one sentence for all of them');
eq(recipeLoadStatus(null), 'loading', 'no answer yet is loading');

// detail
const one = readRecipeDetailReply(okReply({ recipe: wire }), avoiding);
ok(one.status === 'ready' && one.meal.sourceId === 9001 && one.meal.flagged.length === 2, 'a detail reply is the same row, re-checked for the same exclusions');
eq(readRecipeDetailReply(okReply({ recipe: { ...wire, kcal: null } }), CTX).status, 'error', 'a single dish with no figures is unreadable — there is no partial of one');
eq(readRecipeDetailReply(refusal('recipes_not_found'), CTX).status, 'gone', 'a recipe they no longer have is gone, which is not a failure to reach them');
eq(readRecipeDetailReply(refusal('recipes_not_configured'), CTX).status, 'not-configured', 'and the three failures are the same three');

/* ── Spoonacular's statuses as Repple's ──────────────────────────────────── */

same(upstreamRefusal(402), { status: 503, code: 'recipes_quota_spent' }, "402 is the free plan's quota used up");
same(upstreamRefusal(401), { status: 503, code: 'recipes_key_refused' }, '401 is the key, which is NOT the same as no key');
same(upstreamRefusal(429), { status: 429, code: 'recipes_busy' }, '429 is their per-second limit');
same(upstreamRefusal(500), { status: 502, code: 'recipes_upstream' }, 'anything else is theirs');

/* ── one person's share ──────────────────────────────────────────────────── */

const T = 1_800_000_000_000;
let hits: number[] = [];
for (let i = 0; i < 3; i++) { const w = rateWindow(hits, T + i * 1000, { perMinute: 3, perDay: 5 }); ok(w.allowed, `search ${i + 1} of 3 in a minute is allowed`); hits = w.hits; }
const fourth = rateWindow(hits, T + 3000, { perMinute: 3, perDay: 5 });
ok(!fourth.allowed && fourth.retryAfterS === 57, 'the fourth is refused, with the wait until the first falls out of the minute');
eq(fourth.hits.length, 3, 'and a refused request is NOT counted — being told to wait does not extend the wait');
ok(rateWindow(fourth.hits, T + 61_000, { perMinute: 3, perDay: 5 }).allowed, 'a minute later it is allowed again');
const day = [T, T + 100_000, T + 200_000, T + 300_000, T + 400_000];
const sixth = rateWindow(day, T + 500_000, { perMinute: 3, perDay: 5 });
ok(!sixth.allowed && sixth.retryAfterS === 86_400 - 500, "the day's allowance holds until the first of them is a day old");
ok(rateWindow(day, T + 86_400_001, { perMinute: 3, perDay: 5 }).allowed, 'and then it opens');

/* ── the request body, and the disclosures ───────────────────────────────── */

same(searchBody({ slot: 'Lunch', diet: 'vegan', avoid: ['soy'], query: ' dal ' }), { action: 'search', slot: 'Lunch', diet: 'vegan', avoid: ['soy'], query: 'dal' },
  'the body is the search and NOTHING about the person — no id, no name, no email');
ok(readRecipeRequest(searchBody({ slot: 'Snack', diet: 'keto', avoid: ['nuts', 'egg'], targetKcal: 250.4, number: 6 })).ok, 'and what this side sends is what that side accepts');
ok(/^https:\/\/spoonacular\.com\/food-api$/.test(RECIPE_ATTRIBUTION.url) && /spoonacular/i.test(RECIPE_ATTRIBUTION.text), "the backlink is to their food API page, which is the page the free plan's terms name");
ok(/allerg/i.test(RECIPE_DISCLAIMER) && /nutrition/i.test(RECIPE_DISCLAIMER), 'the disclaimer names both things their terms make Repple disclaim');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`recipes.test.ts — ok`);
