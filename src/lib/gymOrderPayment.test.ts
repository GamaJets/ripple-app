// The ledger row an online gym sale leaves behind. Compile with tsc, run with node.
//
// The defect these assertions were written against: `supabase/functions/
// stripe-webhook` fulfilled a paid gym order by writing the ENTITLEMENT and
// closing the order, and never wrote `gym_payments`. Every money screen in the
// console counts that table and nothing else, so a gym selling online had the
// money in Stripe and a reconciliation that was short by all of it.
//
// No Stripe call is exercised anywhere in here, and none can be. What is
// asserted is the SHAPE of the row and the two refusals — no currency, and the
// closed month — because those are the decisions, and the webhook itself is a
// handler this repo has no way to run.
import {
  checkoutMethod, gymOrderPaymentRow, onlineNote, isClosedMonthRefusal, onlineOrderProblem,
  type LedgerMethod,
} from './gymOrderPayment';
import type { PaymentMethod } from './gymRecord';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the restatement still agrees with the ledger ──────────────────────────
 *
 * `LedgerMethod` is written out again in gymOrderPayment.ts because that file
 * may not import — it is reachable from an edge function, and a module an edge
 * function imports must be a leaf. These two lines are what makes the copy
 * safe: the day somebody adds a sixth method to `gym_payments`, or renames one,
 * this file stops compiling, and `npm test` runs tsc before it runs anything.
 */
const asLedger: LedgerMethod = 'direct_debit' as PaymentMethod;
const asRecord: PaymentMethod = 'direct_debit' as LedgerMethod;
ok(asLedger === asRecord, 'the two spellings of the five payment methods agree');

/* ── how the money arrived ─────────────────────────────────────────────────── */

eq(checkoutMethod(['card']), 'card', 'a card checkout is a card payment');
eq(checkoutMethod(['card', 'link']), 'card',
  'Link is a saved card, so the ordinary automatic-methods shape is still a card sale');
eq(checkoutMethod(['CARD', ' link ']), 'card', 'and the test is not upset by case or spacing');
eq(checkoutMethod(['sepa_debit']), 'direct_debit', 'a SEPA mandate is a direct debit');
eq(checkoutMethod(['bacs_debit']), 'direct_debit', 'and so is a Bacs one');
eq(checkoutMethod(['customer_balance']), 'transfer', 'Stripe bank transfer is a transfer');
eq(checkoutMethod(['card', 'sepa_debit']), 'other',
  'a genuine choice of instrument is not narrowed by guessing which one they took');
eq(checkoutMethod([]), 'other', 'and neither is a session that states nothing');
eq(checkoutMethod(null), 'other', 'nor a missing field');
eq(checkoutMethod(['ideal']), 'other', 'a method this ledger has no word for is other, not card');

/* ── the row ───────────────────────────────────────────────────────────────── */

const ORDER = { tenantId: 't1', memberId: 'm1', amountCents: 9000, currency: 'GBP' };
const SESSION = {
  amountTotal: 8500, currency: 'gbp', methodTypes: ['card'],
  sessionId: 'cs_test_1', paymentIntent: 'pi_test_1',
};
const AT = '2026-09-01T10:00:00.000Z';

const row = gymOrderPaymentRow({ orderId: 'o1', order: ORDER, session: SESSION, membershipId: 'ms1', takenAt: AT })!;
ok(row != null, 'an ordinary paid order produces a row');
eq(row.amount_cents, 8500, 'the amount is what STRIPE took, not what the order quoted');
eq(row.currency, 'GBP', 'and the currency is the session’s, upper-cased');
eq(row.method, 'card', 'the method comes off the session');
eq(row.taken_at, AT, 'the money is filed on the day Stripe says it moved, not the day the retry ran');
eq(row.gym_order_id, 'o1', 'the order is stamped on the row — this is the idempotency key');
eq(row.membership_id, 'ms1',
  'an online membership sale is attributed to the membership it bought, so /accounting never has to guess at it');
eq(row.kind, 'payment', 'a sale is a payment, and a correction is only ever made by a person');
eq(row.recorded_by, null, 'nobody at the desk handled this and the row does not claim anybody did');
eq(row.tenant_id, 't1', 'the gym comes from the order');
eq(row.member_id, 'm1', 'and so does the member');

