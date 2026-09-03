"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLIENT_CANCELLED_GAP_NOTE = exports.PAST_STATE_NOTE = exports.PAST_STATE_LABEL = exports.PAST_STATES = void 0;
exports.hasEnded = hasEnded;
exports.wasBooked = wasBooked;
exports.pastVerdict = pastVerdict;
exports.pastSessions = pastSessions;
exports.tallyPast = tallyPast;
exports.readBoundary = readBoundary;
exports.monthCoverage = monthCoverage;
exports.rangeCoverage = rangeCoverage;
exports.monthCoverageNote = monthCoverageNote;
exports.emptyHistoryLine = emptyHistoryLine;
/** The order a person reads them in, best-known first. Used for tallies. */
exports.PAST_STATES = ['delivered', 'missed', 'late_cancelled', 'cancelled', 'unmarked'];
/** Short label for a chip or a row. Sentence case: these sit inside prose. */
exports.PAST_STATE_LABEL = {
    delivered: 'delivered',
    missed: 'not attended',
    late_cancelled: 'cancelled late',
    cancelled: 'cancelled',
    unmarked: 'not yet marked',
};
/**
 * The full sentence for a state, for the line under a row.
 *
 * 'unmarked' borrows gymSessions' own wording rather than inventing a second
 * one — a coach who reads "still needs an outcome recorded" here and on the
 * payroll blocker is reading about the same thing.
 */
exports.PAST_STATE_NOTE = {
    delivered: 'Recorded as delivered.',
    missed: 'Recorded as not attended.',
    late_cancelled: 'Cancelled inside the notice period.',
    cancelled: 'Cancelled with notice.',
    unmarked: 'This session still needs an outcome recorded, so what happened is not established.',
};
/**
 * Whether this session's time has passed.
 *
 * Its END, not its start. A session in progress is not history, and putting the
 * hour somebody is standing in into a list headed "what already happened" is
 * how a coach comes to mark an outcome for a session they are still delivering.
 * A missing or unreadable duration falls back to nothing rather than to a
 * guessed hour: the start alone is the only instant we actually know.
 */
function hasEnded(row, now = Date.now()) {
    const start = Date.parse(row.startsAt);
    if (!Number.isFinite(start))
        return false;
    const mins = typeof row.durationMin === 'number' && Number.isFinite(row.durationMin)
        ? Math.max(0, row.durationMin) : 0;
    return start + mins * 60000 <= now;
}
/**
 * Whether this row is a session at all, as opposed to an hour nobody booked.
 *
 * An `available` slot that has gone by is not a session that happened and must
 * never be counted as one — that inference is the whole reason
 * 33-session-outcomes.sql exists. A row carrying an outcome is kept whatever
 * its slot state, because recording an outcome is somebody stating that this
 * was a real session.
 */
function wasBooked(row) {
    return row.status === 'booked' || (row.outcome != null && row.outcome !== '');
}
/**
 * What became of one session.
 *
 * An `outcome` value this build has never heard of reads as 'unmarked', not as
 * delivered. A value added to the check constraint later must not silently
 * arrive on somebody's screen as work they were paid for; unmarked is the state
 * that asks a human to look, which is the correct answer to "we do not know
 * what this is".
 */
function pastVerdict(row) {
    const disputed = row.approvalState === 'disputed';
    const disputedAt = disputed ? (row.disputedAt ?? null) : null;
    let state;
    switch (row.outcome) {
        case 'completed':
            state = 'delivered';
            break;
        case 'no_show':
            state = 'missed';
            break;
        case 'cancelled':
            state = 'cancelled';
            break;
        case 'late_cancelled':
            state = 'late_cancelled';
            break;
        default:
            state = 'unmarked';
            break;
    }
    return {
        state,
        at: state === 'unmarked' ? null : (row.outcomeAt ?? null),
        disputed,
        disputedAt,
    };
}
/**
 * The sessions that have already happened, newest first.
 *
 * Cancelled and disputed rows are in. Open slots and blocked time are out —
 * they are not sessions. The sort is total: `startsAt` then whatever secondary
 * key the caller's rows carry is not available here, so ties fall back to the
 * order they arrived in, which is stable in every JS engine this runs on.
 */
function pastSessions(rows, now = Date.now()) {
    return rows
        .filter((r) => wasBooked(r) && hasEnded(r, now))
        .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
}
/**
 * Count the states in a list of past sessions.
 *
 * A COUNT over a truncated read is a figure computed from an unknown fraction
 * of the set, which src/ui/loadStatus.ts forbids under 'partial'. This function
 * does not know the status, so it does not guard — the caller does, and every
 * caller here gates on `isWhole` before printing any of these numbers.
 */
function tallyPast(rows, now = Date.now()) {
    const t = {
        delivered: 0, missed: 0, cancelled: 0, late_cancelled: 0, unmarked: 0, disputed: 0, total: 0,
    };
    for (const r of pastSessions(rows, now)) {
        const v = pastVerdict(r);
        t[v.state] += 1;
        if (v.disputed)
            t.disputed += 1;
        t.total += 1;
    }
    return t;
}
/** Said on every client-facing history, because it cannot be worked around in
 *  code: a booking the member cancelled themselves is not in these rows. */
