"use strict";
// Moving a session instead of losing it, and taking a fortnight off.
//
// A repo-wide grep for `reschedul` used to hit one test fixture. Moving a
// session meant cancelling it and booking again, and those are two acts with a
// gap in the middle: the slot is `available` between the taps, part 126's
// waitlist promotion is instantaneous, and a member freeing 07:00 to take 18:00
// could lose the 07:00 to somebody waiting and then find 18:00 taken as well.
// They asked to move one session and now have none. The cancellation could also
// cost a late fee and the re-booking drew a second pack credit for a session
// they had already paid for.
//
// The database half is supabase/parts/243 (the move) and 244 (the pause). This
// file is the vocabulary and every sentence either of them produces, so all of
// it is assertable under `npm test` with no device and no network.
//
// ── The one decision worth reading before the code ───────────────────────
//
// A MOVE NEVER CHARGES, and a move made inside the coach's notice window is
// REFUSED rather than priced. Three alternatives were rejected, and the reasons
// are in the header of supabase/parts/243 in full. The short version:
//
//   · moving freely inside the window deletes the coach's policy — move the
//     session three weeks out, then cancel that one for nothing;
//   · charging for it as a cancellation puts a false word in a record both
//     people read;
//   · charging under a new `charges.reason` writes a fee NEITHER of them can
//     see, because both screens that read that table filter on the literal
//     string 'late_cancellation'.
//
// So the notice window is a gate, not a price. Outside it — which is the whole
// of the complaint — the move is free, atomic and costs no credit. Inside it,
// the member is told the notice period and sent to the path that already exists
// and is already priced honestly: cancel, and book again.
//
// A PAUSE, by contrast, DOES cost whatever cancelling those sessions costs,
// because removing a booked occurrence is a cancellation whatever screen it was
// tapped on. `pause_my_session_series` does not price it itself; it calls
// `cancel_my_session` per occurrence, so there is one answer to "what does this
// cost" in the whole product.
Object.defineProperty(exports, "__esModule", { value: true });
exports.COACH_NOT_MOVED = exports.NOT_MOVED = void 0;
exports.canOfferMove = canOfferMove;
exports.rescheduleRefusalLine = rescheduleRefusalLine;
exports.rescheduleLines = rescheduleLines;
exports.moveConfirm = moveConfirm;
exports.noSlotsLine = noSlotsLine;
exports.pausePreviewLine = pausePreviewLine;
exports.pauseOutcomeLines = pauseOutcomeLines;
exports.pausedRangeLine = pausedRangeLine;
exports.resumeConfirm = resumeConfirm;
exports.resumedLine = resumedLine;
exports.coachMoveRefusalLine = coachMoveRefusalLine;
exports.coachMovedLine = coachMovedLine;
const booking_1 = require("./booking");
/** Nothing happened, and we could not find out why. The shape a caller returns
 *  when the RPC did not answer at all. */
exports.NOT_MOVED = {
    moved: false, reason: 'unreachable', noticeHours: null, fee: null,
    currency: null, promoted: false, waiting: 0,
};
/**
 * Whether to offer Move at all, from what this device knows.
 *
 * Deliberately permissive on an unread policy. `noticeHoursOf` falls back to
 * the 24 hours the app has always warned about, and a member whose policy read
 * failed is still offered the control — the server decides, and being told "no,
 * and here is the notice period" is a better outcome than a button that was
 * never there. What must not happen is the reverse: offering it silently and
 * then reporting a bare failure.
 */
function canOfferMove(startsAt, policy, now = Date.now()) {
    // A coach with no policy has no window to be inside, which is the same
    // default part 126 chose for the fee. Their clients may move at any notice.
    if (policy && !policy.applies)
        return true;
    return !(0, booking_1.insideNoticeWindow)(startsAt, (0, booking_1.noticeHoursOf)(policy), now);
}
/**
 * What to say when the move did not happen.
 *
 * Every branch ends with the state of the world, because a refusal is
 * indistinguishable from a failure unless somebody says so: "your session has
 * not moved and is still booked" is the half the member acts on.
 *
 * `at` is the time of the session they tried to move, already formatted by the
 * caller, or null when there is none to quote — never a dash inside the
 * sentence (scripts/check-prose.mjs).
 */
