// ── Nutrition engine ─────────────────────────────────────────────────────────
// Ported verbatim from the validated prototype. Pure functions — no I/O,
// trivially unit-testable, identical on client and server.
import type { BodyStats, Macros, Goal, Diet } from './types';
import { planKcal, type EnergyPlan } from './goalEnergy';

export const GOAL_ADJ: Record<Goal, number> = {
  fatloss: -0.20,
  tone: -0.08,
  muscle: +0.12,
};

/**
 * Grams of protein per kg of lean mass held in a deficit, whatever the client
 * calls their goal.
 *
 * The same 2.2 the 'fatloss' enum already used, promoted to a floor. See the
 * note in macrosFor: a 'tone' client whose target date puts them in a real
 * deficit was being fed 1.8, which is the number for somebody who is not
 * dieting.
 */
export const DEFICIT_PROTEIN_PER_KG_LBM = 2.2;

/**
 * Katch–McArdle: lean mass, resting burn, and maintenance calories.
 *
 * Split out of macrosFor because the goal-driven target in ./goalEnergy.ts has
 * to know maintenance before it can decide how far below it to sit, and a
 * second copy of this formula living there would be one more place for the two
 * to drift apart.
 */
export function maintenanceFor(s: Pick<BodyStats, 'weightKg' | 'bodyFatPct' | 'activity'>): { lbm: number; bmr: number; tdee: number } {
  const lbm = s.weightKg * (1 - s.bodyFatPct / 100);
  const bmr = 370 + 21.6 * lbm;
  return { lbm, bmr, tdee: bmr * s.activity };
}

/**
 * Katch–McArdle BMR from lean body mass, goal-adjusted TDEE, macro split.
 *
 * `energyPlan` is TF-29. Without it — and with an 'enum' plan, which is what
 * ./goalEnergy.ts returns when the client has no target, no date or no
 * readings — every number below is exactly what it has always been. The goal
 * enum is a three-way switch with no date in it, so it gave a client aiming to
 * lose 6 kg in twelve weeks and one aiming to lose 6 kg in forty the identical
 * target; a derived plan replaces the multiplier with the rate their own date
 * implies, already clamped to something safe by the time it arrives here.
 *
 * It is an optional property on the stats object rather than a second argument
 * so that it survives the trip through `buildPlan` in ./meals.ts, which passes
 * its input straight down — otherwise the meal plan and the target it is
 * scaled to would have been built from two different calorie figures.
 */
export function macrosFor(s: BodyStats & { energyPlan?: EnergyPlan | null }): Macros {
  const { lbm, bmr, tdee } = maintenanceFor(s);
  const plan = s.energyPlan && s.energyPlan.kind === 'derived' ? s.energyPlan : null;
  const kcal = plan
    ? planKcal(tdee, plan.plannedRateKg).kcal
    : Math.round((tdee * (1 + GOAL_ADJ[s.goal])) / 10) * 10;

  // Protein is per kg of LEAN mass, so it never moved with calories — but the
  // goal it is chosen by did, and that was the hole. A client whose stated goal
  // is 'tone' (1.8 g/kg) but whose target weight and date put them in a genuine
  // deficit needs the deficit figure: protein is what decides whether the
  // weight coming off is fat or the muscle the whole plan is meant to keep.
  // Raising it here can never lower the number, only hold it up.
  const enumPerKg = s.goal === 'muscle' ? 2.0 : s.goal === 'fatloss' ? 2.2 : 1.8;
  const proteinPerKg = plan && plan.kcalDelta < 0 ? Math.max(enumPerKg, DEFICIT_PROTEIN_PER_KG_LBM) : enumPerKg;
  const protein = Math.round(proteinPerKg * lbm);

  const fatPct = s.diet === 'keto' ? 0.65 : s.diet === 'paleo' ? 0.40 : 0.27;
  const fat = Math.round((kcal * fatPct) / 9);

  const carbs = Math.max(20, Math.round((kcal - protein * 4 - fat * 9) / 4));

  return {
    kcal,
    protein,
    carbs,
    fat,
    lbm: +lbm.toFixed(1),
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
  };
}

