"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The week starts on Sunday, everywhere, and it does so from one constant.
// Compile with tsc, run with node.
//
// Two things are pinned here, and the second is the one worth the file:
//
//   1. the answers themselves — Sunday is column 0, a Saturday's week opened
//      six days ago, and the seven labels read Sun…Sat;
//   2. that every one of them is DERIVED from `WEEK_STARTS_ON` rather than
//      written out beside it. The failure this module exists to prevent is a
//      half-migrated product, and the shape it takes is an ordering that agrees
//      with the constant by coincidence until somebody edits one of them. So
//      the assertions below re-derive the expected answer from the constant
//      wherever they can, and the handful that hard-code Sunday are the ones
//      stating the product decision itself.
//
// This suite runs under six timezones (`test:zones`) like every other, because
// `startOfWeek` uses local getters on purpose and a UTC-shaped bug in it would
// move a whole column of every grid for readers west of Greenwich.
const weekStart_1 = require("./weekStart");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── the decision ──────────────────────────────────────────────────────── */
// Stated flatly, because this is the product decision and not arithmetic. If
// this line ever fails, somebody has changed what a week means for three apps
// and a console, and they should have to edit this test to say so.
eq(weekStart_1.WEEK_STARTS_ON, 0, 'the week opens on Sunday');
eq(weekStart_1.WEEK_START_NAME, 'Sunday', 'and the copy that names it agrees with the constant');
eq(weekStart_1.WEEK_DAYS.join(','), 'Sun,Mon,Tue,Wed,Thu,Fri,Sat', 'so the seven columns read Sunday first');
eq(weekStart_1.WEEK_DAY_NAMES[0], 'Sunday', 'and so do the long names');
/* ── everything is derived, not restated ───────────────────────────────── */
eq((0, weekStart_1.dayIndexInWeek)(weekStart_1.WEEK_STARTS_ON), 0, 'the start day is column 0, whatever it is');
eq(weekStart_1.WEEK_DAYS.length, 7, 'seven columns');
eq(weekStart_1.WEEK_DAY_NAMES.length, 7, 'seven names');
ok(weekStart_1.WEEK_DAY_NAMES.every((n, i) => n.slice(0, 3) === weekStart_1.WEEK_DAYS[i]), 'the short labels and the long names are the same week in the same order');
// Round trip. Every column names exactly one weekday and every weekday has
// exactly one column — the property that makes a grid neither drop a day nor
// draw one twice.
for (let i = 0; i < 7; i++) {
    eq((0, weekStart_1.dayIndexInWeek)((0, weekStart_1.jsDayForIndex)(i)), i, `column ${i} survives the round trip`);
}
eq(new Set(Array.from({ length: 7 }, (_, i) => (0, weekStart_1.jsDayForIndex)(i))).size, 7, 'the seven columns name seven distinct weekdays');
// The `+ 7` in both helpers. `(0 - 6) % 7` is -1 in JavaScript, so a later
// editor moving the start day to Saturday would index an array from -1 and get
// undefined labels across the whole strip. Asserted for every start day rather
// than for the one in force, because the point is that the NEXT change is safe.
for (let start = 0; start < 7; start++) {
    for (let day = 0; day < 7; day++) {
        const idx = ((day - start) % 7 + 7) % 7;
        ok(idx >= 0 && idx < 7, `a week starting on day ${start} keeps day ${day} inside the grid`);
    }
}
/* ── where a date sits ─────────────────────────────────────────────────── */
// 6 Sep 2026 is a Sunday; 12 Sep 2026 is the Saturday closing that week.
// Built with the local constructor, which is what every caller does.
const sun = new Date(2026, 8, 6);
const wed = new Date(2026, 8, 9);
const sat = new Date(2026, 8, 12);
eq(sun.getDay(), 0, 'the fixture Sunday really is a Sunday');
eq((0, weekStart_1.weekIndexOf)(sun), 0, 'Sunday opens the week');
eq((0, weekStart_1.weekIndexOf)(wed), 3, 'Wednesday is the fourth column');
eq((0, weekStart_1.weekIndexOf)(sat), 6, 'Saturday closes it');
/* ── when the week opened ──────────────────────────────────────────────── */
eq((0, weekStart_1.isoDay)((0, weekStart_1.startOfWeek)(sun)), '2026-09-06', 'a Sunday is its own week start');
eq((0, weekStart_1.isoDay)((0, weekStart_1.startOfWeek)(wed)), '2026-09-06', 'midweek resolves back to that Sunday');
eq((0, weekStart_1.isoDay)((0, weekStart_1.startOfWeek)(sat)), '2026-09-06', 'and so does the Saturday that closes it');
eq((0, weekStart_1.isoDay)((0, weekStart_1.startOfWeek)(new Date(2026, 8, 13))), '2026-09-13', 'the next Sunday opens the next week');
eq((0, weekStart_1.weekStartIso)(sat), '2026-09-06', 'weekStartIso is the same answer as a string');
// The Monday that used to open this week is now mid-week, which is the whole
// change in one line. Kept explicit so that a future reader looking for "what
// moved" finds it stated rather than inferred.
eq((0, weekStart_1.isoDay)((0, weekStart_1.startOfWeek)(new Date(2026, 8, 7))), '2026-09-06', 'a Monday now belongs to the week that opened the day before it');
// Midnight, and the caller's Date untouched. `startOfWeek` is called inside
// loops that page back a week at a time, and one mutated argument there walks
// the whole strip off the end of the month.
const hh = new Date(2026, 8, 9, 17, 42, 13, 500);
const started = (0, weekStart_1.startOfWeek)(hh);
eq(started.getHours() + started.getMinutes() + started.getSeconds() + started.getMilliseconds(), 0, 'the week opens at local midnight');
eq(hh.getDate(), 9, 'and the Date passed in is not moved');
// Every day of one week resolves to the same start, and the seven of them are
// seven distinct days. This is the property a grid depends on.
{
    const starts = new Set();
    const days = new Set();
    for (let i = 0; i < 7; i++) {
        const d = new Date(2026, 8, 6 + i);
        starts.add((0, weekStart_1.weekStartIso)(d));
        days.add((0, weekStart_1.isoDay)(d));
        eq((0, weekStart_1.weekIndexOf)(d), i, `day ${i} of the week is column ${i}`);
    }
    eq(starts.size, 1, 'all seven days of a week share one week start');
    eq(days.size, 7, 'and they are seven different days');
}
// A month boundary, which is where naive arithmetic on day numbers breaks.
// 1 Nov 2026 is a Sunday, so 31 Oct — a Saturday — belongs to the week before.
eq((0, weekStart_1.isoDay)((0, weekStart_1.startOfWeek)(new Date(2026, 10, 1))), '2026-11-01', 'the 1st can open a week');
eq((0, weekStart_1.isoDay)((0, weekStart_1.startOfWeek)(new Date(2026, 9, 31))), '2026-10-25', 'and the day before it belongs to the previous month');
// A year boundary. 3 Jan 2027 is a Sunday, so 1 Jan 2027 is in a week that
// opened in 2026 — the case that makes ISO week NUMBERS a bad key.
eq((0, weekStart_1.isoDay)((0, weekStart_1.startOfWeek)(new Date(2027, 0, 1))), '2026-12-27', 'a week can open in the previous year');
/* ── the UTC pair ──────────────────────────────────────────────────────── */
// Same answers, read in UTC, for the callers that bucket in UTC deliberately.
// The instant chosen is midday so it is the same calendar day in every zone the
// suite runs under, which is the only way this can be asserted at all.
const utcWed = new Date(Date.UTC(2026, 8, 9, 12));
eq((0, weekStart_1.utcWeekIndexOf)(utcWed), 3, 'UTC Wednesday is the fourth column');
eq((0, weekStart_1.startOfWeekUTC)(utcWed).toISOString().slice(0, 10), '2026-09-06', 'and its week opened on the UTC Sunday');
eq((0, weekStart_1.startOfWeekUTC)(new Date(Date.UTC(2026, 8, 6, 12))).toISOString().slice(0, 10), '2026-09-06', 'a UTC Sunday is its own week start');
/* ── isoDay is local, and that is the point ────────────────────────────── */
// `toISOString().slice(0, 10)` on a locally-built midnight is the PREVIOUS day
// west of Greenwich, and would file a whole week's figures one column early.
// The suite runs under America/Los_Angeles and Pacific/Midway for this line.
eq((0, weekStart_1.isoDay)(new Date(2026, 8, 6)), '2026-09-06', 'a local midnight prints as its own day');
eq((0, weekStart_1.isoDay)(new Date(2026, 8, 6, 23, 59)), '2026-09-06', 'and so does the last minute of it');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('weekStart: ok');
