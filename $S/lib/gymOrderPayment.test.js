"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const gymOrderPayment_1 = require("./gymOrderPayment");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── the restatement still agrees with the ledger ──────────────────────────
 *
 * `LedgerMethod` is written out again in gymOrderPayment.ts because that file
 * may not import — it is reachable from an edge function, and a module an edge
 * function imports must be a leaf. These two lines are what makes the copy
 * safe: the day somebody adds a sixth method to `gym_payments`, or renames one,
 * this file stops compiling, and `npm test` runs tsc before it runs anything.
 */
const asLedger = 'direct_debit';
const asRecord = 'direct_debit';
ok(asLedger === asRecord, 'the two spellings of the five payment methods agree');
/* ── how the money arrived ─────────────────────────────────────────────────── */
eq((0, gymOrderPayment_1.checkoutMethod)(['card']), 'card', 'a card checkout is a card payment');
eq((0, gymOrderPayment_1.checkoutMethod)(['card', 'link']), 'card', 'Link is a saved card, so the ordinary automatic-methods shape is still a card sale');
eq((0, gymOrderPayment_1.checkoutMethod)(['CARD', ' link ']), 'card', 'and the test is not upset by case or spacing');
eq((0, gymOrderPayment_1.checkoutMethod)(['sepa_debit']), 'direct_debit', 'a SEPA mandate is a direct debit');
eq((0, gymOrderPayment_1.checkoutMethod)(['bacs_debit']), 'direct_debit', 'and so is a Bacs one');
eq((0, gymOrderPayment_1.checkoutMethod)(['customer_balance']), 'transfer', 'Stripe bank transfer is a transfer');
eq((0, gymOrderPayment_1.checkoutMethod)(['card', 'sepa_debit']), 'other', 'a genuine choice of instrument is not narrowed by guessing which one they took');
eq((0, gymOrderPayment_1.checkoutMethod)([]), 'other', 'and neither is a session that states nothing');
eq((0, gymOrderPayment_1.checkoutMethod)(null), 'other', 'nor a missing field');
eq((0, gymOrderPayment_1.checkoutMethod)(['ideal']), 'other', 'a method this ledger has no word for is other, not card');
/* ── the row ───────────────────────────────────────────────────────────────── */
const ORDER = { tenantId: 't1', memberId: 'm1', amountCents: 9000, currency: 'GBP' };
const SESSION = {
    amountTotal: 8500, currency: 'gbp', methodTypes: ['card'],
    sessionId: 'cs_test_1', paymentIntent: 'pi_test_1',
};
const AT = '2026-09-01T10:00:00.000Z';
const row = (0, gymOrderPayment_1.gymOrderPaymentRow)({ orderId: 'o1', order: ORDER, session: SESSION, membershipId: 'ms1', takenAt: AT });
ok(row != null, 'an ordinary paid order produces a row');
eq(row.amount_cents, 8500, 'the amount is what STRIPE took, not what the order quoted');
eq(row.currency, 'GBP', 'and the currency is the session’s, upper-cased');
eq(row.method, 'card', 'the method comes off the session');
eq(row.taken_at, AT, 'the money is filed on the day Stripe says it moved, not the day the retry ran');
eq(row.gym_order_id, 'o1', 'the order is stamped on the row — this is the idempotency key');
eq(row.membership_id, 'ms1', 'an online membership sale is attributed to the membership it bought, so /accounting never has to guess at it');
eq(row.kind, 'payment', 'a sale is a payment, and a correction is only ever made by a person');
eq(row.recorded_by, null, 'nobody at the desk handled this and the row does not claim anybody did');
eq(row.tenant_id, 't1', 'the gym comes from the order');
eq(row.member_id, 'm1', 'and so does the member');
const pass = (0, gymOrderPayment_1.gymOrderPaymentRow)({
    orderId: 'o2', order: ORDER, session: SESSION, membershipId: null, takenAt: AT,
});
eq(pass.membership_id, null, 'a pass sale bought no membership and says so');
const quoted = (0, gymOrderPayment_1.gymOrderPaymentRow)({
    orderId: 'o3', order: ORDER, session: { ...SESSION, amountTotal: null, currency: null }, membershipId: null, takenAt: AT,
});
eq(quoted.amount_cents, 9000, 'a session stating no total falls back to what the member was quoted');
eq(quoted.currency, 'GBP', 'and to the currency the order was priced in');
const free = (0, gymOrderPayment_1.gymOrderPaymentRow)({
    orderId: 'o4', order: ORDER, session: { ...SESSION, amountTotal: 0 }, membershipId: null, takenAt: AT,
});
eq(free.amount_cents, 0, 'a fully discounted sale is zero and is still recorded — the transaction happened, and part 180 keeps a zero payment legal');
/* ── the two refusals ──────────────────────────────────────────────────────── */
eq((0, gymOrderPayment_1.gymOrderPaymentRow)({
    orderId: 'o5',
    order: { ...ORDER, currency: null },
    session: { ...SESSION, currency: null },
    membershipId: null, takenAt: AT,
}), null, 'money nobody has stated a currency for is not recorded in a guessed one');
eq((0, gymOrderPayment_1.gymOrderPaymentRow)({
    orderId: 'o6', order: { ...ORDER, amountCents: null },
    session: { ...SESSION, amountTotal: null }, membershipId: null, takenAt: AT,
}), null, 'and an amount stated nowhere is not a payment of zero');
eq((0, gymOrderPayment_1.gymOrderPaymentRow)({
    orderId: 'o7', order: ORDER, session: { ...SESSION, amountTotal: -500 }, membershipId: null, takenAt: AT,
}), null, 'a negative row in this table is a correction, so a negative sale is refused rather than filed as one');
/* ── the note ──────────────────────────────────────────────────────────────── */
ok(row.note.includes('pi_test_1'), 'the note carries the payment intent, which is the string that finds the charge in Stripe');
eq((0, gymOrderPayment_1.onlineNote)({ sessionId: 'cs_1', paymentIntent: null }), 'Paid online through Stripe. cs_1', 'and falls back to the session when there is no intent');
eq((0, gymOrderPayment_1.onlineNote)({ sessionId: '', paymentIntent: null }), 'Paid online through Stripe.', 'a note with no reference on it still says where the money came from');
/* ── which failures are worth retrying ─────────────────────────────────────── */
ok((0, gymOrderPayment_1.isClosedMonthRefusal)({ code: 'P0001', message: 'Nothing can be written into 2026-08 — this gym has closed that month.' }), 'the closed-month lock is recognised by its errcode');
ok((0, gymOrderPayment_1.isClosedMonthRefusal)({ code: null, message: 'Nothing can be written into 2026-08 — this gym has closed that month.' }), 'and by its message, for a client that reports one and not the other');
ok(!(0, gymOrderPayment_1.isClosedMonthRefusal)({ code: '23505', message: 'duplicate key value violates unique constraint' }), 'a unique-index collision is not the lock');
ok(!(0, gymOrderPayment_1.isClosedMonthRefusal)(null), 'and no error is not a refusal');
/* ── the exception an owner has to be shown ───────────────────────────────── */
eq((0, gymOrderPayment_1.onlineOrderProblem)({ status: 'paid', inLedger: true, failureNote: null }), null, 'a sale that granted what it should and reached the ledger is not an exception');
ok(((0, gymOrderPayment_1.onlineOrderProblem)({ status: 'paid', inLedger: false, failureNote: null }) ?? '').includes('not in the payment record'), 'a paid sale with no ledger row is money this page would otherwise be short by, silently');
ok(((0, gymOrderPayment_1.onlineOrderProblem)({ status: 'failed', inLedger: false, failureNote: 'The membership could not be recorded.' }) ?? '')
    .includes('The membership could not be recorded.'), 'a failed order carries the webhook’s own reason, verbatim');
