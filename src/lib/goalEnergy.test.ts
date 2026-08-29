// Goal-driven calories (TF-29). Compile with tsc then run with node.
//
// Two families of assertion here, and the second is the one that earns its
// keep. The first says the derived number is right. The second says the app
// refuses to produce one at all when the record cannot support it — no goal,
// no date, no readings — and that the refusal is NAMED rather than dressed up
// as a plan. A test that only exercised the happy path would pass just as
// well against a module that quietly invented a rate for everybody.
import {
  energyPlanFor, safeWeeklyRate, planKcal, observedRateKg,
  KCAL_PER_KG, MIN_PLAN_KCAL, MAX_DEFICIT_FRACTION_OF_TDEE,
  MAX_LOSS_FRACTION_PER_WEEK, MAX_GAIN_FRACTION_PER_WEEK,
  type DerivedPlan, type EnergyPlan,
} from './goalEnergy';
import { projectionOf, MIN_TREND_DAYS, type GoalTarget, type Point } from './goalTargets';
import { macrosFor, maintenanceFor } from './nutrition';
import type { BodyStats } from './types';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

const DAY = 86400000;
const NOW = Date.parse('2026-03-01T09:00:00.000Z');
const iso = (daysFromNow: number) => new Date(NOW + daysFromNow * DAY).toISOString();

// One client throughout: 90 kg, 24% body fat, moderately active. Lean mass
// 68.4 kg, so maintenance lands near 2,400 kcal.
const BODY: BodyStats = { weightKg: 90, bodyFatPct: 24, activity: 1.4, goal: 'tone', diet: 'meat' };
const TDEE = maintenanceFor(BODY).tdee;

/** Weigh-ins ending at 90 kg, spanning enough days to be a trend. */
const SERIES: Point[] = [
  { t: iso(-28), v: 91.4 },
  { t: iso(-14), v: 90.8 },
  { t: iso(-1), v: 90.0 },
];

const weightGoal = (targetKg: number | null, targetDays: number | null): GoalTarget => ({
  id: 'g1',
  kind: 'weight',
  targetValue: targetKg,
  title: null,
  targetDateISO: targetDays == null ? null : iso(targetDays),
  achievedAtISO: null,
  createdAtISO: iso(-30),
});

const planFor = (goal: GoalTarget | null, series: readonly Point[] = SERIES, tdee = TDEE): EnergyPlan =>
  energyPlanFor({ goal, weightSeries: series, tdeeKcal: tdee, nowMs: NOW });

const derived = (p: EnergyPlan, what: string): DerivedPlan => {
  if (p.kind === 'derived') return p;
  errors.push(`${what}: expected a derived plan, got the '${p.reason}' fallback`);
  // Never reached when the assertion above holds; keeps the rest of the case
  // compiling rather than making every test guard the union by hand.
  return { kind: 'derived', kcal: 0, kcalDelta: 0, requiredRateKg: 0, plannedRateKg: 0, limitedBy: null,
    onTime: false, etaMs: null, targetDateMs: 0, startKg: 0, currentKg: 0, targetKg: 0, observed: null };
};

// ── the complaint itself: the date has to change the number ────────────────
// 6 kg off in 12 weeks and 6 kg off in 40 weeks were the same calorie target.
const fast = derived(planFor(weightGoal(84, 84)), '6 kg in 12 weeks');
const slow = derived(planFor(weightGoal(84, 280)), '6 kg in 40 weeks');
ok(fast.kcal !== slow.kcal, 'the same 6 kg over 12 and over 40 weeks must not produce the same calorie target — this is TF-29');
ok(fast.kcal < slow.kcal, 'the shorter deadline must be the deeper deficit');
ok(fast.kcal < TDEE && slow.kcal < TDEE, 'both plans are deficits; neither may sit at or above maintenance');
// 6 kg over 12 weeks is 0.5 kg/wk — inside the safe range, so it is delivered
// as asked and the client's own date is the finish.
ok(near(fast.requiredRateKg, -0.5, 0.01), `12-week plan should require −0.5 kg/wk, got ${fast.requiredRateKg.toFixed(3)}`);
ok(fast.limitedBy === null, 'a 0.5 kg/wk ask is inside the safe range and must not be reported as clamped');
ok(fast.onTime, 'an unclamped plan reaches the client’s date');
ok(fast.etaMs === fast.targetDateMs, 'and its finish IS that date');
ok(near(fast.kcalDelta, (-0.5 * KCAL_PER_KG) / 7, 10), `a 0.5 kg/wk deficit is about 550 kcal/day, got ${fast.kcalDelta}`);

