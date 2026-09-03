"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOT_DELIVERED_MEANS = exports.DELIVERED_MEANS = void 0;
exports.canFinish = canFinish;
exports.finishBlockedNote = finishBlockedNote;
exports.finishCta = finishCta;
exports.finishReport = finishReport;
exports.loggedAgainstLine = loggedAgainstLine;
exports.fetchSessionLogCounts = fetchSessionLogCounts;
exports.loggedExercisesLine = loggedExercisesLine;
const sessionHistory_1 = require("./sessionHistory");
const floorQueue_1 = require("./floorQueue");
const cappedByIds_1 = require("./cappedByIds");
const rowCap_1 = require("./rowCap");
/**
 * Whether "Finish this session" belongs on this row.
 *
 * Four conditions and each of them removes a way of doing harm:
 *
 *   · somebody was BOOKED into it. An open slot that has gone by is not a
 *     session; offering to finish one would invent an hour of coaching.
 *   · its END has passed. `hasEnded` measures the end and not the start, so the
 *     hour a coach is standing in is not offered — marking an in-progress
 *     session delivered draws its credit before it has been earned.
 *   · nobody has marked it yet. A session with an outcome has been decided;
 *     re-marking it from here would re-run part 370's draw logic on a row that
 *     has already paid, and the place to CHANGE a decision is the queue that
 *     also offers the undo.
 *   · there is a client on it. There is nobody to log an hour against
 *     otherwise, and log-session refuses a save with no client for the same
 *     reason.
 */
function canFinish(row, now = Date.now()) {
    if (!row.clientId)
        return false;
    if (row.outcome != null && row.outcome !== '')
        return false;
    return (0, sessionHistory_1.wasBooked)(row) && (0, sessionHistory_1.hasEnded)(row, now);
}
/**
 * Why this session is not offered a finish, addressed to the coach — or null
 * when it is offered.
 *
 * Said rather than left to be inferred from a missing button. A coach looking
 * for the control on the one row that does not have it should not have to
 * guess which of four reasons applies.
 */
function finishBlockedNote(row, now = Date.now()) {
    if (canFinish(row, now))
        return null;
    if (row.outcome != null && row.outcome !== '') {
        return 'This session already has an outcome recorded, so it is not waiting to be finished. Change it from the list below if it is wrong.';
    }
    if (!row.clientId) {
        return 'Nobody is booked into this hour, so there is nothing to write up and nobody to write it against.';
    }
    if (!(0, sessionHistory_1.hasEnded)(row, now)) {
        return 'This session has not finished yet. It can be written up and closed once its time has passed.';
    }
    return 'This hour was never booked, so there is no session here to finish.';
}
/* ── 2 · what the coach is told BEFORE they press ─────────────────────────── */
/**
 * The sentence under the "mark it delivered" switch.
 *
 * It names the credit, which is the whole reason this is a labelled control
 * rather than a silent side effect of Save. See point 2 of the decision above:
 * supabase/parts/370 draws a session off the client's coach pack or gym pass at
 * the moment an outcome of 'completed' is written.
 *
 * "if they are on one" and not a flat claim: a client paying cash, or on a
 * membership that includes PT, holds nothing and nothing is drawn. Stating that
 * a credit WILL come off would be wrong for those clients, and this screen has
 * not read their balance and is in no position to say which they are.
 */
exports.DELIVERED_MEANS = 'Marking it delivered takes it off your Mark Sessions queue and counts it as delivered for pay. If this client is on a session pack or a gym pass, one session comes off it now.';
/** The same fact, for a coach who has turned the switch off. */
exports.NOT_DELIVERED_MEANS = 'The session stays on your Mark Sessions queue for you to decide later, and nothing comes off the client’s pack yet. What you type here is still saved to their record.';
/** The label on the button that does both. Title case, like every other CTA. */
function finishCta(markDelivered, hasSession) {
    if (!hasSession)
        return 'Save Session';
    return markDelivered ? 'Save and Finish Session' : 'Save Without Finishing';
}
/** "3 exercises" / "1 exercise". */
function exercises(n) {
    return `${n} exercise${n === 1 ? '' : 's'}`;
}
/**
 * The two answers, as two sentences.
 *
 * Every branch below is reachable and each one is a different thing to have
 * happened to a client's record. The rule the whole function is written to
 * hold: a sentence about the entries never mentions the session's state, and a
 * sentence about the session never implies anything about the entries.
 */
