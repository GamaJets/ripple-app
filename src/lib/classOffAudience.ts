// Who is told a class was called off, once a cancellation stops being a DELETE.
//
// ── The defect ────────────────────────────────────────────────────────────
//
// `tellTheCancelledRoom` in src/lib/classOff.ts read `id, user_id, class_id`
// off `class_bookings` with NO status filter and messaged everybody who had a
// row. That was correct for exactly as long as cancelling deleted the row:
// having a row and holding a place were the same fact, so "everybody with a
// row" and "everybody still coming" were the same set.
//
// supabase/parts/3180 ends that. The row survives a cancellation with
// `status = 'cancelled' | 'late_cancelled'`, and part 3180 §8 names this file:
//
//     src/lib/classOff.ts has the same shape as `class_cancelled_notify`: it
//     selects `id, user_id, class_id` with no status filter and messages
//     everybody who has a row when a class is called off.
//
// So a member who cancelled a class three weeks ago is pushed "A class you
// booked is not running … your booking is kept on the record" — about a
// commitment they had already withdrawn from, and about a class they had
// stopped thinking about. It is also a number the coach acts on: the
// confirmation says "12 people had booked or were waiting" when four of the
// twelve pulled out weeks ago, so a coach deciding whether to go and tell the
// room in person is deciding on a roster that is half history.
//
// ── The three relationships to the news ───────────────────────────────────
//
// A called-off class does not mean the same thing to everybody with a row, and
// the live `class_cancelled_notify` (part 3180) already says so in SQL — two
// different sentences off one insert, and `status in ('booked','waitlist')` in
// its where clause. This module is that same split on the push side, so the
// banner from the handset and the inbox row from the trigger cannot come to
// disagree about who the news is for:
//
//   · a SEAT HOLDER has lost something they had. They were going, and if
//     nobody tells them they travel to a locked room. This is the whole reason
//     the push exists.
//   · a WAITLISTER has lost the chance of something. Nothing of theirs is
//     cancelled — there is nothing for them to give up — but they are still
//     waiting on a promotion that is never coming, and a queue for a class
//     that will not run is worth closing. They are told, in their own words.
//   · somebody who CANCELLED has lost nothing, because they gave it up
//     themselves. They are not told, and they are not counted.
//
// ── The word this build cannot read, and why it is told ───────────────────
//
// `seatStanding` answers 'unknown' for a status word no part of this build has
// ever heard of — a fifth value added to the CHECK constraint by a later part.
// `holdsPlace('unknown')` is FALSE and must stay false: a count must not count
// it and a button must not be armed against it (src/lib/classSeat.ts).
//
// The who-to-message decision is NOT that decision and comes out the other
// way. It is asked of a different question:
//
//   · treat 'unknown' as not-told, and a member who may well be holding a seat
//     hears nothing and turns up to a locked room — AND the coach's own
//     confirmation undercounts the room, so nobody goes and tells them either.
//     The silence compounds.
//   · treat 'unknown' as told, and somebody who may have withdrawn under a
//     word we cannot read gets one notification about a class that is genuinely
//     not running. Every clause they read is true of them whatever the word
//     turns out to mean: the class IS off, their row IS kept, and there IS
//     nothing for them to do.
//
// One of those risks a wasted journey and an undercounted roster; the other
// risks a superfluous banner. The first is the harm this function exists to
// prevent and the second is one it can survive, so an unreadable standing is
// TOLD, with the seat holders, and counted separately so the decision is
// visible to a reader and to a test rather than buried in a default.
//
// This is deliberately not `holdsPlace` with a different name. The two
// questions have different costs of being wrong, they are allowed to disagree,
// and `unreadable` is the field that records that they did.
//
// Framework-free like the rest of src/lib, so it runs under plain `node` and
// imports into studio-web's Next.js build as well as the handset's.
import { seatStanding, type SeatStanding } from './classSeat';
import { clip, NOTICE_BODY_MAX, CLASS_OFF_ROUTE, type RoutedNotification } from './notifyCopy';
import { num } from './format';

/** One `class_bookings` row, as much of it as this decision needs. `status` is
 *  `unknown` rather than a string union on purpose: it arrives off a network
 *  read and the whole point of `seatStanding` is that it may be anything. */
export interface ClassOffRow {
  userId: string;
  classId: string;
  status: unknown;
}

