"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DAYS_AHEAD = exports.DAYS_BEHIND = void 0;
exports.daysBetweenIso = daysBetweenIso;
exports.shiftIso = shiftIso;
exports.planWindow = planWindow;
exports.sideOf = sideOf;
exports.coachWeek = coachWeek;
exports.dayHeading = dayHeading;
exports.whenLabel = whenLabel;
exports.coachPlanLine = coachPlanLine;
exports.coachConflictLine = coachConflictLine;
exports.programmeCaveat = programmeCaveat;
exports.planNote = planNote;
// One client's planned week, arranged for the person coaching them.
//
// `planned_days` shipped with a `planned_days_coach_read` policy written for
// exactly this and nothing read it. A client could mark Thursday as a travel
// day and Friday as legs, and the only person who could see either was the
// client — so a coach spent Friday afternoon chasing a session that had been
// called off on Sunday.
//
// ── This file adds no vocabulary ───────────────────────────────────────────
//
// Every judgement below is src/lib/dayPlan.ts's: `planOutcome` decides what may
// be said about a day, `planConflict` decides whether a mark and the programme
// disagree, and `DAY_TYPE_LABEL` names the day. What is here is the arrangement
// — which days are in view, which side of today they sit, and the same
// sentences re-voiced for a coach reading about somebody else. dayPlan speaks
// to the client in the second person ("Your program schedules Push"); handing
// those strings to a coach would have them read a sentence addressed to the
// wrong person about a programme that is theirs, not the reader's.
//
// ── A plan is still not a record, and here it is not even a claim ──────────
//
// The screen this feeds does NOT read the client's training log, and that is a
// decision rather than an omission. `workouts.performed_at` is a timestamptz —
// an instant — so turning it into "was anything logged on their Tuesday"
// requires the client's own timezone, and the schema stores no such column.
// Answering it in the COACH's zone would attribute a client's late-evening
// session to the following day for half the pairs of people using this app,
// and it would do so silently.
//
// So every row here goes through `planOutcome` with `logged` null, which is the
// tri-state's own meaning of "the log did not answer" — it did not, because it
// was not asked. A passed day therefore comes back 'log-unknown' and the coach
// is told plainly that this screen cannot say what happened. That is the whole
// of the guard the header of dayPlan.ts asks for: there is no input to this
// module that makes it say a plan was kept.
//
// Pure and dependency-free apart from dayPlan, localDate and the app's own date
// formatters, so the window arithmetic can be run under the six zones the repo
// tests in. format.ts is pure too: it reads a locale and writes a string, and
// touches no clock, no zone and no storage.
const localDate_1 = require("./localDate");
const format_1 = require("./format");
const dayPlan_1 = require("./dayPlan");
/**
 * How much of the past is worth showing, in days.
 *
 * A week, and no more. The only thing a passed plan adds is the reason a
 * session did not happen — "they marked Thursday as travel" is what stops a
 * coach opening a chasing message — and that reason is stale within days.
 * Further back it is a list of intentions nobody can check against anything,
 * which is noise wearing the same shape as information.
 */
exports.DAYS_BEHIND = 7;
/**
 * How far forward, counting today, in days.
 *
 * A fortnight rather than a week, because the things worth catching are planned
 * in weekly units and a seven-day window shows them too late. A deload week
 * starting Monday appears in a rolling week's view on Monday — the day it
 * begins, by which point the programme for it is already the wrong programme.
 * Fourteen days always contains the whole of the next calendar week whatever
 * day the coach opens this, which is the horizon a coach can still act on.
 */
exports.DAYS_AHEAD = 14;
/**
 * Whole days from `a` to `b`, or null when either will not parse.
 *
 * Built with `Date.UTC` on the parts read out of each string, which is NOT the
 * bug src/lib/localDate.ts describes. That bug is parsing a bare date and then
 * reading it back through local getters; here both endpoints are constructed
 * from digits and only ever subtracted from one another, so no timezone is
 * consulted in either direction and no DST transition can shorten a day.
 */
