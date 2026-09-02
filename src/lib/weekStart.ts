// Which day a week starts on. Stated once, for every app and the console.
//
// ── Why this file exists ───────────────────────────────────────────────────
//
// Before it, fourteen files each wrote `(d.getDay() + 6) % 7` and each kept its
// own `['Mon', … 'Sun']` beside it. That is not a convention, it is fourteen
// independent decisions that happened to agree, and the way it fails is that
// somebody changes twelve of them. Half a product on one week and half on the
// other is worse than either, because every figure still reads like a figure.
//
// So: the start day is written ONCE, below, and everything that needs to know
// where a date sits in a week, when a week opened, or what the seven columns
// are called, asks here. Changing the product's mind later is one edit.
//
// ── Sunday, and not from the locale ────────────────────────────────────────
//
// Sunday because that is the decision. NOT `Intl` and not the device region:
// a locale-derived answer gives two members of the same gym different weeks,
// so the same seven sessions land in different buckets on two handsets and the
// "this week" on a coach's console disagrees with the one on their client's
// phone. That is a different product — one where a week is a personal setting —
// and it is not this one.
//
// ── What this file does NOT own ────────────────────────────────────────────
//
// Label lookups indexed by `Date.getDay()` — `['Sun','Mon',…][d.getDay()]` in
// calendar.tsx, classes.tsx, chat.tsx, coachWeek.ts, reminderPlan.ts — are
// correct for ANY start day, because they are answering "what is this date
// called", not "where does it sit in a week". They are deliberately left alone.
//
// Nor does it own anything already STORED against a Monday. See the note on
// `weekIndexOf` and, for the one stored case that mattered, `PLAN_VERSION` in
// src/lib/mealPlan.ts.

/**
 * The day a week opens on, in `Date.getDay()` numbering: 0 Sunday … 6 Saturday.
 *
 * THIS IS THE ONE PLACE. Every ordering, offset and boundary in the product is
 * derived from it, so moving the product to Monday is this line and nothing
 * else. Do not re-derive it from a locale, a tenant setting or a device — see
 * the header.
 */
export const WEEK_STARTS_ON = 0;

/** The start day's own name, for copy that has to say it out loud. */
export const WEEK_START_NAME = 'Sunday';

/** Day names in `Date.getDay()` order, which is what indexes them. */
const NAMES_BY_JS_DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const ABBR_BY_JS_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * Where a `getDay()`/`getUTCDay()` value sits in the week: 0 is the first
 * column, 6 the last.
 *
 * The `+ 7` is not decoration. `WEEK_STARTS_ON` is a constant a later editor
 * may raise, and `(0 - 6) % 7` is `-1` in JavaScript, not `6`.
 */
export function dayIndexInWeek(jsDay: number): number {
  return ((jsDay - WEEK_STARTS_ON) % 7 + 7) % 7;
}

/** The inverse: the `getDay()` value sitting at column `index`. */
export function jsDayForIndex(index: number): number {
  return ((index + WEEK_STARTS_ON) % 7 + 7) % 7;
}

/** The seven day labels in the order a week is drawn. */
export const WEEK_DAYS: readonly string[] =
  Array.from({ length: 7 }, (_, i) => ABBR_BY_JS_DAY[jsDayForIndex(i)]);

/** The same seven, written out — for a picker or a sentence. */
export const WEEK_DAY_NAMES: readonly string[] =
  Array.from({ length: 7 }, (_, i) => NAMES_BY_JS_DAY[jsDayForIndex(i)]);

/**
 * Where a local date sits in its week.
 *
 * Local, because every screen that draws a week draws the reader's own week.
 * A caller holding a bare `YYYY-MM-DD` must build its Date with the local
 * constructor first (`localDate` in src/lib/localDate.ts) — `Date.parse` on a
 * bare date resolves to UTC midnight and hands back the previous day west of
 * Greenwich, which is a whole column of the grid.
 */
export function weekIndexOf(d: Date): number {
  return dayIndexInWeek(d.getDay());
}

/** Where a date sits in its week, read in UTC. For callers already bucketing
 *  in UTC and staying there — `weeklyAttendance` in gymSchedule.ts is the one. */
export function utcWeekIndexOf(d: Date): number {
  return dayIndexInWeek(d.getUTCDay());
}

/**
 * Local midnight of the day that opened the week `d` falls in.
 *
 * A new Date every time: mutating the caller's is how a loop that pages back a
 * week at a time quietly walks off the end of the month.
 */
export function startOfWeek(d: Date | number = Date.now()): Date {
  const x = d instanceof Date ? new Date(d.getTime()) : new Date(d);
  x.setHours(0, 0, 0, 0);
  // setDate, not a millisecond subtraction: arithmetic on the calendar rather
  // than on the clock, so a week containing a clocks change is still seven days.
  x.setDate(x.getDate() - weekIndexOf(x));
  return x;
}

/** UTC midnight of the day that opened the week `d` falls in. The UTC sibling
 *  of `startOfWeek`, for callers that bucket in UTC on purpose. */
export function startOfWeekUTC(d: Date | number = Date.now()): Date {
  const src = d instanceof Date ? d : new Date(d);
  const x = new Date(Date.UTC(src.getUTCFullYear(), src.getUTCMonth(), src.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - utcWeekIndexOf(x));
  return x;
}

/** `YYYY-MM-DD` from a Date's LOCAL parts. Never `toISOString()`, which is the
 *  UTC day and is the previous one for half the world. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The local ISO date of the day that opened the week `at` falls in. */
export function weekStartIso(at: Date | number = Date.now()): string {
  return isoDay(startOfWeek(at));
}
