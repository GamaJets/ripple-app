"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COACH_QUEUE_NOTE = void 0;
exports.replyWait = replyWait;
const awaitingReply_1 = require("./awaitingReply");
const HOUR = 3600000;
/**
 * What the coach's app does with a conversation this old.
 *
 * Stated as a fact about the software, in the present tense, because that is
 * what it is: `WAITING_TITLE` is a section at the top of app/(trainer)/
 * messages.tsx and `sortWaiting` puts the longest wait first. It is deliberately
 * not "your coach will reply" and not "your coach has seen this" — it makes no
 * claim about a person at all, which is the only kind of reassurance this app is
 * entitled to give.
 */
exports.COACH_QUEUE_NOTE = 'Their app lists a conversation that has gone a day without a reply at the top of their messages, longest wait first.';
/** The newest message the server actually has, or null. */
function newestDelivered(messages) {
    let best = null;
    for (const m of messages) {
        if (!m || !m.delivered)
            continue;
        const at = Date.parse(String(m.createdAt));
        // A stamp that will not parse cannot be measured against a clock, and a
        // wait is a subtraction. Dropping it is safe in the only direction that
        // matters: it can silence this, never make it say something longer.
        if (!Number.isFinite(at))
            continue;
        if (!best || at > best.at)
            best = { mine: m.mine, at };
    }
    return best;
}
/**
 * Whether the coach's watermark has passed a message.
 *
 * `>=` and not `>`, exactly as `deliveryOf` has it: the watermark is written as
 * the newest message's own `created_at`, so the newest message is precisely
 * equal and would otherwise be the one message that never counts as read.
 */
function seenBy(peerReadAt, at) {
    if (!peerReadAt)
        return false;
    const read = Date.parse(peerReadAt);
    return Number.isFinite(read) && read >= at;
}
/**
 * What to say above the composer, or nothing.
 *
 * Two facts and no accusation, which is the rule `waitingLine` states on the
 * coach's side and the reason that list is readable. Nothing here says the
 * coach failed to do anything: this module cannot tell a question from a
 * thank-you, and the two people in the conversation can.
 */
function replyWait(i) {
    if (!i.canSend)
        return { kind: 'silent' };
    // 'partial' speaks; the other two do not. See the header.
    if (i.status === 'loading' || i.status === 'error')
        return { kind: 'silent' };
    const last = newestDelivered(i.messages);
    if (!last || !last.mine)
        return { kind: 'silent' };
    const waitedMs = i.now - last.at;
    // A clock behind the server's — a phone whose time is wrong, or a row written
    // a second in the future — is not a negative wait, it is no wait.
    if (!Number.isFinite(waitedMs) || waitedMs < awaitingReply_1.WAITING_HOURS * HOUR)
        return { kind: 'silent' };
    const ago = (0, awaitingReply_1.waitedLabel)(waitedMs);
    if (seenBy(i.peerReadAt, last.at)) {
        return {
            kind: 'seen',
            waitedMs,
            note: `You wrote ${ago} ago and ${i.them} has opened it. Nothing has come back yet. ${exports.COACH_QUEUE_NOTE}`,
        };
    }
    return {
        kind: 'sent',
        waitedMs,
        // "has not opened it" is the sentence this branch exists to refuse. A
        // missing watermark is an unauthorised read and a thread nobody has opened,
        // wearing the same face.
        note: `You wrote ${ago} ago and nothing has come back yet. This app cannot tell whether ${i.them} has opened it. ${exports.COACH_QUEUE_NOTE}`,
    };
}
