// Counting a class register. Compile with tsc, run with node.
//
// The defect these guard: `present` counted every ticked row and `booked`
// counted only the rows holding a place, so two walk-ins off the waitlist
// pushed the two numbers level while two people who paid were still missing —
// and the hero said "Everyone booked is here." over a room that was not
// complete. The ring beside it could pass a full circle.
import {
  countRegister, registerArc, registerLine, bookingVerdict, registerCaveat,
  type RegisterRow, type RegisterTaken,
} from './classRegister';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const row = (status: string, attended: boolean): RegisterRow => ({ status, attended });

/* ── THE one: walk-ins never complete the room ──────────────────────────── */

const mixed = [
  row('booked', true), row('booked', true),
  // Two people who paid for the class and are not here.
  row('booked', false), row('booked', false),
  // Two off the waitlist, ticked in at the door.
  row('waitlist', true), row('waitlist', true),
];
const c = countRegister(mixed);
eq(c.booked, 4, 'the denominator is the people holding a place');
eq(c.present, 2, 'and the numerator comes out of that same set');
eq(c.walkIns, 2, 'the walk-ins are counted');
eq(c.waiting, 2, 'and so is the queue they came from');
eq(c.missing, 2, 'two booked members are still missing');
ok(!registerLine(c, true).startsWith('Everyone booked is here'),
  'a room with two booked members absent is never called complete');
ok(registerLine(c, true).includes('2 still to arrive'), 'it says how many are outstanding');
ok(registerLine(c, true).includes('came off the waitlist'), 'and the walk-ins are still reported');
eq(registerArc(c), 0.5, 'and the ring is half, not full');

/* ── a ring that cannot exceed itself ───────────────────────────────────── */

// The shape that used to draw more than a full circle: one booked member, three
// walk-ins, everybody ticked.
const over = countRegister([
  row('booked', true), row('waitlist', true), row('waitlist', true), row('waitlist', true),
]);
eq(over.present, 1, 'only the booked member counts toward the rate');
eq(registerArc(over), 1, 'so the ring is exactly full and never more');
eq(over.walkIns, 3, 'and the three at the door are not lost');

/* ── complete means complete ────────────────────────────────────────────── */

const done = countRegister([row('booked', true), row('booked', true)]);
eq(done.missing, 0, 'nobody outstanding');
eq(registerLine(done, true), 'Everyone booked is here.', 'which is the one time that sentence is said');
eq(registerArc(done), 1, 'and the ring is full');

/* ── an unread roster is not an empty class ─────────────────────────────── */

const none = countRegister([]);
eq(registerArc(none), null, 'a class nobody booked has no rate, rather than a rate of zero');
eq(registerLine(none, true), 'No bookings on this class yet.', 'and says so plainly');
ok(!/\d/.test(registerLine(none, false)), 'an unread roster is never described with a number');
ok(registerLine(none, false).includes('not a count of zero'), 'and says what it is not');

// A class nobody booked that somebody still trained at. The gym owes for those
// two whatever the booking sheet said.
const walkOnly = countRegister([row('waitlist', true), row('waitlist', true)]);
eq(walkOnly.booked, 0, 'nobody held a place');
eq(walkOnly.walkIns, 2, 'and two people trained anyway');
ok(registerLine(walkOnly, true).includes('came off the waitlist'), 'which is said rather than dropped');
eq(registerArc(walkOnly), null, 'with no rate, because there is no denominator');

// Singular and plural both read as English, and neither renders a count as a
// word.
const one = countRegister([row('booked', true), row('booked', false), row('waitlist', true)]);
ok(registerLine(one, true).includes('1 still to arrive'), 'one outstanding reads in the singular');
ok(registerLine(one, true).includes('1 person'), 'and so does one walk-in');
ok(!/undefined|NaN/.test(registerLine(one, true)), 'and nothing renders as a word');

// A status that is neither 'booked' nor one of part 3060's two cancelled words
// is a queue row. The column is free text with a check constraint, and a value
// nobody anticipated must not silently join the denominator a coach is paid
// against — nor be dropped from the register entirely, because somebody ticked
// in did turn up whatever word sits against their row.
const odd = countRegister([row('booked', true), row('standby', true)]);
eq(odd.booked, 1, 'an unexpected status is not counted as a place held');
eq(odd.walkIns, 1, 'it is counted as somebody who turned up');
eq(odd.unknownStanding, 1, 'and reported as a standing this build cannot name');

/* ══ part 3060 ══ cancelling stops being a delete, so status gains two words ══
 *
 * Every assertion below fails against the old `waiting = status !== 'booked'`.
 * That line was right for a two-value column and wrong the instant there is a
 * third, and the failure is the expensive direction: a class everybody dropped
 * out of would report a full waiting list. */

