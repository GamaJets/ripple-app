// Whether a current streak is a figure, or only a floor.
//
// ── The defect this exists for ─────────────────────────────────────────────
//
// `app/(client)/consistency.tsx` prints the member's current streak as a bare
// number, and it admits a 'partial' workout log on purpose. The argument it
// carries for doing so is half right and had never been finished:
//
//     "A capped read (src/lib/rowCap.ts) holds the NEWEST thousand sessions,
//      because the provider orders `performed_at` descending before it caps,
//      so the twelve-week grid and the current streak — both of which only
//      ever look at recent days — are drawn from real, complete rows."
//
// The rows that came back are real. What is not established is that they reach
// far enough back to prove the streak, and src/ui/workoutLog.tsx says outright
// that they may not: "One row per set, not per session, so this is the
// fastest-growing read a single client has: four sessions a week at twenty sets
// apiece passes a thousand rows inside three months."
//
// This app writes one `workouts` row per EXERCISE, and production shows seven
// rows for one visit to a gym (see the note on `WeekStats.workouts` in
// src/lib/streaks.ts). Seven a day against a thousand-row cap is about a
// hundred and forty days of reach. A member training every day for six months
// has a streak of a hundred and eighty and a read that stops at a hundred and
// forty — so `currentStreakFrozen` walks back, runs out of rows, finds no
// active day, and stops. The screen then prints
//
//     Current Streak · 140 days
//
// as a fact, to the member whose streak is the longest in the gym. The screen
// already computes the read boundary for the grid underneath (`readBoundary`
// and `rangeCoverage` in src/lib/sessionHistory.ts) and says out loud that the
// earliest columns may be older than the read. The hero above it said nothing.
//
// A streak is a claim about an UNBROKEN SEQUENCE, which is a claim about the
// days on both ends of it. The newer end is today and is always read. The older
// end is the day the chain stopped, and a chain that stopped because the read
// stopped proves nothing about that day at all.
//
// ── Why this is a qualifier and not a refusal ─────────────────────────────
//
// Withholding the streak on every 'partial' read would take the figure away
// from every member with more than a thousand rows behind them — which is most
// of the ones who have been training longest — over a boundary that is nowhere
// near their chain. The honest distinction is not "was the read whole" but "did
// the chain end inside what was read", and that is answerable: the chain covers
// a known run of calendar days, and the read has a known oldest day.
//
//   · chain ends above the boundary → the day that broke it was read, the
//     streak is established, and it is printed as a figure.
//   · chain reaches the boundary    → the run may continue below it. The figure
//     is a FLOOR and is said as one: "14 days or more".
//
// Under-claiming is not a licence to under-claim silently. "14" to somebody on
// 180 is as wrong as "180" to somebody on 14; it is merely wrong in the
// direction that discourages rather than flatters, which on a streak screen is
// the worse of the two.
//
// Pure, and primitives only — day keys as `YYYY-MM-DD` strings and a count of
// days — so it runs under plain node and so that nothing here re-derives the
// streak. `src/lib/streaks.ts` owns that arithmetic and stays the only place it
// happens; this takes its answer and says how far it can be trusted.
import { isoDay } from './weekStart';

/** A streak, and whether the record can stand behind it as a figure. */
export interface StreakClaim {
  /** The streak as counted from the rows that came back. */
  days: number;
  /**
   * True when the chain runs back to the oldest day the read contains, so the
   * real run may be longer than `days`. The figure is then a floor.
   *
   * Never true on a whole read: there is no boundary to reach.
   */
  bounded: boolean;
}

/**
 * The oldest calendar day the current chain covers, as `YYYY-MM-DD`, or null
 * when there is no chain.
 *
 * The chain ends at the ANCHOR — today when the member has logged today, and
 * yesterday when they have not, which is the anchoring rule
 * `currentStreakFrozen` uses — and runs back over `days` active days plus
 * `freezesUsed` days a freeze bridged. Those are consecutive calendar days by
 * construction, so the oldest is `span - 1` days before the anchor.
 *
 * Stepped with `setDate` from a MIDDAY cursor, for both the reasons
 * src/lib/streaks.ts gives for its own cursor: subtracting a fixed 86,400,000
 * assumes every local day is twenty-four hours long and twice a year one is
 * not, and midnight does not exist at all on the day the clocks spring forward
 * in a handful of zones.
 */
export function chainOldestDay(
  days: number,
  freezesUsed: number,
  trainedToday: boolean,
  now: number = Date.now(),
): string | null {
  if (!Number.isFinite(days) || days <= 0) return null;
  const bridged = Number.isFinite(freezesUsed) ? Math.max(0, Math.trunc(freezesUsed)) : 0;
  const span = Math.trunc(days) + bridged;
  const cursor = new Date(now);
  if (!Number.isFinite(cursor.getTime())) return null;
  cursor.setHours(12, 0, 0, 0);
  if (!trainedToday) cursor.setDate(cursor.getDate() - 1);
  cursor.setDate(cursor.getDate() - (span - 1));
  return isoDay(cursor);
}

/**
 * Whether the chain reached the bottom of what was read.
 *
 * Both dates are bare `YYYY-MM-DD` and are compared AS STRINGS. Parsing either
 * of them would pick a zone that neither of them carries — the house rule the
 * same comparison in `currentStreakFrozen` was fixed to follow.
 *
 * False on a whole read, whatever the dates say: a read that was not truncated
 * has no boundary, and the oldest day in it is the oldest day there is.
 */
export function streakBounded(
  chainOldest: string | null,
  oldestReadDay: string | null,
  truncated: boolean,
): boolean {
  if (!truncated) return false;
  if (!chainOldest || !oldestReadDay) return false;
  return chainOldest <= oldestReadDay;
}

/**
 * The streak and whether it is a figure or a floor, in one call.
 *
 * `oldestReadDay` is the oldest local calendar day the log that came back
 * contains — the last entry of `activeDays()`, which sorts newest first. Null
 * when nothing was read, in which case there is no boundary to be bounded by
 * and the caller is already showing a dash for a different reason.
 */
export function streakClaim(
  days: number,
  freezesUsed: number,
  trainedToday: boolean,
  oldestReadDay: string | null,
  truncated: boolean,
  now: number = Date.now(),
): StreakClaim {
  const safe = Number.isFinite(days) && days > 0 ? Math.trunc(days) : 0;
  return {
    days: safe,
    bounded: streakBounded(chainOldestDay(safe, freezesUsed, trainedToday, now), oldestReadDay, truncated),
  };
}

/**
 * The unit beside a bounded figure, so the number is not read as an exact one.
 *
 * It goes in the Hero's unit slot rather than in front of the figure because
 * the figure slot is display type shrunk to one line, and "at least 14" in it
 * is a number with a word wedged into it. "14 · days or more" reads as the
 * floor it is, and `Hero` speaks label, figure, unit and note as one sentence,
 * so a screen reader gets "Current Streak, 14 days or more" rather than a bare
 * fourteen.
 */
export const boundedStreakUnit = (days: number): string =>
  days === 1 ? 'day or more' : 'days or more';

/**
 * Why the figure is a floor, in the member's words.
 *
 * Says the run may be LONGER, and says it is our reading that stopped rather
 * than their training. The failure this whole file is about is a member being
 * quietly told their streak is shorter than it is, and a floor with no sentence
 * under it is that failure with a different unit.
 */
export const BOUNDED_STREAK_NOTE =
  'Your current run reaches as far back as this screen could read, so it may be longer than '
  + 'this. Nothing has been lost — there is more of your log than fits in one go.';