// ── refusing to harm: the clamp, and saying so ─────────────────────────────
// 6 kg in 3 weeks is 2 kg/wk. Nobody gets that number.
const crash = derived(planFor(weightGoal(84, 21)), '6 kg in 3 weeks');
ok(near(crash.requiredRateKg, -2.0, 0.02), `the ask should be reported as −2 kg/wk, got ${crash.requiredRateKg.toFixed(2)}`);
ok(crash.limitedBy !== null, 'a 2 kg/wk ask must come back marked as clamped');
ok(Math.abs(crash.plannedRateKg) < Math.abs(crash.requiredRateKg), 'the plan must be slower than the ask');
ok(Math.abs(crash.plannedRateKg) <= 90 * MAX_LOSS_FRACTION_PER_WEEK + 0.01,
  `a 90 kg client must not be planned past 0.9 kg/wk, got ${crash.plannedRateKg.toFixed(2)}`);
// For this client the 25%-of-maintenance cap bites before the 0.9 kg/wk one
// does: 0.9 kg a week off a 2,586 kcal maintenance would be a 38% restriction,
// which is past where Garthe's fast group started losing lean mass.
ok(crash.limitedBy === 'floor', `the binding clamp here is the intake floor, got '${crash.limitedBy}'`);
ok(crash.kcal === Math.round((TDEE * (1 - MAX_DEFICIT_FRACTION_OF_TDEE)) / 10) * 10,
  `and the plan sits exactly on it, got ${crash.kcal}`);
// The rate clamp is the binding one for somebody whose maintenance is big
// enough to allow a fast loss, so both clamps get exercised.
const bigTdee = maintenanceFor({ weightKg: 130, bodyFatPct: 22, activity: 1.9 }).tdee;
const heavy = derived(
  energyPlanFor({ goal: weightGoal(110, 70), weightSeries: [{ t: iso(-20), v: 131 }, { t: iso(-1), v: 130 }], tdeeKcal: bigTdee, nowMs: NOW }),
  '20 kg in 10 weeks for a 130 kg client');
ok(heavy.limitedBy === 'rate', `a big maintenance leaves the rate clamp binding, got '${heavy.limitedBy}'`);
ok(near(heavy.plannedRateKg, -1, 0.02), `and it holds at the 1 kg/wk NHS ceiling, got ${heavy.plannedRateKg.toFixed(2)}`);
ok(!heavy.onTime && heavy.etaMs != null && heavy.etaMs > heavy.targetDateMs, 'a rate-clamped plan misses the date, and says when it lands');
// The half of requirement 2 that is easy to get wrong: never deliver a slower
// plan while implying it lands on the date.
ok(!crash.onTime, 'a clamped plan must NOT claim it reaches the client’s date');
ok(crash.etaMs != null && crash.etaMs > crash.targetDateMs,
  'and it must say when it does arrive — later than the date that was asked for');
ok(crash.kcal >= MIN_PLAN_KCAL, `no plan may go under ${MIN_PLAN_KCAL} kcal, got ${crash.kcal}`);
ok(crash.kcal >= TDEE * (1 - MAX_DEFICIT_FRACTION_OF_TDEE) - 10,
  `no plan may cut more than ${MAX_DEFICIT_FRACTION_OF_TDEE * 100}% of maintenance, got ${crash.kcal} against ${Math.round(TDEE)}`);

// The floor, reached from the other direction: a small, light client cannot be
// given the deficit their date asks for without going under it.
const small: BodyStats = { ...BODY, weightKg: 52, bodyFatPct: 20, activity: 1.3 };
const smallTdee = maintenanceFor(small).tdee;
const tight = derived(
  energyPlanFor({ goal: weightGoal(46, 42), weightSeries: [{ t: iso(-20), v: 52.6 }, { t: iso(-1), v: 52 }], tdeeKcal: smallTdee, nowMs: NOW }),
  'a light client on a 6-week deadline');
