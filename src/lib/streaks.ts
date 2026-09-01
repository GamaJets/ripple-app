// ── Streaks, personal records & weekly stats ─────────────────────────────────
// Pure functions over the workout log. The log entry shape (from mockData):
//   { t: ISO string, exercise: string, sets?: [reps, weight][], cardio?, kcal? }
// Everything here is deterministic so it unit-tests cleanly and the dashboard
// can light up confetti on a new milestone.
import type { WorkoutEntry } from './mockData';
import { isBodyweightSet, setLoadKg, entryTonnage, type BodyweightHistory } from './bodyweightSets';

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

export interface FrozenStreak { streak: number; freezesUsed: number; frozen: string[] }
/**
 * Streak "freeze" budget. The user earns one freeze for every 10 total training
 * days on record, capped at 2 — a small buffer so an occasional missed day does
 * not wipe out weeks of consistency (mirrors the Duolingo-style streak freeze).
 * Pure + derived from the log, so no separate persistence can drift out of sync.
 */
export function freezeBudget(log: WorkoutEntry[]): number {
  return Math.min(2, Math.floor(activeDays(log).length / 10));
}
/**
 * Current streak, allowing up to `freezes` missed days to be bridged inside the
 * active chain. Returns the (protected) streak length plus which gap days a
 * freeze covered. A freeze is only spent when there is an older active day still
 * to chain to — trailing gaps never waste one. Mirrors currentStreak's day math.
 */
export function currentStreakFrozen(log: WorkoutEntry[], freezes: number = 0, now: number = Date.now()): FrozenStreak {
  const daysArr = activeDays(log);
  if (daysArr.length === 0) return { streak: 0, freezesUsed: 0, frozen: [] };
  const days = new Set(daysArr);
  const minActive = Math.min(...daysArr.map((d) => Date.parse(d + 'T00:00:00')));
  const kOf = (ts: number) => dayKey(new Date(ts).toISOString());
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  let cursor = midnight.getTime();
  if (!days.has(kOf(cursor))) cursor -= DAY;
  let streak = 0, used = 0, budget = Math.max(0, freezes);
  const frozen: string[] = [];
  while (true) {
    if (days.has(kOf(cursor))) { streak++; cursor -= DAY; continue; }
    if (streak === 0) break;          // no active day anchoring the chain yet
    if (budget <= 0) break;           // out of freezes — chain ends here
    if (cursor <= minActive) break;   // nothing older to reach — don't waste a freeze
    budget--; used++; frozen.push(kOf(cursor)); cursor -= DAY;
  }
  return { streak, freezesUsed: used, frozen };
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

export interface PR {
  exercise: string;
  /** The kilograms that actually moved. On a bodyweight set that is the
   *  person's weight on the day plus anything added, not the added part alone —
   *  a record has to be the load, or the board would rank a belted pull-up
   *  below an empty bar. */
  weight: number;
  reps: number;
  est1RM: number;
  at: string;
  /** True when the record set was the person's own bodyweight. Carried so a
   *  row can read "bodyweight +20 kg × 8" instead of presenting a figure that
   *  is partly derived from a weigh-in as though it had been on a bar. */
  bodyweight?: boolean;
  /** Kilograms hung, belted or held on top of the body. Only meaningful with
   *  `bodyweight`; 0 on a plain set. */
  addedKg?: number;
}

/** Epley estimated 1-rep-max. */
export const est1RM = (weight: number, reps: number) => Math.round(weight * (1 + reps / 30));

/**
 * Best set (by estimated 1RM) for each exercise whose load is known.
 *
 * `history` is the member's own weight over time, and it is what lets a
 * bodyweight set onto this board at all. Without it a pull-up has no load, and
 * this function did what it had always done: skipped it, silently, so a
 * calisthenics member's board was empty. With it the set is priced at what they
 * weighed on or before that day (see src/lib/bodyweightSets.ts) and takes its
 * place beside the barbell lifts.
 *
 * Optional, and an absent history is NOT an error. Plenty of members have never
 * been scanned and never typed a weight, and for them a bodyweight set still
 * has no known load — it simply cannot be estimated from, and it belongs on the
 * reps board (`repRecords`) rather than being given an invented body here.
 */
export function personalRecords(log: WorkoutEntry[], history: BodyweightHistory = []): PR[] {
  const best = new Map<string, PR>();
  for (const e of log) {
    if (!e.sets) continue;
    for (let i = 0; i < e.sets.length; i++) {
      const [reps] = e.sets[i];
      if (!reps) continue;
      const weight = setLoadKg(e, i, e.sets[i], history, e.t);
      if (weight == null || weight <= 0) continue;
      const e1 = est1RM(weight, reps);
      const cur = best.get(e.exercise);
      if (!cur || e1 > cur.est1RM) best.set(e.exercise, {
        exercise: e.exercise, weight, reps, est1RM: e1, at: e.t,
        bodyweight: isBodyweightSet(e, i),
        addedKg: isBodyweightSet(e, i) ? Math.max(0, e.sets[i][1] || 0) : 0,
      });
    }
  }
  return [...best.values()].sort((a, b) => b.est1RM - a.est1RM);
}

/**
 * Was the given entry a personal record at the time it was logged?
 * Used to flag a fresh PR (and fire confetti) right after logging.
 */
export function isNewPR(log: WorkoutEntry[], entry: WorkoutEntry, history: BodyweightHistory = []): boolean {
  if (!entry.sets) return false;
  // One helper for both sides, so a bodyweight set cannot count towards the new
  // best while being skipped in the old one — which would make every pull-up
  // session a record the first time this learned to read them.
  const top = (e: WorkoutEntry) => Math.max(0, ...(e.sets ?? []).map((s, i) => {
    const w = setLoadKg(e, i, s, history, e.t);
    return w != null && s[0] ? est1RM(w, s[0]) : 0;
  }));
  const topNow = top(entry);
  if (topNow <= 0) return false;
  const prior = log.filter((e) => e !== entry && e.exercise === entry.exercise && e.sets);
  const priorBest = Math.max(0, ...prior.map(top));
  return topNow > priorBest;
}

export interface WeekStats {
  workouts: number;
  volumeKg: number;
  kcal: number;
  days: number;
  /** Bodyweight sets in the week whose load nobody has recorded, so they are
   *  not in `volumeKg`. Zero when the week's tonnage is whole. A screen that
   *  prints the tonnage without checking this is stating a total over a set it
   *  knows to be short — see src/lib/bodyweightSets.ts. */
  unpricedSets: number;
}

/**
 * Totals for the trailing 7 days. Volume = Σ reps × load across all sets.
 *
 * `history` is the member's weight over time; without it a bodyweight set has
 * no load and lands in `unpricedSets` rather than being counted as zero.
 */
export function weekStats(log: WorkoutEntry[], now: number = Date.now(), history: BodyweightHistory = []): WeekStats {
  const since = now - 7 * DAY;
  const recent = log.filter((e) => Date.parse(e.t) >= since);
  let volume = 0, kcal = 0, unpriced = 0;
  for (const e of recent) {
    kcal += e.kcal ?? 0;
    const t = entryTonnage(e, history);
    volume += t.kg;
    unpriced += t.unknownSets;
  }
  return {
    unpricedSets: unpriced,
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
