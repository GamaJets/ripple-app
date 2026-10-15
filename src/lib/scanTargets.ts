// What a confirmed InBody scan does to a client's daily targets.
//
// ── The formula ──────────────────────────────────────────────────────────────
//
//   lean mass (LBM) = the scan's own lean body mass when it printed one,
//                     otherwise weight × (1 − body fat % / 100)
//   BMR             = the scan's own BMR when it printed one (InBody measures
//                     it from fat-free mass), otherwise Katch–McArdle:
//                     370 + 21.6 × LBM
//   TDEE            = BMR × the client's activity factor
//   calories        = TDEE adjusted for the goal (./nutrition.ts GOAL_ADJ, or
//                     the dated plan from ./goalEnergy.ts when there is one)
//   protein         = g per kg of LEAN mass (1.8 tone · 2.0 muscle · 2.2 fat
//                     loss / any deficit), so a scan that moves lean mass moves
//                     protein even when the scale has not moved
//   fat, carbs      = unchanged split rules in macrosFor
//
// This file is pure and has no import from ./nutrition.ts, which imports it.
//
// ── Who gets to change the numbers ───────────────────────────────────────────
//
// A coach who has set a client's macros by hand (a kcal/protein/carb/fat
// delta, a written week, or a meal override) owns those targets. A scan never
// silently re-tunes them: `scanTuning` answers 'propose', and the screen sends
// the new suggestion to the coach instead (supabase/parts/3470).

/** The two figures an InBody printout measures that a formula otherwise guesses. */
export interface ScanBody {
  /** Lean body mass from the scan, kg. */
  leanMassKg?: number | null;
  /** Basal metabolic rate from the scan, kcal. */
  measuredBmr?: number | null;
}

/** InBody's BMR is printed off fat-free mass; anything outside this is a misread. */
export const BMR_RANGE = { min: 800, max: 4000 } as const;

export type BmrSource = 'scan' | 'katch-mcardle';
export type LeanSource = 'scan' | 'body-fat';

export function scanBody(s: { weightKg: number; bodyFatPct: number } & ScanBody): {
  lbm: number; bmr: number; bmrSource: BmrSource; leanSource: LeanSource;
} {
  const derived = s.weightKg * (1 - s.bodyFatPct / 100);
  const lm = s.leanMassKg;
  const leanOk = typeof lm === 'number' && Number.isFinite(lm) && lm > 0 && lm < s.weightKg;
  const lbm = leanOk ? (lm as number) : derived;
  const mb = s.measuredBmr;
  const bmrOk = typeof mb === 'number' && Number.isFinite(mb) && mb >= BMR_RANGE.min && mb <= BMR_RANGE.max;
  return {
    lbm,
    bmr: bmrOk ? (mb as number) : 370 + 21.6 * lbm,
    bmrSource: bmrOk ? 'scan' : 'katch-mcardle',
    leanSource: leanOk ? 'scan' : 'body-fat',
  };
}

/** Pick the two measured figures out of a scan's extracted metrics. */
export function scanBodyOf(metrics: { bmr?: number; leanMassKg?: number } | null | undefined): ScanBody {
  return { measuredBmr: metrics?.bmr ?? null, leanMassKg: metrics?.leanMassKg ?? null };
}

export interface TargetSet { kcal: number; protein: number; carbs: number; fat: number }

/** What the coach has set by hand, in the shape src/ui/coachNutrition.tsx reads. */
export interface CoachHold {
  kcalDelta?: number | null; proteinDelta?: number | null; carbDelta?: number | null; fatDelta?: number | null;
  plan?: unknown; mealOverride?: Record<string, unknown> | null;
}

export function coachHoldsTargets(a: CoachHold | null | undefined): boolean {
  if (!a) return false;
  if (a.kcalDelta || a.proteinDelta || a.carbDelta || a.fatDelta) return true;
  if (a.plan) return true;
  return !!a.mealOverride && Object.keys(a.mealOverride).length > 0;
}

export type Tuning =
  | { kind: 'unchanged'; after: TargetSet }
  | { kind: 'apply'; before: TargetSet | null; after: TargetSet; dKcal: number; dProtein: number }
  | { kind: 'propose'; before: TargetSet | null; after: TargetSet; dKcal: number; dProtein: number };

/**
 * Whether a new scan's targets go straight onto the plan or to the coach.
 * Changes under 5 kcal and 2 g protein are noise and say 'unchanged'.
 */
export function scanTuning(before: TargetSet | null, after: TargetSet, coach: CoachHold | null | undefined): Tuning {
  const dKcal = before ? after.kcal - before.kcal : 0;
  const dProtein = before ? after.protein - before.protein : 0;
  if (before && Math.abs(dKcal) < 5 && Math.abs(dProtein) < 2) return { kind: 'unchanged', after };
  return { kind: coachHoldsTargets(coach) ? 'propose' : 'apply', before, after, dKcal, dProtein };
}

/** The newest scan of a list in any order (ISO dates compare as strings). */
export function newestScan<T extends { takenAt: string }>(scans: readonly T[]): T | null {
  let best: T | null = null;
  for (const x of scans) if (!best || x.takenAt > best.takenAt) best = x;
  return best;
}
