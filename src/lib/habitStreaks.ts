// Per-habit streaks, for the member's own screen.
//
// ── The gap this closes ────────────────────────────────────────────────────
//
// `src/ui/habits.tsx` read one day — `.eq('done_on', day)` — so the only thing
// the member's app could say about a habit was whether it was ticked this
// morning. Their coach has had four weeks of the same rows since
// src/lib/adherence.ts was written (`habit_logs_coach_read`, 28 days,
// `summariseAdherence`), and the member's own app could not see its own
// history. The run is the figure every habit tracker is built around — it is
// the whole of Streaks, it is what Habitica's dailies count, it is the ring
// Apple Fitness+ animates — and this one had nowhere to get it from.
//
// This file is the arithmetic. It is pure, it takes bare `YYYY-MM-DD` day keys
// and never a timestamp, and it computes nothing the rows cannot support.
//
// ── Rule one: A GAP IS NOT A ZERO ─────────────────────────────────────────
//
// A day with no row for a habit is NOT a day the habit was missed. It has at
// least four causes, and src/lib/adherence.ts enumerates them for the coach's
// side of the same table:
//
//   1. the member saw the line and did not do it — a genuine miss;
//   2. they did it and did not open the app to say so;
//   3. the line was not on their list that day — the checklist is DERIVED
//      (src/lib/checklist.ts), so 'train' exists only on training days and
//      'steps' did not exist before they set a step goal;
//   4. their coach had not added it yet, or had taken it off.
//
// Treating an empty cell as a break is the same claim as treating it as a zero,
// and it is the claim this codebase keeps having to un-make: an absent row read
// as a fact about a person.
//
// adherence.ts already found the one distinction the record CAN support, and
// this file uses it rather than inventing a second one:
//
//     "a day on which the client ticked ANYTHING is a day they were in the app.
//      So a day with other ticks and not this one is a real miss, and a day
//      with no ticks at all is genuinely unknown."
//
// So there are three kinds of day in a run, not two:
//
//   · TICKED    — a row for this habit. Counted.
//   · MISS      — no row for this habit, and at least one row for something
//                 else. The member was standing in front of the list and left
//                 this line. The run ENDS here, and the figure is a fact.
//   · SILENT    — no row for anything. Nobody recorded this day. It is stepped
//                 OVER: not counted towards the run, and not allowed to end it.
//                 Counted separately, in `silentDays`, and never folded in.
//
// A silent day is therefore neither a one nor a zero. It is a hole, it is
// reported as a hole, and the screen states the span so a run of 2 across 90
// days of silence cannot be read as a run of 2 days.
//
// ── Rule two: the day boundary is the MEMBER's ────────────────────────────
//
// `habit_logs.done_on` is a Postgres `date` — a bare `YYYY-MM-DD` with no time
// and no offset, meaning a calendar day in the member's own life. It is
// compared here AS A STRING and parsed nowhere. `Date.parse('2026-08-01')` is
// UTC midnight, and every local getter reads it back a day early west of
// Greenwich; src/lib/localDate.ts lists the two shipped bugs that cost.
//
// Where a day has to be STEPPED, it is stepped as a Gregorian LABEL, in
// integers, with no `Date` anywhere near it. src/lib/streaks.ts and
// src/lib/streakReach.ts step a midday local `Date` with `setDate`, and both
// are right to — they start from an instant and have to find the local day it
// falls in. This starts from a label, which needs no zone at all, and the
// midday cursor borrowed from them turned out to be actively wrong here: it
// does not move across the whole calendar days Samoa and Kiritimati skipped
// when they crossed the date line. See `previousDay` for the probe that found
// it. Lane 8 hit the ms-subtraction half of this in streakReach.ts; this is the
// half underneath it.
//
// Nothing here reads a clock. `today` is passed in — the member's own day, from
// `useToday()` — so the whole module is deterministic and the suite runs
// identically under TZ=Pacific/Kiritimati and TZ=Pacific/Midway.
//
// ── Rule three: a run that runs off the read is a FLOOR ───────────────────
//
// src/lib/streakReach.ts was written tonight for the same problem one table
// over, and its argument transfers without change: "A streak is a claim about
// an UNBROKEN SEQUENCE, which is a claim about the days on both ends of it. The
// newer end is today and is always read. The older end is the day the chain
// stopped, and a chain that stopped because the read stopped proves nothing
// about that day at all."
//
// The habits read has two floors rather than one, and they are both real:
//
//   · the WINDOW. The provider reads a fixed number of days back. A run that
//     reaches the oldest day in the window may continue below it.
//   · the ROW CAP. PostgREST stops at 1000 rows in silence (src/lib/rowCap.ts).
//     A member with a dozen lines crosses that inside three months, so the
//     window the provider ASKED for and the window it can SPEAK FOR are not the
//     same thing. The provider hands the second one in as `coverFrom`.
//
// Either way the answer is the same and it is streakReach's: the figure is a
// floor and is said as one — "14 days or more" — never as a fact. Under-claiming
// silently is not the safe option: "14" to somebody on 180 is as wrong as "180"
// to somebody on 14, merely wrong in the direction that discourages.
//
// A PARTIAL WINDOW IS NOT A SHORT HISTORY. Nothing in this file counts, sums or
// averages a truncated read into a smaller figure and presents it as the
// figure. It carries `bounded` instead.
// The unit beside a floor, from the file that wrote it. Two copies of one
// string is how a member reads "14 days or more" on one screen and "at least
// 14 days" on the next about the same run.
import { boundedStreakUnit } from './streakReach';
// The coach's side of this table already writes a `done_on` for a reader, in
// the reader's own locale and out of the PARTS rather than a parsed Date. A
// second way of writing one is a second way of writing it wrong — and the
// wrong one is invisible to whoever writes it, because it only misreads west
// of Greenwich. See the note on `dayLabel`.
import { dayLabel } from './adherence';

