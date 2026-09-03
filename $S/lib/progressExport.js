"use strict";
// What a progress export is made of, with no React Native in sight.
//
// These functions were written inside src/lib/exportShare.ts, which imports
// react-native for the Share API. The test suite runs under plain node, so
// anything importing that module cannot be asserted against — and the answers
// here are exactly the kind that need asserting: whether a single scan reports
// a change (it must not), whether a missing figure becomes an empty CSV cell
// (it must) and whether a gain is described as a gain.
//
// Split out on the same reasoning as ics.ts. exportShare re-exports everything
// below, so every existing call site is untouched.
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROGRESS_CSV_HEADER = exports.dayLabel = exports.figure = void 0;
exports.progressChange = progressChange;
exports.progressChangeLines = progressChangeLines;
exports.progressSpanLabel = progressSpanLabel;
exports.progressSummary = progressSummary;
exports.progressCsv = progressCsv;
const gymExport_1 = require("./gymExport");
const localDate_1 = require("./localDate");
// TF-37 reached every screen and stopped at the door. The documents built here
// are the ones a client SENDS — to a coach, to a spreadsheet, to a story — and
// they were emitting kilograms to a client who reads pounds, which is the one
// audience least able to check. The unit arrives as an argument rather than
// from a provider because everything in this module is pure and has to stay
// that way: it is the half of the export the node suite can actually assert on.
const units_1 = require("./units");
const deltaLabel_1 = require("./deltaLabel");
const progressMetrics = (unit) => [
    { key: 'weightKg', label: 'Weight', suffix: ` ${unit}`, mass: true },
    { key: 'bodyFatPct', label: 'Body Fat', suffix: '%', mass: false },
    { key: 'muscleKg', label: 'Muscle', suffix: ` ${unit}`, mass: true },
];
/**
 * A stored figure as this document should print it.
 *
 * The non-null assertions are not a shortcut past the missing-reading rule:
 * every caller below has already established that the value is a finite
 * reading (`progressChange` filters for it, and the summary's latest-scan
 * branch tests for null first), so `weightIn` cannot answer null here. Where a
 * reading may genuinely be absent — the document table, the CSV — the nullable
 * result is passed straight through to `figure()` and becomes a dash.
 */
const readingShown = (v, spec, unit) => spec.mass ? (0, units_1.weightIn)(v, unit) : v;
/** A stored CHANGE as this document should print it: converted as one span. */
const changeShown = (v, spec, unit) => spec.mass ? (0, units_1.weightDeltaIn)(v, unit) : v;
/** A figure for display, or an em-dash where there is no reading. */
const figure = (v, unit = '') => v == null || !Number.isFinite(v) ? '—' : `${v}${unit}`;
exports.figure = figure;
/** A date-only value as the reader's own day, never shifted by their timezone. */
const dayLabel = (iso) => (0, localDate_1.localDate)(iso)?.toLocaleDateString() ?? iso;
exports.dayLabel = dayLabel;
/**
 * The first and last readings of one metric, and the change between them.
 *
 * Computed per metric rather than per row because the rows are not uniform: a
 * client whose gym scale reports weight every week but skeletal muscle only on
 * the InBody has two series of different lengths, and the change in muscle has
 * to be measured between the two scans that actually recorded muscle. Fewer
 * than two readings is not a change, and returns null rather than a zero —
 * "0.0 kg" and "we cannot say yet" are opposite claims.
 */
function progressChange(rows, key) {
    const seen = rows.filter((r) => r[key] != null && Number.isFinite(r[key]));
    if (seen.length < 2)
        return null;
    const a = seen[0], b = seen[seen.length - 1];
    const from = a[key], to = b[key];
    return { from, to, change: Math.round((to - from) * 10) / 10, fromDate: a.date, toDate: b.date };
}
/**
 * One line per metric that has two readings to compare — nothing for the rest.
 *
 * The direction is taken from the sign rather than assumed: a client who has
 * gained weight on purpose is not "down 3 kg", and the same screen has been
 * fixed for that before (see app/(client)/social.tsx).
 */
function progressChangeLines(rows, 
// No `= 'kg'`. A defaulted unit in a pure module is the same defect as
// `money(cents, currency = 'AED')` was: `clients.weight_unit` is NULL until
// somebody taps one, and a caller with no unit to pass is a caller that does
// not know — not a caller who means kilograms. Every call site in the product
// already passes the member's own unit; the default only ever stood between a
// forgotten one and a compile error.
unit) {
    return progressMetrics(unit).flatMap((spec) => {
        const c = progressChange(rows, spec.key);
        if (!c)
            return [];
        const from = readingShown(c.from, spec, unit), to = readingShown(c.to, spec, unit);
        const change = changeShown(c.change, spec, unit);
        // The sign belongs to the figure printed beside it, not to the stored one.
        // A 0.2 kg loss is −0.44 lb, which is no whole pounds at all: "(−0 lb)"
        // would be a direction attached to nothing, and "(+0 lb)" is not a thing
        // anybody writes. A converted zero gets no sign and says what it is.
        //
        // Through deltaSign so that this is the app's one rule about zero rather
        // than a local copy of it. The precision asked for is deliberately finer
        // than any metric here carries: `Math.abs(change)` is interpolated at full
        // precision, so the question is simply whether the printed figure is a
        // movement, and a coarser rounding here would sign a figure the reader can
        // see is not zero.
        const sign = (0, deltaLabel_1.deltaSign)(change, 6);
        return [`${spec.label} ${from}${spec.suffix} → ${to}${spec.suffix} (${sign}${Math.abs(change)}${spec.suffix})`];
    });
}
/**
 * What the client is about to send, in one line — "6 scans, 12/02/2026 to
 * 24/08/2026". Shown before the share sheet opens, because half of TF-21 is
 * knowing the size and span of the thing, not just its file format.
 */
