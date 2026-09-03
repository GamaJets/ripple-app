"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// A coach's authored meal plan, and the ways one stops being the plan they
// wrote. Compile with tsc, run with node.
//
// The assertions that matter are the two that were the whole reason for the
// design: that a meal the coach chose is the meal the CLIENT's own buildPlan
// produces for that day (otherwise the screen is theatre), and that an allergen
// disclosed after the plan was written is caught rather than served.
const mealPlan_1 = require("./mealPlan");
const meals_1 = require("./meals");
const weekStart_1 = require("./weekStart");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const client = (over = {}) => ({
    id: 'c8f2a1d4-0000-4000-8000-000000000001',
    weightKg: 78, bodyFatPct: 22, activity: 1.45,
    goal: 'fatloss', diet: 'meat', mealsPerDay: 4, avoid: [],
    ...over,
});
const WRITTEN = '2026-08-31T09:00:00.000Z';
/* ── the week, and which day is which ──────────────────────────────────── */
eq(mealPlan_1.PLAN_WEEKDAYS.length, mealPlan_1.PLAN_DAYS, 'the labels and the days are the same week');
eq(mealPlan_1.PLAN_WEEKDAYS[0], weekStart_1.WEEK_DAYS[0], 'the plan is stored in the order the app draws a week');
eq(mealPlan_1.PLAN_WEEKDAYS[0], 'Sun', 'which is Sunday first — src/lib/weekStart.ts');
// 2026-09-06 is a Sunday and opens the week. The stored order and getDay() are
// only the same while the week opens on Sunday, and `planDayIndex` is the
// conversion — a plan read in the wrong one hands a client the wrong day's
// dinners, every week.
eq((0, mealPlan_1.planDayIndex)('2026-09-06'), 0, 'Sunday is day 0');
eq((0, mealPlan_1.planDayIndex)('2026-09-12'), 6, 'Saturday is day 6, not day 0');
eq((0, mealPlan_1.planDayIndex)('2026-09-03'), 4, 'Thursday is day 4');
eq((0, mealPlan_1.planDayIndex)('not-a-date'), null, 'an unreadable date has no day, and must not default to the first one');
// Every day of one real week, in order. This is the assertion that fails if the
// stored order and the drawn order are ever allowed to disagree.
const WEEK = ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'];
WEEK.forEach((iso, d) => eq((0, mealPlan_1.planDayIndex)(iso), d, `${mealPlan_1.PLAN_WEEKDAYS[d]} ${iso} is day ${d}`));
/* ── a seeded plan is the week the client can already see ──────────────── */
const c = client();
const seeded = (0, mealPlan_1.seedPlan)(c, WRITTEN);
eq(seeded.v, mealPlan_1.PLAN_VERSION, 'the seed carries the version');
eq(seeded.days.length, mealPlan_1.PLAN_DAYS, 'a plan is a week');
eq(seeded.diet, 'meat', 'and records the diet its indices mean something under');
eq(seeded.mealsPerDay, 4, 'and the meals per day its slots were laid out for');
for (const day of seeded.days) {
    eq(day.meals.length, (0, meals_1.slotsFor)(4).length, 'every day has one meal per slot');
    day.meals.forEach((m, i) => eq(m.slot, (0, meals_1.slotsFor)(4)[i], `slot ${i} is in slot order`));
}
// Day 0 is what the client's own buildPlan already produces for them. A seed
// that invented a different Monday would make "send" a change the coach never
// made.
const clientDay0 = (0, meals_1.buildPlan)(c).plan;
seeded.days[0].meals.forEach((m, i) => {
    eq(m.idx, clientDay0[i].idx, `seeded Monday slot ${i} is the meal the client already sees`);
    eq(m.n, clientDay0[i].n, `and carries its name`);
});
/* ── THE BRIDGE: what the coach chose is what the client is served ─────── */
//
// planDayOverride's whole job is to hand a day back in the shape buildPlan
// already takes. If this drifts, the coach screen is decoration and the client
// eats something else.
for (let d = 0; d < mealPlan_1.PLAN_DAYS; d++) {
    const served = (0, meals_1.buildPlan)({ ...c, mealOverride: (0, mealPlan_1.planDayOverride)(seeded, d) }).plan;
    seeded.days[d].meals.forEach((m, i) => {
        eq(served[i].n, m.n, `day ${d} slot ${i}: the client is served the meal the coach chose`);
        eq(served[i].idx, m.idx, `day ${d} slot ${i}: by the same index`);
    });
}
// The map is keyed by POSITION, which is what buildPlan reads it by.
const ov = (0, mealPlan_1.planDayOverride)(seeded, 2);
eq(Object.keys(ov).length, 4, 'one entry per slot');
eq(ov[0], seeded.days[2].meals[0].idx, 'position 0 is the first slot');
eq((0, mealPlan_1.planDayOverride)(seeded, 99)[0], undefined, 'a day that is not in the week yields nothing, not day 0');
/* ── editing ───────────────────────────────────────────────────────────── */
const before = seeded.days[1].meals[0].idx;
const edited = (0, mealPlan_1.setPlanMeal)(seeded, 1, 0, before + 1);
ok(edited !== seeded, 'an edit returns a new plan');
eq(seeded.days[1].meals[0].idx, before, 'the original is untouched');
eq(edited.days[1].meals[0].idx, before + 1, 'and the copy carries the new index');
eq(edited.days[0].meals[0].idx, seeded.days[0].meals[0].idx, 'and leaves every other day alone');
eq(edited.days[1].meals[1].idx, seeded.days[1].meals[1].idx, 'and every other slot');
// The snapshot is not decoration: it must agree with what the index resolves to.
eq(edited.days[1].meals[0].n, (0, meals_1.mealAt)('meat', 'Breakfast', edited.days[1].meals[0].idx, []).n, 'the stored name is the meal the stored index names');
eq((0, mealPlan_1.setPlanMeal)(seeded, 99, 0, 5), seeded, 'editing a day that is not there changes nothing');
eq((0, mealPlan_1.setPlanMeal)(seeded, 0, 99, 5), seeded, 'nor a slot that is not there');
// An index past the end of the catalogue wraps rather than resolving to
// nothing — the same modulo buildPlan applies, so the two cannot disagree.
const big = (0, mealPlan_1.setPlanMeal)(seeded, 0, 0, (0, meals_1.catalogSize)('meat', 'Breakfast', []) + 3);
eq(big.days[0].meals[0].idx, 3, 'an out-of-range index is wrapped at the point it is stored');
const copied = (0, mealPlan_1.copyPlanDay)(seeded, 0, 4);
eq(copied.days[4].meals[0].idx, seeded.days[0].meals[0].idx, 'a copied day takes the source meals');
eq(copied.days[0].meals[0].idx, seeded.days[0].meals[0].idx, 'and the source is unchanged');
ok(copied.days[4].meals !== copied.days[0].meals, 'the copy is not a shared reference the next edit would hit twice');
eq((0, mealPlan_1.copyPlanDay)(seeded, 2, 2), seeded, 'copying a day onto itself is a no-op');
/* ── round-tripping through jsonb ──────────────────────────────────────── */
const round = (0, mealPlan_1.parsePlan)(JSON.parse(JSON.stringify(seeded)));
ok(round !== null, 'a plan survives the trip through the database');
eq(JSON.stringify(round), JSON.stringify(seeded), 'unchanged');
eq((0, mealPlan_1.parsePlan)(null), null, 'nothing is not a plan');
eq((0, mealPlan_1.parsePlan)('a plan'), null, 'nor a string');
eq((0, mealPlan_1.parsePlan)([]), null, 'nor an array');
eq((0, mealPlan_1.parsePlan)({ ...seeded, v: 99 }), null, 'a version this build does not know is refused, not guessed at');
eq((0, mealPlan_1.parsePlan)({ ...seeded, diet: 'carnivore' }), null, 'a diet with no catalogue is refused');
eq((0, mealPlan_1.parsePlan)({ ...seeded, mealsPerDay: 6 }), null, 'a meals-per-day with no slot layout is refused');
eq((0, mealPlan_1.parsePlan)({ ...seeded, days: seeded.days.slice(0, 5) }), null, 'a part-week is refused');
// The slot order is checked against the meals-per-day, because a plan whose
// position 2 says Breakfast where a Snack belongs would resolve its index
// through the wrong catalogue entirely.
const wrongOrder = JSON.parse(JSON.stringify(seeded));
wrongOrder.days[0].meals[1].slot = 'Snack';
eq((0, mealPlan_1.parsePlan)(wrongOrder), null, 'a slot out of position is refused');
const noName = JSON.parse(JSON.stringify(seeded));
noName.days[3].meals[0].n = '';
eq((0, mealPlan_1.parsePlan)(noName), null, 'a meal with no recorded name is refused — the snapshot is the evidence');
const badIdx = JSON.parse(JSON.stringify(seeded));
badIdx.days[0].meals[0].idx = -1;
eq((0, mealPlan_1.parsePlan)(badIdx), null, 'a negative index is refused');
// Junk in `avoid` is dropped rather than failing the whole plan: an unknown
// allergen id cannot filter anything, and refusing the week over it would take
// a coach's plan away from a client for a typo.
const oddAvoid = (0, mealPlan_1.parsePlan)({ ...JSON.parse(JSON.stringify(seeded)), avoid: ['nuts', 'pineapple'] });
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
    const v1 = JSON.parse(JSON.stringify(seeded));
    v1.v = 1;
    for (let d = 0; d < mealPlan_1.PLAN_DAYS; d++)
        v1.days[d].meals[0].idx = d;
    const read = (0, mealPlan_1.parsePlan)(v1);
    ok(read !== null, 'a plan written before the week moved is still a plan — not silently no plan');
    eq(read.v, mealPlan_1.PLAN_VERSION, 'and it is handed back at the current version');
    // Position i now holds the day whose Monday-first position was (jsDay + 6) % 7.
    for (let i = 0; i < mealPlan_1.PLAN_DAYS; i++) {
        eq(read.days[i].meals[0].idx, ((0, weekStart_1.jsDayForIndex)(i) + 6) % 7, `${mealPlan_1.PLAN_WEEKDAYS[i]} still carries the meals the coach wrote for it`);
    }
    // Said again in the concrete, because the loop above would also pass if both
    // sides were wrong in the same way.
    eq(read.days[0].meals[0].idx, 6, 'v1 position 6 was Sunday, and Sunday now opens the week');
    eq(read.days[1].meals[0].idx, 0, 'v1 position 0 was Monday, which is now the second column');
    // Nothing is lost or duplicated: seven days in, the same seven out.
    eq(new Set(read.days.map((d) => d.meals[0].idx)).size, mealPlan_1.PLAN_DAYS, 'the rotation moves the days, it does not drop or repeat one');
    // A v1 plan is still checked as hard as a v2 one — the version is not a
    // trapdoor past the validation.
    const badV1 = JSON.parse(JSON.stringify(v1));
    badV1.days[2].meals[0].n = '';
    eq((0, mealPlan_1.parsePlan)(badV1), null, 'a v1 plan with a meal missing its snapshot is refused like any other');
    eq((0, mealPlan_1.parsePlan)({ ...v1, days: v1.days.slice(0, 5) }), null, 'and a v1 part-week is still a part-week');
}
/* ── the allergen check, which is what this is for ─────────────────────── */
const nutFree = client({ avoid: ['nuts'] });
const writtenForNutFree = (0, mealPlan_1.seedPlan)(nutFree, WRITTEN);
// Nothing has moved.
ok(!(0, mealPlan_1.planStale)(writtenForNutFree, 'meat', ['nuts'], 4).stale, 'a plan against the profile it was written for is not stale');
eq((0, mealPlan_1.planStaleLine)((0, mealPlan_1.planStale)(writtenForNutFree, 'meat', ['nuts'], 4), 'Priya'), null, 'and has no sentence to say about itself');
// Order-independence needs two allergens listed the other way round. This used
// to repeat the call above verbatim — `['nuts']` against `['nuts'] as
// Allergen[]`, a compile-time cast over a ONE-element list, in which there is
// no order to vary. It could not have caught `sameSet` losing its `.sort()`,
// which is the whole property the word "order-independently" is claiming.
const twoAllergens = client({ avoid: ['nuts', 'shellfish'] });
const writtenForTwo = (0, mealPlan_1.seedPlan)(twoAllergens, WRITTEN);
ok(!(0, mealPlan_1.planStale)(writtenForTwo, 'meat', ['shellfish', 'nuts'], 4).stale, 'the same two allergens listed in the other order are the same two allergens — order-independently');
// The whole verdict, not just its `stale` flag: `addedAvoid` and `droppedAvoid`
// are what the coach's sentence is built from, and an order-sensitive
// comparison would name an allergen as newly disclosed that the plan was
// already written against.
eq(JSON.stringify((0, mealPlan_1.planStale)(writtenForTwo, 'meat', ['shellfish', 'nuts'], 4)), JSON.stringify((0, mealPlan_1.planStale)(writtenForTwo, 'meat', ['nuts', 'shellfish'], 4)), 'and the two orderings produce the same verdict in every field, not merely the same flag');
ok((0, mealPlan_1.planStale)(writtenForTwo, 'meat', ['shellfish'], 4).stale, 'while genuinely dropping one of them is a change, so the comparison is not simply blind to the list');
// A disclosure AFTER the plan was written. This is the case with a person on
// the other end of it.
const afterDisclosure = (0, mealPlan_1.planStale)(seeded, 'meat', ['nuts'], 4);
ok(afterDisclosure.stale, 'an allergen disclosed since the plan was written makes it stale');
eq(JSON.stringify(afterDisclosure.addedAvoid), JSON.stringify(['nuts']), 'and is named');
eq(afterDisclosure.droppedAvoid.length, 0, 'without inventing one they dropped');
ok((0, mealPlan_1.planStaleLine)(afterDisclosure, 'Priya').includes('Priya'), 'the sentence is about this client');
ok((0, mealPlan_1.planStaleLine)(afterDisclosure, 'Priya').includes('nuts'), 'and names the disclosure');
ok((0, mealPlan_1.planStaleLine)(afterDisclosure, 'Priya').includes('Rebuild'), 'and says what to do');
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
const veganPlan = (0, mealPlan_1.seedPlan)(client({ diet: 'vegan', avoid: [] }), WRITTEN);
const quietDisclosure = (0, mealPlan_1.planStale)(veganPlan, 'vegan', ['shellfish'], 4);
eq(quietDisclosure.diverged.length, 0, 'a vegan catalogue is unchanged by a shellfish allergy');
ok(quietDisclosure.stale, 'and the plan is STILL stale, on the disclosure alone');
eq(JSON.stringify(quietDisclosure.addedAvoid), JSON.stringify(['shellfish']), 'which is what says so');
ok((0, mealPlan_1.planStaleLine)(quietDisclosure, 'Ada').includes('shellfish'), 'and the coach is told which one');
ok(!(0, mealPlan_1.guardPlan)('ready', 'ready', quietDisclosure, 'Ada').allowed, 'and the week cannot be sent on it');
// Changing the diet is the same failure by another route.
const dietMoved = (0, mealPlan_1.planStale)(seeded, 'vegan', [], 4);
ok(dietMoved.stale && dietMoved.dietChanged, 'a changed diet makes a plan stale');
ok((0, mealPlan_1.planStaleLine)(dietMoved, 'Sam').includes('diet'), 'and says so');
// So is changing how many meals a day they eat: the slots are not the slots.
const slotsMoved = (0, mealPlan_1.planStale)(seeded, 'meat', [], 3);
ok(slotsMoved.stale && slotsMoved.mealsPerDayChanged, 'a changed meals-per-day makes a plan stale');
eq(slotsMoved.diverged.length, 0, 'and does not also list every meal as diverged — the slots no longer line up, so there is nothing to compare');
// Dropping an allergen is not a safety problem and is still a renumbering.
const dropped = (0, mealPlan_1.planStale)(writtenForNutFree, 'meat', [], 4);
ok(dropped.stale, 'dropping an allergen still renumbers the catalogue');
eq(JSON.stringify(dropped.droppedAvoid), JSON.stringify(['nuts']), 'and is reported as a drop, not a disclosure');
eq(dropped.addedAvoid.length, 0, 'not as something newly disclosed');
/* ── the send gate ─────────────────────────────────────────────────────── */
const current = (0, mealPlan_1.planStale)(seeded, 'meat', [], 4);
ok((0, mealPlan_1.guardPlan)('ready', 'ready', current, 'Priya').allowed, 'a current plan against a read profile may be sent');
ok((0, mealPlan_1.guardPlan)('ready', 'ready', null, 'Priya').allowed, 'so may a first plan for somebody who has none');
for (const s of ['loading', 'error', 'partial']) {
    const g = (0, mealPlan_1.guardPlan)(s, 'ready', null, 'Priya');
    ok(!g.allowed, `a ${s} profile read holds the send control`);
    ok(g.label !== null && g.reason !== null, 'with a label and a sentence');
    ok(g.reason.includes('Priya'), 'addressed to this client');
}
for (const s of ['loading', 'error', 'partial']) {
    const g = (0, mealPlan_1.guardPlan)('ready', s, null, 'Priya');
    ok(!g.allowed, `a ${s} read of their existing plan holds it too — sending would overwrite a week nobody saw`);
}
// An empty week under a failed read must never be sent as "they have no plan".
ok(!(0, mealPlan_1.guardPlan)('ready', 'error', null, 'Priya').allowed, 'a null plan under a failed read is unknown, not "no plan set"');
const gated = (0, mealPlan_1.guardPlan)('ready', 'ready', afterDisclosure, 'Priya');
ok(!gated.allowed, 'a stale plan cannot be sent');
eq(gated.reason, (0, mealPlan_1.planStaleLine)(afterDisclosure, 'Priya'), 'and the gate and the sentence are the same words');
// The profile is checked BEFORE staleness, and that order is the point: with
// no allergen list read there is nothing to judge staleness against, and a
// "this plan is fine" would be made out of the connection rather than the
// client.
ok(!(0, mealPlan_1.guardPlan)('error', 'ready', current, 'Priya').allowed, 'a current-looking plan over an unread profile is still held');
ok((0, mealPlan_1.guardPlan)('error', 'ready', current, 'Priya').reason.includes('allergens'), 'and says which read is missing');
/* ── the arithmetic shown to the coach ─────────────────────────────────── */
eq((0, mealPlan_1.planDayBaseKcal)(seeded, 0), seeded.days[0].meals.reduce((a, m) => a + m.k, 0), 'a day base is its meals at one serving each');
eq((0, mealPlan_1.planDayBaseKcal)(seeded, 99), 0, 'a day that is not in the week has no base');
ok((0, mealPlan_1.planServingNote)(1, 2000, 2000).includes('as written'), 'a day that lands on target is served as written');
const up = (0, mealPlan_1.planServingNote)(1.75, 1400, 2450);
ok(up.includes('1.75') && up.includes('up'), 'a short day says the plates are scaled up, and by how much');
ok(up.includes('1,400') && up.includes('2,450'), 'with both figures separated');
ok((0, mealPlan_1.planServingNote)(0.75, 3200, 2400).includes('down'), 'and a long one, down');
// No verdict on either figure. This screen records a coaching decision; it does
// not grade one.
for (const s of [(0, mealPlan_1.planServingNote)(1, 2000, 2000), up, (0, mealPlan_1.planServingNote)(0.5, 4000, 1800)]) {
    ok(!/safe|unsafe|healthy|unhealthy|too (low|high)|should eat/i.test(s), 'the serving note offers no clinical judgement');
}
/* ── capture ───────────────────────────────────────────────────────────── */
const cap = (0, mealPlan_1.capturePlanMeal)('meat', 'Dinner', 5, []);
eq(cap.slot, 'Dinner', 'a captured meal knows its slot');
eq(cap.n, (0, meals_1.mealAt)('meat', 'Dinner', 5, []).n, 'and its name is the catalogue’s');
eq(cap.k, (0, meals_1.mealAt)('meat', 'Dinner', 5, []).k, 'and its per-serving calories');
eq((0, mealPlan_1.capturePlanMeal)('meat', 'Dinner', -1, []).idx, (0, meals_1.catalogSize)('meat', 'Dinner', []) - 1, 'a negative index wraps to the end rather than to zero');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('mealPlan: ok');