const pass = gymOrderPaymentRow({
  orderId: 'o2', order: ORDER, session: SESSION, membershipId: null, takenAt: AT,
})!;
eq(pass.membership_id, null, 'a pass sale bought no membership and says so');

const quoted = gymOrderPaymentRow({
  orderId: 'o3', order: ORDER, session: { ...SESSION, amountTotal: null, currency: null }, membershipId: null, takenAt: AT,
})!;
eq(quoted.amount_cents, 9000, 'a session stating no total falls back to what the member was quoted');
eq(quoted.currency, 'GBP', 'and to the currency the order was priced in');

const free = gymOrderPaymentRow({
  orderId: 'o4', order: ORDER, session: { ...SESSION, amountTotal: 0 }, membershipId: null, takenAt: AT,
})!;
eq(free.amount_cents, 0,
  'a fully discounted sale is zero and is still recorded — the transaction happened, and part 180 keeps a zero payment legal');

/* ── the two refusals ──────────────────────────────────────────────────────── */

eq(gymOrderPaymentRow({
  orderId: 'o5',
  order: { ...ORDER, currency: null },
  session: { ...SESSION, currency: null },
  membershipId: null, takenAt: AT,
}), null, 'money nobody has stated a currency for is not recorded in a guessed one');

eq(gymOrderPaymentRow({
  orderId: 'o6', order: { ...ORDER, amountCents: null },
  session: { ...SESSION, amountTotal: null }, membershipId: null, takenAt: AT,
}), null, 'and an amount stated nowhere is not a payment of zero');

eq(gymOrderPaymentRow({
  orderId: 'o7', order: ORDER, session: { ...SESSION, amountTotal: -500 }, membershipId: null, takenAt: AT,
}), null, 'a negative row in this table is a correction, so a negative sale is refused rather than filed as one');

/* ── the note ──────────────────────────────────────────────────────────────── */

ok(row.note.includes('pi_test_1'),
  'the note carries the payment intent, which is the string that finds the charge in Stripe');
eq(onlineNote({ sessionId: 'cs_1', paymentIntent: null }), 'Paid online through Stripe. cs_1',
  'and falls back to the session when there is no intent');
eq(onlineNote({ sessionId: '', paymentIntent: null }), 'Paid online through Stripe.',
  'a note with no reference on it still says where the money came from');

/* ── which failures are worth retrying ─────────────────────────────────────── */

ok(isClosedMonthRefusal({ code: 'P0001', message: 'Nothing can be written into 2026-08 — this gym has closed that month.' }),
  'the closed-month lock is recognised by its errcode');
ok(isClosedMonthRefusal({ code: null, message: 'Nothing can be written into 2026-08 — this gym has closed that month.' }),
  'and by its message, for a client that reports one and not the other');
ok(!isClosedMonthRefusal({ code: '23505', message: 'duplicate key value violates unique constraint' }),
  'a unique-index collision is not the lock');
ok(!isClosedMonthRefusal(null), 'and no error is not a refusal');

/* ── the exception an owner has to be shown ───────────────────────────────── */

eq(onlineOrderProblem({ status: 'paid', inLedger: true, failureNote: null }), null,
  'a sale that granted what it should and reached the ledger is not an exception');
ok((onlineOrderProblem({ status: 'paid', inLedger: false, failureNote: null }) ?? '').includes('not in the payment record'),
  'a paid sale with no ledger row is money this page would otherwise be short by, silently');
ok((onlineOrderProblem({ status: 'failed', inLedger: false, failureNote: 'The membership could not be recorded.' }) ?? '')
  .includes('The membership could not be recorded.'),
  'a failed order carries the webhook’s own reason, verbatim');
ok((onlineOrderProblem({ status: 'failed', inLedger: false, failureNote: null }) ?? '').includes('not recorded'),
  'and a failed order with no reason on it says that rather than saying nothing');
ok(onlineOrderProblem({ status: 'failed', inLedger: true, failureNote: 'x' }) != null,
  'a failed order is an exception whether or not money reached the ledger — nobody got what they paid for');

if (errors.length) {
  console.error(`gymOrderPayment: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('gymOrderPayment ok');
