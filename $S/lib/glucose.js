"use strict";
// Blood glucose, and the arithmetic around it.
//
// Repple does not talk to Dexcom or Abbott. A CGM writes its readings into
// Apple Health (and, on Android, Health Connect); Repple reads them out of
// there. So this file never sees a vendor — it sees samples, and its whole job
// is to turn them into something that can sit honestly next to a food log.
//
// ── TWO RULES THAT ARE NOT STYLE ────────────────────────────────────────────
//
// 1. NOTHING HERE GIVES ADVICE. Not a suggestion, not a "try fewer carbs", not
//    a traffic light that means "you did badly". A person wearing a CGM is
//    usually wearing it because of a diagnosis, and software that turns their
//    readings into dietary instructions is a regulated medical device, not a
//    fitness feature. `band()` below names the common reference range and says
//    so; the coach reads it and the coach decides.
//
// 2. AN ABSENT READING IS NEVER A ZERO. Every function here returns null where
//    it has nothing, and the callers render that as a dash. A glucose chart
//    that draws 0 mmol/L for "the sensor was off" is drawing a value that would
//    mean the person was dead.
//
// Storage is mmol/L, always — see supabase/parts/102-glucose.sql. mg/dL is a
// display unit, converted at the two edges (here, and the input parser).
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_FOR_PERCENT = exports.POST_MEAL_MINS = exports.TYPICAL_HIGH_MMOL = exports.TYPICAL_LOW_MMOL = exports.MAX_MMOL = exports.MIN_MMOL = exports.MGDL_PER_MMOL = void 0;
exports.mmolToMgdl = mmolToMgdl;
exports.mgdlToMmol = mgdlToMmol;
exports.plausible = plausible;
exports.formatGlucose = formatGlucose;
exports.band = band;
exports.parseHealthSamples = parseHealthSamples;
exports.mmolFromLevel = mmolFromLevel;
exports.parseHealthConnectRecords = parseHealthConnectRecords;
exports.pairMeals = pairMeals;
exports.summarise = summarise;
exports.unsaved = unsaved;
exports.parseTyped = parseTyped;
/**
 * mg/dL per mmol/L for glucose.
 *
 * It is not a universal constant — it is molar mass over 10, and glucose's
 * molar mass is 180.1559 g/mol. A different analyte has a different factor,
 * which is why this is named for glucose rather than called CONVERSION.
 */
exports.MGDL_PER_MMOL = 18.0182;
function mmolToMgdl(mmol) {
    return mmol * exports.MGDL_PER_MMOL;
}
function mgdlToMmol(mgdl) {
    return mgdl / exports.MGDL_PER_MMOL;
}
/**
 * The bounds a stored reading must sit inside, matching the CHECK on the
 * column. Anything outside is a broken import rather than a person: a garbage
 * row on a chart of somebody's sugars is worse than a missing one, because it
 * is the missing one they would have questioned.
 */
exports.MIN_MMOL = 0.5;
exports.MAX_MMOL = 40;
function plausible(mmol) {
    return typeof mmol === 'number' && Number.isFinite(mmol) && mmol >= exports.MIN_MMOL && mmol <= exports.MAX_MMOL;
}
/**
 * Format a stored mmol/L for display in whichever unit the reader uses.
 *
 * mmol/L is conventionally one decimal, mg/dL a whole number, and that is not
 * cosmetic: 5.5 and 99 carry roughly the same precision, so rendering mg/dL to
 * one decimal invents a digit the sensor never measured.
 */
function formatGlucose(mmol, unit) {
    if (typeof mmol !== 'number' || !Number.isFinite(mmol))
        return '—';
    return unit === 'mg/dL' ? String(Math.round(mmolToMgdl(mmol))) : mmol.toFixed(1);
}
exports.TYPICAL_LOW_MMOL = 3.9;
exports.TYPICAL_HIGH_MMOL = 7.8;
function band(mmol) {
    if (typeof mmol !== 'number' || !Number.isFinite(mmol))
        return 'unknown';
    if (mmol < exports.TYPICAL_LOW_MMOL)
        return 'below';
    if (mmol > exports.TYPICAL_HIGH_MMOL)
        return 'above';
    return 'typical';
}
/**
 * Turn raw `getBloodGlucoseSamples` rows into readings.
 *
 * The native module returns mmol/L by default (RCTAppleHealthKit builds the
 * unit from HKUnitMolarMassBloodGlucose and only overrides it if the caller
 * passes one), so no conversion happens here — and the reader passes no unit,
 * deliberately, so that stays true.
 *
 * Two things this does that a `.map()` would not:
 *
 *   · drops implausible values rather than storing them, and
 *   · collapses duplicate sample ids, because Health is re-read on every open
 *     and a CGM writes a sample every five minutes. Without the collapse a
 *     week of wearing one is 2,000 rows of the same fortnight.
 *
 * Newest first, matching how they are read back out of the table.
 */
