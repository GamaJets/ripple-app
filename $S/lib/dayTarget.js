"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dayTarget = dayTarget;
exports.dayAdjust = dayAdjust;
// ONE calorie and macro target for the day, for every screen that shows one.
//
// ── What was wrong ─────────────────────────────────────────────────────────
//
// The Meals tab and the Food Log are one tap apart and both print a target and
// a "calories left" off it. They computed it two different ways.
//
// `app/(client)/foodlog.tsx` built its own from
// `macrosFor({ weightKg, bodyFatPct, activity, goal, diet })` plus the coach's
// standing adjust, and nothing else. `app/(client)/nutrition.tsx` passed
// `energyPlan` and a day-type delta into the same `macrosFor`, which is where
// the goal-date plan takes over from the goal enum entirely — see
// `planKcal` in ./goalEnergy.ts. So a member with a target weight and a date,
// or on a Training day, read two different figures for the same day on two
// screens, with nothing on either saying which was which.
//
// The Meals tab's own comment already claimed the sum was shared: "One sum,
// shared with the Food Log, so the two cannot drift apart again". The SUM was
// shared. The target it is subtracted from was not, and that is the number.
//
// ── Why this is a function and not a provider ──────────────────────────────
//
// Everything here is arithmetic over values both screens already hold, so it
// stays pure and testable without a device — the rule at the top of every
// src/lib file. What it must NOT do is invent an input: a member with no body
// on the account has no target, and this returns null rather than the 70 kg /
// 20% placeholder that `useClientData` was emphatic about removing.
const nutrition_1 = require("./nutrition");
const goalEnergy_1 = require("./goalEnergy");
/**
 * The day's target, or null when there is no body to scale to.
 *
 * The order matters and is the order `app/(client)/nutrition.tsx` established:
 * maintenance, then the goal-date plan, then `macrosFor` WITH that plan on the
 * input, then the coach's adjust and the day type on top. `energyPlan` rides on
 * the input object rather than being applied afterwards because `macrosFor`
 * consults it for protein as well as calories — a member in a genuine deficit
 * gets the deficit protein floor, and applying the delta afterwards would have
 * missed it.
 */
function dayTarget(i) {
    if (i.weightKg == null || i.bodyFatPct == null)
        return null;
    const body = { weightKg: i.weightKg, bodyFatPct: i.bodyFatPct, activity: i.activity };
    const energyPlan = (0, goalEnergy_1.energyPlanFor)({
        goal: i.weightGoal,
        weightSeries: i.weightSeries,
        tdeeKcal: (0, nutrition_1.maintenanceFor)(body).tdee,
        nowMs: i.nowMs,
    });
    const adjust = dayAdjust(i.coachAdjust, i.cycleKcalDelta ?? 0);
    const macros = (0, nutrition_1.applyCoachAdjust)((0, nutrition_1.macrosFor)({ ...body, goal: i.goal, diet: i.diet, energyPlan }), adjust);
    return { macros, energyPlan, adjust };
}
/**
 * The coach's adjust with the day-type delta folded into its calories.
 *
 * `undefined` when there is nothing to apply, because that is what
 * `applyCoachAdjust` reads as "leave it alone" — an object of zeroes is a
 * different thing to say and rounds differently.
 */
function dayAdjust(coach, cycleKcalDelta) {
    if (!coach && !cycleKcalDelta)
        return undefined;
    return {
        kcalDelta: (coach?.kcalDelta || 0) + cycleKcalDelta,
        proteinDelta: coach?.proteinDelta,
        carbDelta: coach?.carbDelta,
        fatDelta: coach?.fatDelta,
    };
}
