"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_CHIPS = void 0;
exports.lastTime = lastTime;
const bestSet_1 = require("./bestSet");
const bodyweightSets_1 = require("./bodyweightSets");
const coachWeek_1 = require("./coachWeek");
const entryEdit_1 = require("./entryEdit");
const exerciseId_1 = require("./exerciseId");
const timedSets_1 = require("./timedSets");
const units_1 = require("./units");
/**
 * How many set chips are drawn before the rest are counted instead.
 *
 * Eight, because this is read one-handed between sets and a member scanning a
 * strip of pills is looking for a shape, not an inventory. A twelve-set drop
 * ladder that wraps onto three lines is worse than "and 4 more" — and the
 * count is stated rather than the strip silently ending, which is the same
 * rule src/lib/sliceTruncated.ts exists for.
 */
exports.MAX_CHIPS = 8;
/**
 * The newest entry for this movement, or null.
 *
 * Timestamps are compared with `Date.parse`, and a row whose stamp will not
 * parse loses to one whose will rather than being dropped: a queued row that
 * came back through a JSON round trip with a mangled `t` is still a session
 * that happened, and it is the only candidate when it is the only candidate.
 */
function latestOuting(log, slug) {
    let best = null;
    let bestAt = Number.NEGATIVE_INFINITY;
    for (const e of log) {
        if (!e || (0, exerciseId_1.exerciseSlug)(e.exercise ?? '') !== slug)
            continue;
        if (!e.sets?.length)
            continue;
        const at = Date.parse(String(e.t));
        const rank = Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY;
        if (best == null || rank > bestAt) {
            best = e;
            bestAt = rank;
        }
    }
    return best;
}
/**
 * One stored pair, as a phrase.
 *
 * Every branch of this delegates. `bestSetLabel` owns the repped phrasing —
 * including the bodyweight one, which is the whole reason that module was
 * written — and `timedSetLabel` owns the held one. Writing either out by hand
 * here would make this the fourth hand, and the third hand is what put
 * "104 kg × 12" over a weighted pull-up on the Records hero.
 */
function setPhrase(e, i, unit) {
    const pair = e.sets?.[i];
    if (!pair)
        return null;
    const first = Number(pair[0]);
    const stored = Number(pair[1]);
    const load = Number.isFinite(stored) && stored > 0 ? stored : 0;
    const bw = (0, bodyweightSets_1.isBodyweightSet)(e, i);
    if ((0, timedSets_1.isTimedSet)(e, i)) {
        if (!Number.isFinite(first) || first <= 0)
            return null;
        return { label: (0, timedSets_1.timedSetLabel)(first, load > 0 ? (0, units_1.liftLabel)(load, unit) : null, bw), held: true };
    }
    if (!Number.isFinite(first) || first <= 0)
        return null;
    return {
        label: (0, bestSet_1.bestSetLabel)({ reps: first, bodyweight: bw, addedKg: bw ? load : 0 }, bw ? null : (load > 0 ? (0, units_1.liftLabel)(load, unit) : null), bw && load > 0 ? (0, units_1.liftLabel)(load, unit) : null),
        held: false,
    };
}
/**
 * The heaviest BAR load of an outing, in kilograms — null when there was none.
 *
 * Bodyweight sets are excluded outright, and this is not an oversight to be
 * tidied up later. Their stored second number is what was ADDED, and their real
 * load is a body weight plus that, which is a figure partly derived from a
 * weigh-in. src/lib/streaks.ts states the prohibition and src/lib/bestSet.ts
 * exists to enforce it: that figure is not a thing that was ever on a bar, and
 * subtracting the number in the load box from it would produce a difference
 * between two quantities that are not the same kind of thing.
 *
 * Holds are excluded because their load was held, not lifted, and because a
 * plank under a 10 kg plate is not a comparison for a squat.
 */
