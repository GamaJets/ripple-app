// The app may not tell somebody they did not come.
// Compile with tsc, run with node.
//
// Four rules, four blocks. The one worth stating up front is the second: this
// is the first screen in the client app that renders somebody's own attendance,
// and a coach reads the same record. "You have not been in" printed over a
// register nobody ticked is not a cosmetic bug — it is a false fact about a
// member's history, arriving in the one place the retention conversation starts
// from. The assertions below exist to make that sentence unreachable.
//
// Every assertion has been checked to fail against the bug it names —
// `npm run mutate --file src/lib/attendance.ts` puts each one back mechanically.
// The block marked UNMARKED kills the mutations that collapse `unmarked` into an
// absence; the block marked RHYTHM kills the ones that let a mean be computed
// from weeks that are not in the record.
//
// No expectation is built against a hardcoded "today" or a hardcoded zone.
// `npm test` runs three times under three timezones (`test:zones`) and
// `localDay` is deliberately a LOCAL boundary, so day expectations are built
// with the same helper the code uses.
import {
  localDay, daysBetween, addDays, weekStart, classOutcome, dwellMinutes,
  mergeAttendance, attendedDays, rhythm,
  type ClassDetail, type MyBooking, type MyVisit,
} from './attendance';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const eqJson = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** A local instant, so a day expectation is the same in Auckland and Dubai. */
const at = (y: number, m: number, d: number, h = 9, min = 0) =>
  new Date(y, m - 1, d, h, min).toISOString();

const booking = (over: Partial<MyBooking> & { classId: string }): MyBooking => ({
  id: 'b-' + over.classId, status: 'booked', attendedAt: null, bookedAt: at(2026, 8, 1), ...over,
});
const visit = (over: Partial<MyVisit> & { id: string }): MyVisit => ({
  tenantId: 'T1', classId: null, enteredAt: at(2026, 8, 10), exitedAt: null, source: 'door', ...over,
});
const klass = (over: Partial<ClassDetail> & { id: string; startsAt: string }): ClassDetail => ({
  title: 'Spin', kind: 'Cycle', instructor: 'Ana', branch: 'Main', room: null,
  durationMin: 45, tenantId: 'T1', ...over,
});

/* ── dates are local days and DST-proof arithmetic ────────────────────────── */

eq(localDay(at(2026, 8, 31, 23, 30)), '2026-08-31',
  'a late-evening session belongs to that evening, not to the next UTC day');
eq(localDay(at(2026, 1, 1, 0, 5)), '2026-01-01', 'January is zero-padded');
eq(localDay(null), null, 'no timestamp is no day');
eq(localDay('not a date'), null, 'an unparseable timestamp is no day, not today');

eq(daysBetween('2026-03-01', '2026-04-01'), 31, 'March has 31 days across a DST boundary');
eq(daysBetween('2026-10-25', '2026-11-01'), 7, 'a week is seven days across the autumn change');
eq(daysBetween('2026-11', '2026-11-01'), null, 'a month is not a day, and does not silently become one');
eq(daysBetween('', '2026-11-01'), null, 'an empty date is no distance, not zero days');
eq(addDays('2026-03-28', 7), '2026-04-04', 'adding a week crosses the spring change intact');
eq(addDays('bad', 1), null, 'a malformed day shifts to nothing');

// 2026-08-31 is a Monday.
eq(weekStart('2026-08-31'), '2026-08-31', 'a Monday is its own week start');
eq(weekStart('2026-09-06'), '2026-08-31', 'a Sunday belongs to the week that began the Monday before');
eq(weekStart('2026-09-07'), '2026-09-07', 'the next Monday starts the next week');

/* ── UNMARKED · rule 1: an unticked register is not an absence ─────────────── */

const now = new Date(at(2026, 9, 10, 12, 0));

eqJson(classOutcome(booking({ classId: 'c1' }), at(2026, 9, 1), false, now), { kind: 'unmarked' },
  'a class that ran with nothing recorded is UNMARKED');
ok(!['missed', 'absent', 'no-show'].includes(classOutcome(booking({ classId: 'c1' }), at(2026, 9, 1), false, now).kind),
  'there is no outcome that calls it an absence');
