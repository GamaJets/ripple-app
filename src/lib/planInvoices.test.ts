// The billing history a coach is shown, and the three claims it may not make:
// that a failed read is a clear account, that a short list is a whole history,
// and that two currencies add up.
import {
  INVOICES_ARE_NOT_TOTALLED, invoiceListNote, invoiceListState, invoiceNeedsMark,
  invoiceOpenable, invoiceStatusLine, type PlanInvoice,
} from './planInvoices';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
};

const inv = (o: Partial<PlanInvoice> = {}): PlanInvoice => ({
  id: 'in_1', amount_due: 4900, currency: 'gbp', status: 'paid',
  attempt_count: 1, hosted_invoice_url: 'https://invoice.stripe.com/i/1',
  created_at: '2026-08-14T09:00:00.000Z', ...o,
});

/* ── none, and could not read, are opposite facts ───────────────────────── */

eq(invoiceListState(null, 'loading'), 'loading', 'a read in flight says nothing about the ledger');
eq(invoiceListState(null, 'error'), 'unread', 'a failed read is unknown');
eq(invoiceListState([], 'error'), 'unread', 'an empty list under a failed read is still unknown');
eq(invoiceListState(null, 'ready'), 'unread', 'null rows are unknown whatever the status claims');
eq(invoiceListState([], 'ready'), 'none', 'only a whole read of nothing is nothing');
eq(invoiceListState([inv()], 'ready'), 'some', 'a whole read with rows is a whole history');
eq(invoiceListState([inv()], 'partial'), 'some-partial', 'a capped read is real rows and not all of them');
// A ceiling reached at zero rows is a broken read, not an empty ledger.
eq(invoiceListState([], 'partial'), 'unread', 'a truncated read that returned nothing is not "nothing billed"');

ok(!/billed to you yet/.test(invoiceListNote('unread') ?? ''),
  'the unread sentence never claims nothing has been billed');
ok(/not a clear account/.test(invoiceListNote('unread') ?? ''),
  'the unread sentence says what an empty space here is not');
ok(/billed to you yet/.test(invoiceListNote('none') ?? ''),
  'a genuinely empty ledger is allowed to say so');
ok(invoiceListNote('some') === null, 'a whole list needs no sentence over it');
ok(!/\d/.test(invoiceListNote('some-partial') ?? ''),
  'the truncated sentence states no number — a floor printed as a count is the defect');

/* ── no total, in the copy and in the module ────────────────────────────── */

ok(/not added up/.test(INVOICES_ARE_NOT_TOTALLED), 'the note says the amounts are not added up');
ok(/two currencies/i.test(INVOICES_ARE_NOT_TOTALLED), 'and says why');
// There is no sum function here to import, and that is the assertion.
ok(!Object.keys({ invoiceListNote, invoiceListState } as Record<string, unknown>).some((k) => /total|sum/i.test(k)),
  'this module exports nothing that adds invoices together');

/* ── what "paid" may be said about ──────────────────────────────────────── */

eq(invoiceStatusLine(inv()), 'Paid', 'a paid invoice says so');
eq(invoiceStatusLine(inv({ status: null })), 'Whether this was paid was not recorded',
  'a row with no status is unknown, never unpaid');
eq(invoiceStatusLine(inv({ status: '  ' })), 'Whether this was paid was not recorded',
  'and a blank one is the same absence');
eq(invoiceStatusLine(inv({ status: 'open', attempt_count: null })), 'Not paid yet',
  'an unreported attempt count prints no number — `?? 0` would have said "no attempts" for four tries');
eq(invoiceStatusLine(inv({ status: 'open', attempt_count: 1 })), 'Not paid yet',
  'one attempt is the ordinary case and is not worth a number');
eq(invoiceStatusLine(inv({ status: 'open', attempt_count: 4 })), 'Not paid. Your card has been tried 4 times',
  'a card tried four times is the thing the coach has to act on');
ok(/uncollectible/.test(invoiceStatusLine(inv({ status: 'uncollectible' }))), 'written off says so');
ok(/Stripe calls this/.test(invoiceStatusLine(inv({ status: 'weird_new_state' }))),
  'a status Stripe adds later is printed, not rounded to one we know');

ok(invoiceNeedsMark(inv({ status: 'open' })), 'an unpaid invoice is marked');
ok(invoiceNeedsMark(inv({ status: 'uncollectible' })), 'so is a written-off one');
ok(!invoiceNeedsMark(inv({ status: 'paid' })), 'a paid one is not');
ok(!invoiceNeedsMark(inv({ status: null })), 'and an unknown one is not marked as a problem either');

/* ── the receipt link ───────────────────────────────────────────────────── */

ok(invoiceOpenable(inv()), 'a stripe-hosted invoice opens');
ok(!invoiceOpenable(inv({ hosted_invoice_url: null })), 'a row with no url is not a tap');
ok(!invoiceOpenable(inv({ hosted_invoice_url: 'http://invoice.stripe.com/i/1' })),
  'and it is https or nothing');

/* ── the amount is somebody else's job, deliberately ────────────────────── */

// Nothing here formats money, and that is the assertion. The screen renders
// every amount through `money` in src/lib/billing.ts, which asks
// `currencyDecimals` in src/lib/coachMoney.ts — one function that knows about
// the sixteen zero-decimal currencies AND the five three-decimal ones, and
// answers null rather than 2 for anything else. A second opinion about minor
// units written here is exactly how ¥5,000 came to be printed as "JPY 50.00"
// the first time. (That formatter cannot be asserted from this file: billing.ts
// imports react-native and the supabase client, and neither runs under node.
// coachMoney.test.ts is where the arithmetic is pinned.)
ok(!/[£$€]/.test(JSON.stringify([
  invoiceListNote('none'), invoiceListNote('unread'), invoiceListNote('some-partial'),
  invoiceStatusLine(inv({ status: 'open', attempt_count: 4 })), INVOICES_ARE_NOT_TOTALLED,
])), 'no sentence in this module draws a currency symbol of its own');

if (errors.length) { errors.forEach((e) => console.error('FAIL', e)); process.exit(1); }
console.log('planInvoices: ok — a failed read is never a clear account, a short list is never a history, and nothing is totalled');