function daysBetweenIso(a, b) {
    const pa = (0, localDate_1.dateParts)(a), pb = (0, localDate_1.dateParts)(b);
    if (!pa || !pb)
        return null;
    const ms = Date.UTC(pb[0], pb[1], pb[2]) - Date.UTC(pa[0], pa[1], pa[2]);
    return Math.round(ms / 86400000);
}
/** The bare date `days` either side of this one, or null when unreadable. */
function shiftIso(dateISO, days) {
    const p = (0, localDate_1.dateParts)(dateISO);
    if (!p)
        return null;
    const d = new Date(Date.UTC(p[0], p[1], p[2] + days));
    const pad = (n) => (n < 10 ? '0' + n : String(n));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function planWindow(todayISO, behind = exports.DAYS_BEHIND, ahead = exports.DAYS_AHEAD) {
    // `ahead` counts today, so the last day in view is ahead - 1 from here.
    const fromISO = shiftIso(todayISO, -behind);
    const toISO = shiftIso(todayISO, ahead - 1);
    return fromISO && toISO ? { fromISO, toISO } : null;
}
function sideOf(dateISO, todayISO) {
    const c = (0, dayPlan_1.compareIsoDays)(dateISO, todayISO);
    if (c == null)
        return null;
    return c < 0 ? 'gone' : c === 0 ? 'today' : 'ahead';
}
/** 0 Sun … 6 Sat for a bare date, built locally so the weekday is the one the
 *  client would name. Same rule as `weekdayOfIso`, which this defers to via
 *  dateParts rather than re-deriving. */
function weekdayOf(dateISO) {
    const p = (0, localDate_1.dateParts)(dateISO);
    return p ? new Date(p[0], p[1], p[2]).getDay() : null;
}
/** A fresh one each time. Sharing a frozen constant would hand every caller the
 *  same arrays, which is fine until one of them sorts in place. */
const empty = (state) => ({ state, ahead: [], gone: [], conflicts: [] });
/**
 * Arrange one client's marks around the coach's today.
 *
 * `days` null means the read failed and is the ONLY thing that produces
 * 'unreadable'. An empty array is a real answer — this client has marked
 * nothing in these three weeks — and the screen is expected to say so in words
 * that do not read as a failure.
 *
 * Rows outside the window are dropped here as well as in the query. The filter
 * is cheap and it means the arrangement can be tested without a database, which
 * is the half of this that can be quietly wrong.
 */
function coachWeek(days, todayISO, focusOn, window = planWindow(todayISO)) {
    if (!days)
        return empty('unreadable');
    if (!window)
        return empty('none');
    const rows = [];
    for (const plan of days) {
        const side = sideOf(plan.dateISO, todayISO);
        const offset = daysBetweenIso(todayISO, plan.dateISO);
        if (!side || offset == null)
            continue; // a date that will not parse is not a day
        const fromC = (0, dayPlan_1.compareIsoDays)(plan.dateISO, window.fromISO);
        const toC = (0, dayPlan_1.compareIsoDays)(plan.dateISO, window.toISO);
        if (fromC == null || fromC < 0)
            continue;
        if (toC == null || toC > 0)
            continue;
        const outcome = (0, dayPlan_1.planOutcome)(plan.type, plan.dateISO, todayISO, null);
        if (!outcome)
            continue;
        const weekday = weekdayOf(plan.dateISO);
        // A date with no readable weekday cannot be matched against a programme, so
        // the programme is unknown for it rather than empty.
        const scheduled = weekday == null ? undefined : focusOn(weekday);
        rows.push({ plan, side, outcome, conflict: (0, dayPlan_1.planConflict)(plan.type, scheduled), offset });
    }
    const ahead = rows.filter((r) => r.side !== 'gone').sort((a, b) => a.offset - b.offset);
    const gone = rows.filter((r) => r.side === 'gone').sort((a, b) => b.offset - a.offset);
    return {
        state: rows.length ? 'planned' : 'none',
        ahead,
        gone,
        conflicts: ahead.filter((r) => r.conflict),
    };
}
/* ── the same sentences, addressed to the coach ────────────────────────────── */
/**
 * 'Thu 3 Sep' — and 'Do 3 Sep', '木 9月3日', in the coach's own language.
 *
 * The date is still read out of its PARTS and never out of `new Date(dateISO)`:
 * `dateParts` and `weekdayOf` are what make this the client's own calendar day
 * in every zone, and `fmtAxisDay` takes year, month index and day as numbers so
 * there is nothing left to parse. What has gone is the pair of English arrays
 * this used to assemble from.
 *
 * The old header argued the other way — "assembled rather than handed to
 * toLocaleDateString ... this string is asserted in a test, and a formatter
 * that changes underneath both makes the test meaningless". The test was the
 * thing that needed changing: a coach reading a Norwegian phone was shown an
 * English weekday over every day of their week so that a literal in a test file
 * could stay short. The test now derives the shape it expects.
 */
function dayHeading(dateISO) {
    const p = (0, localDate_1.dateParts)(dateISO);
    if (!p)
        return '—';
    const wd = weekdayOf(dateISO);
    return `${wd == null ? '' : (0, format_1.weekdayNameShort)(wd) + ' '}${(0, format_1.fmtAxisDay)(p[0], p[1], p[2])}`;
}
/** 'Today', 'Tomorrow', 'In 4 days', 'Yesterday', '5 days ago'. Which side of
 *  today a date is on has to be legible without counting dates in your head. */
function whenLabel(dateISO, todayISO) {
    const n = daysBetweenIso(todayISO, dateISO);
    if (n == null)
        return '—';
    if (n === 0)
        return 'Today';
    if (n === 1)
        return 'Tomorrow';
    if (n === -1)
        return 'Yesterday';
    return n > 0 ? `In ${n} days` : `${-n} days ago`;
}
/**
 * What may be said about one planned day, to their coach.
 *
 * Every branch is a named member of `PlanOutcome` and none of them says the
 * plan was kept. Three of the six cannot occur while this screen does not read
 * the training log; they are written anyway rather than left to a default,
 * because the day somebody adds that read is the day a missing branch becomes
 * a blank line under a client's name — and because the wording is where the
 * rule lives, so it should be reviewable now rather than improvised then.
 */
function coachPlanLine(type, outcome, who) {
    const label = dayPlan_1.DAY_TYPE_LABEL[type].toLowerCase();
    switch (outcome) {
        case 'not-yet':
            return `${who} has marked this a ${label}. It hasn’t happened yet — this is what they intend, not what they did.`;
        case 'today':
            return `${who} has marked today a ${label}. The day is still running, so there is nothing to hold it against yet.`;
        case 'log-unknown':
            return `${who} marked this a ${label} and the day has gone. This screen doesn’t read their training log, so it can’t tell you whether anything was logged against it.`;
        case 'nothing-logged':
            return `${who} marked this a ${label} and nothing was logged on the day. That is not evidence they kept to it — an unlogged session looks exactly the same from here.`;
        case 'log-agrees':
            return `${who} marked this a ${label} and there is training logged on the day. The log is what happened; this row is only what they meant to do.`;
        case 'log-disagrees':
            return `${who} marked this a ${label} and there is training logged on the day. Both stand as they are — neither has been changed to match the other.`;
    }
}
/**
 * A disagreement between the mark and the programme, to the coach who wrote the
 * programme. `planConflict` decides whether there is one; this only says it in
 * the right voice, and says it as something to raise rather than something to
 * fix here — nothing on this screen writes to either side.
 */
function coachConflictLine(conflict, type, who) {
    const label = dayPlan_1.DAY_TYPE_LABEL[type].toLowerCase();
    return conflict.kind === 'plan-schedules-a-session'
        ? `Your programme puts ${conflict.focus} on this day and ${who} has marked it a ${label}. Worth agreeing which one stands before the day arrives.`
        : `${who} has marked this a training day and your programme schedules nothing on it. Their mark doesn’t add a session to the programme — it says what they intend to do.`;
}
/**
 * Why no day on this screen is being compared against a programme, or null when
 * they are. Said out loud because a screen showing no conflicts looks identical
 * whether it checked and found none or never checked at all.
 */
function programmeCaveat(known, who) {
    return known
        ? null
        : `No programme of yours is assigned to ${who} that this app can read, so nothing below has been checked against one. That is not the same as their week agreeing with it.`;
}
/** The client's own words on a day, or null. Where a travel day and a refeed
 *  live until the app can act on either — which makes the note the only place
 *  the reason for a marked day is ever written down. */
function planNote(day) {
    const n = (day.plan.note ?? '').trim();
    return n || null;
}
