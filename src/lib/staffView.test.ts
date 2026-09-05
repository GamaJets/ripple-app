// The staff screen's money, and the one figure it priced at nothing.
// Compile with tsc, run with node.
//
// THE DEFECT THIS FILE EXISTS FOR
//
// `buildStaff` takes `fallbackRateCents` — the gym's standard `session_fee` —
// and used it twice out of three times. `payrollByTrainer` got it, so the
// "Earned" column was right. `settleableSessions` got it, so sessions carrying
// no snapshotted rate of their own were ADMITTED as settleable. And then
// `settlementAmount(outstandingRows)` was called without it, so every one of
// those admitted rows fell through `settlementAmount`'s own `?? 0` — the one
// its doc calls "genuinely unreachable for anything settleableSessions
// returned", which was true only while both calls carried the same fallback.
//
// What that looked like: a gym with a session fee and no per-trainer rates
// showed a coach's twelve completed, unsettled sessions as **0.00 payable**
// beside **1,800.00 earned**, computed from the same twelve rows, and the
// gym-wide "Payable now" KPI summed those noughts across the whole roster.
//
// The two rules underneath, which the assertions hold:
//
//   1. THE TWO FIGURES COME OFF THE SAME ROWS. Whatever prices a session for
//      "earned" prices it for "payable"; a row admitted by one fallback and
//      valued by another is a screen disagreeing with itself about one hour.
//   2. UNPRICED IS NOT FREE. With no fee set and no rate on the row there is
//      no figure, and the answer is null — never 0, which is a claim that
//      somebody is owed nothing for work they did.
//
// No formatted money and no formatted date is asserted here; `npm test` runs
// under six timezones and this file states every instant as an offset.
import { buildStaff, type StaffRecord, type StaffTrainer } from './staffView';
import { sliceReady } from './memberView';
import { PAY_DELIVERED_ONLY, type PtSession } from './gymSessions';

const errors: string[] = [];
const ok = (c: boolean, m: string) => { if (!c) errors.push(`FAIL ${m}`); };
const eq = (a: unknown, b: unknown, m: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`FAIL ${m}\n  got      ${JSON.stringify(a)}\n  expected ${JSON.stringify(b)}`);
};

const NOW = Date.parse('2026-09-05T12:00:00.000Z');
const DAY_MS = 86_400_000;
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY_MS).toISOString();

const FEE = 15_000;          // the gym's standard session fee, in minor units
const OWN_RATE = 20_000;     // what this gym pays this coach, snapshotted

const sess = (
  id: string, daysAgo: number, rateCents: number | null,
  outcome: PtSession['outcome'] = 'completed', settlementId: string | null = null,
): PtSession => ({
  id, trainerId: 'omar', trainerName: 'Omar', clientId: 'c1', clientName: 'Client',
  startsAt: at(daysAgo), durationMin: 60, status: 'booked',
  outcome, outcomeAt: outcome ? at(daysAgo) : null,
  rateCents, rateCurrency: null, settlementId,
  packDrawnKind: null, packDrawnAt: null, packDrawShortfallAt: null,
});

const trainers: StaffTrainer[] = [{ trainerId: 'omar', name: 'Omar', since: at(300) }];

const recordOf = (sessions: PtSession[]): StaffRecord => ({
  trainers: sliceReady(trainers),
  sessions: sliceReady(sessions),
  shifts: sliceReady([]),
  clients: sliceReady([]),
  activity: sliceReady([]),
  classes: sliceReady([]),
});

const build = (sessions: PtSession[], fallbackRateCents: number | null) =>
  buildStaff(recordOf(sessions), {
    policy: PAY_DELIVERED_ONLY, fallbackRateCents, now: NOW, windowDays: 30,
  });

/* ── 1 · the gym that sets a fee and no per-trainer rates ─────────────────── */

const feeOnly = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => sess(`f${n}`, n, null));
const carried = build(feeOnly, FEE);
const omar = carried.members![0];

eq(omar.outstandingSessions, 12,
  'twelve completed, unsettled sessions are settleable on the gym’s own fee — this half was already right');
eq(omar.outstandingCents, 12 * FEE,
  'and they are WORTH twelve times that fee: the figure that read 0.00 beside a real earned total');
eq(omar.owedCents, omar.outstandingCents,
  'earned and payable come off the same twelve rows, so on this gym they are the same number');
eq(carried.rollup.outstandingCents, 12 * FEE,
  'the gym-wide “Payable now” KPI is the sum of real figures, not of noughts');
eq(omar.settleBlocker, null, 'nothing is in the way of settling it, which is why the figure had to be right');

/* ── 2 · unpriced work is not free work ───────────────────────────────────── */

const noFee = build(feeOnly, null);
const unpriced = noFee.members![0];
eq(unpriced.outstandingSessions, 0,
  'with no fee set and no rate on the row there is nothing that can be priced, so nothing is offered to settle');
eq(unpriced.outstandingCents, null,
  'and the amount is null rather than 0 — a nought here says the coach is owed nothing for twelve delivered hours');
eq(unpriced.owedCents, null, 'the earned side refuses the same way, for the same reason');

/* ── 3 · a snapshotted rate always wins its own row ───────────────────────── */

const mixed = build([sess('own', 1, OWN_RATE), sess('fee', 2, null)], FEE);
eq(mixed.members![0].outstandingCents, OWN_RATE + FEE,
  'the rate snapshotted at delivery prices its own session and the gym’s fee prices the other — never the fee twice, never nought for the second');

/* ── 4 · rows that are not owed are not counted ───────────────────────────── */

const guarded = build([
  sess('paid', 3, null, 'completed', 'run-1'),   // already settled
  sess('miss', 4, null, 'no_show'),              // not payable under this policy
  sess('soon', -3, null, null),                  // hasn’t happened yet
  sess('live', 5, null),                         // the only one owed
], FEE);
eq(guarded.members![0].outstandingSessions, 1,
  'a settled session, an unpayable no-show and a future booking are all out — only the unsettled delivered one is owed');
eq(guarded.members![0].outstandingCents, FEE,
  'so the fallback prices exactly one session, and the settled one is not paid a second time');

/* ── 5 · a read that did not land is not a gym that owes nothing ──────────── */

const unread = buildStaff({
  trainers: sliceReady(trainers),
  sessions: { state: 'loading' },
  shifts: sliceReady([]),
  clients: sliceReady([]),
  activity: sliceReady([]),
  classes: sliceReady([]),
}, { policy: PAY_DELIVERED_ONLY, fallbackRateCents: FEE, now: NOW, windowDays: 30 });
eq(unread.members![0].outstandingCents, null, 'an unread session list owes an unknown amount, never nothing');
eq(unread.rollup.outstandingCents, null, 'and the KPI above it says so too');
ok(unread.members![0].settleBlocker == null || unread.members![0].settleBlocker!.length > 0,
  'a blocker on an unread read is either absent or a sentence, never an empty string');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('staffView: ok (payable is priced by the same fee that admitted the rows, and unpriced is never free)');
