// A year of weekly check-ins as four lines. Compile with tsc, run with node.
//
// Two bugs every assertion here is aimed at.
//
//   · A 0 is not a rating. The scale starts at 1, and `rowToCI` in
//     src/ui/checkins.tsx coerces a null column with `Number(x) || 0` — so a
//     week that recorded nothing arrives as the number 0 and, drawn, becomes
//     the worst week of somebody's year. It has to become a hole.
//   · An empty chart under a failed read is a claim about a member's record.
//     'unreadable' is a state, and `trendLine` says which one.
import { checkinTrend, seriesNote, trendLine, type RatingRow } from './checkinTrend';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** Noon local, so the day key is the same in every zone the repo tests under.
 *  These assertions are about which week a point sits over, not about a
 *  midnight boundary. */
const row = (id: string, day: string, e: number, s: number, m: number, a: number): RatingRow =>
  ({ id, at: `${day}T12:00:00`, energy: e, sleep: s, mood: m, adherence: a });

// Newest first, which is the order src/ui/checkins.tsx holds them in.
const rows: RatingRow[] = [
  row('c3', '2026-09-06', 5, 4, 5, 5),
  row('c2', '2026-08-30', 3, 3, 4, 4),
  row('c1', '2026-08-23', 2, 5, 3, 2),
];

/* ── the chart reads left to right, and the labels come with it ─────────── */

const t3 = checkinTrend(rows, 'ready');
eq(t3.state, 'some', 'three check-ins are a trend');
eq(t3.labels, ['2026-08-23', '2026-08-30', '2026-09-06'], 'oldest on the left');
eq(t3.series.map((s) => s.key), ['energy', 'sleep', 'mood', 'adherence'],
  'always all four, always in the order the form asks them in');
eq(t3.series[0].values, [2, 3, 5], 'and the values are reversed with their labels, not apart from them');
eq(t3.series[1].values, [5, 3, 4], 'sleep is its own line');
eq(t3.charted, 3, 'a whole read may be counted');

/* ── a 0 is a hole, not the worst week of the year ──────────────────────── */
//
// The load-bearing assertion of this file.

const holed = checkinTrend([
  row('h3', '2026-09-06', 4, 4, 4, 4),
  row('h2', '2026-08-30', 0, 4, 4, 4),
  row('h1', '2026-08-23', 3, 4, 4, 4),
], 'ready');
eq(holed.series[0].values, [3, null, 4], 'a 0 becomes a break in the line');
ok(!holed.series[0].values.includes(0 as never), 'and above all is never drawn as a score');
eq(holed.series[0].readings, 2, 'the hole is not counted as a reading');
eq(holed.labels.length, 3, 'and the week keeps its slot, so every later point stays over its own date');
eq(holed.series[1].values, [4, 4, 4], 'the other three ratings on that row are untouched');

for (const bad of [0, -1, 6, 99, Number.NaN]) {
  const r = checkinTrend([row('x', '2026-09-06', bad, 3, 3, 3), row('y', '2026-08-30', 3, 3, 3, 3)], 'ready');
  eq(r.series[0].values[1], null, `${bad} is not a point on a 1–5 scale`);
}
eq(checkinTrend([row('a', '2026-09-06', 1, 1, 1, 1), row('b', '2026-08-30', 5, 5, 5, 5)], 'ready').series[0].values,
  [5, 1], 'both ends of the real scale survive');

/* ── a failed read draws nothing and says so ────────────────────────────── */

for (const st of ['error', 'loading'] as const) {
  const r = checkinTrend(rows, st);
  eq(r.state, 'unreadable', `a ${st} read is not a chart`);
  eq(r.labels, [], 'nothing is plotted');
  eq(r.charted, null, 'and nothing is counted');
}
eq(checkinTrend(null, 'ready').state, 'unreadable',
  'a null row list is unreadable whatever the status says — an empty array must never mean two things');

ok(/couldn’t be read/.test(trendLine('ready', checkinTrend(null, 'ready'))),
  'and the line says the read failed');
ok(/not the same as never having sent any/.test(trendLine('ready', checkinTrend(null, 'ready'))),
  'and says explicitly that it is not a claim about the member');

/* ── a truncated read may draw and may not count ────────────────────────── */

const part = checkinTrend(rows, 'partial');
eq(part.state, 'some', 'the weeks that came back are real weeks and are worth charting');
eq(part.series[0].values, [2, 3, 5], 'and they are drawn');
eq(part.charted, null, 'but a prefix of an unknown set cannot say how many there are');
ok(/row limit/.test(trendLine('partial', part)), 'and the line says why the count is missing');

/* ── one is not a trend ─────────────────────────────────────────────────── */

const one = checkinTrend([rows[0]], 'ready');
eq(one.state, 'one', 'a single check-in is real and is not a line');
ok(/second one/.test(trendLine('ready', one)), 'and the line says what would make it one');

const none = checkinTrend([], 'ready');
eq(none.state, 'none', 'a landed read with no rows is genuinely empty');
ok(/first check-in/.test(trendLine('ready', none)), 'and may say so');

eq(new Set([
  trendLine('loading', UNREAD()), trendLine('ready', none), trendLine('ready', one),
  trendLine('partial', part), trendLine('ready', t3), trendLine('ready', UNREAD()),
]).size, 6, 'six situations, six sentences');
function UNREAD() { return checkinTrend(null, 'ready'); }

/* ── what one line says about its own gaps ──────────────────────────────── */

eq(seriesNote(t3.series[0], 3), null, 'a complete line needs no commentary');
ok(/not a run of bad weeks/.test(seriesNote({ ...t3.series[0], values: [null, null], readings: 0 }, 2) ?? ''),
  'a rating nobody ever scored says the record is silent, not that the weeks were bad');
ok(/single point/.test(seriesNote({ ...t3.series[0], values: [null, 4], readings: 1 }, 2) ?? ''),
  'one reading is a dot and says so');
const gap = seriesNote(holed.series[0], 3) ?? '';
ok(/1 week/.test(gap), 'a broken line counts the weeks that are missing');
ok(/not a score of nought/.test(gap),
  'and says what the break is — which is the whole of this module in one sentence');

/* ── a timestamp that will not parse loses its label, never its ratings ─── */

const broken = checkinTrend([
  row('g2', '2026-09-06', 4, 4, 4, 4),
  { id: 'g1', at: 'not a date', energy: 2, sleep: 2, mood: 2, adherence: 2 },
], 'ready');
eq(broken.series[0].values, [2, 4], 'the ratings on an undated row are still real ratings');
eq(broken.labels.length, 2, 'and the row keeps its slot rather than shifting every later point');
eq(broken.labels[0], '', 'with nothing where its date would be — never a neighbour’s date');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('checkinTrend: ok — a 0 is a hole and not the worst week of the year, and a failed read draws no chart at all');
