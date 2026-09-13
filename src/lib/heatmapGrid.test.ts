// The grid a consistency heatmap is drawn on, and what is in each square.
// Compile with tsc, run with node.
//
// The three assertions that matter:
//
//   · the grid is built on the CALENDAR, not on milliseconds — so a run of
//     weeks that crosses a clocks change is still seven days a column;
//   · a square's count is the reader's LOCAL day, so an evening session west of
//     Greenwich lands on the day it was performed rather than on tomorrow;
//   · an unread log is null and never zero. A blank square drawn from a failed
//     read and a blank square drawn from a rest day are the same picture, and
//     they must never be the same claim.
import { heatmapColumns, squareCounts, squareCount, GRID_ROWS } from './heatmapGrid';
import { startOfWeek } from './weekStart';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** Local midnight, which is what a square is. */
const day = (y: number, m: number, d: number) => {
  const x = new Date(y, m, d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const DAY_MS = 86400000;

/* ── the shape of the grid ─────────────────────────────────────────────── */

const TODAY = day(2026, 8, 2);            // Wed 2 Sep 2026
const cols = heatmapColumns(TODAY, 12);

eq(cols.length, 12, 'twelve weeks is twelve columns');
ok(cols.every((c) => c.length === GRID_ROWS), 'and every column is a whole week');
eq(GRID_ROWS, 7, 'a week is seven days');

// Oldest first. A grid that runs the other way puts today at the far left and
// reads as a forecast.
ok(cols[0][0].getTime() < cols[11][0].getTime(), 'the oldest week is the first column');

// The last column is the week today falls in, so today is somewhere inside it.
const last = cols[cols.length - 1];
ok(last.some((d) => d.getTime() === TODAY.getTime()), 'today is in the final column');
eq(last[0].getTime(), startOfWeek(TODAY).getTime(),
  'and that column opens on the same day of the week every other screen opens on');

// Squares run forwards inside a column, one day at a time.
ok(last.every((d, i) => i === 0 || d.getTime() > last[i - 1].getTime()),
  'a column runs forwards');

// Calendar arithmetic, not millisecond arithmetic. Columns are seven CALENDAR
// days apart, which is what keeps a week containing a clocks change seven days
// wide — a `- 7 * 86400000` grid loses or gains an hour and drifts a square.
for (let i = 1; i < cols.length; i++) {
  const gapDays = Math.round((cols[i][0].getTime() - cols[i - 1][0].getTime()) / DAY_MS);
  eq(gapDays, 7, `column ${i} opens seven days after the one before it`);
  eq(cols[i][0].getHours(), 0, `column ${i} opens at local midnight`);
}

// The week of a Sunday and the week of the following Saturday are the same
// column, whichever day the house week opens on: both resolve through
// `startOfWeek`, so this holds without this file knowing the convention.
ok(heatmapColumns(day(2026, 8, 2), 1)[0][0].getTime()
  === heatmapColumns(day(2026, 8, 4), 1)[0][0].getTime()
  || startOfWeek(day(2026, 8, 2)).getTime() !== startOfWeek(day(2026, 8, 4)).getTime(),
  'two days in one week give one column');

/* ── a grid of no weeks is not a grid ──────────────────────────────────── */

eq(heatmapColumns(TODAY, 0).length, 0, 'zero weeks is no columns, not one');
eq(heatmapColumns(TODAY, -3).length, 0, 'and neither is a negative count');
eq(heatmapColumns(TODAY, Number.NaN).length, 0, 'and neither is a figure that is not one');

/* ── the caller's Date is not moved ────────────────────────────────────── */

const held = day(2026, 8, 2);
const heldAt = held.getTime();
heatmapColumns(held, 12);
eq(held.getTime(), heldAt, 'building a grid does not walk the caller’s own clock backwards');

/* ── what is in a square ───────────────────────────────────────────────── */

// Two movements on one evening and one on another. Built from local parts, so
// the assertion is about the reader's day wherever this runs.
const at = (y: number, m: number, d: number, h: number) => new Date(y, m, d, h, 30).toISOString();
const counts = squareCounts([
  { t: at(2026, 7, 14, 19) },
  { t: at(2026, 7, 14, 20) },
  { t: at(2026, 7, 16, 7) },
  // A row whose timestamp cannot be read. Dropped, not filed under today: a
  // broken date is not a session that happened this morning.
  { t: 'not a date' },
]);

eq(squareCount(counts, day(2026, 7, 14), true), 2, 'two exercises on the evening they were logged');
eq(squareCount(counts, day(2026, 7, 16), true), 1, 'and one on the morning');
eq(squareCount(counts, day(2026, 7, 15), true), 0, 'a day with nothing on it is zero under a read that landed');

// The late-evening rows are the point: on a handset west of Greenwich a
// `slice(0, 10)` of their ISO string is the NEXT day, and this must not be.
eq(Object.keys(counts).length, 2, 'a row with an unreadable date makes no square of its own');

/* ── unread is not empty ───────────────────────────────────────────────── */

eq(squareCount(counts, day(2026, 7, 15), false), null,
  'a day with nothing on it is UNKNOWN when the log was not read');
eq(squareCount(counts, day(2026, 7, 14), false), null,
  'and so is a day that does have something on it — an unread log answers nothing');
eq(squareCount({}, day(2026, 7, 14), true), 0,
  'an empty log that WAS read is honestly zero');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('heatmapGrid.test.ts — ok');
