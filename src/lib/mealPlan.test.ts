// A coach's authored meal plan, and the ways one stops being the plan they
// wrote. Compile with tsc, run with node.
//
// The assertions that matter are the two that were the whole reason for the
// design: that a meal the coach chose is the meal the CLIENT's own buildPlan
// produces for that day (otherwise the screen is theatre), and that an allergen
// disclosed after the plan was written is caught rather than served.
import {
  PLAN_DAYS, PLAN_VERSION, PLAN_WEEKDAYS,
  capturePlanMeal, copyPlanDay, guardPlan, parsePlan, planDayBaseKcal, planDayIndex,
  planDayOverride, planEmptySlotsLine, planProteinNote, planServingNote, planStale, planStaleLine, seedPlan, setPlanMeal,
  type CoachMealPlan,
} from './mealPlan';
import { buildPlan, catalogSize, excludedAllergens, mealAt, mealDish, mealDislikes, planWeek, sameMealName, searchMeals, slotsFor, swapIndex, unfillableName, type Allergen, type PlanInput } from './meals';
import { WEEK_DAYS, jsDayForIndex } from './weekStart';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const client = (over: Partial<PlanInput> = {}): PlanInput => ({
  id: 'c8f2a1d4-0000-4000-8000-000000000001',
  weightKg: 78, bodyFatPct: 22, activity: 1.45,
  goal: 'fatloss', diet: 'meat', mealsPerDay: 4, avoid: [],
  ...over,
});

const WRITTEN = '2026-08-31T09:00:00.000Z';

/* ── the week, and which day is which ──────────────────────────────────── */

eq(PLAN_WEEKDAYS.length, PLAN_DAYS, 'the labels and the days are the same week');
eq(PLAN_WEEKDAYS[0], WEEK_DAYS[0], 'the plan is stored in the order the app draws a week');
eq(PLAN_WEEKDAYS[0], 'Sun', 'which is Sunday first — src/lib/weekStart.ts');

// 2026-09-06 is a Sunday and opens the week. The stored order and getDay() are
// only the same while the week opens on Sunday, and `planDayIndex` is the
// conversion — a plan read in the wrong one hands a client the wrong day's
// dinners, every week.
eq(planDayIndex('2026-09-06'), 0, 'Sunday is day 0');
eq(planDayIndex('2026-09-12'), 6, 'Saturday is day 6, not day 0');
eq(planDayIndex('2026-09-03'), 4, 'Thursday is day 4');
eq(planDayIndex('not-a-date'), null, 'an unreadable date has no day, and must not default to the first one');
// Every day of one real week, in order. This is the assertion that fails if the
// stored order and the drawn order are ever allowed to disagree.
const WEEK = ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'];
WEEK.forEach((iso, d) => eq(planDayIndex(iso), d, `${PLAN_WEEKDAYS[d]} ${iso} is day ${d}`));

/* ── a seeded plan is the week the client can already see ──────────────── */

const c = client();
const seeded = seedPlan(c, WRITTEN);
eq(seeded.v, PLAN_VERSION, 'the seed carries the version');
eq(seeded.days.length, PLAN_DAYS, 'a plan is a week');
eq(seeded.diet, 'meat', 'and records the diet its indices mean something under');
eq(seeded.mealsPerDay, 4, 'and the meals per day its slots were laid out for');
for (const day of seeded.days) {
  eq(day.meals.length, slotsFor(4).length, 'every day has one meal per slot');
  day.meals.forEach((m, i) => eq(m.slot, slotsFor(4)[i], `slot ${i} is in slot order`));
}

// Day 0 is what the client's own buildPlan already produces for them. A seed
// that invented a different Monday would make "send" a change the coach never
// made.
const clientDay0 = buildPlan(c).plan;
seeded.days[0].meals.forEach((m, i) => {
  eq(m.idx, clientDay0[i].idx, `seeded Monday slot ${i} is the meal the client already sees`);
  eq(m.n, clientDay0[i].n, `and carries its name`);
});

/* ── THE BRIDGE: what the coach chose is what the client is served ─────── */
//
// planDayOverride's whole job is to hand a day back in the shape buildPlan
// already takes. If this drifts, the coach screen is decoration and the client
// eats something else.
for (let d = 0; d < PLAN_DAYS; d++) {
  const served = buildPlan({ ...c, mealOverride: planDayOverride(seeded, d) }).plan;
  seeded.days[d].meals.forEach((m, i) => {
    eq(served[i].n, m.n, `day ${d} slot ${i}: the client is served the meal the coach chose`);
    eq(served[i].idx, m.idx, `day ${d} slot ${i}: by the same index`);
  });
}

// The map is keyed by POSITION, which is what buildPlan reads it by.
const ov = planDayOverride(seeded, 2);
eq(Object.keys(ov).length, 4, 'one entry per slot');
eq(ov[0], seeded.days[2].meals[0].idx, 'position 0 is the first slot');
eq(planDayOverride(seeded, 99)[0], undefined, 'a day that is not in the week yields nothing, not day 0');

