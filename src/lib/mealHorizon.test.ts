// A member plans a day, a week or a month — and the day they planned is a DATE
// as well as a weekday. Compile with tsc, run with node.
//
// Three things this file is here to hold down:
//   1. the resolution order at a slot — the date, then the weekday, then the
//      coach's pin — and that none of the three writes over another;
//   2. that a horizon longer than a week really is more days, in the plan and
//      in the shopping list, and not the same week served again;
//   3. what the catalogue does at the far end of a month, which is the one
//      thing a screen must say out loud rather than discover in a kitchen.
import {
  RECIPE_DATES_PREFIX, recipeDatePlanKey, horizonDays, plannedRecipeAt,
  readDatedRecipePlan, writeDatedRecipePlan, withDatedRecipeAt, withoutDatedRecipeAt,
  type DatedRecipePlan, type HorizonDay,
} from './mealHorizon';
import { RECIPE_PLAN_PREFIX, withRecipeAt, type RecipePlan } from './recipePlan';
import { withCoachRecipeAt, type CoachRecipeRefs } from './coachRecipeRefs';
import { catalogRepeatDay, planWeek, groceryFromWeek, catalogSize, variantStep, slotsFor, PLAN_WEEK_DAYS, type Allergen, type Slot } from './meals';
import { planDayIndex } from './mealPlan';
import { toRecipeMeal, type RecipeMeal } from './recipes';
import type { RecipeWire } from './recipeWire';
import type { Diet } from './types';
import { PERSONAL_DEVICE_KEYS, KEPT_ON_SIGN_OUT, ACCOUNT_SCOPED_PREFIXES } from './signOutState';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const same = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const wireOf = (id: number, title: string): RecipeWire => ({
  id, title, image: `https://img.spoonacular.com/recipes/${id}-556x370.jpg`,
  readyInMinutes: 30, servings: 2, kcal: 520, protein: 32, carbs: 48, fat: 18,
  ingredients: [{ name: 'chicken', amount: 8, unit: 'oz', metricAmount: 220, metricUnit: 'g', aisle: 'Meat' }],
  steps: ['Cook it.'], sourceUrl: 'https://example.com/r', creditsText: 'A Test Kitchen',
});
const ctx = { slot: 'Dinner' as Slot, diet: 'meat' as Diet, avoid: [] as Allergen[] };
const tikka = toRecipeMeal(wireOf(716429, 'Chicken tikka'), ctx) as RecipeMeal;
const laksa = toRecipeMeal(wireOf(716430, 'Prawn laksa'), ctx) as RecipeMeal;
const pie = toRecipeMeal(wireOf(716431, 'Fish pie'), ctx) as RecipeMeal;
ok(!!tikka && !!laksa && !!pie, 'the fixtures are rows');

/* ── the account is in the key ──────────────────────────────────────────── */

const key = recipeDatePlanKey('user-a')!;
ok(key !== recipeDatePlanKey('user-b'), 'two members on one handset do not share dated plans');
ok(key.includes('user-a') && key.startsWith(RECIPE_DATES_PREFIX), 'the account is in it');
ok(!key.startsWith(RECIPE_PLAN_PREFIX), 'and the date layer is not stored over the weekday one');
eq(recipeDatePlanKey(null), null, 'nobody signed in writes nothing');
eq(recipeDatePlanKey('  '), null, 'nor does a blank id');
eq(recipeDatePlanKey('unknown'), null, "'unknown' is not an account");
const isDateKey = (k: string) => k.startsWith(RECIPE_DATES_PREFIX);
ok(!PERSONAL_DEVICE_KEYS.some(isDateKey), 'an account-scoped key is not on the device-key list');
ok(!KEPT_ON_SIGN_OUT.some(isDateKey), 'nor on the keep list');
ok(!ACCOUNT_SCOPED_PREFIXES.includes(RECIPE_DATES_PREFIX), 'and it is not an outbox prefix');

/* ── the horizon is the days that are actually ahead ────────────────────── */

