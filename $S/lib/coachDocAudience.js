"use strict";
// Who a coach's document is actually in front of.
//
// ── What this is for ──────────────────────────────────────────────────────
//
// Part 135 gave a coach paperwork with exactly one audience: everybody they
// coach. Part 156 adds `coach_document_recipients`, and with it the distinction
// this file exists to keep straight:
//
//   OPEN       no recipient rows. Every current client can read it. This is
//              what every document uploaded before part 156 means, and what a
//              newly uploaded one still means until somebody is named.
//   ADDRESSED  one or more rows. Only those people can read it, and only they
//              can accept it.
//
// The consequence a coach has to be told about BEFORE they tap, not after, is
// that the first send NARROWS a document. Send a studio waiver to one person
// and it stops being the studio waiver — it becomes theirs, and everybody else
// who had not already accepted it loses sight of it. `sendWarning` is that
// sentence and the test asserts it says so, for the same reason
// src/lib/coachDocs.ts holds part 135's wording: a promise about what the
// database does belongs beside the code that will be measured against it.
//
// ── The rule about an empty list ──────────────────────────────────────────
//
// Every count here takes rows that were actually read. A failed read is not
// "nobody has it": under `error` the screen must say the audience could not be
// read, and `audienceLine` returns null for a null list so there is no sentence
// to accidentally render. That is the LoadStatus rule this repo keeps relearning
// — an empty list under 'error' must never draw as "there are none".
//
// ── What is NOT here ──────────────────────────────────────────────────────
//
// Nothing in this direction reads anything of the client's. A coach sending a
// document is a coach → client action; the injury document a client uploads
// stays with the client and only the extracted injury reaches the coach (parts
// 91 and 96). No function in this file names that, and none should.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEND_IS_ONE_WAY = exports.AUDIENCE_ROW_CAP = void 0;
exports.shapeAudience = shapeAudience;
exports.isAddressed = isAddressed;
exports.sentCount = sentCount;
exports.acceptedCount = acceptedCount;
exports.audienceLine = audienceLine;
exports.sendWarning = sendWarning;
exports.sendBlock = sendBlock;
exports.sendBlockLine = sendBlockLine;
exports.sendFailure = sendFailure;
exports.sendFailureLine = sendFailureLine;
exports.memberLine = memberLine;
/** A row of `coach_document_audience()`, as PostgREST hands it over. */
/**
 * The ceiling `coach_document_audience()` takes, mirrored here for the same
 * reason as STANDING_ROW_CAP in src/lib/coachDocs.ts and with more riding on
 * it.
 *
 * `limit 500` inside the function body
 * (supabase/parts/156-a-document-meant-for-one-client.sql), where
 * src/lib/rowCap.ts cannot reach — the call site asks for 1001 rows from a
 * function that will never return more than 500, so `capped()` has been
 * reporting a full page as the whole audience.
 *
 * This is the read `audienceLine` counts and `sendBlock` judges, and the picker
 * under it performs a send that cannot be undone (SEND_IS_ONE_WAY). A coach at
 * a gym past five hundred, reading "9 of 500 have been sent this" over a list
 * that is really a prefix, is deciding who still needs the agreement from a
 * list missing the people who do.
 */
exports.AUDIENCE_ROW_CAP = 500;
function shapeAudience(rows) {
    if (!rows || !rows.length)
        return [];
    return rows
        .map((r) => ({
        clientId: String(r.client_id),
        name: typeof r.client_name === 'string' && r.client_name.trim() ? r.client_name.trim() : null,
        sentAt: r.sent_at ? String(r.sent_at) : null,
        acceptedAt: r.accepted_at ? String(r.accepted_at) : null,
    }))
        // The people this has NOT been sent to first, because the reason a coach
        // opened this panel is to send it to one of them. Then by name, with the
        // unnamed last rather than sorted under an empty string.
        .sort((a, b) => Number(a.sentAt != null) - Number(b.sentAt != null)
        || Number(a.name == null) - Number(b.name == null)
        || (a.name ?? '').localeCompare(b.name ?? '')
        || a.clientId.localeCompare(b.clientId));
}
/** Whether this document names anybody at all. False means it is open to the
 *  whole roster, which is what an unsent document means. */
function isAddressed(members) {
    return members.some((m) => m.sentAt != null);
}
function sentCount(members) {
    return members.filter((m) => m.sentAt != null).length;
}
function acceptedCount(members) {
    return members.filter((m) => m.acceptedAt != null).length;
}
/**
 * Who can currently read this document, in one sentence.
 *
 * Null when there is nothing truthful to say: a null list is a read that did
 * not happen, and a roster of nobody is not a fact about a coach's audience.
 * The caller draws its own line for both, and they are different lines.
 */
