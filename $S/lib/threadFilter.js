"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_THREAD_FILTER = void 0;
exports.threadFilterActive = threadFilterActive;
exports.keptWhenUnread = keptWhenUnread;
exports.filterThreads = filterThreads;
exports.withheldNames = withheldNames;
exports.unknownUnread = unknownUnread;
exports.knownUnread = knownUnread;
exports.unreadChipLabel = unreadChipLabel;
exports.threadFilterLine = threadFilterLine;
const rosterSearch_1 = require("./rosterSearch");
/** The screen's starting state, and what Clear returns it to. */
exports.NO_THREAD_FILTER = { mode: 'all', query: '' };
/** Whether anything is being narrowed. A field nobody has typed in and a chip
 *  nobody has pressed are not a filter, and the screen owes no explanation for
 *  a list it has not touched. */
function threadFilterActive(f) {
    return f.mode !== 'all' || f.query.trim().length > 0;
}
/**
 * Does this row survive the unread chip?
 *
 * Exported because it is the single decision the null turns on, and a test that
 * can name it is worth more than four tests that reach it through `filterThreads`.
 *
 *   a positive count   yes — somebody is waiting
 *   zero               no  — the count came back and nobody is waiting
 *   null               YES — we do not know, and hiding it would answer for it
 */
function keptWhenUnread(t) {
    return t.unread === null || t.unread > 0;
}
/**
 * The rows to draw.
 *
 * The ORDER is the caller's and is never re-ranked. `sortThreads` decides it —
 * most recent first, deliberately not unread first, for reasons its own header
 * sets out — and a filter that quietly re-sorted would move the row under the
 * coach's thumb between one render and the next.
 */
function filterThreads(rows, f) {
    const q = f.query.trim();
    return rows.filter((t) => {
        if (f.mode === 'unread' && !keptWhenUnread(t))
            return false;
        if (!q)
            return true;
        // A row with no readable name cannot answer a name query. It is counted by
        // `withheldNames` below and spoken about, never dropped in silence.
        return t.name !== null && (0, rosterSearch_1.matchesRosterQuery)(t.name, q);
    });
}
/** How many of these rows have a name that did not come back, and so can never
 *  match anything typed. */
function withheldNames(rows) {
    return rows.reduce((n, t) => n + (t.name === null ? 1 : 0), 0);
}
/** How many of these rows are being kept only because their unread count could
 *  not be read. Zero under the 'all' mode, where nothing is being kept for a
 *  reason that needs explaining. */
function unknownUnread(rows) {
    return rows.reduce((n, t) => n + (t.unread === null ? 1 : 0), 0);
}
/** How many of these rows have something unopened in them, on a count that
 *  actually came back. A row whose count is null is in neither this nor its
 *  complement — it is in `unknownUnread`, and that is the point. */
function knownUnread(rows) {
    return rows.reduce((n, t) => n + (t.unread !== null && t.unread > 0 ? 1 : 0), 0);
}
/**
 * The label on the unread chip.
 *
 * `null` for the count means the whole read is incomplete enough that a figure
 * on the chip would be a claim — so the chip says what it does rather than how
 * many, and the sentence under the list carries the doubt.
 *
 * Note what this never says: it never prints 0. A chip reading "Unread · 0"
 * over a read that half-failed is the confident zero this screen exists to
 * refuse; where the count is knowable and zero the caller has nothing to filter
 * to and the sentence below says so in words.
 */
function unreadChipLabel(known, anyUnknown) {
    if (anyUnknown)
        return 'Unread';
    return known > 0 ? `Unread · ${known}` : 'Unread';
}
/**
 * The one sentence a narrowed list owes the coach, or null when there is
 * nothing to say.
 *
 * `matched` is what is on screen. `searched` is how many rows the filter
 * actually ran over — what LOADED, which under anything but 'ready' is not the
 * coach's book. `unknown` is how many of the matched rows are there only
 * because their unread count could not be read, and `withheld` how many rows a
 * name query could never have matched.
 *
 * The order of the branches is the order of the harm. A read that failed is
 * said first and alone, because every other clause would be a detail about a
 * list that is not the answer.
 */
function threadFilterLine(o) {
    if (!threadFilterActive(o.filter))
        return null;
    const q = o.filter.query.trim();
    const parts = [];
    switch (o.status) {
        case 'error':
            // Said alone. Every other clause below is a detail about a list that is
            // not the answer, and a coach who reads three sentences takes the last
            // one for the summary.
            return q
                ? `Your conversations could not be read, so nothing was searched. Not finding “${q}” here does not mean they are not on your book.`
                : 'Your conversations could not be read, so nothing was filtered. This is not a list of who is waiting on you.';
        case 'loading':
            parts.push('Still reading your conversations, so this covers only the threads that have arrived so far.');
            break;
        case 'partial':
            // Said whether or not anything matched, for the reason rosterSearch gives:
            // a coach who finds one Sarah in a book that came back short has no way of
            // knowing there is a second one past the cap.
            parts.push(`Your book came back short, so this looked at the ${o.searched} thread${o.searched === 1 ? '' : 's'} that arrived and not at the rest of it.`);
            break;
        case 'ready':
            // The only status allowed to state an absence.
            if (o.matched === 0)
                parts.push(emptySentence(o.filter));
            break;
    }
    // The rows kept because nothing is known about them. Said under every status,
    // because it is the reason a row is on screen and the coach is entitled to
    // know a listed thread may hold nothing at all.
    if (o.filter.mode === 'unread' && o.unknown > 0) {
        parts.push(o.unknown === 1
            ? 'One of these is listed because its unread count could not be read, not because there is anything unopened in it.'
            : `${o.unknown} of these are listed because their unread counts could not be read, not because there is anything unopened in them.`);
    }
    // Rows a name query could never have matched. Without this they are simply
    // absent, which reads as "not on your book".
    if (q && o.withheld > 0) {
        parts.push(o.withheld === 1
            ? 'One more thread could not be searched, because that client’s name did not come back.'
            : `${o.withheld} more threads could not be searched, because those clients’ names did not come back.`);
    }
    return parts.length ? parts.join(' ') : null;
}
/**
 * What an empty filtered list says, under 'ready' and under nothing else.
 *
 * Three sentences rather than one, because "nothing here" over a name search
 * and over the unread chip are claims about different things — the first about
 * the coach's book, the second about their inbox — and a coach acts on them
 * differently.
 */
function emptySentence(f) {
    const q = f.query.trim();
    if (q && f.mode === 'unread')
        return `Nobody matching “${q}” has an unopened message.`;
    if (q)
        return `Nobody on your book matches “${q}”.`;
    return 'Nothing is unopened. Every message your clients have sent you has been opened.';
}