ok(tight.kcal >= MIN_PLAN_KCAL, `the absolute floor holds for a small client too, got ${tight.kcal}`);
ok(tight.limitedBy !== null && !tight.onTime, 'a floored plan is reported as limited and as missing the date');

// ── refusing to invent: every path that must fall back, by name ────────────
const fallback = (p: EnergyPlan, reason: string, what: string) => {
  if (p.kind !== 'enum') { errors.push(`${what}: expected the enum fallback, got a derived plan`); return; }
  ok(p.reason === reason, `${what}: expected reason '${reason}', got '${p.reason}'`);
};
fallback(planFor(null), 'no-goal', 'a client with no goal at all');
fallback(planFor({ ...weightGoal(84, 84), achievedAtISO: iso(-2) }), 'no-goal', 'a goal already marked done');
fallback(planFor(weightGoal(84, null)), 'no-target-date', 'a target weight with no date');
fallback(planFor(weightGoal(84, 84), []), 'no-readings', 'a target and a date but nothing weighed');
fallback(planFor({ ...weightGoal(null, 84), kind: 'bodyfat', targetValue: 18 }), 'not-weight', 'a body-fat goal');
fallback(planFor({ ...weightGoal(null, 84), kind: 'custom', title: 'Squat pain-free' }), 'not-weight', 'a goal with no number');
fallback(planFor(weightGoal(90, 84)), 'reached', 'a target the client is already at');
fallback(planFor(weightGoal(84, 84), SERIES, 0), 'no-maintenance', 'a client with no usable maintenance figure');
// Inside the trend window there is no honest plan: the app could not tell them
// whether it was working before the date passed.
fallback(planFor(weightGoal(89, MIN_TREND_DAYS - 1)), 'date-too-soon', 'a date sooner than a trend can be measured');
fallback(planFor(weightGoal(84, -3)), 'date-passed', 'a date that has already gone by');

// A fallback is a fallback all the way down: macrosFor must produce the
// byte-identical macros it produced before TF-29 existed.
const before = macrosFor(BODY);
const withEnum = macrosFor({ ...BODY, energyPlan: planFor(null) });
ok(JSON.stringify(before) === JSON.stringify(withEnum),
  `an 'enum' plan must leave every macro exactly as it was: ${JSON.stringify(before)} vs ${JSON.stringify(withEnum)}`);
ok(JSON.stringify(macrosFor({ ...BODY, energyPlan: null })) === JSON.stringify(before),
  'and so must a null plan');

// ── the derived plan actually reaches the plate ────────────────────────────
const fastMacros = macrosFor({ ...BODY, energyPlan: fast });
const slowMacros = macrosFor({ ...BODY, energyPlan: slow });
ok(fastMacros.kcal === fast.kcal, `macrosFor must use the plan's calorie target: ${fastMacros.kcal} vs ${fast.kcal}`);
ok(fastMacros.kcal !== slowMacros.kcal, 'two deadlines, two calorie targets, on the plate and not just in the plan');
ok(fastMacros.kcal !== before.kcal, 'a derived plan must actually displace the goal enum’s −8%');
ok(fastMacros.tdee === before.tdee && fastMacros.lbm === before.lbm, 'maintenance and lean mass do not move with the goal');

// ── protein does not fall with calories ────────────────────────────────────
// BODY.goal is 'tone', whose enum protein figure is 1.8 g/kg — the number for
// somebody who is not dieting. In a real deficit it must not be used.
ok(fastMacros.protein > before.protein,
  `a 'tone' client held in a deficit must get MORE protein than the enum gave them, not the same: ${fastMacros.protein} vs ${before.protein}`);
ok(fastMacros.protein === slowMacros.protein,
  'protein must not drop as the deficit deepens — the 12-week and 40-week plans carry the same grams');
ok(fastMacros.protein === macrosFor({ ...BODY, goal: 'fatloss' }).protein,
  'a derived deficit protein target matches the dieting figure the fatloss enum already used');
ok(macrosFor({ ...BODY, goal: 'muscle', energyPlan: fast }).protein >= macrosFor({ ...BODY, goal: 'muscle' }).protein,
  'and the floor may only ever raise protein, never lower it');
