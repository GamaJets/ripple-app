"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TYPICAL_FLOOR_MS = exports.TYPICAL_PCT = exports.BASELINE_MIN = exports.BASELINE_NIGHTS = void 0;
exports.hrvBaseline = hrvBaseline;
exports.hrvTrendOf = hrvTrendOf;
exports.hrvTrendLine = hrvTrendLine;
exports.hrvBuildingLine = hrvBuildingLine;
exports.rowToHrvNight = rowToHrvNight;
exports.hrvNightToRow = hrvNightToRow;
/** How far back a baseline looks. Thirty nights is what the vendors' own apps
 *  use and it is long enough to survive a bad week without being so long that
 *  a real change in fitness never shows up in it. */
exports.BASELINE_NIGHTS = 30;
/** The fewest nights that may be called a baseline. See the header. */
exports.BASELINE_MIN = 7;
/**
 * How far from the baseline counts as an ordinary night.
 *
 * Ten per cent, with a floor of three milliseconds. The percentage is because
 * HRV's night-to-night variation scales with the member — someone whose
 * baseline is 120 ms swings by more milliseconds than someone at 30 and is no
 * less steady for it. The floor is because ten per cent of a low baseline is a
 * couple of milliseconds, which is inside what the strap itself can resolve,
 * and a band that narrow would report a different verdict every morning off
 * nothing the member did.
 */
exports.TYPICAL_PCT = 0.10;
exports.TYPICAL_FLOOR_MS = 3;
/** The median of a list of numbers. Even-length lists take the mean of the two
 *  middles, which is the ordinary definition and cannot be the wrong one here:
 *  both middles are real readings of the same member. */
function median(values) {
    const v = [...values].sort((a, b) => a - b);
    const mid = v.length >> 1;
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
/**
 * The member's baseline from their kept nights, EXCLUDING `tonight`.
 *
 * Null when there are not enough nights, which is a real answer and the one
 * the screen must be able to say. Nights outside the window are ignored rather
 * than being allowed to prop up a count.
 */
function hrvBaseline(nights, tonight, window = exports.BASELINE_NIGHTS) {
    const seen = new Set();
    const vals = [];
    // Newest first, so `window` means the last N nights that exist rather than
    // the last N calendar days — a member who did not wear the strap for a week
    // still has a baseline, made of the nights they did.
    const ordered = [...nights].filter((n) => n && n.night !== tonight && Number.isFinite(n.ms) && n.ms > 0)
        .sort((a, b) => (a.night < b.night ? 1 : a.night > b.night ? -1 : 0));
    for (const n of ordered) {
        if (seen.has(n.night))
            continue; // one answer per night
        seen.add(n.night);
        vals.push(n.ms);
        if (vals.length >= window)
            break;
    }
    if (vals.length < exports.BASELINE_MIN)
        return null;
    return { ms: Math.round(median(vals) * 10) / 10, nights: vals.length };
}
/** Where tonight sits. Null when there is nothing to compare against — never a
 *  'typical' standing in for "we do not know". */
function hrvTrendOf(tonightMs, base) {
    if (base == null || tonightMs == null || !Number.isFinite(tonightMs) || tonightMs <= 0)
        return null;
    const deltaMs = Math.round((tonightMs - base.ms) * 10) / 10;
    const tolerance = Math.max(base.ms * exports.TYPICAL_PCT, exports.TYPICAL_FLOOR_MS);
    const band = deltaMs > tolerance ? 'above' : deltaMs < -tolerance ? 'below' : 'typical';
    return { band, deltaMs, baseline: base };
}
/**
 * The line printed beside the figure.
 *
 * It names the baseline and the number of nights it is made of, because a
 * trend against an unstated baseline is the same unreadable number the bare
 * "62 ms" was. Deliberately says nothing about what the member should DO: this
 * app is not a medical device and a low night is a fact, not an instruction.
 */
function hrvTrendLine(trend) {
    const { band, deltaMs, baseline } = trend;
    const nights = `${baseline.nights} night${baseline.nights === 1 ? '' : 's'}`;
    const size = `${Math.abs(deltaMs)} ms`;
    if (band === 'typical')
        return `In line with your usual ${baseline.ms} ms, over your last ${nights}.`;
    return band === 'above'
        ? `${size} above your usual ${baseline.ms} ms, over your last ${nights}.`
        : `${size} below your usual ${baseline.ms} ms, over your last ${nights}.`;
}
/**
 * The line printed when there is a reading but no baseline yet.
 *
 * States the count and what it is counting toward. A member who is told "no
 * baseline yet" and nothing else has no reason to believe one is coming.
 */
function hrvBuildingLine(nightsKept) {
    const n = Math.max(0, nightsKept);
    return n === 0
        ? `Tonight is the first reading kept. HRV only means anything against your own history, so it is shown on its own until there are ${exports.BASELINE_MIN} nights.`
        : `${n} of ${exports.BASELINE_MIN} nights kept. HRV only means anything against your own history, so it is shown on its own until there are ${exports.BASELINE_MIN}.`;
}
/* ── the row, both ways ────────────────────────────────────────────────────
 *
 * Defensive about types for the reason src/lib/deviceSleepStore.ts documents on
 * its own row mapper: `hrv_ms` is numeric in Postgres and supabase-js has handed
 * numerics back as strings on some paths, and a string reaching the arithmetic
 * above produces a NaN baseline rather than an admission that there is none.
 */
function rowToHrvNight(r) {
    if (!r)
        return null;
    const night = String(r.night ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(night))
        return null;
    const ms = Number(r.hrv_ms);
    if (!Number.isFinite(ms) || ms <= 0)
        return null;
    const sourceName = String(r.source_name ?? '');
    // Attribution travels with the figure or the figure does not travel.
    if (!sourceName)
        return null;
    return { night, ms: Math.round(ms * 10) / 10, provider: String(r.provider ?? ''), sourceName };
}
/** A night as the row to upsert. `user_id` is the caller's own id — the only
 *  one the policy in part 720 will accept. */
function hrvNightToRow(userId, n) {
    return { user_id: userId, night: n.night, hrv_ms: n.ms, provider: n.provider, source_name: n.sourceName };
}
