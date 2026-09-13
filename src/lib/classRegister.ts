// Reading a class register: who is here, out of who was supposed to be.
//
// Pure, and kept out of classAttendance.ts for the reason stated at the top of
// classRates.ts: that module builds a Supabase client at import time, which
// drags AsyncStorage in with it and cannot be loaded under node.
//
// ── The defect this was extracted for ──────────────────────────────────────
//
// app/(trainer)/class-checkin.tsx counted two things over the same list with
// two different filters:
//
//     present = rows.filter(m => m.attended).length        // EVERY row
//     booked  = rows.filter(m => m.status === 'booked')    // booked rows only
//
// `classRoster` returns waitlist rows too, and every row on that screen is
// tappable — deliberately, because a place comes free at the door and the coach
// ticks the person standing in front of them. So two walk-ins ticked off the
// waitlist push `present` up to `booked` while two people who paid for the class
// are still missing, and the hero prints "Everyone booked is here." The ring
// beside it is `present / booked`, which can exceed 1 and draw a full circle on
// a class that is not full.
//
// The register is what a gym pays on and what retention is read from. The hero
// figure told the coach the room was complete on exactly the classes where it
// was not.
//
// ── The rule ───────────────────────────────────────────────────────────────
//
// A rate's numerator must be drawn from its own denominator. "Of the people who
// booked, how many are here" is one question; "who else turned up" is another
// and a real one, and the answer to the second is counted and shown rather than
// folded into the first. That is the same split part 460 makes on the server
// and the same one `GymClass.waitlistAttended` makes in src/lib/gymSchedule.ts.
//
// ── The second defect, and why `registerTaken` is a parameter ──────────────
//
// `missing` above is `booked - present`, and until part 3060 that figure meant
// two unrelated things at once. `set_class_attendance` writes
// `attended_at = case when p_present then now() else null end` and nothing
// anywhere recorded that a register had been TAKEN — so an un-ticked booked
// member was both "did not turn up" and "no coach ever opened this screen", and
// no read could tell which. A gym cannot charge a no-show fee off a figure that
// is half people who were never counted.
//
// Part 3060 adds `gym_classes.register_taken_at`, and `registerTaken` below is
// that column, read as a tri-state:
//
//     true    the register was taken. An un-ticked booked member is a NO-SHOW.
//     false   it was not taken. Every un-ticked member is UNMARKED.
//     null    WE DO NOT KNOW — the column was not selected, the read failed, or
//             this build is talking to a database that has not had part 3060
//             applied. Treated exactly as `false`: unmarked, never missed.
//
// It defaults to null, so every call site written before part 3060 keeps the
// behaviour it has today — `missing` unchanged, `noShow` zero, everything
// un-ticked reported as unmarked. A build that guessed `true` when it did not
// know would manufacture a no-show, and a no-show is a thing gyms bill for.
//
// ── The vocabulary is BORROWED ─────────────────────────────────────────────
//
// `PastState` is imported from src/lib/sessionHistory.ts rather than restated,
// so there is exactly one definition of what became of a booked hour in this
// product and a class cannot drift into a second spelling of it. Part 3060
// borrows the same words for `class_bookings.status`, from the same source —
// `sessions.outcome` in part 33. Type-only, so nothing at runtime is dragged in
// and this module still loads under plain `node`.
import type { PastState } from './sessionHistory';

/** One row of a class register, as much of it as the counting needs. */
export interface RegisterRow {
  /** `class_bookings.status`. 'booked' or 'waitlist' before part 3060; also
   *  'cancelled' or 'late_cancelled' after it. Kept as a plain string, not a
   *  union, because a value this build has never heard of must be classified as
   *  unknown rather than crash a register — the rule `pastVerdict` states for
   *  `sessions.outcome` and for the same reason. */
  status: string;
  attended: boolean;
}

/**
 * Whether the register for this class was taken. See the header.
 *
 * `null` is not `false` dressed up — they reach the same counts by design, and
 * they are a different FACT, which is why `registerCaveat` can say "nobody has
 * taken this register yet" for one and must stay quiet for the other.
 */
export type RegisterTaken = boolean | null;

