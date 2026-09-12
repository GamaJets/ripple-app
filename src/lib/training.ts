// Warm-up ramps & deload guidance (client roadmap #8). Pure helpers over the
// working weight and the workout log so they unit-test cleanly and drive both
// the guided session (warm-ups) and the Train tab (deload nudge).
import type { WorkoutEntry } from './mockData';
import { weekStartIso } from './weekStart';
import { todayISO } from './bodyFigures';


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
    // The LOCAL calendar day, matching the week it is being counted into.
    // `toISOString().slice(0, 10)` is the UTC day, and mixing the two is not a
    // harmless inconsistency: `weekStartIso` opens the week at local midnight,
    // so for a member in Auckland every session after 1pm was filed under
    // tomorrow's UTC date. A Monday evening and a Tuesday evening session then
    // shared one date and counted as ONE training day, and a member training
    // five evenings a week could sit at two or three days by this count and
    // never be told a deload was due. `todayISO` is the local day and its own
    // header says a string slice is not it.
    (counts[wk] ||= new Set()).add(todayISO(new Date(ts)));
  }
  // Walk back week by week from LAST week (skip the current, partial week).
  //
  // A local CALENDAR step, not 604,800,000 ms. The comment on `weekKey` above
  // makes this exact argument and then fixes only the key — the cursor kept
  // stepping by fixed milliseconds, which is the same bug one line further on:
  //
  //   · autumn. `now` is Sat 23:30 after a fall-back, so `now − 168h` lands on
  //     SUNDAY 00:30 — inside the CURRENT week, the one this loop exists to
  //     skip. The first bucket read is the partial week, which has too few days,
  //     and the walk breaks immediately. Thirteen weeks of accumulated fatigue
  //     reported as "0 consecutive hard weeks".
  //   · spring. `now` is Sun 00:30 after a spring-forward, so `now − 168h`
  //     lands on Sat 23:30 of the week before — and the week in between is
  //     never visited at all. A member who has just taken a deload is told
  //     twelve straight hard weeks and offered another.
  //
  // Anchored at local NOON so that an hour moving in either direction cannot
  // cross a day boundary, which is what `stepBack` in src/lib/streaks.ts does
  // and for the same reason.
  const cursor = new Date(now);
  cursor.setHours(12, 0, 0, 0);
  cursor.setDate(cursor.getDate() - 7);
  let hard = 0;
  for (let i = 0; i < 26; i++) {
    const wk = weekKey(cursor.getTime());
    const days = counts[wk] ? counts[wk].size : 0;
    if (days >= 3) hard++; else break;
    cursor.setDate(cursor.getDate() - 7);
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