ok(((0, gymOrderPayment_1.onlineOrderProblem)({ status: 'failed', inLedger: false, failureNote: null }) ?? '').includes('not recorded'), 'and a failed order with no reason on it says that rather than saying nothing');
ok((0, gymOrderPayment_1.onlineOrderProblem)({ status: 'failed', inLedger: true, failureNote: 'x' }) != null, 'a failed order is an exception whether or not money reached the ledger — nobody got what they paid for');
/* ══════════════════════════════════════════════════════════════════════════
 * MONEY GOING BACK OUT, WHEN THE GYM SENT IT BACK
 *
 * The same defect as everything above, pointed the other way. `supabase/
 * functions/stripe-webhook` resolved a `charge.refunded` event against
 * `client_subscription_payments` and `client_purchases` and nothing else, so an
 * owner refunding a membership from their own Stripe dashboard produced a log
 * line reading "REFUND WITH NO SALE TO MIRROR IT ON" while `gym_payments` went
 * on holding the whole original amount — and /money, /revenue, /accounting and
 * /close all went on counting it.
 *
 * No Stripe call is exercised here and none can be. What is asserted is the two
 * decisions that make this safe — IDEMPOTENCE, so a retried delivery cannot
 * take a gym's money off twice, and the PARTIAL refund, so what is reversed is
 * what was actually sent back — the refusals, because a refusal that goes
 * unrecorded is how the original defect was invisible, and the net-figure
 * invariant over both, replayed and reordered.
 * ══════════════════════════════════════════════════════════════════════════ */
