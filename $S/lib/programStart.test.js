"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// A start date the coach chose, and the sentence that stops it becoming a lie.
// Compile with tsc, run with node.
//
// The bug every assertion here is aimed at: a coach who believes "starts
// Monday" is enforced, assigning a block on a Thursday, has just replaced their
// client's Friday session while believing they did not. The client app decides
// what to show from `assigned_programs` the moment the row lands and knows
// nothing about a start date. So the arithmetic below is for the COACH's
// screens, and `CLIENT_STARTS_NOW` is the part that must never be softened.
const programStart_1 = require("./programStart");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── whole days, across a clock change ──────────────────────────────────── */
eq((0, programStart_1.daysBetween)('2026-09-01', '2026-09-08'), 7, 'a week is seven days');
eq((0, programStart_1.daysBetween)('2026-09-08', '2026-09-01'), -7, 'and backwards is negative seven');
eq((0, programStart_1.daysBetween)('2026-09-01', '2026-09-01'), 0, 'the same day is no days');
eq((0, programStart_1.daysBetween)(null, '2026-09-01'), null, 'a missing end is not nought days');
eq((0, programStart_1.daysBetween)('not a date', '2026-09-01'), null, 'and neither is an unreadable one');
// THE reason this rounds instead of flooring. Two local midnights either side of
// a daylight-saving change are 23 or 25 hours apart, so a plain division hands
// back 6.958333 for a week that ends on the clocks going forward — and
// `Math.floor` of that is six. A block would silently gain a day twice a year,
// in March and October, for every coach in a country that changes its clocks.
// These two spans cross the European and the North American changeovers.
eq((0, programStart_1.daysBetween)('2026-03-25', '2026-04-01'), 7, 'a week across the spring clock change is still seven days');
eq((0, programStart_1.daysBetween)('2026-10-21', '2026-10-28'), 7, 'and so is one across the autumn change');
eq((0, programStart_1.daysBetween)('2026-03-01', '2026-05-01'), 61, 'a two-month span containing a change is still exact');
/* ── which week of the block, and the four times there is no answer ─────── */
const at = (start, today, weeks = 8) => (0, programStart_1.blockPosition)(start, today, weeks);
eq(at(null, '2026-09-01').phase, 'no-date', 'an assignment with no start date is its own state — every assignment ever made is this');
eq(at(null, '2026-09-01').week, null, 'and has no week number, so nothing can print "Week 0"');
eq(at('the 3rd', '2026-09-01').phase, 'unreadable', 'a stored date this build cannot parse is NOT the same as the coach not having said');
eq(at('2026-09-07', '2026-09-01').phase, 'before', 'a block dated next week has not started');
eq(at('2026-09-07', '2026-09-01').week, null, 'so there is no week to be in');
eq(at('2026-09-01', '2026-09-01').week, 1, 'the first day is week one');
eq(at('2026-09-01', '2026-09-07').week, 1, 'and so is the seventh day');
eq(at('2026-09-01', '2026-09-08').week, 2, 'the eighth is week two');
// Eight weeks from the 1st of September is 56 days, so week eight runs the 20th
// to the 26th of October and the block runs out on the 27th. The boundary is
// asserted on both sides rather than somewhere comfortably past it, because an
// off-by-one here tells a coach their block has ended a week early.
eq(at('2026-09-01', '2026-10-26').week, 8, 'the last day of the last week is still in the block');
eq(at('2026-09-01', '2026-10-27').phase, 'after', 'and the day after it has run out');
eq(at('2026-09-01', '2026-10-27').week, null, 'which is not a week number either');
// The week runs from the START DATE, not from Monday. A block that begins on a
// Wednesday has week one running Wednesday to Tuesday — the coach chose the
// day, and re-anchoring to the calendar week would put the client in week two
// after five days.
eq(at('2026-09-02', '2026-09-08').week, 1, 'a Wednesday block is still in week one on the following Tuesday');
eq(at('2026-09-02', '2026-09-09').week, 2, 'and reaches week two seven days after the day the coach chose');
// A programme with no weeks at all must not read as a block that already ended
// on the day it started.
eq(at('2026-09-01', '2026-09-01', 0).phase, 'during', 'a zero week count is floored to one rather than ending the block');
eq(at('2026-09-01', '2026-09-01', 0).weeks, 1, 'and is reported as one');
/* ── the sentences, and the one that carries the warning ────────────────── */
const before = (0, programStart_1.blockPositionLine)(at('2026-09-07', '2026-09-01'), '2026-09-07', 'Priya');
ok(/training week one of it already/i.test(before), 'the "starts next week" line says plainly that the client is already on it');
ok(/does not wait/i.test(before), 'and that the Train tab does not wait for the date');
const during = (0, programStart_1.blockPositionLine)(at('2026-09-01', '2026-09-10'), '2026-09-01', 'Priya');
ok(/Week 2 of 8/.test(during), 'a running block says which week of how many');
ok(/2026-09-01/.test(during), 'with the date it is counted from, so the reader can check it');
const none = (0, programStart_1.blockPositionLine)(at(null, '2026-09-01'), null, 'Priya');
ok(/began the moment it was sent/i.test(none), 'no start date says what actually happened rather than implying something was scheduled');
const after = (0, programStart_1.blockPositionLine)(at('2026-06-01', '2026-09-01'), '2026-06-01', 'Priya');
ok(/Nothing here says whether Priya did it/i.test(after), 'a finished block is not a completed one — nothing in this app knows whether they trained it');
const oneWeekLine = (0, programStart_1.blockPositionLine)(at('2026-09-01', '2026-09-02', 1), '2026-09-01', 'Priya');
ok(!/Week 1 of 1/.test(oneWeekLine), 'a one-week programme is not given a week number, because there is nothing to count');
// Four different phases, four different sentences. A screen that printed the
// same line for two of them would be hiding the difference between "you did not
// say" and "the app could not read what you said".
eq(new Set([before, during, none, after]).size, 4, 'each phase reads as its own sentence');
/* ── what may be stored, refused rather than corrected ──────────────────── */
ok((0, programStart_1.isStartDate)('2026-09-01'), 'a calendar date is a start date');
ok(!(0, programStart_1.isStartDate)(''), 'a blank is not one — that is the null case and the coach simply did not say');
ok(!(0, programStart_1.isStartDate)('01/09/2026'), 'nor is a spelling this app does not store, which would parse two ways in two countries');
ok(!(0, programStart_1.isStartDate)('2026-09-01T00:00:00Z'), 'nor an instant — a start date is a DATE, because no client timezone exists to place an instant in');
// Refused, not rolled forward. `new Date(2026, 1, 30)` is the 2nd of March, and
// storing that would print a start date the coach never chose on a plan they
// are about to send somebody.
ok(!(0, programStart_1.isStartDate)('2026-02-30'), 'the 30th of February is refused rather than becoming the 2nd of March');
ok((0, programStart_1.isStartDate)('2028-02-29'), 'and a real leap day is accepted');
ok(!(0, programStart_1.isStartDate)('2026-02-29'), 'while a leap day in a year that has none is not');
// There is deliberately no upper bound (a coach planning a season four months
// out is ordinary) and no lower one (recording that a block began last Monday
// is recording something true).
ok((0, programStart_1.isStartDate)('2020-01-01'), 'a date in the past is allowed — a coach may be recording what already happened');
ok((0, programStart_1.isStartDate)('2030-01-01'), 'and one well ahead is allowed — that is a season being planned');
ok((0, programStart_1.laterStart)('2026-09-08', '2026-09-01'), 'one block starts after another');
ok(!(0, programStart_1.laterStart)('2026-09-01', '2026-09-08'), 'and not before it');
ok(!(0, programStart_1.laterStart)('2026-09-01', '2026-09-01'), 'the same day is not later than itself');
ok(!(0, programStart_1.laterStart)(null, '2026-09-01'), 'and an absent date is not later than anything');
/* ── the promise this feature must not make ─────────────────────────────── */
ok(/does not hold the programme back/i.test(programStart_1.CLIENT_STARTS_NOW), 'the sentence says the date does not gate what the client sees');
ok(/replaces this week/i.test(programStart_1.CLIENT_STARTS_NOW), 'and names the consequence a coach would otherwise discover from their client');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('programStart: ok — whole days across a clock change, four phases with four sentences, and a date that never pretends to gate anything');
