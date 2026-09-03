"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_LATE_DAYS = exports.LATE_FRACTION = exports.MAX_USUAL_GAP_DAYS = exports.MIN_SPAN_DAYS = exports.MIN_ACTIVE_DAYS = void 0;
exports.assessCadence = assessCadence;
exports.cadenceLine = cadenceLine;
exports.worthRaising = worthRaising;
exports.byLateness = byLateness;
exports.overdueNote = overdueNote;
// Coach · when this client was next expected, and how far past it they are.
//
// ── The gap this closes, in one sentence ──────────────────────────────────
//
// src/lib/clientDrift.ts is RETROSPECTIVE BY CONSTRUCTION. Its near window is
// fourteen days and its baseline is the six weeks before that, so a client has
// to have already missed a fortnight before anything can be said about them.
// For a client who trained four times a week, a fortnight of silence is not an
// early warning — it is the post-mortem. By the time `at_risk` appears the
// conversation the coach needed to have was ten days ago.
//
// A person's own rhythm gives a much earlier signal and it needs no new data:
// somebody who has come every three days for two months was expected on
// Tuesday, and on Saturday they are four days late. That is available on day
// four rather than on day fourteen, and the difference between day four and day
// fourteen is the difference between a save and a leaving date.
//
// ── Why this is a separate module and not a fifth field on Drift ──────────
//
// It answers a different question and it fails differently. `assessDrift` asks
// "is this person doing less than they used to", which is a comparison of two
// RATES and needs a long baseline to be worth anything. This asks "were they
// due", which is a comparison of one INTERVAL against their usual one and needs
// only that they have a usual one. A client can be perfectly steady by drift
// and eight days overdue by cadence — a fortnightly client who has missed one
// visit — and a client can be badly drifting and not overdue at all, because
// they came yesterday. Both are true and neither is the other.
//
// Keeping them apart also keeps the refusals apart. Drift refuses to speak
// without a six-week baseline; this refuses to speak without a settled gap.
// Folding them together would mean one refusal silencing both answers.
//
// ── THE THING THIS MODULE MUST NOT DO ─────────────────────────────────────
//
// It must not diagnose, for exactly the reasons src/lib/nudge.ts sets out at
// length. "Four days past their usual gap" is a statement about the RECORD. It
// is not a statement that they have stopped, and the same shape is produced by
// a holiday, an injury, a change of gym, and by somebody training four times a
// week who stopped opening the app. Every sentence below is about what the app
// was told. `WHAT_IT_CANNOT_SEE` in nudge.ts is the caveat that goes beside
// them and it is not optional decoration.
//
// And it must not be read as a prediction. `expectedDay` is the day their own
// pattern would have put them on. It is not a forecast of behaviour, it is
// arithmetic on their last visit, and the field is named for the arithmetic.
const clientDrift_1 = require("./clientDrift");
const DAY = 86400000;
/**
 * Fewer active days than this and there are not enough intervals to call
 * anything usual.
 *
 * Four days is three gaps. Three is the smallest number from which a median is
 * a median rather than a coin toss between two values — with two gaps the
 * median is their mean, and one late night out would move it by half.
 */
exports.MIN_ACTIVE_DAYS = 4;
/** A record shorter than this is a first impression rather than a rhythm. Two
 *  weeks, deliberately shorter than clientDrift's twenty-one-day baseline
 *  minimum: this module exists to speak sooner, and an interval needs less
 *  observation to be settled than a rate does. */
exports.MIN_SPAN_DAYS = 14;
/**
 * Beyond this, an interval is not a cadence worth pacing against.
 *
 * Somebody whose usual gap is a month is not somebody the app should be calling
 * overdue on day thirty-five; at that spacing the fortnightly window drift
 * already uses is the better instrument and this one would produce a prompt a
 * month after it could do any good. Three weeks is the line, matching the
 * twenty-eight-day cap `MAX_COOLDOWN_DAYS` puts on how long an approach may be
 * left in src/lib/interventions.ts.
 */
