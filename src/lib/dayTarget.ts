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
import { applyCoachAdjust, macrosFor, maintenanceFor, type CoachAdjust } from './nutrition';
import { energyPlanFor, type EnergyPlan } from './goalEnergy';
import type { GoalTarget } from './goalTargets';
import type { Point } from './goalTargets';
import type { Diet, Goal, Macros } from './types';

/** Everything the day's target is worked out from, in one shape both screens
 *  can fill in from what they already read. */
export interface DayTargetInput {
  /** From `useClientData`. Null until there is a scan or a typed figure, and
   *  null is why the answer can be null. */
  weightKg: number | null;
  bodyFatPct: number | null;
  activity: number;
  goal: Goal;
  diet: Diet;
  /**
   * The coach's standing adjustment, or null. Null under solo coaching, which
   * is not the same as an adjust of zero: a member with no coach must not
   * carry a former coach's delta.
   */
  coachAdjust: CoachAdjust | null;
  /**
   * Calories added or removed for the day type the member has selected —
   * Training, Rest, Off. Zero on any screen that does not offer the control,
   * which is the same as the Off day the picker starts on.
   */
  cycleKcalDelta?: number;
  /** Their open weight goal, from `useGoalTracker`. Null when they have none. */
  weightGoal: GoalTarget | null;
  /** Their weigh-ins and scans, from `useClientData().weightSeries`. */
  weightSeries: readonly Point[];
  /** `Date.now()`, passed in so this stays testable. */
  nowMs: number;
}

export interface DayTarget {
  /** The macros the day is planned to. */
  macros: Macros;
  /**
   * How the calorie figure was arrived at, so a screen can say. 'derived' is
   * the member's own target weight and date; 'enum' is their goal setting.
   */
  energyPlan: EnergyPlan;
  /** The coach adjust and day-type delta, folded, exactly as it was applied. */
  adjust: CoachAdjust | undefined;
}

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
export function dayTarget(i: DayTargetInput): DayTarget | null {
  if (i.weightKg == null || i.bodyFatPct == null) return null;
  const body = { weightKg: i.weightKg, bodyFatPct: i.bodyFatPct, activity: i.activity };
  const energyPlan = energyPlanFor({
    goal: i.weightGoal,
    weightSeries: i.weightSeries,
    tdeeKcal: maintenanceFor(body).tdee,
    nowMs: i.nowMs,
  });
  const adjust = dayAdjust(i.coachAdjust, i.cycleKcalDelta ?? 0);
  const macros = applyCoachAdjust(
    macrosFor({ ...body, goal: i.goal, diet: i.diet, energyPlan }),
    adjust,
  );
  return { macros, energyPlan, adjust };
}

/**
 * The coach's adjust with the day-type delta folded into its calories.
 *
 * `undefined` when there is nothing to apply, because that is what
 * `applyCoachAdjust` reads as "leave it alone" — an object of zeroes is a
 * different thing to say and rounds differently.
 */
export function dayAdjust(coach: CoachAdjust | null, cycleKcalDelta: number): CoachAdjust | undefined {
  if (!coach && !cycleKcalDelta) return undefined;
  return {
    kcalDelta: (coach?.kcalDelta || 0) + cycleKcalDelta,
    proteinDelta: coach?.proteinDelta,
    carbDelta: coach?.carbDelta,
    fatDelta: coach?.fatDelta,
  };
}
