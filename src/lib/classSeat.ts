// What the member's OWN row against a class says — and the four words it can
// now say rather than the two the app was written for.
//
// ── What went wrong ────────────────────────────────────────────────────────
//
// Cancelling a class used to be a DELETE. `cancel_class` removed the row from
// `class_bookings` (part 02), so a member who dropped out simply had no row,
// `myStatus[classId]` had no key, and app/(client)/classes.tsx read the absence
// as "not booked" and drew Book. That reading was correct for as long as a
// cancellation erased itself.
//
// supabase/parts/3060 and /3180 stopped it erasing itself, because a correction
// is a second recorded fact and never an erasure. `class_bookings.status` now
// accepts 'cancelled' and 'late_cancelled' alongside 'booked' and 'waitlist',
// and the row SURVIVES the cancellation. Part 3180's own header, §8, says what
// that does to the member's screen and names the file it could not fix:
//
//     After this part the row survives with status 'cancelled', the key is
//     present and truthy, and the class the member just cancelled renders as
//     one they still hold.
//
// Which is two harms, not one. The screen tells them they hold a seat they gave
// up — so they may not turn up to a class they still think is theirs, or worse
// arrange their evening around it — and, because the Book control is drawn only
// where there is no booking, THE RE-BOOK BUTTON IS GONE. A member who cancels
// and changes their mind has no way back in from the screen the timetable is
// on. The gym cannot sell the seat to them either; the front desk has to.
//
// ── Why this is a module and not four lines in the screen ──────────────────
//
// Because it is the same question `bookingVerdict` in src/lib/classRegister.ts
// answers for the COACH, and the two must not come to disagree about what a
// word means. That file is the vocabulary — 'cancelled' and 'late_cancelled'
// spelled exactly as `sessions.outcome` spells them (part 33) — and this is the
// member's side of the same column: not "what became of this booking" but "is
// this seat still mine, and what may I do about it".
//
// The two are deliberately different functions. `bookingVerdict` needs the
// register and the attendance tick and answers in `PastState`, which is a
// history word; a member looking at a timetable of classes that have not
// happened yet has neither of those and needs a CONTROL. Sharing the constants
// rather than the function is what keeps the spellings in one place without
// pretending the questions are the same.
//
// ── The rule for a word this build has never seen ──────────────────────────
//
// It is not a seat and it is not an absence, and no control is offered against
// it. That is `countRegister`'s `unknownStanding` rule carried over: a value
// nobody anticipated must not join a count, and here it must not arm a button
// either. Offering Cancel would aim a destructive write at something unnamed;
// offering Book would upsert over a standing this build cannot read. Saying so
// and sending the member to reception is the only honest answer, and it is
// reachable only if a later part adds a fifth word to the CHECK constraint.
//
// Framework-free like the rest of src/lib, so it runs under plain `node`.

// The queue reading, imported rather than written a seventh time. See its own
// header in src/lib/reschedule.ts: `Number('')` is 0 and `Number(null)` is 0,
// and neither of those is somebody having counted an empty queue.
import { queueLength } from './reschedule';

/**
 * How the four words part 3060 admits are spelled.
 *
 * The same four literals as src/lib/classRegister.ts, and deliberately not
 * imported from it: that module keeps them private, and a second spelling is
 * the defect both files exist to prevent. If either list ever grows, both grow.
 */
const BOOKED = 'booked';
const WAITLIST = 'waitlist';
const CANCELLED = 'cancelled';
const LATE_CANCELLED = 'late_cancelled';

/**
 * Where this member stands on this class.
 *
 * 'none' is the ABSENCE of a row and is the only one of these that means they
 * never booked. 'cancelled' and 'late_cancelled' are rows that exist and say
 * they gave the seat up, which before part 3060 was the same state as 'none'
 * and is not any more — a late cancellation is a fact a gym may bill on, and
 * collapsing it into "never booked" is how it stops being visible to the person
 * it is charged to.
 */
