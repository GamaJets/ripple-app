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
  planDayOverride, planServingNote, planStale, planStaleLine, seedPlan, setPlanMeal,
  type CoachMealPlan,
} from './mealPlan';
import { buildPlan, catalogSize, mealAt, slotsFor, type Allergen, type PlanInput } from './meals';

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
eq(PLAN_WEEKDAYS[0], 'Mon', 'the week starts on Monday, as the client Meals tab draws it');

// 2026-08-31 is a Monday. Date.getDay() calls that 1; a plan stored in that
// order would hand a client Sunday's dinners on a Monday, every week.
eq(planDayIndex('2026-08-31'), 0, 'Monday is day 0');
eq(planDayIndex('2026-09-06'), 6, 'Sunday is day 6, not day 0');
eq(planDayIndex('2026-09-03'), 3, 'Thursday is day 3');
eq(planDayIndex('not-a-date'), null, 'an unreadable date has no day, and must not default to Monday');
// Every day of one real week, in order. This is the assertion that fails if
// the +6 %7 is ever "simplified" back to getDay().
const WEEK = ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06'];
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

ok(planServingNote(1, 2000, 2000).includes('as written'), 'a day that lands on target is served as written');
const up = planServingNote(1.75, 1400, 2450);
ok(up.includes('1.75') && up.includes('up'), 'a short day says the plates are scaled up, and by how much');
ok(up.includes('1,400') && up.includes('2,450'), 'with both figures separated');
ok(planServingNote(0.75, 3200, 2400).includes('down'), 'and a long one, down');
// No verdict on either figure. This screen records a coaching decision; it does
// not grade one.
for (const s of [planServingNote(1, 2000, 2000), up, planServingNote(0.5, 4000, 1800)]) {
  ok(!/safe|unsafe|healthy|unhealthy|too (low|high)|should eat/i.test(s),
    'the serving note offers no clinical judgement');
}

/* ── capture ───────────────────────────────────────────────────────────── */

const cap = capturePlanMeal('meat', 'Dinner', 5, []);
eq(cap.slot, 'Dinner', 'a captured meal knows its slot');
eq(cap.n, mealAt('meat', 'Dinner', 5, []).n, 'and its name is the catalogue’s');
eq(cap.k, mealAt('meat', 'Dinner', 5, []).k, 'and its per-serving calories');
eq(capturePlanMeal('meat', 'Dinner', -1, []).idx, catalogSize('meat', 'Dinner', []) - 1,
  'a negative index wraps to the end rather than to zero');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('mealPlan: ok');
