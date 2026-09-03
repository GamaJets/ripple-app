"use strict";
// Saying no to a session somebody says they delivered.
//
// The client's Personal Training screen offered one control — Approve Session —
// and the coach's pay hangs on it. So the only way to object was to say
// nothing, and silence is unreadable: a member who was never there and a member
// who has not opened the app produce byte-identical records. This module is the
// vocabulary and the wording for the other answer. The database half is
// supabase/parts/241.
//
// ── A DISPUTE IS NOT A CANCELLATION, AND IT MOVES NO MONEY ────────────────
//
// The obvious implementation writes `sessions.outcome`, and it is wrong.
// `isPayable` in src/lib/gymSessions.ts reads that column: 'completed' is paid,
// 'no_show' and 'late_cancelled' are paid under the gym's stated policy, and a
// NULL outcome is reported as unmarked and paid for by nothing. A dispute that
// wrote an outcome would therefore be one party deciding from a phone what the
// other party is paid, with no review, and a payroll run would come out short
// with nothing on any screen saying why.
//
// So the dispute is its own state and gymSessions.ts is deliberately
// UNCHANGED. What a member gets is the record — that they object, to what, and
// when — readable by the two people it is between. What they do not get, and
// are told they do not get, is their money back by tapping a button:
//
//   · the pack credit came off when the session was BOOKED, not now;
//   · the coach's payroll is unaffected until somebody with the authority to
//     change the outcome changes it;
//   · nothing here is a cancellation, late or otherwise — the session has
//     already happened, and part 126 is about ones that have not.
//
// Every sentence below says some part of that, because the gap between what a
// member thinks "Dispute" does and what it does is where the next complaint
// comes from.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DISPUTE_MONEY_NOTE = exports.DISPUTE_OPTIONS = void 0;
exports.disputeKindLabel = disputeKindLabel;
exports.verdictOf = verdictOf;
exports.disputeConfirm = disputeConfirm;
exports.disputeFiledLine = disputeFiledLine;
exports.disputedSummary = disputedSummary;
exports.actionsFor = actionsFor;
/** Ordered by how much of the session is in question, heaviest first. */
exports.DISPUTE_OPTIONS = [
    { id: 'did_not_happen', label: 'This Session Did Not Happen', note: 'You were not trained at this time by this coach.' },
    { id: 'wrong_time', label: 'The Time Is Wrong', note: 'You trained, but not on the day or at the hour shown here.' },
    { id: 'wrong_length', label: 'The Length Is Wrong', note: 'You trained, but for a different amount of time than this says.' },
    { id: 'other', label: 'Something Else Is Wrong', note: 'Anything else about this session you do not agree with.' },
];
function disputeKindLabel(kind) {
    return exports.DISPUTE_OPTIONS.find((o) => o.id === kind)?.label ?? 'Something Else Is Wrong';
}
/**
 * The verdict on a session, from what the approvals read came back with.
 *
 * Takes the raw row shape rather than a parsed one so there is exactly one
 * place that decides what an absent row means, and so a row carrying a `state`
 * this build has never heard of does NOT read as 'approved'. That last case is
 * the one worth the branch: a value added later would otherwise silently count
 * as the client having signed the session off.
 */
function verdictOf(row) {
    if (!row)
        return 'none';
    if (row.state === 'disputed')
        return 'disputed';
    if (row.state === 'approved')
        return 'approved';
    // No `state` at all is a row written before supabase/parts/241, when the only
    // thing a row could be was an approval. An unrecognised one is neither.
    if (row.state == null)
        return row.approvedAt ? 'approved' : 'none';
    return 'none';
}
/**
 * What disputing does to the money, said before they do it.
 *
 * Three clauses and all three are facts about this implementation. The last one
 * is the one that matters: a member who believes this button refunds them stops
 * chasing the refund, and finds out weeks later that nobody was ever asked.
 */
exports.DISPUTE_MONEY_NOTE = 'This records that you disagree, and your coach can see it. It does not take the session off your pack. '
    + 'That credit came off when the session was booked, and disputing does not, on its own, get you any money back. '
    + 'If you are owed something, this is the start of that conversation with your coach, not the end of it.';
/** The confirm in front of it. Named for the objection so the button that
 *  commits cannot be read as a generic "OK". */
function disputeConfirm(kind) {
    return {
        title: 'Send this to your coach?',
        body: `Your coach will see that you disputed this session as “${disputeKindLabel(kind).toLowerCase()}”, along with anything you wrote.\n\n`
            + `${exports.DISPUTE_MONEY_NOTE}\n\n`
            + 'You can change your answer at any time by approving the session instead.',
    };
}
/** After the row exists. Not shown on the strength of a call that did not
 *  raise: the caller checks the RPC accepted first. */
function disputeFiledLine(kind) {
    return `Recorded as “${disputeKindLabel(kind).toLowerCase()}”. Your coach can see it, and you can approve the session instead if you change your mind.\n\n`
        + 'Nothing has been refunded and no credit has been returned by this.';
}
/** How a disputed session reads back on the client's own list. `at` is the
 *  formatted date the caller has already produced, or null when there is none
 *  to show — never a dash inside the sentence (scripts/check-prose.mjs). */
function disputedSummary(kind, at) {
    const head = `You disputed this as “${disputeKindLabel(kind).toLowerCase()}”`;
    return at ? `${head}, on ${at}.` : `${head}.`;
}
/** What the screen offers per verdict. 'none' is the only one with two
 *  choices; the other two offer the change of mind and nothing else. */
function actionsFor(verdict) {
    switch (verdict) {
        case 'approved': return { approve: false, dispute: true };
        case 'disputed': return { approve: true, dispute: false };
        default: return { approve: true, dispute: true };
    }
}
