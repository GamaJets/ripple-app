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
  mergeAttendance, attendedDays, rhythm, staffScopeNote, STAFF_RECORD_NOTE,
  rhythmWeekLabel, bookingStatus, fetchMyAttendance,
  type ClassDetail, type MyBooking, type MyVisit, type RhythmWeek,
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

// 2026-09-06 is a Sunday, which is the day a week opens on — src/lib/weekStart.ts.
eq(weekStart('2026-09-06'), '2026-09-06', 'the opening day is its own week start');
eq(weekStart('2026-09-12'), '2026-09-06', 'a Saturday belongs to the week that began the Sunday before');
eq(weekStart('2026-09-13'), '2026-09-13', 'and the next Sunday starts the next week');

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

/* ── THE FOUR WORDS · part 3060, and the collapse that erased two of them ───
 *
 * `class_bookings.status` accepted two values from part 02 until part 3060
 * widened the CHECK to four, and this module read it as
 *
 *     status: r.status === 'waitlist' ? 'waitlist' : 'booked'
 *
 * which is not a narrowing of the column — it is a FALSE STATEMENT about two of
 * its four values. Every assertion in this block was checked to fail against
 * that line: with it restored, a cancelled booking arrives as 'booked' and the
 * member's screen prints "Booked — still to come" over a class they gave up, or
 * "Not recorded — your gym did not mark this either way" over one they cancelled
 * and may have been charged for.
 *
 * Part 3180 is what makes cancelled rows START EXISTING. Until it is applied
 * none of these rows can arrive; the moment it is, all four can. */

eq(bookingStatus('booked'), 'booked', 'a held seat is a held seat');
eq(bookingStatus('waitlist'), 'waitlist', 'and a queue place is a queue place');
eq(bookingStatus('cancelled'), 'cancelled',
  'a cancellation arrives as a cancellation and not as a booking');
eq(bookingStatus('late_cancelled'), 'late_cancelled',
  'and a LATE cancellation keeps the word the fee is charged against');

// The spellings are `sessions.outcome`'s, exactly — part 33 and part 3060's own
// header. A near-miss is a database writing past its constraint, and repairing
// it here would hide that.
eq(bookingStatus('canceled'), 'unknown', 'the American spelling is not this column’s word');
eq(bookingStatus('late-cancelled'), 'unknown', 'and neither is the hyphenated one');
eq(bookingStatus('cancelled_late'), 'unknown', 'nor the reordered one');

// The mutation that matters: anything unrecognised falling back to 'booked' is
// the original defect under a new name.
eq(bookingStatus('no_show'), 'unknown',
  'a word from a part this build predates is unknown, never a held seat');
eq(bookingStatus(null), 'unknown', 'a null status is not a booking');
eq(bookingStatus(undefined), 'unknown', 'and neither is a missing one');
eq(bookingStatus(''), 'unknown', 'nor an empty one');
eq(bookingStatus(7), 'unknown', 'nor something that is not a string at all');

/* ── what each of the four now says on the member’s screen ─────────────────── */

// FUTURE. This is the row that read "Booked — still to come" — the app telling
// somebody they hold a seat they gave up.
eqJson(classOutcome(booking({ classId: 'c1', status: 'cancelled' }), at(2026, 9, 20), false, now),
  { kind: 'cancelled' },
  'a cancelled class that has not run yet is CANCELLED, never "still to come"');
eqJson(classOutcome(booking({ classId: 'c1', status: 'late_cancelled' }), at(2026, 9, 20), false, now),
  { kind: 'late_cancelled' },
  'and a late one keeps its own word — the two are not one state with a flag');

// PAST. This is the row that read "Not recorded — your gym did not mark this
// either way", which is the exact sentence that screen’s header says it exists
// to prevent: the member marked it themselves.
eqJson(classOutcome(booking({ classId: 'c1', status: 'cancelled' }), at(2026, 9, 1), false, now),
  { kind: 'cancelled' },
  'a cancelled class that has run is still CANCELLED — somebody DID record this');
eqJson(classOutcome(booking({ classId: 'c1', status: 'late_cancelled' }), at(2026, 9, 1), false, now),
  { kind: 'late_cancelled' },
  'and the late cancellation a gym may bill for is not reported as unrecorded');

