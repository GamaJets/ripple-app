"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The Meals tab and the Food Log, made to agree. Compile with tsc, run with node.
//
// The assertion that matters is the last section: `dayTarget` — what the Food
// Log now prints — is the SAME macro block as `buildPlan(...).target`, which is
// what the Meals tab scales its meals to. Those two figures sit one tap apart
// and used to differ for every member with a target weight and a date, because
// the Food Log's own copy of the sum never saw the goal-date energy plan.
const dayTarget_1 = require("./dayTarget");
const meals_1 = require("./meals");
const nutrition_1 = require("./nutrition");
const goalEnergy_1 = require("./goalEnergy");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const NOW = Date.parse('2026-09-01T09:00:00.000Z');
const day = (n) => new Date(NOW + n * 86400000).toISOString();
const base = (over = {}) => ({
    weightKg: 92, bodyFatPct: 26, activity: 1.45,
    goal: 'fatloss', diet: 'meat',
    coachAdjust: null,
    weightGoal: null,
    weightSeries: [{ t: day(-60), v: 96 }, { t: day(-7), v: 93 }, { t: day(-1), v: 92 }],
    nowMs: NOW,
    ...over,
});
/* ── no body, no target ────────────────────────────────────────────────── */
// The rule the whole of src/ui/clientData.tsx is built on: a member with no
// weight on the account has NO target, and never a placeholder one.
eq((0, dayTarget_1.dayTarget)(base({ weightKg: null })), null, 'no weight is no target');
eq((0, dayTarget_1.dayTarget)(base({ bodyFatPct: null })), null, 'no body fat is no target');
eq((0, dayTarget_1.dayTarget)(base({ weightKg: null, bodyFatPct: null })), null, 'and neither is no target either');
ok((0, dayTarget_1.dayTarget)(base()) != null, 'a measured body has one');
/* ── the fold ──────────────────────────────────────────────────────────── */
eq((0, dayTarget_1.dayAdjust)(null, 0), undefined, 'nothing to apply is undefined, not a block of zeroes');
eq((0, dayTarget_1.dayAdjust)(null, 250)?.kcalDelta, 250, 'a training day is the delta on its own');
eq((0, dayTarget_1.dayAdjust)(null, -250)?.kcalDelta, -250, 'a rest day is the negative one');
eq((0, dayTarget_1.dayAdjust)({ kcalDelta: -300 }, 250)?.kcalDelta, -50, "the coach's adjust and the day type add");
eq((0, dayTarget_1.dayAdjust)({ kcalDelta: 0, proteinDelta: 20 }, 0)?.proteinDelta, 20, 'a coach adjust with no calorie change still applies its macros');
// Solo coaching passes null, and null must not carry a former coach's delta.
eq((0, dayTarget_1.dayAdjust)(null, 0), undefined, 'a member with no coach carries no adjust');
/* ── the day type moves the target, both ways ──────────────────────────── */
const off = (0, dayTarget_1.dayTarget)(base());
const training = (0, dayTarget_1.dayTarget)(base({ cycleKcalDelta: 250 }));
const rest = (0, dayTarget_1.dayTarget)(base({ cycleKcalDelta: -250 }));
eq(training.macros.kcal - off.macros.kcal, 250, 'a training day is 250 over the off day');
eq(off.macros.kcal - rest.macros.kcal, 250, 'and a rest day is 250 under it');
/* ── the goal-date plan is the half the Food Log could not see ─────────── */
const goal = {
    id: 'g1', kind: 'weight',
    targetValue: 85, title: null,
    createdAtISO: day(-60), targetDateISO: day(90),
    achievedAtISO: null,
};
const withGoal = (0, dayTarget_1.dayTarget)(base({ weightGoal: goal }));
eq(withGoal.energyPlan.kind, 'derived', 'a target weight with a date derives a plan');
eq(off.energyPlan.kind, 'enum', 'and without one the goal setting still decides');
// This inequality IS the bug. The Food Log printed `off` and the Meals tab
// printed `withGoal`, one tap apart, and neither said which.
ok(withGoal.macros.kcal !== off.macros.kcal, 'the goal-date plan gives a different figure from the goal enum, which is why sharing it matters');
/* ── and the two screens now compute one number ────────────────────────── */
// `buildPlan` is what the Meals tab scales its meals to; `dayTarget` is what
// the Food Log prints. Same inputs, same block, field for field.
const sameInputs = (over = {}) => {
    const i = base(over);
    const energyPlan = (0, goalEnergy_1.energyPlanFor)({
        goal: i.weightGoal,
        weightSeries: i.weightSeries,
        tdeeKcal: (0, nutrition_1.maintenanceFor)({ weightKg: i.weightKg, bodyFatPct: i.bodyFatPct, activity: i.activity }).tdee,
        nowMs: i.nowMs,
    });
    const plan = (0, meals_1.buildPlan)({
        id: 'c8f2a1d4-0000-4000-8000-000000000001',
        weightKg: i.weightKg, bodyFatPct: i.bodyFatPct, activity: i.activity,
        goal: i.goal, diet: i.diet, mealsPerDay: 4, avoid: [],
        coachAdjust: (0, dayTarget_1.dayAdjust)(i.coachAdjust, i.cycleKcalDelta ?? 0),
        energyPlan,
    });
    return { mine: (0, dayTarget_1.dayTarget)(i).macros, theirs: plan.target };
};
for (const [name, over] of [
    ['a plain fat-loss day', {}],
    ['a member with a target weight and a date', { weightGoal: goal }],
    ['a training day', { cycleKcalDelta: 250 }],
    ['a rest day under a coach adjust', { cycleKcalDelta: -250, coachAdjust: { kcalDelta: -200, proteinDelta: 15 } }],
    ['a keto member chasing their date', { diet: 'keto', weightGoal: goal, cycleKcalDelta: 250 }],
]) {
    const { mine, theirs } = sameInputs(over);
    eq(mine.kcal, theirs.kcal, `${name}: the two screens agree on calories`);
    eq(mine.protein, theirs.protein, `${name}: and on protein`);
    eq(mine.carbs, theirs.carbs, `${name}: and on carbs`);
    eq(mine.fat, theirs.fat, `${name}: and on fat`);
}
// And the shared function is genuinely the one doing the work: bypassing the
// energy plan reproduces the OLD Food Log figure, which differs. If this ever
// stops differing the fixture has gone flat and the test above proves nothing.
const oldWay = (0, nutrition_1.macrosFor)({ weightKg: 92, bodyFatPct: 26, activity: 1.45, goal: 'fatloss', diet: 'meat' });
ok(oldWay.kcal !== (0, dayTarget_1.dayTarget)(base({ weightGoal: goal })).macros.kcal, 'the old Food Log sum and the shared one are still different numbers');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('dayTarget: ok');
