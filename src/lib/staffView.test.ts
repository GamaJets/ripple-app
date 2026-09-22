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

/* ── 6 · a figure in no money at all ──────────────────────────────────────── *
 *
 * THE SECOND DEFECT THIS FILE NOW HOLDS
 *
 * `settlementAmount` adds `rate_cents` up and has never looked at
 * `rate_currency`. `staffView` handed the result back as a bare integer and
 * /staff wrote `tenants.currency` beside it — the gym's code TODAY, over rates
 * snapshotted whenever they were snapshotted. On a gym that changed its
 * currency mid-window the sum is a total ACROSS two moneys, and /sessions
 * already refuses to settle that exact run through `settleCurrencyBlocker`. So
 * "Payable now" was a confident figure the settle path would not pay, and
 * neither screen said why they differed.
 *
 * The three rules below are ./gymRateCurrency's, not new ones:
 *   · one currency  → the figure stands and is named;
 *   · unrecorded    → the figure is REAL and stands, the LABEL is withheld;
 *   · mixed         → there is no figure.
 */

const cur = (
  id: string, daysAgo: number, rateCents: number | null, rateCurrency: string | null,
  trainerId = 'omar',
): PtSession => ({
  ...sess(id, daysAgo, rateCents), trainerId, rateCurrency,
});

/* one money: the figure stands, and this module — not the screen — names it */
const oneMoney = build([cur('a', 1, OWN_RATE, 'GBP'), cur('b', 2, OWN_RATE, 'GBP')], FEE);
const gbp = oneMoney.members![0];
eq(gbp.outstandingCents, 2 * OWN_RATE, 'a run in one currency still has a total');
eq(gbp.outstandingCurrency, 'GBP', 'and the total is labelled from the RATES, never from tenants.currency');
eq(gbp.outstandingMixedCurrency, false, 'nothing is mixed about it');
eq(gbp.outstandingNote, null, 'so there is no sentence to print where the figure would have gone');
eq(gbp.owedCurrency, 'GBP', 'the earned side is labelled off the same rows');
eq(gbp.owedCents, 2 * OWN_RATE, 'and states its figure');
eq(oneMoney.rollup.outstandingCurrency, 'GBP', 'and the gym-wide KPI carries the code too');

/* two moneys: there is no figure, and the module refuses rather than adds */
const twoMoneys = build([cur('a', 1, OWN_RATE, 'GBP'), cur('b', 2, OWN_RATE, 'EUR')], FEE);
const straddle = twoMoneys.members![0];
eq(straddle.outstandingSessions, 2, 'both sessions are still outstanding — the work happened');
eq(straddle.outstandingCents, null,
  'but GBP + EUR is not an amount of anything, so there is no figure to print');
eq(straddle.outstandingCurrency, null, 'and no single code that could honestly label one');
eq(straddle.outstandingMixedCurrency, true, 'which is what tells this null from “nothing to settle”');
ok((straddle.outstandingNote ?? '').includes('GBP') && (straddle.outstandingNote ?? '').includes('EUR'),
  `the sentence that replaces the figure names both pots (got ${JSON.stringify(straddle.outstandingNote)})`);
eq(straddle.owedCents, null, 'the earned side refuses identically — one rule, not two');
eq(straddle.owedMixedCurrency, true, 'and says why');
ok((straddle.owedNote ?? '').includes('GBP'), 'with the same sentence underneath it');
ok(straddle.settleBlocker != null,
  'and settling is refused here exactly as /sessions refuses it, rather than offered on a total nobody can pay');
eq(straddle.settleable, false, 'so no screen can present this run as ready to hand over');
eq(twoMoneys.rollup.outstandingCents, null, 'the gym-wide “Payable now” withholds it too');
eq(twoMoneys.rollup.outstandingMixedCurrency, true, 'and says which kind of null it is');

/* unrecorded: the figure is real, only its label is missing */
const preHistory = build([cur('a', 1, OWN_RATE, null), cur('b', 2, OWN_RATE, null)], FEE);
const legacy = preHistory.members![0];
eq(legacy.outstandingCents, 2 * OWN_RATE,
  'rates filed before part 1010 are real money — withholding the figure would destroy a true number');
eq(legacy.outstandingCurrency, null,
  'what is withheld is the LABEL: nothing on the record says what these were in');
eq(legacy.outstandingMixedCurrency, false, 'unrecorded is one answer, not two');
ok((legacy.outstandingNote ?? '').length > 0,
  'and the reason is a sentence the screen can print beside the unlabelled figure');

/* a roster can straddle two moneys with every coach on exactly one */
const twoCoaches = buildStaff({
  trainers: sliceReady([
    { trainerId: 'omar', name: 'Omar', since: at(300) },
    { trainerId: 'priya', name: 'Priya', since: at(300) },
  ]),
  sessions: sliceReady([
    cur('a', 1, OWN_RATE, 'GBP'),
    cur('b', 2, OWN_RATE, 'EUR', 'priya'),
  ]),
  shifts: sliceReady([]), clients: sliceReady([]),
  activity: sliceReady([]), classes: sliceReady([]),
}, { policy: PAY_DELIVERED_ONLY, fallbackRateCents: FEE, now: NOW, windowDays: 30 });
const each = (id: string) => twoCoaches.members!.find((m) => m.trainerId === id)!;
eq(each('omar').outstandingCents, OWN_RATE, 'each coach is on exactly one money, so each row has a figure');
eq(each('priya').outstandingCurrency, 'EUR', 'and each row names its own');
eq(twoCoaches.rollup.outstandingCents, null,
  'the HEADLINE is the case a fold over the rows would miss: two printable figures whose total is in no money');
eq(twoCoaches.rollup.outstandingMixedCurrency, true, 'and it says so rather than showing a smaller confident sum');
eq(twoCoaches.rollup.owedCents, null, 'the earned headline is withheld for the same reason');

/* ── 7 · the gym's own code, when the caller states it ────────────────────── */

const withGym = (gymCurrency: string | null | undefined) => buildStaff(
  recordOf([cur('a', 1, OWN_RATE, 'GBP')]),
  { policy: PAY_DELIVERED_ONLY, fallbackRateCents: FEE, now: NOW, windowDays: 30, gymCurrency },
).members![0];

ok((withGym('AED').settleBlocker ?? '').includes('GBP'),
  'told the gym charges in AED, this refuses to offer a GBP run as settleable — the same refusal /sessions makes');
eq(withGym('GBP').settleBlocker, null, 'and waves through the run that agrees with the code it would be stamped with');
eq(withGym(undefined).settleBlocker, null,
  'told nothing, it does NOT announce that the gym has no currency — that would be a fact about the gym invented from a fact about the caller');
ok((withGym(undefined).outstandingCurrency) === 'GBP',
  'while the figure is still labelled from the rates, which need no gym currency at all');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('staffView: ok (payable is priced by the same fee that admitted the rows, unpriced is never free, and a sum across two moneys is never a figure)');
