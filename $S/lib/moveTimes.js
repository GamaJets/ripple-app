"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MOVE_AT_NOT_MOVED = exports.MOVE_TIMES_CAP = exports.MOVE_DAY_END_MIN = exports.MOVE_DAY_START_MIN = exports.MOVE_STEP_MIN = void 0;
exports.workWindows = workWindows;
exports.moveTimes = moveTimes;
exports.groupMoveTimes = groupMoveTimes;
exports.moveTimesCaveat = moveTimesCaveat;
exports.emptyMoveTimesLine = emptyMoveTimesLine;
exports.moveAtRefusalLine = moveAtRefusalLine;
exports.moveAtConfirmBody = moveAtConfirmBody;
/** Quarter-hour. Finer than a coach thinks in and coarse enough that a day is
 *  a list rather than a wall of numbers. */
exports.MOVE_STEP_MIN = 15;
/**
 * The bounds of the day when the coach has stated no working hours for it.
 *
 * Deliberately not 00:00–24:00. A coach with no availability row for Tuesday —
 * which after part 731 is a real and common state, because slot generation
 * skipped every row with a null timezone and nothing backfilled it — would
 * otherwise be handed ninety-six times, most of them the middle of the night.
 * These bounds are a PRESENTATION default and make no claim about the coach's
 * life: every time inside them is still checked against the diary, and a coach
 * who works at 4am reaches it through their weekly availability, which is where
 * that fact belongs.
 */
exports.MOVE_DAY_START_MIN = 5 * 60;
exports.MOVE_DAY_END_MIN = 22 * 60;
/** How many times one day may offer. A guard on the render, not on the diary:
 *  a fifteen-minute grid over a seventeen-hour day is sixty-eight rows. */
exports.MOVE_TIMES_CAP = 96;
const MIN = 60000;
/**
 * The weekday's availability rows, merged into windows.
 *
 * `trainer_availability` holds one row per offered slot — a coach who works
 * Tuesday 07:00 to 19:00 has forty-eight of them after `expandRange`
 * (src/lib/availabilityRange.ts), each 15 minutes long and each abutting the
 * next. Offering a move only at the START of each of those is the same dead end
 * one level down, so they are merged: touching or overlapping rows become one
 * window and the grid runs across it.
 *
 * Rows for other weekdays are dropped, not merged in. A window is a statement
 * about one day of the week.
 */
function workWindows(slots, dow) {
    const spans = slots
        .filter((s) => s.dow === dow)
        .map((s) => ({
        startMin: Math.max(0, s.hour * 60 + s.minute),
        endMin: Math.max(0, s.hour * 60 + s.minute) + Math.max(0, s.dur),
    }))
        .filter((s) => s.endMin > s.startMin)
        .sort((a, b) => a.startMin - b.startMin);
    const out = [];
    for (const s of spans) {
        const last = out[out.length - 1];
        // `>=` rather than `>`: 07:00–07:15 and 07:15–07:30 are one window, and
        // treating them as two would put a seam at every quarter hour.
        if (last && s.startMin <= last.endMin)
            last.endMin = Math.max(last.endMin, s.endMin);
        else
            out.push({ startMin: s.startMin, endMin: s.endMin });
    }
    return out;
}
/**
 * The times on one local day that this coach could move a session into.
 *
 * Built from local wall-clock components rather than by adding milliseconds to
 * a midnight, and that is a daylight-saving decision. "8am on Sunday" is a
 * wall-clock fact; `midnight + 8 * 3600_000` is 7am or 9am on the two Sundays a
 * year a clock moves, and `npm run test:zones` runs this under Auckland and Los
 * Angeles, whose transitions fall in opposite months. Spring-forward also makes
 * two grid entries name the same instant — 02:30 and 03:30 both resolve to
 * 03:30 — so the list is de-duplicated on the instant.
 */
