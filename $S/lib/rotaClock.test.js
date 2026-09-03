"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// One shift, one answer — on the phone's rota and in the console's staff page.
// Compile with tsc, run with node.
//
// ── What this suite is for ─────────────────────────────────────────────────
//
// `app/(owner)/rota.tsx` drew shift times with `getHours()` under a doc comment
// claiming the gym's wall clock, and `shiftFromHours` wrote them with
// `setHours` on the same clock. `studio-web/app/staff` rendered the same rows
// through `gymWhen`, which asks `Intl` for `timeZone: zone` and has been right
// all along. So the two screens printed different hours for the same row, and
// the one a coach is rostered from was the wrong one.
//
// The agreement is the whole point of the fix, so it is asserted here rather
// than left as a property of two files that happen to call the same helper:
// every check below computes BOTH sides — the rota's own label and bucket, and
// the console's `gymWhen`/`gymZone` rendering — and requires them equal.
//
// ── Why it must run under six timezones ────────────────────────────────────
//
// Because the defect IS the runner's zone leaking into the answer. `npm run
// test:zones` runs this under Kiritimati (+14), Auckland, Dubai, UTC, Los
// Angeles and Midway (-11); an assertion that only holds under the machine it
// was written on is testing nothing at all. Nothing below reads a literal hour
// off the device.
const rotaClock_1 = require("./rotaClock");
const gymZone_1 = require("./gymZone");
const gymWhen_1 = require("./gymWhen");
const gymRota_1 = require("./gymRota");
const weekStart_1 = require("./weekStart");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/** Four gyms far enough apart that no runner's zone can agree with all of them. */
const DUBAI = 'Asia/Dubai'; // +04, no daylight saving
const SYDNEY = 'Australia/Sydney'; // +10/+11
const LONDON = 'Europe/London'; // +00/+01
const LA = 'America/Los_Angeles'; // -08/-07
const MON = '2026-09-07'; // a Monday
const TRAINER = 't1';
const shiftOf = (id, startsAt, endsAt) => ({
    id, trainerId: TRAINER, trainerName: 'Ada', startsAt, endsAt, role: 'floor',
    status: 'scheduled', note: null,
});
/* ── 1. the write: the hours typed are the GYM's ───────────────────────────
 *
 * The half that moves somebody. An owner in London typing "06 to 14" for a
 * Dubai gym stored 10:00–18:00 gym time, and the coach turned up four hours
 * late to a screen that had never printed a wrong-looking number.
 */
for (const zone of [DUBAI, SYDNEY, LONDON, LA]) {
    const draft = (0, gymRota_1.shiftFromHours)(TRAINER, MON, 6, 14, 'floor', zone);
    ok(draft != null, `a 6–14 shift is built for ${zone}`);
    if (!draft)
        continue;
    // Read back the way studio-web/app/staff reads it: Intl, in the gym's zone.
    eq((0, gymZone_1.gymHour)(draft.startsAt, zone), 6, `the stored instant is 06:00 AT ${zone}`);
    eq((0, gymZone_1.gymHour)(draft.endsAt, zone), 14, `and finishes at 14:00 at ${zone}`);
    eq((0, gymZone_1.gymDay)(draft.startsAt, zone), MON, `on the day that was typed, at ${zone}`);
    eq((0, gymZone_1.gymDay)(draft.endsAt, zone), MON, `and ends the same day at ${zone}`);
    eq((0, gymZone_1.gymTimeLabel)(draft.startsAt, zone), '06:00', `the gym's own wall clock reads 06:00 at ${zone}`);
    // And the way app/(owner)/rota.tsx now reads it. Same instant, same zone,
    // same two numbers — this equality IS the fix.
    eq((0, rotaClock_1.rotaTimeLabel)(draft.startsAt, zone), (0, gymZone_1.gymTimeLabel)(draft.startsAt, zone), `/rota and /staff label the start of the same shift identically at ${zone}`);
    eq((0, rotaClock_1.rotaTimeLabel)(draft.endsAt, zone), (0, gymZone_1.gymTimeLabel)(draft.endsAt, zone), `and its end, at ${zone}`);
    eq((0, rotaClock_1.rotaDay)(draft.startsAt, zone), (0, gymZone_1.gymDay)(draft.startsAt, zone), `and they file it under the same day at ${zone}`);
}
{
    // The console's rendering path in full — `gymTimeText`, which is what the
    // When column actually calls. Not compared as a string against '06:00': the
    // locale decides the separator and the hour cycle, and pinning either would
    // pin the half of the question gymWhen deliberately refuses to answer. What
    // is pinned is that the console's text contains the hour /rota prints.
    const draft = (0, gymRota_1.shiftFromHours)(TRAINER, MON, 6, 14, 'floor', DUBAI);
    const consoleText = (0, gymWhen_1.gymTimeText)(draft.startsAt, DUBAI, { hour: '2-digit', minute: '2-digit' }) ?? '';
    const phoneLabel = (0, rotaClock_1.rotaTimeLabel)(draft.startsAt, DUBAI) ?? '';
    eq(phoneLabel, '06:00', 'the phone draws 06:00');
    ok(/(^|\D)0?6\D/.test(consoleText), `and the console's own When column draws the same hour — got ${consoleText}`);
}
/* ── 2. the bucket moves with the label ────────────────────────────────────
 *
 * The reason the previous lane stopped, and the reason this is one change.
 * A 23:00 gym-time shift must sit under the day it runs on at the gym, or the
 * grid prints "23:00" under tomorrow's heading — consistent-but-wrong replaced
 * by visibly broken.
 */
