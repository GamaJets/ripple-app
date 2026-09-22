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
//
// And one more, which `paidOnly` was believed to cover and never did: MONEY
// THAT WENT BACK. Nothing in this database writes `status = 'refunded'` — a
// refund is `refunded_cents`, verified live — so a fully refunded ten-pack read
// here as money the client had paid, and ranked them above the clients who kept
// theirs. It is netted off the AMOUNT now, never by dropping the row, and it is
// the one figure in this app that is not gross.
import {
  clientValue, paidOnly, keptCents, rankByValue, currenciesIn, unattributedReceipts,
  unattributedLine, valueSpanLine, valueEmptyLine, valueBookEmptyLine, valueStatus,
  paymentsCounted, paymentsFloorLine, refundedLine,
  VALUE_IS_PAST, VALUE_NEEDS_YOUR_RECORDS, VALUE_IS_NET_OF_REFUNDS,
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
  // Not money. A checkout that never completed is not income.
  { client_id: ANA, amount_cents: 99900, currency: 'AED', created_at: '2025-10-01T10:00:00Z', status: 'pending' },
  // A status this database has never actually held — kept as a fixture only, to
  // hold the allowlist to exactly one word. A REAL refund is `refunded_cents`,
  // and it is tested on its own below.
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

eq(paidOnly(purchases).length, 3, 'a pending checkout is not income');
// A denylist (`status !== 'refunded'`) would count the next status Stripe adds
// as revenue by default. This is an allowlist of exactly one word.
eq(paidOnly([{ status: null } as any]).length, 0, 'a row with no status at all is not counted as a payment');
eq(paidOnly([{ status: 'PAID' } as any]).length, 1, 'and the check is case-insensitive, because Stripe is not this repo');
// The status 'refunded' above is a fixture and nothing more. Verified against
// the live schema: `client_purchases.status` is `text not null default 'paid'`,
// the only writer hardcodes 'paid', and no code anywhere writes 'refunded' — a
// refund is mirrored into `refunded_cents` instead. So `paidOnly` never
// excluded a refund and never could, which is what the block below is about.

/* ── MONEY THAT CAME BACK ──────────────────────────────────────────────── */
//
// Ana buys an AED 2,400 ten-pack and is refunded in full. Before this, "What
// Each Client Has Paid" read AED 2,400.00 for her and ranked her above the
// clients who kept nothing back — on the one figure the screen tells a coach to
// make a retention decision from.

eq(keptCents(240000, 240000), 0, 'a sale refunded in full is money nobody kept');
eq(keptCents(240000, 60000), 180000, 'a partial refund reduces the sale by what went back and leaves the rest standing');
eq(keptCents(240000, 0), 240000, 'nought back is the whole sale, which is nearly every row');
eq(keptCents(240000, null), 240000, 'and so is a column a narrower read did not select');
eq(keptCents(240000, undefined), 240000, 'and so is one that is simply absent');
eq(keptCents(240000, '60000'), 180000, 'a bigint arriving as a string is still a number of minor units');
eq(keptCents(null, 60000), null, 'an amount Stripe never stated is not made nought by a refund against it');
// The database constraint should make this unreachable. "Should be unreachable"
// is how a coach reads that a client has paid them minus four hundred pounds.
eq(keptCents(240000, 900000), 0, 'more back than was charged floors at nought and never goes negative');
eq(keptCents(240000, -5000), 240000, 'and a negative refund never ADDS to what somebody paid');

{
  const REF = 'client-refunded';
  const full: ValuePurchase[] = [{ client_id: REF, amount_cents: 240000, currency: 'AED', created_at: '2026-01-04T10:00:00Z', status: 'paid', refunded_cents: 240000 }];
  const v = clientValue(REF, full, [], [], ALL_READY);
  eq(v.ledger.total?.pots[0].minorUnits, 0, 'a fully refunded ten-pack is not money this client has paid');
  eq(v.payments, 1, 'the sale still counts as a payment — the money did move, twice');
  ok(v.firstAt != null, 'and still dates the relationship, which is what makes this a lifetime');
  ok(/2,400\.00/.test(refundedLine(v) ?? ''), 'and what went back is stated beside the figure it has come off');
  ok(/already off the figure/i.test(refundedLine(v) ?? ''), 'so a smaller number does not read as lost money');
}

{
  const REF = 'client-part';
  const part: ValuePurchase[] = [{ client_id: REF, amount_cents: 240000, currency: 'AED', created_at: '2026-01-04T10:00:00Z', status: 'paid', refunded_cents: 60000 }];
  const v = clientValue(REF, part, [], [], ALL_READY);
  eq(v.ledger.total?.pots[0].minorUnits, 180000, 'a partial refund reduces the figure rather than removing the sale');
  eq(v.refunded.pots[0].minorUnits, 60000, 'and the size of the subtraction is kept, so the screen can say it happened');
}

{
  // A refunded RENEWAL is the same defect. A coach refunding "last month" is
  // refunding one of these, and netting only one-off sales would be half a fix.
  const REF = 'client-renewal';
  const v = clientValue(REF, [], [
    { client_id: REF, amount_cents: 25000, currency: 'AED', paid_at: '2026-02-01T10:00:00Z', created_at: '2026-02-01T10:00:00Z', refunded_cents: 25000 },
  ], [], ALL_READY);
  eq(v.ledger.total?.pots[0].minorUnits, 0, 'a refunded renewal is not money this client has paid either');
  eq(v.refunded.pots[0].minorUnits, 25000, 'and it is reported the same way');
}

{
  // Zero-decimal and three-decimal currencies. Nothing in the arithmetic
  // divides by a hundred — both sides are minor units in one currency — so the
  // number of places that currency has never enters into it.
  const v = clientValue('c', [
    { client_id: 'c', amount_cents: 240000, currency: 'JPY', created_at: '2026-01-04T10:00:00Z', status: 'paid', refunded_cents: 40000 },
    { client_id: 'c', amount_cents: 12340, currency: 'KWD', created_at: '2026-01-05T10:00:00Z', status: 'paid', refunded_cents: 2340 },
  ], [], [], ALL_READY);
  const jpy = v.ledger.total?.pots.find((p) => p.currency === 'JPY');
  const kwd = v.ledger.total?.pots.find((p) => p.currency === 'KWD');
  eq(jpy?.minorUnits, 200000, 'a zero-decimal currency is netted in its own minor units');
  eq(kwd?.minorUnits, 10000, 'and so is a three-decimal one');
  eq(v.refunded.pots.length, 2, 'and the two refunds are two pots, never one number');
}

{
  // Nobody has refunded anybody, which is nearly every client. No pot of
  // noughts and no line — "refunded AED 0.00" under every row is the furniture
  // `unattributedLine` refuses for the same reason.
  const clean = clientValue(BEN, purchases, renewals, receipts, ALL_READY);
  eq(clean.refunded.pots.length, 0, 'a client nobody has refunded has no refund pots');
  eq(refundedLine(clean), null, 'and no line under their figure');
}

{
  // A refund against a sale whose currency was never recorded. It has come off
  // an amount that is in no pot either way, and naming it would mean printing
  // money in a unit nobody stated — the one thing this app refuses everywhere.
  const v = clientValue('c', [
    { client_id: 'c', amount_cents: 5000, currency: null, created_at: '2026-01-04T10:00:00Z', status: 'paid', refunded_cents: 5000 },
  ], [], [], ALL_READY);
  eq(v.ledger.total?.unlabelled, 1, 'the sale is still reported as a hole in the figure');
  eq(refundedLine(v), null, 'and its refund is not printed in a currency nobody chose');
}

// The ranking runs on the netted figure, which is the failure this was written
// for: a client who was given all their money back must not outrank one who
// kept theirs.
{
  const kept: RankedClient = { clientId: BEN, name: 'Ben', value: clientValue(BEN, purchases, renewals, receipts, ALL_READY) };
  const back: RankedClient = {
    clientId: 'ana-refunded', name: 'Ana',
    value: clientValue('ana-refunded', [{ client_id: 'ana-refunded', amount_cents: 240000, currency: 'AED', created_at: '2026-01-04T10:00:00Z', status: 'paid', refunded_cents: 240000 }], [], [], ALL_READY),
  };
  eq(rankByValue([back, kept], 'AED')[0].clientId, BEN,
    'a client refunded in full does not outrank one who kept their money');
}

ok(/gross/i.test(VALUE_IS_NET_OF_REFUNDS), 'the screen says which of its two figures is gross');
ok(/refund/i.test(VALUE_IS_NET_OF_REFUNDS), 'and that this one is not');

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

/* ── the WHOLE BOOK's empty state, where there is no person ─────────────── */
//
// app/(trainer)/money.tsx reached for the per-client sentence through
// `clientValue('', [], [], [], reads)`, so a coach nobody had paid yet read
// "Nothing has been recorded as paid to you by this person" under a heading
// about their clients, with no person anywhere on the screen. Every money table
// in this database is empty today, so that is the state nearly every coach
// meets first.

{
  const book = valueBookEmptyLine(ALL_READY);
  ok(!/this person|they pay you/i.test(book), 'the whole-book empty state names no person, because there is none on the screen');
  ok(/anybody/i.test(book), 'it is about the book');
  ok(/cash or by transfer/i.test(book), 'and still says the cash half has to be recorded to show up');
  ok(/this person/i.test(valueEmptyLine(clientValue('nobody', [], [], [], ALL_READY))),
    'while the per-client sentence is untouched — it is right where there IS a person');

  // The withheld sentences are deliberately NOT reworded: "the read failed"
  // says the same thing about a book as about a person, and there is one
  // wording of it.
  const brokenReads = { purchases: 'error', renewals: 'ready', receipts: 'ready' } as const;
  eq(valueBookEmptyLine(brokenReads), valueEmptyLine(clientValue('', [], [], [], brokenReads)),
    'a read that did not land says the same thing either way');
  ok(!/nothing has been recorded as paid/i.test(valueBookEmptyLine(brokenReads)),
    'and a failed read is never worded as nobody having paid — that is the sentence this whole file exists to refuse');
}

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
ok(unattributedLine(1, 'ready') != null, 'and reported');
eq(unattributedLine(0, 'ready'), null, 'a "0 unattributed" line under every screen is furniture, so there is none');
eq(unattributedLine(0, 'partial'), null, 'and none over a truncated read either — there is nothing to state a floor about');
ok(/not in any of the per-client figures/i.test(unattributedLine(2, 'ready') as string),
  'the sentence says the money is outside the breakdown above it');

// A COUNT OVER A PREFIX IS NOT A TOTAL.
//
// Under a truncated receipts read every per-client amount on the screen goes to
// a dash, and this line then said flatly "330 recorded payments are not
// attached to anybody's account" — the one figure left on the page still being
// stated confidently, counted over whatever fitted in one request.
{
  const whole = unattributedLine(330, 'ready') as string;
  ok(/^330 recorded payments are/.test(whole), 'a whole read states the count');
  ok(!/at least/i.test(whole), 'and does not hedge a number it actually has');

  for (const s of ['partial', 'error', 'loading'] as const) {
    const floor = unattributedLine(330, s) as string;
    ok(/at least 330/i.test(floor), `a ${s} read states it as a floor`);
    ok(/floor and not a count/i.test(floor), `and names it as one (${s})`);
    ok(/did not come back whole/i.test(floor), `and says why (${s})`);
  }
}

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

/* ── the count beside the withheld total ────────────────────────────────── */
//
// "Payments 4" was printed a finger's width from "Worth —", so the dash read as
// "we cannot price these four" rather than "we do not know there were four".

eq(paymentsCounted(ana), 4, 'a whole ledger may state how many payments there were');
eq(paymentsFloorLine(ana), null, 'and says nothing extra about it');

eq(paymentsCounted(noCash), null,
  'a ledger missing its cash half states NO count — four rows out of an unknown number is not four payments');
{
  const floor = paymentsFloorLine(noCash) ?? '';
  ok(/at least 4 payments/i.test(floor), 'the count survives as a floor, which is the useful half of it');
  ok(/floor and not a count/i.test(floor), 'and is named as one');
}

{
  // Nothing arrived at all. "At least 0 payments" is not a sentence.
  const empty = clientValue('nobody', [], [], [], { ...ALL_READY, receipts: 'error' });
  eq(paymentsCounted(empty), null, 'and no count is stated');
  eq(paymentsFloorLine(empty), null, 'and no floor either');
}

if (errors.length) {
  for (const e of errors) console.error('  ✗ ' + e);
  console.error(`clientValue: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('clientValue: ok (the cash half is not optional, currencies never merge, and an unread total is never "they paid you nothing")');