function moveTimes(input) {
    const step = Math.max(5, input.stepMin ?? exports.MOVE_STEP_MIN);
    const dur = Math.max(1, input.durationMin);
    const isSelf = (b) => b.kind !== 'class' && b.id != null && b.id === input.movingId;
    // The hour it is already in. Not an obstacle — the server frees it before it
    // books the new one, so 7:00–8:00 may move to 7:30 — but not an offer either:
    // part 1830 answers 'same-time' to a move that changes nothing, and a row a
    // coach can tap for no effect is a row that should not be there.
    const selfStart = input.blockers.filter(isSelf)
        .map((b) => Date.parse(b.startsAt)).find((n) => Number.isFinite(n)) ?? null;
    const busy = input.blockers
        .filter((b) => !isSelf(b))
        .map((b) => ({ s: Date.parse(b.startsAt), e: Date.parse(b.startsAt) + Math.max(0, b.durationMin) * MIN }))
        .filter((b) => Number.isFinite(b.s));
    const openAt = new Map();
    for (const o of input.open) {
        const ms = Date.parse(o.startsAt);
        // Only an EXACT match counts. An open 30-minute slot at 8am is not a place
        // to put a 60-minute session, and quietly stretching it would publish a
        // booking across an hour the coach never opened while telling them nothing
        // new was created.
        if (Number.isFinite(ms) && o.durationMin === dur && !openAt.has(ms))
            openAt.set(ms, o.id);
    }
    const windows = input.work.length
        ? input.work.map((w) => ({ startMin: w.startMin, endMin: w.endMin }))
        : [{ startMin: exports.MOVE_DAY_START_MIN, endMin: exports.MOVE_DAY_END_MIN }];
    const stated = input.work.length > 0;
    const seen = new Set();
    const out = [];
    const dayStart = stated ? exports.MOVE_DAY_START_MIN : windows[0].startMin;
    const dayEnd = stated ? exports.MOVE_DAY_END_MIN : windows[0].endMin;
    // When the coach HAS stated hours, the grid still runs across the whole
    // presentation day so a deliberately unusual time is reachable; the stated
    // windows then decide `inHours` rather than deciding what exists. When they
    // have not, there is nothing to be outside of and the day is the grid.
    const lo = stated ? Math.min(dayStart, ...windows.map((w) => w.startMin)) : dayStart;
    const hi = stated ? Math.max(dayEnd, ...windows.map((w) => w.endMin)) : dayEnd;
    for (let m = lo; m <= hi - dur && out.length < exports.MOVE_TIMES_CAP; m += step) {
        // Hours past 23 are not rolled into the next day by hand — `Date` does that
        // itself, correctly, and a window running to 24:00 is the ordinary way to
        // say "until midnight".
        const d = new Date(input.year, input.monthIndex, input.day, Math.floor(m / 60), m % 60, 0, 0);
        const ms = d.getTime();
        if (!Number.isFinite(ms) || seen.has(ms))
            continue;
        seen.add(ms);
        if (ms <= input.nowMs)
            continue;
        if (selfStart != null && ms === selfStart)
            continue;
        const end = ms + dur * MIN;
        if (busy.some((b) => ms < b.e && b.s < end))
            continue;
        // False for every time on a day the coach has stated no hours for. The
        // fallback window is a presentation bound, not a claim about their working
        // life, and dressing it up as one would put "inside your working hours"
        // under a day they never opened.
        const inHours = stated && windows.some((w) => m >= w.startMin && m + dur <= w.endMin);
        out.push({ startsAt: d.toISOString(), startMs: ms, slotId: openAt.get(ms) ?? null, inHours });
    }
    return out;
}
/** The two groups the sheet draws, in the order it draws them. Never sorted
 *  together: a coach scanning for 8am should not have to read past 05:00. */
function groupMoveTimes(times) {
    return {
        inHours: times.filter((t) => t.inHours),
        outside: times.filter((t) => !t.inHours),
    };
}
/**
 * What the list of free times cannot promise, or null when it can promise
 * everything it says.
 *
 * Three separate reads stand behind the word "free" and each of them fails on
 * its own. They are reported separately rather than folded into one "something
 * is missing", because the next step differs: an unread class timetable means
 * check the timetable, an unread diary means pull to refresh, and neither is
 * "the server will sort it out".
 *
 * The sessions read is deliberately NOT handled here. Under 'error' there is no
 * list at all and the sheet says so instead of qualifying an empty one — see
 * `emptyMoveTimesLine`.
 */
function moveTimesCaveat(sessions, classes) {
    const parts = [];
    if (sessions === 'partial') {
        parts.push('Only part of your calendar came back, so a time listed here may already have something in it.');
    }
    if (classes === 'error') {
        parts.push('Your class timetable could not be read, so these times do not account for a class you are down to teach.');
    }
    else if (classes === 'partial') {
        parts.push('Only part of your class timetable came back, so these times may not account for every class you teach.');
    }
    if (!parts.length)
        return null;
    // The reassurance goes last and it is a real one: part 1830 re-checks all
    // three under the row lock and refuses with the obstacle named, so the worst
    // outcome of a stale list is a refusal rather than a double booking.
    parts.push('The move is checked again on the server, so an occupied hour is refused rather than booked twice.');
    return parts.join(' ');
}
/**
 * The one line an empty list of times is allowed to print.
 *
 * Five answers, because `[]` means five things here. The fifth is the one this
 * whole module exists for and it is a real state, not a defensive branch: a
 * coach whose day is genuinely full has nowhere to move a client TO on that
 * day, and telling them that plainly — rather than "no open slots", which sent
 * them to Weekly Availability — is the difference between picking another day
 * and cancelling somebody.
 */
