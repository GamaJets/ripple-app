"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WAITING_TITLE = exports.WAITING_HOURS = void 0;
exports.waitingOn = waitingOn;
exports.waitedLabel = waitedLabel;
exports.waitingLine = waitingLine;
exports.hasWaiting = hasWaiting;
exports.waitingCountNote = waitingCountNote;
exports.waitingNote = waitingNote;
const loadStatus_1 = require("../ui/loadStatus");
/**
 * How long a client's last word has to have stood before it is a queue item.
 *
 * One full day, for the reason in the header: shorter and this becomes a list
 * of messages nobody could have answered yet, which is how a queue teaches the
 * person reading it to stop opening it.
 */
exports.WAITING_HOURS = 24;
const HOUR = 3600000;
const DAY = 86400000;
/** Milliseconds since an ISO instant, or null when it is not one. */
function stood(iso, now) {
    if (!iso)
        return null;
    const t = Date.parse(iso);
    if (!Number.isFinite(t) || !Number.isFinite(now))
        return null;
    return now - t;
}
/**
 * The queue.
 *
 * `status` never changes WHICH rows are listed — the threads that came back are
 * real whatever else did not, and hiding them would be hiding the people who
 * are actually waiting. It decides only what may be SAID about the list: see
 * `withheld`, and `waitingHeading`, which withholds the count rather than
 * stating a total over part of a book.
 */
function waitingOn(rows, now, status) {
    const out = [];
    let unsure = 0;
    const floor = exports.WAITING_HOURS * HOUR;
    for (const t of rows) {
        // Not a candidate at all, and not an uncertainty either: the coach wrote
        // last, and nobody is waiting on the coach for that.
        if (t.lastSender === 'coach')
            continue;
        if (t.lastSender !== 'client') {
            // Null. Either the thread is empty — in which case the screen has already
            // put it under "Message Someone Else" and it is not in this list — or the
            // column came back as something this build does not know. Neither can be
            // read as "the coach spoke last", so it is counted.
            unsure += 1;
            continue;
        }
        const waited = stood(t.lastAt, now);
        if (waited === null) {
            // A client's message with no readable date on it. It cannot be described
            // as having waited three days, and it must not be silently discarded.
            unsure += 1;
            continue;
        }
        // A clock skew that puts the message in the future is not a wait. Same
        // handling as `threadWhen`, which prints 'now' rather than '-3m'.
        if (waited < floor)
            continue;
        out.push({
            thread: t,
            waitedMs: waited,
            opened: t.unread === null ? 'unknown' : t.unread > 0 ? 'no' : 'yes',
        });
    }
    out.sort((a, b) => (b.waitedMs - a.waitedMs)
        || (a.thread.clientId < b.thread.clientId ? -1 : a.thread.clientId > b.thread.clientId ? 1 : 0));
    return { rows: out, unsure, withheld: withheldFor(status) };
}
/** Why the list below may not be all of it. Null under a whole read. */
function withheldFor(status) {
    switch (status) {
        case 'ready':
            return null;
        case 'loading':
            return 'Still reading your conversations, so this covers only the threads that have arrived so far.';
        case 'partial':
            return 'Your book came back short, so this is drawn from the threads that arrived and not from all of them. Somebody may be waiting who is not here.';
        case 'error':
            return 'Your conversations could not be read, so this is not a list of who is waiting on you — it is what we had before the read failed.';
    }
}
/**
 * The wait, in the largest whole unit that is still true.
 *
 * Whole units only. "1.5 days" is arithmetic somebody has to undo, and a
 * rounded figure in a sentence about how long a person has been ignored is the
 * one place a half is not worth the precision.
 */
function waitedLabel(ms) {
    if (!Number.isFinite(ms) || ms < 0)
        return 'some time';
    const days = Math.floor(ms / DAY);
    if (days >= 1)
        return days === 1 ? '1 day' : `${days} days`;
    const hours = Math.floor(ms / HOUR);
    if (hours >= 1)
        return hours === 1 ? '1 hour' : `${hours} hours`;
    return 'under an hour';
}
/**
 * The line under one row. Two facts and no accusation — see the header.
 *
 * The subject is always the client and the verb is always something they did.
 * Nothing here says the coach failed to do anything, because the list cannot
 * tell a question from a thank-you and the coach can.
 */
function waitingLine(w) {
    const ago = waitedLabel(w.waitedMs);
    switch (w.opened) {
        case 'no':
            return `They wrote ${ago} ago and it is still unopened.`;
        case 'yes':
            // The one this whole module exists for. The Unread chip cannot show it,
            // because opening the thread is what took it off the chip.
            return `They wrote ${ago} ago. You have opened it and the last word is still theirs.`;
        case 'unknown':
            return `They wrote ${ago} ago. Whether you have opened it could not be read.`;
    }
}
/** The section's title. Constant, in the Title Case its siblings on that screen
 *  are in — the count is the head's NOTE, which is where that screen already
 *  puts "3 of 12" and "Most recent first". */
exports.WAITING_TITLE = 'Waiting on a Reply';
/**
 * Whether the section is drawn at all.
 *
 * False when there is nothing waiting AND nothing uncertain: a coach who has
 * answered everybody should not be shown a section congratulating them on it
 * every morning. The absence is the message — same rule as `gapsHeading` in
 * src/lib/registerGaps.ts.
 */
function hasWaiting(book) {
    return book.rows.length > 0 || book.unsure > 0;
}
/**
 * The count beside the title, or null when no count may be stated.
 *
 * A NUMBER only under a whole read. Under 'partial' the rows are real and a
 * count over them is a subtotal, and "3 clients" printed over four fifths of a
 * book is the confident figure src/ui/loadStatus.ts exists to refuse. The head
 * loses its note; `waitingNote` carries the doubt in words.
 */
function waitingCountNote(book, status) {
    if (!(0, loadStatus_1.isWhole)(status))
        return null;
    const n = book.rows.length;
    if (n === 0)
        return null;
    return n === 1 ? '1 client' : `${n} clients`;
}
/**
 * The sentence under the heading, or null when there is nothing to add.
 *
 * It carries `withheld` first, because a doubt about the whole list comes
 * before a detail about part of it, and then the uncertain rows — which are
 * the reason this list is not a complete answer even when the read was.
 */
function waitingNote(book) {
    const parts = [];
    if (book.withheld)
        parts.push(book.withheld);
    if (book.unsure > 0) {
        parts.push(book.unsure === 1
            ? 'One more conversation could not say who spoke last, or when, so it is not on this list either way.'
            : `${book.unsure} more conversations could not say who spoke last, or when, so they are not on this list either way.`);
    }
    if (parts.length === 0 && book.rows.length > 0) {
        // Said once, under the list, and it is the honest description of what the
        // rows are. A coach who reads this as a list of failures will stop opening
        // it the first time a "thanks" appears on it.
        parts.push(`These are the conversations where your client spoke last and it has been at least ${exports.WAITING_HOURS} hours. Some of them will be a thank-you — this list can tell who wrote last, not who is owed an answer.`);
    }
    return parts.length ? parts.join(' ') : null;
}