/* ── editing ───────────────────────────────────────────────────────────── */

const before = seeded.days[1].meals[0].idx;
const edited = setPlanMeal(seeded, 1, 0, before + 1);
ok(edited !== seeded, 'an edit returns a new plan');
eq(seeded.days[1].meals[0].idx, before, 'the original is untouched');
eq(edited.days[1].meals[0].idx, before + 1, 'and the copy carries the new index');
eq(edited.days[0].meals[0].idx, seeded.days[0].meals[0].idx, 'and leaves every other day alone');
eq(edited.days[1].meals[1].idx, seeded.days[1].meals[1].idx, 'and every other slot');
// The snapshot is not decoration: it must agree with what the index resolves to.
eq(edited.days[1].meals[0].n, mealAt('meat', 'Breakfast', edited.days[1].meals[0].idx, []).n,
  'the stored name is the meal the stored index names');
eq(setPlanMeal(seeded, 99, 0, 5), seeded, 'editing a day that is not there changes nothing');
eq(setPlanMeal(seeded, 0, 99, 5), seeded, 'nor a slot that is not there');

// An index past the end of the catalogue wraps rather than resolving to
// nothing — the same modulo buildPlan applies, so the two cannot disagree.
const big = setPlanMeal(seeded, 0, 0, catalogSize('meat', 'Breakfast', []) + 3);
eq(big.days[0].meals[0].idx, 3, 'an out-of-range index is wrapped at the point it is stored');

const copied = copyPlanDay(seeded, 0, 4);
eq(copied.days[4].meals[0].idx, seeded.days[0].meals[0].idx, 'a copied day takes the source meals');
eq(copied.days[0].meals[0].idx, seeded.days[0].meals[0].idx, 'and the source is unchanged');
ok(copied.days[4].meals !== copied.days[0].meals, 'the copy is not a shared reference the next edit would hit twice');
eq(copyPlanDay(seeded, 2, 2), seeded, 'copying a day onto itself is a no-op');

/* ── round-tripping through jsonb ──────────────────────────────────────── */

const round = parsePlan(JSON.parse(JSON.stringify(seeded)));
ok(round !== null, 'a plan survives the trip through the database');
eq(JSON.stringify(round), JSON.stringify(seeded), 'unchanged');

eq(parsePlan(null), null, 'nothing is not a plan');
eq(parsePlan('a plan'), null, 'nor a string');
eq(parsePlan([]), null, 'nor an array');
eq(parsePlan({ ...seeded, v: 99 }), null, 'a version this build does not know is refused, not guessed at');
eq(parsePlan({ ...seeded, diet: 'carnivore' }), null, 'a diet with no catalogue is refused');
eq(parsePlan({ ...seeded, mealsPerDay: 6 }), null, 'a meals-per-day with no slot layout is refused');
eq(parsePlan({ ...seeded, days: seeded.days.slice(0, 5) }), null, 'a part-week is refused');
// The slot order is checked against the meals-per-day, because a plan whose
// position 2 says Breakfast where a Snack belongs would resolve its index
// through the wrong catalogue entirely.
const wrongOrder = JSON.parse(JSON.stringify(seeded)) as CoachMealPlan;
wrongOrder.days[0].meals[1].slot = 'Snack';
eq(parsePlan(wrongOrder), null, 'a slot out of position is refused');
const noName = JSON.parse(JSON.stringify(seeded)) as CoachMealPlan;
noName.days[3].meals[0].n = '';
eq(parsePlan(noName), null, 'a meal with no recorded name is refused — the snapshot is the evidence');
const badIdx = JSON.parse(JSON.stringify(seeded)) as CoachMealPlan;
(badIdx.days[0].meals[0] as { idx: number }).idx = -1;
eq(parsePlan(badIdx), null, 'a negative index is refused');
// Junk in `avoid` is dropped rather than failing the whole plan: an unknown
// allergen id cannot filter anything, and refusing the week over it would take
// a coach's plan away from a client for a typo.
const oddAvoid = parsePlan({ ...JSON.parse(JSON.stringify(seeded)), avoid: ['nuts', 'pineapple'] });
eq(JSON.stringify(oddAvoid?.avoid), JSON.stringify(['nuts']), 'an unrecognised allergen is dropped, the plan is kept');

/* ── a plan written before the week moved ──────────────────────────────── */