const TODAY = '2026-09-20';
const todayW = planDayIndex(TODAY)!;
eq(horizonDays(TODAY, 'today').length, 1, 'today is one day');
eq(horizonDays(TODAY, 'week').length, 7, 'a week is seven');
eq(horizonDays(TODAY, 'month').length, 30, 'a month is thirty');
const month = horizonDays(TODAY, 'month');
eq(month[0]?.key, TODAY, 'and it starts today, not at the top of the week');
eq(month[0]?.weekday, todayW, "so the first row is the day the member is standing in");
eq(month[29]?.key, '2026-10-19', 'the last day is twenty-nine days on, across the end of the month');
eq(new Set(month.map((d) => d.key)).size, 30, 'every day of it is a different date');
same(month.map((d) => d.offset), Array.from({ length: 30 }, (_, i) => i), 'and they are in order, nearest first');
ok(month.every((d) => d.weekday === (todayW + d.offset) % PLAN_WEEK_DAYS), 'each date knows which weekday it is');
same(horizonDays('not a date', 'month'), [{ key: '', weekday: 0, offset: 0 }],
  'a clock that cannot be read is ONE day with no date on it — nothing is served on the wrong day');

/* ── what is stored is a ref, and only on a real date ───────────────────── */

const REF = { source: 'spoonacular', sourceId: 716429, title: 'Chicken tikka', image: tikka.image };
const onThu = withDatedRecipeAt({}, '2026-09-24', 2, tikka);
same(onThu, { '2026-09-24': { 2: REF } }, 'choosing a recipe for a date keeps its id, title and image URL and nothing else');
ok(withDatedRecipeAt({}, 'Thursday', 2, tikka)['Thursday'] === undefined, 'a key that is not a date is not a day');
ok(withDatedRecipeAt(onThu, '2026-09-24', -1, tikka) === onThu, "nor is a snack idea's -1 a position");
same(readDatedRecipePlan(writeDatedRecipePlan(onThu)), onThu, 'a round trip through the store changes nothing');
same(readDatedRecipePlan(JSON.stringify({ '2026-09-24': { 2: { ...REF, kcal: 812, servings: 3 } } })),
  onThu, 'and a stored blob carrying figures comes back as three facts: the licence forbids the rest');
same(readDatedRecipePlan('{'), {}, 'an unreadable store is nothing planned');
same(readDatedRecipePlan(JSON.stringify({ '2026-13-40': { 2: REF } })), {}, 'and a date no calendar has is dropped');
same(withoutDatedRecipeAt(onThu, '2026-09-24', 2), {}, 'clearing the date hands the slot back');
ok(withoutDatedRecipeAt(onThu, '2026-09-25', 2) === onThu, 'clearing a date that holds nothing is the same object');
same(onThu, { '2026-09-24': { 2: REF } }, 'and none of that mutated what it was given');

/* ── the resolution order, and that neither choice destroys the other ──── */

const thu: HorizonDay = month.find((d) => d.key === '2026-09-24')!;
const nextThu: HorizonDay = month.find((d) => d.key === '2026-10-01')!;
eq(thu.weekday, nextThu.weekday, 'the two Thursdays are the same weekday');
const weekdays: RecipePlan = withRecipeAt({}, thu.weekday, 2, laksa);   // "prawn laksa every Thursday"
const dates: DatedRecipePlan = withDatedRecipeAt({}, thu.key, 2, tikka); // "tikka on the 24th"
const coach: CoachRecipeRefs = withCoachRecipeAt({}, thu.weekday, 2, pie);
const src = { dates, weekdays, coach };

eq(plannedRecipeAt(src, thu, 2)?.ref.sourceId, tikka.sourceId, 'the date wins on the day it names');
eq(plannedRecipeAt(src, thu, 2)?.from, 'date', 'and says so, so the member can clear the right one');
eq(plannedRecipeAt(src, nextThu, 2)?.ref.sourceId, laksa.sourceId, 'every OTHER Thursday still holds the standing choice');
eq(plannedRecipeAt(src, nextThu, 2)?.from, 'weekday', 'named as the standing choice it is');
eq(plannedRecipeAt({ dates: {}, weekdays: {}, coach }, thu, 2)?.from, 'coach', "the coach's pin is behind both");
eq(plannedRecipeAt({ dates: {}, weekdays: {}, coach: {} }, thu, 2), null, "and behind that is the plan's own meal");
eq(plannedRecipeAt(src, month[1]!, 2), null, 'a day nobody planned keeps the generated meal — planning ahead does not empty the near days');
eq(plannedRecipeAt(src, thu, -1), null, 'a snack idea has no slot to resolve');
eq(plannedRecipeAt(src, { key: '', weekday: thu.weekday, offset: 0 }, 2)?.from, 'weekday',
  'with no date to match, the weekday choice answers rather than somebody else’s Thursday');
