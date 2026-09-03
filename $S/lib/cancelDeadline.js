"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLOSING_SOON_HOURS = void 0;
exports.freeUntil = freeUntil;
exports.cancelDeadline = cancelDeadline;
const booking_1 = require("./booking");
const HOUR = 3600000;
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
function freeUntil(startsAt, policy) {
    const start = Date.parse(startsAt);
    if (!Number.isFinite(start))
        return null;
    return new Date(start - (0, booking_1.noticeHoursOf)(policy) * HOUR).toISOString();
}
/**
 * How close to the deadline is close enough to mark.
 *
 * Six hours. Not a judgement about anybody's week — it is the span in which a
 * member who has not decided yet still can, and inside which "tomorrow" stops
 * being a safe assumption. The caller decides what marking means; nothing here
 * returns a colour.
 */
exports.CLOSING_SOON_HOURS = 6;
function cancelDeadline(i) {
    const start = Date.parse(i.startsAt);
    if (!Number.isFinite(start))
        return { kind: 'silent' };
    // A session that has begun is not a booking anybody is planning around. The
    // window test has no lower bound by design — see `insideNoticeWindow` — so
    // without this a session from last March would carry a deadline sentence.
    if (start <= i.now)
        return { kind: 'silent' };
    // A claim about somebody's money is not made from a read still in flight.
    if (i.policyStatus === 'loading')
        return { kind: 'silent' };
    // Three ways to have no policy in hand, and they are three different
    // sentences. `stated` is the only one entitled to name the coach's terms.
    const stated = i.policyStatus !== 'error' && !!i.policy;
    const unreadable = i.policyStatus === 'error';
    const hours = (0, booking_1.noticeHoursOf)(i.policy);
    const w = (0, booking_1.noticeLabel)(hours);
    const inside = (0, booking_1.insideNoticeWindow)(i.startsAt, hours, i.now);
    // A coach who does not charge has no window to be inside. Same rule as
    // `canOfferMove`, deliberately: this line and that button must never
    // disagree about whether a member may still move a session.
    const noPolicy = stated && i.policy?.applies === false;
    if (!inside || noPolicy) {
        const deadlineAt = freeUntil(i.startsAt, i.policy);
        const hoursLeft = deadlineAt != null ? (Date.parse(deadlineAt) - i.now) / HOUR : null;
        const closingSoon = !noPolicy && hoursLeft != null && hoursLeft <= exports.CLOSING_SOON_HOURS;
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
        const after = (0, booking_1.lateCancelFee)(stated ? i.policy : null, true);
        // The formatted time when the caller could produce one, and the window
        // itself when it could not. Never a hand-built date: "9/12" is 9 December
        // in London and 12 September in New York (scripts/check-hand-dates.mjs).
        const until = i.when ? `until ${i.when}` : `until ${w} before it starts`;
        let tail;
        if (!stated && unreadable) {
            tail = `Your coach’s own policy could not be read, so that window is the ${w} this app assumes rather than one they have set.`;
        }
        else if (!stated) {
            tail = `No cancellation policy is recorded for your coach, so that window is the ${w} this app assumes rather than one they have set.`;
        }
        else if (after.kind === 'fee') {
            tail = `After that, cancelling records their late-cancellation fee of ${(0, booking_1.feeAmountLine)(after.amount, after.currency)} and moving is no longer offered.${(0, booking_1.unstatedCurrency)(after.currency)}`;
        }
        else {
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
    const v = (0, booking_1.lateCancelFee)(stated ? i.policy : null, true);
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
            note: `This is inside your coach’s ${w} notice. ${gone} Cancelling now records their late-cancellation fee of ${(0, booking_1.feeAmountLine)(v.amount, v.currency)} — Repple doesn’t take that payment, it is for the two of you to settle.${(0, booking_1.unstatedCurrency)(v.currency)}`,
        };
    }
    return {
        kind: 'closed',
        note: `This is inside your coach’s ${w} notice. ${gone} Cancelling now falls under their late-cancellation policy; they haven’t set an amount, so ask them what it is.`,
    };
}