/** A sale of 90.00 in some gym's money, as `gym_payments` holds it. */
const SALE = {
    paymentId: 'pay_1',
    tenantId: 't1',
    memberId: 'm1',
    membershipId: 'ms1',
    amountCents: 9000,
    currency: 'GBP',
    method: 'card',
};
// `AT` — the event's own instant — is the one declared for the sale half above.
/** 2026-09-14T00:00:00Z, as Stripe states a refund date: whole seconds. */
const REFUNDED_ON = 1789344000;
const full = { id: 're_1', amountCents: 9000, currency: 'gbp', createdSeconds: REFUNDED_ON, status: 'succeeded' };
const part = { id: 're_2', amountCents: 2000, currency: 'gbp', createdSeconds: REFUNDED_ON, status: 'succeeded' };
/* ── which refunds are money that has actually moved ───────────────────────── */
ok((0, gymOrderPayment_1.refundHasSettled)({ status: 'succeeded' }), 'a settled refund is money that has gone back');
ok(!(0, gymOrderPayment_1.refundHasSettled)({ status: 'pending' }), 'a pending refund has not, and mirroring it would understate the gym');
ok(!(0, gymOrderPayment_1.refundHasSettled)({ status: 'failed' }), 'a failed refund never happened');
ok(!(0, gymOrderPayment_1.refundHasSettled)({ status: 'canceled' }), 'nor did a cancelled one');
ok((0, gymOrderPayment_1.refundHasSettled)({ status: null }), 'a refund stating no status at all is taken as settled rather than silently skipped');
ok((0, gymOrderPayment_1.refundHasSettled)({ status: ' SUCCEEDED ' }), 'and the test is not upset by case or spacing');
/* ── IDEMPOTENCE ───────────────────────────────────────────────────────────
 *
 * The argument in full. A Stripe webhook is retried, and it is retried
 * precisely when the handler failed part way through. A refund mirrored twice
 * takes the money off the gym's takings a second time — and unlike a doubled
 * SALE, which an owner notices because it is money that never arrived, a
 * doubled refund only makes the month look worse, which nobody audits.
 *
 * It cannot be keyed on the amount: a partial refund of 2000 followed by a
 * second partial refund of 2000 on the same charge is two legitimate rows
 * identical in every column this table has. So it is keyed on IDENTITY, and the
 * identity of a refund is Stripe's refund id — the same shape part 480 gave
 * `gym_payments.gym_order_id` and part 281 gave the entitlement.
 *
 * This filter is the cheap guard. The UNIQUE index in supabase/parts/800 is the
 * one that actually holds, because two deliveries racing both read an empty
 * list and both try.
 */