// The point of the whole design, stated once: clearing one leaves the other.
const clearedDate = { ...src, dates: withoutDatedRecipeAt(dates, thu.key, 2) };
eq(plannedRecipeAt(clearedDate, thu, 2)?.ref.sourceId, laksa.sourceId, 'taking the recipe off the 24th falls back to every Thursday');
eq(plannedRecipeAt(clearedDate, nextThu, 2)?.ref.sourceId, laksa.sourceId, 'which is still every Thursday');

/* ── a month is thirty different days, not a week four times ───────────── */

const input = { id: 'c1', weightKg: 78, bodyFatPct: 18, activity: 1.5, goal: 'fatloss' as const, diet: 'meat' as Diet, mealsPerDay: 3 as const };
const thirty = planWeek(input, undefined, 30);
eq(thirty.length, 30, 'the horizon builds the days it was asked for');
const dinners = thirty.map((day) => day.find((m) => m.slot === 'Dinner')!.n);
eq(new Set(dinners).size, 30, 'and thirty of them are thirty different dinners');
eq(planWeek(input).length, PLAN_WEEK_DAYS, 'the week is still the default for everyone who does not ask');
eq(planWeek(input, undefined, 0).length, PLAN_WEEK_DAYS, 'and a span that is not one falls back to it rather than drawing nothing');
// The shopping list follows the span. A month is not a week's list four times
// over, and it is not a week's list either.
const weekList = groceryFromWeek(planWeek(input, undefined, 7));
const monthList = groceryFromWeek(thirty);
ok(monthList.mealCount > weekList.mealCount, 'a month shops for more meals than a week');
eq(weekList.mealCount, new Set(planWeek(input, undefined, 7).flat().map((m) => m.n)).size, 'and each list counts the meals of its own range');

/* ── and where the catalogue DOES come round again ─────────────────────── */

// The arithmetic, against the real pools. `catalogRepeatDay` is what the screen
// reads; this is the same question asked the slow way.
const firstRepeat = (diet: Diet, slot: Slot, avoid: Allergen[]): number => {
  const size = catalogSize(diet, slot, avoid);
  const step = variantStep(diet, slot, avoid);
  const seen = new Set<number>();
  for (let d = 0; d < 60; d++) {
    const idx = ((d * step) % size + size) % size;
    if (seen.has(idx)) return d;
    seen.add(idx);
  }
  // Capped: a catalogue of ten thousand dinners is not walked to the end to
  // learn that a month of them does not repeat.
  return 60;
};
const diets: Diet[] = ['meat', 'vegetarian', 'vegan', 'paleo', 'keto'];
const slots: Slot[] = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
for (const diet of diets) for (const slot of slots) {
  eq(Math.min(catalogRepeatDay(diet, slot, []), 60), firstRepeat(diet, slot, []), `${diet}/${slot}: the arithmetic agrees with the walk`);
  ok(catalogRepeatDay(diet, slot, []) > 31, `${diet}/${slot}: a member with no exclusions sees no repeat inside a month`);
}
// With exclusions the pools shrink and some of them do wrap inside a month.
// This is the case the screen has to say out loud: keto snacks without dairy or
// nuts are 100 meals with a stride of 25, so the fourth day is the first again.
const ketoSnack: Allergen[] = ['dairy', 'nuts'];
eq(catalogRepeatDay('keto', 'Snack', ketoSnack), 4, 'keto snacks without dairy or nuts come round on day four');
eq(catalogRepeatDay('keto', 'Snack', ketoSnack), firstRepeat('keto', 'Snack', ketoSnack), 'and the walk finds the same day');
eq(catalogRepeatDay('keto', 'Breakfast', ['dairy', 'nuts', 'egg']), 18, 'keto breakfasts without dairy, nuts or egg come round on day eighteen');
// A three-meal day has no Snack slot, so this member is never told about a
// wrap they cannot see. The screen asks only about the slots its plan has.
ok(!slotsFor(3).includes('Snack'), 'a three-meal day has no snack slot');
ok(slotsFor(3).every((slot) => catalogRepeatDay('keto', slot, ketoSnack) > 31),
  'so a three-meal keto day avoiding dairy and nuts still has no repeat inside a month');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('mealHorizon.test.ts — ok');
