// The composition table both apps draw. Compile with tsc, run with node.
//
// `metricTrends` and `compositionInsights` have been shipping to members for a
// long time and were never asserted anywhere. They are now the source of the
// coach's Body Composition table too (app/(trainer)/client-body.tsx), which is
// the whole reason this file exists: two screens reading one module is only an
// improvement while the module is right, and the two things a coach's screen
// asks of it that a member's never did are exactly the two that can be quietly
// wrong.
//
// The first is arrangement. `trendsByGroup` is the four headings, in order,
// with the empty ones dropped — the layout, held once, so that a heading
// cannot come out ordered one way for the member and another for their coach.
//
// The second is counting, and it is the one worth having. `scansWithMetrics`
// is not the number of scans: `scans.metrics` is nullable and a gym scale
// writes a weight and a body fat and no breakdown at all, so a client with six
// scans can have one breakdown, or none. At one, every metric has a reading and
// none of them has a change — and "no change" and "nothing to compare against"
// are opposite facts that both want to print as a dash.
import {
  metricTrends, compositionInsights, trendsByGroup, scansWithMetrics,
  METRIC_GROUPS, METRIC_DEFS,
  type ScanLike, type ScanMetrics,
} from './inbodyMetrics';

const errors: string[] = [];
let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(a === b, `${msg} (got ${String(a)}, wanted ${String(b)})`);

const scan = (takenAt: string, metrics?: ScanMetrics): ScanLike => ({ takenAt, metrics });

// ── the arrangement ────────────────────────────────────────────────────────

const two: ScanLike[] = [
  scan('2026-06-01', { visceralFat: 9, fatMassKg: 20.4, leanArmLKg: 3.2, leanArmRKg: 3.3, bodyWaterL: 40 }),
  scan('2026-08-01', { visceralFat: 8, fatMassKg: 19.1, leanArmLKg: 3.3, leanArmRKg: 3.4, bodyWaterL: 41 }),
];

const grouped = trendsByGroup(two);
eq(grouped.length, 4, 'four headings have something under them');
eq(grouped[0].group, METRIC_GROUPS[0], 'and they come out in the order the table lists them');
eq(grouped[3].group, METRIC_GROUPS[3], 'right through to the last one');
ok(grouped.every((g) => g.items.every((it) => it.def.group === g.group)),
  'every metric sits under its own heading');
eq(grouped.reduce((n, g) => n + g.items.length, 0), metricTrends(two).length,
  'and grouping neither drops a metric nor invents one');

// A heading with nothing measured under it is not drawn empty. These two scans
// carry no InBody score and no BMR but do carry visceral fat, so 'Health &
// metabolism' survives with one row; nothing at all under 'Segmental lean'
// would remove that heading entirely.
const armsOnly = trendsByGroup([
  scan('2026-06-01', { leanArmLKg: 3.2, leanArmRKg: 3.3 }),
  scan('2026-08-01', { leanArmLKg: 3.3, leanArmRKg: 3.4 }),
]);
eq(armsOnly.length, 1, 'a heading with nothing under it is dropped, not drawn empty');
eq(armsOnly[0].group, 'Segmental lean', 'and the one that survives is the measured one');
eq(armsOnly[0].items.length, 2, 'carrying only the metrics that were actually measured');

eq(trendsByGroup([]).length, 0, 'no scans is no table');
eq(trendsByGroup([scan('2026-06-01')]).length, 0, 'and a scan with no breakdown is no table either');

// ── counting breakdowns, which is not counting scans ───────────────────────

eq(scansWithMetrics([]), 0, 'nothing read is no breakdowns');
eq(scansWithMetrics([scan('2026-06-01'), scan('2026-07-01')]), 0,
  'scans with no metrics blob carry no breakdown');
// THE ONE THAT MATTERS: a gym scale writes weight and body fat and nothing
// else, so most of a client's scans contribute nothing to this table. A
// heading that counted rows would send a coach looking for a trend across six
// scans when one sheet has ever been read.
eq(scansWithMetrics([scan('2026-06-01'), scan('2026-07-01', { visceralFat: 9 }), scan('2026-08-01')]), 1,
  'one sheet among three scans is one breakdown, not three');
eq(scansWithMetrics(two), 2, 'and two sheets are two');
// An empty object is a blob that was written and said nothing. It is not a
// breakdown, and counting it would put "one breakdown" over an empty table.
eq(scansWithMetrics([scan('2026-06-01', {})]), 0, 'an empty metrics blob is not a breakdown');
// A field this build has no metric for is not a breakdown either — the column
// is jsonb and a newer build writing a fifteenth field can reach this function.
eq(scansWithMetrics([scan('2026-06-01', { unknownField: 4 } as unknown as ScanMetrics)]), 0,
  'a blob carrying only fields this build cannot name is not a breakdown');

// ── one reading is not a change of zero ────────────────────────────────────