eq((0, gymOrderPayment_1.refundsToMirror)([full, part], []).length, 2, 'a charge with two refunds and nothing recorded mirrors both');
eq((0, gymOrderPayment_1.refundsToMirror)([full, part], ['re_1']).length, 1, 'a refund already in the ledger is not written again');
eq((0, gymOrderPayment_1.refundsToMirror)([full, part], ['re_1'])[0].id, 're_2', 'and it is the OTHER one that is left to write');
eq((0, gymOrderPayment_1.refundsToMirror)([full, part], ['re_1', 're_2']).length, 0, 'a redelivery of an event whose refunds are all recorded writes nothing at all');
eq((0, gymOrderPayment_1.refundsToMirror)([full, full], []).length, 1, 'the same refund handed twice in one delivery is collapsed — two inserts of one id would collide with each other, which is a different failure from the one the index is there to raise');
eq((0, gymOrderPayment_1.refundsToMirror)([full, { ...part, status: 'pending' }], []).length, 1, 'a pending refund is not mirrored, so a retry after it settles is what records it');
eq((0, gymOrderPayment_1.refundsToMirror)([{ ...full, id: '  ' }], []).length, 0, 'a refund with no id cannot be recorded once and only once, so it is not recorded at all here');
eq((0, gymOrderPayment_1.refundsToMirror)(null, null).length, 0, 'and an event carrying no refunds asks for nothing');
/* ── PARTIAL REFUNDS ───────────────────────────────────────────────────────
 *
 * The argument in full. `charge.refunded` fires for a partial refund exactly as
 * it does for a full one and nothing in the event says which it was. A gym
 * refunding one month of a twelve-month membership to a member leaving mid-term
 * is the ordinary case.
 *
 * So the amount mirrored is `refund.amount` and nothing else:
 *
 *   · NOT the sale's amount. Reversing the whole sale for a partial refund
 *     would take eleven months of somebody's money off the gym's takings, and
 *     because a reversal nets silently into every SUM in the console it would
 *     do it without anything looking wrong.
 *   · NOT `charge.amount_refunded`, which is the running total across every
 *     refund. Rows accumulate here, so a second partial carrying the running
 *     total would reverse the first one twice — two 2000 refunds would take
 *     6000 off the ledger.
 *   · NOT recomputed. Stripe's integer of minor units, negated, in the sale's
 *     own currency. Nothing divides, multiplies or prorates.
 */
