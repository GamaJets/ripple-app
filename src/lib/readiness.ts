// Training readiness — a simple, transparent 0–100 score from the data the app
// already has: recent sleep, hydration, and short-term training load. Higher =
// better recovered. Pure function so it unit-tests and ships over-the-air; when
// HealthKit/wearable HRV lands it can feed in as a fourth signal.
export type ReadinessTone = 'good' | 'moderate' | 'low';

export interface Readiness {
  score: number;        // 0..100
  label: string;        // short status
  tip: string;          // one-line guidance
  tone: ReadinessTone;
}

export interface ReadinessInput {
  /** Average of recent nights. **null means none logged**, which is not zero. */
  avgSleepHours: number | null;
  /** 0..1 (cups / goal today). null means hydration is not being tracked. */
  hydrationPct: number | null;
  workoutsLast2Days: number;  // training load proxy
}

/**
 * The score, or **null when there is nothing to score from**.
 *
 * Sleep is half the scale. Without it there is no readiness, and the arithmetic
 * that treats its absence as zero produces a specific, wrong, and quite
 * alarming claim: a brand-new account scores 0 sleep + 0 hydration + 20 rest =
 * 20, which is 'Under-recovered', and the home screen tells somebody who has
 * logged nothing at all to take a rest day.
 *
 * That is what it did. The Readiness hero above the card already showed a dash
 * and said "Log a night of sleep to see your readiness" — but the card beside
 * it read the fabricated 20 and asserted a physiological state from it. Two
 * elements, one screen, opposite claims, and only one of them honest.
 *
 * Hydration is different: null there means "not tracked", so the remaining
 * signals are rescaled rather than being docked 30 points for a number nobody
 * asked the user for.
 */
export function readinessScore(i: ReadinessInput): Readiness | null {
  if (i.avgSleepHours == null || !(i.avgSleepHours > 0)) return null;

  const sleep = Math.max(0, Math.min(1, i.avgSleepHours / 8)) * 50;             // up to 50
  const rest = Math.max(0, 20 - Math.max(0, (i.workoutsLast2Days || 0) - 1) * 10); // 0–1 sessions = 20, 2 = 10, 3+ = 0

  // Untracked hydration is not dehydration. Score the signals we have and
  // rescale to 100, rather than capping everyone who ignores the water tracker
  // at 70 and calling them under-recovered for it.
  const pct = i.hydrationPct;
  const tracked = pct != null;
  const hydration = pct != null ? Math.max(0, Math.min(1, pct)) * 30 : 0;
  const raw = sleep + rest + hydration;
  const outOf = tracked ? 100 : 70;
  const score = Math.round((raw / outOf) * 100);

  let tone: ReadinessTone, label: string, tip: string;
  if (score >= 75) {
    tone = 'good'; label = 'Well recovered';
    tip = 'Great day to push — aim for a PR or add a little load.';
  } else if (score >= 50) {
    tone = 'moderate'; label = 'Moderately recovered';
    tip = 'Train as planned, but listen to your body and don’t force it.';
  } else {
    tone = 'low'; label = 'Under-recovered';
    tip = 'Prioritise sleep, water and a lighter session or rest today.';
  }
  return { score, label, tip, tone };
}
