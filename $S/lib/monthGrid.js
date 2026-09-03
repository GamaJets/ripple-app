"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isLeapYear = isLeapYear;
exports.daysInMonth = daysInMonth;
exports.weekdayOf = weekdayOf;
exports.normalMonth = normalMonth;
exports.stepMonth = stepMonth;
exports.monthGrid = monthGrid;
exports.gridRows = gridRows;
exports.isoFromParts = isoFromParts;
exports.todayParts = todayParts;
exports.openMonth = openMonth;
// The arithmetic behind a month grid, with no Date in it.
//
// ── Why this is a module and not twelve lines in a screen ─────────────────
//
// app/(client)/calendar.tsx already draws a month, and it computes the grid
// inline:
//
//     const first = new Date(viewYear, viewMonth, 1);
//     const startDow = first.getDay();
//     const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
//
// That is correct today and it is correct by accident in two places. `getDay()`
// on a locally-constructed date is a local weekday, which is fine — until a
// zone where local midnight does not exist (Africa/Cairo and Iran both skip it
// on a DST boundary; `new Date(y, m, 1)` then lands on 01:00 of the same day,
// or, in the zones that have historically skipped a whole day for a date-line
// move, on a different day entirely). And `new Date(y, m + 1, 0).getDate()` is
// the last day of the previous month read back through a local getter, which is
// three chances for a zone to be involved in a question that has nothing to do
// with one.
//
// A calendar month is pure integer arithmetic. February 2024 has 29 days in
// Auckland and in Los Angeles, 1 September 2026 is a Tuesday in both, and
// neither fact should be routed through the system clock's idea of an instant.
// So nothing below constructs a Date at all except `todayParts`, which is the
// one function here that is genuinely asking "what day is it where the reader
// is standing", and which therefore uses the LOCAL getters on purpose.
//
// ── What consumes it ──────────────────────────────────────────────────────
//
// `src/ui/DateSheet.tsx` — the month sheet a coach taps a `YYYY-MM-DD` field to
// open. The names down the side are NOT here: `src/lib/calendarNames.ts` owns
// the twelve months and the seven weekdays in the reader's own language, and
// this file owns only where the numbers go.
//
// ── The week starts where the product says it starts ──────────────────────
//
// Sunday, from `WEEK_STARTS_ON` in src/lib/weekStart.ts, through
// `dayIndexInWeek`. Not from the locale — see that file's header for why a
// locale-derived week gives two members of the same gym different weeks — and
// not hardcoded here, so that moving the product to Monday stays one edit.
const weekStart_1 = require("./weekStart");
const localDate_1 = require("./localDate");
/** Is this a leap year, by the Gregorian rule rather than by `% 4`? 1900 was
 *  not a leap year and 2000 was, and a grid that gets either wrong draws a
 *  29 February that does not exist. */
function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
/** Days in a month, `month` being 0-11 as everywhere else in this codebase. */
function daysInMonth(year, month) {
    const m = normalMonth(year, month);
    if (m.month === 1)
        return isLeapYear(m.year) ? 29 : 28;
    return [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m.month];
}
/**
 * The weekday of a Gregorian date, 0 Sunday … 6 Saturday, computed rather than
 * looked up from a Date.
 *
 * Sakamoto's method. The reason it is here rather than `new Date(y, m, d)
 * .getDay()` is the header's: this is a fact about a calendar, and involving an
 * instant in it is how a grid comes to differ between two handsets. It is also
 * the only form that can be asserted honestly in a test that runs under six
 * timezones — a Date-based one asserts that the runner's zone is ordinary.
 */
function weekdayOf(year, month, day) {
    const m = normalMonth(year, month);
    // January and February are counted as months 13 and 14 of the previous year,
    // which is what moves the leap day to the end where the shifts can ignore it.
    const y = m.month < 2 ? m.year - 1 : m.year;
    const shift = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4][m.month];
    const n = y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + shift + day;
    // `% 7` on a negative year would be negative; years before 1 are not a thing
    // this app draws, but a modulo that can hand back -3 is not worth keeping.
    return ((n % 7) + 7) % 7;
}
/** A year and a month index put back in range, carrying into the year. Month 12
 *  of 2026 is January 2027; month -1 of 2026 is December 2025. Every other
 *  function here starts by calling it, so none of them has an opinion about
 *  what an out-of-range month means. */
function normalMonth(year, month) {
    const total = year * 12 + Math.trunc(month);
    const y = Math.floor(total / 12);
    return { year: y, month: total - y * 12 };
}
/**
 * The month `delta` months away. The whole of the "December → January" and
 * "January → December" behaviour lives here, so that no screen writes
 * `month + 1 > 11 ? …` again.
 */
function stepMonth(year, month, delta) {
    return normalMonth(year, month + delta);
}
/**
 * The grid for one month.
 *
 * The blanks are `null` rather than the neighbouring months' day numbers on
 * purpose: a cell showing "30" that belongs to the previous month is a cell a
 * coach can tap by mistake, and the sheet this feeds has one job — set a date
 * the coach meant. A blank cannot be tapped and cannot be misread.
 */
function monthGrid(year, month) {
    const m = normalMonth(year, month);
    const days = daysInMonth(m.year, m.month);
    const leading = (0, weekStart_1.dayIndexInWeek)(weekdayOf(m.year, m.month, 1));
    const cells = [];
    for (let i = 0; i < leading; i++)
        cells.push(null);
    for (let d = 1; d <= days; d++)
        cells.push(d);
    const trailing = (7 - (cells.length % 7)) % 7;
    for (let i = 0; i < trailing; i++)
        cells.push(null);
    return { year: m.year, month: m.month, days, leading, trailing, weeks: cells.length / 7, cells };
}
/** The grid's cells cut into rows of seven, for a renderer that wants to map
 *  twice rather than slice by hand. */
function gridRows(grid) {
    const rows = [];
    for (let i = 0; i < grid.cells.length; i += 7)
        rows.push(grid.cells.slice(i, i + 7));
    return rows;
}
/**
 * `YYYY-MM-DD` from three numbers.
 *
 * Built from parts and never from `toISOString()`, which is UTC's calendar day
 * and is the previous one for every reader west of Greenwich — see
 * scripts/check-utc-day.mjs, which enforces exactly this, and src/lib/localDate.ts
 * for the two shipped bugs that came of it.
 */
function isoFromParts(year, month, day) {
    const m = normalMonth(year, month);
    return `${String(m.year).padStart(4, '0')}-${String(m.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
/**
 * The calendar day the reader is standing in, as `[year, month, day]`.
 *
 * The one place in this file that touches a clock, and it uses the LOCAL
 * getters deliberately: "today" on a calendar means today where the reader is,
 * not in UTC. Takes the Date so a test can state one.
 */
function todayParts(now = new Date()) {
    return [now.getFullYear(), now.getMonth(), now.getDate()];
}
/**
 * Which month a sheet should open on, given whatever is already typed in the
 * field.
 *
 * The typed date's month when it reads as a date — a coach who typed
 * `2027-03-02` and reopened the sheet expects March 2027, not this month — and
 * otherwise the reader's current month. Deliberately tolerant of a half-typed
 * value: `dateParts` refuses it, and the fallback is the useful answer rather
 * than an error.
 */
function openMonth(iso, now = new Date()) {
    const p = (0, localDate_1.dateParts)(iso);
    if (p)
        return { year: p[0], month: p[1] };
    const [y, m] = todayParts(now);
    return { year: y, month: m };
}