const partial = (0, gymOrderPayment_1.gymRefundRow)({ sale: SALE, refund: part, fallbackAtISO: AT }).row;
ok(!!partial, 'a partial refund produces a row');
eq(partial.amount_cents, -2000, 'a partial refund reverses exactly what was refunded, not the sale');
eq(partial.currency, 'GBP', 'in the sale’s own money, always — you cannot refund pounds against dirhams');
eq(partial.reverses_payment_id, 'pay_1', 'naming what it undoes, which part 180’s CHECK requires');
eq(partial.kind, 'refund', 'as a refund and not a correction — an accountant reads the two differently');
eq(partial.stripe_refund_id, 're_2', 'carrying the identity that makes a retry safe');
eq(partial.method, 'card', 'and the method carried verbatim off the payment, never chosen here');
eq(partial.recorded_by, null, 'nobody at the desk handed this back');
eq(partial.membership_id, 'ms1', 'attributed to the same membership the sale was');
eq(partial.taken_at, '2026-09-14T00:00:00.000Z', 'dated when the refund was MADE — part 180: a refund handed back in September belongs in September, not backdated into a filed August');
const whole = (0, gymOrderPayment_1.gymRefundRow)({ sale: SALE, refund: full, fallbackAtISO: AT }).row;
eq(whole.amount_cents, -9000, 'a full refund reverses the whole sale, because that is what was refunded');
const twoPartials = [
    (0, gymOrderPayment_1.gymRefundRow)({ sale: SALE, refund: part, fallbackAtISO: AT }).row,
    (0, gymOrderPayment_1.gymRefundRow)({ sale: SALE, refund: { ...part, id: 're_3' }, fallbackAtISO: AT }).row,
];
eq(twoPartials[0].amount_cents + twoPartials[1].amount_cents, -4000, 'two partial refunds of 2000 net to 4000 off the ledger and not to 6000 — this is what keying on the refund rather than assigning the running total buys');
/* ── when a reversal cannot honestly be written ────────────────────────────── */
const wrongMoney = (0, gymOrderPayment_1.gymRefundRow)({ sale: SALE, refund: { ...part, currency: 'aed' }, fallbackAtISO: AT });
eq(wrongMoney.row, null, 'a refund in a currency the payment was not taken in is refused, never netted');
ok((wrongMoney.refusal ?? '').includes('AED') && (wrongMoney.refusal ?? '').includes('GBP'), 'and the refusal names both currencies, because it is read by an owner and not by a log');
eq((0, gymOrderPayment_1.gymRefundRow)({ sale: SALE, refund: { ...part, amountCents: 0 }, fallbackAtISO: AT }).row, null, 'a zero reversal reverses nothing — legal on the sale side for a discounted joining fee, refused here by part 180’s CHECK');
eq((0, gymOrderPayment_1.gymRefundRow)({ sale: SALE, refund: { ...part, amountCents: null }, fallbackAtISO: AT }).row, null, 'and a refund stating no amount is not guessed at');
eq((0, gymOrderPayment_1.gymRefundRow)({ sale: { ...SALE, currency: '' }, refund: part, fallbackAtISO: AT }).row, null, 'a payment with no currency on it cannot be reversed in a currency invented here');
ok((0, gymOrderPayment_1.gymRefundRow)({ sale: SALE, refund: { ...part, currency: null }, fallbackAtISO: AT }).row != null, 'but a refund that simply states no currency takes the payment’s, which is the only money it could have been in');
ok(((0, gymOrderPayment_1.gymRefundRow)({ sale: SALE, refund: { ...part, id: '' }, fallbackAtISO: AT }).refusal ?? '').length > 0, 'a refund with no id is refused with a reason rather than written unkeyed');
eq((0, gymOrderPayment_1.refundTakenAt)({ createdSeconds: null }, AT), AT, 'a refund stating no date falls back to the event’s instant, not to now()');
eq((0, gymOrderPayment_1.refundTakenAt)({ createdSeconds: 0 }, AT), AT, 'and neither does the epoch count as a date');
ok((0, gymOrderPayment_1.refundNote)('re_9').includes('re_9'), 'the note carries the string that finds this refund in the Stripe dashboard, which is the only useful thing it can say');
ok((0, gymOrderPayment_1.refundNote)('').length > 0, 'and says something even with nothing to point at');
/* ── more back than was ever taken ─────────────────────────────────────────── */
eq((0, gymOrderPayment_1.overReversedBy)(9000, 0, 2000), 0, 'an ordinary partial refund is not an over-reversal');
eq((0, gymOrderPayment_1.overReversedBy)(9000, 7000, 2000), 0, 'nor is the instalment that finishes one off exactly');
eq((0, gymOrderPayment_1.overReversedBy)(9000, 7000, 2500), 500, 'past the sale, the excess is reported in minor units');
eq((0, gymOrderPayment_1.overReversedBy)(9000, -7000, 2500), 500, 'and reversals stored negative are read as the amounts they are');
eq((0, gymOrderPayment_1.overReversedBy)(NaN, 0, 2000), 2000, 'a sale with no readable amount treats the whole refund as unaccounted for');
/* ── what goes on the order, and why it is not the ledger ──────────────────── */
const state = (0, gymOrderPayment_1.refundStateForOrder)({ amountRefundedCents: 4000, currency: 'gbp', atISO: AT });
eq(state.refundedCents, 4000, 'Stripe’s running total is assigned, never added — assignment is what makes a redelivery harmless');
eq(state.refundedCurrency, 'GBP', 'upper-cased for supabase/parts/800’s ISO check');
eq(state.refundedAt, AT, 'dated by Stripe’s instant, so a delivery retried on Tuesday does not file Saturday’s refund on Tuesday');
eq((0, gymOrderPayment_1.refundStateForOrder)({ amountRefundedCents: 4000, currency: null, atISO: AT }).refundedCurrency, null, 'a refund stating no currency records none rather than borrowing the order’s — parts/150 removed the defaults for exactly this');
eq((0, gymOrderPayment_1.refundStateForOrder)({ amountRefundedCents: 4000, currency: 'pound', atISO: AT }).refundedCurrency, null, 'and something that is not an ISO code would fail the write, so it is not attempted');
eq((0, gymOrderPayment_1.refundStateForOrder)({ amountRefundedCents: null, atISO: AT, currency: 'gbp' }).refundedCents, 0, 'an event stating no total records nothing refunded rather than NaN');
eq((0, gymOrderPayment_1.refusalNote)([]), null, 'nothing refused leaves no note — which is what clears one an earlier delivery left');
eq((0, gymOrderPayment_1.refusalNote)(['a', 'a']), 'a', 'the same reason twice says nothing the first one did not');
eq((0, gymOrderPayment_1.refusalNote)(['a', 'b']), 'a b', 'two refunds refused for different reasons both get said, because a note reporting only the last would send an owner to fix half of it');
/* ── THE EXCEPTION AN OWNER ACTUALLY SEES ──────────────────────────────────
 *
 * Derived from two stored numbers rather than declared by a flag, and that is
 * the point: Stripe does not redeliver an event it has already answered with a
 * 200, so nothing would ever come back to take a flag down once somebody had
 * recorded the missing correction by hand. Two numbers that disagree stop
 * disagreeing the moment it lands.
 *
 * This case matters more than the two beside it. A failed order has no
 * entitlement behind it and a paid order with no ledger row is missing from a
 * total, so both are visibly odd. Here the sale, the entitlement and the
 * payment row all exist and all read as correct — the payment is simply too
 * big, and no screen in the product would draw it any differently.
 */