function parseHealthSamples(rows) {
    if (!Array.isArray(rows))
        return [];
    const seen = new Set();
    const out = [];
    for (const r of rows) {
        const row = r;
        if (!row || typeof row !== 'object')
            continue;
        const mmol = Number(row.value);
        if (!plausible(mmol))
            continue;
        const at = typeof row.startDate === 'string' ? row.startDate : null;
        if (!at || Number.isNaN(Date.parse(at)))
            continue;
        const id = typeof row.id === 'string' && row.id ? row.id : null;
        if (id) {
            if (seen.has(id))
                continue;
            seen.add(id);
        }
        out.push({
            // A sample read out of the health store has no row of ours yet. Null
            // rather than the store's own uuid: `id` is this app's row id, and it is
            // what `remove` deletes by.
            id: null,
            at,
            // One decimal, because that is the column's scale. Rounding here rather
            // than letting Postgres do it keeps the value the app charted and the
            // value the row holds the same number.
            mmol: Math.round(mmol * 10) / 10,
            externalId: id,
            sourceName: typeof row.sourceName === 'string' && row.sourceName ? row.sourceName : null,
        });
    }
    out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return out;
}
/**
 * One record's level in mmol/L, whichever unit survived the bridge.
 *
 * Health Connect stores glucose in a unit the WRITING app chose, and exposes
 * it converted both ways. mmol/L is preferred because it is what the column
 * holds, so the ordinary path performs no arithmetic at all and cannot be
 * wrong by a factor of eighteen. mg/dL is the fallback, and it goes through
 * `mgdlToMmol` — the same function the typed-input parser uses — rather than
 * through a second constant written out here. There is one conversion factor
 * in this app and this is not the place to add a second.
 *
 * Null rather than 0 for anything unreadable: a level this function cannot
 * interpret must not become a reading of zero, which on a chart of somebody's
 * sugars is a value that would mean they were dead.
 */
function mmolFromLevel(level) {
    if (!level || typeof level !== 'object')
        return null;
    const l = level;
    const mmol = l.inMillimolesPerLiter;
    if (typeof mmol === 'number' && Number.isFinite(mmol))
        return mmol;
    const mgdl = l.inMilligramsPerDeciliter;
    if (typeof mgdl === 'number' && Number.isFinite(mgdl))
        return mgdlToMmol(mgdl);
    return null;
}
/**
 * Turn `readRecords('BloodGlucose')` records into readings.
 *
 * A record with no `metadata.id` keeps a null `externalId`, and `unsaved()`
 * then refuses to send it — which is the right outcome rather than a gap. An
 * id is the only thing that stops the same reading landing again on every
 * open, and Health Connect is re-read exactly as often as Apple Health is.
 */
function parseHealthConnectRecords(records) {
    if (!Array.isArray(records))
        return [];
    return parseHealthSamples(records.map((rec) => {
        const r = (rec ?? {});
        const meta = (r.metadata ?? {});
        return {
            value: mmolFromLevel(r.level),
            startDate: typeof r.time === 'string' ? r.time : null,
            id: typeof meta.id === 'string' ? meta.id : null,
            // The package name of the app that wrote it — 'com.dexcom.g7' and the
            // like. Not pretty, and not shown: the table stores only that a reading
            // came from the phone's health store, not which app put it there.
            sourceName: typeof meta.dataOrigin === 'string' ? meta.dataOrigin : null,
        };
    }));
}
/**
 * How long after a meal a reading is still attributed to it.
 *
 * Two hours is the window post-meal readings are conventionally quoted at, and
 * it is also roughly where the next meal starts competing for the credit —
 * which is why `pairMeals` stops at the next meal regardless.
 */
