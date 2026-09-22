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
  sanitiseSnapshots, mergeSnapshots, missingOnServer, MONTH_LABELS, moneyHistoryKey,
  deviceHistoryKey, isDeviceHistoryKey, historyPass, beginHistoryPass, applyHistoryPass,
  NO_HISTORY_SESSION, type HistorySession, type Snapshots,
} from './monthlyHistory';
import type { LoadStatus } from '../ui/loadStatus';

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

/* ── a money history is keyed by its currency ─────────────────────────────── */

// The failure: one key for a gym that changes currency draws pounds and euros
// as one line and computes a delta across the change.
{
  const gbp = moneyHistoryKey('repple.owner.mrrHistory', 'GBP');
  const eur = moneyHistoryKey('repple.owner.mrrHistory', 'EUR');
  if (gbp === eur) errors.push('two currencies must not share a money history key');
  if (gbp !== 'repple.owner.mrrHistory.GBP') errors.push(`GBP key is ${gbp}`);
  // NOT the bare base key, which is what the owner console wrote when it was a
  // SaaS product and holds dollars of a different thing entirely.
  if (gbp === 'repple.owner.mrrHistory') errors.push('the scoped key must differ from the legacy unscoped one');
}

// Case and padding are spellings of one currency, not two histories.
if (moneyHistoryKey('k', 'gbp') !== moneyHistoryKey('k', ' GBP ')) errors.push('a currency must normalise to one key');
if (moneyHistoryKey('k', 'gbp') !== 'k.GBP') errors.push('a lowercase code is upper-cased');

// No currency, no key: a number whose unit is unknown must not be written down,
// because nothing later can recover what it meant.
for (const bad of [null, undefined, '', '  ', 'GB', 'GBPP', '£', 'G8P']) {
  if (moneyHistoryKey('k', bad as string | null) !== null) errors.push(`currency ${JSON.stringify(bad)} must produce no key`);
}
if (moneyHistoryKey('', 'GBP') !== null) errors.push('no base, no key');


// ---------------------------------------------------------------------------
// WHOSE MONTHS THESE ARE - the shared handset
// ---------------------------------------------------------------------------
//
// The device key and the server's `metric_key` were ONE STRING, and that string
// carried no account. On a gym's front-desk handset that made coach A's revenue
// months into coach B's: B signs in, the provider reads the bare key and finds
// A's months, `missingOnServer` calls every one of them "months the server has
// never heard of" because B's row has not, and `saveMetricHistory` resolves the
// uid fresh at save time and upserts them under B's `user_id`. Permanently.
// Nothing later can tell those rows from B's own.
//
// This block is not a set of unit assertions about a key format. It drives ONE
// long-lived session object through sign-in, sign-out and sign-in-as-somebody-
// else against a fake handset and a fake server, calling the same four
// functions the provider calls in the same order, because that sequence is the
// only shape in which the defect appears at all. Each of the three mutations
// named below has been run against it on a scratch copy and watched to fail:
//
//   M1  deviceHistoryKey ignores the uid and returns the metric key
//   M2  beginHistoryPass carries `hydrated` (and `hist`) across a key change
//   M3  deviceHistoryKey accepts a null / 'unknown' uid as an account

// -- the two strings, before any of the above --------------------------------
{
  const MK = 'repple.owner.mrrHistory.GBP';
  const a = deviceHistoryKey(MK, 'coach-a');
  const b = deviceHistoryKey(MK, 'coach-b');
  ok(a !== b, 'two accounts must not share a device history key');
  ok(a !== MK, 'the device key must not BE the metric key - that is the defect');
  eq(a, 'repple.owner.mrrHistory.GBP:coach-a', 'the account goes on the end of the metric key');
  ok(isDeviceHistoryKey(a as string), 'a device key carries an account');
  ok(!isDeviceHistoryKey(MK), 'a metric key carries none, and must not');
  // The metric key is what the SERVER is sent, and it must stay free of the
  // account or one coach's history splits across every handset they own.
  ok(!(moneyHistoryKey('repple.owner.mrrHistory', 'GBP') as string).includes('coach-a'),
    'the metric key must never carry an account');
  eq(deviceHistoryKey(MK, ' coach-a '), a, 'a padded id is the same account');

  // M3. Not an account, so not a key, so nothing is read and nothing is kept.
  for (const bad of [null, undefined, '', '   ', 'unknown']) {
    eq(deviceHistoryKey(MK, bad as string | null), null,
      `uid ${JSON.stringify(bad)} is not an account and must produce no key`);
  }
  // A separator inside the id would let two different (metric, account) pairs
  // spell one key.
  eq(deviceHistoryKey(MK, 'a:b'), null, 'an id containing the separator is refused');
  eq(deviceHistoryKey('', 'coach-a'), null, 'no metric key, no device key');
}