const PAID = { status: 'paid', inLedger: true, failureNote: null };
eq((0, gymOrderPayment_1.onlineOrderProblem)({ ...PAID }), null, 'a sale with no refund on it is not an exception');
eq((0, gymOrderPayment_1.onlineOrderProblem)({ ...PAID, refundedCents: null, reversedCents: 0 }), null, 'and neither is one Stripe has never mentioned a refund for');
eq((0, gymOrderPayment_1.onlineOrderProblem)({ ...PAID, refundedCents: 0, reversedCents: 0 }), null, 'nor a charge whose refund total came back as nothing');
eq((0, gymOrderPayment_1.onlineOrderProblem)({ ...PAID, refundedCents: 2000, reversedCents: 2000 }), null, 'a refund that reached the ledger is not an exception — it is an ordinary reversal');
eq((0, gymOrderPayment_1.onlineOrderProblem)({ ...PAID, refundedCents: 2000, reversedCents: -2000 }), null, 'and the reversal is stored negative, so the comparison reads its size and not its sign');
const unmirrored = (0, gymOrderPayment_1.onlineOrderProblem)({ ...PAID, refundedCents: 2000, reversedCents: 0 }) ?? '';
ok(unmirrored.includes('not in the payment record'), 'a refund Stripe made that never reached the ledger is listed, because nothing else on any screen looks wrong');
ok(unmirrored.includes('still counts this money as taken'), 'and it says what the consequence is, which is the figure the owner is reading');
const half = (0, gymOrderPayment_1.onlineOrderProblem)({ ...PAID, refundedCents: 4000, reversedCents: 2000 }) ?? '';
ok(half.includes('only part'), 'a partly mirrored refund says so — an owner told "not in the payment record" would go looking for a reversal that is sitting right there');
const withWhy = (0, gymOrderPayment_1.onlineOrderProblem)({
    ...PAID, refundedCents: 2000, reversedCents: 0,
    refundNote: 'Stripe refunded this sale into a month this gym has closed.',
}) ?? '';
ok(withWhy.includes('closed'), 'and the webhook’s own reason is carried through verbatim');
ok(((0, gymOrderPayment_1.onlineOrderProblem)({ status: 'paid', inLedger: false, failureNote: null, refundedCents: 5000, reversedCents: 0 }) ?? '')
    .includes('Paid, and not in the payment record'), 'a sale that never reached the ledger reports THAT and not the refund — there is one thing to fix, not two');
/* ── nothing here formats money ────────────────────────────────────────────
 *
 * This module is a leaf and may not import `money()` from src/lib/gymRecord.ts,
 * so the only way any of these strings could state an amount is bare or in a
 * currency it assumed. Both are the defect scripts/check-currency.mjs exists to
 * stop. The figures are on the row the screen draws the sentence beside.
 */
