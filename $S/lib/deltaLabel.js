"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MINUS = void 0;
exports.deltaFigure = deltaFigure;
exports.deltaMoved = deltaMoved;
exports.deltaSign = deltaSign;
exports.deltaArrow = deltaArrow;
exports.deltaMagnitude = deltaMagnitude;
exports.deltaLabel = deltaLabel;
exports.goalWants = goalWants;
exports.movementIsProgress = movementIsProgress;
exports.pctChange = pctChange;
/** U+2212 MINUS. The app prints this, not a hyphen — a hyphen at figure size
 *  next to a digit reads as a dash in the sentence rather than a sign. */
exports.MINUS = '−';
const DEFAULT_DECIMALS = 1;
/** A unit that butts straight against the digits rather than taking a space. */
const JOINED = /^[%°]|^\//;
/**
 * Rounds by MAGNITUDE and puts the sign back, so that −0.05 and +0.05 round the
 * same distance. `roundTo` in ./units nudges by Number.EPSILON before rounding,
 * which is right for a reading but asymmetric for a difference: it would send
 * +0.05 up to 0.1 and −0.05 in to −0.0, and a movement that reads as nothing in
 * one direction and something in the other is a bias with a sign on it.
 */
function round(n, dp) {
    const f = 10 ** dp;
    const r = Math.round((Math.abs(n) + Number.EPSILON) * f) / f;
    return n < 0 ? -r : r;
}
/** The movement as it will actually be printed, or null if there is none to
 *  print. Callers that lay the sign and the figure out in separate elements use
 *  this with `deltaSign`; everything else uses `deltaLabel`. */
function deltaFigure(value, decimals = DEFAULT_DECIMALS) {
    if (value == null || typeof value !== 'number' || !Number.isFinite(value))
        return null;
    return round(value, decimals);
}
/** Did the figure the reader will see actually move? False for a raw 0.04 that
 *  prints as 0.0, which is the whole point. */
function deltaMoved(value, decimals = DEFAULT_DECIMALS) {
    const f = deltaFigure(value, decimals);
    return f != null && f !== 0;
}
/** The sign that belongs in front of the printed figure — and an empty string
 *  where the honest answer is that there is no sign, because nothing moved. */
function deltaSign(value, decimals = DEFAULT_DECIMALS) {
    const f = deltaFigure(value, decimals);
    if (f == null || f === 0)
        return '';
    return f < 0 ? exports.MINUS : '+';
}
/** The same decision as a direction glyph, for a chart. Empty where a chart
 *  should draw no arrow at all rather than pick one. */
function deltaArrow(value, decimals = DEFAULT_DECIMALS) {
    const s = deltaSign(value, decimals);
    return s === '' ? '' : s === '+' ? '▲' : '▼';
}
/** The figure without its sign, printed the way a person writes it: 2, not 2.0. */
function deltaMagnitude(value, decimals = DEFAULT_DECIMALS) {
    const f = deltaFigure(value, decimals);
    return f == null ? null : String(Math.abs(f));
}
/**
 * The whole movement as one line: "−1.2 kg since Aug 25", "No change since
 * Aug 25", "No earlier reading".
 *
 * `value` is expected to already be in the reader's own unit — the `*DeltaIn`
 * converters in ./units convert the SPAN once rather than subtracting two
 * separately rounded ends, and doing that here instead would reintroduce the
 * bug those functions exist to prevent.
 */
function deltaLabel(value, opts) {
    const dp = opts.decimals ?? DEFAULT_DECIMALS;
    const since = opts.since ? ` since ${opts.since}` : '';
    const f = deltaFigure(value, dp);
    // No reading, or arithmetic that produced Infinity or NaN. Neither is a
    // movement, and neither may be given a sign and printed as one.
    if (f == null)
        return opts.noBaseline ?? 'No earlier reading';
    if (f === 0)
        return `${opts.noChange ?? 'No change'}${since}`;
    const u = opts.unit ? (JOINED.test(opts.unit) ? opts.unit : ` ${opts.unit}`) : '';
    return `${f < 0 ? exports.MINUS : '+'}${Math.abs(f)}${u}${since}`;
}
/**
 * The direction that counts as progress on this metric for this member — or
 * null where their goal does not settle it and the app should say nothing.
 *
 * Weight is the one that matters: it is down for Fat Loss, up for Build Muscle,
 * and genuinely undecided for Tone, whose whole point is recomposition at much
 * the same scale reading. Every screen in this app used to hardcode
 * `good: wDelta <= 0`, which told a member who had asked to build muscle that
 * gaining it was the wrong way round.
 *
 * Muscle is 'up' under every goal because nobody's goal is less of it. Body fat
 * and a tape measurement are 'down' for Fat Loss and Tone, and undecided during
 * a deliberate bulk, where a little of both is the expected cost of the muscle.
 */
function goalWants(goal, metric) {
    if (metric === 'muscle')
        return 'up';
    if (metric === 'weight')
        return goal === 'fatloss' ? 'down' : goal === 'muscle' ? 'up' : null;
    // bodyFat and girth
    return goal === 'muscle' ? null : goal == null ? null : 'down';
}
/**
 * Whether this movement is progress towards this member's own goal.
 *
 * `undefined` — not false — where the question has no answer: no goal recorded,
 * a goal with no opinion on this metric, nothing read, or nothing moved. A
 * screen renders that as a neutral mark, because "not progress" and "we do not
 * know" are different things to say to somebody about their own body.
 */
function movementIsProgress(value, goal, metric, decimals = DEFAULT_DECIMALS) {
    const want = goalWants(goal, metric);
    if (want == null)
        return undefined;
    const f = deltaFigure(value, decimals);
    if (f == null || f === 0)
        return undefined;
    return want === 'down' ? f < 0 : f > 0;
}
/**
 * A change expressed as a percentage of what came before — or null where there
 * is no "before" to be a percentage of.
 *
 * `(now - before) / before` is Infinity at before = 0 and NaN at 0/0, and both
 * of those have been interpolated straight into a sentence in this codebase's
 * history. A gym's first month has no previous month; "+Infinity% vs last
 * month" is not a way to say so.
 */
function pctChange(now, before) {
    if (now == null || before == null)
        return null;
    if (!Number.isFinite(now) || !Number.isFinite(before) || before === 0)
        return null;
    return ((now - before) / before) * 100;
}
