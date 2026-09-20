// What a coach may pin into a client's week, what reaches the column, and the
// one search this screen must not make. Compile with tsc, run with node.
import {
  readCoachRecipeRefs, coachRecipeRefsJson, coachRecipeRefAt, hasCoachRecipes,
  withCoachRecipeAt, withoutCoachRecipeAt, copyCoachRecipeDay, coachRecipeSearch,
  type CoachRecipeRefs,
} from './coachRecipeRefs';
import { portionRecipe, toRecipeMeal, type RecipeMeal, type RecipeRef } from './recipes';
import type { RecipeWire } from './recipeWire';
import type { LoadStatus } from '../ui/loadStatus';

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
  ],
  steps: ['Boil the pasta.'],
  sourceUrl: 'https://example.com/pasta', creditsText: 'A Test Kitchen',
};
const meal = toRecipeMeal(wire, { slot: 'Dinner', diet: 'vegetarian', avoid: [] }) as RecipeMeal;
ok(!!meal, 'the fixture is a row');
const REF: RecipeRef = { source: 'spoonacular', sourceId: 716429, title: 'Pasta with garlic', image: wire.image };

/* ── the four keys, and nothing else ─────────────────────────────────────── */

const pinned = withCoachRecipeAt({}, 2, 1, meal);
same(coachRecipeRefAt(pinned, 2, 1), REF, 'the dish goes in and the reference comes out');
eq(coachRecipeRefAt(pinned, 2, 0), null, 'a slot nobody pinned is the plan’s own meal');
eq(coachRecipeRefAt(pinned, 3, 1), null, 'and so is every other day');
same(Object.keys(coachRecipeRefsJson(pinned)[2][1]).sort(), ['image', 'source', 'sourceId', 'title'],
  'FOUR KEYS reach the column — the CHECK refuses a fifth, which is the licence working');
same(coachRecipeRefsJson(pinned), { 2: { 1: REF } }, 'keyed day then position, as the column is');

// The hazard the whole file exists for: a PlannedRecipe is structurally a ref
// and then some, so a spread would write macros, ingredients and method into a
// column the terms forbid caching in.
const dish = portionRecipe(meal, 700, 1);
ok('ing' in dish && 'K' in dish && 'steps' in dish, 'the portioned dish really does carry the body');
const spread: CoachRecipeRefs = { 0: { 1: dish as unknown as RecipeRef } };
same(coachRecipeRefsJson(spread), {}, 'a whole dish spread into the map is not a reference at all and reaches the column as nothing');
same(coachRecipeRefsJson(withCoachRecipeAt({}, 0, 1, dish)), { 0: { 1: REF } },
  'withCoachRecipeAt is the way in, and it takes the four keys off the dish and leaves the body behind');
same(readCoachRecipeRefs({ 0: { 1: { ...REF, kcal: 584, ingredients: ['pasta'] } } }), { 0: { 1: REF } },
  'and a column written by some older build is rebuilt, not passed along');

/* ── read back ───────────────────────────────────────────────────────────── */

same(readCoachRecipeRefs({}), {}, 'the column’s default is no pinned recipes');
same(readCoachRecipeRefs(null), {}, 'so is null');
same(readCoachRecipeRefs('{}'), {}, 'so is a string that never got parsed');
same(readCoachRecipeRefs([{ 1: REF }]), {}, 'an array is not the shape and reads as nothing');
same(readCoachRecipeRefs({ 2: { 1: REF, 2: { source: 'elsewhere', sourceId: 4 } } }), { 2: { 1: REF } },
  'a ref from some other library is dropped and the good one beside it survives');
same(readCoachRecipeRefs({ '-1': { 1: REF }, x: { 1: REF }, 2: { '-1': REF } }), {},
  'no negative day, no negative position, no day that is not a number');
ok(!hasCoachRecipes(readCoachRecipeRefs({ 2: {} })), 'a day whose refs were all unreadable is not a day with recipes');
ok(hasCoachRecipes(pinned) && !hasCoachRecipes({}), 'and hasCoachRecipes says which week has one');

/* ── taking one off, and copying a day ───────────────────────────────────── */

same(withoutCoachRecipeAt(pinned, 2, 1), {}, 'unpinning the only recipe leaves no empty day behind');
ok(withoutCoachRecipeAt(pinned, 2, 0) === pinned, 'unpinning a slot that held nothing is the same object, so no re-render');
ok(withoutCoachRecipeAt(pinned, 5, 1) === pinned, 'nor does a day that holds nothing');
const two = withCoachRecipeAt(pinned, 2, 0, meal);
same(withoutCoachRecipeAt(two, 2, 0), pinned, 'and the other slot of that day stays put');

// Fill the Week copies meals with `copyPlanDay`; without this the recipe the
// coach pinned on Monday would be left behind and Tuesday would quietly show
// the generated dish they had already replaced.
same(copyCoachRecipeDay(pinned, 2, 3), { 2: { 1: REF }, 3: { 1: REF } }, 'copying a day carries its recipes');
same(copyCoachRecipeDay(pinned, 5, 2), {}, 'copying a day with no recipes CLEARS the target’s, as the meals are replaced too');
ok(copyCoachRecipeDay(pinned, 2, 2) === pinned, 'copying a day onto itself changes nothing');

/* ── the search: the client's restrictions, or no search ─────────────────── */

const asked = {
  open: true, profileStatus: 'ready' as LoadStatus, slot: 'Dinner' as const, diet: 'vegetarian' as const,
  avoid: ['nuts' as const], query: 'pasta', targetKcal: 712, number: 8,
};
const params = coachRecipeSearch(asked);
ok(!!params, 'a coach who taps Recipes on a client whose profile was read gets a search');
eq(params?.diet, 'vegetarian', 'against the CLIENT’s diet');
same(params?.avoid, ['nuts'], 'and the CLIENT’s exclusions');
eq(params?.targetKcal, 700, 'portioned to the row being replaced, rounded to 50 so a near-equal swap is not a second charge');
eq(coachRecipeSearch({ ...asked, targetKcal: 737 })?.targetKcal, 750, 'rounding goes both ways');
eq(coachRecipeSearch({ ...asked, targetKcal: null })?.targetKcal, null, 'and a row with no figure asks for the dish as written');

// THE ONE THAT MATTERS. An allergen list that could not be read is not a
// client with no allergies: the hook is handed null, so nothing is searched,
// nothing is spent, and no dish is ever listed as chosen for them.
eq(coachRecipeSearch({ ...asked, avoid: null }), null, 'a client whose exclusions did not come back is NOT searched for');
eq(coachRecipeSearch({ ...asked, profileStatus: 'error' }), null, 'a profile read that failed withholds the search');
eq(coachRecipeSearch({ ...asked, profileStatus: 'loading' }), null, 'so does one still in flight');
eq(coachRecipeSearch({ ...asked, profileStatus: 'partial' }), null, 'and so does one that came back short');
eq(coachRecipeSearch({ ...asked, avoid: null, profileStatus: 'error' }), null, 'both at once, still nothing');
same(coachRecipeSearch({ ...asked, avoid: [] })?.avoid, [], 'but a client who was read and avoids nothing IS searched for');

// Points are billed now, so nothing is asked until the coach asks for it.
eq(coachRecipeSearch({ ...asked, open: false }), null, 'mounting the screen or opening the meal sheet spends nothing');
eq(coachRecipeSearch({ ...asked, slot: null }), null, 'no slot, no search');
eq(coachRecipeSearch({ ...asked, diet: null }), null, 'a client with no diet set has no catalogue to search');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('coachRecipeRefs.test.ts — ok');
