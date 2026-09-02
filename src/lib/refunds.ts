// Giving money back, and the two things this app must never get wrong about it.
//
// ── Why there was nothing here ─────────────────────────────────────────────
//
// Refunds were refused everywhere, on purpose, and the refusal was written down
// in four places — app/(trainer)/payments.tsx, src/lib/subscriptions.ts,
// supabase/functions/connect-checkout and src/lib/subscriptionScope.ts, whose
// test asserts that 'refund' is not an action either party may take. The
// argument was that "a half-working refund button is worse than no refund
// button", and it was right about half-working.
//
// What it cost was the coach's worst customer moment. Somebody asks for their
// money back, and the app that took the money hands the coach a sentence
// telling them to find a laptop and log into a dashboard belonging to a company
// their client has never heard of. That is the moment a coach decides Repple is
// not where their business lives.
//
// ── THE TWO THINGS THAT MAKE A REFUND HALF-WORKING ────────────────────────
//
// 1. THE WRONG LEDGER. Every Stripe object exists on exactly one account. A
//    sale made under DESTINATION charges is a charge on the PLATFORM, and
//    refunding it debits Repple's balance; a sale made under DIRECT charges
//    (part 161) is a charge on the COACH's connected account, and refunding it
//    debits theirs. Ask the coach's CURRENT `charge_model` which context to use
//    and every refund of an older sale goes to the wrong one, where Stripe
//    answers "No such charge" — so `optionsForObject` reads the account off the
//    SALE ROW, and everything here is built to keep that true.
//
// 2. A REFUND THE APP BELIEVES IN AND STRIPE DID NOT MAKE. The row is written
//    only from Stripe's own answer, never optimistically, for the same reason
//    `redeemSession` was rewritten around an RPC: a balance the app printed and
//    the payment processor never agreed to is the worst kind of wrong, because
//    both parties are looking at it.
//
// ── What this module is ───────────────────────────────────────────────────
//
// The pure half: what may be refunded, how much of it is left, and the words.
// It is imported by the app AND by supabase/functions/connect-refund, the same
// way `subscriptionScope.ts` is shared with connect-checkout — so the rule that
// decides whether a refund is allowed cannot be one thing on the screen and
// another on the server.
//
// Nothing here talks to Stripe and nothing here talks to Supabase.

/* ── what can be refunded ─────────────────────────────────────────────────── */

/**
 * The two kinds of money a coach's client can have paid them THROUGH Repple.
 *
 * A `coach_receipts` row is deliberately not one of them: that is cash the
 * coach was handed outside this app, and "refunding" it here would write a
 * record of money moving that no processor ever moved. The coach hands the cash
 * back and deletes the line.
 */
export type RefundableKind = 'purchase' | 'renewal';

/** One thing that could be refunded, reduced to what the decision turns on. */
export interface Refundable {
  kind: RefundableKind;
  /** Minor units, gross — what the client was charged. */
  amountCents: number | null;
  currency: string | null;
  /** Minor units already given back. Zero, never null, on a row nobody has
   *  refunded: this app writes the column and the column has a default. */
  refundedCents: number;
  /** The Stripe object this refund would be made against. Null means there is
   *  nothing to refund AGAINST, which is different from nothing left to refund
   *  — see `refundBlocker`. */
  stripeRef: string | null;
  /** Whether the sale completed. A pending or failed one was never charged. */
  paid: boolean;
}

/**
 * What is left to give back, in minor units.
 *
 * Never negative and never more than was charged. A row whose amount could not
 * be read gives back nothing, because a refund computed from an unknown charge
 * is a number somebody else's card is credited by.
 */
export function refundableCents(r: Refundable): number {
  const gross = Number(r.amountCents);
  if (!Number.isFinite(gross) || gross <= 0) return 0;
  const already = Number.isFinite(r.refundedCents) ? Math.max(0, r.refundedCents) : 0;
  return Math.max(0, Math.min(gross, gross - already));
}

