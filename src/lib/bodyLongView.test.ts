// The year, on the body side. Compile with tsc, run with node.
//
// The bug this guards: src/lib/longView.ts gave the TRAINING side a year — the
// months, the arc, the honest sentence about a short history — and the body
// side kept only snapshots. Progress shows the latest scan, Compare shows two
// days the member picked. Nobody could see the shape of their own year.
//
// And the bug an obvious implementation introduces: a month is a STATE here,
// not a sum. Carrying February's weight into an unmeasured March, or averaging
// a month, both report a reading nobody took.
import {
  bodyMonthlyHistory, metricOf, measuredMonths, bodyArc, bodySpan, bodyStage,
  monthsSinceMeasured, bodyHistoryNote,
} from './bodyLongView';
import type { ScanReading } from './photoCompare';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** A scan on a local midday, so no case here sits on a date line by accident. */
const scan = (day: string, weightKg: number, bodyFatPct: number, muscle: number | null = 34): ScanReading =>
  ({ takenAt: `${day}T12:00:00`, weightKg, bodyFatPct, skeletalMuscleKg: muscle });

const NOW = Date.parse('2026-09-13T12:00:00');

/* ── the window opens at the first reading, not a round year ────────────── */

const twoMonths = [scan('2026-08-04', 96, 28), scan('2026-09-02', 94, 27)];
const shortCells = bodyMonthlyHistory(twoMonths, NOW);
eq(shortCells.length, 2, 'two months of readings draw two months, not ten holes and a picture of failure');
eq(shortCells[0].key, '2026-08', 'and the first is the month of the first reading');
eq(bodyMonthlyHistory([], NOW).length, 0, 'nothing measured draws nothing at all');

/* ── a month is its CLOSING reading, and never a mean ───────────────────── */

const busyMonth = bodyMonthlyHistory([
  scan('2026-09-01', 96, 28),
  scan('2026-09-20', 90, 26),
  scan('2026-09-10', 93, 27),
], NOW);
eq(busyMonth.length, 1, 'three scans in one month are one month');
eq(busyMonth[0].weightKg, 90, "the month carries its last reading, which is a day somebody was actually weighed");
eq(busyMonth[0].at, '2026-09-20T12:00:00', 'and names the day it came from');
eq(busyMonth[0].scans, 3, 'while still saying how many readings there were');
ok(busyMonth[0].weightKg !== 93, 'never the mean, which describes no day and shifts every past month whenever somebody weighs in again');

/* ── an unmeasured month is a hole, not a figure ────────────────────────── */

const withGap = bodyMonthlyHistory([
  scan('2026-06-03', 96, 28),
  scan('2026-09-02', 90, 26),
], NOW);
eq(withGap.length, 4, 'the months between two readings are present, June to September');
eq(withGap[1].measured, false, 'July had no scan');
eq(withGap[1].weightKg, null, 'so it carries no weight — never 0, which would say the member weighed nothing');
ok(withGap[1].weightKg !== withGap[0].weightKg,
  'and never June carried forward, which would report a reading nobody took');
eq(withGap[1].scans, null, 'the count of readings that did not happen is null, not zero');

/* ── a scale reports no muscle, and that is not a missing month ─────────── */

const scaleOnly = bodyMonthlyHistory([scan('2026-09-02', 90, 26, null)], NOW);
eq(scaleOnly[0].measured, true, 'a bathroom scale is a measurement');
eq(scaleOnly[0].weightKg, 90, 'it reports a weight');
eq(scaleOnly[0].muscleKg, null, 'and no muscle figure');
eq(measuredMonths(scaleOnly, 'muscleKg').length, 0, 'so a muscle chart has no month here');
eq(measuredMonths(scaleOnly, 'weightKg').length, 1, 'while the weight chart has one');

// A zero or an unreadable figure is not a reading. Both have reached charts in
// this codebase before and been drawn as measurements.
const junk = bodyMonthlyHistory([{ takenAt: '2026-09-02T12:00:00', weightKg: 0, bodyFatPct: Number.NaN, skeletalMuscleKg: -4 }], NOW);
eq(junk[0].weightKg, null, 'a stored zero weight is not a weight');
eq(junk[0].bodyFatPct, null, 'an unreadable body fat is not a percentage');
eq(junk[0].muscleKg, null, 'and a negative muscle figure is not a mass');