// v1 stored `days` Monday-first, unconditionally. The product now opens its
// week on Sunday (src/lib/weekStart.ts), so position 0 means a different day
// than it did — and there are real v1 rows in `coach_nutrition.plan`. See
// supabase/parts/640.
//
// THE DAYS THEMSELVES MUST NOT MOVE. A coach wrote a Thursday; their client
// eats it on a Thursday. Only the position changes.
{
  // A v1 plan whose days are distinguishable: day d's first meal carries idx d,
  // so where each one lands after the rotation can be read off directly.
  const v1 = JSON.parse(JSON.stringify(seeded)) as CoachMealPlan & { v: number };
  v1.v = 1;
  for (let d = 0; d < PLAN_DAYS; d++) v1.days[d].meals[0].idx = d;

  const read = parsePlan(v1);
  ok(read !== null, 'a plan written before the week moved is still a plan — not silently no plan');
  eq(read!.v, PLAN_VERSION, 'and it is handed back at the current version');

  // Position i now holds the day whose Monday-first position was (jsDay + 6) % 7.
  for (let i = 0; i < PLAN_DAYS; i++) {
    eq(read!.days[i].meals[0].idx, (jsDayForIndex(i) + 6) % 7,
       `${PLAN_WEEKDAYS[i]} still carries the meals the coach wrote for it`);
  }
  // Said again in the concrete, because the loop above would also pass if both
  // sides were wrong in the same way.
  eq(read!.days[0].meals[0].idx, 6, 'v1 position 6 was Sunday, and Sunday now opens the week');
  eq(read!.days[1].meals[0].idx, 0, 'v1 position 0 was Monday, which is now the second column');

  // Nothing is lost or duplicated: seven days in, the same seven out.
  eq(new Set(read!.days.map((d) => d.meals[0].idx)).size, PLAN_DAYS,
     'the rotation moves the days, it does not drop or repeat one');

  // A v1 plan is still checked as hard as a v2 one — the version is not a
  // trapdoor past the validation.
  const badV1 = JSON.parse(JSON.stringify(v1)) as CoachMealPlan;
  badV1.days[2].meals[0].n = '';
  eq(parsePlan(badV1), null, 'a v1 plan with a meal missing its snapshot is refused like any other');
  eq(parsePlan({ ...v1, days: v1.days.slice(0, 5) }), null, 'and a v1 part-week is still a part-week');
}

/* ── the allergen check, which is what this is for ─────────────────────── */

const nutFree = client({ avoid: ['nuts'] as Allergen[] });
const writtenForNutFree = seedPlan(nutFree, WRITTEN);

// Nothing has moved.
ok(!planStale(writtenForNutFree, 'meat', ['nuts'], 4).stale,
  'a plan against the profile it was written for is not stale');
eq(planStaleLine(planStale(writtenForNutFree, 'meat', ['nuts'], 4), 'Priya'), null,
  'and has no sentence to say about itself');
// Order-independence needs two allergens listed the other way round. This used
// to repeat the call above verbatim — `['nuts']` against `['nuts'] as
// Allergen[]`, a compile-time cast over a ONE-element list, in which there is
// no order to vary. It could not have caught `sameSet` losing its `.sort()`,
// which is the whole property the word "order-independently" is claiming.
const twoAllergens = client({ avoid: ['nuts', 'shellfish'] as Allergen[] });
const writtenForTwo = seedPlan(twoAllergens, WRITTEN);
ok(!planStale(writtenForTwo, 'meat', ['shellfish', 'nuts'] as Allergen[], 4).stale,
  'the same two allergens listed in the other order are the same two allergens — order-independently');
// The whole verdict, not just its `stale` flag: `addedAvoid` and `droppedAvoid`
// are what the coach's sentence is built from, and an order-sensitive
// comparison would name an allergen as newly disclosed that the plan was
// already written against.
eq(JSON.stringify(planStale(writtenForTwo, 'meat', ['shellfish', 'nuts'] as Allergen[], 4)),
   JSON.stringify(planStale(writtenForTwo, 'meat', ['nuts', 'shellfish'] as Allergen[], 4)),
  'and the two orderings produce the same verdict in every field, not merely the same flag');
ok(planStale(writtenForTwo, 'meat', ['shellfish'] as Allergen[], 4).stale,
  'while genuinely dropping one of them is a change, so the comparison is not simply blind to the list');

// A disclosure AFTER the plan was written. This is the case with a person on
// the other end of it.
const afterDisclosure = planStale(seeded, 'meat', ['nuts'], 4);
ok(afterDisclosure.stale, 'an allergen disclosed since the plan was written makes it stale');
eq(JSON.stringify(afterDisclosure.addedAvoid), JSON.stringify(['nuts']), 'and is named');
eq(afterDisclosure.droppedAvoid.length, 0, 'without inventing one they dropped');
ok(planStaleLine(afterDisclosure, 'Priya')!.includes('Priya'), 'the sentence is about this client');
ok(planStaleLine(afterDisclosure, 'Priya')!.includes('nuts'), 'and names the disclosure');
ok(planStaleLine(afterDisclosure, 'Priya')!.includes('Rebuild'), 'and says what to do');

// The mechanical half: filtering a pool RENUMBERS everything after it, so the
// same index is a different meal. This is why the plan carries the avoid list
// at all, and it is the assertion that fails if that is ever dropped.
const renumbered = afterDisclosure.diverged;
ok(renumbered.length > 0, 'the same indices resolve to different meals once a pool is filtered');
ok(renumbered.every((d) => d.was !== d.now), 'a divergence is a genuine difference, not a row for every meal');

