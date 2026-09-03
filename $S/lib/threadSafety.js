"use strict";
// Blocking somebody, and reporting what they sent.
//
// The rules and the wording for the one surface in this product that carries
// user-generated photographs and video between two named adults: the coach↔
// client message thread. The database half is supabase/parts/240; the React
// half is src/ui/messaging.ts and app/(client)/messages.tsx. This file holds
// what is pure, so every sentence a member reads at the worst moment they will
// ever have with this app is assertable under `npm test` with no device.
//
// ── Why the state has four members and not two ────────────────────────────
//
// `LoadStatus` is loading | ready | partial | error, and an empty list under
// 'error' means UNKNOWN — never "there are none". That rule is load-bearing
// here in a way it is nowhere else in the app: a screen that reads no block
// row because the read FAILED, and concludes the thread is open, tells
// somebody who blocked their coach last night that they have not blocked
// anybody. So `blockStateOf` returns 'unknown' for anything short of a
// completed read, and every sentence below has a branch for it.
//
// ── What a block does, and the three things it does not ───────────────────
//
// DOES: refuse the write, at the database, in both directions. A blocked
// sender's message is rejected and their photograph never reaches the bucket
// (the WITH CHECK on msg_client / msg_coach and on msgmedia_obj_insert).
//
// DOES NOT delete the history. The thread stays readable to both of them,
// because a report is made out of what was said and a block that erased it
// would destroy the evidence in the act of asking for help.
//
// DOES NOT end the coaching relationship, cancel a session or move any money.
// Somebody blocking their coach at eleven at night has not cancelled Tuesday,
// and this app must not quietly decide they have.
//
// DOES NOT depend on the other person. Neither does a report: no approval, no
// acknowledgement, no notification to them, nothing they can interfere with.
Object.defineProperty(exports, "__esModule", { value: true });
exports.REPORT_FAILED_NOTE = exports.REPORT_EXPLAINER = exports.REPORT_OPTIONS = exports.SEND_REFUSED_NOTE = exports.canSendInto = void 0;
exports.blockStateOf = blockStateOf;
exports.blockedComposerNote = blockedComposerNote;
exports.blockActionLabel = blockActionLabel;
exports.blockConfirm = blockConfirm;
exports.unblockConfirm = unblockConfirm;
exports.looksLikeThreadRefusal = looksLikeThreadRefusal;
exports.reportCategoryLabel = reportCategoryLabel;
exports.reportFiledLine = reportFiledLine;
/**
 * The state of a thread from the rows and the read that produced them.
 *
 * `myId` null is 'unknown' rather than 'blocked-by-them': not knowing who I am
 * is not evidence that somebody blocked me, and the composer note for the two
 * is different.
 *
 * Both sides blocking resolves to 'blocked-by-me', because that is the half
 * this reader can do something about.
 */
function blockStateOf(status, rows, myId) {
    // 'partial' is not 'ready' here for the same reason it is not anywhere else.
    // A page of blocks that may be missing a row cannot establish that nobody
    // blocked anybody — and there are at most two rows, so a truncated read of
    // this table means something has gone quite wrong.
    if (status !== 'ready' || rows == null)
        return 'unknown';
    if (!myId)
        return 'unknown';
    if (rows.some((r) => r.blockerId === myId))
        return 'blocked-by-me';
    return rows.length > 0 ? 'blocked-by-them' : 'open';
}
/** Whether anything may still be sent into this thread, as far as this device
 *  knows. 'unknown' is deliberately true: the server refuses a blocked write
 *  anyway, and disabling the composer on a failed read would silence somebody
 *  nobody has blocked. */
const canSendInto = (state) => state === 'unknown' || state === 'open';
exports.canSendInto = canSendInto;
/**
 * The line under a composer that will not send, or null when there is nothing
 * to say.
 *
 * `other` is a description rather than a name — "your coach", "this client" —
 * because a name that could not be read renders as a dash, and a dash as the
 * subject of a sentence reads as the screen having broken. See
 * scripts/check-prose.mjs, which exists because of exactly that.
 */
function blockedComposerNote(state, other) {
    switch (state) {
        case 'blocked-by-me':
            return `You blocked ${other}. Nothing can be sent in either direction until you unblock them. Everything already here stays.`;
        case 'blocked-by-them':
            return 'This conversation is closed, so nothing can be sent. Everything already here stays.';
        default:
            return null;
    }
}
/** What the safety control offers, given what we know. */
function blockActionLabel(state, other) {
    return state === 'blocked-by-me' ? `Unblock ${other}` : `Block ${other}`;
}
/** The confirm in front of blocking. Says what it does AND the three things it
 *  does not, because the member is deciding under pressure and the thing they
 *  most need to know is that this is not the button that cancels their
 *  sessions. */
