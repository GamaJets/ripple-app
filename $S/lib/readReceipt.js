"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.READ_MARK_MIN_GAP_MS = exports.BOTTOM_SLOP = exports.LOCAL_ID_PREFIX = void 0;
exports.isLocalId = isLocalId;
exports.deliveryOf = deliveryOf;
exports.deliveryLine = deliveryLine;
exports.atBottom = atBottom;
exports.newestConfirmedAt = newestConfirmedAt;
exports.nextReadMark = nextReadMark;
exports.receiptWorthPolling = receiptWorthPolling;
// What one bubble is allowed to claim about itself, and when this device is
// allowed to tell the server the reader has read something.
//
// ── The report, and the half of it that was already true ───────────────────
//
// "When sending a message you don't have any confirmation that the message has
// been sent or read."
//
// The SENT half was already built, and it is worth being exact about it,
// because the temptation on reading that sentence is to build a second
// mechanism beside the one that exists. `useThread` in src/ui/messaging.ts
// already reports ok only once the ROW is on the server, already carries a
// `sending` flag per bubble, and already lists the ids of bubbles that failed
// or are queued in `unsent` with WHICH half failed. Both chat screens already
// render three different things under a bubble — `unsentNote(...)` for a
// failure, 'Sending…' in flight, and the message's time once the server has it
// — and they do it for a plain text message, not only for one carrying a
// photograph. That machinery is right and this file extends it rather than
// replacing it: `deliveryLine` delegates the two failure sentences straight
// back to `unsentNote`, so there remains exactly one place that words them.
//
// What was missing from the sent half was one word. The confirmed state was a
// bare clock time — "09:41" — which is a fact about when the message was
// written and says nothing about whether it arrived. A reader has to already
// know that this app never shows a time on an unsent bubble in order to read
// the time as confirmation. So the confirmed state now says "Sent 09:41", which
// is the same information with the claim made out loud, and the three states
// stay three sentences.
//
// The READ half did not exist. `message_reads` was written (`mark_thread_read`,
// called from useThread) and read (`coach_unread_counts`, badged on the roster
// and the coach's inbox) — but only ever by the person whose row it is. Part 88
// grants each side sight of its OWN watermark and nobody sight of the other's,
// so the receipt needed a new function that deliberately opens it. The argument
// for opening it is in supabase/parts/950; what follows is what this device is
// allowed to do with the answer.
//
// ── WHAT COUNTS AS READ ────────────────────────────────────────────────────
//
// The rule: the newest message the SERVER has confirmed is on this reader's
// screen, at the bottom of a list that is scrolled to its end, while the thread
// is the focused screen and the app is in the foreground.
//
// All four clauses are load-bearing and each one is a claim that was available
// and is refused:
//
//   · SERVER-CONFIRMED. A local bubble's `createdAt` is this phone's clock and
//     its row may not exist at all. Marking read up to a timestamp no message
//     was ever stamped with is marking read a message nobody sent.
//   · SCROLLED TO THE END. A thread opened and left at the top is a thread
//     whose newest message was never drawn. This is the clause that the
//     existing behaviour did not have: `useThread` called `mark_thread_read`
//     the instant the read settled, whatever was on screen.
//   · FOCUSED. The coach's chat is a `Tabs.Screen` with `href: null` and no
//     `unmountOnBlur`, so it stays mounted behind whatever the coach opened
//     next. Without this clause a message arriving while the coach is on the
//     Money screen would be marked read by a component nobody is looking at.
//   · FOREGROUND. Same argument, for a phone in a pocket. A locked screen is
//     not a read message.
//
// ── WHAT THIS DELIBERATELY DOES NOT CLAIM ──────────────────────────────────
//
// It does not claim the words were read. Nothing a server can observe does. It
// claims the message was rendered, at the bottom of the thread, on an unlocked
// phone whose owner had this screen in front of them — and "Read" is the word
// fifteen years of messengers have used for exactly that claim, so it is the
// honest word rather than a euphemism.
//
// It does not claim WHICH messages were read. `message_reads` holds one
// watermark per thread per side, so opening a thread with four unread messages
// and reading one marks four. That is part 88's design, it is what the roster
// badge has always meant, and inventing a second, finer answer here would put
// two disagreeing definitions of "read" on the same phone. src/ui/coachThreads.ts
// states the same inheritance for the same reason.
//
// It does not claim a TIME. `thread_read_receipt` returns a timestamp because
// the comparison needs one; `deliveryLine` renders the word and never the hour.
// "Read" is a fact about a message. "Read at 23:41" is a fact about a person's
// evening, and the sender did not need it to know their message landed.
//
// ── A FAILED WRITE MUST NOT SHOW A RECEIPT ─────────────────────────────────
//
// This is the rule this codebase has broken four separate times, so it is
// enforced twice here, from both ends.
//
// On the READER's side, `nextReadMark` advances its idea of what has been
// marked only from `confirmedAt` — a value the caller may set only after the
// RPC came back true. An optimistic "we just wrote it" would silently stop all
// further writes when the write in fact failed, and the reader's watermark
// would stand still for the rest of the session.
//
// On the SENDER's side, `deliveryOf` cannot return 'read' for a bubble that is
// not itself confirmed. Anything with a stage, anything still sending, and
// anything whose id is local reads as sending or failed — never as read, and
// never as sent. The receipt is compared against the message's own server
// `created_at`, and a message that has no server row has no `created_at` to
// compare. A peer watermark cannot promote a bubble the server refused.
//
// ── DO NOT WRITE ON EVERY RENDER ───────────────────────────────────────────
//
// The condition above changes on every scroll event, every arriving message and
// every focus change, and a write per change is a write storm on a table with
// one row per thread per side. `nextReadMark` refuses three ways:
//
//   · MONOTONIC. Nothing to mark that is newer than what is already confirmed
//     is 'idle'. A reader scrolling up and down a settled thread writes nothing
//     at all, however much the scroll handler fires.
//   · ONE AT A TIME. A write in flight is 'idle'; the completion re-runs the
//     decision with the new `confirmedAt`.
//   · SPACED. Two writes are never closer than READ_MARK_MIN_GAP_MS. A burst
//     returns 'wait' with how long is left, so the caller can come back rather
//     than drop the mark — a debounce that discarded the trailing edge would
//     leave the last message of a fast exchange permanently unread.
//
// The server clamps and orders the value regardless (supabase/parts/950), so
// these three are about not making the call, not about correctness if one slips
// through.
//
// ── OFFLINE: THE MARK DOES NOT QUEUE ───────────────────────────────────────
//
// The device outbox (src/lib/outbox.ts) holds the member's own words, and it
// holds them because words typed and lost are gone. A read mark is not that. It
// is a fact the server can be told again the next time this thread is opened
// with signal, and a failed one costs the reader an unread badge that stays up
// — which OVERSTATES what is waiting rather than hiding it, the same harmless
// direction `useThread` chose when it swallowed the old call's failure.
//
// Queuing it would also spend a slot the member's messages need, and deliver a
// claim about a moment that has passed hours later, to a sender who has since
// seen the thread go quiet. So: no queue, no retry beyond the natural one, and
// the receipt on the other person's phone lags a basement rather than lying
// about it.
//
// Pure and framework-free; asserted under plain node in readReceipt.test.ts.
// The I/O is src/ui/readReceipts.ts and the policy is supabase/parts/950.
const messageAttachments_1 = require("./messageAttachments");
/** The prefix `useThread` gives an optimistic bubble. A message wearing one has
 *  no row on the server and cannot be sent, read, or marked read up to. */
