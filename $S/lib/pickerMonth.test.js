"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The month a picker is keyed on. Compile with tsc, run with node.
//
// Two properties, and the second is the one that stops a loop rather than a
// wrong month:
//
//   1. The tick names the LOCAL calendar month. Every screen that spends it
//      compares its output against `monthKeyOf`, which is local, and this suite
//      runs under six timezones — so nothing here may be written in UTC or it
//      would pass in one of them and fail in the others.
//   2. The tick is CONSTANT within a month and moves by exactly one at the
//      boundary. That is the whole reason the console keys its pickers on this
//      rather than on the read instant: a value that changed on every refresh
//      would rebuild the selected period object, and on the screens whose read
//      is fired by an effect keyed on that object, the read would stamp an
//      instant that rebuilt the period that fired the read.
const pickerMonth_1 = require("./pickerMonth");
// The suite is a failure until it reaches the end, so a throw or an early exit
// cannot leave a zero status behind and pass silently.
process.exitCode = 1;
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/** A local instant, built the way every one of these pickers builds its months:
 *  the local Date constructor, never a UTC string. */
const at = (y, m, d, h = 12, min = 0) => new Date(y, m, d, h, min, 0, 0).getTime();
/* ── constant within a month ───────────────────────────────────────────────
 *
 * The first millisecond of the month, the middle of it, and the last: one
 * answer. A picker keyed on this is rebuilt once a month and not once a read. */
{
    const first = (0, pickerMonth_1.monthTick)(at(2026, 8, 1, 0, 0));
    eq((0, pickerMonth_1.monthTick)(at(2026, 8, 15)), first, 'the middle of September is September');
    eq((0, pickerMonth_1.monthTick)(at(2026, 8, 30, 23, 59)), first, 'and the last minute of it still is');
    eq((0, pickerMonth_1.monthTick)(at(2026, 8, 1, 0, 0) + 1), first, 'one millisecond past midnight on the 1st has not moved it');
}
/* ── one more at the boundary ─────────────────────────────────────────────── */
{
    eq((0, pickerMonth_1.monthTick)(at(2026, 9, 1, 0, 0)) - (0, pickerMonth_1.monthTick)(at(2026, 8, 30, 23, 59)), 1, 'midnight on 1 October is exactly one month past the last minute of September — this is the moment a month picker must gain a month');
    eq((0, pickerMonth_1.monthTick)(at(2027, 0, 1)) - (0, pickerMonth_1.monthTick)(at(2026, 11, 31)), 1, 'and across the year boundary, where a naive month-only counter goes backwards by eleven');
    eq((0, pickerMonth_1.monthTick)(at(2026, 11, 1)) - (0, pickerMonth_1.monthTick)(at(2026, 0, 1)), 11, 'January to December of one year is eleven months');
}
/* ── never backwards ──────────────────────────────────────────────────────── */
{
    let prev = (0, pickerMonth_1.monthTick)(at(2025, 0, 1));
    let rises = 0;
    for (let i = 1; i < 36; i++) {
        // Walked by the local calendar, so a month with 28 days and one with 31 are
        // both one step. A day-count walk would drift and this would be a test of
        // arithmetic rather than of the calendar.
        const t = (0, pickerMonth_1.monthTick)(at(2025, i, 1));
        eq(t - prev, 1, `month ${i} is one past month ${i - 1}`);
        if (t > prev)
            rises += 1;
        prev = t;
    }
    eq(rises, 35, 'three years of months, every one of them a single step forward');
}
/* ── the round trip a picker actually spends ──────────────────────────────
 *
 * The screens hand `monthTickStart(tick).getTime()` to `recentMonths` and to the
 * quarter builders, so that a picker built from a tick is a pure function of the
 * tick. That is only true if the start lands inside the month the tick names. */
{
    for (const [y, m, d] of [[2026, 8, 17], [2026, 0, 1], [2026, 11, 31], [2024, 1, 29]]) {
        const tick = (0, pickerMonth_1.monthTick)(at(y, m, d));
        const start = (0, pickerMonth_1.monthTickStart)(tick);
        eq((0, pickerMonth_1.monthTick)(start.getTime()), tick, `${y}-${m + 1}: the start of a tick's month is in that month`);
        eq(start.getDate(), 1, `${y}-${m + 1}: and it is the first of it`);
        eq(start.getHours(), 0, `${y}-${m + 1}: at local midnight, which is what makes the month it names the local one`);
        eq(start.getFullYear(), y, `${y}-${m + 1}: same year`);
        eq(start.getMonth(), m, `${y}-${m + 1}: same month`);
    }
}
/* ── the default is the clock, and it is the only place one is read ───────── */
{
    const before = (0, pickerMonth_1.monthTick)(Date.now());
    const dflt = (0, pickerMonth_1.monthTick)();
    const after = (0, pickerMonth_1.monthTick)(Date.now());
    ok(dflt === before || dflt === after, 'called with no argument it reads the clock — the same shape every other library function in this tree uses, so a call site that passes nothing is still answering about now');
}
if (errors.length) {
    console.error(`pickerMonth: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    for (const e of errors)
        console.error(`  ✗ ${e}`);
    process.exit(1);
}
process.exitCode = 0;
console.log('pickerMonth: ok — a month picker gains a month when the month turns over, and is otherwise still');