// ── the disclosure alone, with nothing to see ──────────────────────────
//
// The assertions above would pass even if `addedAvoid` were dropped from the
// staleness test entirely, because filtering nuts out of a meat catalogue
// renumbers it and the divergence list catches the plan by accident. A
// mutation run found exactly that.
//
// This is the case with nothing to see. A vegan catalogue contains no
// shellfish, so `poolFilter` removes nothing, every index still names the
// same meal, and `diverged` is empty — and the coach still has to be told
// that this client disclosed a shellfish allergy AFTER the week was written,
// because "the meals did not change" is not the same claim as "somebody
// checked them against this".
const veganPlan = seedPlan(client({ diet: 'vegan', avoid: [] }), WRITTEN);
const quietDisclosure = planStale(veganPlan, 'vegan', ['shellfish'], 4);
eq(quietDisclosure.diverged.length, 0, 'a vegan catalogue is unchanged by a shellfish allergy');
ok(quietDisclosure.stale, 'and the plan is STILL stale, on the disclosure alone');
eq(JSON.stringify(quietDisclosure.addedAvoid), JSON.stringify(['shellfish']), 'which is what says so');
ok(planStaleLine(quietDisclosure, 'Ada')!.includes('shellfish'), 'and the coach is told which one');
ok(!guardPlan('ready', 'ready', quietDisclosure, 'Ada').allowed, 'and the week cannot be sent on it');

// Changing the diet is the same failure by another route.
const dietMoved = planStale(seeded, 'vegan', [], 4);
ok(dietMoved.stale && dietMoved.dietChanged, 'a changed diet makes a plan stale');
ok(planStaleLine(dietMoved, 'Sam')!.includes('diet'), 'and says so');

// So is changing how many meals a day they eat: the slots are not the slots.
const slotsMoved = planStale(seeded, 'meat', [], 3);
ok(slotsMoved.stale && slotsMoved.mealsPerDayChanged, 'a changed meals-per-day makes a plan stale');
eq(slotsMoved.diverged.length, 0,
  'and does not also list every meal as diverged — the slots no longer line up, so there is nothing to compare');

// Dropping an allergen is not a safety problem and is still a renumbering.
const dropped = planStale(writtenForNutFree, 'meat', [], 4);
ok(dropped.stale, 'dropping an allergen still renumbers the catalogue');
eq(JSON.stringify(dropped.droppedAvoid), JSON.stringify(['nuts']), 'and is reported as a drop, not a disclosure');
eq(dropped.addedAvoid.length, 0, 'not as something newly disclosed');

/* ── the send gate ─────────────────────────────────────────────────────── */

const current = planStale(seeded, 'meat', [], 4);
ok(guardPlan('ready', 'ready', current, 'Priya').allowed, 'a current plan against a read profile may be sent');
ok(guardPlan('ready', 'ready', null, 'Priya').allowed, 'so may a first plan for somebody who has none');

for (const s of ['loading', 'error', 'partial'] as const) {
  const g = guardPlan(s, 'ready', null, 'Priya');
  ok(!g.allowed, `a ${s} profile read holds the send control`);
  ok(g.label !== null && g.reason !== null, 'with a label and a sentence');
  ok(g.reason!.includes('Priya'), 'addressed to this client');
}
for (const s of ['loading', 'error', 'partial'] as const) {
  const g = guardPlan('ready', s, null, 'Priya');
  ok(!g.allowed, `a ${s} read of their existing plan holds it too — sending would overwrite a week nobody saw`);
}
// An empty week under a failed read must never be sent as "they have no plan".
ok(!guardPlan('ready', 'error', null, 'Priya').allowed,
  'a null plan under a failed read is unknown, not "no plan set"');

const gated = guardPlan('ready', 'ready', afterDisclosure, 'Priya');
ok(!gated.allowed, 'a stale plan cannot be sent');
eq(gated.reason, planStaleLine(afterDisclosure, 'Priya'), 'and the gate and the sentence are the same words');

// The profile is checked BEFORE staleness, and that order is the point: with
// no allergen list read there is nothing to judge staleness against, and a
// "this plan is fine" would be made out of the connection rather than the
// client.
ok(!guardPlan('error', 'ready', current, 'Priya').allowed,
  'a current-looking plan over an unread profile is still held');
ok(guardPlan('error', 'ready', current, 'Priya').reason!.includes('allergens'),
  'and says which read is missing');

/* ── the arithmetic shown to the coach ─────────────────────────────────── */

eq(planDayBaseKcal(seeded, 0), seeded.days[0].meals.reduce((a, m) => a + m.k, 0),
  'a day base is its meals at one serving each');
eq(planDayBaseKcal(seeded, 99), 0, 'a day that is not in the week has no base');

