// The week the member is shown, and the list they shop from — proved to be the
// same week. Compile with tsc, run with node.
//
// The grocery list used to be built by a private `planForDay` that re-seeded
// from scratch and never read `mealOverride`, while the screen drew the coach's
// written days or today's plan stepped along the catalogue. Two different weeks
// on one screen, one of them printed above the other.
import {
  PLAN_WEEK_DAYS, buildPlan, groceryFromWeek, planWeek, swapIndex,
  DEPTS, type PlanInput,
} from './meals';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const client = (over: Partial<PlanInput> = {}): PlanInput => ({
  id: 'c8f2a1d4-0000-4000-8000-000000000001',
  weightKg: 78, bodyFatPct: 22, activity: 1.45,
  goal: 'fatloss', diet: 'meat', mealsPerDay: 4, avoid: [],
  ...over,
});

/** The whole list, item and quantity, as one comparable string. */
const listOf = (c: PlanInput, coachDay?: (d: number) => Record<number, number> | null): string => {
  const g = groceryFromWeek(planWeek(c, coachDay));
  return DEPTS.map((d) => `${d}:${(g.byDept[d] ?? []).map((it) => `${it.item}=${it.qty}${it.unit}`).join(',')}`).join(';');
};

/* ── the week is a week ────────────────────────────────────────────────── */

const base = client();
eq(planWeek(base).length, PLAN_WEEK_DAYS, 'a plan week is seven days');
ok(planWeek(base).every((d) => d.length === 4), 'and each of them has the meals-per-day the member set');

// Day zero is the plan as it stands today, not a re-seed. This is the join
// between the two weeks that did not exist before.
eq(planWeek(base)[0].map((m) => m.n).join('|'), buildPlan(base).plan.map((m) => m.n).join('|'),
  'day one of the week is the day the member is looking at');

/* ── a swap moves the shopping list ────────────────────────────────────── */

// The member swaps their breakfast. The list must follow: it used to shop for
// the meal they had swapped away from.
const before = planWeek(base)[0][0];
const swapped = client({ mealOverride: { 0: swapIndex(base.diet, before.slot, before.idx) } });
const after = planWeek(swapped)[0][0];
ok(after.n !== before.n, 'the fixture actually swaps the meal');
eq(planWeek(swapped)[0].map((m) => m.n).join('|'), buildPlan(swapped).plan.map((m) => m.n).join('|'),
  'the swapped day is still the day on screen');

const listBefore = listOf(base);
ok(listOf(swapped) !== listBefore, 'swapping a meal changes what the member is told to buy');

/* ── the coach's week is the one that is shopped for ───────────────────── */

// A coach-written week, supplied the way app/(client)/nutrition.tsx supplies
// it: one override map per day, null for a day the coach did not write.
const written: Record<number, number>[] = Array.from({ length: PLAN_WEEK_DAYS }, (_, d) => ({ 0: 3 + d, 1: 5 + d }));
const coachDay = (d: number) => written[d] ?? null;

const coachWeek = planWeek(base, coachDay);
for (let d = 0; d < PLAN_WEEK_DAYS; d++) {
  eq(coachWeek[d].map((m) => m.n).join('|'),
    buildPlan({ ...base, mealOverride: written[d] }).plan.map((m) => m.n).join('|'),
    `day ${d + 1} of the week is the day the coach wrote`);
}
ok(listOf(base, coachDay) !== listBefore,
  "and the list is for the coach's week rather than the generated one");

// A day the coach left unwritten falls back to the stepped week rather than to
// nothing — a blank Thursday must not empty the shopping list.
const partial = (d: number) => (d === 3 ? null : written[d]);
eq(planWeek(base, partial)[3].map((m) => m.n).join('|'),
  planWeek(base)[3].map((m) => m.n).join('|'),
  'a day the coach did not write keeps the generated one');

/* ── and the list itself still adds up ─────────────────────────────────── */

const g = groceryFromWeek(planWeek(base, coachDay));
ok(Object.keys(g.byDept).length >= 3, 'the list spans several departments');
ok(g.mealCount > 0, 'and counts the distinct meals in it');
ok(DEPTS.every((d) => (g.byDept[d] ?? []).every((it) => it.qty > 0)),
  'every quantity is a real quantity — a zero on a shopping list is an item nobody buys');
// Seven days of four meals cannot come to fewer distinct meals than a day has.
ok(g.mealCount >= 4, 'a week holds at least a day of meals');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('groceryWeek: ok');
