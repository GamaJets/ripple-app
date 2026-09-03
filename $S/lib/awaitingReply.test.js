"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Who spoke last, and how long ago. Compile with tsc, run with node.
//
// Every mistake this module can make renders as a short, tidy, plausible list,
// and each of the four is wrong in a different direction:
//
//   · a thread DROPPED is a client the coach is told nobody is waiting on. That
//     is the only silent-and-dangerous direction, so a row whose sender or
//     timestamp cannot be read is counted (`unsure`) rather than discarded, and
//     it is asserted for twice.
//   · a thread ADDED too early — the message sent ninety minutes ago — is a
//     queue item nobody could have cleared, and a queue full of those is one a
//     coach stops opening.
//   · the coach's OWN last word appearing here reverses the whole meaning of
//     the section.
//   · a count stated over half a book is the confident subtotal
//     src/ui/loadStatus.ts exists to refuse, and it is the figure a coach would
//     read as "that's everybody".
//
// The three `opened` sentences are asserted apart because collapsing any two of
// them is a claim: 'unknown' must never borrow the words of 'yes' or 'no'.
const awaitingReply_1 = require("./awaitingReply");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const HOUR = 3600000;
const DAY = 86400000;
/** A fixed instant, stated by the test rather than raced against a real clock. */
const NOW = Date.parse('2026-09-03T18:00:00.000Z');
function thread(p) {
    return {
        name: 'Priya', avatar: null, lastBody: 'can we move to 7?',
        lastSender: 'client', lastKind: null,
        lastAt: new Date(NOW - 3 * DAY).toISOString(), unread: 0,
        ...p,
    };
}
/* ── 1. whose turn it is ──────────────────────────────────────────────────*/
{
    const book = (0, awaitingReply_1.waitingOn)([
        thread({ clientId: 'client-spoke' }),
        thread({ clientId: 'coach-spoke', lastSender: 'coach' }),
    ], NOW, 'ready');
    eq(book.rows.length, 1, 'only the thread whose last word is the client’s is a queue item');
    eq(book.rows[0]?.thread.clientId, 'client-spoke', 'and it is that one');
    eq(book.unsure, 0, 'a coach who spoke last is not an uncertainty — it is a clear no');
}
/* ── 2. the threshold, which is what makes this a queue and not a nag ─────*/
{
    const rows = [
        thread({ clientId: 'minutes', lastAt: new Date(NOW - 90 * 60000).toISOString() }),
        thread({ clientId: 'just-under', lastAt: new Date(NOW - (awaitingReply_1.WAITING_HOURS * HOUR - 1)).toISOString() }),
        thread({ clientId: 'exactly', lastAt: new Date(NOW - awaitingReply_1.WAITING_HOURS * HOUR).toISOString() }),
    ];
    const ids = (0, awaitingReply_1.waitingOn)(rows, NOW, 'ready').rows.map((r) => r.thread.clientId);
    ok(!ids.includes('minutes'), 'a message sent ninety minutes ago is not a neglected one');
    ok(!ids.includes('just-under'), 'nor is one a millisecond short of the threshold');
    ok(ids.includes('exactly'), 'the threshold itself counts — a boundary that excluded its own value would drop a real one every day');
}
{
    // Clock skew. `threadWhen` prints 'now' rather than '-3m' for the same input,
    // and a negative wait must not sort to the top of a queue ordered by wait.
    const book = (0, awaitingReply_1.waitingOn)([
        thread({ clientId: 'future', lastAt: new Date(NOW + 5 * DAY).toISOString() }),
    ], NOW, 'ready');
    eq(book.rows.length, 0, 'a message dated in the future has not been waiting for anybody');
    eq(book.unsure, 0, 'and it is a readable date, so it is not an uncertainty either');
}
/* ── 3. nothing is dropped in silence ─────────────────────────────────────*/
{
    const book = (0, awaitingReply_1.waitingOn)([
        thread({ clientId: 'no-date', lastAt: null }),
        thread({ clientId: 'bad-date', lastAt: 'the day before yesterday' }),
        thread({ clientId: 'no-sender', lastSender: null }),
        thread({ clientId: 'real' }),
    ], NOW, 'ready');
    eq(book.rows.length, 1, 'only the one that can be described is listed');
    eq(book.unsure, 3, 'and the three that cannot are COUNTED — a dropped row reads as nobody waiting');
    ok((0, awaitingReply_1.waitingNote)(book).includes('3 more conversations'), 'and the count is said out loud rather than left as a shorter list');
    ok((0, awaitingReply_1.hasWaiting)((0, awaitingReply_1.waitingOn)([thread({ clientId: 'x', lastSender: null })], NOW, 'ready')), 'a book with nothing listed but something uncertain is still drawn — the uncertainty is the message');
}
{
    eq((0, awaitingReply_1.hasWaiting)((0, awaitingReply_1.waitingOn)([thread({ clientId: 'a', lastSender: 'coach' })], NOW, 'ready')), false, 'a coach who has answered everybody is shown no section at all, not one congratulating them');
    eq((0, awaitingReply_1.waitingCountNote)((0, awaitingReply_1.waitingOn)([], NOW, 'ready'), 'ready'), null, 'and no count over an empty list');
}
/* ── 4. the order is the wait, and it is total ────────────────────────────*/
{
    const ids = (0, awaitingReply_1.waitingOn)([
        thread({ clientId: 'b', lastAt: new Date(NOW - 2 * DAY).toISOString() }),
        thread({ clientId: 'oldest', lastAt: new Date(NOW - 9 * DAY).toISOString() }),
        thread({ clientId: 'a', lastAt: new Date(NOW - 2 * DAY).toISOString() }),
    ], NOW, 'ready').rows.map((r) => r.thread.clientId);
    eq(ids[0], 'oldest', 'the longest wait is first — this is a queue, not a scan');
    eq(ids.join(','), 'oldest,a,b', 'and two clients who wrote in the same minute break on the id, so the list does not reshuffle between renders');
}
/* ── 5. three states of "have you even seen it", kept apart ───────────────*/
{
    const at = new Date(NOW - 3 * DAY).toISOString();
    const of = (unread) => (0, awaitingReply_1.waitingOn)([thread({ clientId: 'x', lastAt: at, unread })], NOW, 'ready').rows[0];
    eq(of(2)?.opened, 'no', 'a positive unread count is a message the coach has not opened');
    eq(of(0)?.opened, 'yes', 'a zero that came back is one they have');
    eq(of(null)?.opened, 'unknown', 'and a count that did not come back is neither — never "seen"');
    eq((0, awaitingReply_1.waitingLine)(of(2)), 'They wrote 3 days ago and it is still unopened.', 'the unopened sentence');
    eq((0, awaitingReply_1.waitingLine)(of(0)), 'They wrote 3 days ago. You have opened it and the last word is still theirs.', 'the sentence the Unread chip structurally cannot show, because opening it is what clears the chip');
    eq((0, awaitingReply_1.waitingLine)(of(null)), 'They wrote 3 days ago. Whether you have opened it could not be read.', 'and the unknown says it is unknown rather than borrowing either of the other two');
}
{
    // The wording is a fact about the client and never an accusation about the
    // coach — the whole defence of a list that cannot tell a question from a
    // thank-you. See the module header.
    const w = (0, awaitingReply_1.waitingOn)([thread({ clientId: 'x' })], NOW, 'ready').rows[0];
    for (const banned of ['you have not', 'failed', 'ignored', 'owe', 'overdue']) {
        ok(!(0, awaitingReply_1.waitingLine)(w).toLowerCase().includes(banned), `no row may accuse the coach — "${banned}" has no place in a line that also lands on a thank-you`);
    }
    ok((0, awaitingReply_1.waitingNote)((0, awaitingReply_1.waitingOn)([thread({ clientId: 'x' })], NOW, 'ready')).includes('thank-you'), 'and the note says so in as many words, once, under the list');
}
/* ── 6. the wait, in whole units ──────────────────────────────────────────*/
{
    eq((0, awaitingReply_1.waitedLabel)(DAY), '1 day', 'one day is not "1 days"');
    eq((0, awaitingReply_1.waitedLabel)(3 * DAY), '3 days', 'and three are');
    eq((0, awaitingReply_1.waitedLabel)(3 * DAY + 23 * HOUR), '3 days', 'a wait is floored — never rounded up into a day nobody waited');
    eq((0, awaitingReply_1.waitedLabel)(HOUR), '1 hour', 'one hour is not "1 hours"');
    eq((0, awaitingReply_1.waitedLabel)(5 * HOUR), '5 hours', 'and five are');
    eq((0, awaitingReply_1.waitedLabel)(60000), 'under an hour', 'a minute is said in words rather than as "0 hours"');
    eq((0, awaitingReply_1.waitedLabel)(-1), 'some time', 'and a negative wait is not "-1 days"');
    eq((0, awaitingReply_1.waitedLabel)(NaN), 'some time', 'nor is an unreadable one');
}
/* ── 7. what may be counted, and under which read ─────────────────────────*/
{
    const rows = [
        thread({ clientId: 'a' }), thread({ clientId: 'b' }), thread({ clientId: 'c' }),
    ];
    eq((0, awaitingReply_1.waitingCountNote)((0, awaitingReply_1.waitingOn)(rows, NOW, 'ready'), 'ready'), '3 clients', 'a whole read may state the figure');
    eq((0, awaitingReply_1.waitingCountNote)((0, awaitingReply_1.waitingOn)(rows, NOW, 'partial'), 'partial'), null, 'a truncated one may not — a subtotal here reads as "that is everybody"');
    eq((0, awaitingReply_1.waitingCountNote)((0, awaitingReply_1.waitingOn)(rows, NOW, 'error'), 'error'), null, 'and neither may a failed one');
    eq((0, awaitingReply_1.waitingCountNote)((0, awaitingReply_1.waitingOn)(rows, NOW, 'loading'), 'loading'), null, 'nor one still in flight');
    eq((0, awaitingReply_1.waitingCountNote)((0, awaitingReply_1.waitingOn)([thread({ clientId: 'one' })], NOW, 'ready'), 'ready'), '1 client', 'one client is not "1 clients"');
}
{
    // The rows themselves are never withheld: they are real threads and the
    // people on them are really waiting, whatever else did not come back.
    const rows = [thread({ clientId: 'a' }), thread({ clientId: 'b' })];
    for (const s of ['ready', 'partial', 'error', 'loading']) {
        eq((0, awaitingReply_1.waitingOn)(rows, NOW, s).rows.length, 2, `a ${s} read still lists the threads that arrived — hiding them hides who is waiting`);
    }
    eq((0, awaitingReply_1.waitingOn)(rows, NOW, 'ready').withheld, null, 'a whole read has nothing to withhold');
    ok((0, awaitingReply_1.waitingOn)(rows, NOW, 'error').withheld.includes('could not be read'), 'a failed one says so, and does not let the list stand as an answer');
    ok((0, awaitingReply_1.waitingOn)(rows, NOW, 'partial').withheld.includes('came back short'), 'and a truncated one names the truncation rather than the failure');
}
{
    // Order of the sentence: the doubt about the whole list comes before a detail
    // about part of it.
    const note = (0, awaitingReply_1.waitingNote)((0, awaitingReply_1.waitingOn)([
        thread({ clientId: 'a' }), thread({ clientId: 'b', lastSender: null }),
    ], NOW, 'partial'));
    ok(note.indexOf('came back short') < note.indexOf('could not say who spoke last'), 'the read is doubted first; the uncertain row is a detail about a list that is already not the answer');
}
/* ── 8. the constants a screen leans on ───────────────────────────────────*/
{
    eq(awaitingReply_1.WAITING_HOURS, 24, 'a whole day — shorter and this is a list of messages nobody could have answered');
    eq(awaitingReply_1.WAITING_TITLE, 'Waiting on a Reply', 'the title its siblings on that screen are cased like');
    ok(!awaitingReply_1.WAITING_TITLE.toLowerCase().includes('unanswered'), 'the word the data cannot support — src/lib/threadFilter.ts turned it down for a reason that still holds');
}
console.log(errors.length ? 'AWAITING REPLY FAILURES:\n' + errors.join('\n') : 'awaitingReply: ok — nobody waiting is dropped, nobody who just wrote is nagged, and no count is stated over half a book');
if (errors.length)
    process.exit(1);
