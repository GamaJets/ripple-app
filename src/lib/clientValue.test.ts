// What one client has actually paid. Compile with tsc, run with node.
//
// One assertion here matters more than all the others put together:
//
//   A LIFETIME VALUE COMPUTED FROM STRIPE ALONE IS WRONG FOR MOST COACHES.
//
// `coach_receipts` (part 190) is the half of the book Stripe never saw — cash,
// bank transfers, and anything taken on a gym's front-desk terminal — and for
// most self-employed coaches card is the MINORITY of income. So a receipts read
// that did not come back whole has to withhold the TOTAL, exactly as a failed
// purchases read does. Leaving it out would not make the figure slightly low;
// it would make it a different number about a different business, with nothing
// on it to say so, in front of a coach deciding how hard to fight to keep
// somebody.
//
// The rest: currencies never merge, an amount with no unit is counted rather
// than dropped, only 'paid' is money, and "they have paid you nothing" is never
// said over a read that did not happen.
import {
  clientValue, paidOnly, rankByValue, currenciesIn, unattributedReceipts,
  unattributedLine, valueSpanLine, valueEmptyLine, valueStatus,
  VALUE_IS_PAST, VALUE_NEEDS_YOUR_RECORDS,
  type ValuePurchase, type ValueRenewal, type ValueReceipt, type RankedClient,
} from './clientValue';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const ANA = 'client-ana';
const BEN = 'client-ben';
const ALL_READY = { purchases: 'ready', renewals: 'ready', receipts: 'ready' } as const;

const purchases: ValuePurchase[] = [
  { client_id: ANA, amount_cents: 60000, currency: 'AED', created_at: '2025-03-01T10:00:00Z', status: 'paid' },
  { client_id: ANA, amount_cents: 45000, currency: 'AED', created_at: '2025-09-01T10:00:00Z', status: 'paid' },
  // Not money. A pending checkout and a refunded sale are not income.
  { client_id: ANA, amount_cents: 99900, currency: 'AED', created_at: '2025-10-01T10:00:00Z', status: 'pending' },
  { client_id: ANA, amount_cents: 20000, currency: 'AED', created_at: '2025-11-01T10:00:00Z', status: 'refunded' },
  { client_id: BEN, amount_cents: 30000, currency: 'AED', created_at: '2026-01-05T10:00:00Z', status: 'paid' },
];
const renewals: ValueRenewal[] = [
  { client_id: ANA, amount_cents: 25000, currency: 'AED', paid_at: '2025-12-01T10:00:00Z', created_at: '2025-12-03T10:00:00Z' },
];
const receipts: ValueReceipt[] = [
  { clientId: ANA, amountCents: 120000, currency: 'AED', receivedOn: '2026-02-14' },
  // The cash a coach takes from somebody they bill by hand, with no account
  // behind them. Real income, attachable to nobody.
  { clientId: null, amountCents: 40000, currency: 'AED', receivedOn: '2026-02-20' },
];

/* ── only paid rows are money ──────────────────────────────────────────── */

eq(paidOnly(purchases).length, 3, 'pending and refunded sales are not income');
// A denylist (`status !== 'refunded'`) would count the next status Stripe adds
// as revenue by default. This is an allowlist of exactly one word.
eq(paidOnly([{ status: null } as any]).length, 0, 'a row with no status at all is not counted as a payment');
eq(paidOnly([{ status: 'PAID' } as any]).length, 1, 'and the check is case-insensitive, because Stripe is not this repo');

/* ── the three sources, added ──────────────────────────────────────────── */

const ana = clientValue(ANA, purchases, renewals, receipts, ALL_READY);
eq(ana.payments, 4, 'two sales, one renewal and one recorded payment');
const total = ana.ledger.total;
ok(total != null, 'with every read whole there is a total');
eq(total?.pots.length, 1, 'one currency, one pot');
// 600 + 450 + 250 + 1200 = 2500.00 AED. The cash is 1200 of it — nearly half —
// which is the whole point of the assertion below.
eq(total?.pots[0].minorUnits, 250000, 'the sales, the renewal AND the cash');
eq(total?.pots[0].currency, 'AED', 'in the currency the money moved in');