ok(planServingNote([1, 1, 1], 2000, 2000).includes('as written'), 'a day that lands on target is served as written');
const up = planServingNote([1.75, 1.75, 1.75], 1400, 2450);
ok(up.includes('1.75') && up.includes('up'), 'a short day says the plates are scaled up, and by how much');
ok(up.includes('1,400') && up.includes('2,450'), 'with both figures separated');
ok(planServingNote([0.75, 0.75, 0.75], 3200, 2400).includes('down'), 'and a long one, down');

// `buildPlan` moves individual plates by a quarter serving to close the last of
// the calorie gap, so the day's plates are no longer one number. The note took
// one, and the screen was passing breakfast's.
const mixed = planServingNote([1.5, 1.25, 1.5], 1800, 2600);
ok(mixed.includes('1.25') && mixed.includes('1.5'),
  'a day whose plates differ names the range rather than one plate');
ok(!mixed.includes('every plate'), 'and does not claim every plate is the same');
ok(planServingNote([], 2000, 2000).includes('as written'), 'an empty day does not throw');

// No verdict on either figure. This screen records a coaching decision; it does
// not grade one.
for (const s of [planServingNote([1], 2000, 2000), up, mixed, planServingNote([0.5, 0.5], 4000, 1800)]) {
  ok(!/safe|unsafe|healthy|unhealthy|too (low|high)|should eat/i.test(s),
    'the serving note offers no clinical judgement');
}

/* ── and what the portions cannot do ───────────────────────────────────── */

// Scaling multiplies every macro by the same number, so protein is whatever the
// chosen meals contain. The screen drew that as a meter beside a target it
// disagreed with and said nothing.
eq(planProteinNote(100, 100), null, 'a day on its protein target says nothing');
eq(planProteinNote(105, 100), null, 'nor does a few grams either way');
const over = planProteinNote(150, 100);
ok(over !== null && over.includes('150') && over.includes('100') && over.includes('above'),
  'a day half again over target says so, with both figures');
ok(over !== null && /swap/i.test(over), 'and names the only lever that moves it');
const under = planProteinNote(70, 100);
ok(under !== null && under.includes('below'), 'a day under target says that instead');
eq(planProteinNote(150, 0), null, 'no target is nothing to be off by');
eq(planProteinNote(Number.NaN, 100), null, 'and a figure that is not a number is not a finding');
for (const s of [over, under]) {
  ok(!/safe|unsafe|healthy|unhealthy|too (low|high)|should eat/i.test(s ?? ''),
    'the protein note offers no clinical judgement either');
}

// The note is true of what buildPlan actually produces: a real day off its
// protein target gets the sentence, and the sentence carries that day's figure.
{
  const body = { id: 'pn', weightKg: 60, bodyFatPct: 25, activity: 1.55, goal: 'tone' as const, diet: 'meat' as const, mealsPerDay: 3 as const, avoid: [] };
  const built = buildPlan(body);
  const note = planProteinNote(built.tot.P, built.target.protein);
  const off = Math.abs(built.tot.P - built.target.protein) / built.target.protein;
  eq(note === null, off < 0.1, 'the note appears exactly when the day is off target');
  if (note) ok(note.includes(String(built.tot.P)), 'and it quotes the day the plan actually built');
}

/* ── capture ───────────────────────────────────────────────────────────── */

const cap = capturePlanMeal('meat', 'Dinner', 5, []);
eq(cap.slot, 'Dinner', 'a captured meal knows its slot');
eq(cap.n, mealAt('meat', 'Dinner', 5, []).n, 'and its name is the catalogue’s');
eq(cap.k, mealAt('meat', 'Dinner', 5, []).k, 'and its per-serving calories');
eq(capturePlanMeal('meat', 'Dinner', -1, []).idx, catalogSize('meat', 'Dinner', []) - 1,
  'a negative index wraps to the end rather than to zero');

/* ── a week is seven meals, not one meal seven ways ────────────────────── */
//
// The test that was missing. `planWeek`, `seedPlan` and `swapIndex` all stepped
// the index by 1, and the LAST component pool varies fastest — FLAVORS for a
// main, and for Breakfast a six-entry style pool that is literally '', 'warm',
// 'chilled', 'with cinnamon'. So a generated week was one dinner with seven
// spice rubs and seven breakfasts that differed by an adverb, and every
// assertion in this file passed anyway. They all route through `variantStep`
// now; these assert the thing the owner would look at.

const eater = client({ weightKg: 82, mealsPerDay: 3, diet: 'meat' });

for (const [slotIdx, slot] of slotsFor(eater.mealsPerDay).entries()) {
  const week = planWeek(eater).map((day) => day[slotIdx]);
  const names = new Set(week.map((m) => m.n));
  ok(names.size === week.length, `${slot} is seven different meals across the week — got ${names.size}`);
  // Not just different NAMES: a different dish. Two meals built from the same
  // components with a different spice rub have the same ingredient list head.
  const heads = new Set(week.map((m) => m.ing[0]?.[0] ?? ''));
  ok(heads.size >= 5, `${slot} varies its main ingredient across the week, not its seasoning — got ${heads.size} of 7`);
}