for (const s of [unmirrored, half, withWhy]) {
    ok(!/[£$€¥]/.test(s), 'no currency symbol appears in an exception this module writes');
    ok(!/\d/.test(s), 'and no figure does either — the amounts belong to the row, not the sentence');
}
/** The webhook's loop, over a ledger that refuses a duplicate refund id. */
const deliver = (ledger, refunds) => {
    const already = ledger.rows.map((r) => r.stripe_refund_id);
    for (const one of (0, gymOrderPayment_1.refundsToMirror)(refunds, already)) {
        const built = (0, gymOrderPayment_1.gymRefundRow)({ sale: SALE, refund: one, fallbackAtISO: AT });
        if (!built.row)
            continue;
        // The unique index from supabase/parts/800, standing in for Postgres. A
        // second insert of the same refund id is 23505 and is skipped, which is
        // what the handler does with it.
        if (ledger.rows.some((r) => r.stripe_refund_id === built.row.stripe_refund_id))
            continue;
        ledger.rows.push({ stripe_refund_id: built.row.stripe_refund_id, amount_cents: built.row.amount_cents });
    }
};
const net = (ledger) => SALE.amountCents + ledger.rows.reduce((a, r) => a + r.amount_cents, 0);
const a2000 = { id: 're_a', amountCents: 2000, currency: 'gbp', createdSeconds: REFUNDED_ON, status: 'succeeded' };
const b3000 = { id: 're_b', amountCents: 3000, currency: 'gbp', createdSeconds: REFUNDED_ON + 86400, status: 'succeeded' };
// 1. THE SAME EVENT, TWICE. Stripe retries a delivery it did not get a 200 for,
//    and it retries one it did.
const once = { rows: [] };
deliver(once, [a2000]);
const twice = { rows: [] };
deliver(twice, [a2000]);
deliver(twice, [a2000]);
eq(net(once), 7000, 'one 2000 refund off a 9000 sale leaves 7000');
eq(net(twice), net(once), 'and a redelivered event leaves exactly the same figure — this is the whole idempotency argument');
eq(twice.rows.length, 1, 'because the second delivery writes no row, rather than writing a compensating one');
// 2. TWO PARTIAL REFUNDS, IN EITHER ORDER. Stripe sends the whole refund list
//    on each event, so the second delivery carries both.
const forwards = { rows: [] };
deliver(forwards, [a2000]);
deliver(forwards, [a2000, b3000]);
const backwards = { rows: [] };
deliver(backwards, [b3000]);
deliver(backwards, [b3000, a2000]);
eq(net(forwards), 4000, 'two partial refunds of 2000 and 3000 leave 4000 of a 9000 sale');
eq(net(backwards), net(forwards), 'and arriving in the other order leaves the same figure');
eq(forwards.rows.length, 2, 'two refunds, two rows');
eq(backwards.rows.length, 2, 'in either order');
// 3. THE SHAPE THAT WAS REJECTED, SHOWN FAILING. If a row carried
//    `charge.amount_refunded` instead of `refund.amount`, the second event
//    would reverse the first refund a second time. This is the arithmetic, not
//    a claim about it.
const runningTotals = [2000, 5000];
eq(SALE.amountCents - runningTotals.reduce((a, b) => a + b, 0), 2000, 'keying rows on the running total would leave 2000 rather than 4000 — the first refund taken off twice');
// 4. A DELIVERY THAT ARRIVES AFTER EVERYTHING IS ALREADY RECORDED.
const settled = { rows: [] };
deliver(settled, [a2000, b3000]);
const before = net(settled);
deliver(settled, [a2000, b3000]);
deliver(settled, [b3000, a2000]);
eq(net(settled), before, 'and no number of redeliveries, in any order, moves the figure again');
// 5. THE ORDER'S RUNNING TOTAL AGREES WITH THE LEDGER'S ROWS, which is the
//    comparison /accounting draws the exception from.
const reversed = settled.rows.reduce((a, r) => a + Math.abs(r.amount_cents), 0);
eq((0, gymOrderPayment_1.refundStateForOrder)({ amountRefundedCents: 5000, currency: 'gbp', atISO: AT }).refundedCents, reversed, 'Stripe’s running total and the sum of the reversals agree once every refund is mirrored — which is exactly when the exception stops being raised');
eq((0, gymOrderPayment_1.onlineOrderProblem)({ status: 'paid', inLedger: true, failureNote: null, refundedCents: 5000, reversedCents: reversed }), null, 'so a fully mirrored charge raises nothing, and a derived exception clears itself the moment the last row lands');
if (errors.length) {
    console.error(`gymOrderPayment: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
    process.exit(1);
}
console.log('gymOrderPayment ok');