function rescheduleRefusalLine(r, at) {
    const still = at
        ? `Your ${at} session has not moved and is still booked.`
        : 'That session has not moved and is still booked.';
    switch (r.reason) {
        case 'inside_notice': {
            const hours = r.noticeHours ?? 24;
            // `unstatedCurrency` is appended for the same reason it is appended to
            // the other two priced sentences in this file and to `cancelWarningLine`
            // in booking.ts: "A slot may print the figure alone; a sentence may not."
            // This one was the sentence that did — a member of a gym with no currency
            // set read "would cost 25" immediately before deciding whether to cancel
            // and rebook, and priced it in whatever money they happen to think in.
            const cost = r.fee != null && r.fee > 0
                ? ` Cancelling it now would cost ${(0, booking_1.feeAmountLine)(r.fee, r.currency)}.${(0, booking_1.unstatedCurrency)(r.currency)}`
                : '';
            return `Your coach asks for ${hours} ${hours === 1 ? 'hour' : 'hours'} of notice, and this session is inside that, so it cannot be moved free of charge. `
                + `${still} To change it now, cancel it and book another time.${cost}`;
        }
        case 'taken':
            return `Somebody took that slot first. ${still} Pick another time.`;
        case 'clash':
            return `You are already booked with this coach across that hour. ${still} Pick another time.`;
        case 'already_started':
            return `That slot has already started, so nothing can be moved into it. ${still}`;
        case 'other_coach':
            return `That slot belongs to a different coach, and a session cannot be moved between coaches. ${still}`;
        case 'same_slot':
            return `That is the session you are moving. ${still}`;
        case 'not_yours':
            return `That session is no longer booked to you, so there was nothing to move. Open your bookings again to see where it stands.`;
        default:
            // 'unreachable', and anything a later server learns to say that this
            // build has never heard of. The only branch that cannot promise the
            // session is still booked, because it does not know.
            return 'That did not reach the server, so we cannot say whether anything moved. Check your bookings before you rely on it.';
    }
}
/**
 * What to say when it did.
 *
 * Returned as lines so a caller can join them however its alert wants. The
 * money sentence is not optional and is not conditional: a member who has just
 * moved a session is thinking about what it cost them, and "nothing" is a thing
 * to say out loud rather than to leave them to infer from silence.
 */
function rescheduleLines(r, from, to) {
    const lines = [`Moved from ${from} to ${to}.`];
    lines.push('Nothing was charged and no session was taken off your pack. It is the same session at a different time.');
    lines.push(r.promoted
        ? 'Somebody was waiting for your old slot and it has gone straight to them.'
        : 'Your old time is back on your coach’s calendar.');
    return lines;
}
/** The confirm in front of the move. Says what it does and, in the same breath,
 *  what it does not do to the money. */
function moveConfirm(from, to) {
    return {
        title: 'Move this session?',
        body: `${from} becomes ${to}, with the same coach.\n\n`
            + 'Nothing is charged, and no session comes off your pack. Your old time goes back on your coach’s calendar, '
            + 'or straight to whoever is first in line for it.',
    };
}
/** The empty state of the slot picker. Not "your coach has nothing free" unless
 *  the read that produced it actually finished. */
function noSlotsLine(status) {
    switch (status) {
        case 'loading': return 'Looking for other times…';
        case 'error': return 'We could not read your coach’s open times, so we cannot say whether there are any. Your session is unchanged.';
        case 'partial': return 'There are more open times than we can read at once, so this is not all of them.';
        default: return 'Your coach has no other open times at the moment. Message them to arrange one.';
    }
}
/**
 * What a pause is about to do, before it is taken.
 *
 * Counted from the member's OWN calendar, so it is honest about being a
 * preview: `upcoming` is how many of their occurrences this device can see in
 * the range, and `late` how many of those are inside the notice window. The
 * server counts again and the report afterwards is the authority.
 */
