"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeRoster = mergeRoster;
exports.goalToEnum = goalToEnum;
exports.goalsDisagree = goalsDisagree;
/**
 * One row per person, linked record first.
 *
 * `linked` is built from `clients`, `manual` from `coach_clients`. Where an id
 * appears in both, the linked row survives whole and gains `coachGoal` from the
 * manual one; where an id appears only in `manual`, that entry is passed
 * through untouched, because a coach's hand-written client is a real thing the
 * coach can see and remove and must not vanish from the list.
 *
 * Nothing else is borrowed across the join, and `joinedAt` is the field worth
 * naming: `coach_clients.created_at` is when the coach typed the person's name
 * in, which for a request approved through CoachRequests is the same moment the
 * link was made, but for a coach who wrote somebody down in January and linked
 * them in March is two months early. src/lib/clientDrift.ts clamps its baseline
 * window to how long the client has been on the book, so an early date widens
 * that window and dilutes a real fall in activity into nothing. A null join
 * date renders as a dash; a wrong one is believed.
 *
 * Order is fully determined by the inputs — linked in the order given, then the
 * manual-only entries in the order given — so two renders of the same two reads
 * cannot produce two different lists.
 */
function mergeRoster(linked, manual) {
    const byId = new Map();
    for (const m of manual)
        if (!byId.has(m.id))
            byId.set(m.id, m);
    const out = [];
    const taken = new Set();
    for (const row of linked) {
        // A duplicate id inside one list should not be possible — both are primary
        // keys — but the whole point of this function is that the roster stopped
        // being able to trust that, and a repeated key is a render warning at best
        // and a mis-targeted tap at worst.
        if (taken.has(row.id))
            continue;
        taken.add(row.id);
        const note = byId.get(row.id);
        // The spread widens T to T & { coachGoal }, which TypeScript will not infer
        // back down to T on its own. The shape is unchanged; only a field the
        // interface already declares has been filled in.
        out.push(note ? { ...row, coachGoal: note.goal } : row);
    }
    for (const m of manual) {
        if (taken.has(m.id))
            continue;
        taken.add(m.id);
        out.push(m);
    }
    return out;
}
// ── Two vocabularies for the same three goals ──────────────────────────────
//
// The client's own goal screen stores an enum — 'fatloss' | 'tone' | 'muscle'.
// The coach's Add Client form stores the label they tapped — 'Fat loss' |
// 'Tone' | 'Build muscle' — into a nullable text column with no CHECK behind
// it. Compared raw, every client who joined by code looks like they are arguing
// with their coach.
//
// Matched on an exact normalised key, never by substring. The builder used to
// ask `s.includes('muscle')` before `s.includes('tone')`, which answers
// "muscle" for the phrase "muscle tone" — the opposite of what was typed — and
// this function is now what decides which programme gets generated for
// somebody.
const GOAL_KEYS = {
    fatloss: 'fatloss',
    tone: 'tone',
    muscle: 'muscle',
    buildmuscle: 'muscle',
};
/**
 * The goal a string names, or null when it does not name one.
 *
 * Null is UNKNOWN and is a fourth answer, not a fourth goal. 'General' is the
 * roster's placeholder for a goal it could not read, an empty string is a
 * column nobody ever filled in, and free text a coach typed before this form
 * had fixed options is a sentence rather than a category. None of those is a
 * statement that the person in front of you wants to lose fat, and the previous
 * version of this lookup returned exactly that for all three.
 */
function goalToEnum(goal) {
    const key = (goal || '').toLowerCase().replace(/[^a-z]/g, '');
    // hasOwnProperty rather than `in` or a bare index: the key comes off a text
    // column, and 'constructor' or 'toString' would otherwise resolve to a
    // function off Object.prototype and be handed back as somebody's goal.
    return Object.prototype.hasOwnProperty.call(GOAL_KEYS, key) ? GOAL_KEYS[key] : null;
}
/**
 * Do the client and their coach have DIFFERENT goals written down for this
 * person?
 *
 * Normalised on both sides, so 'Fat loss' and 'fatloss' are one goal stated in
 * two vocabularies and read as agreement.
 *
 * False whenever either side is unknown, and that is the important half. A
 * coach who never recorded a goal has not disagreed with anybody, and a client
 * goal that could not be read is not evidence of anything at all — surfacing
 * either as a disagreement would put a conversation on the coach's screen that
 * nobody needs to have, off the back of a failed read.
 */
function goalsDisagree(clientGoal, coachGoal) {
    const a = goalToEnum(clientGoal);
    const b = goalToEnum(coachGoal);
    return a !== null && b !== null && a !== b;
}