exports.MAX_USUAL_GAP_DAYS = 21;
/**
 * How late is late.
 *
 * Proportional with a floor, because neither alone works. A flat "four days
 * late" would call a daily trainer overdue every long weekend and would say
 * nothing at all about a fortnightly client until they were a month gone. A
 * pure proportion would make a daily trainer overdue at a day and a half, which
 * is a Sunday.
 *
 * So: past their usual gap by half of it again, or by three days, whichever is
 * the larger. A daily trainer is late at four days of silence; twice a week
 * (a gap of three and a half) at seven; fortnightly at twenty-one.
 */
exports.LATE_FRACTION = 0.5;
exports.MIN_LATE_DAYS = 3;
/** Nothing to say, and the reason. Used for every early return so a caller
 *  cannot receive a half-filled object. */
function none(why, partial = {}) {
    return {
        state: 'unknown',
        usualGapDays: null,
        sinceLastDays: null,
        expectedDay: null,
        overdueDays: null,
        activeDays: 0,
        spanDays: null,
        noPattern: why,
        ...partial,
    };
}
/**
 * The middle value of a sorted list of gaps.
 *
 * MEDIAN and not mean, and this is the single most important line in the file.
 * A client who trains every three days and then takes one three-week holiday
 * has a mean gap of six and a median of three. Paced off the mean, the app
 * would wait twelve days before calling them late — which is the behaviour of
 * an app that has been taught by one holiday to expect another. The median
 * ignores the outlier, which is what an outlier is for.
 */
