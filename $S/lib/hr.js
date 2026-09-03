"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.zoneSecondsTotal = exports.zoneKey = exports.emptyZoneSeconds = exports.ASSUMED_AGE = exports.ZONE_NOS = exports.ZONES = void 0;
exports.zoneDef = zoneDef;
exports.zoneColor = zoneColor;
exports.zoneName = zoneName;
exports.hrScaleBasis = hrScaleBasis;
exports.maxHr = maxHr;
exports.hrScaleNote = hrScaleNote;
exports.zoneOf = zoneOf;
exports.splatPoints = splatPoints;
exports.ageFromDob = ageFromDob;
exports.timeInZones = timeInZones;
exports.hrStats = hrStats;
exports.zoneBands = zoneBands;
exports.hrColor = hrColor;
exports.hrZoneLabel = hrZoneLabel;
exports.hrZoneNo = hrZoneNo;
exports.ZONES = [
    { no: 1, name: 'Very light', color: '#64748B', lo: 0.00, hi: 0.61 },
    { no: 2, name: 'Light', color: '#3B82F6', lo: 0.61, hi: 0.71 },
    { no: 3, name: 'Base', color: '#22C55E', lo: 0.71, hi: 0.84 },
    { no: 4, name: 'Push', color: '#F97316', lo: 0.84, hi: 0.92 },
    { no: 5, name: 'All out', color: '#DC2626', lo: 0.92, hi: 2.00 },
];
exports.ZONE_NOS = [1, 2, 3, 4, 5];
const BY_NO = { 1: exports.ZONES[0], 2: exports.ZONES[1], 3: exports.ZONES[2], 4: exports.ZONES[3], 5: exports.ZONES[4] };
function zoneDef(no) { return BY_NO[no]; }
function zoneColor(no) { return BY_NO[no].color; }
function zoneName(no) { return BY_NO[no].name; }
/**
 * The age this scale falls back to when the app does not know the member's.
 *
 * It is thirty because that is what this function has always used, and it is
 * named because the number was doing something nobody had said out loud. A max
 * heart rate of 190 puts zone 5 at 175 bpm; a fifty-five-year-old's own scale
 * puts it at 152. So a member the app had no date of birth for was being told
 * to push for a figure 23 bpm above the top of their range — on the one screen
 * in this app that asks somebody to work harder, at the age where that is least
 * safe to be wrong about.
 *
 * The guess is kept rather than the zones withheld, for the reason
 * src/lib/unitPreference.ts sets out at length about units: a member mid-set
 * with a live bpm on screen and no colour on it is a worse product AND a worse
 * prompt to go and fill the field in. What made it a defect was never that
 * thirty is a guess — it was that the guess was indistinguishable from a
 * measurement. `hrScaleNote` is what keeps the two apart, and every screen that
 * prints a zone prints it.
 */
exports.ASSUMED_AGE = 30;
function hrScaleBasis(age) {
    return typeof age === 'number' && Number.isFinite(age) && age > 0 ? 'age' : 'assumed';
}
/**
 * Estimated maximum heart rate, on the studio's own 220 − age.
 *
 * Deliberately still 220 − age and not Tanaka (208 − 0.7 × age): the five zones
 * at the top of this file are the Orange-Theory scale, the percentages are that
 * scale's, and swapping the formula underneath them would move every band on
 * every member's history by a few bpm to be differently approximate. It is an
 * ESTIMATE either way, which is what `hrScaleNote` says.
 */
function maxHr(age) {
    return 220 - (hrScaleBasis(age) === 'age' ? age : exports.ASSUMED_AGE);
}
/**
 * The line a screen shows beside a zone it drew without knowing the age.
 *
 * Null when the age is real, so a screen can render it unconditionally and say
 * nothing to the member it is right for — the same rule `deviceUnitNote` and
 * `localeNote` follow, and for the same reason: a line of apology on every
 * screen is a nag that gets no field filled in.
 *
 * It names the number as well as the fault, because "your zones may be wrong"
 * with nothing to act on is worse than silence. The route is stated in the
 * words of the screen that fixes it.
 */
