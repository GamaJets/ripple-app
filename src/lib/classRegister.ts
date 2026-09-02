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

/** One row of a class register, as much of it as the counting needs. */
export interface RegisterRow {
  /** `class_bookings.status` — 'booked' or 'waitlist'. */
  status: string;
  attended: boolean;
}

export interface RegisterCount {
  /** People who hold a place. The denominator, and the only one. */
  booked: number;
  /** Of those, how many are marked present. Can never exceed `booked`. */
  present: number;
  /** People on the waitlist. */
  waiting: number;
  /** Of those, how many were ticked in at the door. Real attendance the gym
   *  pays for, counted apart from the rate it does not belong in. */
  walkIns: number;
  /** Booked members not yet marked present. */
  missing: number;
}

export function countRegister(rows: readonly RegisterRow[]): RegisterCount {
  const held = rows.filter((r) => r.status === 'booked');
  const waiting = rows.filter((r) => r.status !== 'booked');
  const present = held.filter((r) => r.attended).length;
  return {
    booked: held.length,
    present,
    waiting: waiting.length,
    walkIns: waiting.filter((r) => r.attended).length,
    missing: held.length - present,
  };
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
 */
export function registerLine(c: RegisterCount, known: boolean): string {
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
  return `${c.missing} still to arrive.${walk}`;
}
