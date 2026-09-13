// The GRID a consistency heatmap is drawn on, and the count in each square.
//
// ── Why this is a module and not four lines in a screen ────────────────────
//
// app/(client)/consistency.tsx builds both of these inline, and both are the
// kind of arithmetic that looks obvious and is quietly wrong in one timezone
// out of three. The coach's own consistency panel needs the same two answers,
// and the alternative to a shared module is a second hand-rolled grid — two
// pieces of code that will disagree about which square is today the first time
// either is touched.
//
// It is pure: dates and numbers in, dates and numbers out. No react-native, no
// provider, no clock of its own — `today` is passed in, because a module that
// reads `Date.now()` internally cannot be tested across a midnight and cannot
// be told by its caller that the day has turned.
//
// ── The two failures it exists to prevent ─────────────────────────────────
//
// 1. THE UTC DAY. `e.t` is a `performed_at` timestamp, not a date, and
//    `e.t.slice(0, 10)` reads it in UTC. West of Greenwich an evening session
//    lands on the following day: a coach who trained on Friday night in New
//    York gets a blank Friday square and a filled Saturday one. `dayKeyOf`
//    (src/lib/entryEdit.ts) reads the instant in the reader's own zone, and it
//    is reused here rather than re-derived. An entry whose timestamp cannot be
//    read is DROPPED rather than filed under today — a row with a broken date
//    is not a session that happened this morning, and putting it there invents
//    a training day out of a parsing failure.
//
// 2. THE WEEK THAT DOES NOT START WHERE THE READER'S DOES. The column is a
//    week, and which day a week opens on is a decision this codebase has
//    already made once, in src/lib/weekStart.ts. Deriving it again here would
//    give a grid whose rows are labelled by one convention and filled by
//    another, which is a picture that is off by a day for everybody and
//    obviously wrong for nobody.
//
// ── Counts are EXERCISES, not sessions ─────────────────────────────────────
//
// This app writes one `workouts` row per movement (src/ui/workoutLog.tsx), so a
// single visit to the gym is seven rows. `squareCounts` therefore counts
// movements, and every caller — and `heatmapDayLabel` in src/lib/heatmap.ts,
// which reads a square aloud — must say "exercises". Calling them sessions told
// one reader they had trained seven times on a day they went to the gym once.
import { startOfWeek, WEEK_DAYS } from './weekStart';
import { dayKeyOf, dayKeyOfDate } from './entryEdit';

/** How many rows a column has: the seven days of a week, in the order
 *  src/lib/weekStart.ts draws them. Named here so a caller labelling the rows
 *  and a caller filling them cannot disagree about the count. */
export const GRID_ROWS = WEEK_DAYS.length;

/**
 * The columns of the grid: `weeks` weeks, oldest first, each one seven local
 * days beginning at that week's start.
 *
 * `today` is the reader's today. It is COPIED before anything is written
 * through it — `setDate` mutates, and a caller that passed the Date held in
 * state would otherwise find its own clock silently moved backwards by up to
 * twelve weeks.
 *
 * The last column is the week `today` falls in, so it runs past today to the
 * end of the week. Those squares are the future and a caller must draw them as
 * such; `heatmapDayLabel` already says "still to come" for them rather than
 * "nothing logged", which is the difference between a day somebody missed and
 * a day that has not happened.
 *
 * Returns an empty array for a non-positive or unreadable `weeks`, rather than
 * a one-column grid: a grid of no weeks is a caller bug, and inventing a column
 * hides it behind a picture that looks like an answer.
 */
export function heatmapColumns(today: Date, weeks: number): Date[][] {
  if (!Number.isFinite(weeks) || weeks < 1) return [];
  const base = new Date(today.getTime());
  base.setHours(0, 0, 0, 0);
  const thisWeek = startOfWeek(base);
  const cols: Date[][] = [];
  for (let w = Math.floor(weeks) - 1; w >= 0; w--) {
    const colStart = new Date(thisWeek.getTime());
    colStart.setDate(thisWeek.getDate() - w * 7);
    const col: Date[] = [];
    for (let d = 0; d < GRID_ROWS; d++) {
      const day = new Date(colStart.getTime());
      day.setDate(colStart.getDate() + d);
      // Midnight local, so a square is a DAY rather than an instant inside one.
      // Without this a grid built during a daylight-saving shift can hold two
      // Dates that are twenty-three hours apart and read as the same square.
      day.setHours(0, 0, 0, 0);
      col.push(day);
    }
    cols.push(col);
  }
  return cols;
}

/**
 * Exercises logged per local calendar day, keyed `YYYY-MM-DD`.
 *
 * Takes the timestamp alone rather than a `WorkoutEntry`, so the same counter
 * serves a log, a queue and anything else that carries an instant. A row whose
 * timestamp cannot be read contributes nothing — see the header.
 */
export function squareCounts(log: readonly { t: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of log) {
    const day = dayKeyOf(e.t);
    if (!day) continue;
    out[day] = (out[day] ?? 0) + 1;
  }
  return out;
}

/**
 * How many exercises a square holds, or null when the log was not read.
 *
 * Null and zero are the two answers this whole file exists to keep apart. A
 * blank square means "you did not train" under a read that landed and "we do
 * not know" under one that did not, and those are drawn identically — so the
 * caller passes `known` and the distinction survives into every label and every
 * total downstream. Telling somebody who trained every day of a month that they
 * trained on none of it is the worst thing a consistency screen can get wrong.
 */
export function squareCount(
  counts: Record<string, number>,
  day: Date,
  known: boolean,
): number | null {
  if (!known) return null;
  return counts[dayKeyOfDate(day)] ?? 0;
}