eqJson(classOutcome(booking({ classId: 'c1', attendedAt: at(2026, 9, 1) }), at(2026, 9, 1), false, now),
  { kind: 'attended', register: true, door: false },
  'a ticked register is attendance, proved by the register');
eqJson(classOutcome(booking({ classId: 'c1' }), at(2026, 9, 1), true, now),
  { kind: 'attended', register: false, door: true },
  'a door record alone is attendance — the floor has no register to tick');
eqJson(classOutcome(booking({ classId: 'c1', attendedAt: at(2026, 9, 1) }), at(2026, 9, 1), true, now),
  { kind: 'attended', register: true, door: true },
  'both records is still ONE attendance, and says so twice over');
eqJson(classOutcome(booking({ classId: 'c1' }), at(2026, 9, 20), false, now), { kind: 'upcoming' },
  'a class that has not run yet is upcoming, never unmarked');
eqJson(classOutcome(booking({ classId: 'c1', status: 'waitlist' }), at(2026, 9, 1), false, now),
  { kind: 'waitlisted' }, 'a seat never granted is not a session missed');
eqJson(classOutcome(booking({ classId: 'c1', status: 'waitlist', attendedAt: at(2026, 9, 1) }), at(2026, 9, 1), false, now),
  { kind: 'attended', register: true, door: false },
  'a waitlister the coach ticked in WAS there — evidence beats the status column');
eqJson(classOutcome(booking({ classId: 'c1' }), null, false, now), { kind: 'unknown' },
  'a class we cannot read the time of is UNKNOWN, not unmarked and not missed');
eqJson(classOutcome(booking({ classId: 'c1' }), 'rubbish', false, now), { kind: 'unknown' },
  'an unparseable start time does not silently become a class that has run');

/* ── rule 2: one turning-up is one row ────────────────────────────────────── */

const classes = new Map<string, ClassDetail>([
  ['c1', klass({ id: 'c1', startsAt: at(2026, 9, 1, 18, 0) })],
  ['c2', klass({ id: 'c2', startsAt: at(2026, 9, 3, 7, 0), title: 'Yoga' })],
]);

const both = mergeAttendance(
  [booking({ classId: 'c1', attendedAt: at(2026, 9, 1, 18, 5) })],
  [visit({ id: 'v1', classId: 'c1', enteredAt: at(2026, 9, 1, 17, 50), exitedAt: at(2026, 9, 1, 19, 0) })],
  classes, now,
);
eq(both.events.length, 1, 'a booking and its door record are ONE occasion, not two');
eq(both.events[0].source, 'class', 'the folded event is the class, not the door');
eq(both.events[0].visit?.id, 'v1', 'the door record is carried on the class event');
eq(both.events[0].at, at(2026, 9, 1, 18, 0), 'the occasion is when the CLASS ran, not when the door opened');
eqJson(both.events[0].outcome, { kind: 'attended', register: true, door: true },
  'both proofs survive the fold');

const twoScans = mergeAttendance(
  [booking({ classId: 'c1' })],
  [
    visit({ id: 'v1', classId: 'c1', enteredAt: at(2026, 9, 1, 17, 50) }),
    visit({ id: 'v2', classId: 'c1', enteredAt: at(2026, 9, 1, 18, 40) }),
  ],
  classes, now,
);
eq(twoScans.events.length, 1, 'scanning in twice around one class is one attendance');

const walkIn = mergeAttendance(
  [], [visit({ id: 'v9', classId: 'c2', enteredAt: at(2026, 9, 3, 7, 2) })], classes, now,
);
eq(walkIn.events.length, 1, 'a class the desk logged without a booking is still an occasion');
eq(walkIn.events[0].klass?.title, 'Yoga', 'and it is labelled with the class it was');
eq(walkIn.events[0].booking, null, 'with no booking invented to hang it on');

const floor = mergeAttendance([], [visit({ id: 'v3', enteredAt: at(2026, 9, 5, 6, 30) })], classes, now);
eq(floor.events.length, 1, 'a floor visit is an occasion of its own');
eq(floor.events[0].source, 'floor', 'and it is not dressed up as a class');
eqJson(floor.events[0].outcome, { kind: 'attended', register: false, door: true },
  'walking through the door is attendance — there is no register to be untaken');