// And a day is not the same protein twice: `mealSeed` spaces the slots by 7,
// which is a fine dimension, so Lunch and Dinner drew the same protein.
for (const day of planWeek(eater)) {
  const [, lunch, dinner] = day;
  ok(lunch.ing[0]?.[0] !== dinner.ing[0]?.[0],
    `lunch and dinner are not the same protein — got ${lunch.n} then ${dinner.n}`);
}

// A swap moves the substantive component too, for the same reason.
{
  const size = catalogSize('meat', 'Breakfast', []);
  const before = mealAt('meat', 'Breakfast', 0, []);
  const after = mealAt('meat', 'Breakfast', swapIndex('meat', 'Breakfast', 0, []), []);
  ok(size > 1, 'the breakfast catalogue has something to swap to');
  // Compared with the style stripped: 'Berry oats (warm)' and 'Berry oats
  // (with vanilla)' are the same breakfast, which is the bug.
  const dish = mealDish;
  ok(dish(before.n) !== dish(after.n),
    `a swapped breakfast is a different dish — got ${before.n} then ${after.n}`);
}

/* ── the picker can find what is in the pool ───────────────────────────── */
//
// `searchMeals` scanned the first 800 CONSECUTIVE indices, and for meat/Dinner
// the protein changes every 1,560 — so the picker could only ever return
// grilled chicken, and a coach typing any other protein got nothing from a
// screen that told them the slot held ten thousand meals.

for (const q of ['beef', 'salmon', 'turkey', 'prawns', 'sweet potato', 'broccoli', 'teriyaki']) {
  const hits = searchMeals('meat', 'Dinner', q, 40, []);
  ok(hits.length > 0, `the dinner picker finds "${q}", which is in the pool`);
  ok(hits.every((m) => m.n.toLowerCase().includes(q)), `and every row it returns really contains "${q}"`);
}
for (const q of ['pancake', 'shakshuka', 'omelette']) {
  ok(searchMeals('meat', 'Breakfast', q, 40, []).length > 0, `the breakfast picker finds "${q}"`);
}
for (const q of ['tofu', 'lentils', 'chickpeas']) {
  ok(searchMeals('vegan', 'Dinner', q, 40, []).length > 0, `the vegan dinner picker finds "${q}"`);
}
ok(searchMeals('meat', 'Dinner', 'pemmican', 40, []).length === 0,
  'and finds nothing for something that is not in the pool');

// An empty query opens on dishes that differ, not forty seasonings of one.
{
  const open = searchMeals('meat', 'Dinner', '', 20, []);
  const proteins = new Set(open.map((m) => m.ing[0]?.[0] ?? ''));
  ok(open.length === 20, 'an empty query fills the list');
  ok(proteins.size >= 5, `and opens on different proteins — got ${proteins.size}`);
}

// Allergen filtering still holds: nothing the member excluded comes back.
{
  const dairyFree = searchMeals('vegetarian', 'Dinner', 'halloumi', 40, ['dairy']);
  ok(dairyFree.every((m) => !m.ing.some(([item]) => /halloumi/i.test(item))),
    'a dairy-free search does not compose a meal out of halloumi');
}

/* ── a coach's note is a disclosure too ─────────────────────────────────── */
{
  // A plan written against the member's own list, then the coach records a
  // shellfish allergy the client mentioned in person. The union moved, so the
  // plan is stale and cannot be sent until it is rewritten.
  const own: Allergen[] = ['nuts'];
  const written = seedPlan(client({ avoid: excludedAllergens(own, [])! }), WRITTEN);
  const after = planStale(written, 'meat', excludedAllergens(own, ['shellfish'])!, 4);
  ok(after.stale && after.addedAvoid.includes('shellfish'), 'a coach-noted allergen stales a plan written without it');
  // And a coach who has no notes cannot make the member's own entry vanish.
  eq(planStale(written, 'meat', excludedAllergens(own, [])!, 4).droppedAvoid.length, 0,
    'the union with an empty coach list still carries the member’s nuts');
  // Unread coach notes: no union, so nothing to judge the plan against, and the
  // screen holds the send on its profile status.
  eq(excludedAllergens(own, null), null, 'an unread coach list yields no exclusion list to plan against');
}

/* ── dislikes steer the generated week, and the coach's seed is that week ── */
{
  const dis = client({ dislikes: ['salmon', 'chicken'] });
  const week = planWeek(dis);
  for (const day of week) for (const m of day) {
    ok(!mealDislikes(m, ['salmon', 'chicken']).length, `the generated week honours dislikes: ${m.n}`);
  }
  const seed = seedPlan(dis, WRITTEN);
  seed.days.forEach((day, d) => day.meals.forEach((m, i) =>
    eq(m.n, week[d][i].n, `the coach's seed day ${d} slot ${i} is the week the client sees`)));
  const sw = swapIndex('meat', 'Dinner', week[0][3].idx, [], ['salmon', 'chicken']);
  ok(!mealDislikes(mealAt('meat', 'Dinner', sw, []), ['salmon', 'chicken']).length, 'a swap lands on a meal they do not dislike');
  ok(searchMeals('meat', 'Dinner', '', 20, [], ['salmon']).every((m) => !/salmon/i.test(m.n)), 'the picker leaves disliked meals out');
  ok(searchMeals('meat', 'Dinner', 'salmon', 20, [], ['salmon']).length > 0, 'unless that is what they searched for');
}