export type SeatStanding =
  /** No booking row at all. They have never booked this class. */
  | 'none'
  /** `status = 'booked'`. The seat is theirs. */
  | 'held'
  /** `status = 'waitlist'`. In the queue; no seat yet. */
  | 'queued'
  /** `status = 'cancelled'`. They gave it up outside the gym's notice period. */
  | 'cancelled'
  /** `status = 'late_cancelled'`. Inside it — the one a gym may charge for. */
  | 'late_cancelled'
  /** A status word this build has never heard of. Never a seat, never an
   *  absence, and never a control. */
  | 'unknown';

/**
 * The member's row → where they stand.
 *
 * Null, undefined and the empty string are all 'none': those are the three ways
 * `myStatus[id]` says there is no row, and a screen must not tell them apart.
 * Anything else that is not one of the four words is 'unknown' — including a
 * number, an object, or a word from a part this build predates.
 */
export function seatStanding(status: unknown): SeatStanding {
  if (status == null) return 'none';
  if (typeof status !== 'string') return 'unknown';
  const s = status.trim();
  if (!s) return 'none';
  switch (s) {
    case BOOKED: return 'held';
    case WAITLIST: return 'queued';
    case CANCELLED: return 'cancelled';
    case LATE_CANCELLED: return 'late_cancelled';
    default: return 'unknown';
  }
}

/** Whether this standing is a place the member currently holds — a seat or a
 *  position in the queue. False for a cancellation, which is the whole point:
 *  every "do they still have something" test in a screen goes through here
 *  rather than through the truthiness of a status string. */
export function holdsPlace(s: SeatStanding): boolean {
  return s === 'held' || s === 'queued';
}

/**
 * What the row may offer.
 *
 *   'cancel'  they hold a seat and may give it up.
 *   'leave'   they are queueing and may leave the queue.
 *   'book'    there is nothing of theirs on this class; offer the seat.
 *   'none'    say nothing and arm nothing. See the header on 'unknown'.
 *
 * 'book' for a cancellation is a decision and part 3180 §5 is why it is safe:
 * `book_class` was changed to allow re-booking over a cancelled row precisely
 * because the alternative was a member who "can never book it again", and the
 * cancellation is not lost by it — it lives in
 * `class_booking_cancellations`, appended, one row per occurrence.
 */
export type SeatControl = 'cancel' | 'leave' | 'book' | 'none';

export function seatControl(s: SeatStanding): SeatControl {
  switch (s) {
    case 'held': return 'cancel';
    case 'queued': return 'leave';
    case 'none': return 'book';
    case 'cancelled': return 'book';
    case 'late_cancelled': return 'book';
    case 'unknown': return 'none';
  }
}

/**
 * What the line beside the dot says about the MEMBER's own standing, or null
 * when they have no standing and the class's own line should speak instead.
 *
 * A cancellation says so in the past tense and says the seat is gone, because
 * the sentence a member needs here is not "you are not booked" — which is also
 * true of a class they have never heard of — but "you had this and you gave it
 * up", which is the one that stops them turning up.
 *
 * A late cancellation says it was late and stops there. It does NOT name a fee,
 * an amount or a currency: what was charged was decided by the gym's policy at
 * the moment of cancelling and stored beside the figure in
 * `class_booking_cancellations` (part 3180 §5), and quoting today's policy over
 * a cancellation made last month bills somebody a price nobody showed them.
 * src/lib/classCancel.ts is where a fee is worded, from the row that holds it.
 */
export function seatNote(s: SeatStanding): string | null {
  switch (s) {
    case 'held': return 'Booked';
    case 'queued': return 'On the waitlist';
    case 'cancelled':
      return 'You cancelled this. Your place is gone and the gym is not expecting you.';
    case 'late_cancelled':
      return 'You cancelled this inside your gym’s notice period. Your place is gone and the gym is not expecting you.';
    case 'unknown':
      return 'Your booking on this class is in a state this app cannot read, so nothing here can be relied on. Ask reception.';
    case 'none': return null;
  }
}