const dropped = [
  row('booked', true), row('booked', false),
  row('waitlist', false),
  row('cancelled', false), row('cancelled', false),
  row('late_cancelled', false),
];
const d = countRegister(dropped);
eq(d.booked, 2, 'a cancelled booking does not hold a place');
eq(d.waiting, 1, 'and it is NOT somebody standing in the queue either');
eq(d.cancelled, 2, 'the ordinary cancellations are counted');
eq(d.lateCancelled, 1, 'and the late one is counted apart, because it may be billed');
eq(d.unknownStanding, 0, 'both new words are words this build knows');
eq(d.booked + d.waiting + d.cancelled + d.lateCancelled, dropped.length,
  'and the four buckets partition the register exactly');

/* ── null is not zero and is not false: the register nobody took ─────────── */

const half = [row('booked', true), row('booked', false), row('booked', false)];

// The default. A build talking to a database without part 3060 cannot know, and
// must not manufacture a no-show — it is a thing gyms charge for.
const unknown = countRegister(half);
eq(unknown.missing, 2, 'two booked members are not ticked');
eq(unknown.noShow, 0, 'and NOT ONE of them is a recorded no-show');
eq(unknown.unmarked, 2, 'they are unmarked, which is the state that asks a human');
ok(registerLine(unknown, true).includes('2 still to arrive'),
  'and the sentence stays the one this function has always given');
ok(!/did not turn up/.test(registerLine(unknown, true)),
  'never claiming an absence off a register nobody took');

// The column read back false. Same counts, different sentence — the two are a
// different FACT even though they are the same arithmetic.
const notTaken = countRegister(half, false);
eq(notTaken.noShow, 0, 'an untaken register records no absence');
eq(notTaken.unmarked, 2, 'everybody un-ticked is unmarked');
ok((registerCaveat(false, 2) ?? '').includes('Nobody has taken this register'),
  'and the screen is told why');
ok((registerCaveat(null, 2) ?? '').includes('cannot tell'),
  'which is a different sentence from not knowing whether it was taken');
ok(registerCaveat(true, 2) == null, 'a taken register needs no caveat');
ok(registerCaveat(null, 0) == null, 'and neither does a register with nobody missing');

// Taken. NOW the absence is a fact, and this is the one case in this file where
// the product may say somebody did not turn up.
const taken = countRegister(half, true);
eq(taken.noShow, 2, 'a taken register turns an un-ticked booking into a no-show');
eq(taken.unmarked, 0, 'and leaves nothing unmarked');
eq(taken.missing, 2, 'while `missing` stays exactly what it always was');
eq(taken.noShow + taken.unmarked, taken.missing,
  'the two halves of `missing` always add back up to it');
ok(registerLine(taken, true, true).includes('2 did not turn up'),
  'and the sentence says so');
eq(registerArc(taken), 1 / 3, 'the ring is unaffected by any of this');

/* ── the verdict, in the words the one-to-one side already uses ──────────── */

eq(bookingVerdict(row('booked', true)), 'delivered', 'a tick is delivered');
eq(bookingVerdict(row('waitlist', true)), 'delivered',
  'a walk-in who trained, trained — whatever the show rate does with them');
eq(bookingVerdict(row('cancelled', false)), 'cancelled', 'cancelled reads cancelled');
eq(bookingVerdict(row('late_cancelled', false)), 'late_cancelled',
  'and a late cancellation is NOT folded into it — it is the billable one');
eq(bookingVerdict(row('booked', false), true), 'missed',
  'booked, not ticked, register taken: missed, which is what the PT side calls a no-show');
eq(bookingVerdict(row('booked', false), false), 'unmarked',
  'register not taken: unmarked, never missed');
eq(bookingVerdict(row('booked', false)), 'unmarked',
  'and an unknown register is read the same way as an untaken one');
eq(bookingVerdict(row('waitlist', false), true), 'unmarked',
  'a waitlister who never got a seat missed nothing');
eq(bookingVerdict(row('standby', false), true), 'unmarked',
  'a status this build has never heard of is unmarked, never delivered');
eq(bookingVerdict(row('standby', true), true), 'delivered',
  'though a tick against it is still a recorded attendance');
eq(bookingVerdict(row('cancelled', true), true), 'unmarked',
  'a cancelled booking that is also ticked is two facts that disagree, and this module picks neither');

/* ── the tri-state is a tri-state, and nothing coerces it ────────────────── */

// The failure this guards is a truthiness test — `registerTaken ? ... : ...`
// reads null as false, which happens to be right here, while `!= null` or a
// cast would read it as taken and invent an absence. Checked over all three.
const states: RegisterTaken[] = [true, false, null];
for (const st of states) {
  const c3 = countRegister(half, st);
  eq(c3.noShow + c3.unmarked, c3.missing, `the split is total for ${String(st)}`);
  ok(c3.noShow === 0 || st === true, `only a taken register yields a no-show (${String(st)})`);
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('classRegister: ok');