// A surplus is not a deficit: the floor has no business firing there.
const bulkPlan = derived(planFor(weightGoal(94, 140)), '4 kg gained over 20 weeks');
ok(bulkPlan.kcalDelta > 0, 'a target above the client’s weight is a surplus');
ok(bulkPlan.kcal > TDEE, 'and sits above maintenance');
ok(macrosFor({ ...BODY, energyPlan: bulkPlan }).protein === before.protein,
  'a surplus leaves the client’s own protein figure alone');
// Gaining is clamped harder than losing.
const bulkFast = derived(planFor(weightGoal(96, 28)), '6 kg gained in 4 weeks');
ok(near(bulkFast.plannedRateKg, 90 * MAX_GAIN_FRACTION_PER_WEEK, 0.02),
  `a 90 kg client must not be planned past 0.45 kg/wk of gain, got ${bulkFast.plannedRateKg.toFixed(2)}`);
ok(!bulkFast.onTime && bulkFast.limitedBy === 'rate', 'and the clamp on gaining is reported like any other');

// ── the plan starts where the GOAL started ─────────────────────────────────
// Set ten days ago, so the baseline is the 90.8 kg reading from a fortnight
// back — not the oldest weigh-in the app holds, and not today's.
const recent = derived(planFor({ ...weightGoal(84, 84), createdAtISO: iso(-10) }), 'a goal set ten days ago');
ok(recent.startKg === 90.8, `the baseline is the reading the goal was set at, got ${recent.startKg}`);
ok(recent.currentKg === 90, `and the plan is built from the latest one, got ${recent.currentKg}`);
ok(recent.targetKg === 84, 'with the client’s own target carried through');

// ── the observed pace is goalTargets', not a second opinion ────────────────
const g = weightGoal(84, 84);
ok(JSON.stringify(planFor(g).observed) === JSON.stringify(projectionOf(g, SERIES, NOW)),
  'the observed trend must come from projectionOf unchanged — no second rate calculation lives here');
ok(observedRateKg(fast) != null, 'readings spanning four weeks support a measured pace');
const shortSeries: Point[] = [{ t: iso(-2), v: 90.4 }, { t: iso(-1), v: 90.0 }];
const shortPlan = planFor(g, shortSeries);
ok(observedRateKg(shortPlan) === null,
  `readings ${MIN_TREND_DAYS - 1} days apart are water, not a trend, and must yield no pace`);
ok(shortPlan.kind === 'derived', 'but they are still enough to plan from — the target and the date are what set the rate');
ok(observedRateKg({ kind: 'enum', reason: 'no-goal', observed: null }) === null, 'no goal means no observed pace');

// ── the clamp helpers, directly ────────────────────────────────────────────
ok(safeWeeklyRate(-2, 90) === -0.9, 'a 90 kg client clamps to 0.9 kg/wk of loss (1% of bodyweight)');
ok(safeWeeklyRate(-2, 130) === -1, 'and the absolute 1 kg/wk NHS ceiling catches a heavier one before the percentage does');
ok(safeWeeklyRate(-0.4, 90) === -0.4, 'a rate already inside the range is passed through untouched');
ok(safeWeeklyRate(5, 90) === 0.45, 'gaining clamps to 0.5% of bodyweight a week');
ok(safeWeeklyRate(0, 90) === 0, 'maintenance is a legitimate answer');
ok(planKcal(2400, 0).kcal === 2400, 'no rate, no adjustment');
ok(planKcal(2400, -0.5).kcal === 1850, `−0.5 kg/wk off 2,400 kcal is 1,850, got ${planKcal(2400, -0.5).kcal}`);
ok(planKcal(2400, -3).floored, 'an impossible rate is reported as floored, not silently delivered');
ok(planKcal(2400, -3).kcal === 1800, 'and lands on 75% of maintenance');
ok(planKcal(1400, -3).kcal === MIN_PLAN_KCAL, 'with the absolute 1,200 floor underneath it for a small maintenance');

declare const process: { exit(code: number): void };
console.log(errors.length ? 'GOAL-ENERGY FAILURES:\n' + errors.join('\n') : 'ALL GOAL-ENERGY TESTS PASSED');
if (errors.length) process.exit(1);