/* ── a slot their allergens leave empty ──────────────────────────────────── */
//
// A vegan client avoiding soy has no breakfast the catalogue can make (every
// vegan breakfast base is tofu or soy milk). The coach's week sends that slot
// EMPTY, the coach is told which slot and why beside Send, and the plan still
// round-trips and still sends: the empty slot is safe, the rest is worth having.
{
  const soyFree = client({ diet: 'vegan', avoid: ['soy'] });
  const plan = seedPlan(soyFree, WRITTEN);
  ok(plan.days.every((d) => d.meals[0].slot === 'Breakfast' && d.meals[0].k === 0 && /without soy/.test(d.meals[0].n)),
    'every day of the seeded week carries the empty, named breakfast');
  ok(plan.days.every((d) => d.meals.slice(1).every((m) => m.k > 0)), 'and a real meal in every other slot');
  ok(parsePlan(JSON.parse(JSON.stringify(plan))) !== null, 'a plan with an empty slot survives being stored and read back');
  eq(planStale(plan, 'vegan', ['soy'], 4).stale, false, 'and is current against the client it was written for');
  const line = planEmptySlotsLine('vegan', 4, ['soy'], 'Sam');
  ok(!!line && /Sam's breakfast reaches them empty/.test(line) && /soy/.test(line) && /Pin a recipe/.test(line),
    'the coach is told which slot, which allergen, and what to do');
  ok(!/\u2014/.test(line ?? ''), 'with no em dash');
  eq(planEmptySlotsLine('vegan', 4, ['dairy'], 'Sam'), null, 'and told nothing when every slot has a meal');
  eq(guardPlan('ready', 'ready', planStale(plan, 'vegan', ['soy'], 4), 'Sam').allowed, true, 'sending is not withheld over it');
  // Written before the soy was disclosed: the breakfast they chose now
  // resolves to the empty slot, and the coach is told the plan has moved.
  const before = seedPlan(client({ diet: 'vegan', avoid: [] }), WRITTEN);
  const after = planStale(before, 'vegan', ['soy'], 4);
  ok(after.stale && after.addedAvoid.includes('soy'), 'a soy disclosure after the plan was written makes it stale');
  ok(after.diverged.some((d) => d.slot === 'Breakfast' && /without soy/.test(d.now)), 'and names the breakfast that is now empty');
  // The coach's builder, on this client: the served plates aim at their share.
  const built = buildPlan({ ...soyFree, mealOverride: planDayOverride(plan, 0) });
  ok(built.plan[0].unfillable?.includes('soy') === true, 'the builder draws the empty breakfast');
  ok(built.aim < built.target.kcal && built.tot.K < built.target.kcal, 'and does not total the day as if it were full');
}

