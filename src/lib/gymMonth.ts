// Which month it is AT THE GYM, and the month a gym's key names on the gym's
// own clock.
//
// The month-level sibling of `gymDay` in src/lib/gymZone.ts, and the missing
// half of `cutAtGym` in src/lib/gymWindow.ts. It resolves no zone of its own:
// every calendar answer in here comes out of `gymDay`, and every bound comes
// out of `cutAtGym`, which comes out of `gymDayBounds`. One implementation of
// a calendar rule, for the reason gymZone.ts's own header gives — two of them
// is how a Sunday's takings end up in two places.
//
// ── The defect this closes ────────────────────────────────────────────────
//
// A month has two halves and each was wrong in its own way.
//
// The BOUNDS half. `monthWindow(key)` in src/lib/monthEnd.ts builds its
// instants with `new Date(y, mo - 1, 1)` — midnight on whichever laptop is
// open. `firstDay`/`lastDay` beside them are pure string arithmetic and are
// perfectly correct, so a screen filtering a `date` column has never had this
// bug; a screen filtering `gym_payments.taken_at` or `sessions.starts_at` —
// both `timestamptz` — has had it on every read. `cutAtGym` was written for
// exactly that and /accounting and /tax already use it. /close and the owner
// app's financial review did not, which is the wider surface: an owner in
// London closing a Dubai gym asks for August between 2026-07-31T23:00Z and
// 2026-08-31T23:00Z, when the gym's August ran 2026-07-31T20:00Z to
// 2026-08-31T20:00Z. Four hours of takings on each boundary land in the wrong
// month — and on /close that is not a chart, it is a snapshot written into
// `gym_month_closes` and handed to an accountant. Once the close is written the
// misfiling is permanent.
//
// The KEY half, which `cutAtGym` cannot reach because it takes a key rather
// than deriving one. `monthKeyOf(Date.now())` and `recentMonths(count)` in
// monthEnd.ts read the device's calendar to decide WHICH month is running and
// which one has just finished. On the 1st of a month those two questions have
// two answers for four hours at a Gulf gym, and /close opens on
// `recentMonths(2)[1]` — so an owner in London opening the console at 01:00 on
// 1 September is offered July to close, four hours after the gym finished
// August. `gymMonthNow` and `gymRecentMonths` below are those two functions
// asked on the gym's clock instead.
//
// ── What a gym with no timezone gets ──────────────────────────────────────
//
// `tenants.timezone` is NULL on every tenant on production today, so the
// fallback is not an edge case, it is the only path anybody is on. It behaves
// exactly as `gymTodayWindow` and `rotaClock` already do: the reader's own
// calendar, AND `whoseClockNote` saying so in the wording the rest of the
// console uses. `basis` names which calendar was actually used, so a screen
// cannot print a confident caption over the fallback without going out of its
// way to.
//
// A helper that silently fell back would be the same defect with a nicer
// signature — a screen above it could no longer tell that it had happened, and
// the whole point of the earlier fixes on this surface is that the screen says.
//
// Framework-free, like the rest of src/lib. `now` and `zone` both arrive as
// arguments, so this is assertable under plain node with no clock and no
// database.

import { gymDay } from './gymZone';
import { whoseClockNote } from './gymWhen';
import { cutAtGym, type AtGym } from './gymWindow';
import { isMonthKey, monthsBefore } from './closeCosts';
import { monthWindow, monthKeyOf, type MonthKey, type MonthWindow } from './monthEnd';

/** Which calendar a month answer was actually cut on. Never a guess — the same
 *  two-value shape `DayBasis` in src/lib/gymToday.ts uses, and for the same
 *  reason: the caller has to be able to caption it honestly. */
export type MonthBasis =
  /** `tenants.timezone` was set and usable. This is the gym's own month. */
  | 'gym'
  /** The gym has not set a zone, so this is the reader's month and says so. */
  | 'reader';

export interface GymMonthNow {
  /** 'YYYY-MM', on whichever calendar `basis` names. */
  key: MonthKey;
  basis: MonthBasis;
  /** The zone the month was measured in when `basis` is 'gym'. Null otherwise:
   *  the reader's zone is not a fact about the gym, and `readerZone()` in
   *  src/lib/gymZone.ts is where a screen may ask what its own machine thinks. */
  zone: string | null;
  /** The sentence to print beside anything cut on this month, or null when
   *  there is nothing to disclose. One wording, from `whoseClockNote`. */
  note: string | null;
}

/**
 * The month an instant falls in AT THE GYM, as 'YYYY-MM'.
 *
 * Null for the same three nothings `gymDay` returns null for — no instant, no
 * zone, a zone this runtime cannot resolve — because it IS `gymDay`, sliced.
 * Derived rather than computed a second time so the month and the day can never
 * disagree about which month it is at the gym.
 *
 * `slice(0, 7)` here is not the `slice(0, 10)` the house rule warns about:
 * `gymDay` has already spent the zone and returned the gym's own calendar date,
 * so what is being sliced is a plain 'YYYY-MM-DD' and not a timestamptz.
 */