/**
 * How many people are queueing, as a sentence, or null when there is nothing
 * honest to say.
 *
 * ── The null test comes FIRST, and that is the whole function ──────────────
 *
 * `null > 0` is false in JavaScript, so a null test written AFTER the `> 0`
 * test never runs: the unknown queue falls into the "nobody was waiting" arm
 * and a class whose demand nobody could read is reported as a class nobody
 * wants. Six lanes in this codebase have now worked through that exact shape.
 * Here the order is enforced by there being no `> 0` branch above the null one.
 *
 * `known` is the counts read having landed at all — `countsKnown` in
 * src/ui/classes.tsx. A cached timetable withholds its counts wholesale, and a
 * queue length carried over from an earlier read is not a queue length now.
 *
 * Zero is a real answer and is SAID, not swallowed, but only about a class that
 * is full: "nobody waiting" under a class with nine free places is noise, and
 * under a full one it is the fact a member decides whether to hang around on.
 */
export function waitlistNote(waiting: unknown, known: boolean, full: boolean): string | null {
  if (!known) return full ? 'We could not read how many are waiting.' : null;
  const n = queueLength(waiting);
  if (n == null) return full ? 'How many are waiting is not recorded.' : null;
  if (n === 0) return full ? 'Nobody is waiting.' : null;
  return `${n} ${n === 1 ? 'person' : 'people'} waiting.`;
}

/**
 * Places still for sale on this class, or null when there is no answer.
 *
 * The same rule as `placesLeft` in src/lib/gymSchedule.ts and restated here
 * because this one also has to survive the counts not having been read at all —
 * which is a third nothing that file's callers do not have.
 *
 * Three ways to get null and a screen must render all three the same way, as
 * "we do not know", never as a number:
 *
 *   · the counts read did not land (`known` false);
 *   · the class records no capacity, or a capacity of zero or less. A class
 *     nobody sized has an UNKNOWN number of free places, and 0 reads as sold
 *     out, which is what the front desk turns somebody away on;
 *   · either figure is not a finite number.
 *
 * Note what this does NOT do: it never clamps a booked count above capacity
 * into a negative. `Math.max(0, …)` is applied, so an over-booked class reads
 * as none left rather than as minus two, which is the only reading a member can
 * act on.
 */
export function placesFree(
  capacity: unknown, booked: unknown, known: boolean,
): number | null {
  if (!known) return null;
  const cap = count(capacity);
  const got = count(booked);
  if (cap == null || got == null) return null;
  if (cap <= 0) return null;
  return Math.max(0, cap - Math.max(0, got));
}

/**
 * A figure that was actually counted, or null.
 *
 * NOT `Number(v)`. `Number(null)` is 0 and `Number('')` is 0 and `Number(false)`
 * is 0, and none of those is anybody having counted nothing — which is the
 * whole house rule, and which the test for `placesFree` caught this function
 * failing before it existed: a class of twelve with a null booked count read as
 * twelve places free, so an unread count advertised a class as wide open.
 *
 * Deliberately narrower than `queueLength` in src/lib/reschedule.ts on one
 * point and identical on every other: this one accepts a negative so the caller
 * can decide what a negative means about ITS OWN field — a capacity of -3 is a
 * class nobody sized and a booked count of -3 is a figure to clamp — where a
 * queue length has no such reading and refuses it outright.
 */
function count(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.floor(v) : null;
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

/**
 * Whether this class is full, as three answers rather than two.
 *
 * Null is "we cannot tell", and it is the answer for every case `placesFree`
 * returns null for. A screen that asked a boolean would draw "Class full" over
 * an unsized class and "Join Waitlist" on a button that would book a seat —
 * which is the shape `classFillState(0, 0) === 'full'` produces when it is
 * handed a class it was never meant to be asked about.
 */
export function isFull(capacity: unknown, booked: unknown, known: boolean): boolean | null {
  const left = placesFree(capacity, booked, known);
  return left == null ? null : left === 0;
}
