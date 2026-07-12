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
  avgSleepHours: number;      // avg of recent nights
  hydrationPct: number;       // 0..1 (cups / goal today)
  workoutsLast2Days: number;  // training load proxy
}

export function readinessScore(i: ReadinessInput): Readiness {
  const sleep = Math.max(0, Math.min(1, (i.avgSleepHours || 0) / 8)) * 50;      // up to 50
  const hydration = Math.max(0, Math.min(1, i.hydrationPct || 0)) * 30;         // up to 30
  const rest = Math.max(0, 20 - Math.max(0, (i.workoutsLast2Days || 0) - 1) * 10); // 0–1 sessions = 20, 2 = 10, 3+ = 0
  const score = Math.round(sleep + hydration + rest);

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