function audienceLine(members) {
    if (!members || !members.length)
        return null;
    const sent = sentCount(members);
    if (sent === 0)
        return `Everyone you coach can read this — all ${members.length} of them.`;
    if (sent === 1)
        return 'Sent to 1 client. Nobody else can read it.';
    return `Sent to ${sent} of your ${members.length} clients. Nobody else can read it.`;
}
/**
 * What a coach is told before the FIRST send narrows a document.
 *
 * Two different sentences, because the two situations are genuinely different
 * and one wording cannot be true of both. Sending an open document takes it
 * away from everybody else; sending an addressed one only adds a name.
 */
function sendWarning(addressed) {
    return addressed
        ? 'They are added to the people who can read it. Nobody already on the list loses it.'
        : 'Right now everyone you coach can read this. Sending it to one person makes it theirs alone — '
            + 'everybody else stops seeing it, unless they have already accepted it.';
}
/** The one thing that cannot be undone from this screen, said before the tap. */
exports.SEND_IS_ONE_WAY = 'A document cannot be un-sent. If you address the wrong person, retire it and upload the version you '
    + 'meant — everyone who accepted the old one keeps that record and can still read what they agreed to.';
/**
 * Whether the picker may be offered, and why not when it may not.
 *
 * `read` is the read behind `members`. Three of the four answers are about not
 * knowing, and they are kept apart because they are different facts:
 *
 *   · 'unread' — the read failed. A coach with twelve clients and a failed read
 *     must not be told they have nobody to send to.
 *   · 'part-read' — the read came back AT ITS ROW LIMIT (src/lib/rowCap.ts), so
 *     the rows are real and there are more of them. That is not a smaller
 *     audience, it is an unknown one, and it disqualifies the picker for a
 *     reason particular to this screen: `isAddressed` decides which of the two
 *     `sendWarning` sentences a coach reads before a ONE-WAY action, and a
 *     recipient row beyond the cap makes it choose the wrong one. So the send
 *     is blocked rather than offered under a warning that may not be true.
 */
function sendBlock(o) {
    if (o.retired)
        return 'retired';
    if (o.read === 'failed' || !o.members)
        return 'unread';
    if (o.read === 'truncated')
        return 'part-read';
    if (!o.members.length)
        return 'no-clients';
    return null;
}
function sendBlockLine(block) {
    switch (block) {
        case 'retired':
            return 'This document has been retired, so it cannot be sent to anybody new. Upload the version you want them to read.';
        case 'no-clients':
            return 'You have no clients to send this to yet. Anybody who joins you with your code can be sent it from here.';
        case 'unread':
            return 'Your clients could not be read just now, so there is nobody to choose from. This is not a statement that you have none.';
        case 'part-read':
            return 'You have more clients than this list could bring back, so it cannot be said who this document is currently in front of. '
                + 'Sending is held until that can be read in full, because the warning shown before a send depends on it and sending cannot be undone.';
    }
}
/**
 * Which of the three a Supabase failure was.
 *
 * `unavailable` is the one that matters here and is easy to miss: part 156 has
 * to be RUN before `send_coach_document` exists, and PostgREST answers a call
 * to a function it cannot find with PGRST202 and a 404. Reported as a plain
 * failure that reads as "try again", which it is not — trying again will fail
 * forever until somebody applies the SQL.
 *
 * `refused` is the function answering false: not my document, not my client, or
 * retired. A false is not an error, and a screen that only checks `error` would
 * say "sent" over it. That is the 204 trap this repo has been bitten by
 * repeatedly — a PostgREST write that matched nothing is not an error.
 */
function sendFailure(o) {
    const err = o.error;
    if (err) {
        const code = (err.code ?? '').toUpperCase();
        const msg = (err.message ?? '').toLowerCase();
        if (code === 'PGRST202' || msg.includes('could not find the function') || msg.includes('does not exist')) {
            return 'unavailable';
        }
        return 'offline';
    }
    if (o.returned !== true)
        return 'refused';
    return null;
}
function sendFailureLine(f) {
    switch (f) {
        case 'refused':
            return 'That was not sent. Either the document has been retired or that person is no longer one of your clients, so nothing has been put in front of anybody.';
        case 'unavailable':
            return 'Sending a document to one client is not switched on for this server yet, so nothing was sent. Every document you add is still readable by everyone you coach.';
        case 'offline':
            return 'That could not be sent just now, so nobody has been shown anything. Try again in a moment.';
    }
}
/** The line under a name in the picker. */
function memberLine(m, fmtDay) {
    if (m.acceptedAt)
        return `Accepted ${fmtDay(m.acceptedAt)}`;
    if (m.sentAt)
        return `Sent ${fmtDay(m.sentAt)} · not accepted yet`;
    return 'Has not been sent this';
}
