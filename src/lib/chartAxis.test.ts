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
// regex); `npm run mutate --file src/lib/chartAxis.ts` puts them back.
//
// No expectation is written against a hardcoded "today", and no date is built
// by parsing a string. `npm test` runs three times under three timezones
// (`test:zones`) and the whole point of readDate is that it is a LOCAL boundary
// — a suite that parsed its own fixtures would be reproducing the bug inside
// the test and would pass in Dubai for the same reason the app did.
import {
  DASH, readDate, looksIso, axisLabel, pointLabel, tickIndices, maxTicksForWidth,
  readablePoints, segments, hasInteriorGap, nearestPoint,
} from './chartAxis';
import { fmtAxisDay, fmtAxisMonth, fmtPointDay, fmtPointMonth } from './format';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const eqJson = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── READING A DATE ───────────────────────────────────────────────────────── */

eqJson(readDate('2026-08-14'), { y: 2026, m: 7, day: 14 }, 'a bare date reads as its own three numbers');

// A BARE date and a TIMESTAMP are read differently, and must be — see the
// header on localDate.ts.
//
// 09:00Z is deliberate and the window is narrow. test:zones runs at UTC-7,
// UTC+4 and UTC+12, so the only UTC hours that land on the same calendar day in
// all three are 07:00 to 11:00: an hour earlier and Los Angeles is on the 13th,
// an hour later and Auckland is on the 15th. Picking midday, which reads like
// the safe choice, fails in Auckland — which is the whole point of running the
// suite in three zones rather than reasoning about one.
eqJson(readDate('2026-08-14T09:00:00Z'), { y: 2026, m: 7, day: 14 }, 'a timestamp reads as the local day of its instant');

// And the case where the two readings genuinely differ. 2026-08-14T20:00:00Z is
// still the 14th in Los Angeles (1pm) and Dubai (midnight, just), and is the
// 15th in Auckland (8am) — so the expectation is computed the way the code
// does rather than written down, and a readDate that read the digits off the
// string instead would be caught in Auckland.
{
  const instant = new Date(Date.parse('2026-08-14T20:00:00Z'));
  eqJson(readDate('2026-08-14T20:00:00Z'),
    { y: instant.getFullYear(), m: instant.getMonth(), day: instant.getDate() },
    'an evening-UTC timestamp belongs to the reader’s own calendar day');
}

// The mirror of it: a bare date is NOT parsed, in any zone. `new Date(
// '2026-08-14')` is UTC midnight and reads back as the 13th in Los Angeles, so
// this assertion is what fails if readDate is ever collapsed to Date.parse.
eqJson(readDate('2026-08-14'), { y: 2026, m: 7, day: 14 },
  'a bare date is the day that was written, in every timezone');
eq(axisLabel('2026-08-14'), fmtAxisDay(2026, 7, 14), 'and it labels as that day, in every timezone');

eq(readDate('2026-08-14T25:99:99Z'), null, 'a timestamp that cannot be parsed is not a date');
eqJson(readDate('2026-08'), { y: 2026, m: 7, day: null }, 'a month key reads with no day');
eqJson(readDate('  2026-08-14  '), { y: 2026, m: 7, day: 14 }, 'surrounding space is not part of the date');

// The strictness that localDate.dateParts does not have. Its regex counts
// digits and hands 2026-13-99 to `new Date(2026, 12, 99)`, which rolls forward
// into April 2027 without complaint. A chart rendering "8 Apr 2027" for a
// corrupt row is the invented date at its most convincing, so these must be
// null rather than a plausible day.
eq(readDate('2026-13-01'), null, 'month 13 is not a date');
eq(readDate('2026-00-01'), null, 'month 0 is not a date');
eq(readDate('2026-02-30'), null, '30 February is not a date — it must not roll into March');
eq(readDate('2026-08-00'), null, 'day 0 is not a date');
eq(readDate('2026-08-32'), null, 'day 32 is not a date');
eq(readDate('2026-99'), null, 'month 99 is not a month key');
eq(readDate('not a date'), null, 'prose is not a date');
eq(readDate(''), null, 'the empty string is not a date');
eq(readDate(null), null, 'null is not a date');
eq(readDate(undefined), null, 'undefined is not a date');

// A leap day is a real day and must survive the round-trip check that rejects
// 30 February. The check is "did the Date give back what I put in", and 2028 is
// a leap year, so this one comes back and 2027 does not.
eqJson(readDate('2028-02-29'), { y: 2028, m: 1, day: 29 }, '29 February 2028 is a real day');
eq(readDate('2027-02-29'), null, '29 February 2027 is not — it must not roll into March');

/* ── DASH: an unknown date is never rendered as a day ─────────────────────── */

eq(axisLabel(null), DASH, 'a missing label is a dash');
eq(axisLabel(undefined), DASH, 'an undefined label is a dash');
eq(axisLabel(''), DASH, 'an empty label is a dash, not a blank');
eq(axisLabel('   '), DASH, 'whitespace is a dash, not a blank');
eq(axisLabel('2026-13-01'), DASH, 'an unreadable ISO date is a dash, not a rolled-over day');
eq(axisLabel('2026-02-30'), DASH, 'a date that does not exist is a dash');
eq(pointLabel(null), DASH, 'a missing point date is a dash');
eq(pointLabel('2026-99-99'), DASH, 'an unreadable point date is a dash');

