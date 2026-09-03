"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.miToKm = exports.kmToMi = exports.M_PER_KM = exports.KM_PER_MI = void 0;
exports.distanceUnitFor = distanceUnitFor;
exports.distanceIn = distanceIn;
exports.distanceLabel = distanceLabel;
exports.metresLabel = metresLabel;
exports.distanceUnitName = distanceUnitName;
/** Exact by international definition: the mile is 1609.344 metres, because the
 *  inch is 25.4 mm. Not an approximation, and not a different number from
 *  `CM_PER_IN` — it is that number times 63,360. */
exports.KM_PER_MI = 1.609344;
exports.M_PER_KM = 1000;
const kmToMi = (km) => km / exports.KM_PER_MI;
exports.kmToMi = kmToMi;
const miToKm = (mi) => mi * exports.KM_PER_MI;
exports.miToKm = miToKm;
/**
 * The distance unit that goes with a length unit. See the header for why this
 * is derived rather than asked.
 */
function distanceUnitFor(length) {
    return length === 'in' ? 'mi' : 'km';
}
/**
 * Two decimal places, in both units, and the same two.
 *
 * A hundredth of a kilometre is ten metres and a hundredth of a mile is
 * sixteen; both are finer than any watch's real accuracy over a run and neither
 * prints a digit the reading cannot support. It matters that they match: a
 * 5.00 km run and a 3.11 mi run are the same run, and giving one of them an
 * extra digit would make the pair look like two different measurements.
 */
const DISPLAY_DP = 2;
const roundTo = (n, dp) => {
    const f = 10 ** dp;
    return Math.round((n + Number.EPSILON) * f) / f;
};
/**
 * A measured distance in kilometres, read out in the member's unit. null in,
 * null out — a run nobody recorded is not a run of zero.
 */
function distanceIn(km, unit) {
    if (km == null || !Number.isFinite(km))
        return null;
    return roundTo(unit === 'mi' ? (0, exports.kmToMi)(km) : km, DISPLAY_DP);
}
/** The same figure with its unit attached: `5 km`, `3.11 mi`. Trailing zeroes
 *  are dropped — 5.00 km is a number nobody writes. */
function distanceLabel(km, unit) {
    const v = distanceIn(km, unit);
    return v == null ? null : `${String(v)} ${unit}`;
}
/**
 * Metres — which is what HealthKit and every vendor API deal in — read out in
 * the member's unit.
 *
 * Separate from `distanceIn` rather than left to the caller to divide by a
 * thousand, because the caller dividing by a thousand and appending 'km' is
 * precisely the line this module exists to remove from two screens.
 */
function metresLabel(metres, unit) {
    if (metres == null || !Number.isFinite(metres))
        return null;
    return distanceLabel(metres / exports.M_PER_KM, unit);
}
/** The word for a unit, for a screen-reader label or a sentence. */
function distanceUnitName(unit) {
    return unit === 'mi' ? 'miles' : 'kilometres';
}