/** True when some, but not all, of it has been given back. Its own function
 *  because a screen has to say "partly refunded" rather than showing a
 *  full-price sale with a quiet asterisk. */
export function isPartlyRefunded(r: Refundable): boolean {
  const left = refundableCents(r);
  const already = Number.isFinite(r.refundedCents) ? Math.max(0, r.refundedCents) : 0;
  return already > 0 && left > 0;
}

export function isFullyRefunded(r: Refundable): boolean {
  const gross = Number(r.amountCents);
  if (!Number.isFinite(gross) || gross <= 0) return false;
  const already = Number.isFinite(r.refundedCents) ? Math.max(0, r.refundedCents) : 0;
  return already >= gross;
}

/**
 * Why this cannot be refunded, or null when it can.
 *
 * A sentence rather than a boolean, and never a dead button: a coach who taps
 * Refund and is told nothing concludes the app is broken, and a coach who is
 * told "this sale carries no Stripe reference, so there is nothing to refund
 * against — it was recorded by hand" knows to hand the cash back instead.
 *
 * Run on the SERVER as well as on the screen. The screen's copy of a rule is a
 * convenience; the server's copy is the rule.
 */
export function refundBlocker(r: Refundable): string | null {
  if (!r.paid) {
    return 'This one was never charged, so there is nothing to give back.';
  }
  if (!String(r.stripeRef ?? '').trim()) {
    return 'This one carries no payment reference, so there is nothing here to refund against. If the money came to you outside this app, give it back the way it arrived.';
  }
  if (!r.currency || !String(r.currency).trim()) {
    return 'No currency is recorded on this one, so the amount cannot be stated and nothing can be refunded from here. A refund in a currency nobody wrote down is a different amount of money.';
  }
  if (!Number.isFinite(Number(r.amountCents)) || Number(r.amountCents) <= 0) {
    return 'No amount is recorded on this one, so there is nothing to work a refund out from.';
  }
  if (isFullyRefunded(r)) {
    return 'The whole of this one has already been given back.';
  }
  return null;
}

/**
 * The amount a coach typed, in minor units, or the reason it is not an amount.
 *
 * Refused, never clamped. Somebody typing 500 into a field for a 480 sale has
 * made a mistake, and silently refunding 480 credits a card by a figure nobody
 * chose — which the coach then reconciles against a number that was never
 * theirs. `max` is what is actually left, so a second partial refund is checked
 * against the remainder rather than against the original price.
 */
export function refundAmountBlocker(minorUnits: number, max: number): string | null {
  if (!Number.isFinite(minorUnits) || !Number.isInteger(minorUnits) || minorUnits <= 0) {
    return 'Enter an amount greater than zero. A refund of nothing is not a refund.';
  }
  if (minorUnits > max) {
    return 'That is more than is left on this one. A refund cannot be for more than was charged, and anything already given back has come off what is left.';
  }
  return null;
}

/* ── the sentences a refund screen has to carry ───────────────────────────── */

/**
 * The one line that states what is about to happen, in the confirm.
 *
 * `amount` arrives ALREADY FORMATTED, with its currency on it — from
 * `minorMoney` in coachMoney.ts, which is where the number of decimal places a
 * currency has is decided. It is passed in rather than formatted here because
 * this module is imported by supabase/functions/connect-refund, which runs
 * under Deno and must not pull in the app's locale handling; and because there
 * is exactly one formatter for money in this codebase and it is not this file.
 *
 * `part` is whether this is less than the whole of what is left. The two
 * sentences differ in the thing a coach most needs to know afterwards — whether
 * anything is still standing on that sale — and a single sentence covering both
 * would have to be vague about it.
 */
export function refundConfirmLine(amount: string, who: string, part: boolean): string {
  return part
    ? `${amount} goes back to ${who}, on the card they paid with. The rest of this sale still stands.`
    : `${amount} goes back to ${who}, on the card they paid with. That is the whole of what is left on this sale.`;
}

