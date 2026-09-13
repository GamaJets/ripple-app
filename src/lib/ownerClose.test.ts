// Tests for ownerClose — the month-close verdict as the owner's phone shows it.
//
// Every assertion here is a refusal, because everything this view can get wrong
// it gets wrong by claiming more than it knows:
//
//   · reads that have not settled are NEVER 'closeable'. A phone that says "this
//     month can be closed" over a payments read that failed is the single worst
//     sentence this screen could print;
//   · a record of closes that could not be read is NEVER "still open". An owner
//     told that about a month they filed last week closes it twice;
//   · a filed month's drift is movement, not a blocker, and it is computed only
//     against a WHOLE record — otherwise every figure reads as having moved to
//     nothing;
//   · and each figure's drift is measured in the money THAT figure was recorded
//     in, never in one borrowed code.
//
// Compile with tsc, run with node.
import {
  ownerCloseView, filingOf, figureCurrencies, closeHeadNote,
  CLOSE_UNREAD_NOTE,
} from './ownerClose';
import type { MonthClose, Blocker } from './monthEnd';
import type { MonthCloseRow } from './gymClose';
import { NOT_A_QUIET_GYM } from './gymLink';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const MONTH = { key: '2026-08', label: 'August 2026' };
/** Enough of a formatter to read the assertions by. The screen's own puts the
 *  amount through the gym's currency; what is pinned here is which CODE each
 *  side is stated in, which is the half that can silently be wrong. */
const fmt = (cents: number | null, ccy: string | null) =>
  cents == null ? 'not known' : `${cents} ${ccy ?? 'no currency'}`;

const closeOf = (o: Partial<MonthClose> = {}): MonthClose => ({
  window: {
    key: '2026-08', label: 'August 2026',
    firstDay: '2026-08-01', lastDay: '2026-08-31',
    fromIso: '2026-08-01T00:00:00.000Z', toIso: '2026-09-01T00:00:00.000Z',
  },
  ended: true,
  income: {
    takenCents: 420000, count: 14, byMethod: [], currencies: ['GBP'],
    mixedCurrency: false,
    unattributed: 0, unattributedCents: 0, unattributedCurrency: 'GBP',
  },
  purpose: [],
  owed: {
    issued: 6, settledCents: 300000, settled: 4,
    outstandingCents: 90000, outstanding: 2,
    overdueCents: 45000, overdue: 1,
    droppedCents: null, dropped: 0, currencies: ['GBP'], mixedCurrency: false,
  },
  arrears: {
    issued: 9, settledCents: 300000, settled: 4,
    outstandingCents: 155000, outstanding: 5,
    overdueCents: 60000, overdue: 2,
    droppedCents: null, dropped: 0, currencies: ['GBP'], mixedCurrency: false,
  },
  check: null,
  payroll: {
    lines: [],
    total: { currency: 'GBP', mixedCurrency: false, cents: 180000, delivered: 40, payable: 40, priced: 40, unmarked: 0, settleable: true },
    blocker: null,
    currency: 'GBP', mixedCurrency: false, currencyNote: null,
  },
  passes: null,
  blockers: [],
  state: 'closeable',
  warning: null,
  ...o,
});

const BLOCKER: Blocker = {
  kind: 'unmarked_sessions',
  text: '3 sessions finished in August 2026 with no outcome recorded.',
};
const blocked = closeOf({ state: 'blocked', blockers: [BLOCKER] });

const filedRow = (o: Partial<MonthCloseRow> = {}): MonthCloseRow => ({
  id: 'c1', monthKey: '2026-08', closedAt: '2026-09-02T09:00:00.000Z',
  closedBy: 'owner', closedByName: 'Dana', note: null,
  takenCents: 420000, invoicedCents: 390000, outstandingCents: 155000, payrollCents: 180000,
  takenCurrency: 'GBP', invoicedCurrency: 'GBP', outstandingCurrency: 'GBP', payrollCurrency: 'GBP',
  currency: null, unmarkedSessions: 0, blockersAtClose: null,
  reopenedAt: null, reopenedBy: null, reopenedByName: null, reopenReason: null,
  ...o,
});

