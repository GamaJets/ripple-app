"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The hours in a day that nobody can buy. Compile with tsc, run with node.
//
// Two failures are worth the file.
//
// THE FIRST is the distinction the whole feature rests on. A free hour with an
// open slot across it is FOR SALE — a client can tap it. A free hour with no
// open slot across it is dead time nobody can reach, and after
// supabase/parts/731 a coach can have a week of the second and none of the
// first without anything on any screen saying so. A version of this that
// reported "you are free from 10 till 2" without that distinction would be
// reporting something the coach already knows.
//
// THE SECOND is the wall clock. A window is "07:00 to 19:00 on Tuesdays", not
// an offset from a midnight, and `npm run test:zones` runs these under six.
const dayGaps_1 = require("./dayGaps");
const moveTimes_1 = require("./moveTimes");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const Y = 2027, M = 5, D = 8; // 8 June 2027
const at = (h, min = 0) => new Date(Y, M, D, h, min, 0, 0);
const iso = (h, min = 0) => at(h, min).toISOString();
const DOW = at(12).getDay();
const WORK = (0, moveTimes_1.workWindows)([{ dow: DOW, hour: 7, minute: 0, dur: 12 * 60 }], DOW);
const NOW = at(1).getTime();
const nine = { startsAt: iso(9), durationMin: 60 };
const two = { startsAt: iso(14), durationMin: 60 };
const base = { year: Y, monthIndex: M, day: D, work: WORK, nowMs: NOW };
/* ── the hole between two sessions ──────────────────────────────────────── */
const holes = (0, dayGaps_1.dayGaps)({ ...base, blockers: [nine, two], open: [] });
eq(holes.length, 3, 'a 7-to-19 day with a 9am and a 2pm has three holes in it');
const midday = holes.find((g) => g.startMs === at(10).getTime());
ok(!!midday, 'and the big one starts when the 9am ends');
eq(midday?.minutes, 240, 'running four hours to the 2pm');
eq(midday?.openMin, 0, 'with none of it open for booking');
eq(midday?.sellableMin, 240, 'so all four hours are unsellable time');
eq(holes[0].startMs, at(10).getTime(), 'the longest unsellable stretch is listed first');
/* ── the same hole, already for sale ────────────────────────────────────── */
const wholeGapOpen = (0, dayGaps_1.dayGaps)({
    ...base, blockers: [nine, two],
    open: [{ startsAt: iso(10), durationMin: 240 }],
});
const covered = wholeGapOpen.find((g) => g.startMs === at(10).getTime());
eq(covered?.openMin, 240, 'an open slot across the whole hole covers all of it');
eq(covered?.sellableMin, 0, 'and there is nothing left that nobody can book');
ok(!(0, dayGaps_1.sellableGaps)(wholeGapOpen).some((g) => g.startMs === at(10).getTime()), 'so it is not reported — a coach knows about the hours they published');
const partlyOpen = (0, dayGaps_1.dayGaps)({
    ...base, blockers: [nine, two],
    open: [{ startsAt: iso(10), durationMin: 60 }],
});
const part = partlyOpen.find((g) => g.startMs === at(10).getTime());
eq(part?.openMin, 60, 'an hour of it is bookable');
eq(part?.sellableMin, 180, 'and three hours are not');
ok((0, dayGaps_1.sellableGaps)(partlyOpen).some((g) => g.startMs === at(10).getTime()), 'which is still worth saying');
// Part 86: two open slots may overlap on purpose, and only one can ever be
// taken. Counting the overlap twice would report an hour as more than covered.
const doubled = (0, dayGaps_1.dayGaps)({
    ...base, blockers: [nine, two],
    open: [{ startsAt: iso(10), durationMin: 60 }, { startsAt: iso(10, 30), durationMin: 60 }],
});
eq(doubled.find((g) => g.startMs === at(10).getTime())?.openMin, 90, 'overlapping open slots are counted once');
/* ── what does not count as a hole ──────────────────────────────────────── */
const tight = (0, dayGaps_1.dayGaps)({
    ...base,
    blockers: [nine, { startsAt: iso(10, 15), durationMin: 60 }],
    open: [],
});
ok(!tight.some((g) => g.startMs === at(10).getTime()), 'fifteen minutes between two clients is a turnaround, not a hole');
const noHours = (0, dayGaps_1.dayGaps)({ ...base, work: [], blockers: [nine], open: [] });
eq(noHours.length, 0, 'a day the coach never said they work has no gaps to report');
const afternoon = (0, dayGaps_1.dayGaps)({ ...base, nowMs: at(12).getTime(), blockers: [nine, two], open: [] });
ok(!afternoon.some((g) => g.startMs < at(12).getTime()), 'this morning is not something a coach can sell this afternoon');
ok(afternoon.some((g) => g.startMs === at(12).getTime()), 'and the part of the hole still ahead is reported from now');
const done = (0, dayGaps_1.dayGaps)({ ...base, nowMs: at(23).getTime(), blockers: [], open: [] });
eq(done.length, 0, 'a day that is over has nothing left in it');
/* ── two windows, one day ───────────────────────────────────────────────── */
const splitDay = (0, dayGaps_1.dayGaps)({
    ...base,
    work: (0, moveTimes_1.workWindows)([
        { dow: DOW, hour: 7, minute: 0, dur: 3 * 60 },
        { dow: DOW, hour: 16, minute: 0, dur: 3 * 60 },
    ], DOW),
    blockers: [], open: [],
});
eq(splitDay.length, 2, 'a split day is two holes, not one long one');
ok(!splitDay.some((g) => g.startMs < at(16).getTime() && g.endMs > at(10).getTime()), 'and the hours between them are not claimed as free — the coach is not there');
/* ── the wall clock ─────────────────────────────────────────────────────── */
for (const g of (0, dayGaps_1.dayGaps)({ ...base, blockers: [nine, two], open: [] })) {
    const s = new Date(g.startMs);
    eq(s.getDate(), D, 'every hole is on the day asked for');
    ok(s.getHours() >= 7 && s.getHours() < 19, 'and inside the hours the coach stated, read on their own clock');
}
/* ── the three reads behind the word "free" ─────────────────────────────── */
eq((0, dayGaps_1.gapsAreKnown)('ready', 'ready', 'ready'), true, 'three whole reads support the claim');
for (const bad of ['loading', 'partial', 'error']) {
    eq((0, dayGaps_1.gapsAreKnown)(bad, 'ready', 'ready'), false, `an unread diary does not (${bad})`);
    eq((0, dayGaps_1.gapsAreKnown)('ready', bad, 'ready'), false, `nor an unread timetable (${bad})`);
    eq((0, dayGaps_1.gapsAreKnown)('ready', 'ready', bad), false, `nor unread working hours (${bad})`);
}
eq((0, dayGaps_1.gapsUnknownNote)('ready', 'ready', 'ready'), null, 'and then there is nothing to say');
const notes = new Set();
for (const bad of ['loading', 'partial', 'error']) {
    const note = (0, dayGaps_1.gapsUnknownNote)(bad, 'ready', 'ready') ?? '';
    ok(note.length > 0, `'${bad}' says something`);
    ok(!/free|nothing booked/i.test(note) || /not known|not established/i.test(note), `and '${bad}' never states an hour is free`);
    notes.add(note);
}
eq(notes.size, 3, 'three causes, three sentences');
ok(/failed/i.test((0, dayGaps_1.gapsUnknownNote)('error', 'ready', 'ready') ?? ''), 'a failed read is named as a failure and not as an empty day');
/* ── the words ─────────────────────────────────────────────────────────── */
eq((0, dayGaps_1.gapLengthLabel)(45), '45min', 'under an hour is minutes');
eq((0, dayGaps_1.gapLengthLabel)(60), '1h', 'an exact hour has no minutes after it');
eq((0, dayGaps_1.gapLengthLabel)(150), '2h 30min', 'and the rest is spelled out');
eq((0, dayGaps_1.gapLengthLabel)(-5), '0min', 'a negative length is not printed as one');
ok(/Nobody can book this/.test((0, dayGaps_1.gapNote)({
    startsAt: iso(10), startMs: at(10).getTime(), endMs: at(14).getTime(),
    minutes: 240, openMin: 0, sellableMin: 240,
})), 'a hole with no open slot says nobody can book it');
ok(/already open for booking/.test((0, dayGaps_1.gapNote)({
    startsAt: iso(10), startMs: at(10).getTime(), endMs: at(14).getTime(),
    minutes: 240, openMin: 60, sellableMin: 180,
})), 'and a partly open one says how much of it is');
eq((0, dayGaps_1.gapsHeading)(0), null, 'nothing to head means no heading');
ok(!/\d/.test((0, dayGaps_1.gapsHeading)(1) ?? ''), 'one is counted in words, not as a figure');
ok(/2/.test((0, dayGaps_1.gapsHeading)(2) ?? ''), 'and more than one carries the count');
eq(dayGaps_1.MIN_SELLABLE_MIN, 30, 'the shortest thing this product sells is half an hour');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('dayGaps: ok');