function topBarKg(e) {
    let top = null;
    const sets = e.sets ?? [];
    for (let i = 0; i < sets.length; i++) {
        if ((0, timedSets_1.isTimedSet)(e, i) || (0, bodyweightSets_1.isBodyweightSet)(e, i))
            continue;
        const w = Number(sets[i]?.[1]);
        const r = Number(sets[i]?.[0]);
        if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(r) || r <= 0)
            continue;
        if (top == null || w > top)
            top = w;
    }
    return top;
}
/**
 * What the box holds, next to what the top set held.
 *
 * Stated as arithmetic between two figures on one screen, never as advice and
 * never as a claim about where the number came from. "Same as" rather than
 * "match it"; "2.5 kg more" rather than "add 2.5 kg".
 *
 * The difference is converted ONCE, through `liftDeltaIn`, rather than by
 * subtracting two separately-rounded readings. That is the defect
 * src/lib/units.ts documents: a genuine 2.5 kg step reading "+5 lb" one week
 * and "+6 lb" the next off nothing the lifter did.
 */
function compareBox(boxKg, topKg, unit) {
    const rawDiff = boxKg - topKg;
    const moved = (0, units_1.liftDeltaIn)(rawDiff, unit);
    if (moved == null)
        return null;
    // A difference that rounds away in the reader's own unit is not a difference
    // they can act on. 61 kg against 60 kg is 2 lb and worth saying; 60.05 kg is
    // not, and "0.1 lb more" beside a bar nobody can load to it is noise.
    if (Math.abs(moved) < 0.05)
        return 'The load box is the same as that.';
    const size = `${(0, units_1.plain)(Math.abs(moved))} ${unit}`;
    return rawDiff > 0
        ? `The load box is ${size} more than that.`
        : `The load box is ${size} less than that.`;
}
/**
 * What to say above the reps and load boxes about the movement on screen.
 *
 * Exactly one of six answers, and five of them are a sentence rather than a
 * recap. A caller may draw them all the same way; what it must not do is
 * collapse `error`, `never` and `unknown` into one blank, which is what the
 * runner does today.
 */
function lastTime(i) {
    if (i.status === 'loading') {
        return { kind: 'loading', note: 'Looking up what you did last time…' };
    }
    if (i.status === 'error') {
        return {
            kind: 'error',
            note: 'Your training history could not be read, so this cannot show what you last did on this. That is a read that failed rather than a movement you have never done — log the session as normal, it is saved either way.',
        };
    }
    const slug = (0, exerciseId_1.exerciseSlug)(i.exercise ?? '');
    const outing = slug ? latestOuting(i.log, slug) : null;
    if (!outing) {
        if (i.status === 'partial') {
            return {
                kind: 'unknown',
                note: 'Nothing for this movement in the sessions that came back, and your history was cut short at the sessions it could fit — so an older one may exist that is not in it.',
            };
        }
        return {
            kind: 'never',
            note: 'First time logging this one. What you put in below is what the next session gets measured against.',
        };
    }
    const sets = [];
    for (let n = 0; n < (outing.sets?.length ?? 0); n++) {
        const phrase = setPhrase(outing, n, i.unit);
        if (phrase)
            sets.push(phrase);
    }
    // Every set of the outing was unreadable — a row of zeroes or NaNs out of a
    // queue. There is a session here and nothing that can be said about it, which
    // is not the same as no session, and is certainly not "first time".
    if (sets.length === 0) {
        return {
            kind: 'unknown',
            note: 'You have logged this movement before, but that session did not record anything readable about the sets.',
        };
    }
    const day = (0, entryEdit_1.dayKeyOf)(outing.t);
    const daysAgo = day ? (0, coachWeek_1.daysBetweenIso)(day, i.today) : null;
    const top = topBarKg(outing);
    const boxKg = i.boxKg;
    const boxNote = top != null && typeof boxKg === 'number' && Number.isFinite(boxKg) && boxKg > 0
        ? compareBox(boxKg, top, i.unit)
        : null;
    return {
        kind: 'outing',
        // `whenLabel` is given the outing's day and today's, in that order, and
        // returns "Today" / "Yesterday" / "N days ago". A future day cannot arise
        // from a log, but it returns "In N days" if one ever does rather than an
        // absolute value that would read as the past.
        when: day ? (0, coachWeek_1.whenLabel)(day, i.today) : null,
        daysAgo,
        name: outing.exercise,
        sets: sets.slice(0, exports.MAX_CHIPS),
        more: Math.max(0, sets.length - exports.MAX_CHIPS),
        boxNote,
    };
}