function progressSpanLabel(rows) {
    if (!rows.length)
        return 'No scans yet';
    const count = `${rows.length} scan${rows.length === 1 ? '' : 's'}`;
    const a = (0, exports.dayLabel)(rows[0].date), b = (0, exports.dayLabel)(rows[rows.length - 1].date);
    return a === b ? `${count} from ${a}` : `${count}, ${a} to ${b}`;
}
/**
 * The share-sheet message.
 *
 * Long enough to be worth receiving: a coach who opens it in WhatsApp should
 * be able to see the change without asking for a file, and a story posted from
 * it should say something. A bare app link would satisfy neither, which is
 * what TF-25 was complaining about.
 *
 * With fewer than two scans there is no change to report, so it states the
 * latest reading instead of dressing a single scan up as progress.
 */
function progressSummary(name, rows, brand = 'Repple', 
// As above: the unit arrives, it is never assumed.
unit) {
    const first = (name || '').split(' ')[0] || 'My';
    const head = `${first === 'My' ? 'My' : first + "'s"} progress — ${brand}`;
    if (!rows.length)
        return `${head}\nNo scans recorded yet.`;
    const lines = progressChangeLines(rows, unit);
    if (lines.length)
        return [head, progressSpanLabel(rows), '', ...lines].join('\n');
    const last = rows[rows.length - 1];
    const latest = progressMetrics(unit)
        // Finite, not merely non-null. `figure()` used to be the thing that caught
        // a NaN reading here; now that the value is converted on the way past, the
        // check has to happen before the conversion rather than after it.
        .filter((spec) => Number.isFinite(last[spec.key]))
        .map((spec) => `${spec.label} ${(0, exports.figure)(readingShown(last[spec.key], spec, unit), spec.suffix)}`);
    return [head, `Latest scan ${(0, exports.dayLabel)(last.date)}`, ...(latest.length ? ['', latest.join(' · ')] : [])].join('\n');
}
/**
 * The importable half of the product owner's "both".
 *
 * Column names are snake_case and unit-suffixed so the receiving app needs no
 * legend: `weight_kg` cannot be mistaken for pounds the way `weight` can. One
 * row per scan, oldest first, in the order the caller supplied. Figures go out
 * as bare numbers — no unit inside the cell, no thousands separator, no
 * percent sign — because a spreadsheet that has to strip characters before it
 * can add up a column is not importable, it is just a table in a text file.
 *
 * ── This file stays METRIC, and that is a decision, not an omission ────────
 *
 * TF-37 converted every screen, and the report and the summary below it now
 * convert too, because a person reading a sentence about their own body should
 * read it in their own unit. This one does not, and the split is on purpose:
 * the other two are read by a human, this one is parsed by a machine.
 *
 * The alternative was honest enough — convert the cells and rename the header
 * to `weight_lb` — and it was rejected for what it does to the file as a
 * format. A header that changes with a per-client setting is a schema that
 * changes with a per-client setting: two clients' exports of the same coach's
 * roster stop stacking into one sheet, a column formula written against last
 * month's file silently means something different this month, and an importer
 * that has been reading `weight_kg` for a year starts finding nothing without
 * failing. None of that is visible to the person who tapped Share, and all of
 * it is invisible to whoever opens the file next.
 *
 * What must never happen is the third option — pounds in the cells under a
 * header that still says `weight_kg`. A stated unit that is wrong is worse
 * than either honest answer, because nothing downstream has any way to catch
 * it. So the header keeps naming the unit the cells are actually in, the cells
 * stay in the unit the record is stored in, and the share sheet in
 * app/(client)/scans.tsx tells a pounds reader that the spreadsheet is in
 * kilograms BEFORE they send it, rather than leaving them to notice.
 */
exports.PROGRESS_CSV_HEADER = ['date', 'weight_kg', 'body_fat_pct', 'skeletal_muscle_kg'];
/** Deliberately takes no unit — see the header constant above for why. */
function progressCsv(rows) {
    return (0, gymExport_1.toCsv)(exports.PROGRESS_CSV_HEADER, 
    // isoDatePart rather than a slice: a date it does not recognise comes back
    // empty instead of being guessed at, which is the same rule the figures
    // follow one column over.
    rows.map((r) => [(0, gymExport_1.isoDatePart)(r.date), r.weightKg, r.bodyFatPct, r.muscleKg]));
}