const dup = mergeAttendance(
  [booking({ id: 'bA', classId: 'c1' }), booking({ id: 'bB', classId: 'c1' })], [], classes, now,
);
eq(dup.events.length, 1, 'two booking rows for one class do not double the history');

eq(mergeAttendance([booking({ classId: 'c2' })], [], classes, now).events[0].tenantId, 'T1',
  'which gym is read off the row, never assumed');

/* ── rule 3: no date, no place on the timeline ────────────────────────────── */

const hidden = mergeAttendance(
  [booking({ classId: 'gone', bookedAt: at(2026, 5, 1) })], [], new Map(), now,
);
eq(hidden.events.length, 0, 'an event with no readable date is kept off the dated timeline');
eq(hidden.undated.length, 1, 'and is NOT dropped — the member did book it');
eq(hidden.undated[0].day, null, 'it is carried with no day rather than a guessed one');
eq(hidden.undated[0].at, null, 'and no time');
eqJson(hidden.undated[0].outcome, { kind: 'unknown' },
  'nothing is claimed about a class we cannot read');

const markedButHidden = mergeAttendance(
  [booking({ classId: 'gone', attendedAt: at(2026, 5, 2, 19, 0), bookedAt: at(2026, 5, 1) })],
  [], new Map(), now,
);
eq(markedButHidden.events.length, 1, 'a hidden class WITH a register tick can still be dated by the tick');
eq(markedButHidden.events[0].at, at(2026, 5, 2, 19, 0), 'the tick is when they were marked present');
ok(markedButHidden.events[0].at !== at(2026, 5, 1),
  'and never the created_at — booking a seat is not attending the class');
eq(markedButHidden.events[0].klass, null, 'the class stays null rather than being invented');

// The fallback chain must not reach for `bookedAt`, which is the bug this asserts
// against: a seat booked in March for a class in May would land in March.
const noProof = mergeAttendance([booking({ classId: 'gone', bookedAt: at(2026, 3, 1) })], [], new Map(), now);
eq(noProof.undated.length, 1, 'with no tick and no door record there is nothing to date it by');

/* ── the days a member actually came ──────────────────────────────────────── */

const day1 = localDay(at(2026, 9, 1, 18, 0))!;
const day3 = localDay(at(2026, 9, 3, 7, 0))!;

const twoOnOneDay = mergeAttendance(
  [booking({ classId: 'c1', attendedAt: at(2026, 9, 1, 18, 5) })],
  [visit({ id: 'v4', enteredAt: at(2026, 9, 1, 7, 0), exitedAt: at(2026, 9, 1, 8, 0) })],
  classes, now,
);
eq(twoOnOneDay.events.length, 2, 'a morning floor session and an evening class are two occasions');
eqJson(attendedDays(twoOnOneDay.events), [day1], 'but they are ONE day of coming to the gym');

const mixed = mergeAttendance(
  [
    booking({ classId: 'c1', attendedAt: at(2026, 9, 1, 18, 5) }),
    booking({ classId: 'c2' }),
  ],
  [], classes, now,
);
eqJson(attendedDays(mixed.events), [day1],
  'an unmarked class is not counted as a day they came — rule 1 reaching the figure');
ok(!attendedDays(mixed.events).includes(day3),
  'and specifically not the day of the class nobody ticked');

const future = mergeAttendance(
  [booking({ classId: 'cf' })], [],
  new Map([['cf', klass({ id: 'cf', startsAt: at(2026, 9, 20, 9, 0) })]]), now,
);
eqJson(attendedDays(future.events), [], 'a class they have booked for next week is not attendance');

/* ── RHYTHM · rule 4: no rate from a partial record ───────────────────────── */

// Four finished weeks and the current one. 2026-08-31 is a Monday, and `now`
// above is Thursday 2026-09-10, so the week of 09-07 is still running.
const days = ['2026-08-10', '2026-08-12', '2026-08-17', '2026-08-25', '2026-08-31', '2026-09-02', '2026-09-08'];
const r = rhythm(days, '2026-09-10', 6, true);

