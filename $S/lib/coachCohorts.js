"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COHORT_FLOOR_NOTE = exports.COHORT_CAVEAT = exports.MILESTONES = void 0;
exports.yearOnYear = yearOnYear;
exports.monthsUntilYearOnYear = monthsUntilYearOnYear;
exports.yearOnYearLine = yearOnYearLine;
exports.cohorts = cohorts;
exports.cohortsBlocker = cohortsBlocker;
// Two questions a month-on-month figure cannot answer, and the floors under
// both of them.
//
// app/(trainer)/analytics.tsx compares this month with last month and stops
// there. Coaching is seasonal — January and September are not March, and
// Ramadan, school holidays and a European summer each move a book by a third —
// so "down 18% on last month" is a sentence about the calendar at least as
// often as it is a sentence about the coach. A coach who reads it as the second
// discounts their prices in August.
//
// So: the same month last year, and how long people stay.
//
// ── The rule this module exists to hold ───────────────────────────────────
//
// A COMPARISON IS WITHHELD UNTIL THERE IS SOMETHING TO COMPARE.
//
// Both answers here are ratios, and a ratio over a small denominator is not a
// less precise answer — it is a different and confident one. Three of five
// clients leaving is "40% retained" beside a two-hundred-member gym's 40%, and
// the two numbers mean nothing like the same thing. The console already draws
// this line for the gym (`MIN_COHORT_FOR_RATE` in src/lib/gymRetention.ts) and
// this module uses the SAME floor rather than picking a second one, so the two
// surfaces cannot end up disagreeing about what "too small to say" means.
//
// The year-on-year half has its own floor and it is not a size, it is an age: a
// comparison against a month nobody recorded is not a weak comparison, it is a
// fabricated one. `yearOnYear` returns null rather than reaching for the
// nearest month it does have — see src/lib/monthlyHistory.ts, whose whole
// header is about that exact substitution.
//
// Pure. No supabase, no react-native, no clock — `now` is passed in.
const format_1 = require("./format");
const monthlyHistory_1 = require("./monthlyHistory");
const gymRetention_1 = require("./gymRetention");
/**
 * This month against the same month a year ago, or null when there is no
 * comparison to make.
 *
 * Null in three cases and they are deliberately not distinguished by the return
 * value — `yearOnYearLine` says which — because a caller that has to branch on
 * three nulls will collapse them:
 *
 *   · this month has no recorded figure (the read that feeds it was not whole);
 *   · twelve months ago has none, which is every coach in their first year;
 *   · the history could not be read at all, which is the caller's `status`.
 *
 * The month index arithmetic goes through the Date constructor —
 * `new Date(y, m - 12, 1)` — rather than subtracting 1 from the year, because
 * that is the one form that is right in December and January without a special
 * case, and it is what `monthWindow` already does.
 */
function yearOnYear(snapshots, now) {
    const thisKey = (0, monthlyHistory_1.monthKey)(now);
    const backDate = new Date(now.getFullYear(), now.getMonth() - 12, 1);
    const backKey = (0, monthlyHistory_1.monthKey)(backDate);
    const a = snapshots[thisKey];
    const b = snapshots[backKey];
    if (typeof a !== 'number' || !Number.isFinite(a))
        return null;
    if (typeof b !== 'number' || !Number.isFinite(b))
        return null;
    const delta = a - b;
    return {
        monthKey: thisKey,
        now: a,
        then: b,
        delta,
        pct: b === 0 ? null : Math.round((delta / Math.abs(b)) * 100),
    };
}
/**
 * How many months of history stand between the coach and a year-on-year read.
 *
 * Reported rather than merely absent, because "not yet" and "never" are
 * different sentences and the first one has a date on it. A coach eight months
 * in wants to know it is four months away, not that the feature is missing.
 *
 * Counts the months actually RECORDED between the target month and now, so a
 * coach whose history has holes in it is told the truth about the holes.
 */
function monthsUntilYearOnYear(snapshots, now) {
    const backKey = (0, monthlyHistory_1.monthKey)(new Date(now.getFullYear(), now.getMonth() - 12, 1));
    if (typeof snapshots[backKey] === 'number')
        return 0;
    // The oldest recorded month decides. Anything older than twelve months back
    // means the gap is a hole rather than a shortage of history, and the honest
    // answer there is still "we have no figure for that month" — reported as 0
    // months to wait, with `yearOnYearLine` saying which of the two it is.
    const keys = Object.keys(snapshots).filter((k) => typeof snapshots[k] === 'number').sort();
    if (!keys.length)
        return 12;
    const oldest = keys[0];
    const [oy, om] = oldest.split('-').map(Number);
    const idx = (y, m) => y * 12 + (m - 1);
    const have = idx(now.getFullYear(), now.getMonth() + 1) - idx(oy, om);
    return Math.max(0, 12 - have);
}
/**
 * The sentence where a year-on-year comparison would have gone.
 *
 * Sentence case, prose under a heading. It never says "no change" and it never
 * says "flat": both of those are claims about the coach's trading, and every
 * branch here is a statement about what was recorded.
 */
