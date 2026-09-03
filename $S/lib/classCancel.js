"use strict";
// What a member can be told before they cancel a class booking.
//
// ── Why this is a module and not a string in the screen ───────────────────
//
// The PT path is scrupulous. `cancelWarningFor` in src/ui/sessions.tsx reads
// the coach's own notice period and late fee, states both, and says so plainly
// when the policy could not be read. The class path — the one the GYM actually
// bills — said nothing at all: `Alert.alert('Cancel booking?', '<title> ·
// <branch> · <day> <time>')` and two buttons. Silence reads as free.
//
// The reason it said nothing is real: this app does not hold a gym's class
// cancellation policy. There is no column for it, no screen where an owner sets
// one, and inventing "24 hours" here would be worse than the silence — a member
// told they are inside a window their gym does not run is being given a fact
// this app made up.
//
// So this says the two things that ARE true and are worth knowing: how long
// until the class starts, and that the charge is the gym's decision and not one
// this app can see. That is the same shape as the PT path's own unknown-policy
// sentence, which exists for exactly this case.
//
// ── No brand name in the copy ─────────────────────────────────────────────
//
// "Repple does not hold your gym's policy" is a sentence about a supplier the
// member of a white-label gym has never heard of. It says "this app".
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLASS_POLICY_UNKNOWN_NOTE = void 0;
exports.hoursUntil = hoursUntil;
exports.startsInLine = startsInLine;
exports.classCancelBody = classCancelBody;
/** How many whole hours until the class starts. Null when the timestamp is not
 *  one, and 0 for a class that has already begun — never negative, which would
 *  print as "starts in -3 hours". */
function hoursUntil(startsAt, now = Date.now()) {
    const t = Date.parse(startsAt);
    if (Number.isNaN(t))
        return null;
    return Math.max(0, Math.floor((t - now) / 3600000));
}
/** When the class begins, in the member's own terms. Null when there is nothing
 *  honest to say about it. */
function startsInLine(startsAt, now = Date.now()) {
    const h = hoursUntil(startsAt, now);
    if (h == null)
        return null;
    if (h === 0) {
        const t = Date.parse(startsAt);
        return t <= now ? 'This class has already started.' : 'This class starts within the hour.';
    }
    if (h === 1)
        return 'This class starts in about an hour.';
    if (h < 48)
        return `This class starts in about ${h} hours.`;
    return `This class starts in about ${Math.round(h / 24)} days.`;
}
/**
 * The one thing this app can say about what cancelling costs, which is that it
 * does not know.
 *
 * Deliberately not softened into "this is free". A gym charging a late
 * cancellation is ordinary, the member is the one who can find out, and a
 * confirmation that stays quiet about money is read as a confirmation that
 * there is none.
 */
exports.CLASS_POLICY_UNKNOWN_NOTE = 'Your gym decides whether a late cancellation or a missed class is charged. This app does not hold that policy, so it cannot tell you what this will cost — ask the gym if you are not sure.';
/**
 * The body of the "Cancel booking?" confirmation.
 *
 * `what` is the class as the screen already words it, and is passed in rather
 * than assembled here: the screen owns the title, the branch and the times, and
 * this module owns the sentence about the consequence.
 */
function classCancelBody(what, startsAt, now = Date.now()) {
    const when = startsInLine(startsAt, now);
    return [what, when, exports.CLASS_POLICY_UNKNOWN_NOTE].filter(Boolean).join('\n\n');
}