// The specific failure the old code had: it fell through to `String(raw)`, so a
// corrupt row printed itself onto the chart as though it were a date.
ok(!axisLabel('2026-13-01').includes('2026'), 'an unreadable date does not print itself as the label');
ok(!pointLabel('2026-13-01').includes('13'), 'an unreadable point date does not leak its digits');

// And the failure it would have had with the other obvious patch — falling back
// to now. A dash cannot be today, whatever day the suite runs on.
ok(axisLabel('2026-13-01') === DASH && pointLabel(undefined) === DASH,
  'an unreadable date is never filled in with today');

/* ── a label that is already a word is left alone ─────────────────────────── */

// useMrrHistory hands over month words it formatted itself, and trends.tsx
// hands over 'w/c 12/8'. Those are labels, not data, and reformatting somebody
// else's prose is not this file's job. The shape test is what separates them
// from raw ISO — 'w/c 12/8' must not become a dash for starting with letters,
// and '2026-99-99' must not become a label for being a string.
eq(axisLabel('Aug'), 'Aug', 'a formatted word passes through untouched');
eq(axisLabel('w/c 12/8'), 'w/c 12/8', 'a caller-made label passes through untouched');
eq(pointLabel('Aug'), 'Aug', 'a formatted word passes through the point readout too');
eq(looksIso('2026-08'), true, 'a month key claims to be a machine date');
eq(looksIso('2026-08-14'), true, 'a bare date claims to be a machine date');
eq(looksIso('Aug'), false, 'a word does not claim to be a machine date');
eq(looksIso('w/c 12/8'), false, 'a slashed label does not claim to be a machine date');
eq(looksIso(null), false, 'nothing does not claim to be a machine date');

/* ── TIMEZONES: a month key is a local month, everywhere ──────────────────── */

// This is the assertion the whole suite is really for. `new Date('2026-08')` is
// UTC midnight, and read back through a local getter it is July in Los Angeles
// and August in Dubai. The expectation is built from the same numbers the code
// builds from, never by parsing, so it means the same thing under all three
// zones of test:zones — and it fails in exactly one of them if readDate is ever
// "simplified" back to Date.parse.
eq(axisLabel('2026-08'), fmtAxisMonth(2026, 7), 'a month key labels as its own month in every timezone');
eq(pointLabel('2026-08'), fmtPointMonth(2026, 7), 'a month key reads out as its own month in every timezone');
eq(axisLabel('2026-01'), fmtAxisMonth(2026, 0), 'January does not become the previous December');
eq(axisLabel('2026-08-01'), fmtAxisDay(2026, 7, 1), 'the first of the month does not become the last of the previous one');
eq(pointLabel('2026-08-14'), fmtPointDay(2026, 7, 14), 'a bare date reads out as the day that was written');

// The readouts differ in precision, and that difference is deliberate: the axis
// is scanned, the touch readout answers "when exactly" and carries the year.
ok(pointLabel('2026-08-14').includes('2026'), 'the touch readout carries the year');
ok(!axisLabel('2026-08-14').includes('2026'), 'the axis label does not carry a four-digit year');

/* ── GAPS: a hole keeps its slot ──────────────────────────────────────────── */

// The shipped bug, written as data. Six months, the first two never recorded.
const sparse = [null, null, 10, 12, 14, 16];

eqJson(readablePoints(sparse).map((p) => p.i), [2, 3, 4, 5],
  'a readable point keeps the index it had — this is what puts it under its own label');
eqJson(readablePoints(sparse).map((p) => p.v), [10, 12, 14, 16], 'and keeps its value');

// The filter that shipped produced [10,12,14,16] with indices 0..3, which is
// how the May point came to sit above the July label. Index 0 must be index 2.
eq(readablePoints(sparse)[0].i, 2, 'the first drawn point is not moved to the start of the axis');

eqJson(segments([1, 2, null, 4, 5]).map((s) => s.map((p) => p.i)), [[0, 1], [3, 4]],
  'a hole breaks the line into two runs rather than being deleted from it');
eqJson(segments([1, 2, 3]).map((s) => s.map((p) => p.i)), [[0, 1, 2]],
  'an unbroken series is one run');
eqJson(segments([null, 5, null]).map((s) => s.map((p) => p.i)), [[1]],
  'a lone reading between two holes is kept — it is the only evidence the month was recorded');
eqJson(segments([null, null]), [], 'a series with nothing readable draws nothing');
eqJson(segments([]), [], 'an empty series draws nothing');

// NaN and Infinity are typeof 'number' and would plot as a hole in the line
// with no explanation. They are holes, and named as such.
eqJson(segments([1, NaN, 3]).map((s) => s.map((p) => p.i)), [[0], [2]], 'NaN is a hole, not a value');
eqJson(segments([1, Infinity, 3]).map((s) => s.map((p) => p.i)), [[0], [2]], 'Infinity is a hole, not a value');

