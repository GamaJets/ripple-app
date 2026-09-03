"use strict";
// What a client is working toward, and how far along they are.
//
// Pure — no react, no supabase — because the arithmetic here is the part that
// can be wrong quietly. It used to live inline in app/(client)/goal.tsx, where
// nothing could reach it: a projected finish date is a claim about the future
// and it was being made by untested code.
//
// The rules the rest of this module exists to keep:
//
//  · Nothing measured means nothing said. Every function here returns null
//    rather than a zero, a 0% or a date, when the readings to support it do
//    not exist. See progressOf and projectionOf.
//  · Progress starts when the GOAL does. Counting from the client's oldest
//    reading credited them for weight lost last year against a target they set
//    this morning — the ring opened at 60% before they had done anything.
//  · A rate needs a window. Two weigh-ins a day apart differing by 400 g is
//    water, and extrapolating it produced finish dates that moved by months
//    between launches.
//  · A goal with no number is never given one. A custom goal is a sentence;
//    percentages of sentences are how "progress" stops meaning anything.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_TREND_DAYS = exports.GOAL_METRIC = exports.MEASURED_KINDS = void 0;
exports.isMeasured = isMeasured;
exports.goalLabel = goalLabel;
exports.startPoint = startPoint;
exports.progressOf = progressOf;
exports.projectionOf = projectionOf;
exports.isOverdue = isOverdue;
exports.sortGoals = sortGoals;
// A bare `date` column read as the day it says, not as UTC midnight. See the
// note on `isOverdue`.
const localDate_1 = require("./localDate");
exports.MEASURED_KINDS = ['weight', 'bodyfat', 'muscle'];
exports.GOAL_METRIC = {
    weight: { label: 'Target Weight', unit: 'kg', source: 'weigh-ins and scans' },
    bodyfat: { label: 'Target Body Fat', unit: '%', source: 'scans' },
    muscle: { label: 'Target Muscle', unit: 'kg', source: 'scans' },
};
function isMeasured(g) {
    return g.kind !== 'custom' && g.targetValue != null;
}
/** The label to put on a goal wherever it is listed. */
function goalLabel(g) {
    return g.kind === 'custom' ? (g.title ?? '') : exports.GOAL_METRIC[g.kind].label;
}
const ms = (iso) => Date.parse(iso);
/**
 * The reading progress is measured FROM: the last one taken at or before the
 * goal was set.
 *
 * A client who sets a target today has a baseline of what they weigh today,
 * even if the app has watched them for a year. When there is no reading before
 * the goal, the earliest one after it stands in — the alternative is refusing
 * to show progress to somebody who set a goal first and weighed in second,
 * which is the order most people do it in.
 */
function startPoint(series, createdAtISO) {
    if (!series.length)
        return null;
    const sorted = [...series].sort((a, b) => ms(a.t) - ms(b.t));
    const at = ms(createdAtISO);
    let before = null;
    for (const p of sorted) {
        if (ms(p.t) <= at)
            before = p;
        else
            break;
    }
    return before ?? sorted[0];
}
/**
 * How far along a measured goal is, or null when it cannot be said: a custom
 * goal, a goal with no target, or a client with no readings.
 */
function progressOf(goal, series) {
    if (!isMeasured(goal))
        return null;
    const from = startPoint(series, goal.createdAtISO);
    if (!from)
        return null;
    const sorted = [...series].sort((a, b) => ms(a.t) - ms(b.t));
    const current = sorted[sorted.length - 1].v;
    const target = goal.targetValue;
    const span = target - from.v;
    // Already at the target when the goal was set. The goal is met, and dividing
    // by the zero span would be the only other answer.
    const pct = span === 0 ? 100 : Math.max(0, Math.min(100, Math.round(((current - from.v) / span) * 100)));
    const remaining = +(target - current).toFixed(2);
    return {
        start: from.v,
        current,
        target,
        pct,
        remaining,
        // Crossing counts, not just landing on it: somebody aiming at 80 kg who
        // reaches 78 has got there.
        reached: span === 0 || (span > 0 ? current >= target : current <= target),
    };
}
/** Below this the two readings are too close together for the difference
 *  between them to be a trend rather than a fluctuation. */