// The clock does not get a vote either way round. Asserted as an equality
// between the two times so no reordering of the branches can pass by accident.
eqJson(
  classOutcome(booking({ classId: 'c1', status: 'late_cancelled' }), at(2026, 9, 1), false, now),
  classOutcome(booking({ classId: 'c1', status: 'late_cancelled' }), at(2026, 9, 20), false, now),
  'the standing outranks the clock: a cancellation reads the same before and after the class');

// A status word this build cannot name. `bookingVerdict` in
// src/lib/classRegister.ts answers 'unmarked' for the same row and for the same
// reason, and no sixth outcome is invented here.
eqJson(classOutcome(booking({ classId: 'c1', status: 'unknown' }), at(2026, 9, 1), false, now),
  { kind: 'unmarked' }, 'a standing this build cannot read asks a human to look');
eqJson(classOutcome(booking({ classId: 'c1', status: 'unknown' }), at(2026, 9, 20), false, now),
  { kind: 'unmarked' },
  'and it does not become "still to come" just because the class has not run');

// Evidence still comes first, and this is a DIVERGENCE from `bookingVerdict`,
// asserted so it cannot be changed silently in either direction. A member who
// cancelled, came anyway and was logged through the door was at the gym that
// day, and `attendedDays` must not lose the day on the strength of a word.
eqJson(classOutcome(booking({ classId: 'c1', status: 'cancelled' }), at(2026, 9, 1), true, now),
  { kind: 'attended', register: false, door: true },
  'a door record on a cancelled booking is still somebody walking into the gym');
eqJson(
  classOutcome(booking({ classId: 'c1', status: 'late_cancelled', attendedAt: at(2026, 9, 1) }), at(2026, 9, 1), false, now),
  { kind: 'attended', register: true, door: false },
  'and a coach ticking them in is still a record of them being there');

/* ── NO-SHOW · rule 1, and the column part 3060 added to decide it ──────────
 *
 * `attended_at is null` on a class that has run meant two things and no read
 * could separate them. `gym_classes.register_taken_at` is the separator, and
 * NOTHING on the member's side read it before this lane. Every assertion here
 * fails against a truthiness test on the parameter or against a default of
 * `true`, which are the two ways this manufactures an absence. */

const missedArgs = [booking({ classId: 'c1' }), at(2026, 9, 1), false, now] as const;

eqJson(classOutcome(...missedArgs, at(2026, 9, 1, 18, 5)), { kind: 'missed' },
  'a booked seat, no tick, and a register somebody took, is a NO-SHOW');
eqJson(classOutcome(...missedArgs, null), { kind: 'unmarked' },
  'the same row with NO register taken is unmarked — a human has to look');
eqJson(classOutcome(...missedArgs), { kind: 'unmarked' },
  'and a caller that never passes the column at all gets unmarked, never missed');
eqJson(classOutcome(...missedArgs, ''), { kind: 'unmarked' },
  'an empty string is PostgREST rendering nothing, not a register taken at midnight');
eqJson(classOutcome(...missedArgs, '   '), { kind: 'unmarked' },
  'and neither is whitespace');

// The fact is the column being SET. A timestamp this module cannot parse is
// still somebody having taken the register, and reading it as "not taken" would
// throw the evidence away.
eqJson(classOutcome(...missedArgs, 'not-a-timestamp'), { kind: 'missed' },
  'an unparseable register stamp is still a register that was taken');

// The register decides nothing about anybody who is not a booked no-show.
eqJson(classOutcome(booking({ classId: 'c1', status: 'waitlist' }), at(2026, 9, 1), false, now, at(2026, 9, 1)),
  { kind: 'waitlisted' },
  'a taken register does not turn a waitlister who never got a seat into a no-show');
eqJson(classOutcome(booking({ classId: 'c1', status: 'cancelled' }), at(2026, 9, 1), false, now, at(2026, 9, 1)),
  { kind: 'cancelled' },
  'nor somebody who cancelled — they did not fail to turn up, they said they would not');
eqJson(classOutcome(booking({ classId: 'c1' }), at(2026, 9, 20), false, now, at(2026, 9, 1)),
  { kind: 'upcoming' },
  'nor a class that has not happened yet, whatever stamp the row carries');
eqJson(classOutcome(booking({ classId: 'c1' }), null, false, now, at(2026, 9, 1)),
  { kind: 'unknown' },
  'and a class whose time we cannot read stays unknown — a register cannot date it');

