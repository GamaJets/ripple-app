// A coach's own register figures may not be more confident than the register.
// Compile with tsc, run with node.
//
// Two failures are being made unreachable here and they point in opposite
// directions, which is why both blocks exist:
//
//   · A class nobody registered counted as a class nobody came to. That is
//     src/lib/attendance.ts's rule 1 arriving from the coach's end — an
//     unticked register is not an absence — and its cost here is a coach's own
//     show rate dragged down by paperwork rather than by people.
//   · Walk-ins folded into the rate they do not belong in, or counted as nought
//     when the column that holds them does not exist. src/lib/classRegister.ts
//     is the whole argument for the first; `classPayBlocker` in
//     src/lib/gymPay.ts is the whole argument for the second.
//
// No expectation is built against a hardcoded "today": `npm run test:zones`
// runs this in six zones and `rollingWindow` crosses a local midnight.
import {
  rollingWindow, splitTaught, showRateOf, paidHeadcount, paidHeadcountTotal,
  classLine, gapNote, walkInsKnown, TAUGHT_SCOPE_NOTE,
} from './coachRegister';
import type { ClassSummaryRow } from './classRates';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const eqJson = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const cls = (over: Partial<ClassSummaryRow> & { classId: string }): ClassSummaryRow => ({
  title: 'Spin', kind: 'spin', branch: 'Main', trainerId: 'coach-1', trainerName: 'Sam',
  startsAt: '2026-08-20T18:00:00.000Z', capacity: 20, booked: 0, attended: 0, ...over,
});

/* ── WINDOW ───────────────────────────────────────────────────────────────── */

const now = new Date(2026, 7, 20, 14, 30);
const w = rollingWindow(now, 30);
ok(w != null, 'thirty days is a window');
eq(w?.toISO, now.toISOString(), 'which ends now, not at the end of a calendar period');
eq(Math.round((Date.parse(w!.toISO) - Date.parse(w!.fromISO)) / 86400000), 30,
  'and spans the days it says, across a local midnight in any zone');
ok(w!.label.includes('30'), 'the label says which window it is');
eq(rollingWindow(now, 0), null, 'a window of no days is refused rather than answered as today');
eq(rollingWindow(now, -7), null, 'and so is a negative one');

/* ── UNREGISTERED IS NOT EMPTY ────────────────────────────────────────────── */
//
// The defect: `attended / booked` over every class the coach taught. A class of
// twelve where the coach never pressed the button contributes 0/12 and reads on
// screen as a class nobody came to, in the one figure a coach is judged on.

const taught = [
  cls({ classId: 'a', booked: 10, attended: 8, waitlistAttended: 0 }),
  cls({ classId: 'b', booked: 12, attended: 0, waitlistAttended: 0 }),  // register not taken
  cls({ classId: 'c', booked: 0, attended: 0, waitlistAttended: 0 }),   // nobody booked
  cls({ classId: 'd', booked: 0, attended: 0, waitlistAttended: 2 }),   // two walked in
];
const split = splitTaught(taught);
eqJson(split.registered.map((r) => r.classId), ['a', 'd'],
  'a class is registered when somebody was marked, off the register or off the door');
eqJson(split.unregistered.map((r) => r.classId), ['b'],
  'a class with bookings and nothing marked is a register that was not taken');
eqJson(split.noBookings.map((r) => r.classId), ['c'],
  'and a class nobody booked had no register to take, so it is neither');

ok(!split.registered.some((r) => r.classId === 'b'),
  'the unregistered class is kept out of the set any rate is computed over');

eq(showRateOf({ booked: 10, attended: 8 }), 0.8, 'the rate is present over booked');
eq(showRateOf({ booked: 0, attended: 0 }), null,
  'a class nobody booked has no rate, rather than a rate of nought');
ok((showRateOf({ booked: 4, attended: 4 }) as number) <= 1,
  'and the rate can never exceed one — the numerator comes out of the denominator');

const line = classLine(taught[1]);
ok(line.includes('not taken'), 'the line for it names the missing register');
ok(!/missed|absent|nobody came to this/i.test(line),
  'and never says the class was missed or empty');
ok(classLine(taught[0]).includes('8 of the 10'),
  'a registered class states both halves of its own fraction');

/* ── WALK-INS: BESIDE THE RATE, AND NEVER NOUGHT WHEN UNKNOWN ─────────────── */

const withWalkIns = cls({ classId: 'e', booked: 10, attended: 9, waitlistAttended: 3 });
eq(showRateOf(withWalkIns), 0.9,
  'three walk-ins do not push the show rate above the people who booked');
eq(paidHeadcount(withWalkIns), 12, 'but they are in the headcount the gym pays on');
ok(classLine(withWalkIns).includes('came off the waitlist'),
  'and the line reports them rather than folding them in');

const noColumn = cls({ classId: 'f', booked: 10, attended: 9 });  // waitlistAttended undefined
eq(paidHeadcount(noColumn), null,
  'a database without the walk-in column yields no headcount — unknown is not nought');
ok(!classLine(noColumn).includes('came off the waitlist'),
  'and its line does not print a walk-in count it does not have');
ok(classLine(noColumn).includes('may be higher'),
  'it says which direction the missing figure runs in');

eq(paidHeadcountTotal([withWalkIns, cls({ classId: 'g', booked: 4, attended: 4, waitlistAttended: 1 })]), 17,
  'the total is every marked attendance, register and door');
eq(paidHeadcountTotal([withWalkIns, noColumn]), null,
  'one unanswerable row makes the whole total unanswerable, not smaller');
eq(paidHeadcountTotal([]), 0,
  'and no classes really is a headcount of nought — that one is a measurement');

ok(walkInsKnown([withWalkIns]), 'walk-ins are known when every row carries the column');
ok(!walkInsKnown([withWalkIns, noColumn]), 'and unknown as soon as one does not');

/* ── WHAT IS SAID ABOUT THE GAPS ──────────────────────────────────────────── */

const note = gapNote(split, true);
ok(note != null && note.includes('1 class had'),
  'the unregistered classes are counted out loud rather than quietly dropped');
ok(note != null && note.includes('left out of the rate'),
  'and the note says what they are NOT counted as');

eq(gapNote({ registered: [taught[0]], unregistered: [], noBookings: [] }, true), null,
  'with a full register and known walk-ins there is no gap to report');

const walkGap = gapNote({ registered: [noColumn], unregistered: [], noBookings: [] }, false);
ok(walkGap != null && walkGap.includes('not nought'),
  'an absent walk-in column is reported as unknown rather than as zero');

ok(!/covered|front desk/i.test(gapNote(split, true) as string),
  'the scope caveat is its own sentence and is not mixed into the gap note');
ok(TAUGHT_SCOPE_NOTE.includes('covered') && TAUGHT_SCOPE_NOTE.includes('not evidence'),
  'and it says both that cover is missing and that its absence proves nothing');

if (errors.length) {
  console.error(`coachRegister.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('coachRegister.test.ts — all assertions passed.');
