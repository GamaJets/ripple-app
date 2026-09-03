"use strict";
// The years a date wheel may offer, and the dated fault this replaced.
//
// Pure and in src/lib because it is a rule, not a screen: it can then be run
// against a supplied clock in a test rather than waiting for the calendar to
// reach the bug. `app/(client)/scans.tsx` is the caller.
Object.defineProperty(exports, "__esModule", { value: true });
exports.yearsAround = yearsAround;
/**
 * The years the date wheel offers.
 *
 * This was `Array.from({ length: 8 }, (_, i) => 2019 + i)` — a hardcoded
 * 2019-2026 — and it had a date on it. From 1 January 2027 `YEARS.indexOf(2027)`
 * is -1, and the `Math.max(0, …)` below turned that into index 0: every scan
 * anybody added would have opened on **2019**, eight years wrong, with a wheel
 * that could not be scrolled to the right answer because the right answer was
 * not in it. Editing an existing scan from an unlisted year failed differently
 * and more quietly — the `yi >= 0` guard skipped the whole date, leaving
 * whatever the wheel happened to be showing.
 *
 * So the range is derived from the clock and always contains today. Ten years
 * back covers a body-composition history nobody has yet; one year forward
 * exists because a phone an hour ahead of UTC on New Year's Eve is not a
 * mistake, and a wheel that cannot represent the date the device believes it is
 * would be the same bug wearing a different hat.
 *
 * `yearsAround` widens to include a year outside that window rather than
 * refusing it, so a scan dated 2011 by hand still loads and still edits. A
 * stored date the wheel cannot show is a date the app would silently rewrite.
 */
function yearsAround(now, include) {
    const here = now.getFullYear();
    let lo = here - 10;
    let hi = here + 1;
    if (include != null && Number.isFinite(include)) {
        lo = Math.min(lo, include);
        hi = Math.max(hi, include);
    }
    const out = [];
    for (let y = lo; y <= hi; y++)
        out.push(y);
    return out;
}
