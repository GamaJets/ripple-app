"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DIRECTION_CAVEAT = exports.STALE_DAYS = exports.MEASURE_SITES = void 0;
exports.readMeasurements = readMeasurements;
exports.measureBoard = measureBoard;
exports.unmeasuredSites = unmeasuredSites;
exports.siteChangeCm = siteChangeCm;
exports.siteChangeLine = siteChangeLine;
exports.siteAgeDays = siteAgeDays;
exports.isSiteStale = isSiteStale;
exports.siteAgeLine = siteAgeLine;
// Somebody else's tape measurements, read off the wire.
//
// `measurements` has carried `measurements_coach_read` — `for select using
// (is_my_client(user_id))` — since supabase/parts/02, and until today nothing
// on the coach's side ever selected from it. So a coach could open a client and
// see their scans — weight, body fat, skeletal muscle — and not one tape
// reading, which is exactly the half of the record that moves when body
// composition changes and the scale does not. The grant was written for a
// reader who never arrived; this module is the step before that reader.
//
// It is the same shape as clientGoals.ts and it is that shape for the same
// reasons: rows off the wire become the few things that can honestly be said
// about them, here, once, in a file that compiles and runs under plain node —
// so that no screen has to work any of it out a second time and get it slightly
// different.
//
// ── One reading is a number. Two are the point ─────────────────────────────
//
// A coach does not act on "their waist is 84 cm". They act on "their waist is
// 84 cm, down 2 cm since the start of the block". A site that has been measured
// once has no change to report, and the sentence for it says so in words rather
// than printing a 0 — because "0.0 cm" and "we have nothing to compare this to"
// look identical on a screen and start opposite conversations. `SiteHistory`
// therefore carries `previous` as a nullable of its own, and `siteChangeLine`
// has a branch for its absence rather than a default.
//
// ── Sites move independently, and so do their dates ────────────────────────
//
// The table is one row per site per date, appended, and nothing obliges a
// client to measure every site every time — src/ui/measurements.tsx saves
// whichever boxes were filled in. So a client may have twenty waist readings
// and one thigh, taken in January and never repeated.
//
// That means there is no such thing as a client's "last measured" date. There
// is one per site, and rolling them into a single screen-level date would report
// a seven-month-old thigh reading as six days old because the waist is. Every
// site here carries its own latest date, its own previous date and its own age,
// and `siteAgeLine` says how old the reading is in every case rather than only
// when it is embarrassing.
//
// ── Direction is not the same as good ──────────────────────────────────────
//
// A waist going down and an arm going down are opposite outcomes, and which one
// a client wants is not in this table. The client's own screen paints a fall in
// `t.brand` (src/ui/measurements.tsx), which reads as "well done" and is wrong
// on an arm for anybody training to put size on it. Nothing here returns a
// judgement, a tone or a valence — a change is a signed figure and a date, and
// `DIRECTION_CAVEAT` is the one sentence that says why it is left at that.
//
// ── Units ──────────────────────────────────────────────────────────────────
//
// Storage is centimetres (TF-37) and the reader converts at the edge. A CHANGE
// is converted as a span through `lengthDeltaIn` and not as the difference of
// two converted ends, which is the bug that helper exists to prevent: −1.0 cm
// would otherwise print as −0.3 in one month and −0.4 in the next off the back
// of nothing the client did.
const units_1 = require("./units");
const deltaLabel_1 = require("./deltaLabel");
const localDate_1 = require("./localDate");
const coachWeek_1 = require("./coachWeek");
/**
 * The sites this build can name, in the order the client's own screen lists
 * them.
 *
 * A copy of `METRICS` in src/ui/measurements.tsx rather than an import of it:
 * that module is a React provider and this one has to compile and run under
 * plain node for the tests. The order is copied along with the keys on purpose —
 * a coach and a client reading the same body down two differently ordered lists
 * is a small, constant, avoidable friction.
 */