/* ── the arc needs two months, and is stated in the stored unit ─────────── */

const year = bodyMonthlyHistory([
  scan('2025-10-05', 101, 31, 33),
  scan('2026-02-07', 96, 29, 34),
  scan('2026-09-02', 90, 25, 36),
], NOW);
const wArc = bodyArc(year, 'weightKg');
ok(wArc != null && wArc.from === 101 && wArc.to === 90, 'the arc runs from the first month with a reading to the last');
eq(wArc?.delta, -11, 'and its change is the difference of those two, in the unit the reading is stored in');
eq(wArc?.months, 12, 'across twelve calendar months, counted inclusively');
ok(wArc != null && wArc.fromAt === '2025-10-05T12:00:00', 'each end names the day its reading was taken');

eq(bodyArc(bodyMonthlyHistory([scan('2026-09-02', 90, 26)], NOW), 'weightKg'), null,
  'one reading is a data point and not an arc — "down 4 kg" off a single scan is a sentence about nothing');
eq(bodyArc(scaleOnly, 'muscleKg'), null, 'and a metric with no readings has no arc either');

// The arc for a metric is built from the months that carry THAT metric, not
// from the months that carry any scan. Otherwise a member who switched from a
// scale to an InBody gets a muscle arc starting at a month with no muscle in it.
const mixed = bodyMonthlyHistory([
  scan('2026-01-05', 100, 30, null),
  scan('2026-05-05', 95, 28, 34),
  scan('2026-09-05', 92, 26, 36),
], NOW);
const mArc = bodyArc(mixed, 'muscleKg');
eq(mArc?.fromKey, '2026-05', 'a muscle arc starts at the first month that actually reported muscle');
eq(mArc?.delta, 2, 'and measures only across months that did');

/* ── metricOf reads one field, so a chart and its numbers cannot differ ── */

eq(metricOf(year[year.length - 1], 'weightKg'), 90, 'weight reads weight');
eq(metricOf(year[year.length - 1], 'bodyFatPct'), 25, 'body fat reads body fat');
eq(metricOf(year[year.length - 1], 'muscleKg'), 36, 'muscle reads muscle');

/* ── the silence at the end is open, not a closed gap ───────────────────── */

eq(monthsSinceMeasured(year), 0, 'a reading this month is no months ago');
eq(monthsSinceMeasured(bodyMonthlyHistory([scan('2026-06-02', 90, 26)], NOW)), 3,
  'and June to September is three, counted from the end of the window rather than given an ending of its own');
eq(monthsSinceMeasured([]), null, 'nothing measured is not "0 months since" — it is nothing to be since');

/* ── a short history is not a failed long one ───────────────────────────── */

eq(bodySpan([], NOW), null, 'no scans is no span');
eq(bodySpan([scan('2026-09-10', 90, 26)], NOW)?.days, 4, 'a span counts calendar days inclusively, from the first reading to today');
eq(bodyStage([], NOW), 'empty', 'nothing measured is empty');
eq(bodyStage([scan('2026-09-10', 90, 26)], NOW), 'starting', 'three days in is the start of a history');
eq(bodyStage([scan('2025-09-10', 101, 31), scan('2026-09-10', 90, 26)], NOW), 'long', 'a year of it is long');

ok(bodyHistoryNote([], NOW).includes('starts with'), 'somebody with no readings is told where their history begins');
ok(bodyHistoryNote([scan('2026-09-10', 90, 26)], NOW).startsWith('Day 4'),
  'and somebody four days in is told the day they are on, not shown a year-shaped frame');
const longNote = bodyHistoryNote([scan('2025-10-05', 101, 31), scan('2026-09-02', 90, 25)], NOW);
ok(longNote.includes('2 months with a reading'), 'a longer history counts the months that carry one');
ok(!/0 month/.test(longNote), 'and never reports a count of nothing as though it were a measurement');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('bodyLongView: ok — the body has a year, and an unmeasured month is a hole');