for (const zone of [DUBAI, SYDNEY, LA]) {
    const late = (0, gymRota_1.shiftFromHours)(TRAINER, MON, 23, 24, 'floor', zone);
    const s = shiftOf('late', late.startsAt, late.endsAt);
    const days = (0, gymRota_1.weekDays)((0, gymRota_1.weekStartOf)(Date.parse(late.startsAt), zone));
    const grouped = (0, gymRota_1.shiftsByDay)(days, [s], zone);
    const on = grouped.find((d) => d.shifts.some((x) => x.id === 'late'));
    eq(on?.date, MON, `a 23:00 shift at ${zone} is filed under the day it runs on`);
    eq((0, rotaClock_1.rotaTimeLabel)(s.startsAt, zone), '23:00', `and is labelled 23:00 at ${zone}`);
    // And the mirror of it, for a reader on the OTHER side. A 23:00 shift moves a
    // day forward for a reader far EAST of the gym and an early one moves a day
    // back for a reader far WEST, so both are needed or the bucket can stay on
    // the reader's clock and still look right from half the world.
    const early = (0, gymRota_1.shiftFromHours)(TRAINER, MON, 6, 14, 'floor', zone);
    const earlyOn = (0, gymRota_1.shiftsByDay)(days, [shiftOf('early', early.startsAt, early.endsAt)], zone)
        .find((d) => d.shifts.some((x) => x.id === 'early'));
    eq(earlyOn?.date, MON, `an 06:00 shift at ${zone} is filed under the day it runs on too`);
    eq((0, rotaClock_1.rotaTimeLabel)(early.startsAt, zone), '06:00', `and is labelled 06:00 at ${zone}`);
    const cells = (0, gymRota_1.hoursSpanned)(s.startsAt, s.endsAt, zone);
    eq(cells.length, 1, `it occupies one hour at ${zone}`);
    eq(cells[0]?.date, MON, `that hour is on ${MON} at ${zone}`);
    eq(cells[0]?.hour, 23, `and it is the 23rd hour at ${zone}`);
    eq((0, gymRota_1.hourLabel)(cells[0].hour), (0, rotaClock_1.rotaTimeLabel)(s.startsAt, zone), `the column heading and the row's own time agree at ${zone}`);
}
{
    // The same shift, seen from the OTHER side of the world. The bucket must not
    // depend on who is looking, which is the property the reader's clock broke.
    const zone = DUBAI;
    const early = (0, gymRota_1.shiftFromHours)(TRAINER, MON, 1, 5, 'floor', zone);
    eq((0, rotaClock_1.rotaDay)(early.startsAt, zone), MON, 'the gym files its own 01:00 on Monday');
    eq((0, rotaClock_1.rotaDay)(early.startsAt, LA), (0, rotaClock_1.addCalendarDays)(MON, -1), 'and the same instant is still Sunday in Los Angeles — which is why the zone has to be the GYM’s');
    eq((0, rotaClock_1.rotaHour)(early.startsAt, zone), 1, 'the gym reads it as the first hour');
    ok((0, rotaClock_1.rotaHour)(early.startsAt, LA) !== 1, 'and Los Angeles does not');
}
/* ── 3. the whole grid, at a gym twelve hours from the runner ──────────────
 *
 * Supply, demand and the verdict. A class booked at 07:00 gym time with cover
 * from 06:00 to 14:00 gym time is COVERED, from any device.
 */