export interface RegisterCount {
  /** People who hold a place. The denominator, and the only one.
   *
   *  A cancelled booking is NOT one of these. It is also not a waitlister —
   *  see `waiting`. */
  booked: number;
  /** Of those, how many are marked present. Can never exceed `booked`. */
  present: number;
  /** People on the waitlist. */
  waiting: number;
  /** Of those, how many were ticked in at the door. Real attendance the gym
   *  pays for, counted apart from the rate it does not belong in. */
  walkIns: number;
  /** Booked members not yet marked present.
   *
   *  Unchanged, and it is now the SUM of `noShow` and `unmarked` — two facts it
   *  could not separate before part 3060 and still reports together for every
   *  caller that has not been taught to ask. Never draw a fee off this. */
  missing: number;
  /** Of the missing, the ones the register says did not come: booked, not
   *  ticked, and somebody took the register. Zero whenever `registerTaken` is
   *  false or unknown — a no-show is a claim, and this module does not make it
   *  on a register nobody took. */
  noShow: number;
  /** Of the missing, the ones nobody has said anything about. This is the
   *  figure that asks a human to look, and before part 3060 every absent member
   *  in the product was one of these without any screen being able to say so. */
  unmarked: number;
  /** Bookings cancelled outside the gym's notice period. */
  cancelled: number;
  /** Bookings cancelled inside it. The one a gym may charge for, and the one
   *  that did not exist as a recordable fact until part 3060. */
  lateCancelled: number;
  /** Rows whose `status` is a word this build does not know.
   *
   *  A DIAGNOSTIC, and a SUBSET of `waiting` rather than a fifth bucket beside
   *  it — do not add it to anything. The partition is
   *  `booked + waiting + cancelled + lateCancelled === rows.length`, and an
   *  unrecognised status is deliberately inside `waiting`, which is where this
   *  module has always put it: a value nobody anticipated must not join the
   *  denominator a coach is paid against, and somebody who was ticked in did
   *  turn up whatever word is against their row. This says how many such rows
   *  there are so a screen can tell the coach the register holds standings it
   *  cannot name. */
  unknownStanding: number;
}

/** How the four standings part 3060 admits are spelled. Exactly as
 *  `sessions.outcome` spells the two they share; see the header. */
const CANCELLED = 'cancelled';
const LATE_CANCELLED = 'late_cancelled';
const BOOKED = 'booked';
const WAITLIST = 'waitlist';

export function countRegister(
  rows: readonly RegisterRow[],
  registerTaken: RegisterTaken = null,
): RegisterCount {
  const held = rows.filter((r) => r.status === BOOKED);
  // This line said `r.status !== 'booked'` until part 3060 widened the CHECK,
  // and that was correct for a two-value column. It becomes a live defect the
  // moment 'cancelled' exists: every cancellation would count as somebody
  // standing in the queue, so a class twelve people had dropped out of would
  // report twelve waiting and tell the coach to put on a second session — the
  // exact figure `class_counts()`' `waiting` column was added to get right.
  //
  // The two cancelled words are excluded and NOTHING ELSE IS. An unrecognised
  // status stays a queue row, which is this module's existing and argued
  // reading: it must not join the denominator a coach is paid against, and a
  // person who was ticked in turned up whatever word sits against their row.
  // `tallyBookings` in src/lib/gymSchedule.ts was already written narrow on both
  // sides and needs no equivalent fix.
  const isCancelled = (r: RegisterRow) =>
    r.status === CANCELLED || r.status === LATE_CANCELLED;
  const waiting = rows.filter((r) => r.status !== BOOKED && !isCancelled(r));
  const present = held.filter((r) => r.attended).length;
  const missing = held.length - present;
  return {
    booked: held.length,
    present,
    waiting: waiting.length,
    walkIns: waiting.filter((r) => r.attended).length,
    missing,
    // `=== true` and not a truthiness test: null must land here as zero.
    noShow: registerTaken === true ? missing : 0,
    unmarked: registerTaken === true ? 0 : missing,
    cancelled: rows.filter((r) => r.status === CANCELLED).length,
    lateCancelled: rows.filter((r) => r.status === LATE_CANCELLED).length,
    unknownStanding: waiting.filter((r) => r.status !== WAITLIST).length,
  };
}