/* ── protein is chosen, not only disclosed ─────────────────────────────── */
//
// Portioning closes calories and cannot move protein, so a fresh plan now
// CHOOSES its meals with the day's protein share in mind (`freshPicks` in
// src/lib/meals.ts). Measured on this exact sweep, 240 weeks, before the
// change: mean protein error 39.6%, 16.4% of days within 10% of target, and
// no week fewer than 5 different dinner proteins. After: 22.8%, 54.3%, 6.
{
  const diets = ['meat', 'vegetarian', 'vegan', 'paleo', 'keto'] as const;
  const goals = ['fatloss', 'tone', 'muscle'] as const;
  const bodies = [[52, 30], [68, 28], [82, 20], [110, 30]] as const;
  const errs: number[] = [];
  const kErrs: number[] = [];
  let fewest = Infinity, n = 0;
  for (const diet of diets) for (const goal of goals) for (const [w, bf] of bodies) for (const mpd of [3, 5] as const) for (const avoid of [[], ['dairy']] as Allergen[][]) {
    const c = client({ id: 'sweep-' + n++, weightKg: w, bodyFatPct: bf, goal, diet, mealsPerDay: mpd, avoid });
    const { target } = buildPlan(c);
    const week = planWeek(c);
    for (const day of week) {
      const share = day.filter((m) => !m.unfillable).length / day.length;
      errs.push(Math.abs(day.reduce((a, m) => a + m.P, 0) / (target.protein * share) - 1));
      kErrs.push(Math.abs(day.reduce((a, m) => a + m.K, 0) / (target.kcal * share) - 1));
    }
    // The dinner's lead ingredient is its protein. Seven nights of the
    // leanest chicken is the collapse this must not cause.
    fewest = Math.min(fewest, new Set(week.map((d) => d[d.length - 1].ing[0]?.[0])).size);
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  ok(mean(errs) < 0.26, `protein error falls: mean ${(mean(errs) * 100).toFixed(1)}%, was 39.6%`);
  ok(errs.filter((e) => e < 0.1).length / errs.length > 0.5, 'and most days now land within 10% of their protein target, where one in six did');
  ok(mean(kErrs) < 0.015, `and calories are still closed by portioning: mean ${(mean(kErrs) * 100).toFixed(2)}%`);
  ok(fewest >= 5, `without variety collapsing: every week has at least 5 different dinner proteins, got ${fewest}`);
}

// A stored pick is served as stored: protein never re-chooses it. The coach's
// day and the member's swap are indices, and an index means one meal.
{
  const c = client({ weightKg: 60, bodyFatPct: 25, goal: 'tone' });
  for (const idx of [0, 7, 123, 4567]) {
    const served = buildPlan({ ...c, mealOverride: { 0: idx, 1: idx, 2: idx, 3: idx } }).plan;
    served.forEach((m) => {
      const size = catalogSize(c.diet, m.slot, []);
      eq(m.idx, idx % size, `${m.slot} ${idx} is served as the index it was stored as`);
      eq(m.n, mealAt(c.diet, m.slot, idx % size, []).n, `and as the meal that index names`);
    });
  }
  // The coach's seed is the member's week, index for index.
  const seeded = seedPlan(c, WRITTEN);
  const shown = planWeek(c);
  ok(seeded.days.every((day, d) => day.meals.every((m, i) => m.idx === shown[d][i].idx)), 'the coach seeds the week the member is shown');
}

/* ── a meal name carries no dash, and an old one still reads ───────────── */
{
  const brek = Array.from({ length: 40 }, (_, i) => mealAt('meat', 'Breakfast', i, []).n);
  ok(brek.every((n) => !n.includes('—')), 'no generated breakfast carries an em dash');
  ok(brek.some((n) => / \((warm|chilled|with [a-z ]+)\)$/.test(n)), 'its style is bracketed instead');
  eq(mealDish('Mango overnight oats + chia (chilled)'), 'Mango overnight oats + chia', 'the dish reads without its style');
  eq(mealDish('Mango overnight oats + chia — chilled'), 'Mango overnight oats + chia', 'and so does a name stored in the old form');
  ok(sameMealName('Berry oats — warm', 'Berry oats (warm)'), 'an old stored name is the same meal as its new spelling');
  ok(!sameMealName('Berry oats — warm', 'Berry oats (chilled)'), 'and a different style is still a different meal');
  const empty = unfillableName('Breakfast', ['soy']);
  eq(mealDish(empty), empty, "an empty slot's name has no style to strip");
  ok(!empty.includes('—') && !empty.includes('('), 'and it reads as a sentence, with no joiner in it');
  // A coach's plan written before the change stores the dashed names. It is
  // not a different plan because the punctuation moved.
  const nutFree = client({ avoid: ['nuts'] });
  const plan = seedPlan(nutFree, WRITTEN);
  const legacy: CoachMealPlan = { ...plan, days: plan.days.map((d) => ({ meals: d.meals.map((m) => ({ ...m, n: m.n.replace(/ \(([^()]*)\)$/, m.slot === 'Breakfast' ? ' — $1' : ' ($1)') })) })) };
  ok(legacy.days.some((d) => d.meals.some((m) => m.n.includes('—'))), 'the fixture really does carry old dashed names');
  // Shellfish is in no breakfast, so every breakfast index still names the
  // same meal; a strict string compare would call all seven diverged.
  eq(planStale(legacy, 'meat', ['nuts', 'shellfish'], 4).diverged.filter((x) => x.slot === 'Breakfast').length, 0,
    'and a breakfast that still resolves to the same meal is not reported as diverged over its spelling');
}

/* ── the protein note, on a day with an empty slot ─────────────────────── */
{
  const soyFree = client({ diet: 'vegan', avoid: ['soy'], mealsPerDay: 4 });
  const built = buildPlan(soyFree);
  const share = built.aim / built.target.kcal;
  ok(share < 1, 'a vegan avoiding soy serves three of four slots');
  const note = planProteinNote(built.tot.P, built.target.protein, share);
  const vsServed = Math.abs(built.tot.P / (built.target.protein * share) - 1);
  eq(note === null, vsServed < 0.1, 'the note is judged against what the served meals should carry');
  if (note) ok(/empty slot/.test(note), 'and says the empty slot is why the aim is lower');
  // The whole-day figure is what the old note read against: an empty
  // breakfast made every such day look short of protein, with "swap a meal"
  // as the advice.
  ok(planProteinNote(75, 100, 0.75) === null, 'three quarters of the day, carrying three quarters of the protein, is on target');
  ok(/below/.test(planProteinNote(75, 100) ?? ''), 'where against the whole day it would have read as short');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('mealPlan: ok');