for (const zone of [DUBAI, SYDNEY, LA]) {
    const cover = (0, gymRota_1.shiftFromHours)(TRAINER, MON, 6, 14, 'floor', zone);
    const shifts = [shiftOf('s1', cover.startsAt, cover.endsAt)];
    const classAt = (0, rotaClock_1.rotaInstant)(MON, 7, zone);
    const demand = [
        { kind: 'class', label: 'Spin', startsAt: classAt, durationMin: 45, trainerId: TRAINER },
    ];
    const days = (0, gymRota_1.weekDays)((0, gymRota_1.weekStartOf)(Date.parse(cover.startsAt), zone));
    const cov = (0, gymRota_1.coverage)(days, shifts, demand, zone);
    eq(cov.blocker, null, `the week has a rota at ${zone}`);
    eq(cov.uncovered?.length, 0, `the 07:00 class is covered at ${zone}`);
    eq(cov.demandHours, 1, `and it is one booked hour at ${zone}`);
    eq(cov.rosteredHours, 8, `eight rostered hours at ${zone}`);
    const grid = (0, gymRota_1.buildRota)(days, shifts, demand, zone);
    const seven = grid.find((h) => h.date === MON && h.hour === 7);
    ok(!!seven, `the 07:00 cell exists on ${MON} at ${zone}`);
    eq(seven?.classes, 1, `and holds the class at ${zone}`);
    eq(seven?.rostered.length, 1, `with somebody rostered in it at ${zone}`);
}
{
    // And the failure the reader's clock produced, written down as the thing that
    // no longer happens: the SAME rows bucketed on the reader's clock put the
    // class and the cover in a different cell than the gym's clock does, for any
    // runner not standing in Dubai.
    const zone = DUBAI;
    const cover = (0, gymRota_1.shiftFromHours)(TRAINER, MON, 6, 14, 'floor', zone);
    const classAt = (0, rotaClock_1.rotaInstant)(MON, 7, zone);
    const gymHourOfClass = (0, rotaClock_1.rotaHour)(classAt, zone);
    const readerHourOfClass = (0, rotaClock_1.rotaHour)(classAt, null);
    eq(gymHourOfClass, 7, 'the class is at 07:00 at the gym');
    if ((0, gymZone_1.readerZone)() !== zone) {
        // True in five of the six zones test:zones runs, and the assertion is
        // skipped rather than inverted in the sixth — a test that only means
        // something on five machines still has to be honest on the sixth.
        ok(readerHourOfClass !== gymHourOfClass || (0, rotaClock_1.rotaDay)(classAt, null) !== MON, 'and a reader elsewhere would have bucketed it somewhere else, which is the defect');
    }
    ok(cover.startsAt < classAt, 'cover opens before the class, on any clock');
}
/* ── 4. no zone: the reader's clock, and the sentence that says so ─────────
 *
 * The established pattern. Refusing to draw the rota at all, for every gym that
 * has not filled in a setting, takes a working screen away to make a point.
 */
{
    const c = (0, rotaClock_1.rotaClock)(null);
    eq(c.atGym, false, 'a gym with no zone is not drawn on its own clock');
    eq(c.note, rotaClock_1.NO_ZONE_NOTE, 'and the screen is handed the sentence that says so');
    eq(c.note, (0, gymWhen_1.whoseClockNote)(null), 'the same sentence studio-web already prints');
    eq((0, rotaClock_1.rotaClock)(DUBAI).atGym, true, 'a gym with a zone is drawn on it');
    eq((0, rotaClock_1.rotaClock)(DUBAI).note, null, 'and owes the reader nothing');
    eq((0, rotaClock_1.rotaClock)('EST').atGym, false, 'a fixed-offset abbreviation is not a place — isZone refuses it, and so does this');
    eq((0, rotaClock_1.rotaClock)('+04:00').atGym, false, 'nor is an offset');
    eq((0, rotaClock_1.rotaClock)('Not/AZone').atGym, false, 'nor is a name this runtime cannot resolve');
}
{
    // With no zone, a shift built from hours round-trips through the reader's own
    // clock — which is what the app has always done, now said out loud.
    const draft = (0, gymRota_1.shiftFromHours)(TRAINER, MON, 6, 14, 'floor', null);
    ok(draft != null, 'a shift is still buildable for a gym with no zone');
    if (draft) {
        eq((0, rotaClock_1.rotaHour)(draft.startsAt, null), 6, 'and it reads back as 06:00 on this device');
        eq((0, rotaClock_1.rotaDay)(draft.startsAt, null), MON, 'on the day that was typed');
        eq((0, rotaClock_1.rotaTimeLabel)(draft.startsAt, null), '06:00', 'and is labelled 06:00');
        const grouped = (0, gymRota_1.shiftsByDay)((0, gymRota_1.weekDays)((0, gymRota_1.weekStartOf)(Date.parse(draft.startsAt), null)), [shiftOf('s1', draft.startsAt, draft.endsAt)], null);
        ok(grouped.some((d) => d.date === MON && d.shifts.length === 1), 'and is bucketed under the same day it is labelled — the fallback is consistent too');
    }
}
/* ── 5. the week, on the gym's clock ───────────────────────────────────────── */
{
    eq(weekStart_1.WEEK_STARTS_ON, 0, 'a week opens on Sunday — the product decision, asserted here because this file’s grid rests on it');
    const days = (0, gymRota_1.weekDays)('2026-09-06');
    eq(days.length, 7, 'a week is seven days');
    eq(days[0], '2026-09-06', 'opening on the day it is asked about');
    eq(days[6], '2026-09-12', 'and closing six days later');
    eq((0, rotaClock_1.calendarWeekday)('2026-09-06'), 0, 'and 6 September 2026 is a Sunday');
    eq((0, gymRota_1.weekStartOf)(Date.parse('2026-09-09T12:00:00Z'), 'UTC'), '2026-09-06', 'a Wednesday belongs to the week that opened on the Sunday');
    // Calendar arithmetic, so a clocks-change week is still seven days and the
    // month boundary is where the calendar says.
    eq((0, gymRota_1.weekDays)('2026-03-29').length, 7, 'the week the European clocks go forward is seven days');
    eq((0, gymRota_1.shiftWeek)('2026-01-01', -1), '2025-12-25', 'paging back across a year end lands on the right date');
    eq((0, gymRota_1.shiftWeek)('2026-03-01', -1), '2026-02-22', 'and back across a month end');
    eq((0, rotaClock_1.addCalendarDays)('2026-02-28', 1), '2026-03-01', '2026 is not a leap year');
    eq((0, rotaClock_1.addCalendarDays)('2024-02-28', 1), '2024-02-29', 'and 2024 is');
    eq((0, rotaClock_1.addCalendarDays)('not a date', 1), null, 'nothing that is not a date has a tomorrow');
}
for (const zone of [DUBAI, SYDNEY, LA, LONDON]) {
    // The window the DATABASE is asked for is the gym's own midnights. A window
    // built on the reader's would read six hours of the wrong days at each end.
    const w = (0, gymRota_1.weekWindow)('2026-09-06', zone);
    ok(w != null, `a week window is built for ${zone}`);
    if (!w)
        continue;
    eq((0, gymZone_1.gymDay)(w.fromISO, zone), '2026-09-06', `the window opens on the gym's own Sunday at ${zone}`);
    eq((0, gymZone_1.gymHour)(w.fromISO, zone), 0, `at the gym's own midnight at ${zone}`);
    eq((0, gymZone_1.gymDay)(w.toISO, zone), '2026-09-13', `and closes on the NEXT Sunday at ${zone}`);
    eq((0, gymZone_1.gymHour)(w.toISO, zone), 0, `at that midnight too, half-open at ${zone}`);
    ok(Date.parse(w.toISO) - Date.parse(w.fromISO) === 7 * 24 * 3600000, `and a week with no clock change in it is exactly seven days at ${zone}`);
}
{
    // The week that DOES contain a clock change is not seven times twenty-four
    // hours, and the window has to be the two midnights rather than a multiple.
    // Europe/London goes forward at 01:00 on 29 March 2026.
    const w = (0, gymRota_1.weekWindow)('2026-03-29', LONDON);
    const hours = (Date.parse(w.toISO) - Date.parse(w.fromISO)) / 3600000;
    eq(hours, 167, 'the week the clocks go forward in London is 167 hours, and the window says so');
    eq((0, gymZone_1.gymDay)(w.fromISO, LONDON), '2026-03-29', 'and it still opens on the gym’s own Sunday');
}
/* ── 6. spans, minutes and the shapes that are not a shift ────────────────── */
{
    const zone = DUBAI;
    // 17:30–18:15 occupies 17 and 18: the floor needs somebody for both.
    const start = (0, gymZone_1.instantAtGym)('2026-09-07T17:30', zone);
    const end = (0, gymZone_1.instantAtGym)('2026-09-07T18:15', zone);
    const cells = (0, gymRota_1.hoursSpanned)(start, end, zone);
    eq(cells.length, 2, 'a 17:30–18:15 class touches two hours');
    eq(cells[0]?.hour, 17, 'the hour it opens in');
    eq(cells[1]?.hour, 18, 'and the hour it ends in');
    eq((0, rotaClock_1.rotaTimeLabel)(start, zone), '17:30', 'and the minutes survive the label');
}
{
    // A half-hour-offset gym. `setMinutes(0)` was the reader's top of the hour and
    // is not the top of anything in Kolkata; `rotaInstant` asks the zone.
    const zone = 'Asia/Kolkata'; // +05:30
    const draft = (0, gymRota_1.shiftFromHours)(TRAINER, MON, 6, 8, 'floor', zone);
    eq((0, gymZone_1.gymTimeLabel)(draft.startsAt, zone), '06:00', 'a half-hour-offset gym opens at 06:00 too');
    const cells = (0, gymRota_1.hoursSpanned)(draft.startsAt, draft.endsAt, zone);
    eq(cells.length, 2, 'and a 06–08 shift is two hours there');
    eq(cells.map((c) => c.hour).join(','), '6,7', 'the sixth and the seventh');
}
{
    // The spring-forward morning. Europe/London has no 01:00 on 29 March 2026, so
    // a 00:00–04:00 shift is three hours of wall clock, not four.
    const zone = LONDON;
    const draft = (0, gymRota_1.shiftFromHours)(TRAINER, '2026-03-29', 0, 4, 'floor', zone);
    const hoursOnClock = (0, gymRota_1.hoursSpanned)(draft.startsAt, draft.endsAt, zone).map((c) => c.hour);
    eq(hoursOnClock.join(','), '0,2,3', 'the hour that does not exist is not rostered');
    eq((Date.parse(draft.endsAt) - Date.parse(draft.startsAt)) / 3600000, 3, 'and the shift is three real hours long, which is what the coach works');
}
eq((0, gymRota_1.shiftFromHours)(TRAINER, MON, 14, 14, 'floor', DUBAI), null, 'a zero-length shift is refused, not saved');
eq((0, gymRota_1.shiftFromHours)(TRAINER, MON, 14, 6, 'floor', DUBAI), null, 'a backwards shift is refused');
eq((0, gymRota_1.shiftFromHours)('', MON, 6, 14, 'floor', DUBAI), null, 'a shift with no trainer is refused');
eq((0, gymRota_1.shiftFromHours)(TRAINER, 'next tuesday', 6, 14, 'floor', DUBAI), null, 'a date that is not a date is refused');
eq((0, gymRota_1.shiftFromHours)(TRAINER, MON, 6.5, 14, 'floor', DUBAI), null, 'half an hour is not an hour box');
eq((0, gymRota_1.shiftFromHours)(TRAINER, MON, 6, 25, 'floor', DUBAI), null, 'and there is no 25th hour');
{
    const draft = (0, gymRota_1.shiftFromHours)(TRAINER, MON, 6, 24, 'floor', DUBAI);
    ok(draft != null, 'a shift that finishes when the day does is buildable');
    if (draft) {
        eq((0, gymZone_1.gymDay)(draft.endsAt, DUBAI), (0, rotaClock_1.addCalendarDays)(MON, 1), 'and it ends at the next day’s midnight');
        eq((0, gymZone_1.gymHour)(draft.endsAt, DUBAI), 0, 'which is hour zero');
    }
}
eq((0, rotaClock_1.rotaDay)(null, DUBAI), null, 'nothing has no day');
eq((0, rotaClock_1.rotaHour)('not an instant', DUBAI), null, 'and a string that is not an instant has no hour');
eq((0, rotaClock_1.rotaCell)('not an instant', DUBAI), null, 'so it has no cell either');
eq((0, rotaClock_1.rotaTimeLabel)(null, DUBAI), null, 'and no label — the screen draws a dash, not a plausible midnight');
eq((0, rotaClock_1.rotaInstant)('2026-09-07', 24, DUBAI) != null, true, 'hour 24 is midnight opening the next day');
eq((0, rotaClock_1.rotaInstant)('2026-09-07', -1, DUBAI), null, 'and there is no hour before the first');
eq((0, rotaClock_1.rotaInstant)('nope', 6, DUBAI), null, 'a day that is not a day names no instant');
{
    const today = (0, rotaClock_1.rotaToday)(DUBAI);
    ok(today != null && /^\d{4}-\d{2}-\d{2}$/.test(today), 'the gym has a today');
    eq(today, (0, gymZone_1.gymDay)(Date.now(), DUBAI), 'and it is the same today gymZone reports');
}
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('rotaClock: ok');
