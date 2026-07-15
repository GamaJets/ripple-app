// ── Nutrition engine ─────────────────────────────────────────────────────────
// Ported verbatim from the validated prototype. Pure functions — no I/O,
// trivially unit-testable, identical on client and server.
import type { BodyStats, Macros, Goal, Diet } from './types';

export const GOAL_ADJ: Record<Goal, number> = {
  fatloss: -0.20,
  tone: -0.08,
  muscle: +0.12,
};

/** Katch–McArdle BMR from lean body mass, goal-adjusted TDEE, macro split. */
export function macrosFor(s: BodyStats): Macros {
  const lbm = s.weightKg * (1 - s.bodyFatPct / 100);
  const bmr = 370 + 21.6 * lbm;
  const tdee = bmr * s.activity;
  const kcal = Math.round((tdee * (1 + GOAL_ADJ[s.goal])) / 10) * 10;

  const proteinPerKg = s.goal === 'muscle' ? 2.0 : s.goal === 'fatloss' ? 2.2 : 1.8;
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
