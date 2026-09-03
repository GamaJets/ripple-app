// ── Streaks, personal records & weekly stats ─────────────────────────────────
// Pure functions over the workout log. The log entry shape (from mockData):
//   { t: ISO string, exercise: string, sets?: [reps, weight][], cardio?, kcal? }
// Everything here is deterministic so it unit-tests cleanly and the dashboard
// can light up confetti on a new milestone.
import type { WorkoutEntry } from './mockData';
import { isBodyweightSet, setLoadKg, entryTonnage, type BodyweightHistory } from './bodyweightSets';
// The product's week anchor. Sunday, everywhere, for the reason that file's
// header gives: a week measured from a different place on two handsets puts the
// same seven sessions in different buckets.
import { startOfWeek } from './weekStart';
// A held set's first number is seconds, not reps. Epley over it returns a
// strength figure computed from a stopwatch, so this board leaves holds alone
// and src/lib/timedSets.ts keeps the record they do belong on.
import { isTimedSet } from './timedSets';

const DAY = 86_400_000;
// LOCAL calendar day (not UTC): an evening workout must count as today for the user even after its ISO timestamp rolls into tomorrow in UTC.
const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayKey = (iso: string) => keyOf(new Date(iso));

/**
 * A cursor for walking local calendar days backwards.
 *
 * Anchored at MIDDAY, not midnight, and stepped with `setDate` rather than by
 * subtracting `DAY`. Both halves of that matter, and both were wrong.
 *
 * Subtracting a fixed 86,400,000 ms from local midnight assumes every local day
 * is 24 hours long. Twice a year one is 23 and one is 25. On the 23-hour day,
 * midnight minus a fixed day lands at 23:00 of the day BEFORE yesterday, so
 * yesterday is never tested and the chain breaks on a day the member trained;
 * on the 25-hour day the same instant lands at 01:00 of yesterday, which is the
 * right day by luck rather than by rule. `setDate(getDate() - 1)` asks the
 * calendar for the previous calendar day and gets it in every zone.
 *
 * Midday, because in a handful of zones (Chile, Cuba, Lord Howe) the clock
 * springs forward AT midnight and 00:00 does not exist that day: `setHours(0)`
 * silently returns 01:00. That still keys to the right day, but a cursor an
 * hour from a boundary is a cursor waiting to cross one. Noon is twelve hours
 * from either edge and no shift on earth is that large.
 */
const dayCursor = (now: number): Date => { const d = new Date(now); d.setHours(12, 0, 0, 0); return d; };
const stepBack = (d: Date): Date => { d.setDate(d.getDate() - 1); return d; };

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
  const cursor = dayCursor(now);
  // If nothing today, allow the streak to be anchored at yesterday.
  if (!days.has(keyOf(cursor))) stepBack(cursor);
  let streak = 0;
  while (days.has(keyOf(cursor))) { streak++; stepBack(cursor); }
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
  // `activeDays` sorts newest first, so the last entry is the oldest day on
  // record. Compared as a key rather than as a parsed timestamp: two YYYY-MM-DD
  // strings order the same way in every zone, and the previous
  // `Date.parse(d + 'T00:00:00')` was a local parse being compared against a
  // cursor that had just been stepped by a fixed 24 hours.
  const minActiveKey = daysArr[daysArr.length - 1];
  const cursor = dayCursor(now);
  if (!days.has(keyOf(cursor))) stepBack(cursor);
  let streak = 0, used = 0, budget = Math.max(0, freezes);
  const frozen: string[] = [];
  while (true) {
    if (days.has(keyOf(cursor))) { streak++; stepBack(cursor); continue; }
    if (streak === 0) break;          // no active day anchoring the chain yet
    if (budget <= 0) break;           // out of freezes — chain ends here
    if (keyOf(cursor) <= minActiveKey) break; // nothing older to reach — don't waste a freeze
    budget--; used++; frozen.push(keyOf(cursor)); stepBack(cursor);
  }
  return { streak, freezesUsed: used, frozen };
}