exports.LOCAL_ID_PREFIX = 'local-';
/** True for a bubble that exists only on this phone. */
function isLocalId(id) {
    return typeof id === 'string' && id.startsWith(exports.LOCAL_ID_PREFIX);
}
/**
 * What this bubble is.
 *
 * Null for somebody else's message — the caller renders a plain time.
 *
 * The order of the tests is the argument. A refusal beats everything, because a
 * bubble the server refused is the one state that must never be dressed as any
 * other. Then in-flight. Then the local-id guard, which is the belt to that
 * brace: a bubble with no server row is 'sending' whatever its flags say, so no
 * combination of stale state can produce 'sent' for a message that does not
 * exist. Only what is left is eligible for a receipt.
 */
function deliveryOf(b, peerReadAt) {
    if (!b.mine)
        return null;
    if (b.stage === 'queued')
        return 'queued';
    if (b.stage === 'upload' || b.stage === 'send')
        return 'failed';
    if (b.sending)
        return 'sending';
    // No row, no claim. Reached when state is inconsistent rather than in normal
    // operation, and 'sending' is the reading that overstates nothing.
    if (isLocalId(b.id))
        return 'sending';
    if (!peerReadAt)
        return 'sent';
    const read = Date.parse(peerReadAt);
    const made = Date.parse(b.createdAt);
    // An unparseable timestamp on either side is not evidence of a read.
    if (!Number.isFinite(read) || !Number.isFinite(made))
        return 'sent';
    // `>=`, not `>`: the reader's watermark is set to the newest message's own
    // `created_at`, so the newest message is exactly equal and would otherwise be
    // the one message that never shows as read.
    return read >= made ? 'read' : 'sent';
}
/**
 * The sentence under the bubble.
 *
 * `time` is already formatted by the screen, which is where the member's locale
 * and timezone live. This module never parses a date into a calendar day and
 * never picks a format; it only compares two instants.
 *
 * `them` completes `unsentNote`'s "…so <them> cannot see it" — 'your coach' on
 * the client side, the client's first name or 'they' on the coach's.
 */
