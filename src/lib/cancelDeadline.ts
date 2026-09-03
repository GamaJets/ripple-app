// The last moment this booking can be changed for nothing, said before the
// member decides rather than after.
//
// ── Where the fact lives now ───────────────────────────────────────────────
//
// src/lib/booking.ts holds four separate facts about a coach's cancellation
// policy — whether it applies, how much notice it wants, what it costs, and
// what money that is in — and `cancelWarningLine` turns them into a sentence
// that is true and complete:
//
//     "This is inside 24 hours, so your coach's late-cancellation fee of £25
//      applies. Repple doesn't take this payment — it's recorded for you and
//      your coach to settle."
//
// There are exactly three places that sentence is printed, and all three are
// inside an `Alert.alert` raised by the Cancel button: app/(client)/bookings.tsx,
// app/(client)/standing.tsx and app/(client)/calendar.tsx. The member reads the
// notice period at the one moment it can no longer help them — they have
// already decided, already tapped, and the only question left is whether to
// tap again.
//
// Nowhere on any booking screen does it say, of a session sitting quietly in a
// list, when the free window closes. A member with a Tuesday 07:00 has no way
// to learn that Monday 07:00 is the hinge except by pressing the destructive
// button and reading the confirmation.
//
// ── And the refusal that is not announced at all ──────────────────────────
//
// `canOfferMove` in src/lib/reschedule.ts returns false inside the window, and
// app/(client)/bookings.tsx simply does not render the Move control when it
// does. There is no line, no disabled state and no explanation: the button was
// there yesterday and today it is gone. The house rule is that a refusal is
// announced rather than only coloured, and a control that silently vanishes is
// the same failure with the colour removed too.
//
// So the 'closed' branch here says the two things the missing button was
// supposed to: moving is no longer offered, and this is why.
//
// ── One narrator, two moments ─────────────────────────────────────────────
//
// This does not replace `cancelWarningLine` and must not drift from it. A
// confirmation restates what it is confirming — that is what a confirmation is
// for — so the sentence at the moment of cancelling stays exactly as it is.
// What this adds is a different sentence at a different moment, and both are
// derived from the SAME `lateCancelFee` verdict and the SAME `noticeHoursOf`
// window, so the row and the alert cannot come to disagree about a member's
// money. The two are deliberately worded differently: this one is a deadline,
// that one is a consequence.
//
// ── The notice period when nobody has said ────────────────────────────────
//
// `noticeHoursOf` falls back to 24 for an unread policy, and `canOfferMove` is
// deliberately permissive on the same grounds. That fallback is right and this
// uses it — but it is an ASSUMPTION about somebody else's terms, and a member
// planning their week around it deserves to know which of the two they are
// reading. A stated policy and an assumed one get different sentences here for
// that reason, as does a coach for whom no policy is recorded at all.
import type { LoadStatus } from '../ui/loadStatus';
import {
  feeAmountLine, insideNoticeWindow, lateCancelFee,
  noticeHoursOf, noticeLabel, unstatedCurrency, type CancellationPolicy,
} from './booking';

const HOUR = 3_600_000;

/**
 * The instant the free window closes, as an ISO string — or null when the
 * session's own start will not parse.
 *
 * Computed from the SAME `noticeHoursOf` the window test uses, so the moment
 * named here is the moment `insideNoticeWindow` starts returning true. A
 * separate subtraction would be a second definition of the deadline, and the
 * two would eventually be an hour apart in front of somebody who had planned
 * around the wrong one.
 */
export function freeUntil(
  startsAt: string,
  policy: CancellationPolicy | null | undefined,
): string | null {
  const start = Date.parse(startsAt);
  if (!Number.isFinite(start)) return null;
  return new Date(start - noticeHoursOf(policy) * HOUR).toISOString();
}

export interface CancelDeadlineInput {
  /** When the session starts. */
  startsAt: string;
  /** The coach's policy, or null. Null under 'ready' is a member with no coach
   *  on record, which is not a policy of "no fee". */
  policy: CancellationPolicy | null | undefined;
  /** The status of the policy read. */
  policyStatus: LoadStatus;
  /** Now, in milliseconds. From `useNow()` — a bookings list is a screen people
   *  leave open, and a deadline that stopped moving is worse than none. */
  now: number;
  /**
   * The deadline, formatted by the caller in the member's own locale and
   * timezone — "Mon 7:00 am". Null when it could not be formatted.
   *
   * Passed in rather than formatted here for the reason every prose module in
   * this codebase passes its dates in: a bare `getDate()/getMonth()` is "9/12",
   * which is 9 December in London and 12 September in New York, and there is no
   * locale in a pure module. See scripts/check-hand-dates.mjs.
   */
  when: string | null;
}

export type CancelDeadline =
  /** Nothing to say: the session has started or gone, or its start will not
   *  parse. The row is history and the screen says so. */
  | { kind: 'silent' }
  /** The window is still open. */
  | { kind: 'open'; note: string; deadlineAt: string | null; hoursLeft: number | null; closingSoon: boolean }
  /** The window has closed. Moving is no longer offered and cancelling has a
   *  consequence. */
  | { kind: 'closed'; note: string };

