"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.showsInPerson = exports.HIDDEN_NOT_GONE = exports.DELIVERY_EFFECT = exports.DELIVERY_NOTE = exports.DELIVERY_LABEL = exports.DELIVERY_OPTIONS = void 0;
exports.deliveryFact = deliveryFact;
exports.deliveryNote = deliveryNote;
exports.deliveryAskLine = deliveryAskLine;
exports.deliveryStatusLine = deliveryStatusLine;
const loadStatus_1 = require("../ui/loadStatus");
const types_1 = require("./types");
/** The three, in the order they are offered. Same list and same order as
 *  `COACHED_MODES`, which is what the coach already picks from when they
 *  classify a client — so the two questions cannot come to offer different
 *  answers. */
exports.DELIVERY_OPTIONS = types_1.COACHED_MODES;
/** Title Case: these render as the title of a row the coach taps. */
exports.DELIVERY_LABEL = {
    online: 'Online Only',
    inperson: 'In Person',
    hybrid: 'Both',
};
/**
 * One line per option, in the coach's own voice, saying what picking it
 * changes.
 *
 * The `COACHING_MODE_NOTE` pattern from src/lib/types.ts, and it travels with
 * the option everywhere it is offered for the reason stated there: "Hybrid" on
 * its own is a word, not a choice anybody can make. Sentence case, because
 * these are prose.
 */
exports.DELIVERY_NOTE = {
    online: 'You program and check in remotely. Your money is packages and subscriptions rather than sessions, and the booking calendar, classes and session marking move out of the way until somebody trains with you in person.',
    inperson: 'You train people in the room. You keep the booking calendar, your published hours, classes and the queue of sessions waiting to be marked.',
    hybrid: 'Both, and nothing is put away. You keep everything an in-person coach has, and your takings still count packages and subscriptions alongside the sessions you deliver.',
};
/**
 * What picking it actually set up, said after the fact.
 *
 * Separate from `DELIVERY_NOTE` because the tense matters: one is an offer and
 * one is a receipt. A coach who is shown what their answer DID is a coach who
 * can tell whether they answered wrongly, and this is the whole of the
 * "say what changes when they pick" requirement — one line, on the control
 * itself, rather than a fourth screen explaining the app.
 */
exports.DELIVERY_EFFECT = {
    online: 'Set up for remote coaching. Your takings are read from packages, subscriptions and the payments you record yourself, and the in-person tools are tucked away rather than removed. Search finds every one of them, and the first in-person client you take brings them back on their own.',
    inperson: 'Set up for in-person coaching. Nothing is hidden, and what you have delivered is counted from the outcomes you mark rather than from the clock.',
    hybrid: 'Set up for both. Nothing is hidden, and your money is read from packages and subscriptions as well as from the sessions you mark as delivered.',
};
/** Said wherever something has been put away, because a coach has to be able
 *  to believe it. */
exports.HIDDEN_NOT_GONE = 'Nothing has been removed. Every one of these screens is still in the app and still turns up in search, and taking on one client in person brings them all back to where they were.';
/**
 * The one fact, from the two sources.
 *
 * Reads top to bottom in order of how WIDE the answer is, so that the first
 * clause that matches is the widest one that applies. Every early return is an
 * 'inperson' — which is another way of saying that this function can only reach
 * 'remote' by having established all three of: the coach said online, the
 * roster was read in full, and nobody on it trains in the room.
 */
