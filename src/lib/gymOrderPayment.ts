// ── The ledger row an online gym sale has to leave behind ───────────────────
//
// A member who buys a membership or a pass from their gym pays Stripe, and
// `supabase/functions/stripe-webhook` grants the entitlement. Until this module
// existed it granted the entitlement and nothing else: no row in
// `gym_payments`, which is the ONLY table /money, /revenue, /accounting and
// /close count. Every online sale a gym ever made was missing from the figure
// its accountant reconciles against the bank.
//
// The decisions are here, as pure functions, rather than in the webhook, so
// they can be asserted without a Stripe account and so the ledger row an online
// sale writes is one readable rule rather than an inline object literal in a
// 1000-line handler.
//
//   A MODULE AN EDGE FUNCTION IMPORTS MUST BE A LEAF. No relative imports.
//
// See the header of src/lib/termDates.ts for the whole argument. The short
// version: Deno resolves a specifier of `./gymRecord` literally, finds no such file and
// throws on the function's FIRST REQUEST, while TypeScript refuses
// `'./gymRecord.ts'` under `moduleResolution: bundler`. So this file imports
// nothing, `PaymentMethod` is restated below rather than imported, and
// src/lib/gymOrderPayment.test.ts asserts the restatement still agrees with
// `gymRecord.PaymentMethod` — a compile error the day somebody adds a sixth.

/** The five ways `gym_payments.method` may say money arrived. Mirrors
 *  `PaymentMethod` in src/lib/gymRecord.ts, which mirrors the CHECK constraint
 *  in supabase/parts/29. Restated because this file may not import. */
export type LedgerMethod = 'card' | 'cash' | 'transfer' | 'direct_debit' | 'other';

/**
 * How an online checkout arrived, in the five words the ledger knows.
 *
 * The input is the checkout session's `payment_method_types`, which is what
 * Stripe ALLOWED rather than what the member actually used. The instrument
 * actually charged lives on the PaymentIntent's latest charge and reading it
 * costs a Stripe round-trip on every event, which the webhook's own header
 * argues against for exactly this kind of decoration.
 *
 * So this answers only where the allowed set leaves no room for doubt:
 *
 *   · one card-shaped set                → 'card'
 *   · one direct-debit scheme            → 'direct_debit'
 *   · a bank transfer                    → 'transfer'
 *   · anything else, or a genuine choice → 'other'
 *
 * 'link' is dropped before the test rather than counted: Stripe Link is a saved
 * card, so `['card', 'link']` — the ordinary shape for a gym with automatic
 * payment methods on — is a card sale and not an ambiguous one.
 *
 * 'other' is a real answer and not a shrug. The note on the row names the
 * Stripe objects, so a method nobody can narrow further is still reconcilable
 * against the Stripe dashboard, and the alternative — calling everything 'card'
 * — would put a SEPA direct debit in the card line of the table an accountant
 * breaks the month down by.
 */
export function checkoutMethod(types: readonly string[] | null | undefined): LedgerMethod {
  const seen = new Set(
    (types ?? [])
      .map((t) => String(t ?? '').trim().toLowerCase())
      .filter((t) => t && t !== 'link'),
  );
  if (seen.size !== 1) return 'other';
  const only = [...seen][0];
  if (only === 'card') return 'card';
  // Every direct-debit scheme Stripe Checkout offers. A gym billed under any of
  // them is billed by direct debit, which is a line the owner already reads.
  if (only === 'sepa_debit' || only === 'bacs_debit' || only === 'acss_debit' || only === 'au_becs_debit') {
    return 'direct_debit';
  }
  // `customer_balance` is Stripe's bank-transfer method: the member is given
  // account details and sends the money.
  if (only === 'customer_balance') return 'transfer';
  return 'other';
}

/** The parts of the paid `gym_orders` row this write needs. */
export interface PaidOrderFacts {
  tenantId: string;
  memberId: string;
  /** What the member was quoted, in minor units. The fallback for a session
   *  that somehow states no total. */
  amountCents: number | null | undefined;
  currency: string | null | undefined;
}

/** The parts of the Stripe checkout session this write needs. */
export interface CheckoutFacts {
  /** `amount_total`, in minor units. What Stripe actually took. */
  amountTotal: number | null | undefined;
  /** `currency`, lower case on the event. */
  currency: string | null | undefined;
  /** `payment_method_types`. */
  methodTypes: readonly string[] | null | undefined;
  sessionId: string;
  paymentIntent: string | null | undefined;
}

/** The row, exactly as `gym_payments` wants it. */
export interface GymPaymentRow {
  tenant_id: string;
  member_id: string;
  membership_id: string | null;
  gym_order_id: string;
  amount_cents: number;
  currency: string;
  method: LedgerMethod;
  taken_at: string;
  note: string;
  kind: 'payment';
  recorded_by: null;
}

/**
 * The ledger row for one paid gym order, or null when it cannot honestly be
 * written.
 *
 * ── What comes from Stripe and what comes from the order ──────────────────
 *
 * The AMOUNT and the CURRENCY come from the session, because the session is
 * what happened: `amount_total` is the money that left the member's card, in
 * the unit Stripe charged in. The order's quote is the fallback for the one
 * case Stripe states nothing, and it is a fallback rather than the source for
 * the same reason `gym_passes.paid_cents` takes Stripe's figure — a quote is
 * what somebody was going to be charged.
 *
 * The MEMBER and the TENANT come from the order, which is the only place they
 * are recorded.
 *
 * `taken_at` is when STRIPE says the event happened, passed in by the caller as
 * the event timestamp, not the moment this handler happened to run. A webhook
 * retried on Tuesday must not file Saturday's money on Tuesday.
 *
 * ── Why it can refuse ─────────────────────────────────────────────────────
 *
 * `gym_payments.currency` is NOT NULL and, since supabase/parts/150, has no
 * default. There is no currency to fall back on in a white-label product: a
 * guess here is a permanent, wrong stamp on a row an accountant will file. A
 * sale that states no currency anywhere is therefore not recorded, and the
 * caller says so loudly rather than inventing dirhams.
 *
 * The amount may be zero — a fully discounted joining fee is a real
 * transaction and part 180 keeps a zero payment legal for exactly that. It may
 * not be negative: negative rows in this table are corrections and carry a
 * `reverses_payment_id`, and a bare negative would fail the constraint.
 */