exports.CLIENT_CANCELLED_GAP_NOTE = 'A session you cancelled yourself is not listed here. Cancelling hands the hour back to your coach, '
    + 'so the booking stops being yours; where a late fee was recorded it is on your receipts.';
function readBoundary(rows, truncated) {
    let oldest = null;
    let oldestISO = null;
    for (const r of rows) {
        const t = Date.parse(r.startsAt);
        if (!Number.isFinite(t))
            continue;
        if (oldest == null || t < oldest) {
            oldest = t;
            oldestISO = r.startsAt;
        }
    }
    // Truncated with nothing readable in it is not a boundary anybody can name.
    // Claiming one would put a date on screen that came from nowhere.
    return { oldestISO, bounded: truncated && oldestISO != null };
}
function monthCoverage(year, monthIndex, boundary, status) {
    if (status === 'loading' || status === 'error')
        return 'unknown';
    if (!boundary.bounded || boundary.oldestISO == null)
        return 'covered';
    const oldest = Date.parse(boundary.oldestISO);
    if (!Number.isFinite(oldest))
        return 'covered';
    const monthStart = new Date(year, monthIndex, 1, 0, 0, 0, 0).getTime();
    const nextMonth = new Date(year, monthIndex + 1, 1, 0, 0, 0, 0).getTime();
    if (oldest <= monthStart)
        return 'covered';
    if (oldest >= nextMonth)
        return 'beyond';
    return 'edge';
}
/** The same question for an arbitrary run of local days — a week, a fortnight.
 *  `fromISO`/`toISO` are half-open at the end, like `weekWindow` in
 *  src/lib/gymRota.ts, so a Sunday-night session is inside its own week and a
 *  Monday-morning one is not counted in two. */
function rangeCoverage(fromMs, toMs, boundary, status) {
    if (status === 'loading' || status === 'error')
        return 'unknown';
    if (!boundary.bounded || boundary.oldestISO == null)
        return 'covered';
    const oldest = Date.parse(boundary.oldestISO);
    if (!Number.isFinite(oldest))
        return 'covered';
    if (oldest <= fromMs)
        return 'covered';
    if (oldest >= toMs)
        return 'beyond';
    return 'edge';
}
/**
 * What the screen says about a month it cannot fully see, or null when there is
 * nothing to say.
 *
 * Null for 'covered' deliberately: a note on every month is a note nobody
 * reads. The three that are not covered each get a different sentence, because
 * "we have not read that far" and "we could not read it" are different problems
 * with different next steps, and a single "something is missing" leaves the
 * reader unable to tell which.
 *
 * `dayLabel` is the caller's formatter for the boundary date — this module
 * never formats a date, because every locale decision in this repo goes through
 * `appLocale()` and a library that hardcodes one is how `check:locale` earns
 * its keep.
 */
function monthCoverageNote(coverage, boundary, dayLabel) {
    switch (coverage) {
        case 'covered':
            return null;
        case 'unknown':
            // True whether the grid is blank or showing a cached copy, because both
            // happen here: 'unknown' covers the read still being in flight AND the
            // read having failed, and a failed read leaves whatever this device had
            // before it on screen. "This month is blank" would be false in the second
            // case and the sentence would read as a rendering fault.
            return 'This month has not been read, so anything shown for it may be out of date and anything missing '
                + 'may simply not have loaded. It is not a statement that nothing happened. Pull down to try again.';
        // These two say what is MISSING rather than that the month is blank. A
        // calendar draws more than one thing — logged workouts come from a
        // different read entirely — so "this month is blank" can be false on the
        // very screen this sentence appears on, and a false sentence beside a grid
        // reads as a rendering fault rather than as missing data.
        case 'beyond':
            return boundary.oldestISO
                ? `No sessions have been read for this month. Your record is loaded back to ${dayLabel(boundary.oldestISO)} `
                    + 'and no further, so anything before that is missing from this screen rather than absent from your record.'
                : 'No sessions have been read for this month, so anything in it is missing from this screen rather than '
                    + 'absent from your record.';
        case 'edge':
            return boundary.oldestISO
                ? `Only part of this month has been read. Sessions are loaded from ${dayLabel(boundary.oldestISO)} onwards; `
                    + 'anything earlier in the month is missing from this screen rather than absent from your record.'
                : 'Only part of this month has been read, so days earlier in it may be missing from this screen.';
    }
}
/**
 * The one line an empty history is allowed to print.
 *
 * This is the single most important function in the module and it exists
 * because `[]` means four different things. Modelled on `emptyBookingsLine` in
 * src/lib/bookingsRead.ts, which made the same argument about the same screen's
 * upcoming half — a member whose read was refused was told their own record was
 * empty, in the past tense, as a fact about their life.
 *
 * Under 'partial' the list has rows by definition, so an empty one under
 * 'partial' can only mean the rows that came back all fell outside the filter —
 * and the ones that did not come back may not have. It is still not "nothing".
 */
function emptyHistoryLine(status, what = 'sessions') {
    switch (status) {
        case 'loading':
            return `Still reading your ${what}.`;
        case 'error':
            return `We could not read your ${what}, so this is not a record of nothing happening — `
                + 'it is a read that failed. Pull down to try again.';
        case 'partial':
            return `Only part of your ${what} could be read, and none of that part is here. `
                + 'There may be more on the server that this screen has not seen.';
        case 'ready':
            return `No ${what} have happened yet.`;
    }
}