exports.POST_MEAL_MINS = 120;
const MIN = 60 * 1000;
/**
 * Line each meal up against the readings around it.
 *
 * The window closes early when the next meal starts, because a reading taken
 * ten minutes after lunch is lunch's, not breakfast's, and attributing it to
 * both is how a chart shows somebody spiking on a meal they ate two hours ago.
 *
 * `rise` is arithmetic, not a verdict. It is null unless BOTH ends are real
 * readings — a peak with no baseline is a number, not a rise, and subtracting
 * from an assumed 5.0 would be inventing the more important half.
 */
function pairMeals(meals, readings, windowMins = exports.POST_MEAL_MINS) {
    const ordered = [...meals]
        .filter((m) => !Number.isNaN(Date.parse(m.loggedAt)))
        .sort((a, b) => Date.parse(a.loggedAt) - Date.parse(b.loggedAt));
    return ordered.map((meal, i) => {
        const t = Date.parse(meal.loggedAt);
        const next = ordered[i + 1] ? Date.parse(ordered[i + 1].loggedAt) : Infinity;
        const closes = Math.min(t + windowMins * MIN, next);
        let before = null;
        let peak = null;
        for (const r of readings) {
            const rt = Date.parse(r.at);
            if (Number.isNaN(rt))
                continue;
            // A baseline more than an hour stale is not this meal's baseline.
            if (rt <= t && rt >= t - 60 * MIN) {
                if (!before || rt > Date.parse(before.at))
                    before = r;
            }
            if (rt > t && rt <= closes) {
                if (!peak || r.mmol > peak.mmol)
                    peak = r;
            }
        }
        return {
            meal,
            before,
            peak,
            rise: before && peak ? Math.round((peak.mmol - before.mmol) * 10) / 10 : null,
        };
    });
}
/** Below this many readings, a percentage is noise wearing a number's clothes. */
exports.MIN_FOR_PERCENT = 12;
function summarise(readings) {
    const rs = readings.filter((r) => plausible(r.mmol));
    if (rs.length === 0) {
        return { count: 0, latest: null, averageMmol: null, lowestMmol: null, highestMmol: null, inTypicalPct: null };
    }
    let sum = 0;
    let lo = rs[0].mmol;
    let hi = rs[0].mmol;
    let inRange = 0;
    let latest = rs[0];
    for (const r of rs) {
        sum += r.mmol;
        if (r.mmol < lo)
            lo = r.mmol;
        if (r.mmol > hi)
            hi = r.mmol;
        if (band(r.mmol) === 'typical')
            inRange++;
        if (Date.parse(r.at) > Date.parse(latest.at))
            latest = r;
    }
    return {
        count: rs.length,
        latest,
        averageMmol: Math.round((sum / rs.length) * 10) / 10,
        lowestMmol: lo,
        highestMmol: hi,
        inTypicalPct: rs.length >= exports.MIN_FOR_PERCENT ? Math.round((inRange / rs.length) * 100) : null,
    };
}
/**
 * Which of these readings are not already stored.
 *
 * The import is "read everything Health has since date X, keep what is new",
 * so this is the whole of the dedupe on the client side; the partial unique
 * index is the backstop for two devices importing at once.
 */
function unsaved(readings, storedExternalIds) {
    const have = new Set(storedExternalIds);
    return readings.filter((r) => r.externalId !== null && !have.has(r.externalId));
}
/**
 * Read a number a person typed, in whichever unit they read in.
 *
 * Returns null rather than 0 for anything it cannot use, including a value
 * that is plausible in the OTHER unit — 99 typed under mmol/L is a mg/dL
 * reading in the wrong box, and storing it as 99 mmol/L would put a point four
 * times off the top of every chart they ever look at.
 *
 * A single comma is a decimal point. The box on app/(client)/glucose.tsx is a
 * decimal pad, and the decimal key on that pad is a comma on a German, French,
 * Spanish or Italian phone — `Number('5,5')` is NaN, so a member in Berlin was
 * told their own reading was not a number every time they typed one. Read the
 * same way as every other typed figure in the app; see readNumber in
 * src/lib/units.ts. Two commas stay unreadable: that is a separator or a slip,
 * and guessing which would be inventing a blood-sugar reading.
 */
function parseTyped(text, unit) {
    const raw = String(text).trim();
    const n = (raw.match(/,/g) || []).length === 1 ? Number(raw.replace(',', '.')) : Number(raw);
    if (!Number.isFinite(n) || n <= 0)
        return null;
    const mmol = unit === 'mg/dL' ? mgdlToMmol(n) : n;
    if (!plausible(mmol))
        return null;
    return Math.round(mmol * 10) / 10;
}
