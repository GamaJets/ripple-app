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
import {
  refundableCents,
  isPartlyRefunded,
  isFullyRefunded,
  refundBlocker,
  refundAmountBlocker,
  refundBalanceNote,
  REFUND_DOES_NOT,
  REFUND_FEES_NOTE,
  REFUND_IS_FINAL,
  END_NOW_TAKES_THE_REST,
  END_AT_PERIOD_IS_KINDER,
  type Refundable,
} from './refunds';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => { if (!Object.is(a, b)) errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); };

const sale = (over: Partial<Refundable> = {}): Refundable => ({
  kind: 'purchase',
  amountCents: 48000,
  currency: 'GBP',
  refundedCents: 0,
  stripeRef: 'pi_123',
  paid: true,
  ...over,
});

/* ── 1. what is left ────────────────────────────────────────────────────── */

eq(refundableCents(sale()), 48000, 'an untouched sale can be refunded in full');
eq(refundableCents(sale({ refundedCents: 10000 })), 38000, 'a partial refund comes off what is left');
eq(refundableCents(sale({ refundedCents: 48000 })), 0, 'a fully refunded sale has nothing left');

// Never more than was charged, whatever the row says. A negative here would
// take a coach's takings below zero, and `sumTaken` has no notion of a negative
// pot and no screen in this app renders one.
eq(refundableCents(sale({ refundedCents: 60000 })), 0, 'a row claiming more refunded than charged still leaves nothing, never a negative');
eq(refundableCents(sale({ refundedCents: -100 })), 48000, 'and a negative already-refunded is read as none');

// A row whose amount could not be read gives back NOTHING. A refund computed
// from an unknown charge is a figure somebody else's card is credited by.
eq(refundableCents(sale({ amountCents: null })), 0, 'no amount means nothing to give back');
eq(refundableCents(sale({ amountCents: 0 })), 0, 'and neither does a sale for nothing');

/* ── 2. partly, and fully ───────────────────────────────────────────────── */

eq(isPartlyRefunded(sale()), false, 'an untouched sale is not partly refunded');
eq(isPartlyRefunded(sale({ refundedCents: 10000 })), true, 'some of it back is partly refunded');
eq(isPartlyRefunded(sale({ refundedCents: 48000 })), false, 'all of it back is not PARTLY refunded');
eq(isFullyRefunded(sale({ refundedCents: 48000 })), true, 'it is fully refunded');
eq(isFullyRefunded(sale({ refundedCents: 47999 })), false, 'one penny short is not fully refunded');
eq(isFullyRefunded(sale({ amountCents: null, refundedCents: 100 })), false, 'a sale with no amount is never "fully" anything');

/* ── 3. what stops one, and why the reason is a sentence ────────────────── */

eq(refundBlocker(sale()), null, 'an ordinary paid sale may be refunded');

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
] as [Refundable, string][]) {
  const b = refundBlocker(row);
  ok(typeof b === 'string' && b.length > 20, `${what} is refused with a sentence, not a boolean`);
}

// The order matters on one pair: a sale that was never charged is reported as
// never charged, not as one with no reference, because the coach's next act is
// different in each case.
ok(/never charged/i.test(refundBlocker(sale({ paid: false, stripeRef: null }))!),
  'an uncharged sale says it was never charged, ahead of every other reason');
ok(/outside this app/i.test(refundBlocker(sale({ stripeRef: null }))!),
  'a sale with no reference points the coach at giving the money back the way it arrived');

/* ── 4. the amount, refused rather than clamped ─────────────────────────── */

eq(refundAmountBlocker(48000, 48000), null, 'the whole of what is left is allowed');
eq(refundAmountBlocker(1, 48000), null, 'and so is the smallest real amount');

// Refused, NEVER clamped. Somebody typing 500 into a field for a 480 sale has
// made a mistake, and silently refunding 480 credits a card by a figure nobody
// chose — which the coach then reconciles against a number that was never
// theirs.
ok(!!refundAmountBlocker(50000, 48000), 'more than is left is refused');
ok(/already given back has come off/i.test(refundAmountBlocker(50000, 48000)!),
  'and the reason explains that earlier refunds have reduced what is left');
