// The trend chart may not invent a month.
// Compile with tsc, run with node.
//
// The bug this suite exists for shipped: a fresh install drew a flat six-month
// line labelled Mar–Aug and a gym owner read five months of trading that never
// happened. The code carried the current figure backwards across every month it
// had no snapshot for, and a flat line is exactly what a steady business looks
// like, so nothing on screen contradicted it.
//
// Moving the history off the handset and onto `metric_history` (part 129) gave
// that failure two new ways back in, and both are asserted here:
//
//   · a month the SERVER has no row for must stay a gap;
//   · merging the device cache with the server must not fill a gap with a
//     neighbouring month's figure, and must not drop the months recorded before
//     the server existed.
//
// Every assertion below has been checked to fail against the bug it names —
// `npm run mutate --file src/lib/monthlyHistory.ts` puts each one back
// mechanically. The `?? current` mutations of `seriesFor` are killed by the
// block marked NULL-MONTHS.
//
// No month label is asserted against a hardcoded "today". `npm test` runs three
// times under three timezones (`test:zones`) and `monthKey` is deliberately a
// LOCAL boundary, so expectations are built with the same helper the code uses.
import {
  monthKey, isMonthKey, monthWindow, seriesFor, recordedCount, historyDelta,
  sanitiseSnapshots, mergeSnapshots, missingOnServer, MONTH_LABELS,
  type Snapshots,
} from './monthlyHistory';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const eqJson = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/** Two snapshot maps compared by CONTENT. Insertion order is not part of what a
 *  snapshot map means — a merge that spreads the server second produces the
 *  same months in a different order — and asserting on it would be a test that
 *  fails for a reason no reader of the chart could ever see. */
const eqMap = (a: Record<string, number>, b: Record<string, number>, msg: string) => {
  const norm = (m: Record<string, number>) => Object.keys(m).sort().map((k) => `${k}=${m[k]}`).join(',');
  ok(norm(a) === norm(b), `${msg} — got ${norm(a)}, wanted ${norm(b)}`);
};

/* ── month keys are local, and they are the shape the database accepts ────── */

eq(monthKey(new Date(2026, 0, 1)), '2026-01', 'January is zero-padded');
eq(monthKey(new Date(2026, 11, 31)), '2026-12', 'December is 12, not 11');
eq(monthKey(new Date(2026, 7, 31, 23, 59)), '2026-08', 'the last minute of a local month is still that month');
// The same expression as the `metric_history_month_is_ym` check constraint. A
// key this accepts and the database rejects is a write that fails on a device
// with no way to report it.
ok(isMonthKey('2026-08'), 'a well-formed key is accepted');
ok(!isMonthKey('2026-13'), 'there is no thirteenth month');
ok(!isMonthKey('2026-00'), 'there is no zeroth month');
ok(!isMonthKey('2026-8'), 'an unpadded month is not the storage form');
ok(!isMonthKey('2026-08-01'), 'a date is not a month key');
ok(!isMonthKey(''), 'an empty string is not a month key');
ok(!isMonthKey(null), 'null is not a month key');

/* ── the window ───────────────────────────────────────────────────────────── */

const w = monthWindow(new Date(2026, 7, 15), 6);   // Aug 2026
eq(w.length, 6, 'six columns were asked for and six came back');
eqJson(w.map((m) => m.key), ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'],
  'the window is oldest-first and ends on the month it was given');