export function gymOrderPaymentRow(args: {
  orderId: string;
  order: PaidOrderFacts;
  session: CheckoutFacts;
  /** The membership this sale bought, where it bought one. Null for a pass. */
  membershipId: string | null;
  /** When Stripe says the money moved. ISO. */
  takenAt: string;
}): GymPaymentRow | null {
  const { orderId, order, session, membershipId, takenAt } = args;

  const fromStripe = typeof session.amountTotal === 'number' && Number.isFinite(session.amountTotal)
    ? Math.round(session.amountTotal)
    : null;
  const quoted = typeof order.amountCents === 'number' && Number.isFinite(order.amountCents)
    ? Math.round(order.amountCents)
    : null;
  const amountCents = fromStripe ?? quoted;
  if (amountCents == null || amountCents < 0) return null;

  const currency = (session.currency ?? '').trim().toUpperCase()
    || (order.currency ?? '').trim().toUpperCase();
  if (!currency) return null;

  return {
    tenant_id: order.tenantId,
    member_id: order.memberId,
    membership_id: membershipId,
    gym_order_id: orderId,
    amount_cents: amountCents,
    currency,
    method: checkoutMethod(session.methodTypes),
    taken_at: takenAt,
    note: onlineNote(session),
    // Never anything else from here. A refund of an online sale is recorded
    // through `reversePayment`, by a person, with a reason on it.
    kind: 'payment',
    // Nobody at the desk took this. `recorded_by` names a member of staff and
    // filling it with anybody would be a false statement about who handled the
    // money.
    recorded_by: null,
  };
}

/**
 * What the note says, and why it says the ids.
 *
 * This is the row an owner lands on when the bank statement and the ledger
 * disagree, and the only useful thing it can carry is the string that finds the
 * charge in the Stripe dashboard. The payment intent is that string; the
 * session is the fallback for a sale that somehow has no intent on it.
 */
export function onlineNote(session: Pick<CheckoutFacts, 'sessionId' | 'paymentIntent'>): string {
  const ref = (session.paymentIntent ?? '').trim() || (session.sessionId ?? '').trim();
  return ref ? `Paid online through Stripe. ${ref}` : 'Paid online through Stripe.';
}

/**
 * Is this write failure the closed-month lock rather than a fault?
 *
 * `gym_refuse_write_into_closed_month` (supabase/parts/182) raises P0001 when
 * anything tries to write a payment into a month the gym has signed off. That
 * is a DECISION, not an outage, and the difference matters here more than
 * anywhere else in the product:
 *
 *   · An ordinary write failure is worth a 500, because Stripe retries a 500
 *     and the next attempt may well succeed.
 *   · The closed-month refusal will refuse every retry identically until
 *     somebody reopens the month. Answering it with a 500 spends Stripe's
 *     retry budget on a write that cannot land, and then the delivery is
 *     abandoned and the money is recorded nowhere with nothing to say so.
 *
 * So the caller treats this one as final, leaves the entitlement granted, and
 * lets the order stand as paid with no payment beside it — which is precisely
 * the exception `gym_payments.gym_order_id` was added to make visible.
 */
export function isClosedMonthRefusal(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  if ((err.code ?? '') === 'P0001') return true;
  return /has closed that month/i.test(String(err.message ?? ''));
}

/* ── the exception an owner has to be shown ────────────────────────────────── */

/** One paid or failed online order, as the reconciliation screen reads it. */
export interface OnlineOrderState {
  /** `gym_orders.status`. Only 'paid' and 'failed' ever reach this. */
  status: string;
  /** Whether a `gym_payments` row names this order. */
  inLedger: boolean;
  /** `gym_orders.failure_note`, verbatim. */
  failureNote: string | null;
}

/**
 * What is wrong with an online order, in the owner's words, or null when
 * nothing is.
 *
 * Two different failures and they need different people:
 *
 *   · FAILED. The card was charged and the entitlement could not be written.
 *     The webhook records this with a reason and then writes a `console.error`,
 *     and `gym_orders` is read by exactly one file in the product — the
 *     member's own purchase history. So the only person who could see it was
 *     whoever tails the edge-function logs, and the gym learned about it when
 *     the member turned up and was refused at the door.
 *
 *   · PAID, AND NOT IN THE LEDGER. The member has what they bought and the
 *     money is in Stripe, and `gym_payments` — which every money screen counts
 *     — has no row for it. The one way this happens now is the closed-month
 *     lock refusing the write, which is a decision rather than a fault; before
 *     `gym_payments.gym_order_id` existed it happened on every single online
 *     sale and nothing anywhere could see it.
 */
export function onlineOrderProblem(o: OnlineOrderState): string | null {
  if (o.status === 'failed') {
    const why = (o.failureNote ?? '').trim();
    return why
      ? `Paid, and not fulfilled: ${why}`
      : 'Paid, and not fulfilled. The reason was not recorded.';
  }
  if (o.status === 'paid' && !o.inLedger) {
    return 'Paid, and not in the payment record. The member has what they bought and this money is missing from every figure on this page. The usual cause is the month having been closed when the sale landed.';
  }
  return null;
}