/* ── THE ONE THAT MATTERS: the cash half is not optional ───────────────── */

const noCash = clientValue(ANA, purchases, renewals, receipts, { ...ALL_READY, receipts: 'error' });
eq(noCash.ledger.total, null,
  'a receipts read that failed withholds the WHOLE total — a figure short by the cash is not a smaller figure, it is a different one');
ok(/cash and transfers/i.test(noCash.ledger.reason ?? ''),
  'and the coach is told which half is missing, in the words they use for it');
ok(noCash.ledger.missing.includes('cash and transfers'), 'named in the missing list too');

// The same rule for the other two, so nobody can argue Stripe is the
// trustworthy half.
eq(clientValue(ANA, purchases, renewals, receipts, { ...ALL_READY, purchases: 'error' }).ledger.total, null,
  'a failed sales read withholds it as well');
eq(clientValue(ANA, purchases, renewals, receipts, { ...ALL_READY, renewals: 'partial' }).ledger.total, null,
  'and a truncated renewals read — a subtotal of somebody’s income printed as a total is a plausible number with nothing to doubt');

/* ── currencies never merge ────────────────────────────────────────────── */

const mixed: ValuePurchase[] = [
  { client_id: ANA, amount_cents: 60000, currency: 'AED', created_at: '2025-03-01T10:00:00Z', status: 'paid' },
  { client_id: ANA, amount_cents: 9000, currency: 'GBP', created_at: '2025-08-01T10:00:00Z', status: 'paid' },
  // An amount with no unit. Counted, never summed, never dropped.
  { client_id: ANA, amount_cents: 5000, currency: null, created_at: '2025-09-01T10:00:00Z', status: 'paid' },
  // No amount at all.
  { client_id: ANA, amount_cents: null, currency: 'AED', created_at: '2025-10-01T10:00:00Z', status: 'paid' },
];
const two = clientValue(ANA, mixed, [], [], ALL_READY);
eq(two.ledger.total?.pots.length, 2, 'AED 600 and GBP 90 are two pots and never 690 of anything');
eq(two.ledger.total?.unlabelled, 1, 'an amount with no currency is counted as a hole in the total');
eq(two.ledger.total?.unpriced, 1, 'and so is a row with no amount');
const potsSum = (two.ledger.total?.pots ?? []).reduce((a, p) => a + p.minorUnits, 0);
eq(potsSum, 69000, 'the unlabelled amount is in neither pot — it was not quietly added to whichever came first');

/* ── how long they have been paying ────────────────────────────────────── */

eq(new Date(ana.firstAt as string).toISOString(), '2025-03-01T10:00:00.000Z', 'the first payment dates the relationship');
eq(new Date(ana.lastAt as string).toISOString(), new Date('2026-02-14').toISOString(),
  'and a recorded payment is dated by the day the coach says the money arrived');
ok(/across/.test(valueSpanLine(ana, new Date('2026-03-01T00:00:00Z')) ?? ''), 'the span is said in words');
ok(/year/.test(valueSpanLine(ana, new Date('2026-06-01T00:00:00Z')) ?? ''), 'and reads as years once it is years');
eq(valueSpanLine(clientValue('nobody', [], [], [], ALL_READY), new Date()), null, 'no payments, no span');

/* ── a renewal Stripe stated no date for ───────────────────────────────── */

const undated = clientValue(ANA, [], [{ client_id: ANA, amount_cents: 25000, currency: 'AED', paid_at: null, created_at: '2025-12-03T10:00:00Z' }], [], ALL_READY);
eq(undated.ledger.total?.pots[0].minorUnits, 25000, 'a renewal with no paid_at is still money');
ok(undated.firstAt != null, 'and still dates the relationship, from the row it was written on');

/* ── an empty answer means what the read says it means ─────────────────── */