export function gymMonthKey(
  at: string | number | Date | null | undefined,
  zone: string | null | undefined,
): MonthKey | null {
  const day = gymDay(at, zone);
  return day ? day.slice(0, 7) : null;
}

/**
 * The month running at the gym right now, or the reader's month said out loud.
 *
 * This is what `monthKeyOf()` should have been on every screen that means "the
 * gym's current month". `monthKeyOf` itself is not wrong — it is the month a
 * given instant falls in on the local calendar, which is the right answer for a
 * picker labelling months to the person reading them — but a screen that uses
 * it to decide which month to CLOSE has asked the laptop a question only the
 * gym can answer.
 *
 * The fallback is `monthKeyOf(now)` and not UTC's month. UTC is nobody's, and
 * the reader's is at least the calendar the reader is looking at their own
 * clock on; the note is what stops it being passed off as the gym's.
 */
export function gymMonthNow(
  zone: string | null | undefined,
  now: number | Date = Date.now(),
): GymMonthNow {
  const key = gymMonthKey(now, zone);
  if (key) return { key, basis: 'gym', zone: String(zone), note: null };
  return { key: monthKeyOf(now), basis: 'reader', zone: null, note: whoseClockNote(zone) };
}

export interface GymMonths {
  /** `count` month keys, NEWEST FIRST, starting from the month running on
   *  whichever calendar `basis` names. The same order `recentMonths` returns,
   *  because the pickers that consume it render it top to bottom. */
  keys: MonthKey[];
  basis: MonthBasis;
  zone: string | null;
  note: string | null;
}

/**
 * The last `count` months at the gym, newest first, including the one running.
 *
 * The zone-aware `recentMonths`. Only the FIRST key needs a clock at all —
 * after that it is arithmetic on two integers, which is what `monthsBefore` in
 * src/lib/closeCosts.ts already does and why this borrows it rather than
 * stepping a `Date` the way `recentMonths` does. Stepping a Date puts every
 * later key back on the reader's calendar even when the first one was the
 * gym's, which would be this defect surviving its own fix.
 */
export function gymRecentMonths(
  count: number,
  zone: string | null | undefined,
  now: number | Date = Date.now(),
): GymMonths {
  const head = gymMonthNow(zone, now);
  const n = Math.max(0, Math.floor(count));
  const keys = n === 0 ? [] : [head.key, ...monthsBefore(head.key, n - 1)];
  return { keys, basis: head.basis, zone: head.zone, note: head.note };
}

/**
 * Whether a month is OVER at the gym.
 *
 * Compared as month keys rather than as instants, deliberately. `monthEnded` in
 * monthEnd.ts asks `now >= Date.parse(w.toIso)`, and `w.toIso` is the device's
 * midnight — so a London reader is told a Dubai gym's August is over four hours
 * before it is, on the screen whose entire job is to refuse a month that has
 * not finished. Two keys compare as strings because 'YYYY-MM' sorts
 * chronologically, and neither side of the comparison has an instant in it to
 * put on the wrong clock.
 *
 * With no zone this is the reader's month against the key, which is what the
 * screen was already doing; `gymMonthNow(zone, now).note` is the sentence that
 * says so and the caller is expected to be printing it already.
 */
export function gymMonthEnded(
  key: MonthKey,
  zone: string | null | undefined,
  now: number | Date = Date.now(),
): boolean {
  if (!isMonthKey(key)) return false;
  return gymMonthNow(zone, now).key > key;
}

/**
 * A month key → that month's window, cut on the gym's own clock, with the
 * caption that says whose clock it was.
 *
 * The one call a screen holding a month key should make. `monthWindow` builds
 * the calendar days — which are right in any zone and are left alone — and
 * `cutAtGym` moves `fromIso`/`toIso` onto the gym's clock, computing each end
 * from the next day's midnight so a month containing a clock change is 23 or 25
 * hours longer than a fixed multiple of 24 rather than an hour out.
 *
 * Null only for a key that is not a month, which is the one input for which
 * there is no honest window to return. A gym with no zone gets the device's
 * bounds and `basis: 'device'` on the result, not null: refusing the whole
 * screen over an unset setting would be a worse answer than the one it
 * replaces, and it is the CAPTION that must not survive — see the header of
 * src/lib/gymWindow.ts.
 */
export function monthAtGym(
  key: MonthKey,
  zone: string | null | undefined,
): AtGym<MonthWindow> | null {
  const base = monthWindow(key);
  return base ? cutAtGym(base, zone) : null;
}
