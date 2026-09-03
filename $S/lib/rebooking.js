"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REBOOK_CANCELLED_GAP_NOTE = exports.REBOOK_LOOKBACK_DAYS = void 0;
exports.unrebooked = unrebooked;
exports.rebookingListable = rebookingListable;
exports.rebookCoverageNote = rebookCoverageNote;
exports.unrebookedHeading = unrebookedHeading;
exports.unrebookedNote = unrebookedNote;
exports.noUnrebookedLine = noUnrebookedLine;
const sessionHistory_1 = require("./sessionHistory");
const DAY = 86400000;
/** The local calendar day an instant falls on, as a day number. Built from
 *  local components and compared in UTC, which is the one way to subtract two
 *  local days without a clock change getting into the arithmetic. */
function localDayIndex(ms) {
    const d = new Date(ms);
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}
/**
 * How far back "recently" reaches.
 *
 * Four weeks, and the number is a judgement about the act rather than about
 * training frequency. A fortnight catches everybody who trains weekly and
 * misses the fortnightly client entirely; a quarter surfaces people who left in
 * the spring, which is a different problem with a different conversation. Four
 * weeks is the window in which "shall we get the next one in?" is still an
 * ordinary thing to say.
 */
exports.REBOOK_LOOKBACK_DAYS = 28;
/**
 * Whether a row is an appointment belonging to a named client.
 *
 * An `available` slot that has gone by belongs to nobody and is not evidence
 * anybody trained — the inference supabase/parts/33 exists to end. A row
 * carrying an outcome is kept whatever its slot state, because recording an
 * outcome is somebody stating this was a real session.
 */
function isAppointment(r) {
    if (!r.clientId)
        return false;
    return r.status === 'booked' || (r.outcome != null && r.outcome !== '');
}
/**
 * The clients who had an appointment inside the window and have none ahead.
 *
 * Longest-since first, because that is the order in which a coach loses people.
 * Ties go to the name-free, stable key — the client id — so the list does not
 * reshuffle between renders.
 *
 * `nowMs` is passed in. A frozen clock here reports last week's list forever,
 * and this is a screen that stays mounted for days.
 */
function unrebooked(rows, nowMs, lookbackDays = exports.REBOOK_LOOKBACK_DAYS) {
    const since = nowMs - Math.max(1, lookbackDays) * DAY;
    const hasAhead = new Set();
    const last = new Map();
    for (const r of rows) {
        if (!isAppointment(r) || !r.clientId)
            continue;
        const s = Date.parse(r.startsAt);
        if (!Number.isFinite(s))
            continue;
        const end = s + Math.max(0, r.durationMin) * 60000;
        // Its END, not its start. The hour somebody is standing in is not a past
        // session and it is not a future booking either — but it is certainly not a
        // reason to chase them, so an in-progress session counts as "ahead".
        if (end > nowMs) {
            // A cancelled appointment in the future is not a booking. It is a row
            // with a note on it saying the opposite.
            if (r.outcome === 'cancelled' || r.outcome === 'late_cancelled')
                continue;
            hasAhead.add(r.clientId);
            continue;
        }
        if (end < since)
            continue;
        const prev = last.get(r.clientId);
        if (!prev || end > prev.endMs) {
            last.set(r.clientId, {
                startsAt: r.startsAt,
                endMs: end,
                missed: r.outcome === 'no_show' || r.outcome === 'cancelled' || r.outcome === 'late_cancelled',
            });
        }
    }
    const out = [];
    for (const [clientId, l] of last) {
        if (hasAhead.has(clientId))
            continue;
        out.push({
            clientId,
            lastStartsAt: l.startsAt,
            lastEndMs: l.endMs,
            daysSince: Math.max(0, localDayIndex(nowMs) - localDayIndex(l.endMs)),
            lastMissed: l.missed,
        });
    }
    return out.sort((a, b) => b.daysSince - a.daysSince || (a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0));
}
/**
 * Whether the list may be shown at all.
 *
 * 'partial' is admitted here, and that is a deliberate departure from the usual
 * `isWhole` gate — with the reason in the module header. The claim each row
 * makes is "this person has nothing booked ahead", and the future half of a
 * newest-first read is whole even when the read was cut. What 'partial' costs
 * is rows that should be in the list and are not, which `rebookCoverageNote`
 * states. 'loading' and 'error' produce no list at all.
 */
function rebookingListable(status) {
    return status === 'ready' || status === 'partial';
}
/**
 * What the list cannot promise, or null when it promises everything.
 *
 * The boundary is `readBoundary` over the same rows — how far back the read
 * actually reached — and the window is the lookback. `rangeCoverage` answers
 * whether the two overlap, and its 'edge' and 'beyond' are two different
 * shortfalls: part of the window was read, or none of it was.
 */
function rebookCoverageNote(boundary, status, nowMs, dayLabel, lookbackDays = exports.REBOOK_LOOKBACK_DAYS) {
    const from = nowMs - Math.max(1, lookbackDays) * DAY;
    const cover = (0, sessionHistory_1.rangeCoverage)(from, nowMs, boundary, status);
    if (cover === 'covered')
        return null;
    if (cover === 'unknown') {
        return 'Your sessions have not been read in full, so this is not a list of everybody who has not rebooked.';
    }
    const back = boundary.oldestISO
        ? `Your calendar is loaded back to ${dayLabel(boundary.oldestISO)} and no further`
        : 'Your calendar is not loaded back that far';
    return cover === 'beyond'
        ? `${back}, so none of the last ${lookbackDays} days was read. Anybody who trained in that time and has not `
            + 'rebooked is missing from this list rather than absent from your book.'
        : `${back}, so only part of the last ${lookbackDays} days was read. Somebody who trained before that and has `
            + 'not rebooked is missing from this list rather than absent from your book.';
}
/** Said wherever this list is shown, because no read can close it. */
exports.REBOOK_CANCELLED_GAP_NOTE = 'A client who cancelled their own last session may not be here. Cancelling hands the hour back to you, so the '
    + 'booking stops being theirs and there is nothing left to read.';
/** The heading over the list, or null when there is nothing to head. */
function unrebookedHeading(n) {
    if (n <= 0)
        return null;
    return n === 1 ? 'One client with nothing booked' : `${n} clients with nothing booked`;
}
/**
 * The line under one of them.
 *
 * Says the fact and not the inference. "Last trained 9 days ago, nothing since"
 * is something the diary knows; "at risk of leaving" is not, and belongs to
 * src/lib/clientDrift.ts, which measures it properly against four sources.
 *
 * `when` is the caller's formatter for the date — this module formats none, for
 * the reason src/lib/sessionHistory.ts gives: every locale decision in this
 * repo goes through `appLocale()`.
 */
function unrebookedNote(u, when) {
    const ago = u.daysSince === 0 ? 'earlier today'
        : u.daysSince === 1 ? 'yesterday'
            : `${u.daysSince} days ago`;
    const head = u.lastMissed
        ? `Their last session, ${when(u.lastStartsAt)}, did not go ahead — ${ago}.`
        : `Last session ${when(u.lastStartsAt)}, ${ago}.`;
    return `${head} Nothing booked since.`;
}
/** The line when nobody is on the list, which is a real and good answer and
 *  deserves to be said rather than left as a blank space. */
function noUnrebookedLine(lookbackDays = exports.REBOOK_LOOKBACK_DAYS) {
    return `Everybody who has trained with you in the last ${lookbackDays} days has something booked.`;
}