/**
 * How close to the deadline is close enough to mark.
 *
 * Six hours. Not a judgement about anybody's week — it is the span in which a
 * member who has not decided yet still can, and inside which "tomorrow" stops
 * being a safe assumption. The caller decides what marking means; nothing here
 * returns a colour.
 */
export const CLOSING_SOON_HOURS = 6;

export function cancelDeadline(i: CancelDeadlineInput): CancelDeadline {
  const start = Date.parse(i.startsAt);
  if (!Number.isFinite(start)) return { kind: 'silent' };
  // A session that has begun is not a booking anybody is planning around. The
  // window test has no lower bound by design — see `insideNoticeWindow` — so
  // without this a session from last March would carry a deadline sentence.
  if (start <= i.now) return { kind: 'silent' };
  // A claim about somebody's money is not made from a read still in flight.
  if (i.policyStatus === 'loading') return { kind: 'silent' };

  // Three ways to have no policy in hand, and they are three different
  // sentences. `stated` is the only one entitled to name the coach's terms.
  const stated = i.policyStatus !== 'error' && !!i.policy;
  const unreadable = i.policyStatus === 'error';

  const hours = noticeHoursOf(i.policy);
  const w = noticeLabel(hours);
  const inside = insideNoticeWindow(i.startsAt, hours, i.now);
  // A coach who does not charge has no window to be inside. Same rule as
  // `canOfferMove`, deliberately: this line and that button must never
  // disagree about whether a member may still move a session.
  const noPolicy = stated && i.policy?.applies === false;

  if (!inside || noPolicy) {
    const deadlineAt = freeUntil(i.startsAt, i.policy);
    const hoursLeft = deadlineAt != null ? (Date.parse(deadlineAt) - i.now) / HOUR : null;
    const closingSoon = !noPolicy && hoursLeft != null && hoursLeft <= CLOSING_SOON_HOURS;
    if (noPolicy) {
      return {
        kind: 'open',
        // No deadline is named, because there is not one. Naming a time here
        // would invent a cliff edge on a booking that has none.
        note: 'You can cancel or move this at any time — your coach doesn’t charge for a late cancellation.',
        deadlineAt: null,
        hoursLeft: null,
        closingSoon: false,
      };
    }
    // The verdict for cancelling AFTER the deadline, which is what the second
    // half of each sentence is about. Asked with `inside: true` because that is
    // the state being described, not the state we are in.
    const after = lateCancelFee(stated ? i.policy : null, true);
    // The formatted time when the caller could produce one, and the window
    // itself when it could not. Never a hand-built date: "9/12" is 9 December
    // in London and 12 September in New York (scripts/check-hand-dates.mjs).
    const until = i.when ? `until ${i.when}` : `until ${w} before it starts`;
    let tail: string;
    if (!stated && unreadable) {
      tail = `Your coach’s own policy could not be read, so that window is the ${w} this app assumes rather than one they have set.`;
    } else if (!stated) {
      tail = `No cancellation policy is recorded for your coach, so that window is the ${w} this app assumes rather than one they have set.`;
    } else if (after.kind === 'fee') {
      tail = `After that, cancelling records their late-cancellation fee of ${feeAmountLine(after.amount, after.currency)} and moving is no longer offered.${unstatedCurrency(after.currency)}`;
    } else {
      tail = `After that, their late-cancellation policy applies and moving is no longer offered. They haven’t set an amount, so ask them what it is.`;
    }
    return {
      kind: 'open',
      note: `Free to cancel or move ${until}. ${tail}`,
      deadlineAt,
      hoursLeft,
      closingSoon,
    };
  }

  // ── inside the window ──────────────────────────────────────────────────
  //
  // Every branch names the vanished Move control. That is the whole reason
  // this half exists: the button is gone, nothing said why, and "the app is
  // broken" is the reading a member is left with.
  const v = lateCancelFee(stated ? i.policy : null, true);
  const gone = 'Moving it is no longer offered.';
  if (!stated) {
    const why = unreadable
      ? 'Your coach’s cancellation policy could not be read, so whether cancelling costs anything is not known here — check with them.'
      : 'No cancellation policy is recorded for your coach, so whether cancelling costs anything is not known here — check with them.';
    return { kind: 'closed', note: `This is inside the ${w} this app assumes. ${gone} ${why}` };
  }
  if (v.kind === 'fee') {
    return {
      kind: 'closed',
      note: `This is inside your coach’s ${w} notice. ${gone} Cancelling now records their late-cancellation fee of ${feeAmountLine(v.amount, v.currency)} — Repple doesn’t take that payment, it is for the two of you to settle.${unstatedCurrency(v.currency)}`,
    };
  }
  return {
    kind: 'closed',
    note: `This is inside your coach’s ${w} notice. ${gone} Cancelling now falls under their late-cancellation policy; they haven’t set an amount, so ask them what it is.`,
  };
}
