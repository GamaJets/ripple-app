"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Pure-logic test suite. Compile with tsc then run with node.
const nutrition_1 = require("./nutrition");
const booking_1 = require("./booking");
const age_1 = require("./age");
const format_1 = require("./format");
const meals_1 = require("./meals");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
// ── nutrition ──
const base = { weightKg: 67.4, bodyFatPct: 28.2, activity: 1.45 };
const fatloss = (0, nutrition_1.macrosFor)({ ...base, goal: 'fatloss', diet: 'vegetarian' });
const muscle = (0, nutrition_1.macrosFor)({ ...base, goal: 'muscle', diet: 'meat' });
ok(muscle.kcal > fatloss.kcal, 'muscle goal should yield more kcal than fat loss');
ok(nutrition_1.GOAL_ADJ.muscle > 0 && nutrition_1.GOAL_ADJ.fatloss < 0, 'goal adjustments have wrong sign');
ok(fatloss.protein > 0 && fatloss.carbs >= 20 && fatloss.fat > 0, 'macros must be positive');
// keto pushes fat up vs standard split
const keto = (0, nutrition_1.macrosFor)({ ...base, goal: 'tone', diet: 'keto' });
const std = (0, nutrition_1.macrosFor)({ ...base, goal: 'tone', diet: 'meat' });
ok(keto.fat > std.fat, 'keto should have higher fat than standard');
// macro kcal roughly reconciles with target (protein*4 + carb*4 + fat*9)
const recon = fatloss.protein * 4 + fatloss.carbs * 4 + fatloss.fat * 9;
ok(near(recon, fatloss.kcal, 30), `macro kcal reconcile off: ${recon} vs ${fatloss.kcal}`);
// ── meal plan generator ──
const plan4 = (0, nutrition_1.buildMealPlan)({ ...base, goal: 'fatloss', diet: 'vegan' }, 4);
ok(plan4.meals.length === 4, 'meal plan should honour meals-per-day (4)');
const plan5 = (0, nutrition_1.buildMealPlan)({ ...base, goal: 'muscle', diet: 'meat' }, 5);
ok(plan5.meals.length === 5, 'meal plan should honour meals-per-day (5)');
ok(near(plan4.total.K, plan4.targets.kcal, plan4.targets.kcal * 0.18), 'meal-plan total should land near the kcal target');
ok(plan4.meals.every((m) => m.servings >= 0.5), 'servings must be at least half');
// ── procedural meal engine ──
const DIETS = ['meat', 'vegetarian', 'vegan', 'paleo', 'keto'];
const SLOTS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
// every diet must offer at least 250 options in every slot (the user's spec)
for (const d of DIETS)
    for (const s of SLOTS) {
        ok((0, meals_1.catalogSize)(d, s) >= 250, `catalog ${d}/${s} only ${(0, meals_1.catalogSize)(d, s)} (<250)`);
    }
