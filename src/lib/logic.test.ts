// Pure-logic test suite. Compile with tsc then run with node.
import { macrosFor, GOAL_ADJ, buildMealPlan } from './nutrition';
import { isLateCancellation, cancelSession, overlaps, nextFromWaitlist } from './booking';
import { ageFromDob } from './age';
import { isoDate, seriesDelta } from './format';
import { catalogSize, mealAt, buildPlan, snackIdeas, SNACK_SHARE, groceryData, searchMeals, swapIndex, type PlanInput, type Slot } from './meals';
import type { TrainingSession, Diet } from './types';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// ── nutrition ──
const base = { weightKg: 67.4, bodyFatPct: 28.2, activity: 1.45 } as const;
const fatloss = macrosFor({ ...base, goal: 'fatloss', diet: 'vegetarian' });
const muscle = macrosFor({ ...base, goal: 'muscle', diet: 'meat' });
ok(muscle.kcal > fatloss.kcal, 'muscle goal should yield more kcal than fat loss');
ok(GOAL_ADJ.muscle > 0 && GOAL_ADJ.fatloss < 0, 'goal adjustments have wrong sign');
ok(fatloss.protein > 0 && fatloss.carbs >= 20 && fatloss.fat > 0, 'macros must be positive');
// keto pushes fat up vs standard split
const keto = macrosFor({ ...base, goal: 'tone', diet: 'keto' });
const std = macrosFor({ ...base, goal: 'tone', diet: 'meat' });
ok(keto.fat > std.fat, 'keto should have higher fat than standard');
// macro kcal roughly reconciles with target (protein*4 + carb*4 + fat*9)
const recon = fatloss.protein * 4 + fatloss.carbs * 4 + fatloss.fat * 9;
ok(near(recon, fatloss.kcal, 30), `macro kcal reconcile off: ${recon} vs ${fatloss.kcal}`);

// ── meal plan generator ──
const plan4 = buildMealPlan({ ...base, goal: 'fatloss', diet: 'vegan' }, 4);
ok(plan4.meals.length === 4, 'meal plan should honour meals-per-day (4)');
const plan5 = buildMealPlan({ ...base, goal: 'muscle', diet: 'meat' }, 5);
ok(plan5.meals.length === 5, 'meal plan should honour meals-per-day (5)');
ok(near(plan4.total.K, plan4.targets.kcal, plan4.targets.kcal * 0.18), 'meal-plan total should land near the kcal target');
ok(plan4.meals.every((m) => m.servings >= 0.5), 'servings must be at least half');

// ── procedural meal engine ──
const DIETS: Diet[] = ['meat', 'vegetarian', 'vegan', 'paleo', 'keto'];
const SLOTS: Slot[] = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
// every diet must offer at least 250 options in every slot (the user's spec)
for (const d of DIETS) for (const s of SLOTS) {
  ok(catalogSize(d, s) >= 250, `catalog ${d}/${s} only ${catalogSize(d, s)} (<250)`);
}
// generated meals are deterministic and carry real macros + ingredients + steps
const m0 = mealAt('vegan', 'Lunch', 0);
const m0b = mealAt('vegan', 'Lunch', 0);
ok(m0.n === m0b.n && m0.k === m0b.k, 'mealAt must be deterministic');
ok(m0.k > 0 && m0.p > 0 && m0.ing.length > 0 && m0.steps.length > 0, 'meal must have macros, ingredients and steps');
// index wraps around the catalog
const size = catalogSize('meat', 'Dinner');
ok(mealAt('meat', 'Dinner', size).n === mealAt('meat', 'Dinner', 0).n, 'index should wrap modulo catalog size');
// a vegan plan never contains meat-department chicken/beef/etc from a protein
const vplan = buildPlan({ id: 'c1', weightKg: 67, bodyFatPct: 28, activity: 1.45, goal: 'fatloss', diet: 'vegan', mealsPerDay: 4 });
ok(vplan.plan.length === 4, 'plan honours meals-per-day');
ok(vplan.plan.every((m) => !m.ing.some(([, , , dept]) => dept === 'Meat & Seafood')), 'vegan plan must contain no meat/seafood');
ok(near(vplan.tot.K, vplan.target.kcal, vplan.target.kcal * 0.2), 'meal-engine total near kcal target');
// swap advances the index and stays in range
const si = swapIndex('meat', 'Lunch', 3);
ok(si === 4 % catalogSize('meat', 'Lunch'), 'swapIndex should advance by one, wrapping');
// override pins a specific meal
const pinned: PlanInput = { id: 'c1', weightKg: 67, bodyFatPct: 28, activity: 1.45, goal: 'tone', diet: 'meat', mealsPerDay: 3, mealOverride: { 0: 5 } };
ok(buildPlan(pinned).plan[0].idx === 5 % catalogSize('meat', 'Breakfast'), 'override should pin the meal index');
// search finds by name
const found = searchMeals('meat', 'Lunch', 'chicken', 10);
ok(found.length > 0 && found.every((m) => m.n.toLowerCase().includes('chicken')), 'searchMeals should filter by query');
// grocery list aggregates a week into departments
const groc = groceryData({ id: 'c1', weightKg: 67, bodyFatPct: 28, activity: 1.45, goal: 'fatloss', diet: 'vegetarian', mealsPerDay: 4 });
ok(Object.keys(groc.byDept).length >= 3, 'grocery list should span several departments');
ok(groc.mealCount > 0, 'grocery list should count distinct meals');
const allItems = (Object.values(groc.byDept).flat() as { qty: number }[]);
ok(allItems.every((it) => it.qty > 0), 'grocery quantities must be positive');