const CLOSES = (rows: MonthCloseRow[]) => ({ status: 'ready' as LoadStatus, rows });
const NO_CLOSES = { status: 'error' as LoadStatus, rows: null };

/* ── the silences, kept apart ─────────────────────────────────────────────── */
{
  const unknown = ownerCloseView('unknown', MONTH, closeOf(), CLOSES([]), fmt);
  eq(unknown.kind, 'unread', 'an unsettled tenant read is unread, never a month');
  eq(unknown.kind === 'unread' ? unknown.note : null, CLOSE_UNREAD_NOTE, 'and says it claims nothing either way');

  const none = ownerCloseView('none', MONTH, closeOf(), CLOSES([]), fmt);
  eq(none.kind, 'no_gym', 'an account with no gym has no month being closed');
  ok(none.kind === 'no_gym' && none.note.includes(NOT_A_QUIET_GYM),
    'and it says so rather than drawing an empty, clean-looking month');

  eq(ownerCloseView('gym', null, closeOf(), CLOSES([]), fmt).kind, 'unread',
    'a verdict with no month attached is a verdict about nothing');
}

/* ── an unfinished read is never a clean month ────────────────────────────── */
{
  const v = ownerCloseView('gym', MONTH, null, CLOSES([]), fmt);
  ok(v.kind === 'month' && v.verdict === 'unknown', 'reads that have not landed produce no verdict');
  ok(v.kind === 'month' && v.blockers.length === 0,
    'and no blocker list — an unfinished read has one fact about it, not a list of reasons');
  ok(v.kind === 'month' && !/can be closed/.test(v.headline),
    'the headline never offers a close over a record nobody holds');
  ok(v.kind === 'month' && v.headline.includes('no verdict yet'), 'it says there is no verdict yet');
  eq(closeHeadNote(v), null, 'and nothing beside the heading, which would read as a count of problems');
}

/* ── the filing is a separate question from the figures ───────────────────── */
{
  const unreadFiling = ownerCloseView('gym', MONTH, blocked, NO_CLOSES, fmt);
  ok(unreadFiling.kind === 'month' && unreadFiling.filing.state === 'unknown',
    'a refused closes read leaves the filing unknown');
  ok(unreadFiling.kind === 'month' && !/not closed/.test(unreadFiling.headline),
    'and the headline must not call the month open — that is how a month gets closed twice');
  ok(unreadFiling.kind === 'month' && unreadFiling.blockers.length === 1,
    'while the figures it CAN speak for are still reported');

  const partial = filingOf('2026-08', { status: 'partial', rows: [filedRow()] }, closeOf(), fmt);
  eq(partial.state, 'unknown', 'a truncated record of closes is not the record — isWhole, not "did not fail"');

  const open = ownerCloseView('gym', MONTH, blocked, CLOSES([filedRow({ monthKey: '2026-07' })]), fmt);
  ok(open.kind === 'month' && open.filing.state === 'open',
    'a whole read with no live close for THIS month is an open month');
  ok(open.kind === 'month' && open.headline.includes('is not closed'), 'and it may be said plainly');
  eq(closeHeadNote(open), '1 in the way', 'the heading carries the count of what is blocking it');

  const reopened = ownerCloseView(
    'gym', MONTH, blocked,
    CLOSES([filedRow({ reopenedAt: '2026-09-05T10:00:00.000Z', reopenReason: 'a late refund' })]),
    fmt,
  );
  ok(reopened.kind === 'month' && reopened.filing.state === 'open',
    'a close that was reopened is not a close in force');
}

