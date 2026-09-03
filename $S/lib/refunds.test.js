"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Money going back. Compile with tsc, run under plain node.
//
// This is somebody else's card being credited, so every assertion below is
// aimed at a specific way that goes wrong:
//
//   · a refund for more than was charged, which takes a coach's takings
//     negative and credits a card by a figure nobody chose;
//   · a SECOND refund computed against the original price rather than against
//     what is left, which gives the same money back twice;
//   · a refund offered on a row there is nothing to refund AGAINST — a sale
//     recorded by hand, or one that was never charged;
//   · a dead button, where a coach taps Refund, is told nothing, and concludes
//     the app is broken rather than that this particular sale cannot be;
//   · a coach who is not told whose balance the money is about to leave, which
//     is a different answer for a direct-charge coach and a destination one.
//
// The same module runs on the server: supabase/functions/connect-refund imports
// it, so the rule the screen enforces and the rule the refund is actually
// checked against cannot drift apart.
const refunds_1 = require("./refunds");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => { if (!Object.is(a, b))
    errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); };
const sale = (over = {}) => ({
    kind: 'purchase',
    amountCents: 48000,
    currency: 'GBP',
    refundedCents: 0,
    stripeRef: 'pi_123',
    paid: true,
    ...over,
});
/* ── 1. what is left ────────────────────────────────────────────────────── */
eq((0, refunds_1.refundableCents)(sale()), 48000, 'an untouched sale can be refunded in full');
eq((0, refunds_1.refundableCents)(sale({ refundedCents: 10000 })), 38000, 'a partial refund comes off what is left');
eq((0, refunds_1.refundableCents)(sale({ refundedCents: 48000 })), 0, 'a fully refunded sale has nothing left');
// Never more than was charged, whatever the row says. A negative here would
// take a coach's takings below zero, and `sumTaken` has no notion of a negative
// pot and no screen in this app renders one.
eq((0, refunds_1.refundableCents)(sale({ refundedCents: 60000 })), 0, 'a row claiming more refunded than charged still leaves nothing, never a negative');
eq((0, refunds_1.refundableCents)(sale({ refundedCents: -100 })), 48000, 'and a negative already-refunded is read as none');
// A row whose amount could not be read gives back NOTHING. A refund computed
// from an unknown charge is a figure somebody else's card is credited by.
eq((0, refunds_1.refundableCents)(sale({ amountCents: null })), 0, 'no amount means nothing to give back');
eq((0, refunds_1.refundableCents)(sale({ amountCents: 0 })), 0, 'and neither does a sale for nothing');
/* ── 2. partly, and fully ───────────────────────────────────────────────── */
eq((0, refunds_1.isPartlyRefunded)(sale()), false, 'an untouched sale is not partly refunded');
eq((0, refunds_1.isPartlyRefunded)(sale({ refundedCents: 10000 })), true, 'some of it back is partly refunded');
eq((0, refunds_1.isPartlyRefunded)(sale({ refundedCents: 48000 })), false, 'all of it back is not PARTLY refunded');
eq((0, refunds_1.isFullyRefunded)(sale({ refundedCents: 48000 })), true, 'it is fully refunded');
eq((0, refunds_1.isFullyRefunded)(sale({ refundedCents: 47999 })), false, 'one penny short is not fully refunded');
eq((0, refunds_1.isFullyRefunded)(sale({ amountCents: null, refundedCents: 100 })), false, 'a sale with no amount is never "fully" anything');
/* ── 3. what stops one, and why the reason is a sentence ────────────────── */
eq((0, refunds_1.refundBlocker)(sale()), null, 'an ordinary paid sale may be refunded');
// A dead button is the failure. A coach who taps Refund, is told nothing, and
// sees nothing happen concludes the app is broken; one who is told "this sale
// carries no payment reference" knows to hand the cash back instead.
for (const [row, what] of [
    [sale({ paid: false }), 'a sale that was never charged'],
    [sale({ stripeRef: null }), 'a sale with no payment reference'],
    [sale({ stripeRef: '   ' }), 'a sale whose reference is blank'],
    [sale({ currency: null }), 'a sale with no currency on it'],
    [sale({ amountCents: null }), 'a sale with no amount on it'],
    [sale({ refundedCents: 48000 }), 'a sale already refunded in full'],
]) {
    const b = (0, refunds_1.refundBlocker)(row);
    ok(typeof b === 'string' && b.length > 20, `${what} is refused with a sentence, not a boolean`);
}
// The order matters on one pair: a sale that was never charged is reported as
// never charged, not as one with no reference, because the coach's next act is
// different in each case.
ok(/never charged/i.test((0, refunds_1.refundBlocker)(sale({ paid: false, stripeRef: null }))), 'an uncharged sale says it was never charged, ahead of every other reason');
ok(/outside this app/i.test((0, refunds_1.refundBlocker)(sale({ stripeRef: null }))), 'a sale with no reference points the coach at giving the money back the way it arrived');
/* ── 4. the amount, refused rather than clamped ─────────────────────────── */
eq((0, refunds_1.refundAmountBlocker)(48000, 48000), null, 'the whole of what is left is allowed');
eq((0, refunds_1.refundAmountBlocker)(1, 48000), null, 'and so is the smallest real amount');
// Refused, NEVER clamped. Somebody typing 500 into a field for a 480 sale has
// made a mistake, and silently refunding 480 credits a card by a figure nobody
// chose — which the coach then reconciles against a number that was never
// theirs.
ok(!!(0, refunds_1.refundAmountBlocker)(50000, 48000), 'more than is left is refused');
ok(/already given back has come off/i.test((0, refunds_1.refundAmountBlocker)(50000, 48000)), 'and the reason explains that earlier refunds have reduced what is left');
ok(!!(0, refunds_1.refundAmountBlocker)(0, 48000), 'a refund of nothing is not a refund');
ok(!!(0, refunds_1.refundAmountBlocker)(-100, 48000), 'nor is a negative one');
ok(!!(0, refunds_1.refundAmountBlocker)(45.5, 48000), 'minor units are whole — half a penny is a slip, not an amount');
ok(!!(0, refunds_1.refundAmountBlocker)(NaN, 48000), 'NaN is not an amount');
ok(!!(0, refunds_1.refundAmountBlocker)(Infinity, 48000), 'nor is infinity');
// THE second-refund case. A sale of 480 with 100 already back has 380 left, and
// asking for 480 again must be refused — that is the shape that gives the same
// money back twice.
{
    const left = (0, refunds_1.refundableCents)(sale({ refundedCents: 10000 }));
    eq(left, 38000, 'what is left is the remainder');
    ok(!!(0, refunds_1.refundAmountBlocker)(48000, left), 'a second refund for the original price is refused');
    eq((0, refunds_1.refundAmountBlocker)(38000, left), null, 'and one for the remainder is allowed');
}
/* ── 5. whose balance it leaves ─────────────────────────────────────────── */
// Two arrangements, two opposite sentences, and neither may be said of the
// other. Under direct charges Stripe debits the COACH; under destination
// charges it debits Repple and pulls the coach's share back.
ok(/your own Stripe balance/i.test((0, refunds_1.refundBalanceNote)('direct')), 'a direct-charge coach is told it leaves their own balance');
ok(/next payout is smaller/i.test((0, refunds_1.refundBalanceNote)('destination')), 'a destination coach is told their payout shrinks');
ok((0, refunds_1.refundBalanceNote)('direct') !== (0, refunds_1.refundBalanceNote)('destination'), 'and the two are not the same sentence');
// Nothing said at all for an account nobody has read, which is the same rule
// payments.tsx already follows for a null `account_type`. A guess here is a
// statement about where somebody's money is about to come from.
eq((0, refunds_1.refundBalanceNote)(null), null, 'an unread charge model says nothing rather than guessing');
/* ── 6. what the coach reads before they tap ────────────────────────────── */
// Each clause is something a coach would otherwise assume and be wrong about,
// and each produces a different unhappy conversation with the same client.
ok(/does not cancel a subscription/i.test(refunds_1.REFUND_DOES_NOT), 'a refund is not a cancellation');
ok(/does not put a session credit back/i.test(refunds_1.REFUND_DOES_NOT), 'and it does not restore a pack credit');
ok(/does not tell your client anything/i.test(refunds_1.REFUND_DOES_NOT), 'and the app does not message them about it');
// The most likely surprise on a statement: Stripe's processing fee usually does
// not come back, so a fully refunded sale still leaves the merchant short.
ok(/usually not returned/i.test(refunds_1.REFUND_FEES_NOTE), 'the fee that does not come back is named');
ok(/comes back with the refund, in proportion/i.test(refunds_1.REFUND_FEES_NOTE), 'and the one that does');
ok(/cannot be taken back/i.test(refunds_1.REFUND_IS_FINAL), 'a refund is final and says so');
// The counterpart, and the reason the two features arrived together: ending a
// subscription today takes away paid-for time and returns nothing.
ok(/returns nothing/i.test(refunds_1.END_NOW_TAKES_THE_REST), 'ending it today returns nothing, and says so');
ok(/refund it separately/i.test(refunds_1.END_NOW_TAKES_THE_REST), 'and points at the separate act');
ok(/right answer nearly always/i.test(refunds_1.END_AT_PERIOD_IS_KINDER), 'the safer option is named as the usual one');
// Compared as plain strings: tsc narrows both constants to their own literal
// types and refuses the comparison outright, which is itself half the
// assertion — the two are different values and the type system knows it.
ok(String(refunds_1.END_NOW_TAKES_THE_REST) !== String(refunds_1.END_AT_PERIOD_IS_KINDER), 'and the two are different sentences');
/* ── 7. a row from either table, in the shape the rule reads ────────────── */
//
// The mapping the screen and supabase/functions/connect-refund now share. It
// used to be written out at each of them, and the field they each decided for
// themselves was `paid` — which is the one a refund is gated on.
// A renewal is PAID because it exists. `client_subscription_payments` has no
// status column and wants none: part 132 writes a row there only after checking
// the invoice itself said paid. A copy of this mapping that reached for
// `row.status` on a renewal would read undefined, decide the money was never
// charged, and refuse every renewal refund with a sentence that is false.
const renewal = (0, refunds_1.refundableRow)('renewal', { amount_cents: 60000, currency: 'AED', refunded_cents: 0 }, 'in_123');
eq(renewal.paid, true, 'a renewal row exists only because Stripe said paid, so it is paid');
eq((0, refunds_1.refundBlocker)(renewal), null, 'and nothing blocks refunding one');
eq(renewal.kind, 'renewal', 'and it carries its own kind through to the server');
// A one-off sale asks the column, and a sale that never completed is refused
// rather than refunded — there is no charge behind it to credit.
eq((0, refunds_1.refundableRow)('purchase', { amount_cents: 48000, currency: 'GBP', refunded_cents: 0, status: 'paid' }, 'cs_1').paid, true, 'a paid sale is paid');
eq((0, refunds_1.refundableRow)('purchase', { amount_cents: 48000, currency: 'GBP', refunded_cents: 0, status: 'pending' }, 'cs_1').paid, false, 'a pending sale is not');
ok((0, refunds_1.refundBlocker)((0, refunds_1.refundableRow)('purchase', { amount_cents: 48000, currency: 'GBP', refunded_cents: 0, status: 'pending' }, 'cs_1')) !== null, 'and it is refused with a reason rather than a dead button');
// PostgREST hands a BIGINT back as a string so a value above 2^53 survives
// JSON, and `refunded_cents` is a bigint in part 192. Read as a string this
// fails every arithmetic check below it, and a sale that is half refunded
// comes back as one nobody has touched — so the second refund is bounded by
// the full price and gives the same money back twice.
eq((0, refunds_1.refundableRow)('purchase', { amount_cents: 48000, currency: 'GBP', refunded_cents: '10000', status: 'paid' }, 'cs_1').refundedCents, 10000, 'a bigint arriving as a string is still a number of minor units');
eq((0, refunds_1.refundableCents)((0, refunds_1.refundableRow)('purchase', { amount_cents: 48000, currency: 'GBP', refunded_cents: '10000', status: 'paid' }, 'cs_1')), 38000, 'and what is left is computed off it');
// Absent, unreadable and negative all mean NONE refunded, and none of them may
// mean "unknown" — the column has a default and only the edge function writes
// it, from Stripe's own answer.
eq((0, refunds_1.refundableRow)('renewal', { amount_cents: 60000, currency: 'AED', refunded_cents: null }, 'in_1').refundedCents, 0, 'a null already-refunded is none');
eq((0, refunds_1.refundableRow)('renewal', { amount_cents: 60000, currency: 'AED', refunded_cents: 'x' }, 'in_1').refundedCents, 0, 'and so is one that will not parse');
eq((0, refunds_1.refundableRow)('renewal', { amount_cents: 60000, currency: 'AED', refunded_cents: -50 }, 'in_1').refundedCents, 0, 'and a negative is not extra headroom');
// An amount that will not read is not zero. Zero would be a sale with nothing
// left on it; this is a sale nothing can be worked out from, and the blocker
// says so in different words.
eq((0, refunds_1.refundableRow)('purchase', { amount_cents: null, currency: 'GBP', refunded_cents: 0, status: 'paid' }, 'cs_1').amountCents, null, 'an amount Stripe never stated stays null');
ok(/nothing to work a refund out from/i.test((0, refunds_1.refundBlocker)((0, refunds_1.refundableRow)('purchase', { amount_cents: null, currency: 'GBP', refunded_cents: 0, status: 'paid' }, 'cs_1'))), 'and it is refused for that reason');
// The reference is passed rather than read off the row, because the screen
// holds the Checkout Session or the Invoice and the server has since resolved
// it to a PaymentIntent. Blank and whitespace are the same as absent: there is
// nothing to refund AGAINST, which is a different sentence from nothing left.
eq((0, refunds_1.refundableRow)('purchase', { amount_cents: 48000, currency: 'GBP', refunded_cents: 0, status: 'paid' }, '   ').stripeRef, null, 'a blank reference is no reference');
ok(/no payment reference/i.test((0, refunds_1.refundBlocker)((0, refunds_1.refundableRow)('purchase', { amount_cents: 48000, currency: 'GBP', refunded_cents: 0, status: 'paid' }, null))), 'and the coach is told to give the money back the way it arrived');
console.log(errors.length ? 'REFUND FAILURES:\n' + errors.join('\n') : 'ALL REFUND TESTS PASSED');
if (errors.length)
    process.exit(1);