function median(sorted) {
    const n = sorted.length;
    const mid = n >> 1;
    return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
const round1 = (n) => Math.round(n * 10) / 10;
/**
 * When this client was due, from their own record.
 *
 * `events` is the SAME array the drift verdict was computed from — a second,
 * later read would explain a figure that is no longer the one on screen, which
 * is the argument `explainDrift` makes about its own input.
 *
 * An empty array means NOTHING WAS RECORDED. It does not mean the client did
 * nothing, and this module never treats the two as the same: the caller is
 * responsible for not calling this at all for a client whose read did not come
 * back, exactly as `buildNudgeBoard` refuses to assess one.
 *
 * `windowDays` is how far back the events reach. Only used to compute the
 * span, and defaulted to the same fifty-six days `DEFAULT_WINDOWS` reads.
 */
function assessCadence(events, now = Date.now(), windowDays = 56) {
    // activeDayLog collapses several events on one evening into one day, matching
    // `streaks.activeDays`. Counting five logged exercises as five visits would
    // give a client a usual gap of nothing and make them permanently overdue.
    const days = (0, clientDrift_1.activeDayLog)([...events], now - windowDays * DAY, now + 1);
    if (days.length === 0)
        return none('no-events');
    const first = Date.parse(days[0].day + 'T00:00:00');
    const last = Date.parse(days[days.length - 1].day + 'T00:00:00');
    const todayKey = (0, clientDrift_1.localDayKey)(now);
    const todayMs = Date.parse(todayKey + 'T00:00:00');
    // Whole days between calendar days, so a session at 9pm and one at 7am the
    // next morning is one day apart and not zero. Both ends are midnight of their
    // own local day, which is what `activeDayLog` filed them under.
    const sinceLastDays = Math.max(0, Math.round((todayMs - last) / DAY));
    const spanDays = Math.round((last - first) / DAY);
    const carry = { activeDays: days.length, spanDays, sinceLastDays };
    if (days.length < exports.MIN_ACTIVE_DAYS)
        return none('too-few', carry);
    if (spanDays < exports.MIN_SPAN_DAYS)
        return none('too-short', carry);
    const gaps = [];
    for (let i = 1; i < days.length; i++) {
        const a = Date.parse(days[i - 1].day + 'T00:00:00');
        const b = Date.parse(days[i].day + 'T00:00:00');
        gaps.push(Math.round((b - a) / DAY));
    }
    gaps.sort((a, b) => a - b);
    const usual = median(gaps);
    // A gap of zero cannot happen — activeDayLog returns distinct days — but a
    // median of zero would make every threshold below meaningless, so it is
    // refused rather than trusted. Deliberately checked, because the day this
    // stops being impossible is the day somebody changes activeDayLog.
    if (!(usual > 0))
        return none('too-spread', carry);
    if (usual > exports.MAX_USUAL_GAP_DAYS)
        return none('too-spread', carry);
    const expectedMs = last + usual * DAY;
    const expectedDay = (0, clientDrift_1.localDayKey)(expectedMs);
    const late = (todayMs - expectedMs) / DAY;
    const tolerance = Math.max(exports.MIN_LATE_DAYS, usual * exports.LATE_FRACTION);
    const state = late > tolerance ? 'overdue' : late > 0 ? 'due' : 'inside';
    return {
        state,
        usualGapDays: round1(usual),
        sinceLastDays,
        expectedDay,
        // Only for the states where being late is the fact. Negative is never
        // returned: "−3 days overdue" is a number every reader gets wrong.
        overdueDays: late > 0 ? Math.floor(late) : null,
        activeDays: days.length,
        spanDays,
        noPattern: null,
    };
}
/** Sentence-case, said about the RECORD and never about the person. Printed
 *  under a client's name, so it opens with what the app has rather than with
 *  what they did. */
function cadenceLine(c) {
    if (c.state === 'unknown') {
        switch (c.noPattern) {
            case 'no-events':
                return 'Nothing on record in the window read, so there is no usual gap to measure against.';
            case 'too-few':
                return `Only ${c.activeDays} day${c.activeDays === 1 ? '' : 's'} on record, which is too few to say what their usual gap is.`;
            case 'too-short':
                return 'Too little of their record to settle on a usual gap yet. It will fill in.';
            case 'too-spread':
                return 'Their visits are too far apart for a usual gap to be worth pacing against.';
            default:
                return 'There is no usual gap to measure against.';
        }
    }
    const gap = `about every ${c.usualGapDays} day${c.usualGapDays === 1 ? '' : 's'}`;
    const since = `${c.sinceLastDays} day${c.sinceLastDays === 1 ? '' : 's'}`;
    if (c.state === 'inside') {
        return `Nothing has come through for ${since}. They come ${gap}, so they are not late.`;
    }
    if (c.state === 'due') {
        return `Nothing for ${since}. They come ${gap}, so they were due — not late enough to read anything into.`;
    }
    return `Nothing for ${since}, and they come ${gap}. That is ${c.overdueDays} day${c.overdueDays === 1 ? '' : 's'} past their own usual gap.`;
}
/**
 * Whether a coach should be shown this one.
 *
 * Only 'overdue'. 'due' is everybody, every week, by construction — half a
 * roster is inside a day of its own gap at any moment — and surfacing it would
 * be the per-client nagging src/lib/nudge.ts refuses. 'unknown' says nothing
 * about the person and must never be dressed up as a warning here; the place
 * that surfaces an unassessable client is the drift board, which puts them in
 * their own band with the reason attached.
 */
function worthRaising(c) {
    return c.state === 'overdue';
}
/**
 * Overdue clients, most overdue first, as a fraction of their OWN gap.
 *
 * Sorted by lateness relative to their own rhythm and not by raw days, which is
 * the same argument clientDrift makes about rates: eight days late means very
 * different things to a daily trainer and to a fortnightly one, and ordering by
 * raw days would put every infrequent client at the top of every list forever.
 */
function byLateness(rows) {
    const share = (c) => c.overdueDays != null && c.usualGapDays ? c.overdueDays / c.usualGapDays : -1;
    return [...rows].sort((a, b) => {
        const d = share(b.cadence) - share(a.cadence);
        if (d !== 0)
            return d;
        return (b.cadence.overdueDays ?? -1) - (a.cadence.overdueDays ?? -1);
    });
}
/**
 * The line above a list of overdue clients.
 *
 * Null in means null out — before the read lands there is no number of overdue
 * clients, and printing "nobody is overdue" while it is in flight tells a coach
 * their week is clear. The same rule `boardNote` and `summariseDrift` keep.
 */
function overdueNote(rows) {
    if (rows == null)
        return 'Working out who was due…';
    const late = rows.filter((r) => worthRaising(r.cadence)).length;
    const paced = rows.filter((r) => r.cadence.state !== 'unknown').length;
    if (late === 0) {
        return paced === 0
            ? 'Nobody on the part of your book that was read has a settled enough pattern to be called late.'
            : 'Nobody is past their own usual gap by enough to be worth raising.';
    }
    return `${late} ${late === 1 ? 'client is' : 'clients are'} past their own usual gap. This is earlier than the quiet list, and it is a smaller signal.`;
}