// -- the handset, the server, and the provider as a function -----------------

/** One phone's AsyncStorage, plus the keys whose reads are failing. */
interface Handset { shelf: Record<string, string>; unreadable: Set<string> }

/** `metric_history`, which is keyed by (user_id, metric_key, month) - the
 *  `user_id` being the thing the device key was missing. */
type Server = Map<string, number>;
const rowKey = (uid: string, mk: string, month: string) => `${uid} ${mk} ${month}`;
function serverRows(srv: Server, uid: string, mk: string): Snapshots {
  const out: Snapshots = {};
  for (const [k, v] of srv) {
    const [u, key, month] = k.split(' ');
    if (u === uid && key === mk) out[month] = v;
  }
  return out;
}

/** Every string this pass handed to the server as a `metric_key`. */
const metricKeysSent: string[] = [];
/** Every string this pass handed to the device store. */
const deviceKeysTouched: string[] = [];

/**
 * One pass of `useMonthlyHistory`, with the storage and the network faked and
 * everything else being the real functions in the real order.
 *
 * `serverStatus` is what `fetchMetricHistory` came back with: 'error' is a gym
 * with no signal, which is the case that fills the shelf with months the server
 * has never heard of - the fuel the defect ran on.
 */
function runPass(
  h: Handset, srv: Server, prev: HistorySession,
  opts: {
    metricKey: string; uid: string | null; value: number | null; month: string;
    serverStatus?: LoadStatus;
  },
): HistorySession {
  const deviceKey = deviceHistoryKey(opts.metricKey, opts.uid);
  // The effect keyed on the device key. Everything belonging to the previous
  // key goes here, before a byte is read.
  const s = beginHistoryPass(prev, deviceKey);
  // No account is no store: nothing read, nothing kept, nothing published.
  if (!deviceKey) return s;

  // The shelf - or the months already in hand, when a read of THIS key armed
  // the flag. Null is a FAILED read and is not `{}`.
  let cached: Snapshots | null;
  if (s.key === deviceKey && s.hydrated) {
    cached = s.hist;
  } else {
    deviceKeysTouched.push(deviceKey);
    cached = h.unreadable.has(deviceKey)
      ? null
      : (h.shelf[deviceKey] ? sanitiseSnapshots(JSON.parse(h.shelf[deviceKey])) : {});
  }

  let read: { snapshots: Snapshots; status: LoadStatus };
  if (s.key === deviceKey && s.server) {
    read = { snapshots: s.server, status: 'ready' };
  } else {
    metricKeysSent.push(opts.metricKey);
    read = (opts.serverStatus ?? 'ready') === 'ready'
      ? { snapshots: serverRows(srv, opts.uid as string, opts.metricKey), status: 'ready' as LoadStatus }
      : { snapshots: {}, status: opts.serverStatus as LoadStatus };
  }

  const pass = historyPass({ cached, server: read, currentValue: opts.value, thisMonth: opts.month });

  if (pass.writeCache) { deviceKeysTouched.push(deviceKey); h.shelf[deviceKey] = JSON.stringify(pass.merged); }

  let server: Snapshots | null = read.status === 'ready' ? read.snapshots : null;
  let sent = s.sent;
  const months = Object.keys(pass.upload).sort().join(',');
  const stamp = `${deviceKey}|${opts.value}|${months}`;
  if (months && stamp !== sent) {
    metricKeysSent.push(opts.metricKey);
    // The fifth step of the defect: the uid is resolved FRESH, here, at save
    // time - so whatever `upload` holds is filed under whoever is signed in NOW.
    for (const [m, v] of Object.entries(pass.upload)) srv.set(rowKey(opts.uid as string, opts.metricKey, m), v);
    sent = stamp;
    if (server) server = { ...server, ...pass.upload };
  }
  return applyHistoryPass(s, deviceKey, pass, server, read.status, sent);
}