function deliveryLine(b, peerReadAt, words) {
    const d = deliveryOf(b, peerReadAt);
    if (d === null)
        return words.time;
    if (d === 'sending')
        return 'Sending…';
    // The two failures keep their existing wording, from the module that owns it.
    if (d === 'queued')
        return (0, messageAttachments_1.unsentNote)(words.them, 'queued', b.kind);
    if (d === 'failed')
        return (0, messageAttachments_1.unsentNote)(words.them, b.stage === 'upload' ? 'upload' : 'send', b.kind);
    // The time is the message's, in both. 'Read' is added to it rather than
    // replacing it, so nothing a sender could already see goes away when their
    // message is read.
    return d === 'read' ? `Sent ${words.time} · Read` : `Sent ${words.time}`;
}
/* ── the reader's side: when to move the watermark ───────────────────────── */
/** How close to the end of the list still counts as the end, in points. A
 *  thread the reader has thumbed a few pixels off the bottom is still a thread
 *  whose last message is in front of them. */
exports.BOTTOM_SLOP = 24;
/** Whether a scroll position has the end of the content on screen. Fed straight
 *  from a ScrollView's `onScroll` event. A thread shorter than the viewport
 *  gives a negative distance and is at the bottom, which is correct and is the
 *  common case for a new conversation. */
function atBottom(m, slop = exports.BOTTOM_SLOP) {
    if (![m.offsetY, m.viewport, m.content].every((n) => Number.isFinite(n)))
        return false;
    return m.content - (m.offsetY + m.viewport) <= slop;
}
/**
 * The newest moment this device may honestly mark read up to.
 *
 * Only server-confirmed rows are candidates. A local bubble is skipped even
 * when it is the newest thing on screen, because its timestamp is this phone's
 * clock and its row may never exist — and marking read up to it would mark read
 * whatever the server stored in between.
 *
 * Max rather than last, because `loadOlder` prepends and the outbox merge
 * sorts by written-at; neither guarantees the array's last element is the
 * newest confirmed one.
 */
function newestConfirmedAt(rows) {
    let best = null;
    let bestMs = -Infinity;
    for (const r of rows ?? []) {
        if (!r || isLocalId(r.id))
            continue;
        const ms = Date.parse(r.createdAt);
        if (!Number.isFinite(ms) || ms <= bestMs)
            continue;
        bestMs = ms;
        best = r.createdAt;
    }
    return best;
}
/** The floor between two `last_read_at` writes. Four seconds is long enough
 *  that a scroll gesture and a burst of arriving messages coalesce into one
 *  write, and short enough that the other person's "Read" appears while they
 *  are still looking at the thread. */
exports.READ_MARK_MIN_GAP_MS = 4000;
function nextReadMark(s, nowMs, minGapMs = exports.READ_MARK_MIN_GAP_MS) {
    // Not being looked at is the whole of the rule; nothing below it matters.
    if (!s.visible)
        return { act: 'idle' };
    if (!s.newestAt)
        return { act: 'idle' };
    const want = Date.parse(s.newestAt);
    if (!Number.isFinite(want))
        return { act: 'idle' };
    if (s.inFlight)
        return { act: 'idle' };
    if (s.confirmedAt) {
        const have = Date.parse(s.confirmedAt);
        // Forward only. `<=` and not `<`: re-writing the same instant is a write
        // that changes nothing, and the server would coalesce it anyway.
        if (Number.isFinite(have) && want <= have)
            return { act: 'idle' };
    }
    if (s.lastWriteMs !== null && Number.isFinite(s.lastWriteMs)) {
        const since = nowMs - s.lastWriteMs;
        // A clock that went backwards between the two readings gives a negative
        // `since`. Waiting the whole gap is the conservative reading and cannot
        // livelock, because the next call is made against a later `nowMs`.
        if (since < minGapMs)
            return { act: 'wait', inMs: Math.max(1, minGapMs - since) };
    }
    return { act: 'write', at: s.newestAt };
}
/**
 * Whether it is worth asking the server for the peer's watermark again.
 *
 * False once every message of mine is already read, which is what stops the
 * poll: a settled thread costs nothing, and the read starts again by itself the
 * moment I send something the peer has not seen.
 */
function receiptWorthPolling(bubbles, peerReadAt) {
    for (const b of bubbles ?? []) {
        if (deliveryOf(b, peerReadAt) === 'sent')
            return true;
    }
    return false;
}