function yearOnYearLine(snapshots, now, status) {
    if (status === 'loading')
        return 'Reading the months you have recorded…';
    if (status === 'error') {
        return 'Your recorded months could not be read, so this is not "no history" — there may be a year of them on your account this phone has not got. Nothing has been lost.';
    }
    const wait = monthsUntilYearOnYear(snapshots, now);
    if (wait > 0) {
        return `A year-on-year read needs the same month last year, and that month is ${(0, format_1.num)(wait)} ${wait === 1 ? 'month' : 'months'} away. A snapshot is recorded each month, so it appears on its own.`;
    }
    const thisKey = (0, monthlyHistory_1.monthKey)(now);
    if (typeof snapshots[thisKey] !== 'number') {
        return 'This month has not been recorded, so there is nothing to set against last year. A month is only recorded once the figures behind it come back whole.';
    }
    return 'The same month last year was never recorded, so there is nothing to compare against. That is a gap in the history rather than a quiet month.';
}
/** The milestones, in months. Twelve is the last one because a year is the
 *  span a coach thinks in and a longer one would be null for almost every
 *  cohort this product has. */
exports.MILESTONES = [1, 3, 6, 12];
const MONTH_MS = 30.436875 * 86400000;
/** Whole months between two instants, floored. Calendar-accurate enough for a
 *  retention milestone and deliberately not calendar arithmetic: "still here
 *  after six months" is a duration, not a date on a calendar, and using
 *  `setMonth` would make somebody who joined on the 31st retain a day late. */
const monthsBetween = (fromMs, toMs) => Math.floor((toMs - fromMs) / MONTH_MS);
/**
 * Join-month cohorts and how many of each were still coaching at each
 * milestone.
 *
 * ── Why the ENDED relationships have to be in `spans` ─────────────────────
 *
 * The obvious version of this reads the roster, groups by join month and counts
 * who is still there — and it produces 100% at every milestone forever, because
 * the roster IS the people who did not leave. It is a survivorship curve drawn
 * as a retention curve, it looks like the best-run coaching business in the
 * world, and nothing on it says otherwise. So the caller must pass every
 * relationship, ended ones included, and `cohortsBlocker` refuses when it
 * cannot.
 *
 * ── Why a milestone the cohort has not reached is null ────────────────────
 *
 * A cohort that started three months ago has not had a chance to survive six.
 * Counting them as not retained is the same arithmetic error as counting an
 * unfinished month as a low-churn month, pointing the other way: it draws a
 * cliff at whatever milestone the newest cohorts have not reached, on the right
 * hand side of the chart, exactly where a reader's eye ends up.
 */
function cohorts(spans, now) {
    const nowMs = now.getTime();
    const by = new Map();
    for (const s of spans) {
        const st = Date.parse(s.startedAt);
        if (!Number.isFinite(st))
            continue;
        const key = (0, monthlyHistory_1.monthKey)(new Date(st));
        const en = s.endedAt ? Date.parse(s.endedAt) : NaN;
        const list = by.get(key);
        const row = { started: st, ended: Number.isFinite(en) ? en : null };
        if (list)
            list.push(row);
        else
            by.set(key, [row]);
    }
    const out = [];
    for (const [month, people] of [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const size = people.length;
        const tooSmall = size < gymRetention_1.MIN_COHORT_FOR_RATE;
        // Has the whole cohort had time to reach this milestone? Measured from the
        // LATEST joiner in the month, so a cohort is only reported once every one
        // of its members has had the full span — a mixed answer would be a figure
        // over a denominator that is partly the calendar.
        const latest = Math.max(...people.map((p) => p.started));
        const held = exports.MILESTONES.map((m) => {
            if (monthsBetween(latest, nowMs) < m)
                return null;
            return people.filter((p) => p.ended == null || monthsBetween(p.started, p.ended) >= m).length;
        });
        const retained = held.map((h) => (h == null || tooSmall ? null : Math.round((h / size) * 100)));
        out.push({ month, size, retained, held, tooSmall });
    }
    return out;
}
/**
 * Why the cohort curve may not be drawn, or null when it may.
 *
 * `spanStatus` is the read of `coaching_relationships` — every relationship,
 * ended included. Refuses under anything but a whole read, and the reason is
 * the survivorship argument above: a retention curve missing its endings is not
 * a rougher curve, it is a flat line at 100%.
 */
function cohortsBlocker(spanStatus) {
    if (spanStatus === 'loading')
        return 'Reading who has started and finished with you…';
    if (spanStatus === 'partial') {
        return 'Your coaching history came back at its row limit, so some of the endings are missing from it. A retention curve drawn without its endings is a flat line at 100% and says nothing.';
    }
    if (spanStatus === 'error') {
        return 'Your coaching history could not be read. Nothing is drawn rather than a curve made of the half that arrived.';
    }
    return null;
}
/** Said under the curve, every time. The re-join caveat is not an edge case for
 *  a coach whose clients come back after a summer, and a reader who does not
 *  know about it reads their own retention as better than it is. */
exports.COHORT_CAVEAT = 'A cohort is everybody who first started with you in that month. Somebody who left and later came back keeps their original start, so a break does not show here and this reads slightly better than the truth. Percentages are only stated once every person in the cohort has had the full time to reach that mark.';
/** The floor, restated for the screen so the number and the sentence cannot
 *  drift apart. */
exports.COHORT_FLOOR_NOTE = `Every row is a count. A percentage is added only where the cohort reached ${(0, format_1.num)(gymRetention_1.MIN_COHORT_FOR_RATE)} people — three of five leaving is not the same fact as 40% of two hundred, and one figure cannot say both. The same floor governs the gym console, so the two screens cannot disagree about what is too small to state.`;