exports.MEASURE_SITES = [
    { key: 'waist', label: 'Waist' },
    { key: 'chest', label: 'Chest' },
    { key: 'shoulders', label: 'Shoulders' },
    { key: 'neck', label: 'Neck' },
    { key: 'hips', label: 'Hips' },
    // The unqualified `arm` and `thigh` stay beside the sided ones rather than
    // being folded into them. A row already stored as 'arm' carries no side, and
    // assigning it to one would put a year of somebody's measurements on the
    // wrong limb — see the longer note at METRICS in src/ui/measurements.tsx.
    { key: 'arm', label: 'Arm' },
    { key: 'armL', label: 'Left Arm' },
    { key: 'armR', label: 'Right Arm' },
    { key: 'thigh', label: 'Thigh' },
    { key: 'thighL', label: 'Left Thigh' },
    { key: 'thighR', label: 'Right Thigh' },
    { key: 'calf', label: 'Calf' },
];
const SITE_KEYS = exports.MEASURE_SITES.map((s) => s.key);
/** The site a row is for, or null when this build has no name for it. `kind` is
 *  a bare text column with no check constraint behind it, so a newer build
 *  writing a sixth site is a thing that can reach this function. */
function siteOf(kind) {
    return SITE_KEYS.includes(kind) ? kind : null;
}
/**
 * A numeric column as a number, or null.
 *
 * The same guard as `num` in clientGoals.ts and for the same reason: Postgres
 * `numeric` reaches supabase-js as a number or a string depending on the driver
 * path, and `Number(null)` is 0 — a client with a zero-centimetre waist.
 */
const num = (v) => {
    if (v == null || v === '')
        return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
};
/** A calendar day as one comparable integer, built from the parts rather than
 *  from `Date.parse`, so that ordering a date column does not shift by a day
 *  west of Greenwich. See src/lib/localDate.ts for what that bug looks like. */
function dayKey(iso) {
    const p = (0, localDate_1.dateParts)(iso);
    return p ? p[0] * 10000 + p[1] * 100 + p[2] : null;
}
function readMeasurements(rows) {
    const bySite = new Map();
    let skipped = 0;
    for (const r of rows) {
        const key = siteOf(r.kind);
        const day = dayKey(r.taken_at);
        const cm = num(r.value);
        // A non-positive reading is dropped rather than drawn: `value` is plain
        // `numeric` with no constraint on it, and a 0 cm waist is not a small
        // client, it is a bad row — one that would also report the previous
        // reading as an 84 cm gain.
        if (key == null || day == null || cm == null || cm <= 0) {
            skipped++;
            continue;
        }
        const list = bySite.get(key) ?? [];
        list.push({ atISO: r.taken_at, cm, day });
        bySite.set(key, list);
    }
    const sites = [];
    for (const { key, label } of exports.MEASURE_SITES) {
        const list = bySite.get(key);
        if (!list || !list.length)
            continue;
        // Sorted here rather than trusted from the query. The read is ordered
        // newest-first, but a pure function that only works when its caller
        // remembered an `.order()` is a function that will be called wrong.
        const sorted = [...list].sort((a, b) => b.day - a.day);
        const latest = sorted[0];
        // Strictly earlier, not merely later in the list. The table has no unique
        // constraint on (user_id, taken_at, kind), so two rows for the same site on
        // the same day are reachable — and a "change" between them is a change over
        // no elapsed time, which is not a trend, it is a correction.
        const earlier = sorted.find((p) => p.day < latest.day) ?? null;
        sites.push({
            key,
            label,
            latest: { atISO: latest.atISO, cm: latest.cm },
            previous: earlier ? { atISO: earlier.atISO, cm: earlier.cm } : null,
            readings: sorted.length,
        });
    }
    return { sites, skipped };
}
function measureBoard(sites) {
    if (sites == null)
        return { state: 'unreadable' };
    if (!sites.length)
        return { state: 'none' };
    return { state: 'measured', sites: [...sites] };
}
/** The sites nobody has measured yet, in the client's own list order. Worth
 *  naming: a coach seeing only a waist row cannot otherwise tell whether the
 *  client measures one site or whether the rest failed to arrive. Only honest
 *  under a whole read — under 'partial' an absent site may simply be older than
 *  the row limit — so the screen gates it. */