const none = clientValue('nobody-at-all', purchases, renewals, receipts, ALL_READY);
eq(none.payments, 0, 'somebody who has paid nothing has no payments');
ok(/If they pay you in cash/i.test(valueEmptyLine(none)), 'and is told so, with the way to record what did not go through Stripe');

const unread = clientValue(ANA, [], [], [], { purchases: 'error', renewals: 'error', receipts: 'error' });
ok(!/nothing has been recorded as paid/i.test(valueEmptyLine(unread)),
  'a failed read is NEVER worded as "they have paid you nothing" — that is the sentence that decides how hard a coach fights to keep somebody');
ok(/could not be read/i.test(valueEmptyLine(unread)), 'it says the read failed');

/* ── the ranking is inside one currency ────────────────────────────────── */

const rows: RankedClient[] = [
  { clientId: ANA, name: 'Ana', value: clientValue(ANA, purchases, renewals, receipts, ALL_READY) },
  { clientId: BEN, name: 'Ben', value: clientValue(BEN, purchases, renewals, receipts, ALL_READY) },
];
eq(rankByValue(rows, 'AED')[0].clientId, ANA, 'the biggest AED figure leads');
eq(rankByValue(rows, 'AED').length, 2, 'and nobody is dropped from a list headed "what your clients have paid you"');

// A client whose money is in a currency the list is not ranked by stays in the
// list. Dropping them would read as a client who has paid nothing.
const gbpOnly: RankedClient = {
  clientId: 'cara', name: 'Cara',
  value: clientValue('cara', [{ client_id: 'cara', amount_cents: 9000, currency: 'GBP', created_at: '2026-01-01T00:00:00Z', status: 'paid' }], [], [], ALL_READY),
};
eq(rankByValue([...rows, gbpOnly], 'AED').length, 3, 'a client paid in another currency is still listed');
eq(rankByValue([...rows, gbpOnly], 'AED')[2].clientId, 'cara', 'at the bottom, rather than ranked on a number that is not comparable');
eq(currenciesIn([...rows, gbpOnly]).length, 2, 'and the screen can say there are two currencies');
eq(currenciesIn([...rows, gbpOnly])[0], 'AED', 'led by the biggest');

/* ── the cash that belongs to nobody ───────────────────────────────────── */

const orphan = unattributedReceipts(receipts);
eq(orphan.count, 1, 'a recorded payment with no client account is counted');
eq(orphan.taken.pots[0].minorUnits, 40000, 'and its amount is kept, because it is real income');
ok(unattributedLine(1) != null, 'and reported');
eq(unattributedLine(0), null, 'a "0 unattributed" line under every screen is furniture, so there is none');
ok(/not in any of the per-client figures/i.test(unattributedLine(2) as string),
  'the sentence says the money is outside the breakdown above it');

/* ── the status the screen must not compose itself ─────────────────────── */

eq(valueStatus(ALL_READY), 'ready', 'three whole reads are a whole answer');
eq(valueStatus({ ...ALL_READY, receipts: 'error' }), 'error', 'and the cash half failing is the whole answer failing');
eq(valueStatus({ purchases: 'partial', renewals: 'loading', receipts: 'ready' }), 'loading',
  'loading outranks partial, because a part still in flight is not yet known to be anything');

/* ── the sentences ─────────────────────────────────────────────────────── */

ok(/forecast|projected/i.test(VALUE_IS_PAST),
  '"lifetime value" means a projection everywhere else, so this says plainly that it is not one');
ok(/cash|transfer/i.test(VALUE_NEEDS_YOUR_RECORDS), 'and that the cash half depends on the coach recording it');
ok(/floor/i.test(VALUE_NEEDS_YOUR_RECORDS), 'and that until they do, every figure is a floor');

if (errors.length) {
  for (const e of errors) console.error('  ✗ ' + e);
  console.error(`clientValue: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('clientValue: ok (the cash half is not optional, currencies never merge, and an unread total is never "they paid you nothing")');