function finishReport(r) {
    const who = r.first?.trim() || 'your client';
    const lines = [];
    const logged = r.entries === 'stored';
    const closed = r.outcome === 'stored';
    /* the log */
    if (r.entries === 'stored') {
        lines.push(`${exercises(r.entryCount)} went into ${who}’s record, marked as logged by you. They will see it on their own phone and it counts towards their progress.`);
    }
    else if (r.entries === 'full') {
        // Nothing was kept, so the sets are still on this screen and nowhere else —
        // which is why `mayLeave` is false for this arm as it is for a refusal.
        lines.push((0, floorQueue_1.floorFullLine)('This session'));
    }
    else if (r.entries === 'refused') {
        lines.push((0, floorQueue_1.refusedLine)('This session', 
        // Two causes, and with a session in hand the second one is new: part 890
        // refuses training filed against a session that is not this person's, or
        // not this coach's to file against. Naming only the roster would send a
        // coach to check a book that is already right.
        r.refusalCause
            ?? 'Two things cause this: the person is not on your roster, or this session is not yours to file training against. If they are on your book, open their record before typing this in again — part of it may have reached them.'));
    }
    else {
        // The queue's own sentence, verbatim, with the same subject
        // app/(trainer)/log-session.tsx has always used. Not "3 exercises are
        // saved on this phone": the count is what was OFFERED, and a sentence that
        // counts a write nobody answered reads as a receipt for it.
        lines.push((0, floorQueue_1.keptOfflineLine)('This session'));
    }
    /* the session */
    switch (r.outcome) {
        case 'stored':
            lines.push('This session is now marked as delivered, so it is off your Mark Sessions queue.');
            break;
        case 'refused':
            lines.push('The session was NOT marked as delivered, and that mark is not waiting to send — the server read it and declined. It may no longer be yours to mark. It is still on your Mark Sessions screen.');
            break;
        case 'unsent':
            lines.push('The delivered mark is on this phone and has not reached the server, so to everybody else this session is still waiting on an outcome. It goes up next time this app has signal.');
            break;
        case 'not-attempted':
            lines.push('The session has NOT been marked as delivered, so no session credit has been taken off this client. Nothing about the session has changed.');
            break;
        case 'not-asked':
            // Only worth a sentence when there was a session to leave open. With no
            // session in hand there is nothing to say and nothing was expected.
            break;
    }
    const title = (r.entries === 'refused' || r.entries === 'full')
        ? 'Not saved'
        : r.entries === 'unsent'
            ? 'Kept on this phone'
            : closed
                ? 'Session finished'
                : r.outcome === 'not-asked'
                    ? 'Session logged'
                    : 'Logged, but not marked delivered';
    // A coach may not walk away from sets that exist only on this screen. That is
    // true of a refusal and equally true of a queue that would not keep them.
    return { title, lines, logged, closed, mayLeave: r.entries !== 'refused' && r.entries !== 'full' };
}
/* ── 4 · what was logged, read back against the session ───────────────────── */
/**
 * The line under a past session saying what was written up in it.
 *
 * Loading, failed and empty are three different sentences, and the failed one
 * is the one that matters: a session whose entries could not be read is not a
 * session nothing was logged in. A coach who reads "nothing was logged" about
 * an hour they wrote up goes and types it a second time, and their client ends
 * up with the same hour of training twice.
 */