// The original guard, restated against BOTH register states. The left-hand side
// is the one rule 1 is about and it must never move.
ok(!['missed', 'absent', 'no-show'].includes(
  classOutcome(...missedArgs, null).kind),
  'with no register taken there is still no outcome that calls it an absence');
ok(classOutcome(...missedArgs, null).kind !== classOutcome(...missedArgs, at(2026, 9, 1)).kind,
  'and "nobody took the register" and "they did not come" are different answers, not one');

/* ── NOTHING MOVES FOR 'booked' AND 'waitlist' ──────────────────────────────
 *
 * src/lib/attendance.ts is read by THREE screens — app/(client)/attendance.tsx,
 * app/(trainer)/client-attendance.tsx and app/(trainer)/client.tsx through
 * `classMix` / `averageDwell` / `longestGap`. Widening the status vocabulary
 * must not change one word any of them sees for the two values that existed
 * before part 3060, and "it looked fine" is not a proof of that.
 *
 * So: `shipped` below is `classOutcome`'s body EXACTLY as it stood before this
 * lane — copied out of the file, not paraphrased, and deliberately not sharing
 * a line with the new one. Every combination of the two old statuses against
 * every shape of class time, evidence and register is run through both and the
 * answers compared. The register is swept as a third axis precisely because it
 * is new: it must change nothing here except the one cell rule 1 exists for.
 *
 * A reference implementation is the point. Comparing the new function against
 * ITSELF with the new argument defaulted would prove only that the default is
 * inert, which is a much weaker claim than the one being made. */

/** src/lib/attendance.ts `classOutcome`, verbatim, as of the commit before
 *  part 3060's vocabulary reached it. Do not tidy: its value is in being the
 *  old bytes. */
const shipped = (
  b: { status: 'booked' | 'waitlist'; attendedAt: string | null },
  startsAt: string | null,
  hasDoorRecord: boolean,
  nowArg: Date,
): unknown => {
  const register = !!b.attendedAt;
  if (register || hasDoorRecord) return { kind: 'attended', register, door: hasDoorRecord };
  if (b.status === 'waitlist') return { kind: 'waitlisted' };
  if (!startsAt) return { kind: 'unknown' };
  const t = Date.parse(startsAt);
  if (Number.isNaN(t)) return { kind: 'unknown' };
  return t > nowArg.getTime() ? { kind: 'upcoming' } : { kind: 'unmarked' };
};

for (const status of ['booked', 'waitlist'] as const) {
  for (const attendedAt of [null, at(2026, 9, 1, 18, 5)]) {
    for (const door of [false, true]) {
      for (const startsAt of [at(2026, 9, 1), at(2026, 9, 20), null, 'rubbish']) {
        // The one cell that is ALLOWED to move, and only in the direction rule 1
        // permits: a booked seat on a class that has run, with no evidence and a
        // register somebody took, is now `missed` instead of `unmarked`. Every
        // other cell must be byte-identical, register or no register.
        const isTheNoShowCell =
          status === 'booked' && attendedAt === null && !door && startsAt === at(2026, 9, 1);

        const before = shipped({ status, attendedAt }, startsAt, door, now);
        for (const reg of [null, '', at(2026, 9, 1, 18, 40)]) {
          const after = classOutcome({ status, attendedAt }, startsAt, door, now, reg);
          if (isTheNoShowCell && reg === at(2026, 9, 1, 18, 40)) {
            eqJson(after, { kind: 'missed' },
              `the one cell that moves: booked / no evidence / class has run / register taken`);
            continue;
          }
          eqJson(after, before,
            `booked and waitlist read exactly as the shipped function read them — status=${status} tick=${!!attendedAt} door=${door} startsAt=${String(startsAt)} register=${JSON.stringify(reg)}`);
        }
      }
    }
  }
}