ok(!!refundAmountBlocker(0, 48000), 'a refund of nothing is not a refund');
ok(!!refundAmountBlocker(-100, 48000), 'nor is a negative one');
ok(!!refundAmountBlocker(45.5, 48000), 'minor units are whole — half a penny is a slip, not an amount');
ok(!!refundAmountBlocker(NaN, 48000), 'NaN is not an amount');
ok(!!refundAmountBlocker(Infinity, 48000), 'nor is infinity');

// THE second-refund case. A sale of 480 with 100 already back has 380 left, and
// asking for 480 again must be refused — that is the shape that gives the same
// money back twice.
{
  const left = refundableCents(sale({ refundedCents: 10000 }));
  eq(left, 38000, 'what is left is the remainder');
  ok(!!refundAmountBlocker(48000, left), 'a second refund for the original price is refused');
  eq(refundAmountBlocker(38000, left), null, 'and one for the remainder is allowed');
}

/* ── 5. whose balance it leaves ─────────────────────────────────────────── */

// Two arrangements, two opposite sentences, and neither may be said of the
// other. Under direct charges Stripe debits the COACH; under destination
// charges it debits Repple and pulls the coach's share back.
ok(/your own Stripe balance/i.test(refundBalanceNote('direct')!), 'a direct-charge coach is told it leaves their own balance');
ok(/next payout is smaller/i.test(refundBalanceNote('destination')!), 'a destination coach is told their payout shrinks');
ok(refundBalanceNote('direct') !== refundBalanceNote('destination'), 'and the two are not the same sentence');

// Nothing said at all for an account nobody has read, which is the same rule
// payments.tsx already follows for a null `account_type`. A guess here is a
// statement about where somebody's money is about to come from.
eq(refundBalanceNote(null), null, 'an unread charge model says nothing rather than guessing');

/* ── 6. what the coach reads before they tap ────────────────────────────── */

// Each clause is something a coach would otherwise assume and be wrong about,
// and each produces a different unhappy conversation with the same client.
ok(/does not cancel a subscription/i.test(REFUND_DOES_NOT), 'a refund is not a cancellation');
ok(/does not put a session credit back/i.test(REFUND_DOES_NOT), 'and it does not restore a pack credit');
ok(/does not tell your client anything/i.test(REFUND_DOES_NOT), 'and the app does not message them about it');

// The most likely surprise on a statement: Stripe's processing fee usually does
// not come back, so a fully refunded sale still leaves the merchant short.
ok(/usually not returned/i.test(REFUND_FEES_NOTE), 'the fee that does not come back is named');
ok(/comes back with the refund, in proportion/i.test(REFUND_FEES_NOTE), 'and the one that does');

ok(/cannot be taken back/i.test(REFUND_IS_FINAL), 'a refund is final and says so');

// The counterpart, and the reason the two features arrived together: ending a
// subscription today takes away paid-for time and returns nothing.
ok(/returns nothing/i.test(END_NOW_TAKES_THE_REST), 'ending it today returns nothing, and says so');
ok(/refund it separately/i.test(END_NOW_TAKES_THE_REST), 'and points at the separate act');
ok(/right answer nearly always/i.test(END_AT_PERIOD_IS_KINDER), 'the safer option is named as the usual one');
// Compared as plain strings: tsc narrows both constants to their own literal
// types and refuses the comparison outright, which is itself half the
// assertion — the two are different values and the type system knows it.
ok(String(END_NOW_TAKES_THE_REST) !== String(END_AT_PERIOD_IS_KINDER), 'and the two are different sentences');

declare const process: { exit(code: number): void };
console.log(errors.length ? 'REFUND FAILURES:\n' + errors.join('\n') : 'ALL REFUND TESTS PASSED');
if (errors.length) process.exit(1);