// generated meals are deterministic and carry real macros + ingredients + steps
const m0 = (0, meals_1.mealAt)('vegan', 'Lunch', 0);
const m0b = (0, meals_1.mealAt)('vegan', 'Lunch', 0);
ok(m0.n === m0b.n && m0.k === m0b.k, 'mealAt must be deterministic');
ok(m0.k > 0 && m0.p > 0 && m0.ing.length > 0 && m0.steps.length > 0, 'meal must have macros, ingredients and steps');
// index wraps around the catalog
const size = (0, meals_1.catalogSize)('meat', 'Dinner');
ok((0, meals_1.mealAt)('meat', 'Dinner', size).n === (0, meals_1.mealAt)('meat', 'Dinner', 0).n, 'index should wrap modulo catalog size');
// a vegan plan never contains meat-department chicken/beef/etc from a protein
const vplan = (0, meals_1.buildPlan)({ id: 'c1', weightKg: 67, bodyFatPct: 28, activity: 1.45, goal: 'fatloss', diet: 'vegan', mealsPerDay: 4 });
ok(vplan.plan.length === 4, 'plan honours meals-per-day');
ok(vplan.plan.every((m) => !m.ing.some(([, , , dept]) => dept === 'Meat & Seafood')), 'vegan plan must contain no meat/seafood');
ok(near(vplan.tot.K, vplan.target.kcal, vplan.target.kcal * 0.2), 'meal-engine total near kcal target');
// swap advances the index and stays in range
const si = (0, meals_1.swapIndex)('meat', 'Lunch', 3);
ok(si === 4 % (0, meals_1.catalogSize)('meat', 'Lunch'), 'swapIndex should advance by one, wrapping');
// override pins a specific meal
const pinned = { id: 'c1', weightKg: 67, bodyFatPct: 28, activity: 1.45, goal: 'tone', diet: 'meat', mealsPerDay: 3, mealOverride: { 0: 5 } };
ok((0, meals_1.buildPlan)(pinned).plan[0].idx === 5 % (0, meals_1.catalogSize)('meat', 'Breakfast'), 'override should pin the meal index');
// search finds by name
const found = (0, meals_1.searchMeals)('meat', 'Lunch', 'chicken', 10);
ok(found.length > 0 && found.every((m) => m.n.toLowerCase().includes('chicken')), 'searchMeals should filter by query');
// grocery list aggregates a week into departments
const groc = (0, meals_1.groceryData)({ id: 'c1', weightKg: 67, bodyFatPct: 28, activity: 1.45, goal: 'fatloss', diet: 'vegetarian', mealsPerDay: 4 });
ok(Object.keys(groc.byDept).length >= 3, 'grocery list should span several departments');
ok(groc.mealCount > 0, 'grocery list should count distinct meals');
const allItems = Object.values(groc.byDept).flat();
ok(allItems.every((it) => it.qty > 0), 'grocery quantities must be positive');
// ── booking ──
const now = Date.parse('2026-07-09T10:00:00Z');
ok((0, booking_1.isLateCancellation)('2026-07-09T20:00:00Z', now) === true, 'inside 24h should be late');
ok((0, booking_1.isLateCancellation)('2026-07-12T20:00:00Z', now) === false, 'outside 24h should not be late');
ok((0, booking_1.isLateCancellation)('2026-07-08T20:00:00Z', now) === false, 'past session is not a late-cancel');
const sess = {
    id: 's1', trainerId: 't1', clientId: 'c1',
    startsAt: '2026-07-09T20:00:00Z', durationMin: 60, status: 'booked', released: false,
};
const res = (0, booking_1.cancelSession)(sess, 75, ['c1', 'c2', 'c3'], now);
ok(res.charged === true && res.feeAmount === 75, 'late cancel should charge the fee');
ok(res.notifyClientIds.length === 2 && !res.notifyClientIds.includes('c1'), 'canceller excluded from re-offer');
ok(res.notifyTrainer === true, 'trainer must be notified');
const far = (0, booking_1.cancelSession)({ ...sess, startsAt: '2026-07-14T20:00:00Z' }, 75, ['c1', 'c2'], now);
ok(far.charged === false && far.feeAmount === 0, '>24h cancel must not charge');
ok((0, booking_1.nextFromWaitlist)(['c9', 'c8']) === 'c9', 'waitlist should be FIFO');
ok((0, booking_1.nextFromWaitlist)([]) === null, 'empty waitlist returns null');
const existing = [sess];
ok((0, booking_1.overlaps)('2026-07-09T20:30:00Z', 60, existing) === true, 'overlapping slot should be detected');
ok((0, booking_1.overlaps)('2026-07-09T21:30:00Z', 60, existing) === false, 'non-overlapping slot should pass');
// ── age ──
ok((0, age_1.ageFromDob)('1990-03-10', new Date('2026-07-09')) === 36, 'age 1990-03-10 → 36');
ok((0, age_1.ageFromDob)('2000-12-31', new Date('2026-07-09')) === 25, 'birthday not yet passed → 25');
ok((0, age_1.ageFromDob)('') === null, 'empty dob → null');
// ── format helpers ──
ok((0, format_1.isoDate)(new Date('2026-07-09T12:00:00')) === '2026-07-09', 'isoDate should format YYYY-MM-DD');
ok((0, format_1.seriesDelta)([71.2, 70, 67.4]) === -3.8, 'seriesDelta should be signed first→last');
ok((0, format_1.seriesDelta)([50]) === 0, 'seriesDelta of single point is 0');
/* ── every meal the generator can produce ──────────────────────────────── */
//
// Mutation testing put this file's kill rate at 8.6%: it is mostly a table of
// food components — hundreds of kcal/protein/carb/fat literals — and changing
// any one of them was a change no test noticed.
//
// Transcribing the table into assertions would prove nothing and break on
// every recipe tweak. What is worth pinning is that the table stays COHERENT,
// checked through the generator rather than by reading the table, so it
// covers what the app actually renders. All 95,518 combinations, in about a
// tenth of a second.
{
    const DIETS = ['meat', 'vegetarian', 'vegan', 'paleo', 'keto'];
    const SLOTS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
    const depts = new Set(meals_1.DEPTS);
    // Components are rounded individually, so 4p + 4c + 9f never lands exactly
    // on the stated kcal. The worst gap across the whole catalogue today is 38
    // kcal (9.9%); the bounds below are set above that with room for a recipe
    // tweak, and are still far tighter than any realistic typo — a component
    // whose 220 kcal became 20 shifts a meal by 40%, and a transposed protein
    // figure by about 29%.
    const MAX_GAP_KCAL = 60;
    const MAX_GAP_PCT = 0.15;
    let checked = 0;
    const fail = [];
    const note = (m) => { if (fail.length < 5)
        fail.push(m); };
    for (const diet of DIETS) {
        for (const slot of SLOTS) {
            const size = (0, meals_1.catalogSize)(diet, slot);
            ok(size > 0, `${diet}/${slot} has meals at all`);
            for (let i = 0; i < size; i++) {
                const x = (0, meals_1.mealAt)(diet, slot, i);
                checked++;
                const where = `${diet}/${slot}#${i}`;
                if (!x.n || /undefined|NaN|\[object/.test(x.n))
                    note(`${where}: name reads "${x.n}"`);
                if (x.slot !== slot)
                    note(`${where}: came back as a ${x.slot}`);
                if (x.diet !== diet)
                    note(`${where}: came back as ${x.diet}`);
                // A meal with no calories is a row somebody will eat and log as zero.
                if (!(x.k > 0))
                    note(`${where}: ${x.k} kcal`);
                for (const [key, v] of [['p', x.p], ['c', x.c], ['f', x.f]]) {
                    if (!Number.isFinite(v) || v < 0)
                        note(`${where}: ${key} is ${v}`);
                }
                const atwater = 4 * x.p + 4 * x.c + 9 * x.f;
                const gap = Math.abs(atwater - x.k);
                if (gap > MAX_GAP_KCAL || (x.k > 0 && gap / x.k > MAX_GAP_PCT)) {
                    note(`${where}: ${x.k} kcal but its macros come to ${atwater}`);
                }
                // Steps and ingredients are what the recipe sheet renders. An empty
                // one is a sheet with a heading and nothing under it.
                if (!x.steps?.length || x.steps.some((st) => !st.trim()))
                    note(`${where}: empty method`);
                if (!x.ing?.length)
                    note(`${where}: no ingredients`);
                for (const g of x.ing ?? []) {
                    if (!g[0]?.trim())
                        note(`${where}: an ingredient with no name`);
                    if (!(g[1] > 0))
                        note(`${where}: ${g[0]} has quantity ${g[1]}`);
                    // The UNIT may be empty, and that is correct: "1 Banana", "2 Eggs".
                    // Countable things have no unit, and demanding one here would have
                    // failed 34,568 perfectly good ingredients.
                    if (typeof g[2] !== 'string')
                        note(`${where}: ${g[0]} has a non-string unit`);
                    // The department is what sorts the grocery list. An unknown one
                    // silently drops the item off the shopping list.
                    if (!depts.has(g[3]))
                        note(`${where}: ${g[0]} is filed under "${g[3]}"`);
                }
            }
        }
    }
    ok(checked > 90000, `the whole catalogue was walked, not a sample (${checked})`);
    ok(fail.length === 0, 'every generated meal is coherent — ' + fail.join(' · '));
}
/* ── snack ideas ───────────────────────────────────────────────────────── */
//
// Reported as: the meals section needs snacks. The catalogue always had them,
// reachable only by changing "meals per day" from 3 to 4 — which rebuilds the
// whole day's meals as a side effect of wanting an apple.
{
    const c = { id: 'snack-client', weightKg: 80, bodyFatPct: 18, activity: 1.55, goal: 'fatloss', diet: 'meat', mealsPerDay: 3 };
    const ideas = (0, meals_1.snackIdeas)(c, 3);
    ok(ideas.length === 3, 'three ideas by default');
    ok(ideas.every((m) => m.slot === 'Snack'), 'and every one of them is a snack, not a meal');
    // Distinct: three variations of one thing is not three ideas.
    ok(new Set(ideas.map((m) => m.n)).size === 3, 'the three are different foods');
    // Portioned as a snack, not as a fourth meal. The plan scales its meals to
    // fill the day; a snack scaled the same way IS a meal.
    const target = (0, meals_1.buildPlan)(c).target.kcal;
    for (const m of ideas) {
        ok(m.K > 0, `${m.n} has calories`);
        ok(m.K < target * 0.35, `${m.n} is a snack-sized portion, not a meal's share of the day`);
    }
    ok(meals_1.SNACK_SHARE > 0 && meals_1.SNACK_SHARE < 0.25, 'the share a snack is built to is a snack-sized fraction');
    // They are IDEAS: nothing about them moves the plan or its targets, because
    // a snack nobody has eaten is not a commitment.
    const before = (0, meals_1.buildPlan)(c);
    (0, meals_1.snackIdeas)(c, 3);
    const after = (0, meals_1.buildPlan)(c);
    ok(before.tot.K === after.tot.K && before.plan.length === after.plan.length, 'asking for snack ideas does not change the plan or its totals');
    // Negative positions, so an idea can never collide with a plan slot in the
    // override map — an override written at slot 0 would swap breakfast.
    ok(ideas.every((m) => m.pos < 0), 'snack ideas sit outside the plan slot numbering');
    ok(new Set(ideas.map((m) => m.pos)).size === 3, 'and each has its own key');
    // Stable for a client, so the section does not reshuffle on every render.
    ok(JSON.stringify((0, meals_1.snackIdeas)(c, 3)) === JSON.stringify(ideas), 'the same client gets the same ideas');
    // Diet and allergens are honoured — the whole point of generating rather
    // than hard-coding a list.
    const vegan = (0, meals_1.snackIdeas)({ ...c, diet: 'vegan' }, 3);
    ok(vegan.length === 3 && vegan.every((m) => m.diet === 'vegan'), 'a vegan client gets vegan snacks');
    ok(JSON.stringify(vegan) !== JSON.stringify(ideas), 'and not the omnivore list relabelled');
    // Asking for more than the catalogue holds returns what there is, not a
    // padded list with repeats.
    const many = (0, meals_1.snackIdeas)(c, 500);
    ok(many.length <= (0, meals_1.catalogSize)('meat', 'Snack'), 'never more ideas than the catalogue has');
    ok(new Set(many.map((m) => m.pos)).size === many.length, 'and no repeated keys among them');
}
console.log(errors.length ? 'LOGIC FAILURES:\n' + errors.join('\n') : 'ALL PRODUCTION-LOGIC TESTS PASSED');
if (errors.length)
    process.exit(1);