export interface ClassOffAudience {
  /**
   * Told in the seat holder's words. `status = 'booked'`, plus every row whose
   * status word this build cannot read — see the header for why those two go
   * in one envelope rather than in none.
   */
  seated: ClassOffRow[];
  /** Told in the waiting list's words. `status = 'waitlist'`. */
  queued: ClassOffRow[];
  /** Not told at all: they cancelled this themselves. */
  dropped: ClassOffRow[];
  /**
   * How many of `seated` are there because their standing could not be read,
   * not because they hold a seat.
   *
   * A count and not a flag, and never folded into `seated.length` by a caller
   * that wants "how many seats went": it is the number a later reader needs to
   * see that this build met a word it did not know, and the number a test
   * pins the decision on.
   */
  unreadable: number;
}

/**
 * Split the roster of a called-off class into who hears what.
 *
 * Rows with no user id or no class id are discarded before anything else: they
 * cannot be messaged and they cannot be counted, and letting a blank id through
 * would put an empty string in a push recipient list.
 */
export function classOffAudience(rows: readonly ClassOffRow[] | null | undefined): ClassOffAudience {
  const seated: ClassOffRow[] = [];
  const queued: ClassOffRow[] = [];
  const dropped: ClassOffRow[] = [];
  let unreadable = 0;
  for (const r of rows ?? []) {
    const userId = String(r?.userId ?? '').trim();
    const classId = String(r?.classId ?? '').trim();
    if (!userId || !classId) continue;
    const row: ClassOffRow = { userId, classId, status: r?.status };
    const standing: SeatStanding = seatStanding(r?.status);
    switch (standing) {
      case 'held':
        seated.push(row);
        break;
      case 'queued':
        queued.push(row);
        break;
      case 'cancelled':
      case 'late_cancelled':
        dropped.push(row);
        break;
      case 'unknown':
        unreadable++;
        seated.push(row);
        break;
      case 'none':
        // A row that came back from `class_bookings` with a null or blank
        // status. The column is `not null default 'booked'`, so this is not a
        // standing — it is a read this module cannot interpret, which is the
        // same fact as 'unknown' and gets the same answer for the same reason.
        unreadable++;
        seated.push(row);
        break;
    }
  }
  return { seated, queued, dropped, unreadable };
}

/**
 * What somebody on the WAITING LIST is told, given how many of their own
 * waiting-list places went.
 *
 * ── Why this sentence is not `classOffNotification` ───────────────────────
 *
 * That one ends "Your booking is kept on the record and there is nothing for
 * you to do". A waitlister has no booking to keep: they have a place in a
 * queue, which is a different thing to lose and a different thing to be told
 * about. The live `class_cancelled_notify` trigger draws exactly this
 * distinction for the inbox row it writes —
 *
 *     'You were on the waiting list for it, so there is nothing to cancel.'
 *
 * — and the clause below is that sentence, so the banner this app pushes and
 * the row the database writes say the same thing to the same person.
 *
 * `classes` is that member's own count and never the size of the cancellation,
 * for the reason `classOffNotification` states: a body claiming nine when they
 * were waiting on two is a number about somebody else's diary.
 *
 * No clock time and no date, the same rule the rest of this copy keeps:
 * `gym_classes` carries no zone, so "Thursday at 7pm" is right for whoever the
 * server agrees with and wrong for everybody else.
 */
export const CLASS_OFF_WAITING_TITLE = 'A class you were waiting for is not running';
export const CLASS_OFF_WAITING_TITLE_MANY = 'Classes you were waiting for are not running';

export function classOffWaitingNotification(
  classTitle: string | null | undefined,
  classes: number,
  reason: string | null | undefined,
): RoutedNotification {
  const name = (classTitle ?? '').trim() || 'A class';
  const said = (reason ?? '').trim();
  const why = said ? `: ${said}` : '';
  const many = Number.isFinite(classes) && classes > 1;
  return {
    title: many ? CLASS_OFF_WAITING_TITLE_MANY : CLASS_OFF_WAITING_TITLE,
    body: clip(
      many
        ? `${num(Math.floor(classes))} of the “${name}” classes you were waiting for have been called off${why}. You were on the waiting list, so there is nothing to cancel — your Classes screen has the rest of the timetable.`
        : `“${name}” has been called off${why}. You were on the waiting list for it, so there is nothing to cancel — your Classes screen has the rest of the timetable.`,
      NOTICE_BODY_MAX,
    ),
    route: CLASS_OFF_ROUTE,
  };
}