function pausePreviewLine(upcoming, late, policy, 
/**
 * Whether the calendar this count came out of was read WHOLE.
 *
 * `isWhole(sessionsStatus)` at the call site. Defaults to true so every
 * existing caller and every existing assertion keeps its meaning; the false
 * branch is the one that was missing.
 *
 * Two of the sentences below are money claims sitting immediately above a
 * destructive confirm — "we do not expect anything to be cancelled" and "All
 * of them are outside your coach's notice period, so this costs nothing" —
 * and both are produced by a SHORT count as readily as by a true one. A
 * refused read of `sessions` leaves the list empty and a PostgREST read cut
 * off at its row cap leaves it short, and neither is a fact about what the
 * member has booked. Under either, `upcoming` and `late` are floors, so the
 * only honest thing this can say is that it does not know and the server
 * will.
 */
countable = true) {
    if (!countable) {
        // Deliberately says nothing about a fee, in either direction. "This costs
        // nothing" and "this will cost you" are both claims, and a floor supports
        // neither.
        return 'We could not read your own calendar fully just now, so we cannot tell you how many sessions fall in those dates or whether any would carry a late fee. Your coach’s calendar is the authority and is checked when you confirm — the account you get afterwards is the true one.';
    }
    if (upcoming === 0)
        return 'Nothing of this arrangement is booked in those dates, so we do not expect anything to be cancelled. Your coach’s calendar is the authority and is checked when you confirm.';
    // "will be cancelled" was stated as fact over a set counted on this device.
    // The device cannot see the series a booking belongs to — `TrainingSession`
    // carries no series id — so `seriesOccurrencesIn` matches on the slot instead
    // and this sentence says what kind of answer that is. The server counts
    // again and `pauseOutcomeLines` is the account that is true.
    const head = upcoming === 1
        ? 'One session of this arrangement is booked in those dates, and we expect it to be cancelled.'
        : `${upcoming} sessions of this arrangement are booked in those dates, and we expect them to be cancelled.`;
    if (!policy) {
        return `${head} We could not read your coach’s cancellation policy, so we cannot say whether any of them would cost a fee.`;
    }
    if (!policy.applies)
        return `${head} Your coach does not charge for late cancellations, so this costs nothing.`;
    if (late === 0)
        return `${head} All of them are outside your coach’s notice period, so this costs nothing.`;
    // A sentence that names a figure has to name its currency, or say it cannot.
    // src/lib/booking.ts: "A slot may print the figure alone; a sentence may not."
    // This is a sentence, and it sits immediately above a confirm button.
    const priced = policy.fee != null && policy.fee > 0;
    const each = priced ? ` of ${(0, booking_1.feeAmountLine)(policy.fee, policy.currency)}` : '';
    const ccy = priced ? (0, booking_1.unstatedCurrency)(policy.currency) : '';
    return late === 1
        ? `${head} One of them is inside your coach’s notice period and would carry their late fee${each}.${ccy}`
        : `${head} ${late} of them are inside your coach’s notice period and would each carry their late fee${each}.${ccy}`;
}
/** What a pause actually did. Same rule as everywhere else in this codebase:
 *  two amounts in two currencies are never added, and a total that cannot be
 *  stated is withheld rather than guessed. */