/**
 * THE streak figure. The one a member is shown, wherever they are shown one.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * There were two. `currentStreakFrozen(log, freezeBudget(log))` was the ring on
 * Home and the hero on Consistency; the raw `currentStreak` was the banner four
 * inches above that ring, the Milestone Card exported as an image and posted to
 * Instagram, the Activity feed, and the Weekly Report — including the figure
 * handed to the model that writes the report's summary.
 *
 * So a member whose freeze had bridged a missed day read "23" in the ring and,
 * on the same screen, "A freeze is holding your 12-day streak", and the card
 * they posted said 12. The freeze feature exists to tell somebody that a missed
 * day did not cost them the run, and it was being contradicted by the screen
 * that granted it.
 *
 * The frozen figure wins because it is the one the product PROMISES: the budget
 * is earned from the log (`freezeBudget`), the app spends it silently, and a
 * member who is told their streak survived must not then be shown the number it
 * would have been if it had not.
 *
 * The budget is derived here rather than passed in, for the same reason it is
 * derived in `freezeBudget` rather than persisted: two callers computing their
 * own budget is exactly how two answers happen.
 *
 * `currentStreak` stays exported and is still the right function for one
 * question — "would this chain have held with no help" — which is what
 * `streakRisk` asks. Nothing else should call it. A screen showing a member
 * their streak calls this.
 */
export function shownStreak(log: WorkoutEntry[], now: number = Date.now()): number {
  return currentStreakFrozen(log, freezeBudget(log), now).streak;
}

export interface StreakRisk { atRisk: boolean; streak: number; trainedToday: boolean }
/**
 * Retention signal: an active streak (>=2) that will break tonight because the
 * user trained yesterday but not yet today. Pure; mirrors currentStreak's day math.
 */
export function streakRisk(log: WorkoutEntry[], now: number = Date.now()): StreakRisk {
  const days = new Set(activeDays(log));
  const cursor = dayCursor(now);
  const todayK = keyOf(cursor);
  const yestK = keyOf(stepBack(cursor));
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
      if (isTimedSet(e, i)) continue;
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
    if (isTimedSet(e, i)) return 0;
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
 * Totals over everything logged at or after `sinceMs`. Volume = Σ reps × load.
 *
 * The engine under both windows below, because the two of them differ ONLY in
 * where the window opens and a second copy of this loop is how they would come
 * to disagree about the same fortnight.
 *
 * `history` is the member's weight over time; without it a bodyweight set has
 * no load and lands in `unpricedSets` rather than being counted as zero.
 */
export function statsSince(log: WorkoutEntry[], sinceMs: number, history: BodyweightHistory = []): WeekStats {
  const recent = log.filter((e) => Date.parse(e.t) >= sinceMs);
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

/**
 * Totals for the trailing 7 days — a ROLLING 168 hours, ending now.
 *
 * Right for a question about load and recovery, which is what it was written
 * for: `deloadCheck` and the rest-day suggestion in app/(client)/restday.tsx
 * ask "how much have you done lately", and lately does not reset on a Sunday.
 *
 * WRONG for anything captioned "this week", and it was being used for exactly
 * that on three screens. See `thisWeekStats` below.
 */
export function weekStats(log: WorkoutEntry[], now: number = Date.now(), history: BodyweightHistory = []): WeekStats {
  return statsSince(log, now - 7 * DAY, history);
}

/**
 * Totals for the CALENDAR week the member is in — from local midnight on the
 * day the week opened, which `src/lib/weekStart.ts` fixes at Sunday for the
 * whole product.
 *
 * ── What this is the fix for ──────────────────────────────────────────────
 *
 * `weekStats` is a rolling 168 hours and says so. Three screens printed it
 * under the words "this week" anyway, while `week.tsx`, `trends.tsx` and
 * `consistency.tsx` measured the same phrase with `startOfWeek`. So the same
 * member, on the same Monday morning, read three different answers to one
 * question — and the sharpest of them was the goal ring on Home, which could
 * say "4 of 4 this week · goal met" on a Monday to somebody who had not
 * trained since the week opened, because it was still counting the previous
 * Wednesday and Thursday.
 *
 * `weekStart.ts` opens with the reason the anchor is product-wide and not
 * per-device: otherwise "the same seven sessions land in different buckets on
 * two handsets". A rolling window is that failure without the second handset.
 *
 * Calendar arithmetic, via `startOfWeek`, so a week containing a clocks change
 * is still seven days and not 167 hours.
 */
export function thisWeekStats(log: WorkoutEntry[], now: number = Date.now(), history: BodyweightHistory = []): WeekStats {
  return statsSince(log, startOfWeek(now).getTime(), history);
}

/** A short, friendly milestone label for a streak count (for the confetti banner). */
export function streakMilestone(streak: number): string | null {
  if (streak >= 30) return `${streak}-day streak — unstoppable! 🔥`;
  if (streak >= 14) return `${streak}-day streak — two weeks strong! 🔥`;
  if (streak >= 7) return `${streak}-day streak — a full week! 🔥`;
  if (streak >= 3) return `${streak}-day streak — keep it rolling! 🔥`;
  return null;
}