const single = metricTrends([scan('2026-08-01', { visceralFat: 8, fatMassKg: 19.1 })]);
eq(single.length, 2, 'a single sheet still produces a reading for every metric on it');
ok(single.every((tr) => tr.delta === null), 'and NOT a delta of zero for any of them');
ok(single.every((tr) => tr.good === null), 'so nothing is marked improving or worth watching');
ok(single.every((tr) => tr.series.length === 1), 'each series is the one reading it is');
eq(scansWithMetrics([scan('2026-08-01', { visceralFat: 8 })]), 1,
  'and the count says one, which is what lets a screen say so in words');

// A movement of nothing is a different answer again: two readings, same value.
const flat = metricTrends([
  scan('2026-06-01', { visceralFat: 8 }),
  scan('2026-08-01', { visceralFat: 8 }),
]);
eq(flat[0].delta, 0, 'two equal readings are a change of zero');
eq(flat[0].good, null, 'which is neither improving nor worth watching');
ok(flat[0].delta !== null, 'and it is emphatically not the same value as no comparison at all');

// ── a metric the sheet did not carry is absent, never zero ─────────────────

const partial = metricTrends([
  scan('2026-06-01', { fatMassKg: 20.4 }),
  scan('2026-08-01', { fatMassKg: 19.1, leanMassKg: 60.2 }),
]);
const fat = partial.find((tr) => tr.def.key === 'fatMassKg');
const lean = partial.find((tr) => tr.def.key === 'leanMassKg');
ok(fat != null && fat.series.length === 2, 'the metric on both sheets has both readings');
ok(lean != null && lean.series.length === 1, 'the metric on one sheet has one');
ok(lean != null && lean.delta === null, 'and no change — the earlier sheet did not measure it');
ok(partial.every((tr) => tr.def.key === 'fatMassKg' || tr.def.key === 'leanMassKg'),
  'nothing the sheets did not carry appears at all');

// Each metric is compared against the previous scan THAT HAD IT, not against
// the previous scan. A body water reading in June and again in August is a
// two-month change even if July's sheet skipped it.
const skipped = metricTrends([
  scan('2026-06-01', { bodyWaterL: 40 }),
  scan('2026-07-01', { visceralFat: 8 }),
  scan('2026-08-01', { bodyWaterL: 41 }),
]);
const water = skipped.find((tr) => tr.def.key === 'bodyWaterL');
ok(water != null && water.delta === 1, 'a metric skips the sheets that skipped it');

// ── the improving / watch / balance reading ────────────────────────────────

const read = compositionInsights(two);
ok(read.improving.some((l) => l.startsWith('Visceral Fat')),
  'visceral fat falling is improving — the metric is read down');
ok(read.improving.some((l) => l.startsWith('Fat Mass')), 'and so is fat mass falling');
ok(read.watch.length === 0, 'with nothing to watch when every metric moved the way it is read');
// Through deltaLabel, so a drop wears U+2212 MINUS and not an ASCII hyphen —
// the same character every other movement in the app is printed with.
ok(read.improving.every((l) => !l.includes('-')), 'a fall is signed with a real minus, not a hyphen');

const wrongWay = compositionInsights([
  scan('2026-06-01', { visceralFat: 8, inbodyScore: 78 }),
  scan('2026-08-01', { visceralFat: 11, inbodyScore: 74 }),
]);
eq(wrongWay.watch.length, 2, 'both metrics moving against their reading are both worth watching');
eq(wrongWay.improving.length, 0, 'and none of them is improving');

// Balance compares two limbs on ONE day, so it is the single reading a single
// sheet can support. The coach's screen leans on that: a client with one
// breakdown has no change to show and can still have an arm 10% behind.
const oneSheetBalance = compositionInsights([
  scan('2026-08-01', { leanArmLKg: 2.7, leanArmRKg: 3.3, leanLegLKg: 9.1, leanLegRKg: 9.2 }),
]);
eq(oneSheetBalance.improving.length, 0, 'one sheet reports nothing improving');
eq(oneSheetBalance.watch.length, 0, 'and nothing to watch');
eq(oneSheetBalance.balance.length, 1, 'but a left-right gap on that one day is still readable');
ok(oneSheetBalance.balance[0].startsWith('Arms:'), 'and it names the pair it is about');
ok(oneSheetBalance.balance[0].includes('left'), 'and which side is behind');

// A limb reading of zero is not a limb 100% behind — it is a bad row, and the
// pair is skipped rather than reported as the worst imbalance ever recorded.
const zeroLimb = compositionInsights([scan('2026-08-01', { leanArmLKg: 0, leanArmRKg: 3.3 })]);
eq(zeroLimb.balance.length, 0, 'a zero limb reading is dropped, not reported as 100% behind');

// ── the definitions the two screens share ──────────────────────────────────

eq(METRIC_GROUPS.length, 4, 'four headings');
eq(METRIC_DEFS.length, 13, 'thirteen metrics');
ok(METRIC_DEFS.every((d) => (METRIC_GROUPS as readonly string[]).includes(d.group)),
  'and every metric sits under one of them, so grouping can never lose a row');

if (errors.length) {
  console.error(`inbodyMetrics: ${errors.length} of ${checks} checks failed:`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`inbodyMetrics ok — ${checks} checks`);