eqJson(w.map((m) => m.label), ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'], 'the labels follow the keys');
// The case a hand-rolled `month - i` gets wrong.
eqJson(monthWindow(new Date(2026, 1, 9), 6).map((m) => m.key),
  ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02'],
  'a window that reaches back over New Year rolls the year with it');
eq(monthWindow(new Date(2026, 7, 15), 1)[0].key, '2026-08', 'a window of one is this month');
eq(MONTH_LABELS.length, 12, 'twelve labels, index-aligned with getMonth');

/* ── NULL-MONTHS: the rule the whole file exists for ──────────────────────── */

// A fresh install. One month recorded, five never were. THIS is the shape that
// was drawn as a flat six-month line.
const fresh: Snapshots = { '2026-08': 4000 };
const freshSeries = seriesFor(w, fresh);
eqJson(freshSeries, [null, null, null, null, null, 4000],
  'a month with no snapshot is null — NOT this month carried backwards');
eq(recordedCount(freshSeries), 1, 'one point is real, and the forecast is told so');
// Said separately and bluntly, because "5 nulls" above could pass with a
// `?? 0` in place: 0 is falsy and would still not equal 4000.
ok(freshSeries.slice(0, 5).every((v) => v === null),
  'the unrecorded months are null, not 0 and not the current figure');
ok(!freshSeries.slice(0, 5).some((v) => v === 4000),
  'no unrecorded month holds the current value — this is the flat-line bug itself');

// A gap in the MIDDLE, which no "carry the last value forward" scheme survives
// honestly: May really is unknown, and drawing April's figure there is a claim.
const gappy: Snapshots = { '2026-03': 100, '2026-04': 200, '2026-06': 300, '2026-08': 400 };
eqJson(seriesFor(w, gappy), [100, 200, null, 300, null, 400],
  'a missing month inside the window is a hole, not the month before it');
eq(recordedCount(seriesFor(w, gappy)), 4, 'four real points out of six columns');

eqJson(seriesFor(w, {}), [null, null, null, null, null, null],
  'no history at all is six nulls, and nothing may be drawn from it');
eq(recordedCount(seriesFor(w, {})), 0, 'nothing recorded is nothing recorded');

// A real zero is a real month and survives every falsy-check on the way through.
eqJson(seriesFor(w, { '2026-07': 0, '2026-08': 50 }), [null, null, null, null, 0, 50],
  'a recorded zero is a month that really was zero, and is plotted');
eq(recordedCount(seriesFor(w, { '2026-07': 0 })), 1, 'a recorded zero counts as a real point');

// A key outside the window contributes nothing rather than shifting the series.
eqJson(seriesFor(w, { '2025-08': 999 }), [null, null, null, null, null, null],
  'last year’s August is not this year’s August');

// seriesFor does its OWN finite check rather than trusting the sanitiser, and
// this is why: the hook writes `merged[thisMonth] = currentValue` straight into
// the map it plots, without going back through sanitiseSnapshots. A NaN there
// is typeof 'number' and would reach the chart as an unexplained hole with a
// label under it.
//
// Asserted element by element with Object.is, NOT with JSON. `JSON.stringify`
// renders NaN and Infinity as the literal `null`, so a series of [..., NaN]
// compares byte-identical to a series of [..., null] — the assertion would have
// passed with the guard removed, which is a test that cannot fail. Found by
// `npm run mutate --file src/lib/monthlyHistory.ts`, which is what it is for.
eq(seriesFor(w, { '2026-08': Number.NaN })[5], null,
  'a NaN snapshot is a gap, not a point — it never gets past seriesFor either');
eq(seriesFor(w, { '2026-08': Number.POSITIVE_INFINITY })[5], null, 'nor does an infinite one');
eq(recordedCount(seriesFor(w, { '2026-08': Number.NaN })), 0, 'and it does not count as a real point');

/* ── the delta ────────────────────────────────────────────────────────────── */

eq(historyDelta([null, null, null, null, 300, 400], 400), 100, 'this month against last month');
eq(historyDelta([null, null, null, null, 500, 400], 400), -100, 'a fall is negative');
eq(historyDelta([null, null, null, null, null, 400], 400), 0,
  'no previous month means no comparison — 0 here is "cannot say", not "unchanged"');
eq(historyDelta([null, null, null, null, 300, null], null), 0,
  'no current figure means no comparison either');
eq(historyDelta([null, null, null, null, 0, 400], 400), 400,
  'a previous month of zero is a real baseline and is compared against');

/* ── what comes out of the two stores ─────────────────────────────────────── */

eqMap(sanitiseSnapshots({ '2026-08': 100 }), { '2026-08': 100 }, 'a clean blob passes through');
// PostgREST hands `numeric` back as a string. Left alone it is typeof 'string',
// fails the number check in seriesFor and silently becomes a gap — the server
// history would have looked like it had never been written.
eqMap(sanitiseSnapshots({ '2026-08': '4000.5' }), { '2026-08': 4000.5 },
  'a numeric column arriving as a string is a number, not a gap');
eqMap(sanitiseSnapshots({ '2026-08': Number.NaN }), {},
  'NaN is not a figure — it is typeof number and would plot as an unexplained hole');
eqMap(sanitiseSnapshots({ '2026-08': Number.POSITIVE_INFINITY }), {}, 'nor is Infinity');
eqMap(sanitiseSnapshots({ '2026-08': 'later' }), {}, 'a word is not a figure');
eqMap(sanitiseSnapshots({ '2026-08': null }), {}, 'a null column is no snapshot');
eqMap(sanitiseSnapshots({ 'notAMonth': 5, '2026-08': 6 }), { '2026-08': 6 },
  'a key that is not a month is dropped rather than carried forward on the next write');
eqMap(sanitiseSnapshots(null), {}, 'nothing read is no snapshots');
eqMap(sanitiseSnapshots('{}'), {}, 'an unparsed string is not an object');
eqMap(sanitiseSnapshots([1, 2, 3]), {}, 'an array is not a snapshot map');
// The only way an array reaches here WITH something to offer. Contrived, and
// asserted anyway: without it the Array.isArray guard is a line no test
// watches, and "is this a snapshot map" is the entire question this function
// exists to answer.
eqMap(sanitiseSnapshots(Object.assign([], { '2026-08': 5 })), {},
  'an array is not a snapshot map whatever is hung off it');
eqMap(sanitiseSnapshots({ '2026-08': 0 }), { '2026-08': 0 }, 'zero survives the sanitiser');

/* ── the device cache and the account, combined ───────────────────────────── */

const local: Snapshots = { '2026-05': 500, '2026-06': 600, '2026-08': 800 };
const server: Snapshots = { '2026-06': 666, '2026-07': 700 };

eqMap(mergeSnapshots(local, server), { '2026-05': 500, '2026-06': 666, '2026-07': 700, '2026-08': 800 },
  'the server wins where both hold a month — a correction made on another phone shows here');
// The half that makes this change safe to ship. Every coach already running the
// app has months in AsyncStorage and none on the server; a merge that took only
// the server would ship as an erasure of the history it was written to save.
eq(mergeSnapshots(local, server)['2026-05'], 500,
  'a month only the handset has is KEPT — pre-part-129 history is not erased by this release');
eqMap(mergeSnapshots({}, server), server, 'a wiped device gets the account’s history back');
eqMap(mergeSnapshots(local, {}), local, 'an account with no rows yet leaves the cache alone');

// Merging must not conjure a month neither store has. If it did, the flat line
// would come back by a different door.
eq('2026-04' in mergeSnapshots(local, server), false,
  'a month neither store holds stays absent after the merge');
eqJson(seriesFor(w, mergeSnapshots(local, server)), [null, null, 500, 666, 700, 800],
  'March is still a gap after merging two stores that both lack it');

// The merge does not write back into either argument. Both are read again after
// it on every render.
const localBefore = JSON.stringify(local);
const serverBefore = JSON.stringify(server);
mergeSnapshots(local, server);
eq(JSON.stringify(local), localBefore, 'the cache is not mutated by merging');
eq(JSON.stringify(server), serverBefore, 'the server copy is not mutated by merging');

/* ── the backfill ─────────────────────────────────────────────────────────── */

eqMap(missingOnServer(local, server), { '2026-05': 500, '2026-08': 800 },
  'only the months the server has never heard of are uploaded');
eq('2026-06' in missingOnServer(local, server), false,
  'a month the server already holds is NOT overwritten by a stale handset');
eqMap(missingOnServer({}, server), {}, 'nothing cached is nothing to upload');
eqMap(missingOnServer(local, {}), local, 'an empty account takes the whole cache');
eqMap(missingOnServer({ '2026-05': 0 }, {}), { '2026-05': 0 },
  'a cached zero is uploaded — it is a month that really was zero');

if (errors.length) {
  console.error(`monthlyHistory.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('monthlyHistory.test.ts — all assertions passed.');
