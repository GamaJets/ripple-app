"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_BLOCK_WEEKS = exports.MAX_BLOCK_DAYS = void 0;
exports.blockDates = blockDates;
exports.summariseBlocks = summariseBlocks;
exports.blockSummaryLine = blockSummaryLine;
exports.blockPlanLabel = blockPlanLabel;
exports.sessionsBlocking = sessionsBlocking;
exports.cancelAndBlockBody = cancelAndBlockBody;
exports.cancelAndBlockLabel = cancelAndBlockLabel;
// Coach · blocking more than one day at a time.
//
// ── What was there ────────────────────────────────────────────────────────
//
// `doBlock` in app/(trainer)/calendar.tsx blocks ONE day, or one hour range
// inside one day, per confirmation. That is the whole of it. A coach going away
// for a fortnight taps through fourteen sheets; a coach who never works Sunday
// blocks this Sunday and then remembers again next week, or does not.
//
// ── Why this is not the calendar-sync item ────────────────────────────────
//
// The roadmap's S6 is "let a coach block time from the phone's own calendar",
// and that is NOT what this is. Reading the device calendar needs
// `expo-calendar`, which is not a dependency of this project — so it is a new
// native module and therefore a new binary, which is exactly the objection that
// took two-way calendar sync (S3) off this wave. OTA carries JavaScript only.
//
// What is actually painful about blocking time is not that the phone knows and
// the app does not. It is that the app makes a coach do it fourteen times. That
// half ships today and needs nothing new.
//
// ── THE RULE THIS MODULE HOLDS ────────────────────────────────────────────
//
// A PARTIAL SUCCESS IS NOT A SUCCESS AND IT IS NOT A FAILURE.
//
// `block_time` refuses a day that already has a session booked in it — rightly:
// somebody arranged to be there, so the coach cancels it themselves, which
// tells the client. Over fourteen days that refusal will fire for some days and
// not others, and the two sentences a coach must never be shown are "blocked"
// (when four days are still open and bookable) and "not blocked" (when ten days
// were). Both are the app describing a diary that is not the diary.
//
// So every call's outcome is kept, and `summariseBlocks` names what happened to
// each kind. A coach who reads "10 blocked, 4 not — you have sessions booked on
// those" knows exactly what is left to do; nothing else does.
const format_1 = require("./format");
const localDate_1 = require("./localDate");
/** How many days ahead a single range may cover. Sixty is a long holiday and
 *  well short of anything that would take minutes to write; it is a guard
 *  against a slip on a picker rather than a policy about time off. */
exports.MAX_BLOCK_DAYS = 60;
/** How many weeks a weekly repeat may run for. Thirteen is a term, which is the
 *  unit coaches actually think in — and past that a standing arrangement is
 *  better expressed by not offering the hours at all. */
exports.MAX_BLOCK_WEEKS = 13;
/**
 * The local dates a plan covers, oldest first, with no duplicates.
 *
 * Built by adding to the DAY-OF-MONTH rather than by adding milliseconds. Those
 * are not the same thing twice a year: adding 86,400,000ms across a daylight
 * saving change lands at 23:00 or 01:00 the previous or next day, and a coach
 * who blocked their holiday in March would find one day of it missing and
 * another blocked twice. `setDate` moves calendar days and is correct on both
 * boundaries.
 *
 * Returns an empty array for anything outside the guards rather than clamping.
 * Clamping would block a period the coach never asked for, and the thing being
 * blocked is time clients cannot book — the failure is invisible until somebody
 * cannot get an appointment.
 */
function blockDates(plan) {
    // `localDate` and not `new Date(y, m - 1, d)`: `dateParts` returns a MONTH
    // INDEX, 0-11, and the subtraction that looks right beside a `YYYY-MM-DD`
    // string moves every range a month into the past. src/lib/localDate.ts exists
    // because this app has already shipped two off-by-one date bugs that were
    // invisible to their author, and reusing its constructor is how a third is
    // avoided rather than found later.
    const start = (0, localDate_1.localDate)(plan.from);
    if (!start)
        return [];
    if (!Number.isInteger(plan.days) || plan.days < 1 || plan.days > exports.MAX_BLOCK_DAYS)
        return [];
    if (!Number.isInteger(plan.repeatWeeks) || plan.repeatWeeks < 1 || plan.repeatWeeks > exports.MAX_BLOCK_WEEKS)
        return [];
    const seen = new Set();
    const out = [];
    for (let w = 0; w < plan.repeatWeeks; w++) {
        for (let i = 0; i < plan.days; i++) {
            const dt = new Date(start.getFullYear(), start.getMonth(), start.getDate());
            dt.setDate(dt.getDate() + w * 7 + i);
            const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
            // A run longer than a week overlaps its own repeat. Blocking the same day
            // twice is not harmful — the server answers 'already-blocked' — but it
            // costs a round trip per duplicate and makes the tally a coach reads
            // ("14 blocked") a number about calls rather than about days.
            if (seen.has(key))
                continue;
            seen.add(key);
            out.push(key);
        }
    }
    out.sort();
    return out;
}
function summariseBlocks(results) {
    const booked = results.filter((r) => r.outcome === 'booked').map((r) => r.day);
    const failed = results.filter((r) => r.outcome === 'failed').map((r) => r.day);
    return {
        blocked: results.filter((r) => r.outcome === 'blocked').length,
        booked,
        already: results.filter((r) => r.outcome === 'already-blocked').length,
        failed,
        withdrawn: results.reduce((n, r) => n + (r.withdrawn || 0), 0),
        needsAttention: booked.length > 0 || failed.length > 0,
    };
}
/** A day as a coach reads one: "12 Aug 2026". Local, via `dateParts`, so a bare
 *  date is not pulled a day backwards west of Greenwich. */