// -- one session, three sign-ins ---------------------------------------------
{
  const MK = 'repple.owner.mrrHistory.GBP';
  const A = 'coach-a-11111111';
  const B = 'coach-b-22222222';
  // Built with the same helper the code uses - `npm test` runs under three
  // timezones and `monthKey` is a LOCAL boundary.
  const now = new Date();
  const M1 = monthKey(new Date(now.getFullYear(), now.getMonth() - 2, 15));
  const M2 = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 15));
  const M3 = monthKey(new Date(now.getFullYear(), now.getMonth(), 15));

  const handset: Handset = { shelf: {}, unreadable: new Set() };
  const server: Server = new Map();
  // ONE object, carried across every sign-in below, because that is what a
  // provider mounted at the root is: nothing unmounts it when a session ends.
  let session = NO_HISTORY_SESSION;

  // 1. The app launches with nobody signed in.
  session = runPass(handset, server, session, { metricKey: MK, uid: null, value: 4100, month: M3 });
  eqJson(handset.shelf, {}, 'nothing is written to a handset nobody is signed in to');
  eq(server.size, 0, 'nothing is published for nobody');
  eqJson(session.hist, {}, 'and nothing is on screen');

  // 2. Coach A signs in at a gym with no signal, and records two months. The
  //    server read fails, so these months exist ONLY on the handset - which is
  //    exactly the backfill case the defect turned into a theft.
  session = runPass(handset, server, session, { metricKey: MK, uid: A, value: 1000, month: M1, serverStatus: 'error' });
  session = runPass(handset, server, session, { metricKey: MK, uid: A, value: 2000, month: M2, serverStatus: 'error' });
  eqJson(session.hist, { [M1]: 1000, [M2]: 2000 }, "A's two months are on screen");
  eq(session.status, 'error', 'and are reported as unconfirmed, not as the whole history');
  eq(server.size, 0, 'a failed server read publishes NOTHING');
  ok(handset.shelf[`${MK}:${A}`] != null, "A's months are on the shelf under A's key");
  eq(handset.shelf[MK], undefined, 'and never under the bare metric key');

  // 3. A signs out. Nothing unmounts the provider; the uid simply goes null.
  session = runPass(handset, server, session, { metricKey: MK, uid: null, value: null, month: M3 });
  eqJson(session.hist, {}, "A's months leave the screen the moment A does");
  eq(session.hydrated, false, 'and the write is disarmed with them');
  eq(session.server, null, "A's server view is not carried into the next session");
  eq(session.sent, '', "nor is A's confirmed upload");
  ok(handset.shelf[`${MK}:${A}`] != null, "but A's months are KEPT - signing out is not an erasure");

  // 4. Coach B signs in on the same handset, with signal. B has no history.
  const beforeB = handset.shelf[`${MK}:${A}`];
  session = runPass(handset, server, session, { metricKey: MK, uid: B, value: 5000, month: M3 });

  // THE ASSERTION THIS WHOLE BLOCK IS FOR.
  eqJson(serverRows(server, B, MK), { [M3]: 5000 },
    "B's row holds B's own month and NOTHING of A's");
  ok(!Object.values(serverRows(server, B, MK)).includes(1000),
    "A's first figure must never be filed under B");
  ok(!Object.values(serverRows(server, B, MK)).includes(2000),
    "A's second figure must never be filed under B");
  eqJson(session.hist, { [M3]: 5000 }, "B's chart draws B's month and no month of A's");
  eq(recordedCount(seriesFor(monthWindow(now, 6), session.hist)), 1,
    "B has one real month, not three - tracking started, not somebody else's year");
  eq(handset.shelf[`${MK}:${A}`], beforeB, "and A's shelf is untouched by B's session");

  // 5. B's second pass, same month, same figure. Nothing is re-published.
  const rowsAfterB = server.size;
  session = runPass(handset, server, session, { metricKey: MK, uid: B, value: 5000, month: M3 });
  eq(server.size, rowsAfterB, 'an unchanged figure does not re-upsert the row');

  // 6. A signs back in. Their months are where they left them, and NOW they
  //    backfill - to A's own row, which is what the backfill was always for.
  session = runPass(handset, server, session, { metricKey: MK, uid: A, value: 3000, month: M3 });
  eqJson(session.hist, { [M1]: 1000, [M2]: 2000, [M3]: 3000 }, "A gets A's history back");
  eqJson(serverRows(server, A, MK), { [M1]: 1000, [M2]: 2000, [M3]: 3000 },
    "and it reaches A's account, not anybody else's");
  eqJson(serverRows(server, B, MK), { [M3]: 5000 }, "B's row is unchanged by A signing in");

  // The two strings never swapped jobs anywhere in the sequence above.
  ok(metricKeysSent.every((k) => k === MK),
    `the server is only ever sent the bare metric key - got ${JSON.stringify([...new Set(metricKeysSent)])}`);
  ok(deviceKeysTouched.every((k) => k !== MK),
    `the device store is never touched at the bare metric key - got ${JSON.stringify([...new Set(deviceKeysTouched)])}`);
  ok(deviceKeysTouched.every((k) => isDeviceHistoryKey(k)), 'every device key carries an account');
}

