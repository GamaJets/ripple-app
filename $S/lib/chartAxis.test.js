"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// A chart axis may not invent a date, and may not close a gap.
// Compile with tsc, run with node.
//
// Two bugs shipped, and this suite is the pair of them written down.
//
// The first: three screens drew a six-month history with
// `series.filter((v) => v != null)` and then rendered all six month words
// underneath, evenly spaced. Four points across the full width, six labels
// across the full width — so every point sat above the wrong month. The chart
// was not missing its dates, it was stating wrong ones. The GAPS block below is
// what stops a fifth screen doing it again: position is by original index, and
// a hole breaks the line rather than being deleted from it.
//
// The second: the readout under a touched point ran `new Date(raw)` over
// whatever it was handed, which returns something for almost anything. The DASH
// block asserts the opposite — an unreadable timestamp produces an em dash and
// never a day. Every assertion in it has been checked to fail against the
// obvious wrong version (`return String(raw)`, `?? new Date()`, a non-strict
// regex); `npm run mutate -- --file src/lib/chartAxis.ts` puts them back.
// The `--` is load-bearing and this line used to omit it: without it npm eats
// the flag ("Unknown cli config") and hands scripts/mutate.mjs a bare path it
// does not accept, so the run silently mutates the WHOLE tree instead of the
// one file — minutes of work, and not the check the sentence promises.
//
// No expectation is written against a hardcoded "today", and no date is built
// by parsing a string. `npm test` runs three times under three timezones
// (`test:zones`) and the whole point of readDate is that it is a LOCAL boundary
// — a suite that parsed its own fixtures would be reproducing the bug inside
// the test and would pass in Dubai for the same reason the app did.
const chartAxis_1 = require("./chartAxis");
const format_1 = require("./format");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const eqJson = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── READING A DATE ───────────────────────────────────────────────────────── */
eqJson((0, chartAxis_1.readDate)('2026-08-14'), { y: 2026, m: 7, day: 14 }, 'a bare date reads as its own three numbers');
// A BARE date and a TIMESTAMP are read differently, and must be — see the
// header on localDate.ts.
//
// The instant is BUILT from the local day rather than written as a literal Z
// time, and the history of this line is the argument for it. It used to be
// `09:00Z`, chosen because 07:00-11:00Z is the only window landing on one
// calendar day across the three zones test:zones ran — UTC-7, UTC+4, UTC+12.
// That reasoning was sound and the window was still too narrow: at UTC-11
// 09:00Z on the 14th is the evening of the 13th, and at UTC+14 it is the 15th.
// Both are inhabited, test:zones now runs both, and no fixed UTC hour survives
// a +14 to -12 spread — the span is more than a day wide.
//
// Local noon has no such window to get wrong, and it asserts the same thing
// more directly: whatever instant local noon on the 14th is, `readDate` must
// call it the 14th.
const noonOn = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0).toISOString();
eqJson((0, chartAxis_1.readDate)(noonOn(2026, 8, 14)), { y: 2026, m: 7, day: 14 }, 'a timestamp reads as the local day of its instant');
// And the case where the two readings genuinely differ. 2026-08-14T20:00:00Z is
// still the 14th in Los Angeles (1pm) and Dubai (midnight, just), and is the
// 15th in Auckland (8am) — so the expectation is computed the way the code
// does rather than written down, and a readDate that read the digits off the
// string instead would be caught in Auckland.
{
    const instant = new Date(Date.parse('2026-08-14T20:00:00Z'));
    eqJson((0, chartAxis_1.readDate)('2026-08-14T20:00:00Z'), { y: instant.getFullYear(), m: instant.getMonth(), day: instant.getDate() }, 'an evening-UTC timestamp belongs to the reader’s own calendar day');
}
// The mirror of it: a bare date is NOT parsed, in any zone. `new Date(
// '2026-08-14')` is UTC midnight and reads back as the 13th in Los Angeles, so
// this assertion is what fails if readDate is ever collapsed to Date.parse.
eqJson((0, chartAxis_1.readDate)('2026-08-14'), { y: 2026, m: 7, day: 14 }, 'a bare date is the day that was written, in every timezone');
eq((0, chartAxis_1.axisLabel)('2026-08-14'), (0, format_1.fmtAxisDay)(2026, 7, 14), 'and it labels as that day, in every timezone');
eq((0, chartAxis_1.readDate)('2026-08-14T25:99:99Z'), null, 'a timestamp that cannot be parsed is not a date');
eqJson((0, chartAxis_1.readDate)('2026-08'), { y: 2026, m: 7, day: null }, 'a month key reads with no day');
eqJson((0, chartAxis_1.readDate)('  2026-08-14  '), { y: 2026, m: 7, day: 14 }, 'surrounding space is not part of the date');
// The strictness that localDate.dateParts does not have. Its regex counts
// digits and hands 2026-13-99 to `new Date(2026, 12, 99)`, which rolls forward
// into April 2027 without complaint. A chart rendering "8 Apr 2027" for a
// corrupt row is the invented date at its most convincing, so these must be
// null rather than a plausible day.
eq((0, chartAxis_1.readDate)('2026-13-01'), null, 'month 13 is not a date');
eq((0, chartAxis_1.readDate)('2026-00-01'), null, 'month 0 is not a date');
eq((0, chartAxis_1.readDate)('2026-02-30'), null, '30 February is not a date — it must not roll into March');
eq((0, chartAxis_1.readDate)('2026-08-00'), null, 'day 0 is not a date');
eq((0, chartAxis_1.readDate)('2026-08-32'), null, 'day 32 is not a date');
eq((0, chartAxis_1.readDate)('2026-99'), null, 'month 99 is not a month key');
eq((0, chartAxis_1.readDate)('not a date'), null, 'prose is not a date');
eq((0, chartAxis_1.readDate)(''), null, 'the empty string is not a date');
eq((0, chartAxis_1.readDate)(null), null, 'null is not a date');
eq((0, chartAxis_1.readDate)(undefined), null, 'undefined is not a date');
// A leap day is a real day and must survive the round-trip check that rejects
// 30 February. The check is "did the Date give back what I put in", and 2028 is
// a leap year, so this one comes back and 2027 does not.
eqJson((0, chartAxis_1.readDate)('2028-02-29'), { y: 2028, m: 1, day: 29 }, '29 February 2028 is a real day');
eq((0, chartAxis_1.readDate)('2027-02-29'), null, '29 February 2027 is not — it must not roll into March');
/* ── DASH: an unknown date is never rendered as a day ─────────────────────── */
eq((0, chartAxis_1.axisLabel)(null), chartAxis_1.DASH, 'a missing label is a dash');
eq((0, chartAxis_1.axisLabel)(undefined), chartAxis_1.DASH, 'an undefined label is a dash');
eq((0, chartAxis_1.axisLabel)(''), chartAxis_1.DASH, 'an empty label is a dash, not a blank');
eq((0, chartAxis_1.axisLabel)('   '), chartAxis_1.DASH, 'whitespace is a dash, not a blank');
eq((0, chartAxis_1.axisLabel)('2026-13-01'), chartAxis_1.DASH, 'an unreadable ISO date is a dash, not a rolled-over day');
eq((0, chartAxis_1.axisLabel)('2026-02-30'), chartAxis_1.DASH, 'a date that does not exist is a dash');
eq((0, chartAxis_1.pointLabel)(null), chartAxis_1.DASH, 'a missing point date is a dash');
eq((0, chartAxis_1.pointLabel)('2026-99-99'), chartAxis_1.DASH, 'an unreadable point date is a dash');
// The specific failure the old code had: it fell through to `String(raw)`, so a
// corrupt row printed itself onto the chart as though it were a date.
ok(!(0, chartAxis_1.axisLabel)('2026-13-01').includes('2026'), 'an unreadable date does not print itself as the label');
ok(!(0, chartAxis_1.pointLabel)('2026-13-01').includes('13'), 'an unreadable point date does not leak its digits');
// And the failure it would have had with the other obvious patch — falling back
// to now. A dash cannot be today, whatever day the suite runs on.
ok((0, chartAxis_1.axisLabel)('2026-13-01') === chartAxis_1.DASH && (0, chartAxis_1.pointLabel)(undefined) === chartAxis_1.DASH, 'an unreadable date is never filled in with today');
/* ── a label that is already a word is left alone ─────────────────────────── */
// useMrrHistory hands over month words it formatted itself, and trends.tsx
// hands over 'w/c 12/8'. Those are labels, not data, and reformatting somebody
// else's prose is not this file's job. The shape test is what separates them
// from raw ISO — 'w/c 12/8' must not become a dash for starting with letters,
// and '2026-99-99' must not become a label for being a string.
eq((0, chartAxis_1.axisLabel)('Aug'), 'Aug', 'a formatted word passes through untouched');
eq((0, chartAxis_1.axisLabel)('w/c 12/8'), 'w/c 12/8', 'a caller-made label passes through untouched');
eq((0, chartAxis_1.pointLabel)('Aug'), 'Aug', 'a formatted word passes through the point readout too');
eq((0, chartAxis_1.looksIso)('2026-08'), true, 'a month key claims to be a machine date');
eq((0, chartAxis_1.looksIso)('2026-08-14'), true, 'a bare date claims to be a machine date');
eq((0, chartAxis_1.looksIso)('Aug'), false, 'a word does not claim to be a machine date');
eq((0, chartAxis_1.looksIso)('w/c 12/8'), false, 'a slashed label does not claim to be a machine date');
eq((0, chartAxis_1.looksIso)(null), false, 'nothing does not claim to be a machine date');
/* ── TIMEZONES: a month key is a local month, everywhere ──────────────────── */
// This is the assertion the whole suite is really for. `new Date('2026-08')` is
// UTC midnight, and read back through a local getter it is July in Los Angeles
// and August in Dubai. The expectation is built from the same numbers the code
// builds from, never by parsing, so it means the same thing under all three
// zones of test:zones — and it fails in exactly one of them if readDate is ever
// "simplified" back to Date.parse.
eq((0, chartAxis_1.axisLabel)('2026-08'), (0, format_1.fmtAxisMonth)(2026, 7), 'a month key labels as its own month in every timezone');
eq((0, chartAxis_1.pointLabel)('2026-08'), (0, format_1.fmtPointMonth)(2026, 7), 'a month key reads out as its own month in every timezone');
eq((0, chartAxis_1.axisLabel)('2026-01'), (0, format_1.fmtAxisMonth)(2026, 0), 'January does not become the previous December');
eq((0, chartAxis_1.axisLabel)('2026-08-01'), (0, format_1.fmtAxisDay)(2026, 7, 1), 'the first of the month does not become the last of the previous one');
eq((0, chartAxis_1.pointLabel)('2026-08-14'), (0, format_1.fmtPointDay)(2026, 7, 14), 'a bare date reads out as the day that was written');
// The readouts differ in precision, and that difference is deliberate: the axis
// is scanned, the touch readout answers "when exactly" and carries the year.
ok((0, chartAxis_1.pointLabel)('2026-08-14').includes('2026'), 'the touch readout carries the year');
ok(!(0, chartAxis_1.axisLabel)('2026-08-14').includes('2026'), 'the axis label does not carry a four-digit year');
/* ── GAPS: a hole keeps its slot ──────────────────────────────────────────── */
// The shipped bug, written as data. Six months, the first two never recorded.
const sparse = [null, null, 10, 12, 14, 16];
eqJson((0, chartAxis_1.readablePoints)(sparse).map((p) => p.i), [2, 3, 4, 5], 'a readable point keeps the index it had — this is what puts it under its own label');
eqJson((0, chartAxis_1.readablePoints)(sparse).map((p) => p.v), [10, 12, 14, 16], 'and keeps its value');
// The filter that shipped produced [10,12,14,16] with indices 0..3, which is
// how the May point came to sit above the July label. Index 0 must be index 2.
eq((0, chartAxis_1.readablePoints)(sparse)[0].i, 2, 'the first drawn point is not moved to the start of the axis');
eqJson((0, chartAxis_1.segments)([1, 2, null, 4, 5]).map((s) => s.map((p) => p.i)), [[0, 1], [3, 4]], 'a hole breaks the line into two runs rather than being deleted from it');
eqJson((0, chartAxis_1.segments)([1, 2, 3]).map((s) => s.map((p) => p.i)), [[0, 1, 2]], 'an unbroken series is one run');
eqJson((0, chartAxis_1.segments)([null, 5, null]).map((s) => s.map((p) => p.i)), [[1]], 'a lone reading between two holes is kept — it is the only evidence the month was recorded');
eqJson((0, chartAxis_1.segments)([null, null]), [], 'a series with nothing readable draws nothing');
eqJson((0, chartAxis_1.segments)([]), [], 'an empty series draws nothing');
// NaN and Infinity are typeof 'number' and would plot as a hole in the line
// with no explanation. They are holes, and named as such.
eqJson((0, chartAxis_1.segments)([1, NaN, 3]).map((s) => s.map((p) => p.i)), [[0], [2]], 'NaN is a hole, not a value');
eqJson((0, chartAxis_1.segments)([1, Infinity, 3]).map((s) => s.map((p) => p.i)), [[0], [2]], 'Infinity is a hole, not a value');
eq((0, chartAxis_1.hasInteriorGap)([1, 2, 3]), false, 'a complete series has no interior gap');
eq((0, chartAxis_1.hasInteriorGap)([1, null, 3]), true, 'a missing middle is an interior gap');
eq((0, chartAxis_1.hasInteriorGap)(sparse), false, 'leading holes are not a gap — nothing is being bridged');
eq((0, chartAxis_1.hasInteriorGap)([1, 2, null]), false, 'trailing holes are not a gap either');
eq((0, chartAxis_1.hasInteriorGap)([5]), false, 'one point cannot span a gap');
eq((0, chartAxis_1.hasInteriorGap)([]), false, 'no points cannot span a gap');
/* ── touching a gap snaps to a real reading ───────────────────────────────── */
eq((0, chartAxis_1.nearestPoint)([1, null, null, 4], 2).i, 3, 'a touch on a hole snaps to the nearest real point');
eq((0, chartAxis_1.nearestPoint)([1, null, null, 4], 1).i, 0, 'and to the one on the other side when that is nearer');
eq((0, chartAxis_1.nearestPoint)([1, null, null, 4], 2).v, 4, 'and reports that point’s own value, not an interpolation');
eq((0, chartAxis_1.nearestPoint)([null, null], 0), null, 'a touch on a series with nothing readable reports nothing');
eq((0, chartAxis_1.nearestPoint)([], 0), null, 'a touch on an empty series reports nothing');
/* ── TICKS ────────────────────────────────────────────────────────────────── */
eqJson((0, chartAxis_1.tickIndices)(6, 3), [0, 3, 5], 'three ticks span the series, ends included');
eqJson((0, chartAxis_1.tickIndices)(2, 4), [0, 1], 'two points are two ticks');
eqJson((0, chartAxis_1.tickIndices)(4, 4), [0, 1, 2, 3], 'every point is labelled when they all fit');
eqJson((0, chartAxis_1.tickIndices)(10, 2), [0, 9], 'the ends are the minimum, and are never dropped');
eqJson((0, chartAxis_1.tickIndices)(10, 1), [0, 9], 'asking for fewer than two still gives both ends');
eqJson((0, chartAxis_1.tickIndices)(1, 4), [0], 'a single point is a single tick');
eqJson((0, chartAxis_1.tickIndices)(0, 4), [], 'no points, no ticks');
// The ends are the answer to "what period is this", so they are asserted
// separately from the spacing — a thinning routine that drops the last tick
// still looks reasonable and loses the thing the change was asked for.
for (const [n, max] of [[6, 3], [12, 4], [31, 5], [100, 6], [7, 2]]) {
    const t = (0, chartAxis_1.tickIndices)(n, max);
    eq(t[0], 0, `ticks(${n},${max}) starts at the first point`);
    eq(t[t.length - 1], n - 1, `ticks(${n},${max}) ends at the last point`);
    ok(t.length <= max, `ticks(${n},${max}) does not exceed the width it was given`);
    ok(t.every((v, i) => i === 0 || v > t[i - 1]), `ticks(${n},${max}) are in order and not repeated`);
    ok(t.every((v) => Number.isInteger(v) && v >= 0 && v < n), `ticks(${n},${max}) all land on real points — a tick between two points would need a date inventing for it`);
}
eq((0, chartAxis_1.maxTicksForWidth)(320), 5, 'a phone-width axis carries five labels');
eq((0, chartAxis_1.maxTicksForWidth)(100), 2, 'a narrow axis still carries both ends');
eq((0, chartAxis_1.maxTicksForWidth)(0), 2, 'a zero width — the first render, before onLayout — still carries both ends');
eq((0, chartAxis_1.maxTicksForWidth)(-50), 2, 'a nonsense width does not produce a nonsense axis');
eq((0, chartAxis_1.maxTicksForWidth)(Number.NaN), 2, 'an unmeasured width does not produce a nonsense axis');
eq((0, chartAxis_1.maxTicksForWidth)(10000), 6, 'a very wide axis stops at six — past that the labels are a texture');
/* ── the two rules, together ──────────────────────────────────────────────── */
// The end-to-end shape of the fixed owner chart: six month slots, the first two
// never recorded, labelled from the same indices the points are drawn at. Slot
// 2 holds the first reading and slot 2's label is the month that reading is
// from. That correspondence is the entire fix.
{
    const labels = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];
    const ticks = (0, chartAxis_1.tickIndices)(labels.length, (0, chartAxis_1.maxTicksForWidth)(320));
    const drawn = (0, chartAxis_1.readablePoints)(sparse);
    eq(drawn[0].i, 2, 'the first reading is at slot 2');
    eq((0, chartAxis_1.axisLabel)(labels[drawn[0].i]), (0, format_1.fmtAxisMonth)(2026, 4), 'and slot 2 is labelled May — its own month');
    ok(ticks.every((i) => i >= 0 && i < labels.length), 'every tick indexes a real label');
    eqJson(ticks.map((i) => (0, chartAxis_1.axisLabel)(labels[i])).filter((s) => s === chartAxis_1.DASH), [], 'no tick on a fully dated series renders as a dash');
}
// And the same window with one label corrupted: that one slot dashes, and the
// others are unaffected. A single bad row does not cost the axis its dates, and
// does not gain the reader a made-up one.
{
    const labels = ['2026-03', 'oops-99', '2026-05'];
    eqJson(labels.map(chartAxis_1.axisLabel), [(0, format_1.fmtAxisMonth)(2026, 2), 'oops-99', (0, format_1.fmtAxisMonth)(2026, 4)], 'a non-ISO label passes through while its neighbours format normally');
    eq((0, chartAxis_1.axisLabel)('2026-99'), chartAxis_1.DASH, 'an ISO-shaped label that cannot be read dashes on its own');
}
if (errors.length) {
    console.error(`chartAxis: ${errors.length} failure(s)\n`);
    for (const e of errors)
        console.error('  ' + e);
    process.exit(1);
}
console.log('chartAxis ok — a chart states the date of every point it plots, or a dash');
