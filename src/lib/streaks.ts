// ── Streaks, personal records & weekly stats ─────────────────────────────────
// Pure functions over the workout log. The log entry shape (from mockData):
//   { t: ISO string, exercise: string, sets?: [reps, weight][], cardio?, kcal? }
// Everything here is deterministic so it unit-tests cleanly and the dashboard
// can light up confetti on a new milestone.
import type { WorkoutEntry } from './mockData';

const DAY = 86_400_000;
// LOCAL calendar day (not UTC): an evening workout must count as today for the user even after its ISO timestamp rolls into tomorrow in UTC.
const dayKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Unique calendar days (YYYY-MM-DD) that have at least one workout, newest first. */
export function activeDays(log: WorkoutEntry[]): string[] {
  const set = new Set(log.map((e) => dayKey(e.t)));
  return [...set].sort((a, b) => b.localeCompare(a));
}

/**
 * Current streak = consecutive calendar days with a workout, counting back from
 * today (or yesterday, so a rest until this evening doesn't break it).
 */
export function currentStreak(log: WorkoutEntry[], now: number = Date.now()): number {
  const days = new Set(activeDays(log));
  if (days.size === 0) return 0;
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  let cursor = midnight.getTime();
  // If nothing today, allow the streak to be anchored at yesterday.
  if (!days.has(dayKey(new Date(cursor).toISOString()))) cursor -= DAY;
  let streak = 0;
  while (days.has(dayKey(new Date(cursor).toISOString()))) { streak++; cursor -= DAY; }
  return streak;
}

export interface StreakRisk { atRisk: boolean; streak: number; trainedToday: boolean }
/**
 * Retention signal: an active streak (>=2) that will break tonight because the
 * user trained yesterday but not yet today. Pure; mirrors currentStreak's day math.
 */
export function streakRisk(log: WorkoutEntry[], now: number = Date.now()): StreakRisk {
  const days = new Set(activeDays(log));
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const todayK = dayKey(new Date(midnight.getTime()).toISOString());
  const yestK = dayKey(new Date(midnight.getTime() - DAY).toISOString());
  const trainedToday = days.has(todayK);
  const streak = currentStreak(log, now);
  return { atRisk: !trainedToday && days.has(yestK) && streak >= 2, streak, trainedToday };
}

/** Longest run of consecutive active days anywhere in the history. */
export function longestStreak(log: WorkoutEntry[]): number {
  const days = activeDays(log).slice().sort(); // oldest first
  let best = 0, run = 0, prev = 0;
  for (const d of days) {
    const ts = Date.parse(d + 'T00:00:00Z');
    run = prev && ts - prev === DAY ? run + 1 : 1;
    if (run > best) best = run;
    prev = ts;
  }
  return best;
}

export interface PR { exercise: string; weight: number; reps: number; est1RM: number; at: string }

/** Epley estimated 1-rep-max. */
export const est1RM = (weight: number, reps: number) => Math.round(weight * (1 + reps / 30));

/** Best set (by estimated 1RM) for each exercise that logs weight × reps. */
export function personalRecords(log: WorkoutEntry[]): PR[] {
  const best = new Map<string, PR>();
  for (const e of log) {
    if (!e.sets) continue;
    for (const [reps, weight] of e.sets) {
      if (!weight || !reps) continue;
      const e1 = est1RM(weight, reps);
      const cur = best.get(e.exercise);
      if (!cur || e1 > cur.est1RM) best.set(e.exercise, { exercise: e.exercise, weight, reps, est1RM: e1, at: e.t });
    }
  }
  return [...best.values()].sort((a, b) => b.est1RM - a.est1RM);
}

/**
 * Was the given entry a personal record at the time it was logged?
 * Used to flag a fresh PR (and fire confetti) right after logging.
 */
export function isNewPR(log: WorkoutEntry[], entry: WorkoutEntry): boolean {
  if (!entry.sets) return false;
  const topNow = Math.max(...entry.sets.map(([r, w]) => (w && r ? est1RM(w, r) : 0)), 0);
  if (topNow <= 0) return false;
  const prior = log.filter((e) => e !== entry && e.exercise === entry.exercise && e.sets);
  const priorBest = Math.max(0, ...prior.flatMap((e) => e.sets!.map(([r, w]) => (w && r ? est1RM(w, r) : 0))));
  return topNow > priorBest;
}

export interface WeekStats { workouts: number; volumeKg: number; kcal: number; days: number }

/** Totals for the trailing 7 days. Volume = Σ reps × weight across all sets. */
export function weekStats(log: WorkoutEntry[], now: number = Date.now()): WeekStats {
  const since = now - 7 * DAY;
  const recent = log.filter((e) => Date.parse(e.t) >= since);
  let volume = 0, kcal = 0;
  for (const e of recent) {
    kcal += e.kcal ?? 0;
    if (e.sets) for (const [reps, weight] of e.sets) volume += (reps || 0) * (weight || 0);
  }
  return {
    workouts: recent.length,
    volumeKg: Math.round(volume),
    kcal: Math.round(kcal),
    days: new Set(recent.map((e) => dayKey(e.t))).size,
  };
}

/** A short, friendly milestone label for a streak count (for the confetti banner). */
export function streakMilestone(streak: number): string | null {
  if (streak >= 30) return `${streak}-day streak — unstoppable! 🔥`;
  if (streak >= 14) return `${streak}-day streak — two weeks strong! 🔥`;
  if (streak >= 7) return `${streak}-day streak — a full week! 🔥`;
  if (streak >= 3) return `${streak}-day streak — keep it rolling! 🔥`;
  return null;
}