export interface CoachAdjust { kcalDelta?: number; proteinDelta?: number; carbDelta?: number; fatDelta?: number }
/** Layer a coach macro adjustment on a computed target (kcal + protein deltas; carbs re-derived). */
export function applyCoachAdjust(m: Macros, a?: CoachAdjust): Macros {
  if (!a || (!a.kcalDelta && !a.proteinDelta && !a.carbDelta && !a.fatDelta)) return m;
  const kcal = Math.max(1000, m.kcal + (a.kcalDelta || 0));
  const protein = Math.max(0, m.protein + (a.proteinDelta || 0));
  const fat = Math.max(0, m.fat + (a.fatDelta || 0));
  const carbs = (a.carbDelta != null && a.carbDelta !== 0) ? Math.max(20, m.carbs + a.carbDelta) : Math.max(20, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { ...m, kcal, protein, carbs, fat };
}

/** Chronologically sort a scan series and return the values used by charts. */
export function seriesFromScans<T extends { takenAt: string }>(scans: T[]): T[] {
  return [...scans].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));
}

export const DIET_LABEL: Record<Diet, string> = {
  meat: 'Meat / Omnivore',
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  paleo: 'Paleo',
  keto: 'Keto',
};

// ── Meal-plan generator ──────────────────────────────────────────────────────
export interface MealItem { name: string; slot: Slot; k: number; p: number; c: number; f: number; }
export interface PlannedMeal extends MealItem { servings: number; K: number; P: number; C: number; F: number; }
type Slot = 'Breakfast' | 'Lunch' | 'Dinner' | 'Snack';

// A representative food library (extend freely; the generator is diet-agnostic).
export const MEAL_DB: Record<Diet, MealItem[]> = {
  meat: [
    { name: 'Egg white omelette + oats & berries', slot: 'Breakfast', k: 420, p: 34, c: 48, f: 10 },
    { name: 'Grilled chicken, rice & broccoli', slot: 'Lunch', k: 560, p: 48, c: 62, f: 11 },
    { name: 'Salmon, sweet potato & asparagus', slot: 'Dinner', k: 590, p: 42, c: 48, f: 22 },
    { name: 'Whey shake & banana', slot: 'Snack', k: 280, p: 30, c: 34, f: 3 },
  ],
  vegetarian: [
    { name: '3-egg omelette, feta & spinach', slot: 'Breakfast', k: 430, p: 28, c: 12, f: 28 },
    { name: 'Halloumi & quinoa salad', slot: 'Lunch', k: 540, p: 26, c: 44, f: 26 },
    { name: 'Eggplant parmigiana & lentil pasta', slot: 'Dinner', k: 590, p: 32, c: 62, f: 22 },
    { name: 'Greek yogurt & almonds', slot: 'Snack', k: 260, p: 24, c: 22, f: 10 },
  ],
  vegan: [
    { name: 'Tofu scramble & rye toast', slot: 'Breakfast', k: 410, p: 26, c: 44, f: 14 },
    { name: 'Lentil & quinoa power bowl', slot: 'Lunch', k: 540, p: 28, c: 74, f: 14 },
    { name: 'Tempeh stir-fry with soba noodles', slot: 'Dinner', k: 580, p: 34, c: 66, f: 18 },
    { name: 'Pea-protein shake & dates', slot: 'Snack', k: 270, p: 26, c: 34, f: 3 },
  ],
  paleo: [
    { name: 'Eggs, bacon & sautéed greens', slot: 'Breakfast', k: 450, p: 30, c: 8, f: 32 },
    { name: 'Grilled chicken cobb (no dairy)', slot: 'Lunch', k: 540, p: 44, c: 18, f: 32 },
    { name: 'Herb-crusted cod & roast vegetables', slot: 'Dinner', k: 520, p: 42, c: 30, f: 24 },
    { name: 'Beef jerky & macadamias', slot: 'Snack', k: 280, p: 20, c: 8, f: 19 },
  ],
  keto: [
    { name: 'Avocado baked eggs', slot: 'Breakfast', k: 430, p: 22, c: 9, f: 35 },
    { name: 'Chicken caesar (no croutons)', slot: 'Lunch', k: 520, p: 42, c: 10, f: 34 },
    { name: 'Ribeye & garlic butter greens', slot: 'Dinner', k: 640, p: 44, c: 8, f: 49 },
    { name: 'Macadamias & cheese cubes', slot: 'Snack', k: 290, p: 12, c: 5, f: 25 },
  ],
};