/** One row of `habit_logs` as the member's own app reads it. Mirrors
 *  `TickRow` in src/lib/adherence.ts, which is the coach's read of the same
 *  table — the shapes are the same because the rows are. */
export interface HabitTickRow { habit: string; done_on: string }

/** What the record supports about one habit's current run. */
export interface HabitStreak {
  /** The tick id. 'water', 'protein', 'coach:8f3e…' — see src/lib/checklist.ts. */
  habit: string;
  /**
   * Days ticked in the current run, counting back from the anchor.
   *
   * Only days with a row are counted. Silent days are stepped over and land in
   * `silentDays`; a miss ends the run. Zero means there is no run right now,
   * which is NOT a statement that the habit was missed — see `lastTicked`.
   */
  days: number;
  /**
   * Calendar days inside the run that nobody recorded anything on.
   *
   * The run spans `days + silentDays` calendar days. Never added to `days` and
   * never subtracted from it: it is the size of the hole, carried beside the
   * figure so a screen can say how wide the run is rather than implying it.
   *
   * Leading silence — days between the anchor and the newest ticked day — is
   * NOT in here. It is not inside a run; there is no run above it yet. It has
   * its own field, `silentAbove`, because it is a different fact and the two
   * were being added together.
   */
  silentDays: number;
  /**
   * Calendar days between the anchor and the newest day of the run that nobody
   * recorded anything on.
   *
   * This is the run that has not been KEPT UP without having been BROKEN, and
   * it needs saying on its own. A member who ticked a habit once in June and
   * has recorded nothing since has, by the rule at the top of this file, a run
   * of one that nothing has ended — and printing "1 day running" over that is
   * true in the way that is worse than false. `silentAbove` is 89 there, and
   * the screen leads with it.
   *
   * Zero whenever the habit was ticked on the anchor day, which is the ordinary
   * case.
   */
  silentAbove: number;
  /** The oldest calendar day of the run, or null when there is no run. */
  from: string | null;
  /**
   * True when the run reached the bottom of what could be read, so it may be
   * longer than `days` says. The figure is then a FLOOR and must be spoken as
   * one — `habitStreakFigure` below writes it.
   */
  bounded: boolean;
  /** The most recent day this habit was ticked anywhere in the read, or null. */
  lastTicked: string | null;
  /** Days in the read with a tick for this habit. A COUNT, never a rate: the
   *  read is a window and the days this line was even on the list are not
   *  recorded anywhere — the same reason adherence.ts refuses a denominator for
   *  a derived item. */
  totalDays: number;
}