// ── booking ──
const now = Date.parse('2026-07-09T10:00:00Z');
ok(isLateCancellation('2026-07-09T20:00:00Z', now) === true, 'inside 24h should be late');
ok(isLateCancellation('2026-07-12T20:00:00Z', now) === false, 'outside 24h should not be late');
ok(isLateCancellation('2026-07-08T20:00:00Z', now) === false, 'past session is not a late-cancel');

const sess: TrainingSession = {
  id: 's1', trainerId: 't1', clientId: 'c1',
  startsAt: '2026-07-09T20:00:00Z', durationMin: 60, status: 'booked', released: false,
};
const res = cancelSession(sess, 75, ['c1', 'c2', 'c3'], now);
ok(res.charged === true && res.feeAmount === 75, 'late cancel should charge the fee');
ok(res.notifyClientIds.length === 2 && !res.notifyClientIds.includes('c1'), 'canceller excluded from re-offer');
ok(res.notifyTrainer === true, 'trainer must be notified');

const far = cancelSession({ ...sess, startsAt: '2026-07-14T20:00:00Z' }, 75, ['c1', 'c2'], now);
ok(far.charged === false && far.feeAmount === 0, '>24h cancel must not charge');

ok(nextFromWaitlist(['c9', 'c8']) === 'c9', 'waitlist should be FIFO');
ok(nextFromWaitlist([]) === null, 'empty waitlist returns null');

const existing: TrainingSession[] = [sess];
ok(overlaps('2026-07-09T20:30:00Z', 60, existing) === true, 'overlapping slot should be detected');
ok(overlaps('2026-07-09T21:30:00Z', 60, existing) === false, 'non-overlapping slot should pass');

// ── age ──
ok(ageFromDob('1990-03-10', new Date('2026-07-09')) === 36, 'age 1990-03-10 → 36');
ok(ageFromDob('2000-12-31', new Date('2026-07-09')) === 25, 'birthday not yet passed → 25');
ok(ageFromDob('') === null, 'empty dob → null');

declare const process: { exit(code: number): void };
// ── format helpers ──
ok(isoDate(new Date('2026-07-09T12:00:00')) === '2026-07-09', 'isoDate should format YYYY-MM-DD');
ok(seriesDelta([71.2, 70, 67.4]) === -3.8, 'seriesDelta should be signed first→last');
ok(seriesDelta([50]) === 0, 'seriesDelta of single point is 0');

/* ── snack ideas ───────────────────────────────────────────────────────── */
//
// Reported as: the meals section needs snacks. The catalogue always had them,
// reachable only by changing "meals per day" from 3 to 4 — which rebuilds the
// whole day's meals as a side effect of wanting an apple.
{
  const c: PlanInput = { id: 'snack-client', weightKg: 80, bodyFatPct: 18, activity: 1.55, goal: 'fatloss', diet: 'meat', mealsPerDay: 3 };
  const ideas = snackIdeas(c, 3);
  ok(ideas.length === 3, 'three ideas by default');
  ok(ideas.every((m) => m.slot === 'Snack'), 'and every one of them is a snack, not a meal');

  // Distinct: three variations of one thing is not three ideas.
  ok(new Set(ideas.map((m) => m.n)).size === 3, 'the three are different foods');

  // Portioned as a snack, not as a fourth meal. The plan scales its meals to
  // fill the day; a snack scaled the same way IS a meal.
  const target = buildPlan(c).target.kcal;
  for (const m of ideas) {
    ok(m.K > 0, `${m.n} has calories`);
    ok(m.K < target * 0.35, `${m.n} is a snack-sized portion, not a meal's share of the day`);
  }
  ok(SNACK_SHARE > 0 && SNACK_SHARE < 0.25, 'the share a snack is built to is a snack-sized fraction');

  // They are IDEAS: nothing about them moves the plan or its targets, because
  // a snack nobody has eaten is not a commitment.
  const before = buildPlan(c);
  snackIdeas(c, 3);
  const after = buildPlan(c);
  ok(before.tot.K === after.tot.K && before.plan.length === after.plan.length,
    'asking for snack ideas does not change the plan or its totals');

  // Negative positions, so an idea can never collide with a plan slot in the
  // override map — an override written at slot 0 would swap breakfast.
  ok(ideas.every((m) => m.pos < 0), 'snack ideas sit outside the plan slot numbering');
  ok(new Set(ideas.map((m) => m.pos)).size === 3, 'and each has its own key');

  // Stable for a client, so the section does not reshuffle on every render.
  ok(JSON.stringify(snackIdeas(c, 3)) === JSON.stringify(ideas), 'the same client gets the same ideas');

  // Diet and allergens are honoured — the whole point of generating rather
  // than hard-coding a list.
  const vegan = snackIdeas({ ...c, diet: 'vegan' }, 3);
  ok(vegan.length === 3 && vegan.every((m) => m.diet === 'vegan'), 'a vegan client gets vegan snacks');
  ok(JSON.stringify(vegan) !== JSON.stringify(ideas), 'and not the omnivore list relabelled');

  // Asking for more than the catalogue holds returns what there is, not a
  // padded list with repeats.
  const many = snackIdeas(c, 500);
  ok(many.length <= catalogSize('meat', 'Snack'), 'never more ideas than the catalogue has');
  ok(new Set(many.map((m) => m.pos)).size === many.length, 'and no repeated keys among them');
}

console.log(errors.length ? 'LOGIC FAILURES:\n' + errors.join('\n') : 'ALL PRODUCTION-LOGIC TESTS PASSED');
if (errors.length) process.exit(1);