// -- an account switch whose own read fails ----------------------------------
//
// The other half of M2, and the expensive half: this is the way to LOSE months
// rather than merely show the wrong ones. B's shelf cannot be read. Nothing of
// B's may be written over, and nothing of A's may be published as B's.
{
  const MK = 'repple.owner.sessionsHistory';
  const A = 'coach-a-11111111';
  const B = 'coach-b-22222222';
  const now = new Date();
  const M1 = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 15));
  const M2 = monthKey(new Date(now.getFullYear(), now.getMonth(), 15));

  const handset: Handset = { shelf: {}, unreadable: new Set([`${MK}:${B}`]) };
  const server: Server = new Map();
  let session = NO_HISTORY_SESSION;

  session = runPass(handset, server, session, { metricKey: MK, uid: A, value: 11, month: M1, serverStatus: 'error' });
  ok(session.hydrated, "A's shelf was read, so A's session is armed");
  // B's real months, put on the shelf by some earlier launch and now unreadable.
  handset.shelf[`${MK}:${B}`] = JSON.stringify({ [M1]: 99 });

  session = runPass(handset, server, session, { metricKey: MK, uid: B, value: 22, month: M2 });
  eq(session.hydrated, false, 'a shelf that could not be read leaves the write disarmed');
  eqJson(JSON.parse(handset.shelf[`${MK}:${B}`]), { [M1]: 99 },
    "B's stored months survive a read that failed - nothing is written over bytes we never saw");
  eqJson(serverRows(server, B, MK), { [M2]: 22 },
    "only the figure the caller handed us is published, never A's month off A's shelf");
  eqJson(session.hist, { [M2]: 22 }, "and A's month is not on B's screen");
}

// -- the reset, stated on its own --------------------------------------------
{
  const MK = 'repple.owner.sessionsHistory';
  const A = deviceHistoryKey(MK, 'coach-a') as string;
  const B = deviceHistoryKey(MK, 'coach-b') as string;
  const held: HistorySession = {
    key: A, hist: { '2026-03': 41 }, hydrated: true, status: 'ready',
    server: { '2026-03': 41 }, sent: 'something',
  };
  const fresh = beginHistoryPass(held, B);
  eq(fresh.key, B, 'the session belongs to the new key');
  eq(fresh.hydrated, false, 'the arming flag does NOT survive the account changing');
  eqJson(fresh.hist, {}, "nor do the previous account's months");
  eq(fresh.server, null, 'nor their server view');
  eq(fresh.sent, '', 'nor their confirmed upload');
  eq(fresh.status, 'loading', 'and nothing is claimed about the new account yet');
  // Same key, same object: a pass triggered by a new figure must not blank the
  // chart it is only refreshing.
  ok(beginHistoryPass(held, A) === held, 'an unchanged key changes nothing');
  // Signing out is a key change like any other.
  eq(beginHistoryPass(held, null).hydrated, false, 'signing out disarms the write');
  eqJson(beginHistoryPass(held, null).hist, {}, 'and clears the screen');
}

