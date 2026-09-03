"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Where a session can be moved to. Compile with tsc, run with node.
//
// Three failures are worth the file.
//
// THE FIRST is the one the feature exists for: a coach with a 7am booked and
// nothing else must be offered 8am. The old sheet offered only pre-existing
// open slots and would have offered nothing at all, which is what sent a coach
// to Cancel — see the header of moveTimes.ts and supabase/parts/461 for what
// Cancel then does to the client's credit.
//
// THE SECOND is daylight saving. Every candidate is a WALL-CLOCK time: "8am" is
// 8am on the Sunday a clock moves as much as on any other day, and a grid built
// by adding 3,600,000ms to a local midnight is an hour out on two days a year.
// The block headed "the two days a year" below runs the grid over a
// spring-forward and an autumn-back date; under `npm run test:zones` those are
// real transitions in Los Angeles and Auckland and ordinary days in the other
// four, and the same assertions have to hold in both cases.
//
// THE THIRD is the sentence after a refusal. A coach who reads "not moved" and
// walks away believing the hour changed has told a client to come at eight, and
// every branch of `moveAtRefusalLine` therefore ends by saying where the
// session actually is — except the one branch where nobody knows.
const moveTimes_1 = require("./moveTimes");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── the weekly hours, merged ───────────────────────────────────────────── */
// `expandRange` writes one row per quarter hour, so "Tuesday 7 to 10" is twelve
// abutting rows. Offering a move only at the start of each of those is the same
// dead end one level down.
const quarters = Array.from({ length: 12 }, (_, i) => ({
    dow: 2, hour: 7 + Math.floor(i / 4), minute: (i % 4) * 15, dur: 15,
}));
const merged = (0, moveTimes_1.workWindows)(quarters, 2);
eq(merged.length, 1, 'twelve abutting quarter-hours are one window');
eq(merged[0].startMin, 7 * 60, 'starting where the first one does');
eq(merged[0].endMin, 10 * 60, 'and ending where the last one does');
eq((0, moveTimes_1.workWindows)(quarters, 3).length, 0, 'another weekday has none of them');
const split = (0, moveTimes_1.workWindows)([
    { dow: 1, hour: 7, minute: 0, dur: 60 },
    { dow: 1, hour: 12, minute: 0, dur: 60 },
], 1);
eq(split.length, 2, 'a real break in the day stays two windows');
const overlapping = (0, moveTimes_1.workWindows)([
    { dow: 1, hour: 7, minute: 0, dur: 120 },
    { dow: 1, hour: 8, minute: 0, dur: 120 },
], 1);
eq(overlapping.length, 1, 'overlapping rows are one window');
eq(overlapping[0].endMin, 10 * 60, 'reaching the later end of the two');
eq((0, moveTimes_1.workWindows)([{ dow: 1, hour: 7, minute: 0, dur: 0 }], 1).length, 0, 'a zero-length row is not a window');
/* ── the day under test ─────────────────────────────────────────────────── */
// A Tuesday, chosen by construction rather than by date arithmetic so this
// reads the same in every zone. The clock is set to the small hours of that
// day, so the whole working day is still ahead of "now".
const Y = 2027, M = 3, D = 6; // 6 April 2027
const at = (h, min = 0) => new Date(Y, M, D, h, min, 0, 0);
const iso = (h, min = 0) => at(h, min).toISOString();
const NOW = at(1).getTime();
const WORK = (0, moveTimes_1.workWindows)([{ dow: at(7).getDay(), hour: 7, minute: 0, dur: 12 * 60 }], at(7).getDay());
eq(WORK.length, 1, 'the coach works a single stretch that day');
const SEVEN = { id: 'sess-7', startsAt: iso(7), durationMin: 60, kind: 'booked' };
const base = {
    year: Y, monthIndex: M, day: D, durationMin: 60, movingId: 'sess-7',
    work: WORK, nowMs: NOW,
};
/* ── the headline: 8am is offered, with no open slot anywhere ───────────── */
const plain = (0, moveTimes_1.moveTimes)({ ...base, blockers: [SEVEN], open: [] });
const eight = plain.find((t) => new Date(t.startMs).getHours() === 8 && new Date(t.startMs).getMinutes() === 0);
ok(!!eight, 'a coach with only a 7am booked is offered 8am');
eq(eight?.slotId, null, 'and it is not an existing slot, which is the whole point');
eq(eight?.inHours, true, 'it is inside the hours they said they work');
// The near miss, which is the commonest move of all and which a naive
// implementation refuses because the session collides with itself.
ok(plain.some((t) => new Date(t.startMs).getHours() === 7 && new Date(t.startMs).getMinutes() === 30), 'the hour being moved is not an obstacle to itself');
ok(!plain.some((t) => t.startMs === Date.parse(iso(7))), 'but the hour it is already in is not offered — the server calls that same-time');
/* ── wall-clock, not milliseconds ───────────────────────────────────────── */
for (const t of plain) {
    const d = new Date(t.startMs);
    eq(d.getFullYear(), Y, 'every candidate lands on the day asked for');
    eq(d.getMonth(), M, 'in the month asked for');
    ok(d.getMinutes() % moveTimes_1.MOVE_STEP_MIN === 0, 'and on a step boundary of the local clock');
}
// One instant, once. Spring-forward makes two grid entries name the same
// moment, and a duplicated row is a second identical thing to tap.
eq(new Set(plain.map((t) => t.startMs)).size, plain.length, 'no instant is offered twice');
/* ── the two days a year ────────────────────────────────────────────────── */
// 14 March 2027 springs forward in Los Angeles; 3 October 2027 falls back in
// Auckland. Under the other four zones both are ordinary Sundays, and that is
// the point: the same assertions hold either way, so this is not a test of the
// runner's timezone.
for (const [yy, mm, dd] of [[2027, 2, 14], [2027, 9, 3]]) {
    const dawn = new Date(yy, mm, dd, 0, 30, 0, 0).getTime();
    const dow = new Date(yy, mm, dd, 12, 0, 0, 0).getDay();
    const shifted = (0, moveTimes_1.moveTimes)({
        year: yy, monthIndex: mm, day: dd, durationMin: 60, movingId: 'none',
        work: (0, moveTimes_1.workWindows)([{ dow, hour: 6, minute: 0, dur: 14 * 60 }], dow),
        nowMs: dawn, blockers: [], open: [],
    });
    ok(shifted.length > 0, `${yy}-${mm + 1}-${dd} still offers times`);
    eq(new Set(shifted.map((t) => t.startMs)).size, shifted.length, 'and an hour that the clock repeats or skips is never offered twice');
    for (const t of shifted) {
        const d = new Date(t.startMs);
        eq(d.getDate(), dd, 'every candidate stays on the day asked for');
        ok(d.getMinutes() % moveTimes_1.MOVE_STEP_MIN === 0, 'and on a step boundary of the LOCAL clock');
    }
}
/* ── what occupies an hour ──────────────────────────────────────────────── */
const kinds = ['booked', 'blocked', 'class'];
for (const kind of kinds) {
    const times = (0, moveTimes_1.moveTimes)({
        ...base,
        blockers: [SEVEN, { id: kind === 'class' ? null : 'other', startsAt: iso(8), durationMin: 60, kind }],
        open: [],
    });
    ok(!times.some((t) => t.startMs === Date.parse(iso(8))), `a ${kind} at 8 removes 8am`);
    ok(!times.some((t) => t.startMs === Date.parse(iso(7, 30))), `and a ${kind} at 8 removes 7:30, because an hour from 7:30 runs into it`);
    ok(times.some((t) => t.startMs === Date.parse(iso(9))), `while 9am survives a ${kind} at 8`);
}
/* ── an open slot is used when there is one, and only an exact one ──────── */
const exact = { id: 'open-9', startsAt: iso(9), durationMin: 60 };
const withOpen = (0, moveTimes_1.moveTimes)({ ...base, blockers: [SEVEN], open: [exact] });
eq(withOpen.find((t) => t.startMs === Date.parse(iso(9)))?.slotId, 'open-9', 'an exact open slot is offered as itself, so the proven one-write path is used');
const halfHour = { id: 'open-half', startsAt: iso(9), durationMin: 30 };
const withHalf = (0, moveTimes_1.moveTimes)({ ...base, blockers: [SEVEN], open: [halfHour] });
eq(withHalf.find((t) => t.startMs === Date.parse(iso(9)))?.slotId, null, 'a 30-minute slot is not a place to put a 60-minute session');
ok(withHalf.some((t) => t.startMs === Date.parse(iso(9))), 'though 9am is still offered — an open slot of the wrong length blocks nothing');
/* ── the past is not offered ────────────────────────────────────────────── */
const midday = (0, moveTimes_1.moveTimes)({ ...base, nowMs: at(12).getTime(), blockers: [SEVEN], open: [] });
ok(!midday.some((t) => t.startMs <= at(12).getTime()), 'nothing at or before now is offered');
ok(midday.some((t) => new Date(t.startMs).getHours() === 13), 'the afternoon still is');
/* ── a day the coach has not said they work ─────────────────────────────── */
const unstated = (0, moveTimes_1.moveTimes)({ ...base, work: [], blockers: [], open: [] });
ok(unstated.length > 0, 'a coach with no stated hours is still offered times');
ok(unstated.every((t) => t.inHours === false), 'and none of them claims to be inside hours the coach never set');
const firstUnstated = new Date(unstated[0].startMs);
eq(firstUnstated.getHours() * 60 + firstUnstated.getMinutes(), moveTimes_1.MOVE_DAY_START_MIN, 'the fallback day starts where MOVE_DAY_START_MIN says');
const lastUnstated = new Date(unstated[unstated.length - 1].startMs);
ok(lastUnstated.getHours() * 60 + lastUnstated.getMinutes() + 60 <= moveTimes_1.MOVE_DAY_END_MIN, 'and no session runs past where it ends');
/* ── the two groups ─────────────────────────────────────────────────────── */
const early = (0, moveTimes_1.moveTimes)({ ...base, blockers: [SEVEN], open: [] });
const grouped = (0, moveTimes_1.groupMoveTimes)(early);
ok(grouped.inHours.length > 0, 'the working day is offered');
eq(grouped.inHours.length + grouped.outside.length, early.length, 'and every time is in exactly one group');
ok(grouped.inHours.every((t) => t.inHours), 'the in-hours group is in hours');
ok(grouped.outside.every((t) => !t.inHours), 'and the other one is not');
ok(grouped.outside.some((t) => new Date(t.startMs).getHours() < 7), 'an early hour outside the stated day is still reachable, in the second group');
/* ── what the list cannot promise ───────────────────────────────────────── */
eq((0, moveTimes_1.moveTimesCaveat)('ready', 'ready'), null, 'two whole reads need no caveat');
const partialCal = (0, moveTimes_1.moveTimesCaveat)('partial', 'ready') ?? '';
ok(/part of your calendar/i.test(partialCal), 'a truncated diary is named as truncated');
ok(/checked again on the server/i.test(partialCal), 'and the coach is told the server checks again');
const noClasses = (0, moveTimes_1.moveTimesCaveat)('ready', 'error') ?? '';
ok(/class timetable/i.test(noClasses), 'an unread timetable is named');
ok(/could not be read/i.test(noClasses), 'as a read that failed');
ok(/class timetable/i.test((0, moveTimes_1.moveTimesCaveat)('ready', 'partial') ?? ''), 'and a truncated one too');
ok(((0, moveTimes_1.moveTimesCaveat)('partial', 'error') ?? '').length > (partialCal.length), 'and two problems say more than one');
/* ── the empty list, which means five things ────────────────────────────── */
const seen = new Set();
for (const status of ['loading', 'error', 'partial']) {
    const line = (0, moveTimes_1.emptyMoveTimesLine)(status, 'Tue 6 Apr', true);
    ok(line.length > 0, `'${status}' says something`);
    ok(!/nowhere to move|already has something of yours/i.test(line), `and '${status}' never claims the day is full`);
    seen.add(line);
}
const full = (0, moveTimes_1.emptyMoveTimesLine)('ready', 'Tue 6 Apr', true);
ok(/nowhere to move/i.test(full), 'a whole read over a full day says so plainly');
ok(!/Weekly Availability/i.test(full), 'and does not send a coach who has set hours to set them');
const fullNoHours = (0, moveTimes_1.emptyMoveTimesLine)('ready', 'Tue 6 Apr', false);
ok(/Weekly Availability/i.test(fullNoHours), 'while a coach who has not set hours is told where to');
seen.add(full);
seen.add(fullNoHours);
eq(seen.size, 5, 'five states, five sentences');
/* ── the refusals ───────────────────────────────────────────────────────── */
const rep = (over = {}) => ({ ...moveTimes_1.MOVE_AT_NOT_MOVED, ...over });
const reasons = [
    'not-yours', 'already-started', 'past', 'clash-booked', 'clash-blocked',
    'clash-class', 'clash', 'same-time', 'bad-time', 'unreachable',
];
const lines = new Set();
for (const reason of reasons) {
    const line = (0, moveTimes_1.moveAtRefusalLine)(rep({ reason }), 'Ana', '7am', '8am');
    ok(line.length > 0, `'${reason}' has a sentence`);
    lines.add(line);
    if (reason !== 'unreachable') {
        ok(/has not moved and is still booked/.test(line), `'${reason}' says where the session actually is`);
    }
}
eq(lines.size, reasons.length, 'and no two refusals read the same');
const lost = (0, moveTimes_1.moveAtRefusalLine)(rep({ reason: 'unreachable' }), 'Ana', '7am', '8am');
ok(!/has not moved/.test(lost), 'the unreachable one does not claim the move failed');
ok(/may or may not/.test(lost) && /Do not tell Ana/.test(lost), 'it says nobody knows, and to tell the client nothing yet');
const taught = (0, moveTimes_1.moveAtRefusalLine)(rep({ reason: 'clash-class', className: 'Bootcamp' }), 'Ana', '7am', '8am');
ok(/Bootcamp/.test(taught), 'a named class is named');
ok(!/Bootcamp/.test((0, moveTimes_1.moveAtRefusalLine)(rep({ reason: 'clash-class' }), 'Ana', '7am', '8am')), 'and an unnamed one is not invented');
const bare = (0, moveTimes_1.moveAtRefusalLine)(rep({ reason: 'clash-booked' }), null, null, null);
ok(bare.length > 0 && !/null|undefined/.test(bare), 'a refusal with no name and no times is still a sentence');
/* ── the confirm ────────────────────────────────────────────────────────── */
const confirm = (0, moveTimes_1.moveAtConfirmBody)('Ana', 'Tue 6 Apr at 7am', 'Tue 6 Apr at 8am', true);
ok(/not one of your open slots/.test(confirm), 'the confirm says this is not an existing slot');
ok(/straight into your diary/.test(confirm), 'and that it puts an hour in the diary');
ok(/Nothing is charged/.test(confirm) && /no session comes off their pack/.test(confirm), 'the two money facts are stated rather than implied');
ok(!/outside the working hours/.test(confirm), 'an in-hours move says nothing about working hours');
ok(/outside the working hours/.test((0, moveTimes_1.moveAtConfirmBody)('Ana', '7am', '5am', false)), 'and an out-of-hours one does');
eq(moveTimes_1.MOVE_AT_NOT_MOVED.reason, 'unreachable', 'the fallback report is the one that says nobody knows');
eq(moveTimes_1.MOVE_AT_NOT_MOVED.moved, false, 'and it never reads as moved');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('moveTimes: ok');