function blockConfirm(other) {
    return {
        title: 'Block this person?',
        body: `${capitalise(other)} will not be able to send you messages, photos or video, and you will not be able to send them any. `
            + 'Nothing already in this conversation is deleted, so you can still read it and still report it.\n\n'
            + 'This does not end your coaching, cancel any session, or move any money. You can unblock at any time.',
    };
}
function unblockConfirm(other) {
    return {
        title: 'Unblock this person?',
        body: `${capitalise(other)} will be able to message you again, and you will be able to message them. `
            + 'Any report you have made stays on record either way.',
    };
}
/**
 * What to say when a send was refused by the server.
 *
 * Deliberately covers two causes in one true sentence. A 42501 on this insert
 * is either a block or a coaching link that no longer exists, and this device
 * cannot tell them apart — so it names both rather than asserting the one it
 * would rather be. What it never does is let the bubble read as delivered.
 */
exports.SEND_REFUSED_NOTE = 'The server would not accept that message, so it has not been sent. This conversation is closed: either it has been blocked, or you two are no longer connected.';
/**
 * Whether a supabase-js error looks like the thread refusing the write.
 *
 * `42501` is the RLS refusal; the message text is checked too because
 * PostgREST does not always carry the code through on a policy violation. A
 * false positive costs a more specific sentence in place of a vaguer one, and
 * a false negative costs nothing at all — both branches say the message was
 * not sent, which is the fact that matters.
 */
function looksLikeThreadRefusal(err) {
    if (!err || typeof err !== 'object')
        return false;
    const e = err;
    if (String(e.code ?? '') === '42501')
        return true;
    return /row-level security|violates row-level/i.test(String(e.message ?? ''));
}
/**
 * What a member is offered.
 *
 * Ordered by severity descending rather than alphabetically, and 'other' is
 * last because a list whose first option is the vaguest one is a list people
 * pick the first option from. Nothing here asks the member to characterise
 * their own experience in legal terms.
 */
exports.REPORT_OPTIONS = [
    { id: 'threat', label: 'Threats or Violence', note: 'They threatened to hurt you or somebody else.' },
    { id: 'sexual', label: 'Sexual Content or Harassment', note: 'Sexual images, video or messages you did not ask for.' },
    { id: 'harassment', label: 'Bullying or Harassment', note: 'Abuse, intimidation, or messages that will not stop.' },
    { id: 'spam', label: 'Spam or a Scam', note: 'Selling something, a link, or an attempt to take money off you.' },
    { id: 'other', label: 'Something Else', note: 'Anything else you think we should look at.' },
];
function reportCategoryLabel(id) {
    return exports.REPORT_OPTIONS.find((o) => o.id === id)?.label ?? 'Something Else';
}
/**
 * What a report actually does, said before they make one.
 *
 * Every clause is a fact about this implementation and not a reassurance:
 * the row is written (part 240), the message is copied into it so it survives
 * being deleted, and the other person is told nothing by it. The last sentence
 * is the one that matters most at the moment somebody taps this — a report is
 * not a block, and a person who wants the messages to stop has to do both.
 */
exports.REPORT_EXPLAINER = 'What you report is recorded with the message itself, so it stays on record even if it is deleted afterwards. '
    + 'The other person is not told that you reported them, and they cannot see or remove it. '
    + 'Reporting on its own does not stop them messaging you — block them as well if you want that.';
/** Confirmation after the row exists. Never shown on the strength of a call
 *  that returned without raising: the caller checks for an id first. */
function reportFiledLine(category, blocked) {
    const head = `Your report is on record as ${reportCategoryLabel(category).toLowerCase()}. Nobody has been told that you made it.`;
    return blocked === 'blocked-by-me'
        ? `${head}\n\nThey are still blocked, so nothing more can be sent either way.`
        : `${head}\n\nThey can still message you. Block them if you want that to stop.`;
}
/** When the report did not land. Says plainly that nothing was recorded, for
 *  the same reason `requestAccountDeletion`'s failure branch does: somebody who
 *  believes a report is filed stops looking for another way to get help. */
exports.REPORT_FAILED_NOTE = 'That report was not recorded, so nothing has been filed. Check your connection and try again. '
    + 'If it keeps failing, email us from the address on your account and quote the date and time.';
/** Small helper: "your coach" → "Your coach" at the head of a sentence. Kept
 *  here rather than inline so the two confirms cannot drift. */
function capitalise(s) {
    const v = String(s ?? '').trim();
    return v ? v.charAt(0).toUpperCase() + v.slice(1) : v;
}
