// ── Nutrition engine ─────────────────────────────────────────────────────────
// Ported verbatim from the validated prototype. Pure functions — no I/O,
// trivially unit-testable, identical on client and server.
import type { BodyStats, Macros, Goal, Diet } from './types';
import { planKcal, type EnergyPlan } from './goalEnergy';
import { num } from './format';

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
 * The clamp was the worse of the two: `max(0, …)` meant the Meals tab could
 * never say a person was over their target. It showed zero left and stopped,
 * which reads as "you are exactly on target" at the precise moment that is
 * untrue.
 *
 * ── Why burned calories are not added at all ─────────────────────────────
 *
 * Reconciling the two screens onto `target + burned - eaten` made them agree
 * on a number that was wrong. Reported as "these numbers don't make sense": a
 * 2,040 kcal target, nothing eaten, 1,276 kcal burned, and the screen offering
 * 3,316 kcal to eat — more than the whole day's target, before breakfast.
 *
 * The target is not a resting figure with exercise left to add on. macrosFor()
 * builds it from `bmr * activity`, goal-adjusted: the activity multiplier IS
 * the day's expected movement, already inside the 2,040. Adding a watch's
 * active calories on top counts every session twice, and on a fat-loss target
 * it hands back the entire deficit and then some.
 *
 * Adding only the EXCESS over what the multiplier budgeted was the next
 * attempt, and it was still wrong for the reader: "how can I have 2,425 kcal
 * remaining of 2,040?" A day's allowance that can exceed the day's target is
 * not a number anybody can act on, however defensible the arithmetic behind
 * it. So the allowance is simply `target - eaten`, and it can never exceed the
 * target.
 *
 * Burn is not discarded, it is DEMOTED — from the sum to the sentence
 * underneath, where it says whether the day was ordinary or genuinely bigger
 * than the target assumed (see caloriesNote). A client who trains far beyond
 * their usual week needs their activity level changed, or their coach's
 * adjustment, not a silent bump that quietly cancels their deficit on the days
 * they earned it.
 *
 * This is the same default Cronometer ships, and for the same reason: a target
 * built from an activity multiplier has already been paid.
 */
export interface CaloriesLeft {
  /** target − eaten. Negative means over, and is meant to be shown. */
  net: number;
  /** How far over, or 0. Convenience for a screen that words the two cases. */
  over: number;
  target: number;
  eaten: number;
  /** What the wearable measured. Shown, never spent. */
  burned: number;
  /** Whether `burned` is energy ABOVE rest or the WHOLE day including it.
   *  WHOOP publishes only the second; Oura only the first; Fitbit and Apple
   *  both. Comparing one against the other is a ~1,600 kcal mistake, so the
   *  quantity travels with the figure. */
  burnKind: BurnKind;
  /** The non-resting energy the target already assumed: tdee − bmr. */
  budgetedActive: number;
  /** burned − budgetedActive, floored at 0. How much bigger than usual the
   *  day was — context for the reader, not calories to eat. */
  extraBurned: number;
}

export type BurnKind = 'active' | 'total';

export function caloriesLeft(
  targetKcal: number,
  eatenKcal: number,
  burnedKcal: number = 0,
  budgetedActiveKcal: number = 0,
  burnKind: BurnKind = 'active',
): CaloriesLeft {
  const target = Math.max(0, Math.round(targetKcal || 0));
  const eaten = Math.max(0, Math.round(eatenKcal || 0));
  const burned = Math.max(0, Math.round(burnedKcal || 0));
  const budgetedActive = Math.max(0, Math.round(budgetedActiveKcal || 0));
  const extraBurned = Math.max(0, burned - budgetedActive);
  const net = target - eaten;
  return { net, over: net < 0 ? -net : 0, target, eaten, burned, burnKind, budgetedActive, extraBurned };
}

/**
 * The line under the hero figure, worded the same on every screen that shows
 * it.
 *
 * Naming the burn without saying what became of it is what made the old screen
 * unreadable: 1,276 kcal burned sat beside a number it had silently been added
 * to, with no way to tell. It is never added now, so the sentence says so —
 * and on a day that genuinely outran the target it says that too, which is the
 * signal a coach acts on.
 *
 * Title case, on request, with the ordinary exception for words under four
 * letters that are not doing any work — of, a, in. `kcal` stays lowercase
 * because it is a unit symbol and "Kcal" is not one.
 */
export function caloriesNote(cal: CaloriesLeft): string {
  // ── Sentence case, deliberately ──────────────────────────────────────────
  //
  // This is a SENTENCE, not a label. It was written in Title Case and pinned
  // that way by `coverage.test.ts`, so the client dashboard's first card read
  //
  //     "0 of 2,350 kcal Eaten · 2,648 kcal Burned All Day, Rest Included,
  //      97 More Than Your Activity Level Assumes."
  //
  // which is the failure mode `check:caps` explicitly refuses to cause:
  // over-capitalising body copy is a worse regression than the inconsistency
  // it is meant to fix, because a sentence in Title Case reads as shouted
  // rather than as tidy. Headings, labels and buttons take Title Case; running
  // prose does not, and this is running prose on the busiest screen in the app.
  const head = `${num(cal.eaten)} of ${num(cal.target)} kcal eaten`;
  if (!cal.burned) return head;
  // Say WHICH quantity. "1,309 burned" by mid-afternoon reads as a huge
  // training day when it is a WHOOP whole-day figure that is mostly the client
  // lying still, and somebody asked exactly that: where does it come from.
  const what = cal.burnKind === 'total'
    ? `${num(cal.burned)} kcal burned all day, rest included`
    : `${num(cal.burned)} active kcal burned`;
  // Not "above a usual day" — asked twice, "based on what exactly?", and the
  // honest answer was not in the sentence. It is measured against the ACTIVITY
  // LEVEL on the profile: that multiplier is what decides how much movement
  // the target pays for, and this is how far today has gone past it. Nothing
  // here knows what the client's actual recent days looked like, so it must
  // not claim to.
  const verdict = cal.extraBurned > 0
    ? `${num(cal.extraBurned)} more than your activity level assumes`
    : 'already in your target';
  return `${head} · ${what}, ${verdict}`;
}

/** The non-resting energy a target built from an activity multiplier assumed. */
export function budgetedActiveKcal(m: Pick<Macros, 'bmr' | 'tdee'>): number {
  return Math.max(0, Math.round((m.tdee || 0) - (m.bmr || 0)));
}

/**
 * The figure a wearable actually gave, paired with the budget it should be
 * compared against — active against the movement the multiplier bought, whole
 * day against the whole TDEE.
 *
 * Prefers active when both are known: it is the quantity a person means by
 * "calories burned", and comparing it is the smaller of the two numbers to get
 * wrong. Returns null when neither is known, so the caller shows no burn at
 * all rather than a zero standing in for a device that has not reported.
 */
export function dayBurn(
  m: Pick<Macros, 'bmr' | 'tdee'>,
  today: { activeKcal: number | null; totalKcal: number | null },
): { burned: number; budgeted: number; kind: BurnKind } | null {
  if (typeof today.activeKcal === 'number') {
    return { burned: today.activeKcal, budgeted: budgetedActiveKcal(m), kind: 'active' };
  }
  if (typeof today.totalKcal === 'number') {
    return { burned: today.totalKcal, budgeted: Math.max(0, Math.round(m.tdee || 0)), kind: 'total' };
  }
  return null;
}
