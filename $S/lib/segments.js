"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMPUTED_SEGMENTS = exports.PACK_LOW_AT = void 0;
exports.segmentDef = segmentDef;
exports.inSegment = inSegment;
exports.segmentMembers = segmentMembers;
exports.unassessed = unassessed;
exports.unassessedNote = unassessedNote;
exports.segmentMeaning = segmentMeaning;
/**
 * How few sessions left counts as nearly out.
 *
 * Two, not one. A coach who hears about it at one has a single session to have
 * the conversation in; at two there is a session in between, which is when a
 * renewal actually gets sold. It is a threshold this module states rather than
 * a fact about anybody, so it is named here and not buried in a comparison.
 */
exports.PACK_LOW_AT = 2;
exports.COMPUTED_SEGMENTS = [
    {
        key: 'drifting', source: 'drift', object: 'who has drifted',
        title: 'Drifting',
        note: 'Well below their own rate over the last fortnight, measured against the six weeks before it. Their own pattern, not anybody else’s.',
    },
    {
        key: 'slipping', source: 'drift', object: 'who is slipping',
        title: 'Slipping',
        note: 'Down on their own rate, but not yet far. Worth a word before it becomes the list above.',
    },
    {
        key: 'no-record', source: 'drift', object: 'who has nothing on record',
        title: 'Nothing Recorded',
        note: 'No pattern to judge — nothing read of theirs in the window. That is not the same as fine, and it is not the same as gone; it is a thing to find out.',
    },
    {
        key: 'pack-run-out', source: 'packs', object: 'whose pack has run out',
        title: 'Pack Run Out',
        note: 'They paid for a block of sessions and have used all of it, so the next one is covered by nothing.',
    },
    {
        key: 'pack-low', source: 'packs', object: 'who is nearly out of sessions',
        title: `${exports.PACK_LOW_AT} Sessions Or Fewer`,
        note: `A paid pack with ${exports.PACK_LOW_AT} or fewer left on it. Early enough that there is a session to have the conversation in.`,
    },
    {
        key: 'never-checked-in', source: 'roster', object: 'who has never checked in',
        title: 'Never Checked In',
        note: 'Nobody has a check-in on record for them, so there is no adherence figure to read. New clients are in here too — it is who to ask, not who to worry about.',
    },
];
function segmentDef(key) {
    return exports.COMPUTED_SEGMENTS.find((s) => s.key === key) ?? null;
}
/** Whether this client is in this segment. */
function inSegment(def, f) {
    switch (def.key) {
        // The three drift bands. `drift === null` is never in any of them: it is
        // the absence of an assessment, and 'no-record' is the presence of one that
        // found nothing. Collapsing the two would put every hand-added client into
        // a list of people to chase.
        case 'drifting': return f.drift === 'at_risk';
        case 'slipping': return f.drift === 'watch';
        case 'no-record': return f.drift === 'idle';
        case 'pack-run-out': return f.packRunOut;
        // Strictly greater than zero, so a run-out pack is in one list and not two.
        // A coach writing to both would send the same person two messages, and the
        // right thing to say to each is not the same thing.
        case 'pack-low': return f.packLeft !== null && f.packLeft > 0 && f.packLeft <= exports.PACK_LOW_AT;
        case 'never-checked-in': return f.adherence === null;
    }
}
/** The ids in this segment, in the order the facts were given — which is the
 *  roster's order, so the recipient list reads the way the coach's book does. */
function segmentMembers(def, facts) {
    return facts.filter((f) => inSegment(def, f)).map((f) => f.clientId);
}
/**
 * Clients this segment's source could not answer for.
 *
 * Only meaningful for 'drift': a client with no Repple account has no
 * server-side activity to read and no thread to write into, so they are outside
 * every drift segment for two independent reasons. The other two sources answer
 * for everybody — a client with no purchases genuinely holds no pack, and a
 * client with no check-ins genuinely has no adherence figure.
 */
function unassessed(def, facts) {
    if (def.source !== 'drift')
        return [];
    return facts.filter((f) => f.drift === null).map((f) => f.clientId);
}
/**
 * What to say under a computed segment about the people it could not consider.
 *
 * Null when there are none, because a standing sentence about an empty set is
 * furniture. Said at all because the alternative is a count that is quietly
 * smaller than the coach's book with nothing anywhere explaining the gap.
 */
function unassessedNote(def, count) {
    if (count <= 0)
        return null;
    return `${count} ${count === 1 ? 'client is' : 'clients are'} not in this list and could not be: they were added by you `
        + 'by hand and have no account, so nothing of theirs can be read and there is no thread to write into. '
        + `They are not being counted as ${def.key === 'no-record' ? 'having nothing recorded' : 'outside the segment'} — they were never asked about.`;
}
/**
 * The label under the recipient list, naming what the segment IS.
 *
 * Every computed segment gets one. A tag is self-explanatory and a computed
 * band is not: "Drifting" is a threshold this app chose, and a coach about to
 * write to the twelve people in it is entitled to know which threshold.
 */
function segmentMeaning(def) {
    return def.note;
}
