// Warm-up ramps & deload guidance (client roadmap #8). Pure helpers over the
// working weight and the workout log so they unit-test cleanly and drive both
// the guided session (warm-ups) and the Train tab (deload nudge).
import type { WorkoutEntry } from './mockData';
import { weekStartIso } from './weekStart';

const DAY = 86_400_000;

export interface WarmSet { kg: number; reps: number; label: string }

// A short ramp to the working weight. Skipped for light/bodyweight work.
export function warmupSets(workingKg: number): WarmSet[] {
  if (!workingKg || workingKg < 30) return [];
  const round = (n: number) => Math.max(20, Math.round(n / 2.5) * 2.5);
  return [
    { kg: round(workingKg * 0.4), reps: 8, label: 'Warm-up 1' },
    { kg: round(workingKg * 0.6), reps: 5, label: 'Warm-up 2' },
    { kg: round(workingKg * 0.85), reps: 3, label: 'Warm-up 3' },
  ];
}

// A key for grouping training weeks: the local date the week opened on, which
// is what src/lib/weekStart.ts decides. Never displayed — it is compared with
// itself — so all it has to do is change exactly once a week.
//
// It was `year + Math.floor(weekStart / 7 days)`, and that only counts weeks if
// every week is exactly 604,800,000 ms long. Two of them a year are not, so on
// a clocks-change week the floor could land on the neighbouring bucket and fold
// two weeks of training into one — which reads as a deload nobody took.
function weekKey(ts: number): string {
  return weekStartIso(ts);
}

export interface DeloadInfo { due: boolean; hardWeeks: number; reason: string }

// Deload = accumulated fatigue. Counts consecutive recent weeks (ending last
// week) with >= 3 training days and no light week; suggests a deload after 6.
export function deloadCheck(log: WorkoutEntry[], now: number = Date.now(), threshold = 6): DeloadInfo {
  const counts: Record<string, Set<string>> = {};
  for (const e of log) {
    const ts = Date.parse(e.t); if (isNaN(ts)) continue;
    const wk = weekKey(ts);
    (counts[wk] ||= new Set()).add(new Date(ts).toISOString().slice(0, 10));
  }
  // Walk back week by week from LAST week (skip the current, partial week).
  let cursor = now - 7 * DAY;
  let hard = 0;
  for (let i = 0; i < 26; i++) {
    const wk = weekKey(cursor);
    const days = counts[wk] ? counts[wk].size : 0;
    if (days >= 3) hard++; else break;
    cursor -= 7 * DAY;
  }
  const due = hard >= threshold;
  return {
    due,
    hardWeeks: hard,
    reason: due
      ? `${hard} straight weeks of solid training — a lighter week now lets your body adapt and come back stronger.`
      : `${hard} consecutive hard week${hard === 1 ? '' : 's'}.`,
  };
}
