"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEVEL_TITLE = exports.LEVEL_NOTE = exports.ROSTER_SPLIT_DAYS = exports.ROSTER_WINDOW_DAYS = void 0;
exports.judgeRosterRow = judgeRosterRow;
exports.rankRosterExercise = rankRosterExercise;
exports.rosterExerciseLine = rosterExerciseLine;
/**
 * How far back the comparison looks, in days.
 *
 * Fifty-six — eight weeks, split into two fours. Four weeks either side is the
 * shortest window in which "no heavier than before" is worth saying: a client
 * training a movement once a week has four outings in each half, which is
 * enough that one bad session does not decide it, and short enough that the
 * earlier half is still the same block of training rather than a different
 * season.
 *
 * The same 28 days `WINDOW_DAYS` in src/lib/planVsActual.ts uses, doubled,
 * deliberately: a coach reading both screens about the same client should not
 * have to hold two different windows in their head.
 */
exports.ROSTER_WINDOW_DAYS = 56;
/** Where the window is split into "earlier" and "recent". Half, so neither
 *  half is given an advantage by being longer. */
exports.ROSTER_SPLIT_DAYS = 28;
/** How the ranking sorts. Lowest first, so the rows a coach must act on lead. */
const RANK = {
    // Somebody who has stopped doing a movement entirely is the first thing a
    // coach wants to see, ahead of somebody merely not adding weight — the
    // programme is not being followed, which is a different and larger problem.
    unseen: 0,
    dropping: 1,
    holding: 2,
    'no-load': 3,
    new: 4,
    // Last, and still listed. A coach scanning for problems still wants to see
    // who is going well, and hiding them would make the screen look like a list
    // of failures rather than a picture of a roster.
    climbing: 5,
};
/**
 * How much heavier counts as heavier.
 *
 * Zero. Not a tolerance band, and the reason is the smallest increment in a
 * gym: 1.25 kg change plates are the finest most gyms carry and 2.5 kg is the
 * ordinary step, so any real increase is already far outside a rounding. A
 * tolerance here would only ever swallow a genuine 1 kg microload — which is
 * exactly what a coach working with a stalled client prescribes — and report
 * it as still stalled.
 */
const HEAVIER_BY_KG = 0;
/** Percentage change between two figures, or null when the earlier one has
 *  nothing to be a percentage of. Deliberately not imported from deltaLabel:
 *  this returns the NUMBER and `deltaLabel` owns every sign and arrow that is
 *  ever rendered from it — scripts/check-deltas.mjs exists because
 *  twenty-five screens each wrote their own. */
function pct(from, to) {
    if (from == null || to == null || !Number.isFinite(from) || !Number.isFinite(to))
        return null;
    if (from === 0)
        return null;
    return ((to - from) / Math.abs(from)) * 100;
}
/**
 * Judge one client's row.
 *
 * The order of the branches is the whole of the logic and each one excludes the
 * next: no outings at all, then no earlier half to compare against, then no
 * load anywhere to compare, and only then the comparison itself. Written as
 * early returns rather than as one condition, because a single boolean
 * expression covering four "we cannot answer" cases is where one of them
 * silently becomes 'holding'.
 */
function judgeRosterRow(r) {
    const base = {
        clientId: r.clientId,
        topKg: r.recentTopKg,
        priorTopKg: r.priorTopKg,
        e1rmKg: r.recentE1rmKg,
        changePct: pct(r.priorTopKg, r.recentTopKg),
        outings: r.recentOutings + r.priorOutings,
        lastAt: r.lastAt,
    };
    if (r.recentOutings <= 0 && r.priorOutings <= 0)
        return { ...base, level: 'unseen' };
    if (r.priorOutings <= 0)
        return { ...base, level: 'new' };
    // Logged in both halves but the coach has stopped seeing loads: they have
    // moved onto a machine that does not show one, or the movement is bodyweight.
    // Either way there is no weight to plateau.
    if (r.recentTopKg == null || r.priorTopKg == null)
        return { ...base, level: 'no-load' };
    if (r.recentTopKg > r.priorTopKg + HEAVIER_BY_KG)
        return { ...base, level: 'climbing' };
    if (r.recentTopKg < r.priorTopKg)
        return { ...base, level: 'dropping' };
    return { ...base, level: 'holding' };
}
/**
 * Every client on the roster, judged and ranked.
 *
 * `rosterIds` is the WHOLE book, not the ids that came back from the aggregate.
 * That is the point: a client who has never touched the movement produces no
 * row at all, and they are the most interesting person on this screen. Building
 * the list from the aggregate's own rows would silently answer only for the
 * people who already do the exercise, which is the question nobody asked.
 *
 * Ranked by `RANK`, then by how recently they last did it — within a band, the
 * one who has not touched it for longest leads — and finally by client id so
 * the order is total and does not shuffle between renders.
 */