function pauseOutcomeLines(r) {
    const lines = [];
    lines.push(r.freed === 0
        ? 'Those dates are paused. Nothing was booked in them, so nothing was cancelled.'
        : r.freed === 1
            ? 'Those dates are paused and the one session booked in them has been cancelled.'
            : `Those dates are paused and the ${r.freed} sessions booked in them have been cancelled.`);
    if (r.charged === 0) {
        lines.push('Nothing was charged.');
    }
    else if (r.mixedCurrencies || r.fees == null) {
        // Deliberately no total. See src/lib/coachMoney.ts on why amounts in
        // different currencies are never summed.
        lines.push(`${r.charged} of them were inside your coach’s notice period and carried a late fee. They are not in the same currency, so they are not added up here. Your fees are listed on your bookings screen.`);
    }
    else {
        lines.push(`${r.charged === 1 ? 'One of them was' : `${r.charged} of them were`} inside your coach’s notice period, so your coach’s late fee was recorded: ${(0, booking_1.feeAmountLine)(r.fees, r.currency)} in total.${(0, booking_1.unstatedCurrency)(r.currency)}`);
    }
    if (r.notFreed > 0) {
        lines.push(`${r.notFreed} could not be cancelled, which usually means somebody already cancelled ${r.notFreed === 1 ? 'it' : 'them'} somewhere else. Check your calendar for those dates.`);
    }
    lines.push('Your standing appointment itself is not ended. It starts again by itself after the last paused date.');
    return lines;
}
/** How a pause reads back on the list. `from` and `to` are already formatted. */
function pausedRangeLine(from, to, reason) {
    const head = from === to ? `Paused on ${from}` : `Paused from ${from} to ${to}`;
    return reason ? `${head} (${reason}).` : `${head}.`;
}
/** Lifting one. Says what does and does not come back, because the thing people
 *  expect is the thing that cannot happen: a week that has already passed. */
function resumeConfirm(from, to) {
    return {
        title: 'Start this up again?',
        body: `Your standing appointment resumes and the sessions between ${from} and ${to} that are still to come are booked back in.\n\n`
            + 'Dates that have already passed do not come back.',
    };
}
function resumedLine(created) {
    if (created === 0) {
        return 'That pause is lifted. There was nothing still to come inside it, so no sessions were booked back in. Your usual time carries on as normal.';
    }
    return created === 1
        ? 'That pause is lifted and one session has been booked back in.'
        : `That pause is lifted and ${created} sessions have been booked back in.`;
}
exports.COACH_NOT_MOVED = {
    moved: false, reason: 'unreachable', clientId: null, promoted: false, waiting: 0,
};
/**
 * What to say when a coach's move did not happen.
 *
 * Every branch ends with the state of the world, because a refusal is
 * indistinguishable from a failure unless somebody says so — and the one thing
 * a coach must not walk away believing is that a client's hour has changed when
 * it has not. `who` and `at` are the client and the old time in the coach's own
 * words; both may be absent and neither is required for the sentence to be
 * true.
 */
function coachMoveRefusalLine(r, who, at) {
    const subject = who && at ? `${who}'s ${at} session` : who ? `${who}'s session` : at ? `The ${at} session` : 'That session';
    const still = `${subject} has not moved and is still booked as it was.`;
    switch (r.reason) {
        case 'taken':
            return `That slot is no longer open — somebody booked it, or it was removed. ${still} Pick another time.`;
        case 'clash':
            return `${who ?? 'That client'} already has a session with you across that hour. ${still} Pick another time.`;
        case 'already_started':
            return `That session has already begun, so there is nothing to move. ${still} Mark what happened instead.`;
        case 'not_yours':
            return `${still} It may have been cancelled or moved from the client's own phone since this screen loaded. Pull down to refresh and look again.`;
        case 'same_slot':
            return `${still} That is the hour it is already in.`;
        case 'unreachable':
        default:
            // The honest one. Nothing here claims the move failed, because nobody
            // knows: the request may have landed and the answer been lost.
            return `The move did not reach the server, so it may or may not have happened. Do not tell ${who ?? 'the client'} anything yet. Pull down to refresh and check where the session is before trying again.`;
    }
}
/**
 * And what to say when it worked.
 *
 * Names the hour that was handed on, because a coach who does not know their
 * old slot went to somebody else will offer it to a second person.
 */
function coachMovedLine(r, who, from, to, toldClient) {
    const head = `${who} moved from ${from} to ${to}.`;
    const told = toldClient
        ? ` ${who} was sent a notification.`
        : ` ${who} could NOT be notified, so tell them yourself — they are expecting ${from}.`;
    const hour = r.promoted
        ? ` ${from} went straight to the next client on its waitlist.`
        : r.waiting > 0
            ? ` ${from} is open again on your calendar.`
            : ` ${from} is open again on your calendar and nobody was waiting for it.`;
    return `${head}${told}${hour}`;
}