const SLOTS: Record<number, Slot[]> = {
  3: ['Breakfast', 'Lunch', 'Dinner'],
  4: ['Breakfast', 'Lunch', 'Snack', 'Dinner'],
  5: ['Breakfast', 'Snack', 'Lunch', 'Snack', 'Dinner'],
};

/** Build a day's meals scaled toward the client's calorie target. */
export function buildMealPlan(
  stats: BodyStats,
  mealsPerDay: 3 | 4 | 5,
  seed = 0
): { targets: Macros; meals: PlannedMeal[]; total: { K: number; P: number; C: number; F: number } } {
  const targets = macrosFor(stats);
  const db = MEAL_DB[stats.diet];
  const slots = SLOTS[mealsPerDay] ?? SLOTS[4];

  const picks: MealItem[] = slots.map((slot, i) => {
    const opts = db.filter((m) => m.slot === slot);
    return opts[(seed + i) % opts.length] ?? db[0];
  });

  const base = picks.reduce((a, m) => a + m.k, 0) || 1;
  const scale = targets.kcal / base;

  const meals: PlannedMeal[] = picks.map((m) => {
    const servings = Math.max(0.5, Math.round(scale * 4) / 4);
    return { ...m, servings, K: Math.round(m.k * servings), P: Math.round(m.p * servings), C: Math.round(m.c * servings), F: Math.round(m.f * servings) };
  });

  const total = {
    K: meals.reduce((a, m) => a + m.K, 0),
    P: meals.reduce((a, m) => a + m.P, 0),
    C: meals.reduce((a, m) => a + m.C, 0),
    F: meals.reduce((a, m) => a + m.F, 0),
  };
  return { targets, meals, total };
}

/**
 * How many calories are left today, computed in ONE place.
 *
 * Two screens answered this question with two different sums. The Food Log did
 * `(target + burned) - eaten`; the Meals tab did `Math.max(0, target - eaten)`.
 * On the same day with 1,088 kcal burned, one said 3,948 remaining and the
 * other said 2,860 — reported twice, as "calories left doesn't match the
 * calories on the other tab" and "these numbers don't match the meal tab".
 *
 * Two separate faults, and the clamp is the worse of them: `max(0, …)` meant
 * the Meals tab could never say a person was over their target. It showed zero
 * left and stopped, which reads as "you are exactly on target" at the precise
 * moment that is untrue.
 *
 * Burned calories count. That is the same choice the Food Log already made and
 * the one a person expects when their watch is feeding the app; what mattered
 * was that both screens make it.
 */
export interface CaloriesLeft {
  /** target + burned − eaten. Negative means over, and is meant to be shown. */
  net: number;
  /** How far over, or 0. Convenience for a screen that words the two cases. */
  over: number;
  target: number;
  eaten: number;
  burned: number;
}

export function caloriesLeft(
  targetKcal: number,
  eatenKcal: number,
  burnedKcal: number = 0,
): CaloriesLeft {
  const target = Math.max(0, Math.round(targetKcal || 0));
  const eaten = Math.max(0, Math.round(eatenKcal || 0));
  const burned = Math.max(0, Math.round(burnedKcal || 0));
  const net = target + burned - eaten;
  return { net, over: net < 0 ? -net : 0, target, eaten, burned };
}