function rankRosterExercise(rosterIds, rows) {
    const byId = new Map(rows.map((r) => [r.clientId, r]));
    const out = rosterIds.map((id) => judgeRosterRow(byId.get(id) ?? {
        clientId: id, lastAt: null,
        recentOutings: 0, priorOutings: 0,
        recentTopKg: null, priorTopKg: null,
        recentE1rmKg: null, priorE1rmKg: null,
    }));
    return out.sort((a, b) => {
        const r = RANK[a.level] - RANK[b.level];
        if (r !== 0)
            return r;
        // Oldest last-seen first. A null — never logged — sorts before every date,
        // which puts the people who have never done it at the top of their band.
        const at = (x) => (x.lastAt ? Date.parse(x.lastAt) : -Infinity);
        const d = at(a) - at(b);
        if (Number.isFinite(d) && d !== 0)
            return d;
        return a.clientId.localeCompare(b.clientId);
    });
}
/** What each band says on screen, in sentence case — these are prose, not
 *  buttons. Every one of them names the evidence rather than giving a verdict,
 *  so a coach who disagrees knows what to disagree with. */
exports.LEVEL_NOTE = {
    unseen: 'has not logged this movement in the window at all',
    dropping: 'heaviest set is lighter than it was in the first half of the window',
    holding: 'heaviest set has not gone up across the window',
    'no-load': 'has logged this movement with no weight recorded, so there is no load to compare',
    new: 'has only logged this movement in the recent half, so there is nothing to compare it against',
    climbing: 'heaviest set has gone up across the window',
};
/** The Title Case heading each band sits under. */
exports.LEVEL_TITLE = {
    unseen: 'Not Doing It',
    dropping: 'Going Backwards',
    holding: 'Not Moving',
    'no-load': 'No Load Recorded',
    new: 'Too New to Say',
    climbing: 'Going Up',
};
const s = (n) => (n === 1 ? '' : 's');
/**
 * The line above the list.
 *
 * Never a count under an unread roster or an unread aggregate. Two reads, and
 * either one failing makes every number here a claim about a book the screen
 * did not see — a coach told "3 of 40 are stalled" off a partial roster acts on
 * a denominator that is not their book.
 */
function rosterExerciseLine(status, rosterStatus, clients, movement) {
    if (status === 'loading' || rosterStatus === 'loading')
        return 'Reading what your clients have logged…';
    if (status === 'error') {
        return `Your clients' training could not be read for ${movement}. An empty list below is about that read, not about them.`;
    }
    if (rosterStatus !== 'ready') {
        return 'Your book could not be read in full, so this cannot say how many of your clients it covers. Everyone listed is real.';
    }
    if (!clients.length)
        return 'Nobody is on your book yet, so there is nothing to compare.';
    const stalled = clients.filter((c) => c.level === 'holding' || c.level === 'dropping').length;
    const unseen = clients.filter((c) => c.level === 'unseen').length;
    return `${clients.length} client${s(clients.length)} on your book. `
        + `${stalled} ${stalled === 1 ? 'has' : 'have'} not added weight to ${movement} across the last ${exports.ROSTER_WINDOW_DAYS} days, `
        + `and ${unseen} ${unseen === 1 ? 'has' : 'have'} not logged it at all.`;
}