function unmeasuredSites(sites) {
    const have = new Set(sites.map((s) => s.key));
    return exports.MEASURE_SITES.filter((s) => !have.has(s.key)).map((s) => s.label);
}
/**
 * The change at one site since its previous reading, in centimetres — or null
 * when there is no previous reading to subtract.
 *
 * Centimetres, deliberately, and converted by the caller: this is a span, and
 * `lengthDeltaIn` has to see the whole span to round it once.
 */
function siteChangeCm(h) {
    return h.previous ? h.latest.cm - h.previous.cm : null;
}
/**
 * The sentence for how one site has moved.
 *
 * Signed, and nothing more than signed. `−1.2 cm since 3 Aug` says what the
 * tape says; whether that is the direction this client wants at this site is
 * not in the table and is not guessed at here — see `DIRECTION_CAVEAT`.
 */
function siteChangeLine(h, unit) {
    const cm = siteChangeCm(h);
    if (cm == null || h.previous == null) {
        return 'One reading only, so there is nothing yet to compare it to — not a change of zero.';
    }
    const d = (0, units_1.lengthDeltaIn)(cm, unit);
    const since = (0, coachWeek_1.dayHeading)(h.previous.atISO);
    // Through deltaLabel: a change smaller than the tenth of a unit the display
    // can carry (see the grain table in units.ts) rounds to nothing, and
    // "unchanged" is what the reading supports — the alternative is printing a
    // digit the tape cannot stand behind, with a sign in front of it.
    // `noBaseline` is unreachable — `cm` is finite and `lengthDeltaIn` returns a
    // number for it — but it is worded as "Unchanged" rather than left to the
    // default, so that if it ever is reached the sentence still reads as a
    // sentence about this site rather than about a missing reading.
    return `${(0, deltaLabel_1.deltaLabel)(d, { since, unit, noChange: 'Unchanged', noBaseline: `Unchanged since ${since}` })}.`;
}
/**
 * How long ago a site was measured, and how far past useful that is.
 *
 * Six weeks. A tape reading is taken to describe the body that is training now,
 * and a client will have worked through a whole block in that time — the figure
 * is still a true record of the day it was taken and is no longer an answer to
 * "where are they". Not a cliff: the age is printed at every distance, so the
 * threshold only changes the wording, never whether the coach is told.
 */
exports.STALE_DAYS = 42;
function siteAgeDays(h, todayISO) {
    return (0, coachWeek_1.daysBetweenIso)(h.latest.atISO, todayISO);
}
function isSiteStale(h, todayISO) {
    const d = siteAgeDays(h, todayISO);
    return d != null && d >= exports.STALE_DAYS;
}
function siteAgeLine(h, todayISO) {
    const on = (0, coachWeek_1.dayHeading)(h.latest.atISO);
    const when = (0, coachWeek_1.whenLabel)(h.latest.atISO, todayISO);
    return isSiteStale(h, todayISO)
        ? `Measured ${on} · ${when} — a training block ago, so it is not where they are now.`
        : `Measured ${on} · ${when}`;
}
/**
 * The one caveat that keeps the signed figures above honest.
 *
 * It is said once, at the section, rather than repeated per row, because a
 * warning attached to every line stops being read — and because it is a fact
 * about the whole table, not about any one site.
 */
exports.DIRECTION_CAVEAT = 'Each change is shown with its sign and nothing else. Whether down is progress ' +
    'depends on the site and on what they are working toward — a waist and an arm ' +
    'moving the same way mean opposite things — and the tape does not record which, ' +
    'so this screen does not colour it in.';