eq(hasInteriorGap([1, 2, 3]), false, 'a complete series has no interior gap');
eq(hasInteriorGap([1, null, 3]), true, 'a missing middle is an interior gap');
eq(hasInteriorGap(sparse), false, 'leading holes are not a gap — nothing is being bridged');
eq(hasInteriorGap([1, 2, null]), false, 'trailing holes are not a gap either');
eq(hasInteriorGap([5]), false, 'one point cannot span a gap');
eq(hasInteriorGap([]), false, 'no points cannot span a gap');

/* ── touching a gap snaps to a real reading ───────────────────────────────── */

eq(nearestPoint([1, null, null, 4], 2)!.i, 3, 'a touch on a hole snaps to the nearest real point');
eq(nearestPoint([1, null, null, 4], 1)!.i, 0, 'and to the one on the other side when that is nearer');
eq(nearestPoint([1, null, null, 4], 2)!.v, 4, 'and reports that point’s own value, not an interpolation');
eq(nearestPoint([null, null], 0), null, 'a touch on a series with nothing readable reports nothing');
eq(nearestPoint([], 0), null, 'a touch on an empty series reports nothing');

/* ── TICKS ────────────────────────────────────────────────────────────────── */

eqJson(tickIndices(6, 3), [0, 3, 5], 'three ticks span the series, ends included');
eqJson(tickIndices(2, 4), [0, 1], 'two points are two ticks');
eqJson(tickIndices(4, 4), [0, 1, 2, 3], 'every point is labelled when they all fit');
eqJson(tickIndices(10, 2), [0, 9], 'the ends are the minimum, and are never dropped');
eqJson(tickIndices(10, 1), [0, 9], 'asking for fewer than two still gives both ends');
eqJson(tickIndices(1, 4), [0], 'a single point is a single tick');
eqJson(tickIndices(0, 4), [], 'no points, no ticks');

// The ends are the answer to "what period is this", so they are asserted
// separately from the spacing — a thinning routine that drops the last tick
// still looks reasonable and loses the thing the change was asked for.
for (const [n, max] of [[6, 3], [12, 4], [31, 5], [100, 6], [7, 2]] as [number, number][]) {
  const t = tickIndices(n, max);
  eq(t[0], 0, `ticks(${n},${max}) starts at the first point`);
  eq(t[t.length - 1], n - 1, `ticks(${n},${max}) ends at the last point`);
  ok(t.length <= max, `ticks(${n},${max}) does not exceed the width it was given`);
  ok(t.every((v, i) => i === 0 || v > t[i - 1]), `ticks(${n},${max}) are in order and not repeated`);
  ok(t.every((v) => Number.isInteger(v) && v >= 0 && v < n),
    `ticks(${n},${max}) all land on real points — a tick between two points would need a date inventing for it`);
}

eq(maxTicksForWidth(320), 5, 'a phone-width axis carries five labels');
eq(maxTicksForWidth(100), 2, 'a narrow axis still carries both ends');
eq(maxTicksForWidth(0), 2, 'a zero width — the first render, before onLayout — still carries both ends');
eq(maxTicksForWidth(-50), 2, 'a nonsense width does not produce a nonsense axis');
eq(maxTicksForWidth(Number.NaN), 2, 'an unmeasured width does not produce a nonsense axis');
eq(maxTicksForWidth(10000), 6, 'a very wide axis stops at six — past that the labels are a texture');

/* ── the two rules, together ──────────────────────────────────────────────── */

// The end-to-end shape of the fixed owner chart: six month slots, the first two
// never recorded, labelled from the same indices the points are drawn at. Slot
// 2 holds the first reading and slot 2's label is the month that reading is
// from. That correspondence is the entire fix.
{
  const labels = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];
  const ticks = tickIndices(labels.length, maxTicksForWidth(320));
  const drawn = readablePoints(sparse);
  eq(drawn[0].i, 2, 'the first reading is at slot 2');
  eq(axisLabel(labels[drawn[0].i]), fmtAxisMonth(2026, 4), 'and slot 2 is labelled May — its own month');
  ok(ticks.every((i) => i >= 0 && i < labels.length), 'every tick indexes a real label');
  eqJson(ticks.map((i) => axisLabel(labels[i])).filter((s) => s === DASH), [],
    'no tick on a fully dated series renders as a dash');
}

// And the same window with one label corrupted: that one slot dashes, and the
// others are unaffected. A single bad row does not cost the axis its dates, and
// does not gain the reader a made-up one.
{
  const labels = ['2026-03', 'oops-99', '2026-05'];
  eqJson(labels.map(axisLabel), [fmtAxisMonth(2026, 2), 'oops-99', fmtAxisMonth(2026, 4)],
    'a non-ISO label passes through while its neighbours format normally');
  eq(axisLabel('2026-99'), DASH, 'an ISO-shaped label that cannot be read dashes on its own');
}

if (errors.length) {
  console.error(`chartAxis: ${errors.length} failure(s)\n`);
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
console.log('chartAxis ok — a chart states the date of every point it plots, or a dash');