export interface HabitStreakOptions {
  /**
   * The oldest calendar day whose ABSENCE of rows can be trusted, as
   * `YYYY-MM-DD`, or null when there is no floor to worry about.
   *
   * Precisely that, and not "the oldest day that came back", because the two
   * things a read gives you are not equally reliable. A row that came back is a
   * fact: the walk counts a ticked day wherever it sits. An EMPTY day is only
   * informative inside the part of the window that was read whole — below that
   * line an empty day may be silence or may be a row the thousand-row ceiling
   * cut, and there is no telling which.
   *
   * On a truncated read the oldest day present is itself a partial day, so the
   * line is the day ABOVE it. `tickReadCoverage` works that out from the read.
   */
  coverFrom?: string | null;
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * How far back the member's own app reads its ticks.
 *
 * Thirteen weeks. Three decisions, and the middle one is the reason this number
 * is here rather than 28:
 *
 *   · LONGER THAN THE COACH'S WINDOW. src/lib/adherence.ts reads 28 days and
 *     argues for it: four weeks contains four of every weekday, and ninety days
 *     "averages a fortnight of slipping into eleven weeks of doing fine". That
 *     is the right window for a RATE, which is what the coach is shown. A run
 *     is not a rate. A member on a sixty-day run whose screen could only see 28
 *     of them would be shown "28 days or more" for ever, and the floor would
 *     never lift.
 *   · SHORT ENOUGH THAT THE CAP IS USUALLY NOT REACHED, AND LONG ENOUGH THAT
 *     IT SOMETIMES IS. A derived list plus a coach's lines is commonly six to
 *     twelve ticks a day; twelve times ninety is 1,080, past PostgREST's 1,000.
 *     So the truncated case is not hypothetical and is not allowed to be
 *     handled by hope — `coverFrom` and `bounded` are the whole answer to it.
 *   · A ROUND SEASON. Thirteen weeks is a training block, which is the unit
 *     this product already counts in.
 */
export const STREAK_WINDOW_DAYS = 91;

/**
 * A hard stop on the walk below.
 *
 * Every bound the walk has comes from data — `coverFrom`, and the oldest day
 * this habit was ticked. A malformed one (a row dated in the year 200, a
 * `coverFrom` from a window computed off a NaN) would otherwise walk a day at a
 * time for as long as the arithmetic allowed. Ten years is far past any run
 * this product can hold and near enough to stop before a phone notices.
 *
 * Tripping it is treated as running off the read, not as the run ending: the
 * walk stopped for our reasons and not the member's, which is exactly what
 * `bounded` means.
 */
const MAX_WALK_DAYS = 3660;

/** Days in a Gregorian month. `month` is 1-12. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * The calendar day before `day`, or null when `day` is not a real date.
 *
 * ── Why there is no `Date` in here at all ─────────────────────────────────
 *
 * src/lib/streaks.ts and src/lib/streakReach.ts both step days with a local
 * `Date` anchored at midday and moved by `setDate`, and both are right to: they
 * start from an INSTANT — `Date.now()`, a workout's `performed_at` — and the
 * question they have to answer is which local calendar day that instant falls
 * in. That needs a zone, so it needs a Date.
 *
 * This does not. It starts from a LABEL — a bare `YYYY-MM-DD` off a Postgres
 * `date` column — and the day before a label is a fact about the Gregorian
 * calendar and about nothing else. Borrowing the Date cursor anyway looked like
 * following the house pattern and was tried; it is wrong here, and probing it
 * across the zone list this suite runs under is what found it:
 *
 *     TZ=Pacific/Apia         new Date(2011, 11, 31, 12).setDate(30)  →  31 Dec
 *     TZ=Pacific/Kiritimati   new Date(1995, 0, 1, 12).setDate(0)     →   1 Jan
 *
 * Samoa skipped 30 December 2011 and Kiritimati skipped 31 December 1994 —
 * whole calendar days that never existed locally when those islands crossed the
 * date line. `setDate` normalises a day that does not exist in the zone to one
 * that does, so the cursor did not move: `previousDay` returned its own input,
 * and the walk below would have spun on one day until the `MAX_WALK_DAYS` guard
 * caught it and reported a run of thousands. Midday anchoring does not help —
 * the missing thing is a whole day, not an hour.
 *
 * A tick dated 30 December 2011 is still a row in this table, because `done_on`
 * is a label and the member's phone wrote whatever their calendar said. So the
 * arithmetic is done on the label, by hand, in integers. It consults no zone,
 * so it cannot differ between two of them, and there is nothing left for a
 * clocks change or a date line to move.
 *
 * It also rejects a date that never existed anywhere — `2026-02-30` matches the
 * shape and is not a day — which the regex alone cannot do.
 */
export function previousDay(day: string): string | null {
  const m = DAY_RE.exec(String(day ?? '').trim());
  if (!m) return null;
  let year = Number(m[1]);
  let month = Number(m[2]);
  let date = Number(m[3]);
  if (month < 1 || month > 12) return null;
  if (date < 1 || date > daysInMonth(year, month)) return null;
  date -= 1;
  if (date === 0) {
    month -= 1;
    if (month === 0) { month = 12; year -= 1; }
    date = daysInMonth(year, month);
  }
  if (year < 1) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
}

/**
 * The calendar day after `day`, or null when `day` is not a real date.
 *
 * The mirror of `previousDay`, and integers for the same reason. The provider
 * needs it for one thing: on a TRUNCATED read the oldest day that came back is
 * itself a partial day — the thousand-row ceiling fell somewhere inside it — so
 * the oldest day the read can speak for is the one above it.
 */
export function nextDay(day: string): string | null {
  const m = DAY_RE.exec(String(day ?? '').trim());
  if (!m) return null;
  let year = Number(m[1]);
  let month = Number(m[2]);
  let date = Number(m[3]);
  if (month < 1 || month > 12) return null;
  if (date < 1 || date > daysInMonth(year, month)) return null;
  date += 1;
  if (date > daysInMonth(year, month)) {
    date = 1;
    month += 1;
    if (month === 13) { month = 1; year += 1; }
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
}

/**
 * The day `n` calendar days before `day`, or null when either is unusable.
 *
 * Stepped rather than computed, because a step is the only operation this file
 * has that is known to be right — and `n` is 89, once, at the top of a read.
 * Refuses a negative or unreasonable `n` rather than walking for it.
 */
export function daysBefore(day: string, n: number): string | null {
  if (!Number.isFinite(n)) return null;
  const steps = Math.trunc(n);
  if (steps < 0 || steps > MAX_WALK_DAYS) return null;
  let cursor: string | null = DAY_RE.test(String(day ?? '').trim()) ? String(day).trim() : null;
  for (let i = 0; i < steps && cursor; i++) cursor = previousDay(cursor);
  return cursor;
}

/** Rows folded into the two facts the walk needs: which days each habit was
 *  ticked on, and which days the member was demonstrably in the app.
 *
 *  Deduped by construction — the unique constraint on
 *  (user_id, habit, done_on) should make a repeat impossible, and a count that
 *  can exceed its own span is not a guarantee this function gets to rely on
 *  when it is handed an array. adherence.ts makes the same defence. */
function fold(rows: readonly HabitTickRow[], today: string) {
  const byHabit = new Map<string, Set<string>>();
  const anyTickDays = new Set<string>();
  for (const r of rows ?? []) {
    const habit = String(r?.habit ?? '');
    const day = String(r?.done_on ?? '').slice(0, 10);
    if (!habit || !DAY_RE.test(day)) continue;
    // A row dated after today is not evidence about a day nobody has lived. It
    // should not exist; a device whose clock was wrong when a queued tick
    // flushed is how it would, and letting one in would put a tick on tomorrow
    // and start a run from it.
    if (day > today) continue;
    let s = byHabit.get(habit);
    if (!s) { s = new Set(); byHabit.set(habit, s); }
    s.add(day);
    anyTickDays.add(day);
  }
  return { byHabit, anyTickDays };
}

/** What one `habit_logs` read supports: today's ticks, and how far back it can
 *  be trusted. See `tickReadCoverage`. */
export interface TickReadCoverage {
  /**
   * The oldest calendar day this read can SPEAK FOR, for `habitStreaks`'
   * `coverFrom`. Null only when there is no usable day at all.
   */
  coverFrom: string | null;
  /**
   * True when every one of today's rows is in the read.
   *
   * The thing a provider must NOT infer from `truncated` alone, in either
   * direction.
   */
  todayWhole: boolean;
  /** The habits ticked today, deduped. The tick set the checklist draws. */
  todayHabits: string[];
}

/**
 * Split one windowed `habit_logs` read into the two claims over it.
 *
 * ── Why this is a function and not four lines in the provider ─────────────
 *
 * Because it is the part of this feature with teeth, and it is arithmetic
 * rather than plumbing — so it belongs where it can be asserted rather than
 * reasoned about in an async effect nobody can run.
 *
 * One read comes back. Two different claims rest on it and they fail
 * independently:
 *
 *   · TODAY's ticks drive every checkbox on the screen and every figure
 *     `status` gates. The provider orders `done_on` DESCENDING, so today's rows
 *     are at the top of the page and survive a truncation that eats the oldest
 *     days. They are complete unless the ceiling reached today ITSELF, which
 *     needs a thousand rows all stamped today — a thing that should be
 *     impossible and is therefore checked, because "should be impossible" is
 *     the whole reason src/lib/rowCap.ts exists.
 *   · THE HISTORY behind them is complete only if nothing fell off the bottom,
 *     and a member with a long record truncates it routinely.
 *
 * Folding those into one status is the defect this split prevents: a member
 * whose history is long would read "Some of today's list is missing" over a
 * complete list, every day, for ever.
 *
 * ── the off-by-one that matters ──────────────────────────────────────────
 *
 * On a truncated read the oldest day PRESENT is a partial day — the ceiling
 * fell somewhere inside it, so some of its rows are here and some are not. The
 * oldest day the read can speak for is therefore the one ABOVE it. Taking the
 * oldest day present would state a run as a fact off a day that was half read.
 *
 * `windowFrom` is the lower bound the query ASKED for; on a whole read that is
 * exactly what it can speak for, whether or not any row came back from down
 * there — a day with no rows in a complete read is a day that genuinely has
 * none.
 *
 * Nothing here trusts the caller's ordering: the oldest day is taken as a
 * minimum over the rows rather than read off the end of the array, so a
 * provider that changes its `.order()` cannot silently move the boundary.
 */
export function tickReadCoverage(
  rows: readonly HabitTickRow[],
  today: string,
  windowFrom: string | null,
  truncated: boolean,
): TickReadCoverage {
  const day = String(today ?? '').trim();
  const validToday = DAY_RE.test(day) ? day : null;
  const from = windowFrom && DAY_RE.test(String(windowFrom).trim()) ? String(windowFrom).trim() : null;
  let oldest: string | null = null;
  const todaySet = new Set<string>();
  for (const r of rows ?? []) {
    const habit = String(r?.habit ?? '');
    const d = String(r?.done_on ?? '').slice(0, 10);
    if (!habit || !DAY_RE.test(d)) continue;
    if (oldest === null || d < oldest) oldest = d;
    if (validToday && d === validToday) todaySet.add(habit);
  }
  if (!validToday) return { coverFrom: from, todayWhole: !truncated, todayHabits: [...todaySet].sort() };
  return {
    // A truncated read with no usable row in it can speak for nothing: the
    // ceiling was reached before a single readable day arrived, so every day
    // including today is in doubt. `validToday` is the narrowest honest floor
    // — it says "we can vouch for today and nothing below it".
    coverFrom: truncated ? (oldest ? nextDay(oldest) : validToday) : from,
    // Strictly less than: if the oldest day that came back IS today, the cut
    // landed inside today and today is a prefix of itself.
    todayWhole: !truncated || (oldest !== null && oldest < validToday),
    todayHabits: [...todaySet].sort(),
  };
}

/**
 * The current run for one habit.
 *
 * ── The anchor ────────────────────────────────────────────────────────────
 *
 * Today when the habit is ticked today, and YESTERDAY when it is not. That is
 * `currentStreak`'s rule in src/lib/streaks.ts — "so a rest until this evening
 * doesn't break it" — and adherence.ts states the same thing from the coach's
 * side and acts on it by ending its window yesterday: "Today is not over. A
 * line unticked at 9am is not a line missed."
 *
 * So today can never END a run. It can only extend one.
 */
function runFor(
  ticked: Set<string>,
  anyTickDays: Set<string>,
  today: string,
  coverFrom: string | null,
): Omit<HabitStreak, 'habit'> {
  const all = [...ticked].sort();
  const lastTicked = all.length ? all[all.length - 1] : null;
  const oldestTicked = all.length ? all[0] : null;
  const empty = {
    days: 0, silentDays: 0, silentAbove: 0, from: null, bounded: false,
    lastTicked, totalDays: ticked.size,
  } as Omit<HabitStreak, 'habit'>;
  if (!oldestTicked) return empty;

  let cursor: string | null = ticked.has(today) ? today : previousDay(today);
  let days = 0;
  let silentDays = 0;
  let silentAbove = 0;
  // Silence found since the last ticked day. Folded into `silentDays` only when
  // an OLDER ticked day turns up AND a run is already open above it, because a
  // gap is only INSIDE a run when there is run on both sides of it. Silence
  // above the newest ticked day goes to `silentAbove`; trailing silence, below
  // the oldest, belongs to neither and is dropped.
  let pending = 0;
  let from: string | null = null;
  let bounded = false;

  // ── PRESENCE IS A FACT; ABSENCE IS WHAT TRUNCATION PUTS IN DOUBT ─────────
  //
  // The order of the tests below is the whole of it, and the first version had
  // it wrong in a way that quietly SHORTENED runs.
  //
  // A row we are holding is a row. A truncated read does not make the ticks it
  // returned less true — it makes the ticks it did NOT return unknown. So a day
  // with a row for this habit counts wherever it sits, above or below the read
  // boundary; and a day with a row for some OTHER habit is still proof the
  // member was in the app, so it is still a real miss and still ends the run as
  // a fact. What the boundary costs us is only the third case: a day we can see
  // nothing on. Above the line that is genuine silence; below it, it may be
  // silence or it may be a row that fell off the end, and there is no telling.
  //
  // The first version tested the boundary first and so refused to count a
  // ticked day it had in its hand, reporting a run of two where the rows it was
  // given proved three. Under-claiming is not the safe direction — this file's
  // own header says so.
  for (let step = 0; cursor; step++) {
    if (step >= MAX_WALK_DAYS) { if (days > 0) bounded = true; break; }
    if (ticked.has(cursor)) {
      // The first ticked day closes the silence ABOVE the run; every one after
      // it closes a hole INSIDE it. Adding both into one number is what made a
      // single tick from June read as a run with eighty-nine days in it.
      if (days === 0) silentAbove = pending; else silentDays += pending;
      days += 1;
      pending = 0;
      from = cursor;
      cursor = previousDay(cursor);
      continue;
    }
    // A day they were demonstrably in the app and left this line. The only
    // thing in this table that ends a run, and the figure above it is a fact —
    // the other habit's row is one we are holding, so the truncation has no
    // bearing on it.
    if (anyTickDays.has(cursor)) break;
    // Nothing at all on this day in what came back. Below the line that is not
    // evidence of silence, it is the absence of evidence, so the run is a floor
    // rather than a thing that ended here.
    if (coverFrom && cursor < coverFrom) { if (days > 0) bounded = true; break; }
    // Nothing older to reach. `currentStreakFrozen` in src/lib/streaks.ts stops
    // in the same place and for the same reason — stepping over silence towards
    // a day that has no tick under it in any case is walking for nothing, and
    // it would count silent days into a run that does not continue.
    if (cursor < oldestTicked) break;
    // Genuinely silent: inside what we can speak for, and nobody recorded it.
    pending += 1;
    cursor = previousDay(cursor);
  }

  return { days, silentDays, silentAbove, from, bounded, lastTicked, totalDays: ticked.size };
}

/**
 * The current run for every habit in the rows.
 *
 * `today` is the MEMBER's day as `YYYY-MM-DD` — `useToday()` on the phone — and
 * is never read from a clock here. An unreadable one produces no streaks at
 * all rather than a set computed against a day nobody is in: a wrong anchor
 * moves every figure by the same amount and none of them would look wrong.
 *
 * One entry per habit that appears in the rows, including habits with no
 * current run (`days: 0`), because "you last kept this eleven days ago" is a
 * true and useful thing for the screen to say and a missing entry is not.
 * Habits with no row anywhere in the window are absent, which is honest: the
 * window holds nothing about them either way.
 */
export function habitStreaks(
  rows: readonly HabitTickRow[],
  today: string,
  opts: HabitStreakOptions = {},
): HabitStreak[] {
  const day = String(today ?? '').trim();
  if (!DAY_RE.test(day)) return [];
  const coverRaw = opts.coverFrom == null ? null : String(opts.coverFrom).trim();
  const coverFrom = coverRaw && DAY_RE.test(coverRaw) ? coverRaw : null;
  const { byHabit, anyTickDays } = fold(rows, day);
  const out: HabitStreak[] = [];
  for (const [habit, ticked] of byHabit) {
    out.push({ habit, ...runFor(ticked, anyTickDays, day, coverFrom) });
  }
  // A TOTAL order. Longest run first is what the screen wants; the tie-breaks
  // exist so two renders of the same rows cannot come out in two orders, which
  // is a list that reshuffles under a member's thumb for no reason.
  out.sort((a, b) =>
    b.days - a.days
    || a.silentDays - b.silentDays
    || String(b.lastTicked ?? '').localeCompare(String(a.lastTicked ?? ''))
    || a.habit.localeCompare(b.habit));
  return out;
}

/** One habit's run, or null when the window holds no row for it.
 *
 *  Null is NOT a run of zero. A habit the member has never ticked and a habit
 *  whose rows are all older than the window look identical from here, and
 *  neither is "they have kept this on none of the last ninety days". */
export function streakFor(list: readonly HabitStreak[], habit: string): HabitStreak | null {
  for (const s of list ?? []) if (s.habit === habit) return s;
  return null;
}

/**
 * The figure and its unit, as a screen prints them.
 *
 * A bounded run gets "days or more" rather than "at least 14 days" in front of
 * the number, for the reason streakReach.ts gives: the figure slot is display
 * type shrunk to one line and a word wedged into it stops being a figure.
 */
export function habitStreakFigure(s: HabitStreak): { figure: number; unit: string } {
  return {
    figure: s.days,
    unit: s.bounded ? boundedStreakUnit(s.days) : s.days === 1 ? 'day' : 'days',
  };
}

/**
 * The sentence under a run, in the member's own words.
 *
 * Every branch says what the record holds and stops there. None of them says
 * "missed", "failed" or "broken": the only day this module is willing to call a
 * miss is one the member was demonstrably in the app for, and even that is
 * their business rather than something to be scored on.
 *
 * The two qualifiers are separate sentences because they are separate facts,
 * and a run can carry both: a run with silence inside it that ALSO reaches the
 * bottom of the read is wider than it looks and longer than it says.
 */
export function habitStreakNote(s: HabitStreak): string {
  const parts: string[] = [];
  if (s.days === 0) {
    if (!s.lastTicked) {
      return 'No run going just now. Nothing on the record for this one in the days we can see — which is not the same as a day you skipped.';
    }
    parts.push(`No run going just now. Last ticked ${dayLabel(s.lastTicked)}.`);
  } else {
    const span = s.days + s.silentDays;
    parts.push(s.bounded
      ? `Ticked ${s.days} ${s.days === 1 ? 'day' : 'days'} running, and the run reaches as far back as this screen can read — so it may well be longer.`
      : `Ticked ${s.days} ${s.days === 1 ? 'day' : 'days'} running.`);
    // Said BEFORE the hole inside the run, because it is the fact that decides
    // what the figure means. A run that stopped being kept up a fortnight ago
    // is not a current run, and the number alone reads as one.
    if (s.silentAbove > 0) {
      parts.push(
        `That run ended ${dayLabel(s.lastTicked ?? '')} — nothing at all has been recorded since, `
        + `for ${s.silentAbove} ${s.silentAbove === 1 ? 'day' : 'days'}. It has not been broken, `
        + 'we simply have no record of those days either way.');
    }
    if (s.silentDays > 0) {
      parts.push(
        `${s.silentDays} ${s.silentDays === 1 ? 'day' : 'days'} inside that run of ${span} `
        + `${s.silentDays === 1 ? 'has' : 'have'} nothing recorded at all — we have counted `
        + `${s.silentDays === 1 ? 'it' : 'them'} as neither kept nor skipped.`);
    }
  }
  return parts.join(' ');
}

/**
 * Why a run cannot be stated as a plain number, or null when it can.
 *
 * The screen uses this to decide whether the figure needs a sentence under it
 * at all, without re-deriving either condition. Null means the number is a
 * fact: every day of the run has a row and the run ended somewhere we could
 * see.
 */
export function habitStreakCaveat(s: HabitStreak): 'read' | 'silence' | 'both' | null {
  if (s.days <= 0) return null;
  // Silence above the run and silence inside it are two different sentences in
  // `habitStreakNote`, and one flag here, because the question this answers is
  // "does the number need a sentence under it" and both answer it yes.
  const silence = s.silentDays > 0 || s.silentAbove > 0;
  if (s.bounded && silence) return 'both';
  if (s.bounded) return 'read';
  if (silence) return 'silence';
  return null;
}