function readable(day) {
    const p = (0, localDate_1.dateParts)(day);
    return p ? (0, format_1.fmtPointDay)(p[0], p[1], p[2]) : day;
}
const list = (days) => {
    const shown = days.slice(0, 4).map(readable);
    const rest = days.length - shown.length;
    return rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ');
};
/**
 * What to tell the coach afterwards, in one paragraph.
 *
 * Every clause is about days rather than about calls, and the two refusals are
 * named separately because only one of them needs the coach to do anything. The
 * paragraph never opens with "Blocked" when something was not: a coach skimming
 * an alert takes the shape of it and not the words, and the shape has to match
 * the diary.
 */
function blockSummaryLine(s) {
    const parts = [];
    parts.push(s.blocked === 0
        ? 'Nothing was blocked.'
        : `${s.blocked} day${s.blocked === 1 ? '' : 's'} blocked — nobody can book across ${s.blocked === 1 ? 'it' : 'them'}.`);
    if (s.withdrawn > 0) {
        parts.push(`${s.withdrawn} open slot${s.withdrawn === 1 ? ' was' : 's were'} withdrawn.`);
    }
    if (s.already > 0) {
        parts.push(`${s.already} ${s.already === 1 ? 'was' : 'were'} already covered by time you had blocked before, so ${s.already === 1 ? 'it was' : 'they were'} left alone.`);
    }
    if (s.booked.length > 0) {
        parts.push(`${s.booked.length} could not be blocked because you have a session booked: ${list(s.booked)}. Cancel those yourself — that tells the client — and then block the day.`);
    }
    if (s.failed.length > 0) {
        parts.push(`${s.failed.length} did not save at all, so ${s.failed.length === 1 ? 'that day is' : 'those days are'} still bookable: ${list(s.failed)}. Try again once you have signal.`);
    }
    return parts.join(' ');
}
/** The label on the confirm button, so the coach reads what they are about to
 *  do rather than a generic verb. Null when the plan covers nothing, which is
 *  the caller's cue to disable it. */
function blockPlanLabel(plan) {
    const days = blockDates(plan);
    if (days.length === 0)
        return null;
    if (days.length === 1)
        return 'Block This Day';
    return `Block ${days.length} Days`;
}
/* ── The days that refused, and what to do about them ─────────────────────
 *
 * `blockSummaryLine` names the booked days and then says "Cancel those
 * yourself — that tells the client — and then block the day." Every word of
 * that is true and the alert it sits in has one button on it. A fortnight away
 * with four standing clients therefore means leaving the sheet, finding four
 * separate days in the grid, and repeating a flow the alert could have driven
 * from the list it had just printed. Any day the coach gives up on stays
 * bookable while they are abroad.
 *
 * What is here is the SELECTION, which is the part that can be got wrong
 * quietly: which sessions are actually in the way. The cancelling itself stays
 * on the screen, because it notifies a client and promotes a waitlist and both
 * of those are the coach's calls to make, not a library's.
 */
/** The local `YYYY-MM-DD` an instant falls on, in the reader's own zone.
 *
 *  Local getters and not `toISOString().slice(0, 10)`: a 7am session in
 *  Kiritimati is the previous day in UTC, and a coach blocking Tuesday would be
 *  shown Monday's client as the thing in the way. */
function localDayOf(iso) {
    const ms = Date.parse(iso);
    if (!isFinite(ms))
        return null;
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/**
 * The booked sessions standing in the way of a block, soonest first.
 *
 * Only `booked`. An OPEN slot inside the period is not in anybody's way and is
 * never in this list: `block_time` withdraws those itself as it writes, and
 * `BlockResult.withdrawn` is how many it took. Offering to "cancel" an hour
 * nobody holds would invent a client.
 *
 * A session whose timestamp will not parse is dropped rather than guessed at.
 * It cannot be matched to a day, and a cancellation aimed at the wrong day is
 * the one outcome here that costs somebody their appointment.
 */
function sessionsBlocking(days, sessions) {
    const want = new Set(days);
    return sessions
        .filter((s) => s.status === 'booked')
        .filter((s) => { const k = localDayOf(s.startsAt); return !!k && want.has(k); })
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
/**
 * What the confirm says before the app cancels somebody's session for them.
 *
 * It states all three consequences, because a coach reaching for a shortcut out
 * of an alert has not necessarily thought about any of them: the client is
 * told, the hour goes back on the market, and only then is the day blocked.
 */
function cancelAndBlockBody(n, who) {
    const shown = who.slice(0, 4);
    const rest = who.length - shown.length;
    const names = rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ');
    const head = n === 1
        ? `1 session is in the way: ${names}.`
        : `${n} sessions are in the way: ${names}.`;
    return `${head} Cancelling ${n === 1 ? 'it' : 'them'} tells ${n === 1 ? 'that client' : 'each client'}, and the hour goes to whoever is next on its waitlist. Those days are then blocked so nobody can book across them.`;
}
/** The label on that confirm, so the coach reads what they are about to do
 *  rather than a generic verb. */
function cancelAndBlockLabel(n) {
    return n === 1 ? 'Cancel It And Block' : `Cancel ${n} And Block`;
}
