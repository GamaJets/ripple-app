"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const clientValue_1 = require("./clientValue");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const ANA = 'client-ana';
const BEN = 'client-ben';
const ALL_READY = { purchases: 'ready', renewals: 'ready', receipts: 'ready' };
const purchases = [
    { client_id: ANA, amount_cents: 60000, currency: 'AED', created_at: '2025-03-01T10:00:00Z', status: 'paid' },
    { client_id: ANA, amount_cents: 45000, currency: 'AED', created_at: '2025-09-01T10:00:00Z', status: 'paid' },
    // Not money. A pending checkout and a refunded sale are not income.
    { client_id: ANA, amount_cents: 99900, currency: 'AED', created_at: '2025-10-01T10:00:00Z', status: 'pending' },
    { client_id: ANA, amount_cents: 20000, currency: 'AED', created_at: '2025-11-01T10:00:00Z', status: 'refunded' },
    { client_id: BEN, amount_cents: 30000, currency: 'AED', created_at: '2026-01-05T10:00:00Z', status: 'paid' },
];
const renewals = [
    { client_id: ANA, amount_cents: 25000, currency: 'AED', paid_at: '2025-12-01T10:00:00Z', created_at: '2025-12-03T10:00:00Z' },
];
const receipts = [
    { clientId: ANA, amountCents: 120000, currency: 'AED', receivedOn: '2026-02-14' },
    // The cash a coach takes from somebody they bill by hand, with no account
    // behind them. Real income, attachable to nobody.
    { clientId: null, amountCents: 40000, currency: 'AED', receivedOn: '2026-02-20' },
];
/* ── only paid rows are money ──────────────────────────────────────────── */
eq((0, clientValue_1.paidOnly)(purchases).length, 3, 'pending and refunded sales are not income');
// A denylist (`status !== 'refunded'`) would count the next status Stripe adds
// as revenue by default. This is an allowlist of exactly one word.
eq((0, clientValue_1.paidOnly)([{ status: null }]).length, 0, 'a row with no status at all is not counted as a payment');
eq((0, clientValue_1.paidOnly)([{ status: 'PAID' }]).length, 1, 'and the check is case-insensitive, because Stripe is not this repo');
/* ── the three sources, added ──────────────────────────────────────────── */
const ana = (0, clientValue_1.clientValue)(ANA, purchases, renewals, receipts, ALL_READY);
eq(ana.payments, 4, 'two sales, one renewal and one recorded payment');
const total = ana.ledger.total;
ok(total != null, 'with every read whole there is a total');
eq(total?.pots.length, 1, 'one currency, one pot');
// 600 + 450 + 250 + 1200 = 2500.00 AED. The cash is 1200 of it — nearly half —
// which is the whole point of the assertion below.
eq(total?.pots[0].minorUnits, 250000, 'the sales, the renewal AND the cash');
eq(total?.pots[0].currency, 'AED', 'in the currency the money moved in');
/* ── THE ONE THAT MATTERS: the cash half is not optional ───────────────── */
const noCash = (0, clientValue_1.clientValue)(ANA, purchases, renewals, receipts, { ...ALL_READY, receipts: 'error' });
eq(noCash.ledger.total, null, 'a receipts read that failed withholds the WHOLE total — a figure short by the cash is not a smaller figure, it is a different one');
ok(/cash and transfers/i.test(noCash.ledger.reason ?? ''), 'and the coach is told which half is missing, in the words they use for it');
ok(noCash.ledger.missing.includes('cash and transfers'), 'named in the missing list too');
// The same rule for the other two, so nobody can argue Stripe is the
// trustworthy half.
eq((0, clientValue_1.clientValue)(ANA, purchases, renewals, receipts, { ...ALL_READY, purchases: 'error' }).ledger.total, null, 'a failed sales read withholds it as well');
eq((0, clientValue_1.clientValue)(ANA, purchases, renewals, receipts, { ...ALL_READY, renewals: 'partial' }).ledger.total, null, 'and a truncated renewals read — a subtotal of somebody’s income printed as a total is a plausible number with nothing to doubt');
/* ── currencies never merge ────────────────────────────────────────────── */
const mixed = [
    { client_id: ANA, amount_cents: 60000, currency: 'AED', created_at: '2025-03-01T10:00:00Z', status: 'paid' },
    { client_id: ANA, amount_cents: 9000, currency: 'GBP', created_at: '2025-08-01T10:00:00Z', status: 'paid' },
    // An amount with no unit. Counted, never summed, never dropped.
    { client_id: ANA, amount_cents: 5000, currency: null, created_at: '2025-09-01T10:00:00Z', status: 'paid' },
    // No amount at all.
    { client_id: ANA, amount_cents: null, currency: 'AED', created_at: '2025-10-01T10:00:00Z', status: 'paid' },
];
const two = (0, clientValue_1.clientValue)(ANA, mixed, [], [], ALL_READY);
eq(two.ledger.total?.pots.length, 2, 'AED 600 and GBP 90 are two pots and never 690 of anything');
eq(two.ledger.total?.unlabelled, 1, 'an amount with no currency is counted as a hole in the total');
eq(two.ledger.total?.unpriced, 1, 'and so is a row with no amount');
const potsSum = (two.ledger.total?.pots ?? []).reduce((a, p) => a + p.minorUnits, 0);
eq(potsSum, 69000, 'the unlabelled amount is in neither pot — it was not quietly added to whichever came first');
/* ── how long they have been paying ────────────────────────────────────── */
eq(new Date(ana.firstAt).toISOString(), '2025-03-01T10:00:00.000Z', 'the first payment dates the relationship');
eq(new Date(ana.lastAt).toISOString(), new Date('2026-02-14').toISOString(), 'and a recorded payment is dated by the day the coach says the money arrived');
ok(/across/.test((0, clientValue_1.valueSpanLine)(ana, new Date('2026-03-01T00:00:00Z')) ?? ''), 'the span is said in words');
ok(/year/.test((0, clientValue_1.valueSpanLine)(ana, new Date('2026-06-01T00:00:00Z')) ?? ''), 'and reads as years once it is years');
eq((0, clientValue_1.valueSpanLine)((0, clientValue_1.clientValue)('nobody', [], [], [], ALL_READY), new Date()), null, 'no payments, no span');
/* ── a renewal Stripe stated no date for ───────────────────────────────── */
const undated = (0, clientValue_1.clientValue)(ANA, [], [{ client_id: ANA, amount_cents: 25000, currency: 'AED', paid_at: null, created_at: '2025-12-03T10:00:00Z' }], [], ALL_READY);
eq(undated.ledger.total?.pots[0].minorUnits, 25000, 'a renewal with no paid_at is still money');
ok(undated.firstAt != null, 'and still dates the relationship, from the row it was written on');
/* ── an empty answer means what the read says it means ─────────────────── */
const none = (0, clientValue_1.clientValue)('nobody-at-all', purchases, renewals, receipts, ALL_READY);
eq(none.payments, 0, 'somebody who has paid nothing has no payments');
ok(/If they pay you in cash/i.test((0, clientValue_1.valueEmptyLine)(none)), 'and is told so, with the way to record what did not go through Stripe');
const unread = (0, clientValue_1.clientValue)(ANA, [], [], [], { purchases: 'error', renewals: 'error', receipts: 'error' });
ok(!/nothing has been recorded as paid/i.test((0, clientValue_1.valueEmptyLine)(unread)), 'a failed read is NEVER worded as "they have paid you nothing" — that is the sentence that decides how hard a coach fights to keep somebody');
ok(/could not be read/i.test((0, clientValue_1.valueEmptyLine)(unread)), 'it says the read failed');
/* ── the ranking is inside one currency ────────────────────────────────── */
const rows = [
    { clientId: ANA, name: 'Ana', value: (0, clientValue_1.clientValue)(ANA, purchases, renewals, receipts, ALL_READY) },
    { clientId: BEN, name: 'Ben', value: (0, clientValue_1.clientValue)(BEN, purchases, renewals, receipts, ALL_READY) },
];
eq((0, clientValue_1.rankByValue)(rows, 'AED')[0].clientId, ANA, 'the biggest AED figure leads');
eq((0, clientValue_1.rankByValue)(rows, 'AED').length, 2, 'and nobody is dropped from a list headed "what your clients have paid you"');
// A client whose money is in a currency the list is not ranked by stays in the
// list. Dropping them would read as a client who has paid nothing.
const gbpOnly = {
    clientId: 'cara', name: 'Cara',
    value: (0, clientValue_1.clientValue)('cara', [{ client_id: 'cara', amount_cents: 9000, currency: 'GBP', created_at: '2026-01-01T00:00:00Z', status: 'paid' }], [], [], ALL_READY),
};
eq((0, clientValue_1.rankByValue)([...rows, gbpOnly], 'AED').length, 3, 'a client paid in another currency is still listed');
eq((0, clientValue_1.rankByValue)([...rows, gbpOnly], 'AED')[2].clientId, 'cara', 'at the bottom, rather than ranked on a number that is not comparable');
eq((0, clientValue_1.currenciesIn)([...rows, gbpOnly]).length, 2, 'and the screen can say there are two currencies');
eq((0, clientValue_1.currenciesIn)([...rows, gbpOnly])[0], 'AED', 'led by the biggest');
/* ── the cash that belongs to nobody ───────────────────────────────────── */
const orphan = (0, clientValue_1.unattributedReceipts)(receipts);
eq(orphan.count, 1, 'a recorded payment with no client account is counted');
eq(orphan.taken.pots[0].minorUnits, 40000, 'and its amount is kept, because it is real income');
ok((0, clientValue_1.unattributedLine)(1) != null, 'and reported');
eq((0, clientValue_1.unattributedLine)(0), null, 'a "0 unattributed" line under every screen is furniture, so there is none');
ok(/not in any of the per-client figures/i.test((0, clientValue_1.unattributedLine)(2)), 'the sentence says the money is outside the breakdown above it');
/* ── the status the screen must not compose itself ─────────────────────── */
eq((0, clientValue_1.valueStatus)(ALL_READY), 'ready', 'three whole reads are a whole answer');
eq((0, clientValue_1.valueStatus)({ ...ALL_READY, receipts: 'error' }), 'error', 'and the cash half failing is the whole answer failing');
eq((0, clientValue_1.valueStatus)({ purchases: 'partial', renewals: 'loading', receipts: 'ready' }), 'loading', 'loading outranks partial, because a part still in flight is not yet known to be anything');
/* ── the sentences ─────────────────────────────────────────────────────── */
ok(/forecast|projected/i.test(clientValue_1.VALUE_IS_PAST), '"lifetime value" means a projection everywhere else, so this says plainly that it is not one');
ok(/cash|transfer/i.test(clientValue_1.VALUE_NEEDS_YOUR_RECORDS), 'and that the cash half depends on the coach recording it');
ok(/floor/i.test(clientValue_1.VALUE_NEEDS_YOUR_RECORDS), 'and that until they do, every figure is a floor');
/* ── the count beside the withheld total ────────────────────────────────── */
//
// "Payments 4" was printed a finger's width from "Worth —", so the dash read as
// "we cannot price these four" rather than "we do not know there were four".
eq((0, clientValue_1.paymentsCounted)(ana), 4, 'a whole ledger may state how many payments there were');
eq((0, clientValue_1.paymentsFloorLine)(ana), null, 'and says nothing extra about it');
eq((0, clientValue_1.paymentsCounted)(noCash), null, 'a ledger missing its cash half states NO count — four rows out of an unknown number is not four payments');
{
    const floor = (0, clientValue_1.paymentsFloorLine)(noCash) ?? '';
    ok(/at least 4 payments/i.test(floor), 'the count survives as a floor, which is the useful half of it');
    ok(/floor and not a count/i.test(floor), 'and is named as one');
}
{
    // Nothing arrived at all. "At least 0 payments" is not a sentence.
    const empty = (0, clientValue_1.clientValue)('nobody', [], [], [], { ...ALL_READY, receipts: 'error' });
    eq((0, clientValue_1.paymentsCounted)(empty), null, 'and no count is stated');
    eq((0, clientValue_1.paymentsFloorLine)(empty), null, 'and no floor either');
}
if (errors.length) {
    for (const e of errors)
        console.error('  ✗ ' + e);
    console.error(`clientValue: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    process.exit(1);
}
console.log('clientValue: ok (the cash half is not optional, currencies never merge, and an unread total is never "they paid you nothing")');
