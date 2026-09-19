// A planned recipe belongs to the member who planned it, and what is kept of it
// is the three facts Spoonacular's terms allow. Compile with tsc, run with node.
import {
  RECIPE_PLAN_PREFIX, recipePlanKey, isRecipePlanKey,
  readRecipePlan, writeRecipePlan, withRecipeAt, withoutRecipeAt,
} from './recipePlan';
import { MEAL_SWAPS_PREFIX, mealSwapsKey, readMealSwaps } from './mealSwaps';
import { portionRecipe, toRecipeMeal, type RecipeMeal } from './recipes';
import type { RecipeWire } from './recipeWire';
import { PERSONAL_DEVICE_KEYS, KEPT_ON_SIGN_OUT, ACCOUNT_SCOPED_PREFIXES } from './signOutState';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const same = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const wire: RecipeWire = {
  id: 716429, title: 'Pasta with garlic', image: 'https://img.spoonacular.com/recipes/716429-556x370.jpg',
  readyInMinutes: 45, servings: 2, kcal: 584, protein: 19, carbs: 84, fat: 20,
  ingredients: [
    { name: 'pasta', amount: 6, unit: 'oz', metricAmount: 170, metricUnit: 'g', aisle: 'Pasta and Rice' },
    { name: 'butter', amount: null, unit: '', metricAmount: null, metricUnit: '', aisle: 'Milk, Eggs, Other Dairy' },
  ],
  steps: ['Boil the pasta.', 'Toss with the garlic.'],
  sourceUrl: 'https://example.com/pasta', creditsText: 'A Test Kitchen',
};
const meal = toRecipeMeal(wire, { slot: 'Dinner', diet: 'vegetarian', avoid: [] }) as RecipeMeal;
ok(!!meal, 'the fixture is a row');
const REF = { source: 'spoonacular', sourceId: 716429, title: 'Pasta with garlic', image: wire.image };

/* ── the account is in the key ──────────────────────────────────────────── */

const a = recipePlanKey('user-a')!;
ok(a !== recipePlanKey('user-b'), 'two members on one handset do not share planned recipes');
ok(a.includes('user-a') && isRecipePlanKey(a) && a.startsWith(RECIPE_PLAN_PREFIX), 'the account is in it and it is recognisable');
ok(a !== mealSwapsKey('user-a') && !a.startsWith(MEAL_SWAPS_PREFIX), 'and it is not the swaps key: the two maps never share a blob');
eq(recipePlanKey(null), null, 'nobody signed in writes nothing');
eq(recipePlanKey(undefined), null, 'nor does an absent id');
eq(recipePlanKey('  '), null, 'nor a blank one');
eq(recipePlanKey('unknown'), null, "'unknown' is not an account");
ok(!PERSONAL_DEVICE_KEYS.some(isRecipePlanKey), 'an account-scoped key is not on the device-key list');
ok(!KEPT_ON_SIGN_OUT.some(isRecipePlanKey), 'nor on the keep list');
ok(!ACCOUNT_SCOPED_PREFIXES.includes(RECIPE_PLAN_PREFIX), 'and it is not an outbox prefix');

/* ── ONLY the ref is written ────────────────────────────────────────────── */

const planned = withRecipeAt({}, 2, meal);
same(planned, { 2: REF }, 'choosing a recipe keeps its id, title and image URL');
const written = writeRecipePlan(planned);
same(JSON.parse(written), { 2: REF }, 'and that is all that reaches the store');
for (const leak of ['kcal', '"k"', '"K"', 'ing', 'steps', 'servings', 'credit', 'flagged', 'Boil', 'pasta"', 'butter', 'example.com'])
  ok(!written.includes(leak), `nothing else of the recipe is stored — found ${leak}`);

// The mistake this file is written against: a whole portioned dish handed to
// the writer where a ref belongs. A dish is not a ref (it has `n`, not `title`),
// so the writer drops it: a choice that is not kept, never a figure that is.
const whole = portionRecipe(meal, 700, 2);
const leaked = writeRecipePlan({ 2: whole } as never);
same(JSON.parse(leaked), {}, 'a portioned dish passed by mistake is not written at all');
ok(!/"K"|"P"|"ing"|"steps"|"servings"|"unmeasured"/.test(leaked), 'a portioned dish passed by mistake is not written out with its figures');

/* ── what comes back off the store ──────────────────────────────────────── */

same(readRecipePlan(null), {}, 'nothing stored is no planned recipes');
same(readRecipePlan(''), {}, 'and so is an empty string');
same(readRecipePlan('{'), {}, 'a blob that will not parse is none, not a throw');
same(readRecipePlan('[1]'), {}, 'an array is not a plan');
same(readRecipePlan('null'), {}, 'nor null');
same(readRecipePlan(written), { 2: REF }, 'the round trip is the identity');
same(readRecipePlan(JSON.stringify({ 0: { ...REF, kcal: 584, ing: [['Pasta', 85, 'g']] } })), { 0: REF },
  'figures an older or edited blob carries do not come back with the ref');
same(readRecipePlan(JSON.stringify({ 0: REF, 1: 5, 2: { source: 'elsewhere', sourceId: 3, title: 'x' }, '-1': REF, first: REF, 3: { ...REF, sourceId: -1 } })), { 0: REF },
  'a catalogue index, a foreign source, a bad position and a non-id are each dropped; the good one stays');
same(readRecipePlan(JSON.stringify({ 0: { ...REF, image: 'http://plain.example/x.jpg' } })), { 0: { ...REF, image: null } },
  'an image that is not https comes back as no image, and the recipe stays planned');

// The two stores refuse each other's values, so neither can be read as the other.
same(readMealSwaps(written), {}, 'a recipe plan read as swaps is no swaps — a ref is never an index');
same(readRecipePlan('{"0":5,"2":11}'), {}, 'and swaps read as a recipe plan are no recipes');

/* ── choosing and un-choosing ───────────────────────────────────────────── */

same(withRecipeAt(planned, -1, meal), planned, 'a snack idea has no slot: -1 plans nothing');
ok(withRecipeAt(planned, NaN, meal) === planned, 'nor does a position that is not a number');
ok(withRecipeAt(planned, 1.5, meal) === planned, 'nor a fractional one');
same(Object.keys(withRecipeAt(planned, 0, meal)).sort(), ['0', '2'], 'a second slot is added beside the first');
same(withoutRecipeAt(planned, 2), {}, "clearing a slot hands it back to the plan's own meal");
ok(withoutRecipeAt(planned, 1) === planned, 'clearing an empty slot is the same object — no re-render, no re-write');
same(planned, { 2: REF }, 'and neither call mutated what it was given');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('recipePlan.test.ts — ok');