// And the widening cannot have quietly changed what the two old words MAP to,
// which is the other half of "nothing moves": every consumer reaches
// `classOutcome` through `MyBooking.status`, and that is written by
// `bookingStatus` at the read.
eq(bookingStatus('booked'), booking({ classId: 'x' }).status,
  'the fixture and the mapper agree on what a booked row is');

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
eq(hidden.undated[0]?.day, null, 'it is carried with no day rather than a guessed one');
eq(hidden.undated[0]?.at, null, 'and no time');
eqJson(hidden.undated[0]?.outcome, { kind: 'unknown' },
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

/* ── the new states reach the timeline, and reach NO count ─────────────────── */

// `register_taken_at` is read off the class row and carried through the fold.
// The assertion is that the two classes differ ONLY in that column and produce
// different outcomes, so nothing else can be supplying the answer.
const regTaken = mergeAttendance(
  [booking({ classId: 'cr' })], [],
  new Map([['cr', klass({ id: 'cr', startsAt: at(2026, 9, 1, 18, 0), registerTakenAt: at(2026, 9, 1, 18, 40) })]]),
  now,
);
const regNotTaken = mergeAttendance(
  [booking({ classId: 'cr' })], [],
  new Map([['cr', klass({ id: 'cr', startsAt: at(2026, 9, 1, 18, 0), registerTakenAt: null })]]),
  now,
);
eqJson(regTaken.events[0].outcome, { kind: 'missed' },
  'the register column travels from the class row into the outcome');
eqJson(regNotTaken.events[0].outcome, { kind: 'unmarked' },
  'and the same booking under an untaken register is unmarked');

// A class row that never came back carries no register fact, and `undefined`
// must reach `classOutcome` as the same "we do not know" that null is.
const noClassRow = mergeAttendance(
  [booking({ classId: 'cr', attendedAt: null })], [],
  new Map([['cr', { ...klass({ id: 'cr', startsAt: at(2026, 9, 1, 18, 0) }), registerTakenAt: undefined }]]),
  now,
);
eqJson(noClassRow.events[0].outcome, { kind: 'unmarked' },
  'a class row with no register field at all is unmarked, never a no-show');

const dropped = mergeAttendance(
  [
    booking({ classId: 'c1', attendedAt: at(2026, 9, 1, 18, 5) }),
    booking({ classId: 'cx', status: 'cancelled' }),
    booking({ classId: 'cy', status: 'late_cancelled' }),
    booking({ classId: 'cz' }),
  ],
  [],
  new Map([
    ['c1', klass({ id: 'c1', startsAt: at(2026, 9, 1, 18, 0) })],
    ['cx', klass({ id: 'cx', startsAt: at(2026, 9, 2, 18, 0) })],
    ['cy', klass({ id: 'cy', startsAt: at(2026, 9, 3, 18, 0) })],
    // A genuine no-show: booked, unticked, and the register WAS taken.
    ['cz', klass({ id: 'cz', startsAt: at(2026, 9, 4, 18, 0), registerTakenAt: at(2026, 9, 4, 18, 40) })],
  ]),
  now,
);
eq(dropped.events.length, 4, 'all four are real events on the member’s own timeline');
eqJson(dropped.events.map((e) => e.outcome.kind),
  ['missed', 'late_cancelled', 'cancelled', 'attended'],
  'newest first, each saying what it actually was');
eqJson(attendedDays(dropped.events), [day1],
  'and only the attendance counts as a day they came — a cancellation is not a visit, and neither is a no-show');

/* ── RHYTHM · rule 4: no rate from a partial record ───────────────────────── */

// Four finished weeks and the current one. Weeks open on Sunday, and `now`
// above is Thursday 2026-09-10, so the week of 09-06 is still running.
const days = ['2026-08-09', '2026-08-12', '2026-08-17', '2026-08-25', '2026-08-31', '2026-09-02', '2026-09-08'];
const r = rhythm(days, '2026-09-10', 6, true);

eq(r.weeks.length, 6, 'six weeks are laid out even where nothing happened in one');
eq(r.weeks[0].start, '2026-09-06', 'the newest week is first');
eq(r.weeks[0].complete, false, 'the week we are standing in has not finished');
eq(r.weeks[1].start, '2026-08-30', 'and the one before it is the week before');
eq(r.weeks[1].days, 2, 'two days in the week of the 30th');
eq(r.firstDay, '2026-08-09', 'the record starts on the earliest day in it');

// Weeks of 08-09, 08-16, 08-23, 08-30 are complete and covered: 2 + 1 + 1 + 2 = 6.
eq(r.countedWeeks, 4, 'four finished weeks lie wholly inside the record');
eq(r.perWeek, 1.5, 'and the mean is over exactly those');

const partial = rhythm(days, '2026-09-10', 6, false);
eq(partial.perWeek, null, 'a read that came back truncated yields NO rate');
eq(partial.weeks.length, 6, 'the weeks themselves are still shown — the rows are real');
eq(partial.countedWeeks, 4, 'and the count of what would have been averaged is unchanged');

// A member whose record starts three weeks ago, averaged over twelve, must not
// read as somebody who trains once a fortnight.
const recent = rhythm(['2026-08-30', '2026-09-01', '2026-09-03'], '2026-09-10', 12, true);
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
// A door that recorded an entry AND an exit measured something, even when the
// two are the same instant — somebody scanned in and straight back out. That is
// zero minutes MEASURED, which is the one kind of zero this codebase keeps: the
// rule is that an absent figure may not be settled to zero, not that a real
// zero may not be reported. Asserted because the boundary was unpinned, and a
// `< 1` here would quietly turn a measurement into "no exit recorded".
eq(dwellMinutes({ enteredAt: at(2026, 9, 1, 18, 0), exitedAt: at(2026, 9, 1, 18, 0) }), 0,
  'in and straight back out is zero minutes measured, not an unknown stay');
eq(dwellMinutes({
  enteredAt: new Date(2026, 8, 1, 18, 0, 0).toISOString(),
  exitedAt: new Date(2026, 8, 1, 18, 0, 40).toISOString(),
}), 1, 'and forty seconds rounds to a minute rather than disappearing');

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

/* ── SCOPE: an empty coach-side read is not an empty client ───────────────── */
//
// `class_bookings_staff_r` and `gym_visits_staff_rw` are tenant-scoped, so an
// independent coach matches neither and is handed zero rows with error null.
// The screen above this cannot tell that apart from a client who has never been
// recorded, so it is told, and these are the three answers it can be told.

eq(staffScopeNote(true), null,
  'a coach with a gym may state an empty record as an empty record');

const noGym = staffScopeNote(false);
ok(noGym != null, 'a coach with no gym is never allowed to state an empty record');
ok(!/\d/.test(noGym as string),
  'and the sentence for it carries no figure — there is no figure to carry');
ok((noGym as string).includes('no record'),
  'it names the read as the thing that is missing, not the client');

const unknownGym = staffScopeNote(null);
ok(unknownGym != null, 'and neither may a coach whose own gym could not be read');
ok(unknownGym !== noGym,
  '"we could not find out" and "you have no gym" are different facts and read differently');

ok(!/never|did not|has not/i.test(STAFF_RECORD_NOTE),
  'the standing note about one gym’s record says what it covers, never what the client did not do');

/* ═══════════════════════════════════════════════════════════════════════════
   5. THE STRIP SAYS IN WORDS WHAT IT DRAWS IN SHAPES
   ═══════════════════════════════════════════════════════════════════════════

   The rhythm strip is the only thing on the attendance screen that carries a
   fact nowhere else on the page: which weeks this app knows nothing about. It
   carries it as a dashed border, and it prints `w.days || ''` underneath — so a
   covered week with zero days and a week before the record even starts are both
   an unlabelled shape with no number under it.

   Rule 1 of this file is that the app may not tell somebody they did not come.
   These assertions are that rule applied to the spoken half: an uncovered week
   must never be worded as an absence, and it must never be worded the same as a
   week that genuinely had none in it. */

const week = (o: Partial<RhythmWeek>): RhythmWeek =>
  ({ start: '2026-08-30', complete: true, covered: true, days: 0, ...o });

const uncovered = rhythmWeekLabel(week({ covered: false }), '30 Aug');
const emptyWeek = rhythmWeekLabel(week({ days: 0 }), '30 Aug');

ok(uncovered !== emptyWeek,
  'a week before the record starts and a week with nothing in it are different facts and must not read alike');
ok(!/no days|nothing recorded|0 days/i.test(uncovered),
  'an unread week is never worded as an absence — "no days recorded" is a claim we cannot make');
ok(/record/i.test(uncovered),
  'it names the record as the thing that is short, not the member');

// The count is not the discriminator, and this is the mutation that matters: a
// label that reaches for `w.days` before it asks whether the week is covered
// hands an uncovered week the empty-week sentence, which is the false fact this
// whole file exists to keep unreachable. Asserted against a week carrying a
// count rather than against a zero, so the check cannot pass by both sides
// happening to be the same wrong sentence.
eq(rhythmWeekLabel(week({ covered: false, days: 4 }), '30 Aug'), uncovered,
  'covered is read before the count, so no count can turn an unread week into an answer');

// The current week is a running total, not a total.
const running = rhythmWeekLabel(week({ complete: false, days: 3 }), '30 Aug');
ok(/so far/i.test(running) && /not over/i.test(running),
  'an unfinished week says it is unfinished, so three days by Wednesday is not read as the week’s figure');
const runningEmpty = rhythmWeekLabel(week({ complete: false, days: 0 }), '30 Aug');
ok(/not over/i.test(runningEmpty) && runningEmpty !== emptyWeek,
  'and an unfinished week with nothing in it yet is not "no days recorded"');

// Singular and plural, because "1 days" in the ear is the kind of thing that
// makes a person stop trusting the rest of the sentence.
ok(rhythmWeekLabel(week({ days: 1 }), '30 Aug').includes('1 day recorded'),
  'one day is one day');
ok(rhythmWeekLabel(week({ days: 2 }), '30 Aug').includes('2 days recorded'),
  'two days are two days');

// Nothing here builds a date. The caller formats it, so the sentence still
// reads when the caller has nothing to format — a label opening with a bare
// colon is scripts/check-prose.mjs's complaint, not a date bug.
const noDate = rhythmWeekLabel(week({ days: 2 }), '   ');
ok(!/\s:/.test(noDate) && !/of\s*:/.test(noDate) && noDate.includes('2 days'),
  'an unformattable week start still produces a sentence rather than "Week of : 2 days"');

/* ═══════════════════════════════════════════════════════════════════════════
   6. THE READ ITSELF, BECAUSE THE MAPPER BEING RIGHT IS NOT THE SAME FACT

   `bookingStatus` is asserted above and `classOutcome` is asserted above, and
   between them sits the one line this lane exists for:

       status: bookingStatus(r.status)      in `readAttendance`

   A mutation that puts the old expression back there —

       status: r.status === 'waitlist' ? 'waitlist' : 'booked'

   — passed every assertion in this file when they stopped at the pure
   functions. It is the original defect, restored, invisible. Nothing above
   calls the read, so nothing above could see it.

   So the read is exercised end to end against a Supabase double. The same
   argument covers `register_taken_at`: the column can be dropped from
   CLASS_COLUMNS or from the class row mapping and every pure-function
   assertion still passes, because they are all handed a `ClassDetail` built by
   the test rather than by the read.
   ═══════════════════════════════════════════════════════════════════════════ */

/** A `sb.from()` double. Each builder method returns `self` and `then` resolves
 *  the answer for that table, like the real PostgREST builder. */
const sbStub = (answers: Record<string, { data?: unknown; error?: unknown }>) => {
  const cols: Record<string, string> = {};
  const sb = {
    from: (table: string) => {
      const self: any = {
        select: (c: string) => { cols[table] = c; return self; },
        eq: () => self,
        in: () => self,
        order: () => self,
        range: () => self,
        limit: () => self,
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve(answers[table] ?? { data: [], error: null }).then(res),
      };
      return self;
    },
  };
  return { sb, cols };
};

(async () => {
  const CLASS_AT = at(2026, 9, 1, 18, 0);
  const { sb, cols } = sbStub({
    class_bookings: {
      data: [
        { id: 'b1', class_id: 'k1', status: 'booked', attended_at: null, created_at: at(2026, 8, 1) },
        { id: 'b2', class_id: 'k2', status: 'waitlist', attended_at: null, created_at: at(2026, 8, 1) },
        { id: 'b3', class_id: 'k3', status: 'cancelled', attended_at: null, created_at: at(2026, 8, 1) },
        { id: 'b4', class_id: 'k4', status: 'late_cancelled', attended_at: null, created_at: at(2026, 8, 1) },
        { id: 'b5', class_id: 'k5', status: 'something_part_3210_adds', attended_at: null, created_at: at(2026, 8, 1) },
      ],
      error: null,
    },
    gym_visits: { data: [], error: null },
    gym_classes: {
      data: [
        { id: 'k1', tenant_id: 'T1', title: 'Spin', kind: 'Cycle', instructor: 'Ana', branch: 'Main', room: null, starts_at: CLASS_AT, duration_min: 45, register_taken_at: at(2026, 9, 1, 18, 40) },
        { id: 'k2', tenant_id: 'T1', title: 'Spin', kind: 'Cycle', instructor: 'Ana', branch: 'Main', room: null, starts_at: CLASS_AT, duration_min: 45, register_taken_at: null },
        { id: 'k3', tenant_id: 'T1', title: 'Spin', kind: 'Cycle', instructor: 'Ana', branch: 'Main', room: null, starts_at: CLASS_AT, duration_min: 45, register_taken_at: null },
        { id: 'k4', tenant_id: 'T1', title: 'Spin', kind: 'Cycle', instructor: 'Ana', branch: 'Main', room: null, starts_at: CLASS_AT, duration_min: 45, register_taken_at: null },
        { id: 'k5', tenant_id: 'T1', title: 'Spin', kind: 'Cycle', instructor: 'Ana', branch: 'Main', room: null, starts_at: CLASS_AT, duration_min: 45, register_taken_at: null },
      ],
      error: null,
    },
  });

  const read = await fetchMyAttendance(sb, 'me');
  ok(read.ok, 'the three reads land');
  if (read.ok) {
    const byClass = new Map(read.value.bookings.map((b) => [b.classId, b]));

    // THE LINE. Each of the four words survives the read as itself.
    eq(byClass.get('k1')?.status, 'booked', 'a booked row reads as booked');
    eq(byClass.get('k2')?.status, 'waitlist', 'a waitlist row reads as waitlist');
    eq(byClass.get('k3')?.status, 'cancelled',
      'a CANCELLED row reads as cancelled and not as a booking — this is the collapse the lane removed');
    eq(byClass.get('k4')?.status, 'late_cancelled',
      'and a late cancellation keeps the word a fee is charged against');
    eq(byClass.get('k5')?.status, 'unknown',
      'a word from a later part is unknown at the read, not silently a held seat');

    // And the register column actually travels: named in the select, and read
    // off the row rather than defaulted.
    ok(/register_taken_at/.test(cols.gym_classes ?? ''),
      'the class select asks for the column part 3060 added');
    // The rest of the class row, pinned because it was unasserted: a title that
    // is a string is the title, and anything else is the empty string the
    // screen renders as "A class we could not read". The two arms are not
    // interchangeable.
    eq(read.value.classes.get('k1')?.title, 'Spin', 'a string title is the title');
    eq(read.value.classes.get('k1')?.durationMin, 45, 'and the duration is a number');
    eq(read.value.classes.get('k1')?.registerTakenAt, at(2026, 9, 1, 18, 40),
      'and the stamp is carried onto the class');
    eq(read.value.classes.get('k2')?.registerTakenAt, null,
      'while an untaken register stays null rather than becoming a time');

    // End to end: the same five rows through the fold, as the screen gets them.
    const { events } = mergeAttendance(read.value.bookings, read.value.visits, read.value.classes, now);
    const kindOf = (classId: string) =>
      events.find((e) => e.booking?.classId === classId)?.outcome.kind;
    eq(kindOf('k1'), 'missed', 'booked, unticked, register taken — a no-show, end to end');
    eq(kindOf('k2'), 'waitlisted', 'a waitlister who never got a seat is not one');
    eq(kindOf('k3'), 'cancelled', 'and the cancellation reaches the screen as a cancellation');
    eq(kindOf('k4'), 'late_cancelled', 'and the late one as a late one');
    eq(kindOf('k5'), 'unmarked', 'and the unreadable standing asks a human to look');
    eqJson(attendedDays(events), [],
      'none of the five is a day they came — the only tick in this set is absent');
  }

  // A refused booking read is never an empty history. Restated at this level
  // because everything above works on arrays that already exist.
  {
    const { sb: refused } = sbStub({
      class_bookings: { data: null, error: { message: 'refused' } },
      gym_visits: { data: [], error: null },
    });
    const res = await fetchMyAttendance(refused, 'me');
    eq(res.ok, false, 'a refused booking read refuses');
  }
  eq((await fetchMyAttendance(sbStub({}).sb, '')).ok, false,
    'and no signed-in member is not a member with no history');

  if (errors.length) {
    console.error(`attendance.test.ts — ${errors.length} failure(s):`);
    for (const e of errors) console.error('  · ' + e);
    process.exit(1);
  }
  console.log('attendance.test.ts — all assertions passed.');
})();