function emptyMoveTimesLine(status, dayLabel, statedHours) {
    switch (status) {
        case 'loading':
            return `Still reading your calendar for ${dayLabel}.`;
        case 'error':
            return `Your calendar could not be read, so the hours you have free on ${dayLabel} are not known. `
                + 'Nothing is listed because nothing came back. Pull down to refresh and try again.';
        case 'partial':
            return `Only part of your calendar came back, so what is free on ${dayLabel} is not established. `
                + 'Pull down to refresh and open this again.';
        case 'ready':
            return statedHours
                ? `Every hour of ${dayLabel} already has something of yours in it, so there is nowhere to move this to `
                    + 'on that day. Try another day.'
                : `Every hour of ${dayLabel} already has something of yours in it. You have not set working hours for `
                    + 'that day, so only the daytime was looked at — set them in Weekly Availability, or try another day.';
    }
}
exports.MOVE_AT_NOT_MOVED = {
    moved: false, reason: 'unreachable', clientId: null, sessionId: null,
    promoted: false, waiting: 0, className: null,
};
/**
 * What to say when a move to a chosen time did not happen.
 *
 * Every branch ends with the state of the world, for the reason
 * `coachMoveRefusalLine` states next door: a refusal is indistinguishable from
 * a failure unless somebody says so, and the one thing a coach must not walk
 * away believing is that a client's hour has changed when it has not.
 *
 * `unreachable` is the only branch that does not assert where the session is,
 * because it is the only one where nobody knows.
 */
function moveAtRefusalLine(r, who, at, to) {
    const subject = who && at ? `${who}'s ${at} session` : who ? `${who}'s session` : at ? `The ${at} session` : 'That session';
    const still = `${subject} has not moved and is still booked as it was.`;
    const target = to ? `${to} ` : 'That time ';
    switch (r.reason) {
        case 'clash-booked':
            return `${target}already has a session of yours booked across it. ${still} Pick another time.`;
        case 'clash-blocked':
            return `${target}is inside time you marked as unavailable. ${still} Pick another time, or unblock it first.`;
        case 'clash-class':
            return r.className
                ? `You are down to teach ${r.className} across ${to ?? 'that time'}. ${still} Pick another time.`
                : `You are down to teach a class across ${to ?? 'that time'}. ${still} Pick another time.`;
        case 'clash':
            return `Something of yours landed across ${to ?? 'that time'} while this was being sent, so the hour is no `
                + `longer free. ${still} Pull down to refresh and pick another time.`;
        case 'already-started':
            return `That session has already begun, so there is nothing to move. ${still} Mark what happened instead.`;
        case 'past':
            return `${target}has already passed. ${still} Pick a time still ahead of now.`;
        case 'not-yours':
            return `${still} It may have been cancelled or moved from the client's own phone since this screen loaded. `
                + 'Pull down to refresh and look again.';
        case 'same-time':
            return `${still} That is the hour it is already in.`;
        case 'bad-time':
            return `${target}was not a time the server would accept, so nothing was changed. ${still} Pick another time.`;
        case 'unreachable':
        default:
            return `The move did not reach the server, so it may or may not have happened. Do not tell `
                + `${who ?? 'the client'} anything yet. Pull down to refresh and check where the session is before trying again.`;
    }
}
/**
 * The confirm in front of a move to a time the coach had not opened.
 *
 * One sentence more than the open-slot confirm next to it, and the extra
 * sentence is the whole difference between the two acts: this one PUTS A NEW
 * HOUR IN THE DIARY. A coach who does not know that will not know to look for
 * it, and the two facts after it are the server's — part 1830 writes nothing to
 * `charges` and carries the credit rather than drawing a second one.
 */
function moveAtConfirmBody(who, from, to, inHours) {
    return `${who} moves from ${from} to ${to}.\n\n`
        + `${to} is not one of your open slots, so this puts the session straight into your diary at that time. `
        + (inHours ? '' : 'It is outside the working hours you have set for that day. ')
        + 'Nothing is charged and no session comes off their pack — it is the same session at a different time. '
        + `${from} goes back on your calendar, or straight to whoever is first in line for it. `
        + 'They are notified once it has moved.';
}
