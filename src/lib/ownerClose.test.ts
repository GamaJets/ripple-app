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
  passSnapshotOf, passDriftSince, type StoredPassColumns,
  CLOSE_UNREAD_NOTE,
} from './ownerClose';
import type { MonthClose, Blocker, ClosePasses } from './monthEnd';
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

/* ── pass sales, snapshotted onto the close ───────────────────────────────── */
{
  const passesOf = (o: Partial<ClosePasses> = {}): ClosePasses => ({
    cents: 86000, priced: 4, sold: 5, currency: 'GBP', currencies: ['GBP'], mixedCurrency: false, ...o,
  });

  // The passes slice did not land. Four nulls, and not one of them a count of
  // nothing — a month nobody could read did not sell zero passes.
  const unread = passSnapshotOf(closeOf({ passes: null }));
  eq(unread.passCents, null, 'an unread passes slice files no figure');
  eq(unread.passCurrency, null, 'and no code for the figure it is not offering');
  eq(unread.passesSold, null, 'and no count — a read that did not happen is not a zero');
  eq(unread.passesPriced, null, 'nor a count of how many were priced');

  const plain = passSnapshotOf(closeOf({ passes: passesOf() }));
  eq(plain.passCents, 86000, 'a month of one money files its figure');
  eq(plain.passCurrency, 'GBP', 'in the code the passes themselves stated');
  eq(plain.passesSold, 5, 'with what was sold');
  eq(plain.passesPriced, 4, 'and how many of those carried a price');

  // The reason this lane exists. `ClosePasses.cents` is STILL a raw sum here —
  // its own comment says a caller must withhold it — so a snapshot that carried
  // it through would file 1,100 of nothing as an amount of money.
  const mixed = passSnapshotOf(closeOf({
    passes: passesOf({ cents: 110000, currencies: ['AED', 'GBP'], currency: null, mixedCurrency: true }),
  }));
  eq(mixed.passCents, null, 'two currencies cannot be added, so no figure is filed');
  ok(mixed.passCents !== 0, 'and emphatically not 0, which claims the gym sold nothing');
  eq(mixed.passCurrency, null, 'the code goes with it — the pair can never disagree');
  eq(mixed.passesSold, 5, 'while the COUNT survives: passes were sold and the record says so');
  eq(mixed.passesPriced, 4, 'and how many of them were priced');

  // A real sum in one unknown unit, which is not the same thing as two known
  // ones — the distinction payrollCurrency draws in gymClose.ts.
  const unstated = passSnapshotOf(closeOf({
    passes: passesOf({ currency: null, currencies: [], mixedCurrency: false }),
  }));
  eq(unstated.passCents, 86000, 'priced passes that all state no money are still one sum');
  eq(unstated.passCurrency, null, 'carrying no code rather than the gym’s');

  const nonePriced = passSnapshotOf(closeOf({
    passes: passesOf({ cents: null, priced: 0, sold: 3, currency: null, currencies: [] }),
  }));
  eq(nonePriced.passCents, null, 'no priced pass is no figure');
  eq(nonePriced.passesSold, 3, 'and three passes were still sold');
}

/* ── what the passes say now, against what was filed ──────────────────────── */
{
  const passesOf = (o: Partial<ClosePasses> = {}): ClosePasses => ({
    cents: 86000, priced: 4, sold: 5, currency: 'GBP', currencies: ['GBP'], mixedCurrency: false, ...o,
  });
  const stored = (o: Partial<StoredPassColumns> = {}): MonthCloseRow & StoredPassColumns =>
    ({ ...filedRow(), passCents: 86000, passCurrency: 'GBP', passesSold: 5, passesPriced: 4, ...o });
  const live = passSnapshotOf(closeOf({ passes: passesOf() }));

  // The guard that matters most today: fetchCloses does not select these
  // columns yet, so a row arrives with no pass KEYS on it. That is not a close
  // that filed nulls, and reporting it as one would put a false movement line
  // on every filed month in the product.
  eq(passDriftSince(filedRow(), live, fmt).length, 0,
    'a row read by a select that never asked about passes reports nothing');

  eq(passDriftSince(stored(), live, fmt).length, 0, 'a month whose passes have not moved has no line');

  const moved = passDriftSince(stored({ passCents: 90000 }), live, fmt);
  eq(moved.length, 1, 'a pass figure that has changed is one line');
  ok(moved[0].includes('90000 GBP') && moved[0].includes('86000 GBP'),
    'with both sides stated in the money each was recorded in');

  // The number did not move. The money did.
  const reCurrencied = passDriftSince(stored({ passCurrency: 'AED' }), live, fmt);
  eq(reCurrencied.length, 1, 'a change of currency over an unchanged number is itself drift');
  ok(reCurrencied[0].includes('86000 AED') && reCurrencied[0].includes('86000 GBP'),
    'and it is visible because each side names its own code');

  // A filed figure that today spans two currencies. The line may not say 0 and
  // may not say "not known" — the figure exists and is not one number.
  const nowMixed = passSnapshotOf(closeOf({
    passes: passesOf({ cents: 110000, currency: null, currencies: ['AED', 'GBP'], mixedCurrency: true }),
  }));
  const spread = passDriftSince(stored(), nowMixed, fmt);
  eq(spread.length, 1, 'a month that has since become two moneys has moved');
  ok(spread[0].includes('not a single amount'), 'and the line says the figure is not one number');
  ok(!/\b0\b/.test(spread[0]), 'never 0, which would read as nothing sold');

  const counts = passDriftSince(stored({ passesSold: 4, passesPriced: 3 }), live, fmt);
  eq(counts.length, 2, 'the two counts drift on their own, independently of the money');
  ok(counts.some((l) => l.includes('pass(es) were sold')), 'one line for what was sold');
  ok(counts.some((l) => l.includes('carried a price')), 'one for how many were priced');

  // A close filed before the passes could be read, against a month that can be
  // read now: three movements, none of them an error.
  const fromNothing = passDriftSince(
    stored({ passCents: null, passCurrency: null, passesSold: null, passesPriced: null }), live, fmt);
  eq(fromNothing.length, 3, 'a close that recorded no passes at all has moved on all three');
  ok(fromNothing.every((l) => /unknown|not a single amount/.test(l)),
    'and every line names the absence rather than dashing it');
}

/* ── and it reaches the view the owner actually reads ─────────────────────── */
{
  const passes = {
    cents: 86000, priced: 4, sold: 5, currency: 'GBP', currencies: ['GBP'], mixedCurrency: false,
  } satisfies ClosePasses;
  const row: MonthCloseRow & StoredPassColumns =
    { ...filedRow(), passCents: 80000, passCurrency: 'GBP', passesSold: 5, passesPriced: 4 };

  const v = ownerCloseView('gym', MONTH, closeOf({ passes }), CLOSES([row]), fmt);
  ok(v.kind === 'month' && v.filing.state === 'filed' && v.filing.drift.length === 1,
    'a pass sale recorded after the close is one movement on the filed month');
  ok(v.kind === 'month' && v.filing.state === 'filed' && v.filing.drift[0].startsWith('Pass sales were'),
    'named as pass sales, in the section that reports movement');
  ok(v.kind === 'month' && v.headline.includes('one figure has moved'),
    'and the headline counts it alongside the four money figures');
  eq(closeHeadNote(v), 'Closed', 'drift is movement — it never turns a filed month back into a problem');
}

if (errors.length) {
  console.error(`ownerClose: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('ownerClose ok');