function loggedAgainstLine(status, count) {
    switch (status) {
        case 'loading':
            return 'Reading what was logged in this session…';
        case 'error':
            return 'What was logged in this session could not be read, so this is not a session with nothing in it. Try again when you have signal.';
        case 'partial':
            return count == null
                ? 'More was logged in this session than fitted in one read, so how much is not established.'
                : `More was logged in this session than fitted in one read, so this is at least ${exercises(count)} and not necessarily all of them.`;
        case 'ready':
            if (count == null)
                return 'What was logged in this session is not established.';
            return count === 0
                ? 'Nothing is filed against this session. Anything written up separately is in the client’s own record and is not joined to this hour.'
                : `${exercises(count)} logged in this session.`;
    }
}
/**
 * How many logged exercises name each of these sessions.
 *
 * Read through `workouts`, which a coach may select for their own clients under
 * `workouts_coach_read` (`is_my_client(user_id)`), and which a client may
 * select for themselves. RLS therefore decides what is counted, and this
 * function does not re-implement it.
 *
 * A failure returns 'error' with an empty map rather than throwing: this is a
 * label under a row on a screen whose subject is payroll, and blacking out a
 * working marking queue because a count could not be read would take away the
 * thing the coach came for. `loggedAgainstLine` is what stops the empty map
 * being rendered as "nothing was logged".
 *
 * ── Why the id list is chunked ─────────────────────────────────────────────
 *
 * `sessionIds` is one id per row on the Mark Sessions screen, and that read is
 * `capLimit()`-bounded — so up to a thousand ids arrive here. A uuid costs
 * about 39 bytes inside a PostgREST `in.("…","…")` list, so a thousand of them
 * is a ~39KB request line against the 8KB nginx and most CDNs enforce by
 * default. Past roughly two hundred ids the proxy refuses the query before the
 * database ever sees it, the refusal is a **414**, supabase-js does not reject
 * on it, and it arrives as `data: null`.
 *
 * `data: null` with no error is the same shape as "nothing is logged against
 * any of these sessions". So a coach at the end of a busy month opened their
 * marking queue and every single session on it read "Nothing is filed against
 * this session" — a sentence about an hour they ran and wrote up, on the screen
 * they use to decide whether it was delivered, with no error anywhere and
 * nothing to pull to refresh into working. `cap` was arguing about the ROW
 * ceiling, which it gets right; the request line is the other limit and nothing
 * was arguing about it at all.
 *
 * `readCappedByIds` and not `readByIds`: the 400-row cap is a deliberate
 * product decision — this is a label under a row, `partial` is a sentence the
 * screen can say, and walking every `workouts` row a thousand sessions have
 * ever collected to write it would make a screen that works slowly wrong. The
 * cap now applies per chunk, which is strictly more rows than before and never
 * fewer, and `truncated` is still carried rather than assumed away.
 */
async function fetchSessionLogCounts(sb, sessionIds, cap = 400) {
    const empty = (status) => ({ status, bySession: new Map(), namesBySession: new Map() });
    const { rows, truncated, error } = await (0, cappedByIds_1.readCappedByIds)(sessionIds, (chunk) => sb
        .from('workouts')
        .select('id, session_id, exercise, performed_at')
        .in('session_id', chunk)
        // `.order('id')` behind `performed_at` so the rows the cap CUTS are the
        // same ones every time. Two movements logged in the same second are two
        // rows Postgres may return in either order, and at the boundary that
        // decides which of them a coach is shown.
        .order('performed_at', { ascending: true })
        .order('id', { ascending: true })
        .limit((0, rowCap_1.capLimit)(cap)), { cap });
    if (error)
        return empty('error');
    const bySession = new Map();
    const namesBySession = new Map();
    for (const row of rows) {
        const id = row.session_id;
        if (!id)
            continue;
        bySession.set(id, (bySession.get(id) ?? 0) + 1);
        const name = row.exercise?.trim();
        if (!name)
            continue;
        const seen = namesBySession.get(id);
        if (!seen)
            namesBySession.set(id, [name]);
        else if (!seen.includes(name))
            seen.push(name);
    }
    return { status: truncated ? 'partial' : 'ready', bySession, namesBySession };
}
/**
 * The movements done in a session, as a phrase — or null when there is nothing
 * to name.
 *
 * Capped at three, because this is a line under a row on a list and a coach who
 * ran twelve movements does not want twelve on it. The tail says how many more
 * rather than trailing off, so the phrase is never mistaken for the whole
 * session. Null rather than an empty string for an empty list: the caller
 * withholds the line instead of rendering a sentence with nothing in it.
 */
function loggedExercisesLine(names, shown = 3) {
    const list = names.map((n) => n.trim()).filter(Boolean);
    if (!list.length)
        return null;
    if (list.length <= shown) {
        return list.length === 1
            ? `${list[0]}.`
            : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}.`;
    }
    const rest = list.length - shown;
    return `${list.slice(0, shown).join(', ')} and ${rest} more.`;
}
