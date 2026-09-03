"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paperworkOutstanding = exports.unsignedCount = void 0;
exports.paperworkFor = paperworkFor;
exports.paperworkLine = paperworkLine;
exports.paperworkItemLine = paperworkItemLine;
/**
 * What this one client still owes the coach, and what they have signed.
 *
 * Ordered outstanding first — that is the half a coach is standing there to
 * find out — then newest first inside each half.
 *
 * A document with NO recipient rows is open to the whole roster, which is what
 * every document uploaded before part 156 means and what a new one means until
 * somebody is named. A document with recipient rows is this client's only when
 * one of them names them; otherwise it is not in front of them and does not
 * appear here at all, in either half.
 */
function paperworkFor(o) {
    const addressed = new Set(o.recipients.map((r) => r.documentId));
    const toThem = new Set(o.recipients.filter((r) => r.clientId === o.clientId).map((r) => r.documentId));
    const acceptedAt = new Map();
    for (const a of o.acceptances) {
        // The earliest acceptance is the one that counts. A second row for the same
        // document cannot make an acceptance later than it was.
        const prev = acceptedAt.get(a.documentId);
        if (!prev || a.acceptedAt < prev)
            acceptedAt.set(a.documentId, a.acceptedAt);
    }
    return o.docs
        .filter((d) => d.required && !d.retired)
        .filter((d) => !addressed.has(d.id) || toThem.has(d.id))
        .map((d) => ({
        id: d.id,
        title: d.title,
        createdAt: d.createdAt,
        acceptedAt: acceptedAt.get(d.id) ?? null,
    }))
        .sort((a, b) => 
    // What is owed, first. Then the newest document, because the one a coach
    // has just issued is the one being asked about. Then the title, so the
    // order is stable rather than whatever the read happened to return.
    Number(a.acceptedAt != null) - Number(b.acceptedAt != null)
        || String(b.createdAt).localeCompare(String(a.createdAt))
        || a.title.localeCompare(b.title))
        .map(({ id, title, acceptedAt: at }) => ({ id, title, acceptedAt: at }));
}
/** How many are still outstanding. The caller must have checked the read first
 *  — see `paperworkLine`, which is where that check is enforced. */
const unsignedCount = (items) => items.filter((i) => i.acceptedAt == null).length;
exports.unsignedCount = unsignedCount;
/**
 * The one sentence a coach reads before deciding whether to train somebody.
 *
 * Five states and they are five different facts. The three that are not about
 * paperwork at all — still reading, could not read, read only part of it — come
 * first, because every one of them would otherwise be rendered by the same
 * count as "nothing outstanding".
 *
 * `who` is the client in the coach's own words. It is never a stand-in for a
 * name that could not be read: the caller passes a description ("this client")
 * rather than somebody else's name, which is the rule TF-32 exists for.
 */
function paperworkLine(read, items, who) {
    if (read === 'loading')
        return `Reading whether ${who} has signed your paperwork.`;
    if (read === 'error') {
        return `Whether ${who} has signed your paperwork could not be read. That is a read that failed, not a record of them having signed nothing — `
            + 'do not take it either way.';
    }
    if (read === 'partial') {
        return `You have more paperwork than this could bring back, so it cannot say whether ${who} has signed all of it. `
            + 'Open Documents and check the ones that matter.';
    }
    if (!items.length) {
        return 'You have no paperwork that has to be signed. Anything you upload and mark as required will be listed here, per client.';
    }
    const owed = (0, exports.unsignedCount)(items);
    if (owed === 0) {
        return items.length === 1
            ? `${who} has accepted the one document you require.`
            : `${who} has accepted all ${items.length} documents you require.`;
    }
    return owed === 1
        ? `${who} has NOT accepted 1 of the ${items.length} document${items.length === 1 ? '' : 's'} you require.`
        : `${who} has NOT accepted ${owed} of the ${items.length} documents you require.`;
}
/**
 * Whether this is worth flagging rather than merely stating.
 *
 * True only under a whole read with something genuinely outstanding. A failed
 * read is NOT a warning: a red flag over an unknown is the same lie as a green
 * one, and it teaches a coach to ignore the colour.
 */
const paperworkOutstanding = (read, items) => read === 'ready' && (0, exports.unsignedCount)(items) > 0;
exports.paperworkOutstanding = paperworkOutstanding;
/** The line under one document's title, in the coach's list. `fmtDay` is passed
 *  in so this file names no locale and reads no clock. */
function paperworkItemLine(i, fmtDay) {
    return i.acceptedAt ? `Accepted ${fmtDay(i.acceptedAt)}` : 'Not accepted';
}