// -- a read that failed is not an empty shelf --------------------------------
{
  const failed = historyPass({
    cached: null,
    server: { snapshots: { '2026-03': 7 }, status: 'ready' },
    currentValue: 9, thisMonth: '2026-04',
  });
  eq(failed.writeCache, false, 'an unreadable shelf is NOT written over');
  eqJson(failed.upload, { '2026-04': 9 },
    'and nothing is backfilled off it - only the figure the caller handed us');

  const empty = historyPass({
    cached: {},
    server: { snapshots: { '2026-03': 7 }, status: 'ready' },
    currentValue: 9, thisMonth: '2026-04',
  });
  eq(empty.writeCache, true, 'a shelf that is genuinely empty IS written');
  eqJson(empty.merged, { '2026-03': 7, '2026-04': 9 }, 'and holds the account plus this month');
}

// -- a failed SERVER read publishes nothing, and merges nothing --------------
{
  const p = historyPass({
    cached: { '2026-01': 1 },
    server: { snapshots: {}, status: 'error' },
    currentValue: 2, thisMonth: '2026-02',
  });
  eqJson(p.upload, {}, 'an unread account is not an empty account, and is not written to');
  eqJson(p.merged, { '2026-01': 1, '2026-02': 2 }, 'the shelf stands alone under error');
  eq(p.writeCache, true, 'and is still kept - it is the store that works with no signal');
  // 'partial' and 'loading' are not 'ready' either. Only 'ready' is.
  for (const st of ['partial', 'loading', 'error'] as LoadStatus[]) {
    const q = historyPass({
      cached: { '2026-01': 1 }, server: { snapshots: { '2026-01': 99 }, status: st },
      currentValue: null, thisMonth: '2026-02',
    });
    eqJson(q.upload, {}, `status ${st} must publish nothing`);
    eqJson(q.merged, { '2026-01': 1 }, `status ${st} must not merge a server view it does not trust`);
  }
}

// -- null is not zero, here as everywhere ------------------------------------
{
  const p = historyPass({
    cached: { '2026-01': 1 }, server: { snapshots: {}, status: 'ready' },
    currentValue: null, thisMonth: '2026-02',
  });
  ok(!('2026-02' in p.merged), 'a month whose figure is unknown is not recorded as anything');
  eqJson(p.upload, { '2026-01': 1 }, 'the backfill still goes; the unknown month does not');
  // A month key the server's CHECK constraint would refuse is not recorded here
  // either, so a figure cannot be filed where nothing will look for it again.
  const bad = historyPass({
    cached: {}, server: { snapshots: {}, status: 'ready' },
    currentValue: 5, thisMonth: '2026-13',
  });
  eqJson(bad.merged, {}, 'a malformed month is not a month');
  eqJson(bad.upload, {}, 'and is certainly not published');
}

// -- a handset in a drawer does not get to publish over the account ----------
//
// Guard 3. `missingOnServer` is what keeps a stale shelf from overwriting a
// month the account already holds - a coach who corrected a figure on their
// other phone must not have the correction undone by this one being opened.
{
  const p = historyPass({
    cached: { '2026-01': 111, '2026-02': 222 },
    server: { snapshots: { '2026-01': 999 }, status: 'ready' },
    currentValue: null, thisMonth: '2026-03',
  });
  eqJson(p.upload, { '2026-02': 222 },
    'only the month the server has never heard of is offered');
  ok(!('2026-01' in p.upload),
    "a month the account already holds is left alone even where the shelf disagrees");
  eq(p.merged['2026-01'], 999, 'and the account, not the shelf, is what is drawn');
}

// -- a pass that lands after the account changed is discarded ----------------
{
  const MK = 'repple.trainer.deliveredRevHistory';
  const A = deviceHistoryKey(MK, 'coach-a') as string;
  const B = deviceHistoryKey(MK, 'coach-b') as string;
  const nowB: HistorySession = { ...NO_HISTORY_SESSION, key: B };
  const late = historyPass({
    cached: { '2026-01': 1 }, server: { snapshots: {}, status: 'ready' },
    currentValue: 2, thisMonth: '2026-02',
  });
  const after = applyHistoryPass(nowB, A, late, {}, 'ready', 'stamp');
  ok(after === nowB, "A's read landing late must not paint over B");
  const onTime = applyHistoryPass(nowB, B, late, {}, 'ready', 'stamp');
  eqJson(onTime.hist, { '2026-01': 1, '2026-02': 2 }, "B's own pass is applied");
  eq(onTime.hydrated, true, 'and arms the write, because the shelf was read');
}

if (errors.length) {
  console.error(`monthlyHistory.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('monthlyHistory.test.ts — all assertions passed.');
