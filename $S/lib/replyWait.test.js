"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The member's half of the queue their coach is already looking at.
// Compile with tsc, run with node.
//
// src/lib/awaitingReply.ts files every client whose own last word has stood a
// full day into a "Waiting on a Reply" section at the top of the coach's
// messages screen. The member in that section is told nothing: the client
// thread shows a composer, their bubbles and a per-message receipt, and the
// only line that ever spoke to the silence was a fabricated "usually replies
// within a few hours" that was deleted rather than replaced.
const replyWait_1 = require("./replyWait");
const awaitingReply_1 = require("./awaitingReply");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const NOW = Date.parse('2026-09-03T18:00:00.000Z');
const HOUR = 3600000;
const at = (hoursAgo) => new Date(NOW - hoursAgo * HOUR).toISOString();
const base = {
    status: 'ready',
    peerReadAt: null,
    now: NOW,
    canSend: true,
    them: 'Dayne',
};
/** Their message, delivered. */
const theirs = (h) => ({ mine: false, createdAt: at(h), delivered: true });
/** Mine, delivered. */
const mine = (h) => ({ mine: true, createdAt: at(h), delivered: true });
/* ── the silences, which are most of the answers ───────────────────────── */
eq((0, replyWait_1.replyWait)({ ...base, messages: [] }).kind, 'silent', 'an empty thread has nobody waiting in it');
eq((0, replyWait_1.replyWait)({ ...base, messages: [mine(50), theirs(48)] }).kind, 'silent', 'the coach spoke last, so there is nothing to wait for');
eq((0, replyWait_1.replyWait)({ ...base, messages: [mine(awaitingReply_1.WAITING_HOURS - 1)] }).kind, 'silent', 'under a day is a coach on a gym floor, not a silence');
eq((0, replyWait_1.replyWait)({ ...base, messages: [mine(100)], canSend: false }).kind, 'silent', 'a closed or blocked thread is explained by the screen, not by this');
eq((0, replyWait_1.replyWait)({ ...base, messages: [mine(100)], status: 'loading' }).kind, 'silent', 'a read in flight states no silence');
eq((0, replyWait_1.replyWait)({ ...base, messages: [mine(100)], status: 'error' }).kind, 'silent', 'and neither does one that failed — a reply may exist that did not come back');
{
    // The threshold is imported, not restated. If the coach's queue ever moves
    // off a day, the member's sentence moves with it and this line still holds.
    const r = (0, replyWait_1.replyWait)({ ...base, messages: [mine(awaitingReply_1.WAITING_HOURS)] });
    ok(r.kind !== 'silent', 'exactly a day is a wait');
    eq((0, replyWait_1.replyWait)({ ...base, messages: [mine(awaitingReply_1.WAITING_HOURS - 0.01)] }).kind, 'silent', 'a moment under it is not');
}
{
    // Never delivered. "You have been waiting two days" over a message sitting in
    // an outbox is a lie in the cruellest available direction, and the bubble
    // already carries its own sentence.
    const r = (0, replyWait_1.replyWait)({ ...base, messages: [{ mine: true, createdAt: at(72), delivered: false }] });
    eq(r.kind, 'silent', 'a message the server never got is not a wait');
}
{
    // An older delivered message of mine, with a failed newer one on top. The
    // three-day wait is real; the failure is a separate sentence.
    const r = (0, replyWait_1.replyWait)({
        ...base,
        messages: [mine(72), { mine: true, createdAt: at(1), delivered: false }],
    });
    ok(r.kind !== 'silent', 'a failed send on top does not erase the wait beneath it');
}
{
    // A phone whose clock is ahead of the server's. A negative wait is no wait,
    // and it is no wait however large the gap: an absolute value here would read
    // a message stamped three days ahead as three days old.
    eq((0, replyWait_1.replyWait)({ ...base, messages: [{ mine: true, createdAt: at(-5), delivered: true }] }).kind, 'silent', 'a message stamped in the future is not a wait');
    eq((0, replyWait_1.replyWait)({ ...base, messages: [{ mine: true, createdAt: at(-72), delivered: true }] }).kind, 'silent', 'and a badly wrong clock does not become a three-day one');
}
{
    const r = (0, replyWait_1.replyWait)({ ...base, messages: [{ mine: true, createdAt: 'not a date', delivered: true }] });
    eq(r.kind, 'silent', 'a stamp that will not parse cannot be subtracted from a clock');
}
/* ── what is said, and what is refused ─────────────────────────────────── */
{
    // No watermark. src/ui/readReceipts.ts: null is what an unauthorised caller
    // AND a peer who has never opened the thread both get. The one sentence this
    // branch may not say is "they have not opened it".
    const r = (0, replyWait_1.replyWait)({ ...base, messages: [mine(50)] });
    eq(r.kind, 'sent', 'no watermark is not evidence of anything');
    const note = r.kind === 'silent' ? '' : r.note;
    ok(/2 days ago/.test(note), 'the wait is stated in whole days');
    ok(/cannot tell whether Dayne has opened it/.test(note), 'and the doubt is stated as doubt');
    ok(!/has not opened|hasn’t opened|ignored|no reply from/i.test(note), 'nothing here accuses the coach of anything');
    ok(note.includes(replyWait_1.COACH_QUEUE_NOTE), 'and the member is told the app has already noticed');
}
{
    // The watermark has passed my message. This IS a fact, and it is the case
    // the coach's own Unread chip structurally cannot show — opening the thread
    // is what removes it from that chip.
    const r = (0, replyWait_1.replyWait)({ ...base, messages: [mine(30)], peerReadAt: at(20) });
    eq(r.kind, 'seen', 'a watermark past my message means they have opened it');
    const note = r.kind === 'silent' ? '' : r.note;
    ok(/Dayne has opened it/.test(note), 'and it says so by name');
    ok(/1 day ago/.test(note), 'a single day is not "1 days"');
    ok(/Nothing has come back yet/.test(note), 'the absence is a fact, not a complaint');
}
{
    // The watermark predates my message: they opened the thread before I wrote.
    // That is not evidence they have seen this, and `deliveryOf` reads it the
    // same way — 'sent', never 'read'.
    const r = (0, replyWait_1.replyWait)({ ...base, messages: [mine(30)], peerReadAt: at(40) });
    eq(r.kind, 'sent', 'a watermark older than my message proves nothing about it');
}
{
    // `>=`, not `>`. The watermark is written as the newest message's own
    // created_at, so an exact tie is a read — otherwise the newest message is the
    // one message that could never show as seen.
    const exact = at(30);
    const r = (0, replyWait_1.replyWait)({ ...base, messages: [{ mine: true, createdAt: exact, delivered: true }], peerReadAt: exact });
    eq(r.kind, 'seen', 'a watermark exactly equal to the message is a read');
}
{
    const r = (0, replyWait_1.replyWait)({ ...base, messages: [mine(30)], peerReadAt: 'not a date' });
    eq(r.kind, 'sent', 'an unreadable watermark is not evidence of a read');
}
/* ── a truncated thread still knows who spoke last ─────────────────────── */
{
    // `useThread` reads created_at desc at the row cap, so a long relationship
    // arrives with its BEGINNING missing. Truncation can hide the first year of
    // a conversation; it cannot hide the last word in it.
    const r = (0, replyWait_1.replyWait)({ ...base, messages: [theirs(60), mine(50)], status: 'partial' });
    ok(r.kind !== 'silent', 'a capped thread still knows the end of itself');
}
/* ── the name, and the sentence that must not lose its subject ─────────── */
{
    const r = (0, replyWait_1.replyWait)({ ...base, messages: [mine(50)], them: 'Your coach' });
    const note = r.kind === 'silent' ? '' : r.note;
    ok(/whether Your coach has opened it/.test(note), 'an unnamed coach is described rather than dashed — see scripts/check-prose.mjs');
    ok(!note.includes('—'), 'and a sentence never takes an em dash as its subject');
}
/* ── the wait itself ───────────────────────────────────────────────────── */
{
    const r = (0, replyWait_1.replyWait)({ ...base, messages: [mine(74)] });
    eq(r.kind === 'silent' ? null : Math.round(r.waitedMs / HOUR), 74, 'the span is exposed so a caller can decide how loudly to draw it');
}
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('replyWait: ok — a member waiting on a reply is told how long, and that the app has noticed');
