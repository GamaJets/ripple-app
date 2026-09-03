"use strict";
// The record that a message went out, and to whom.
//
// ── What was missing ───────────────────────────────────────────────────────
//
// /members can post to a segment: one `announcements` row and one inbox row per
// named recipient, written by `notify_users`. The announcement carries the body
// and the author, so "who wrote it" survives. Nothing at all carries the
// RECIPIENTS. `notify_users` returns a count and inserts rows that point back
// at no announcement, so a message that landed in forty inboxes cannot be
// traced to the forty people who got it — not by the owner who sent it, not by
// the owner who inherits the gym, and not by anybody answering for it later.
//
// The same screen, thirty lines further down, carefully writes a
// `gym_export_runs` row when a CSV of those same members leaves the browser.
// Taking the list out was audited and shouting at everybody on it was not.
//
// ── Why the console writes this and a trigger does not ────────────────────
//
// supabase/parts/187 makes the argument against console-written audit tables
// and it is right: a trigger cannot be forgotten, cannot be skipped by the next
// code path, and cannot be forged by the party being audited. Part 690 does
// exactly that for the half a trigger can see — an `announcements` insert
// becomes a `notice-posted` event, unforgeable, written by the data.
//
// The recipient list is the half no trigger can see. It exists only in the
// argument the console passed to `notify_users`, which stores it nowhere, and
// it is the half the question is actually about. So it is written from here,
// for the same reason and with the same caveat as `gym_export_runs`: it records
// what the client says it did. Insert-only, no update and no delete, because a
// record of a broadcast that the sender can then remove is worth less than no
// record at all — its absence would be read as "nothing was sent".
//
// Framework-agnostic: the Supabase client comes in as an argument.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_LOGGED_BODY = void 0;
exports.loggingNote = loggingNote;
exports.logBroadcast = logBroadcast;
/**
 * What to store as the body.
 *
 * The whole message, trimmed, up to the column's limit. Not a summary and not
 * the first line: the question this row answers later is "what were these
 * people told", and an abridged answer to that is worse than none because it
 * reads as complete.
 */
exports.MAX_LOGGED_BODY = 4000;
/** One sentence for the owner when the send worked and the record of it did
 *  not. Null when there is nothing to say. */
function loggingNote(err) {
    if (!err)
        return null;
    return `The message went out, but the record of who it went to was not written: ${err}. Nothing can now say who received it — take a note of the group and the time yourself.`;
}
/**
 * Record one broadcast.
 *
 * Returns the failure as a STRING rather than throwing, and never rejects. The
 * message is already in people's inboxes by the time this runs, so reporting a
 * logging failure as a send failure would be false — and an owner who is told
 * "nothing was posted" about a notice that was posted will send it again.
 * `loggingNote` above turns the string into the sentence the screen prints, so
 * the gap is visible as a gap rather than swallowed.
 */
async function logBroadcast(sb, r) {
    if (!r.tenantId)
        return 'the gym could not be identified';
    try {
        const { error } = await sb.from('gym_broadcast_sends').insert({
            tenant_id: r.tenantId,
            sent_by: r.sentBy ?? null,
            segment_id: r.segmentId,
            segment_label: r.segmentLabel,
            member_ids: r.memberIds,
            recipients: r.memberIds.length,
            delivered: r.delivered,
            body: r.body.trim().slice(0, exports.MAX_LOGGED_BODY),
        });
        return error ? (error.message ?? 'the write was refused') : null;
    }
    catch (e) {
        return e?.message ?? 'the write could not be made';
    }
}