function deliveryFact(input) {
    const rosterKnown = (0, loadStatus_1.isWhole)(input.rosterStatus);
    const clients = rosterKnown ? input.roster.length : null;
    const inPersonClients = rosterKnown
        ? input.roster.filter((c) => (0, types_1.booksInPerson)(c.mode)).length
        : null;
    const declaredKnown = (0, loadStatus_1.isWhole)(input.declaredStatus);
    const base = {
        inPersonClients,
        clients,
        emptyBook: rosterKnown && input.roster.length === 0,
        declaredKnown,
    };
    const wide = (reason) => ({ shape: 'inperson', reason, ...base });
    // The declaration could not be read. It is not null-meaning-unanswered, it is
    // unknown, and an unknown floor is the widest floor.
    if (!declaredKnown)
        return wide('declaration-unread');
    // Two of the three answers are the widest answer outright, and the roster has
    // nothing to add to either: it may only widen, and there is nothing wider.
    if (input.declared === 'inperson')
        return wide('declared-inperson');
    if (input.declared === 'hybrid')
        return wide('declared-hybrid');
    // Not asked, or skipped. Behaves as the widest option rather than the
    // narrowest: hiding a calendar from somebody who has not answered a question
    // is the one direction that costs a coach something they said nothing about.
    if (input.declared == null)
        return wide('not-declared');
    // From here the coach has said 'online'. Only a WHOLE roster may be asked
    // whether it widens that; a short, refused or in-flight one widens it by
    // default, because an unread book is not an empty one.
    if (!rosterKnown)
        return wide('roster-unread');
    if ((inPersonClients ?? 0) > 0)
        return wide('roster-widened');
    return { shape: 'remote', reason: 'declared-online', ...base };
}
/** True when the app may put the in-person tools away. The one question every
 *  screen actually asks, written once so no screen compares to a literal. */
const showsInPerson = (f) => f.shape === 'inperson';
exports.showsInPerson = showsInPerson;
/**
 * Why the app looks the way it does, in one sentence for the coach.
 *
 * Sentence case, and never a bare dash: every branch here is a whole sentence
 * whatever came back null, which is the rule scripts/check-prose.mjs enforces.
 */
function deliveryNote(f) {
    switch (f.reason) {
        case 'declared-inperson':
            return 'You train people in the room, so everything is here.';
        case 'declared-hybrid':
            return 'You coach both in the room and remotely, so everything is here.';
        case 'roster-widened':
            return f.inPersonClients === 1
                ? 'You coach online, and one client on your book trains with you in person, so the in-person tools are here.'
                : `You coach online, and ${f.inPersonClients} of your clients train with you in person, so the in-person tools are here.`;
        case 'not-declared':
            return 'You have not said how you coach yet, so nothing has been put away.';
        case 'declaration-unread':
            return 'How you coach could not be read just now, so nothing has been put away.';
        case 'roster-unread':
            return 'Your roster did not come back in full, so nothing has been put away. An unread book is not an empty one.';
        case 'declared-online':
            return f.emptyBook
                ? 'You coach online and have nobody on your book yet, so the in-person tools are out of the way.'
                : 'You coach online and nobody on your book trains with you in person, so the in-person tools are out of the way.';
    }
}
/**
 * The line offering the question, or null once it has been answered.
 *
 * Null while the read is still unknown as well as once it is answered: a
 * prompt to answer, shown because a read failed, would invite a coach to
 * re-answer a question they had already answered, and the widest-answer rule
 * means nothing is lost by staying quiet until we know.
 */
function deliveryAskLine(f) {
    if (!f.declaredKnown)
        return null;
    if (f.reason !== 'not-declared')
        return null;
    return 'Say whether you coach in person, online or both, and the app sets itself up around it. Everything is shown until you do.';
}
/**
 * What a declared answer reads as on the profile, or the honest alternative.
 *
 * Three outcomes and they are not interchangeable. A coach whose read failed is
 * not a coach who has not answered, and telling them they have not is how
 * somebody comes to answer twice.
 */
function deliveryStatusLine(declared, status) {
    if (status === 'loading')
        return 'Reading how you coach…';
    if (!(0, loadStatus_1.isWhole)(status))
        return 'How you coach could not be read just now, so nothing has been put away. This is this screen not knowing, not you not having answered.';
    if (declared == null)
        return 'Not answered yet. Everything in the app is shown until you say, which is the safe way round.';
    return exports.DELIVERY_EFFECT[declared];
}