exports.MIN_TREND_DAYS = 7;
/**
 * Where the client's own trend says they will land — computed only from
 * readings taken since the goal was set, because a rate is meant to describe
 * the effort being made now.
 *
 * null means there is nothing to project from at all. 'tooshort' means there
 * are readings but they do not yet span MIN_TREND_DAYS, which is a different
 * thing to say and worth saying.
 */
function projectionOf(goal, series, nowMs) {
    if (!isMeasured(goal))
        return null;
    const from = startPoint(series, goal.createdAtISO);
    if (!from)
        return null;
    const since = [...series].sort((a, b) => ms(a.t) - ms(b.t)).filter((p) => ms(p.t) >= ms(from.t));
    if (since.length < 2)
        return null;
    const prog = progressOf(goal, series);
    if (prog?.reached)
        return { kind: 'reached' };
    const first = since[0], last = since[since.length - 1];
    const days = (ms(last.t) - ms(first.t)) / 86400000;
    if (!(days >= exports.MIN_TREND_DAYS))
        return { kind: 'tooshort', days: Math.max(0, Math.round(days)) };
    const weeklyRate = (last.v - first.v) / (days / 7);
    const gap = goal.targetValue - last.v;
    // A rate of zero has no finish date; neither does one pointing away from the
    // target. Reporting either as a date would be inventing the future outright.
    if (weeklyRate === 0)
        return { kind: 'flat' };
    if (Math.sign(gap) !== Math.sign(weeklyRate))
        return { kind: 'wrongway', weeklyRate };
    const weeks = Math.abs(gap / weeklyRate);
    return { kind: 'eta', weeklyRate, etaMs: nowMs + weeks * 7 * 86400000 };
}
/**
 * Whether a target date has gone by with the goal still open.
 *
 * ── Two things this got wrong, and they compounded ────────────────────────
 *
 * It was `Date.parse(goal.targetDateISO) < nowMs`.
 *
 * `goal_targets.target_date` is a bare Postgres `date`, and `Date.parse` of a
 * bare date is UTC MIDNIGHT — the instant the day BEGINS, somewhere else. So a
 * goal targeted at the 12th went overdue at the first moment of the 12th in
 * UTC, which is:
 *
 *   · the 12th, all day, for the person whose goal it is. "By 12 Sep" and
 *     "Target date passed (12 Sep)" on the same screen on the same morning.
 *   · from 17:00 on the ELEVENTH in Los Angeles, so a coach there chased a
 *     client about a deadline the client still had a whole day of.
 *   · not until 14:00 on the 12th in Kiritimati, so the same coach reading
 *     from the other side of the line saw the opposite.
 *
 * A target date is a calendar day in the goal-setter's own life, and a day is
 * not late until it is over. `localDate` reads the bare date as LOCAL midnight
 * (src/lib/localDate.ts is the file that exists for this exact trap), and the
 * deadline is the local midnight that ENDS it — the next day's, computed by
 * calendar arithmetic rather than by adding 86,400,000, because two days a
 * year are 23 and 25 hours long.
 *
 * `isOverdue` on a gym invoice, in src/lib/monthEnd.ts, has always said "an
 * invoice due today is not late today" and says it by comparing two bare date
 * strings and never building a Date at all. This is the same rule; it could not
 * be written the same way only because the signature here takes an instant.
 */
function isOverdue(goal, nowMs) {
    if (goal.achievedAtISO || !goal.targetDateISO)
        return false;
    const d = (0, localDate_1.localDate)(goal.targetDateISO);
    if (!d)
        return false;
    const dayIsOver = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    return nowMs >= dayIsOver;
}
/** List order: open goals before achieved ones, then by target date, with
 *  undated goals last rather than sorted as though their date were zero. */
function sortGoals(goals) {
    return [...goals].sort((a, b) => {
        const done = Number(!!a.achievedAtISO) - Number(!!b.achievedAtISO);
        if (done)
            return done;
        const ad = a.targetDateISO ? ms(a.targetDateISO) : Infinity;
        const bd = b.targetDateISO ? ms(b.targetDateISO) : Infinity;
        if (ad !== bd)
            return ad - bd;
        return ms(a.createdAtISO) - ms(b.createdAtISO);
    });
}