eq(r.weeks.length, 6, 'six weeks are laid out even where nothing happened in one');
eq(r.weeks[0].start, '2026-09-07', 'the newest week is first');
eq(r.weeks[0].complete, false, 'the week we are standing in has not finished');
eq(r.weeks[1].start, '2026-08-31', 'and the one before it is the week before');
eq(r.weeks[1].days, 2, 'two days in the week of the 31st');
eq(r.firstDay, '2026-08-10', 'the record starts on the earliest day in it');

// Weeks of 08-10, 08-17, 08-24, 08-31 are complete and covered: 2 + 1 + 1 + 2 = 6.
eq(r.countedWeeks, 4, 'four finished weeks lie wholly inside the record');
eq(r.perWeek, 1.5, 'and the mean is over exactly those');

const partial = rhythm(days, '2026-09-10', 6, false);
eq(partial.perWeek, null, 'a read that came back truncated yields NO rate');
eq(partial.weeks.length, 6, 'the weeks themselves are still shown — the rows are real');
eq(partial.countedWeeks, 4, 'and the count of what would have been averaged is unchanged');

// A member whose record starts three weeks ago, averaged over twelve, must not
// read as somebody who trains once a fortnight.
const recent = rhythm(['2026-08-31', '2026-09-01', '2026-09-03'], '2026-09-10', 12, true);
eq(recent.countedWeeks, 1, 'only the one finished week that is inside the record counts');
eq(recent.perWeek, 3, 'so the mean is three, not three-over-twelve');
ok(recent.weeks.filter((w) => !w.covered).length > 0,
  'the weeks before they ever came are marked uncovered rather than counted as zero');
eq(recent.weeks[recent.weeks.length - 1].covered, false,
  'the oldest week in the window predates the record');

const nothing = rhythm([], '2026-09-10', 6, true);
eq(nothing.firstDay, null, 'an empty record has no first day');
eq(nothing.perWeek, null, 'and no rate — zero visits per week is a claim, not an absence of one');
eq(nothing.countedWeeks, 0, 'with nothing to count');
eq(nothing.weeks.length, 6, 'the empty weeks are still drawn');
ok(nothing.weeks.every((w) => !w.covered), 'and every one of them is uncovered');

const oneWeekOnly = rhythm(['2026-09-08'], '2026-09-10', 6, true);
eq(oneWeekOnly.countedWeeks, 0,
  'a record that only contains the unfinished week has no finished week to average');
eq(oneWeekOnly.perWeek, null, 'so it refuses a rate rather than reporting the current week as one');

eq(rhythm(days, '2026-09-10', 0, true).perWeek, null, 'a zero-week window has no mean');
eq(rhythm(days, 'not-a-day', 6, true).perWeek, null, 'an unparseable today produces no mean');
eqJson(rhythm(days, 'not-a-day', 6, true).weeks, [], 'and no weeks');

/* ── dwell ─────────────────────────────────────────────────────────────────── */

eq(dwellMinutes({ enteredAt: at(2026, 9, 1, 18, 0), exitedAt: at(2026, 9, 1, 19, 5) }), 65,
  'an hour and five minutes inside');
eq(dwellMinutes({ enteredAt: at(2026, 9, 1, 18, 0), exitedAt: null }), null,
  'no exit is NOT a zero-minute visit');
eq(dwellMinutes(null), null, 'no visit is no dwell');
eq(dwellMinutes({ enteredAt: at(2026, 9, 1, 19, 0), exitedAt: at(2026, 9, 1, 18, 0) }), null,
  'a clock-skewed terminal does not get to report a negative stay');

/* ── ordering, so the screen does not have to re-derive it ────────────────── */

const ordered = mergeAttendance(
  [booking({ classId: 'c1', attendedAt: at(2026, 9, 1, 18, 5) })],
  [
    visit({ id: 'v5', enteredAt: at(2026, 9, 5, 6, 30) }),
    visit({ id: 'v6', enteredAt: at(2026, 8, 20, 6, 30) }),
  ],
  classes, now,
);
eqJson(ordered.events.map((e) => e.key), ['visit:v5', 'class:c1', 'visit:v6'],
  'newest first, whichever table the row came from');

if (errors.length) {
  console.error(`attendance.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('attendance.test.ts — all assertions passed.');