function hrScaleNote(age) {
    if (hrScaleBasis(age) === 'age')
        return null;
    return `These zones are worked out from an age of ${exports.ASSUMED_AGE}, because your date of birth is not on your profile — they are a guess, not your scale. Add it in Profile and they redraw around you.`;
}
/** Which zone a bpm reading falls in. */
function zoneOf(bpm, age) {
    const pct = bpm / maxHr(age);
    for (let i = exports.ZONES.length - 1; i >= 0; i--)
        if (pct >= exports.ZONES[i].lo)
            return exports.ZONES[i].no;
    return 1;
}
const emptyZoneSeconds = () => ({ z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 });
exports.emptyZoneSeconds = emptyZoneSeconds;
const KEY = { 1: 'z1', 2: 'z2', 3: 'z3', 4: 'z4', 5: 'z5' };
const zoneKey = (no) => KEY[no];
exports.zoneKey = zoneKey;
const zoneSecondsTotal = (z) => z.z1 + z.z2 + z.z3 + z.z4 + z.z5;
exports.zoneSecondsTotal = zoneSecondsTotal;
/**
 * Splat points — one per whole minute spent at or above zone 4, the same rule a
 * studio uses. Returns 0 rather than a fraction: a partial minute is not a splat.
 */
function splatPoints(z) {
    return Math.floor((z.z4 + z.z5) / 60);
}
/** Age from a date-of-birth string (YYYY-MM-DD or ISO). null if unparseable. */
function ageFromDob(dob, nowMs = Date.now()) {
    if (!dob)
        return null;
    const b = Date.parse(dob);
    if (!isFinite(b))
        return null;
    const yrs = (nowMs - b) / (365.25 * 24 * 3600 * 1000);
    return yrs > 0 && yrs < 120 ? Math.round(yrs) : null;
}
/** Seconds in each zone, inferred from the gap between consecutive samples. */
function timeInZones(samples, age) {
    const out = (0, exports.emptyZoneSeconds)();
    const pts = samples
        .filter((s) => isFinite(s.bpm) && s.bpm > 0)
        .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
    for (let i = 0; i < pts.length; i++) {
        const next = pts[i + 1];
        let dt = next ? (Date.parse(next.t) - Date.parse(pts[i].t)) / 1000 : 10; // assume 10s for the last
        if (!isFinite(dt) || dt <= 0 || dt > 120)
            dt = 10; // clamp gaps (paused watch etc.)
        out[KEY[zoneOf(pts[i].bpm, age)]] += dt;
    }
    return out;
}
/** Low / high / average bpm across a series (null if empty). */
function hrStats(samples) {
    const v = samples.map((s) => s.bpm).filter((n) => typeof n === 'number' && isFinite(n) && n > 0);
    if (!v.length)
        return null;
    return { low: Math.min(...v), high: Math.max(...v), avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length) };
}
/** BPM bounds per zone for a given age, for drawing the coloured bands. */
function zoneBands(age) {
    const m = maxHr(age);
    return exports.ZONES.map((z) => ({ ...z, loBpm: Math.round(z.lo * m), hiBpm: Math.round(Math.min(z.hi, 1.12) * m) }));
}
/* ── convenience for single readings ──────────────────────────────────────── */
function hrColor(bpm, age) {
    if (!bpm || bpm <= 0)
        return exports.ZONES[0].color;
    return zoneColor(zoneOf(bpm, age));
}
/** "Zone 4 · Push" — the number leads, because colour alone is not enough. */
function hrZoneLabel(bpm, age) {
    if (!bpm || bpm <= 0)
        return '—';
    const no = zoneOf(bpm, age);
    return `Zone ${no} · ${zoneName(no)}`;
}
/** Just the numeral, for the large live readout. */
function hrZoneNo(bpm, age) {
    if (!bpm || bpm <= 0)
        return null;
    return zoneOf(bpm, age);
}