/* ── a filed month, and what moved ────────────────────────────────────────── */
{
  const still = ownerCloseView('gym', MONTH, closeOf(), CLOSES([filedRow()]), fmt);
  ok(still.kind === 'month' && still.filing.state === 'filed', 'the live close is found');
  ok(still.kind === 'month' && still.filing.state === 'filed' && still.filing.drift.length === 0,
    'a month that has not moved reports no drift');
  ok(still.kind === 'month' && still.headline.includes('exactly as it did when it was filed'),
    'and the headline says so');
  eq(closeHeadNote(still), 'Closed', 'the heading answers the question an owner away from their desk asked');

  const moved = ownerCloseView('gym', MONTH, closeOf(), CLOSES([filedRow({ takenCents: 400000 })]), fmt);
  ok(moved.kind === 'month' && moved.filing.state === 'filed' && moved.filing.drift.length === 1,
    'a figure that has changed since the close is one drift line');
  ok(moved.kind === 'month' && moved.headline.includes('moved since it was filed'),
    'and the headline leads with the filing, not with a refusal to close a month that is closed');
  ok(moved.kind === 'month' && moved.filing.state === 'filed' && moved.filing.drift[0].includes('400000 GBP'),
    'each side is stated in the money it was recorded in');

  // A close taken OVER blockers is allowed and recorded — gymClose.ts argues it
  // at length. The blockers are still true of today's rows and are still shown;
  // what must not happen is the headline refusing a close that already happened.
  const filedOverBlockers = ownerCloseView('gym', MONTH, blocked, CLOSES([filedRow({ blockersAtClose: '3 sessions unmarked' })]), fmt);
  ok(filedOverBlockers.kind === 'month' && filedOverBlockers.headline.startsWith('August 2026 is closed'),
    'a filed month reads as filed even when something is outstanding today');
  ok(filedOverBlockers.kind === 'month' && filedOverBlockers.blockers.length === 1,
    'and what is outstanding is still listed');
  ok(filedOverBlockers.kind === 'month' && filedOverBlockers.filing.state === 'filed'
    && filedOverBlockers.filing.blockersAtClose === '3 sessions unmarked',
    'with what it was filed OVER carried verbatim from the row');

  // With the month's own reads unfinished there is nothing honest to compare
  // the filed figures against, and comparing anyway reports all four as moved.
  const halfRead = filingOf('2026-08', CLOSES([filedRow()]), null, fmt);
  ok(halfRead.state === 'filed' && halfRead.drift.length === 0,
    'drift is never computed against a month that could not be read');
}

/* ── one currency per figure, off the rows that figure is a sum of ────────── */
{
  const c = closeOf();
  eq(figureCurrencies(c).taken, 'GBP', 'the takings wear what the payments agreed on');
  eq(figureCurrencies(c).invoiced, 'GBP', 'the month’s invoices state their own');
  eq(figureCurrencies(c).outstanding, 'GBP', 'and the arrears theirs');

  const mixed = closeOf({
    income: { ...c.income!, takenCents: null, currencies: ['AED', 'GBP'], mixedCurrency: true },
  });
  eq(figureCurrencies(mixed).taken, null,
    'a month taken in two moneys has no code for a figure it is not offering');

  const oneStated = closeOf({
    owed: { ...c.owed!, currencies: ['GBP'], mixedCurrency: true },
  });
  eq(figureCurrencies(oneStated).invoiced, null,
    'and neither does a set where one invoice states no currency at all — mixedCurrency, never currencies.length');

  // The defect part 2540 closed, asserted from this side: a month whose takings
  // are AED must not relabel its GBP invoices.
  const twoMoneys = closeOf({
    income: { ...c.income!, currencies: ['AED'] },
  });
  eq(figureCurrencies(twoMoneys).taken, 'AED', 'the takings take their own code');
  eq(figureCurrencies(twoMoneys).invoiced, 'GBP', 'and the invoices keep theirs');
}

if (errors.length) {
  console.error(`ownerClose: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('ownerClose ok');