/**
 * What became of one booking, in the words the rest of this product uses.
 *
 * `PastState` is `pastVerdict`'s own type and these are `pastVerdict`'s own
 * answers — 'missed' is what the one-to-one side calls a no-show, and calling
 * it anything else here would be the second vocabulary part 3060's header
 * refuses.
 *
 * Four rules and the fourth is the whole point:
 *
 *   · A cancelled booking that is ALSO ticked in is contradictory — two
 *     recorded facts that disagree — and reads 'unmarked'. This module does not
 *     pick a winner between two things a human wrote down. 'unmarked' is the
 *     state that asks somebody to look, which is the correct answer to a
 *     contradiction and the answer `pastVerdict` gives to an outcome it cannot
 *     read.
 *   · A tick is 'delivered' whatever the standing, waitlist included: a walk-in
 *     who trained, trained. `countRegister` keeps them out of the show RATE;
 *     this says what happened to them, which is a different question.
 *   · A booked member with no tick is 'missed' ONLY when the register was
 *     taken. Not when it was not, and not when we do not know.
 *   · Everything else — a waitlister who never got a seat, an un-taken
 *     register, a status word this build has never seen — is 'unmarked'. There
 *     is deliberately no sixth state invented for "never got in": a vocabulary
 *     this file extends on its own is a vocabulary the rest of the product
 *     cannot read.
 */
export function bookingVerdict(
  row: RegisterRow,
  registerTaken: RegisterTaken = null,
): PastState {
  const cancelled = row.status === CANCELLED || row.status === LATE_CANCELLED;
  if (cancelled) {
    if (row.attended) return 'unmarked';
    return row.status === LATE_CANCELLED ? 'late_cancelled' : 'cancelled';
  }
  if (row.attended) return 'delivered';
  if (row.status === BOOKED && registerTaken === true) return 'missed';
  return 'unmarked';
}

/**
 * What the screen must say about the register's own state, or null when there
 * is nothing to add.
 *
 * The sentence for `null` is the one this whole lane is about. A screen that
 * said "3 did not turn up" off a database that cannot tell it whether anybody
 * took the register would be stating, as fact, the thing that is not known —
 * and it is the fact a late-cancellation fee gets charged on.
 */
export function registerCaveat(taken: RegisterTaken, missing: number): string | null {
  if (missing <= 0) return null;
  if (taken === true) return null;
  if (taken === false) {
    return 'Nobody has taken this register yet, so the members not ticked are unmarked rather than absent.';
  }
  return 'This build cannot tell whether the register was taken, so the members not ticked are unmarked — that is not a record of anyone missing the class.';
}

/**
 * The proportion of booked members who are here, or null when there is no
 * denominator.
 *
 * Null and not 0 for a class nobody booked: a ring drawn at zero says nobody
 * turned up, and nobody was expected. Never above 1, which is the whole point —
 * the numerator comes out of `booked` and cannot come from anywhere else.
 */
export function registerArc(c: RegisterCount): number | null {
  if (c.booked <= 0) return null;
  return c.present / c.booked;
}

/**
 * The sentence under the hero.
 *
 * `known` is the register having actually been READ. An unread roster is not an
 * empty class, and the one sentence that must never be said about it is any
 * sentence with a number in it.
 *
 * "Everyone booked is here" is only ever said when every booked member is
 * ticked, and it now says so alongside the walk-ins rather than instead of
 * them: a coach owed money for two people at the door should be able to see
 * that they are counted.
 *
 * `taken` defaults to null, so a caller that has not been taught to read
 * `gym_classes.register_taken_at` gets the sentence this function has always
 * given. The difference it makes is one word and it is the difference between a
 * fact and a guess: "3 still to arrive" is true of a class nobody has
 * registered, and "3 did not turn up" is a claim that may be billed on, so it
 * is said only when something recorded that the register was taken.
 */
export function registerLine(
  c: RegisterCount, known: boolean, taken: RegisterTaken = null,
): string {
  if (!known) return 'The roster could not be read — this is not a count of zero.';
  const walk = c.walkIns > 0
    ? ` ${c.walkIns} ${c.walkIns === 1 ? 'person' : 'people'} came off the waitlist and ${c.walkIns === 1 ? 'is' : 'are'} counted separately.`
    : '';
  if (c.booked === 0) {
    return c.walkIns > 0
      ? `Nobody booked this class.${walk}`
      : 'No bookings on this class yet.';
  }
  if (c.missing === 0) return `Everyone booked is here.${walk}`;
  if (taken === true) {
    return `${c.noShow} did not turn up.${walk}`;
  }
  return `${c.missing} still to arrive.${walk}`;
}
