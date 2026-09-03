"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_TONNAGE = void 0;
exports.isBodyweightSet = isBodyweightSet;
exports.bodyweightAtKg = bodyweightAtKg;
exports.setLoadKg = setLoadKg;
exports.entryTonnage = entryTonnage;
exports.tonnage = tonnage;
exports.tonnageNote = tonnageNote;
exports.repRecords = repRecords;
exports.bodyweightSetLabel = bodyweightSetLabel;
// A hold is the other set whose first number is not reps. Consulted here rather
// than duplicated, because tonnage is the one figure both flags have to change
// and two files deciding separately what a set is worth is how a plank came to
// be counted as forty-five repetitions in the first place.
const timedSets_1 = require("./timedSets");
/** The calendar day an ISO instant falls on, LOCALLY. Matches `dayKey` in
 *  ./streaks.ts: an evening set and an evening weigh-in have to land on the
 *  same day for one to price the other, and comparing raw ISO strings puts a
 *  21:00 workout in a UTC+2 gym on tomorrow. */
const dayOf = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()))
        return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** True when the person said this set was their own bodyweight. */
function isBodyweightSet(e, i) {
    return e.bw?.[i] === true;
}
/**
 * What the member weighed on the day of a set, from their own history.
 *
 * At or before, never after. A reading taken next month is not evidence about
 * today, and reaching forward for one is how a chart of the past starts moving
 * whenever somebody steps on a scale. Null when the history has nothing at or
 * before that day — including when the history is empty, which is the ordinary
 * case for a member who has never been scanned and never typed a figure.
 *
 * The NEAREST such reading wins, not the first: a member with January and
 * August weigh-ins gets January's for a February set and August's for a
 * September one.
 */
function bodyweightAtKg(history, iso) {
    const day = dayOf(iso);
    if (!day)
        return null;
    let best = null;
    for (const p of history) {
        if (!p || typeof p.v !== 'number' || !Number.isFinite(p.v) || p.v <= 0)
            continue;
        const d = dayOf(p.t);
        if (!d || d > day)
            continue;
        if (!best || d >= best.day)
            best = { day: d, kg: p.v };
    }
    return best ? best.kg : null;
}
/**
 * The kilograms a single set moved, or null when that cannot be known.
 *
 * Three answers, and they are genuinely three:
 *
 *   a number  the load is known — the bar's plates, or the body plus the belt
 *   null      a bodyweight set with no weight recorded on or before that day
 *   null      an ordinary set with no load, which is a set nobody described
 *
 * The two nulls are the same answer to the caller — do not count this — and
 * separating them would only tempt somebody to count one of them as zero.
 */
function setLoadKg(e, i, set, history, at) {
    const added = Number.isFinite(set[1]) ? set[1] : 0;
    if (!isBodyweightSet(e, i))
        return added > 0 ? added : null;
    const body = bodyweightAtKg(history, at);
    if (body == null)
        return null;
    return body + Math.max(0, added);
}
exports.NO_TONNAGE = { kg: 0, unknownSets: 0 };
/** Tonnage for one entry. */
function entryTonnage(e, history) {
    if (!e.sets?.length)
        return exports.NO_TONNAGE;
    let kg = 0, unknown = 0;
    for (let i = 0; i < e.sets.length; i++) {
        // A hold is not reps, so reps × load is not a mass moved. Skipped
        // entirely rather than counted as zero or as `secs × kg`: 45 seconds
        // under a 10 kg plate is not 450 kg, and it is not nothing either — it is
        // in the hold board (src/lib/timedSets.ts) where it can be stated in its
        // own units. It is deliberately NOT counted in `unknownSets`, which means
        // "work this total could have priced and could not"; a hold is work this
        // total is not about.
        if ((0, timedSets_1.isTimedSet)(e, i))
            continue;
        const reps = e.sets[i][0] || 0;
        const load = setLoadKg(e, i, e.sets[i], history, e.t);
        if (load == null) {
            if (isBodyweightSet(e, i) && reps > 0)
                unknown++;
            continue;
        }
        kg += reps * load;
    }
    return { kg, unknownSets: unknown };
}
/** Tonnage across many entries. */
function tonnage(log, history) {
    let kg = 0, unknown = 0;
    for (const e of log) {
        const t = entryTonnage(e, history);
        kg += t.kg;
        unknown += t.unknownSets;
    }
    return { kg, unknownSets: unknown };
}
/**
 * What to say under a tonnage that is missing sets, or null when it is whole.
 *
 * One sentence, one place. Three screens print a tonnage and all three needed
 * the same caveat in the same words — and the wording matters, because it has
 * to tell the member both that the figure is short AND what they can do about
 * it, without implying anything is wrong with their log.
 */
function tonnageNote(t) {
    if (t.unknownSets <= 0)
        return null;
    const s = t.unknownSets === 1 ? 'set is' : 'sets are';
    return `${t.unknownSets} bodyweight ${s} not in this total, because your own weight is not recorded for the day you did them. Add your weight and they count.`;
}
/**
 * Best bodyweight set per movement, most reps first.
 *
 * Ranked on reps, with added load breaking a tie — so a 10-rep set with a belt
 * beats a plain 10 and neither is confused with the other. Ranking on the two
 * multiplied together would let a heavy belt buy a rep count that was never
 * performed, and rep records are read as "I did this many".
 */
function repRecords(log) {
    const best = new Map();
    for (const e of log) {
        if (!e.sets?.length)
            continue;
        for (let i = 0; i < e.sets.length; i++) {
            if (!isBodyweightSet(e, i))
                continue;
            // A bodyweight HOLD belongs on the hold board, not here. Without this a
            // 45-second plank outranks every pull-up anybody has ever done, because
            // 45 is a bigger number than 12 and this board reads the first number as
            // repetitions.
            if ((0, timedSets_1.isTimedSet)(e, i))
                continue;
            const reps = e.sets[i][0] || 0;
            if (reps <= 0)
                continue;
            const addedKg = Math.max(0, Number.isFinite(e.sets[i][1]) ? e.sets[i][1] : 0);
            const cur = best.get(e.exercise);
            const better = !cur || reps > cur.reps || (reps === cur.reps && addedKg > cur.addedKg);
            if (better)
                best.set(e.exercise, { exercise: e.exercise, reps, addedKg, at: e.t });
        }
    }
    return [...best.values()].sort((a, b) => b.reps - a.reps || b.addedKg - a.addedKg);
}
/**
 * How a bodyweight set reads on a row: "12 reps at bodyweight", or with a belt.
 *
 * Sentence case, and it is prose rather than a title — it sits under a movement
 * name as an explanation of the set, not as a heading over it.
 */
function bodyweightSetLabel(reps, addedKg, addedLabel) {
    return addedKg > 0 && addedLabel ? `${reps} reps at bodyweight +${addedLabel}` : `${reps} reps at bodyweight`;
}
