// src/lib/classSeat.ts — the member's own standing on a class, and the three
// nothings a seat count has.
//
// The defect this file was written against is named in supabase/parts/3180 §8
// and is a member-facing regression the moment that part is applied: a
// cancelled booking keeps its row, `myStatus[id]` stays truthy, and the class
// the member just cancelled renders as one they still hold — with a Cancel
// button on it and no way back in.
//
// Run under several zones like every other suite here. Nothing in this module
// reads a clock, and asserting that rather than assuming it is the point:
//
//   for z in Pacific/Kiritimati UTC Pacific/Midway; do TZ=$z node .tmp/lib/classSeat.test.js; done
import {
  seatStanding, holdsPlace, seatControl, seatNote, waitlistNote, placesFree, isFull,
  type SeatStanding,
} from './classSeat';

let failures = 0;
function eq<T>(got: T, want: T, what: string): void {
  const ok = got === want;
  if (!ok) { failures++; console.error(`FAIL ${what}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${what}`);
}
function truthy(got: unknown, what: string): void {
  if (got) console.log(`ok   ${what}`);
  else { failures++; console.error(`FAIL ${what}\n  got ${JSON.stringify(got)}`); }
}

/* ── seatStanding: the four words, and everything that is not one ────────── */

eq(seatStanding('booked'), 'held', 'a booked row is a seat held');
eq(seatStanding('waitlist'), 'queued', 'a waitlist row is a place in the queue');
eq(seatStanding('cancelled'), 'cancelled', 'a cancellation survives as itself');
eq(seatStanding('late_cancelled'), 'late_cancelled',
  'and a late one is NOT folded into the ordinary cancellation — it is the one a gym may bill on');

// The three spellings of "there is no row", which a screen must not tell apart.
eq(seatStanding(null), 'none', 'null is no row at all');
eq(seatStanding(undefined), 'none', 'and so is an absent key');
eq(seatStanding(''), 'none', 'and so is the empty string');
eq(seatStanding('   '), 'none', 'whitespace is the empty string with extra steps');

// The regression itself, stated as the assertion that would have caught it.
truthy(seatStanding('cancelled') !== 'held',
  'THE REGRESSION: a cancelled row is not a held seat, however truthy its status string is');

// A word from a part this build predates. Not a seat, not an absence.
eq(seatStanding('no_show'), 'unknown', 'a fifth word this build has never seen is unknown');
eq(seatStanding('BOOKED'), 'unknown', 'the spelling is exact — a case variant is a word nobody wrote');
eq(seatStanding(7), 'unknown', 'a number is not a standing');
eq(seatStanding({}), 'unknown', 'nor is an object');

/* ── holdsPlace: the test that replaces the truthiness of a string ───────── */

eq(holdsPlace('held'), true, 'a seat is a place held');
eq(holdsPlace('queued'), true, 'so is a place in the queue');
eq(holdsPlace('cancelled'), false, 'a cancellation holds nothing');
eq(holdsPlace('late_cancelled'), false, 'and neither does a late one');
eq(holdsPlace('none'), false, 'nor does never having booked');
eq(holdsPlace('unknown'), false, 'nor does a word we cannot read — we do not claim a place we cannot name');

/* ── seatControl: what the row may arm ───────────────────────────────────── */

eq(seatControl('held'), 'cancel', 'a seat may be given up');
eq(seatControl('queued'), 'leave', 'a queue may be left, and that is a different verb');
eq(seatControl('none'), 'book', 'a class with nothing of yours on it offers the seat');
eq(seatControl('cancelled'), 'book',
  'AND SO DOES A CANCELLED ONE — part 3180 §5 allows the re-book precisely so a member is not locked out for ever');
eq(seatControl('late_cancelled'), 'book', 'a late cancellation is not a ban either');
eq(seatControl('unknown'), 'none',
  'a standing this build cannot name arms nothing: Cancel would be destructive against something unnamed, Book an upsert over it');

// Every standing has a control and none of them throws.
(['none', 'held', 'queued', 'cancelled', 'late_cancelled', 'unknown'] as SeatStanding[])
  .forEach((s) => truthy(typeof seatControl(s) === 'string', `seatControl is total for ${s}`));

/* ── seatNote: what the member reads ─────────────────────────────────────── */

eq(seatNote('none'), null, 'nothing of theirs means the class speaks for itself');
eq(seatNote('held'), 'Booked', 'a seat says so plainly');
truthy((seatNote('cancelled') ?? '').includes('cancelled this'),
  'a cancellation is reported in the past tense, as a thing they did');
truthy((seatNote('cancelled') ?? '').includes('not expecting you'),
  'and says the gym is not expecting them, which is the half that stops a wasted journey');
truthy((seatNote('late_cancelled') ?? '').includes('notice period'),
  'a late cancellation says it was late');

// No amount, no currency, no fee named — the figure belongs to the row in
// class_booking_cancellations that stored the policy as it was.
(['cancelled', 'late_cancelled'] as SeatStanding[]).forEach((s) => {
  const line = seatNote(s) ?? '';
  truthy(!/\d/.test(line), `${s} names no figure at all`);
  truthy(!/fee|charge|cost|£|\$|€/i.test(line), `${s} names no fee and no currency`);
});

truthy((seatNote('unknown') ?? '').includes('cannot read'),
  'an unreadable standing says so rather than guessing at one');

/* ── waitlistNote: null FIRST, and zero is a real answer ─────────────────── */

// The exact trap: `null > 0` is false, so a null tested after `> 0` lands in
// "nobody was waiting".
eq(waitlistNote(null, true, true), 'How many are waiting is not recorded.',
  'an unread queue on a full class is UNKNOWN, never nobody');
eq(waitlistNote(undefined, true, true), 'How many are waiting is not recorded.',
  'and so is an absent column');
eq(waitlistNote('', true, true), 'How many are waiting is not recorded.',
  'the empty string is not a counted zero, whatever Number() says about it');
eq(waitlistNote(-1, true, true), 'How many are waiting is not recorded.',
  'a negative is not a queue length');
eq(waitlistNote(1.5, true, true), 'How many are waiting is not recorded.',
  'and neither is a fraction of a person');

eq(waitlistNote(0, true, true), 'Nobody is waiting.',
  'a counted zero on a full class IS said — it is what somebody decides whether to hang around on');
eq(waitlistNote(1, true, true), '1 person waiting.', 'one person, singular');
eq(waitlistNote(3, true, true), '3 people waiting.', 'three, plural');
eq(waitlistNote('3', true, true), '3 people waiting.', 'a digit string is the server having counted, via jsonb');

// The counts read not having landed at all is its own nothing and outranks the
// number, because a queue length carried over from an earlier read is not one.
eq(waitlistNote(4, false, true), 'We could not read how many are waiting.',
  'an unread counts read withholds the figure even when a stale number is to hand');
eq(waitlistNote(4, false, false), null, 'and says nothing at all where there is nothing to decide');

// A class with places left: the queue is only worth a sentence when there is one.
eq(waitlistNote(0, true, false), null, 'nobody waiting for a class with spaces is noise');
eq(waitlistNote(null, true, false), null, 'and an unknown queue on a class with spaces is too');
eq(waitlistNote(2, true, false), '2 people waiting.',
  'but a real queue on a class with spaces is a fact and is stated');

/* ── placesFree / isFull: the unsized class ──────────────────────────────── */

eq(placesFree(12, 5, true), 7, 'twelve places, five taken, seven left');
eq(placesFree(12, 12, true), 0, 'a counted zero is a real answer and is a full class');
eq(placesFree(12, 14, true), 0,
  'an over-booked class reads as none left, never as minus two');

eq(placesFree(12, 5, false), null, 'an unread counts read has no number in it');
eq(placesFree(0, 0, true), null,
  'THE UNSIZED CLASS: a capacity of zero is a class nobody sized, and 0 left reads as sold out');
eq(placesFree(-3, 0, true), null, 'a negative capacity is not a size either');
eq(placesFree(null, 0, true), null, 'nor is a missing one');
eq(placesFree(12, null, true), null, 'and a missing booked count is not a booked count of none');
eq(placesFree('x', 1, true), null, 'anything that is not a finite number is no answer');

eq(isFull(12, 12, true), true, 'full is full');
eq(isFull(12, 5, true), false, 'and seven left is not');
eq(isFull(0, 0, true), null,
  'an unsized class is NEITHER — a boolean here is what draws "Class full" over a class nobody measured');
eq(isFull(12, 5, false), null, 'and so is an unread one');

/* ── the clock, asserted rather than assumed ─────────────────────────────── */

truthy(seatStanding('booked') === 'held' && waitlistNote(0, true, true) === 'Nobody is waiting.',
  `every answer above is the same in ${Intl.DateTimeFormat().resolvedOptions().timeZone} as in any other zone: nothing here reads a clock`);

console.log(failures ? `\n${failures} failed` : '\nclassSeat: all good');
process.exit(failures ? 1 : 0);
