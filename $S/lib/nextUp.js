"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nextUp = nextUp;
exports.nextUpUrgent = nextUpUrgent;
exports.nextUpLine = nextUpLine;
/** What the coach's screen may say about the diary it has already read. */
function nextUp(o) {
    const nothing = { startsAt: null, sessionId: null, after: 0 };
    // Order matters and it is the order of what is KNOWN. A client with no
    // account is not a client whose read failed, and neither is a diary.
    if (o.unasked)
        return { state: 'unasked', ...nothing };
    if (o.loading)
        return { state: 'loading', ...nothing };
    if (o.unread || o.ledger == null)
        return { state: 'unread', ...nothing };
    const rows = o.ledger.upcoming;
    if (rows.length === 0)
        return { state: 'none', ...nothing };
    // The earliest by scan rather than by trusting position 0 — see the header.
    //
    // What is NOT done here is a second opinion about which sessions are ahead.
    // `buildLedger` split `past` from `upcoming` against its own clock and this
    // takes that split as given: two modules with two ideas of when a session
    // stops being upcoming is how one screen comes to say "next Thursday" while
    // the count beside it says none. Keeping that clock current is the caller's
    // job, and app/(trainer)/client.tsx passes it a live one.
    let bestAt = Infinity;
    let best = null;
    for (const r of rows) {
        const at = Date.parse(r.startsAt);
        if (!Number.isFinite(at))
            continue;
        if (at < bestAt) {
            bestAt = at;
            best = { startsAt: r.startsAt, sessionId: r.sessionId };
        }
    }
    if (!best) {
        // Something is booked and nothing here can say when. Reported as a booking,
        // because it is one.
        return { state: 'booked', startsAt: null, sessionId: null, after: Math.max(0, rows.length - 1) };
    }
    return {
        state: 'booked',
        startsAt: best.startsAt,
        sessionId: best.sessionId,
        // Every other booking, readable date or not. A coach counting what is in
        // the diary is owed the rows whose dates failed as much as the ones that
        // did not — dropping them would report a lighter week than they have.
        after: rows.length - 1,
    };
}
/**
 * Whether this deserves a mark rather than a line.
 *
 * ONE case: nothing in the diary and hours already paid for. That is a client
 * who has bought sessions and is not using them, which is the shape of every
 * refund request and most of the quiet leaving in this business — and it is a
 * fact rather than a judgement, which is what a warn mark may be spent on.
 *
 * Deliberately NOT "nothing booked" on its own. A coach with online-only
 * clients books nothing for most of their roster, and a permanent orange mark
 * beside twelve people is a mark nobody reads on the day it means something.
 * And deliberately not an unread diary either: a failed read is said in words,
 * because a mark beside "we could not check" reads as a finding.
 */
function nextUpUrgent(n, creditsLeft) {
    return n.state === 'none' && creditsLeft != null && creditsLeft > 0;
}
/**
 * The sentence, with no date in it.
 *
 * The date is the screen's to render — it is the reader's language and the
 * reader's order, and a month name written here would be in this file's. What
 * this owns is which of the five things is true, and the wording of the four
 * that have no date to show.
 *
 * `who` is the client's name as the screen already resolved it, so an
 * unreadable name is whatever that screen already draws rather than a second
 * opinion about it.
 */
function nextUpLine(n, creditsLeft, who) {
    switch (n.state) {
        case 'unasked':
            return `${who} has no account, so there is no diary to read. Anything you have arranged with them is between the two of you.`;
        case 'loading':
            return 'Reading what is in the diary…';
        case 'unread':
            // Never "nothing booked". This is the sentence the whole module is
            // shaped around.
            return 'The diary could not be read, so this is not a statement that nothing is booked. Check the calendar before you tell them anything.';
        case 'none':
            if (creditsLeft != null && creditsLeft > 0) {
                return creditsLeft === 1
                    ? `Nothing booked, and ${who} has 1 session left to use.`
                    : `Nothing booked, and ${who} has ${creditsLeft} sessions left to use.`;
            }
            return 'Nothing booked ahead.';
        case 'booked':
            if (n.startsAt === null) {
                return n.after === 0
                    ? 'One session is booked and its date could not be read.'
                    : `${n.after + 1} sessions are booked and none of their dates could be read.`;
            }
            return n.after === 0
                ? 'The only one in the diary.'
                : n.after === 1
                    ? 'And one more after it.'
                    : `And ${n.after} more after it.`;
    }
}
