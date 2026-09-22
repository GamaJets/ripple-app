// Whether a booking is still ahead of the member, and the hour of grace either
// side of the answer.
//
// ── the grace, and why it is not nought ───────────────────────────────────
//
// A session that started ten minutes ago has not stopped being the member's
// next appointment. They are walking to it. Dropping it off "Upcoming" the
// instant the clock passes its start time takes the location, the coach's name
// and the Cancel button away from somebody who is standing outside the building
// looking for exactly those. So the line is drawn an hour BEHIND the start, and
// the hour is a deliberate approximation of "the session you are at".
//
// That constant was written out four times — three in app/(client)/bookings.tsx
// and once in app/(client)/calendar.tsx — plus twice more in src/ui/classes.tsx
// as a read bound. Four copies of a number is four chances to change three of
// them.
//
// ── the defect that made this a module rather than a constant ─────────────
//
// The three copies in bookings.tsx were inside `useMemo`, and the instant they
// compared against was `Date.now()` evaluated in the memo body:
//
//     }, [classes, myStatus, sessions, coachName, cd.id]);
//
// There is no clock in that dependency list, so the memo does not re-run when
// time passes — and `app/(client)/_layout.tsx` registers My Bookings with
// `href: null`, which mounts it once and never tears it down. The comparison is
// therefore frozen at the moment the screen was first opened, for as long as
// the app lives.
//
// What that costs the member, in the two directions it goes:
//
//   · MY BOOKINGS OVER-INCLUDES. A class that finished six hours ago is still
//     listed under "Upcoming", with a live Cancel button on it. Cancelling a
//     class you have already attended is not a no-op — src/lib/classCancel.ts
//     says in as many words that the gym decides whether a late cancellation is
//     charged, and this app cannot see that policy. So the frozen clock offers
//     the member a button that may cost them money for a session they took.
//
//   · THE PACK DEADLINE OVER-COUNTS. The same frozen instant filters the
//     bookings fed to `packDeadline`, so sessions that have since been used are
//     still counted as "booked before the pack expires". The line under it
//     tells the member their remaining sessions are covered when they are not
//     — a claim about credits they paid for.
//
//   · PT SESSIONS UNDER-INCLUDES, which is the worse direction. The `mine` memo
//     on app/(client)/pt-sessions.tsx keeps sessions whose start is at or
//     BEFORE the frozen instant, and those are the ones that appear under
//     "Awaiting Your Approval". A session that has happened since the screen was
//     opened is not in that list at all, so the member cannot see what their
//     coach recorded and cannot dispute it. Their silence is then read as
//     approval.
//
// `scripts/check-frozen-day.mjs` cannot see any of this: it looks for a `new
// Date()` or `todayKey()` under an EMPTY dependency array, and these lists are
// full. `src/ui/today.ts` describes the same second half of the defect —
// "correct on every redraw, and nothing here redraws".
//
// ── the shape of the answer ───────────────────────────────────────────────
//
// The instant comes in as an argument. A screen passes `useNow()` (src/ui/today.ts),
// which moves at the next local midnight and whenever the app returns to the
// foreground — the two moments a pocketed phone can have skipped hours — and
// which, being state, puts itself in the dependency list where a reviewer can
// see it.
//
// Pure, so the boundary can be asserted without mounting anything.

/**
 * How long after a session begins it is still shown as the one coming up.
 *
 * An hour. Long enough to cover being late, changing, and a class that started
 * while the member was on the tube; short enough that yesterday's evening class
 * is never on tomorrow's list.
 */
export const UPCOMING_GRACE_MS = 3_600_000;

/** The instant at or after which a session still counts as ahead of you. */
export function upcomingFrom(now: number): number {
  return now - UPCOMING_GRACE_MS;
}

/**
 * Whether this booking is still ahead of the member.
 *
 * False for a timestamp that cannot be read, which is the answer that keeps a
 * row off "Upcoming" rather than pinning an undated one to the top of it: `NaN
 * > x` is false, and this states that rather than relying on it.
 */
export function isUpcoming(startsAt: string | null | undefined, now: number): boolean {
  const t = Date.parse(String(startsAt ?? ''));
  if (Number.isNaN(t)) return false;
  return t > upcomingFrom(now);
}

/**
 * Whether this booking's time has come and gone — the set of sessions a member
 * can be asked to approve or dispute.
 *
 * NOT `!isUpcoming`. The grace hour belongs to "upcoming" and must not also
 * belong to "already happened", or a session that started five minutes ago
 * would appear in both lists at once. This asks the plain question — has the
 * start time passed — with no grace on it, so the two lists meet at the start
 * time and the hour of overlap is deliberate and one-directional: a session
 * inside the grace is upcoming AND has started, which is exactly what a member
 * walking into it would say about it.
 *
 * False for an unreadable timestamp, for the same reason as above: a session we
 * cannot place in time is not evidence that anything has happened.
 */
export function hasStarted(startsAt: string | null | undefined, now: number): boolean {
  const t = Date.parse(String(startsAt ?? ''));
  if (Number.isNaN(t)) return false;
  return t <= now;
}