/**
 * That the figure typed is the figure that leaves, exactly.
 *
 * Said beside a partial amount and nowhere else. A coach typing a number into a
 * box beside somebody's card is entitled to know that nothing rounds it, tops
 * it up to a neat figure or adjusts it for a fee — because every one of those
 * would be this app choosing an amount on their behalf, and the amount is the
 * one thing here that is theirs to choose.
 */
export const REFUND_PART_IS_EXACT =
  'The amount you type is the amount that goes back, exactly. Nothing is rounded, and nothing is added to it or taken off it.';

/**
 * Whose balance the money comes out of, which is not the same for every coach.
 *
 * Under DIRECT charges the coach is the merchant of record and Stripe debits
 * THEIR balance — if it is short, Stripe takes it from their next payout or
 * their bank. Under DESTINATION charges Repple is the merchant of record and
 * Repple's balance is debited, and the coach's share is pulled back through the
 * transfer reversal. A coach about to give somebody four hundred back is
 * entitled to know which of those is about to happen to them, and the two
 * sentences are not interchangeable.
 *
 * `null` for an account whose model nobody has read. Nothing is said in that
 * case rather than a guess, which is the same rule payments.tsx already follows
 * for a null `account_type`.
 */
export function refundBalanceNote(model: 'direct' | 'destination' | null): string | null {
  if (model === 'direct') {
    return 'The money comes out of your own Stripe balance, because you are the merchant on these charges. If your balance is short, Stripe takes it from your next payout or from your bank.';
  }
  if (model === 'destination') {
    return 'These charges were taken with Repple as the merchant, so the refund leaves Repple’s balance and your share of it is pulled back out of yours. Your next payout is smaller by that amount.';
  }
  return null;
}

/**
 * What a refund does NOT do, said before the coach taps it.
 *
 * Every clause is something a coach would otherwise assume and be wrong about,
 * and each one produces a different unhappy conversation with the same client.
 */
export const REFUND_DOES_NOT =
  'A refund gives money back and does nothing else. It does not cancel a subscription, it does not put a session credit back on a pack, and it does not tell your client anything — Stripe emails them a refund receipt and the rest is yours to say.';

/**
 * That the platform fee comes back too, and that Stripe's own fee may not.
 *
 * The single most likely surprise on the coach's statement. Stripe's processing
 * fee on the original charge is not returned on a refund in most of the world,
 * so a fully refunded sale still leaves the merchant out of pocket by it — and
 * a coach who reads "fully refunded" and expects to be square is a coach who
 * finds a shortfall later with nothing to attribute it to.
 */
export const REFUND_FEES_NOTE =
  'Repple’s share of the original charge comes back with the refund, in proportion. What Stripe charged to process the payment in the first place is Stripe’s and is usually not returned, so a sale refunded in full can still leave you short by that. Your Stripe dashboard is the record of what actually moved.';

/**
 * That this is irreversible.
 *
 * There is no un-refund at Stripe. The client would have to pay again, at
 * whatever the coach charges today, through a new checkout.
 */
export const REFUND_IS_FINAL =
  'A refund cannot be taken back. If it was a mistake, the only way round it is for them to pay again, which means a new checkout at today’s price.';

/**
 * What an immediate cancellation does and does not do.
 *
 * The counterpart to `REFUND_DOES_NOT`, and the reason the two features arrived
 * together: ending a subscription today takes away the rest of a period the
 * client has already paid for, and nothing about ending it returns any of that
 * money. Offering the immediate cancel without saying so would be the app
 * quietly taking weeks of coaching off somebody.
 */
export const END_NOW_TAKES_THE_REST =
  'Ending it now stops the coaching immediately and returns nothing. They have paid for the period they are in, and this takes the rest of it off them without giving the money back — refund it separately if that is what you mean.';

/** Why stopping at the end of the period is still the default. Shown beside the
 *  immediate option rather than instead of it, so the safer choice is the one a
 *  coach reads first. */
export const END_AT_PERIOD_IS_KINDER =
  'Stopping at the end of the period lets them use what they have already paid for, and nothing is charged again after that. It is the right answer nearly always, and it can be undone until the day it ends.';
