"use strict";
// ── The ledger rows an online gym sale has to leave behind, both ways ───────
//
// The sale is the first half of this file and the REFUND is the second, below
// the banner two thirds of the way down. They are together because they are the
// same ledger and the same argument, and because a leaf module cannot import
// another one — splitting them would mean restating `LedgerMethod` twice.
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkoutMethod = checkoutMethod;
exports.gymOrderPaymentRow = gymOrderPaymentRow;
exports.onlineNote = onlineNote;
exports.isClosedMonthRefusal = isClosedMonthRefusal;
exports.onlineOrderProblem = onlineOrderProblem;
exports.refundHasSettled = refundHasSettled;
exports.refundsToMirror = refundsToMirror;
exports.refundTakenAt = refundTakenAt;
exports.refundNote = refundNote;
exports.gymRefundRow = gymRefundRow;
exports.overReversedBy = overReversedBy;
exports.refusalNote = refusalNote;
exports.refundStateForOrder = refundStateForOrder;
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
function checkoutMethod(types) {
    const seen = new Set((types ?? [])
        .map((t) => String(t ?? '').trim().toLowerCase())
        .filter((t) => t && t !== 'link'));
    if (seen.size !== 1)
        return 'other';
    const only = [...seen][0];
    if (only === 'card')
        return 'card';
    // Every direct-debit scheme Stripe Checkout offers. A gym billed under any of
    // them is billed by direct debit, which is a line the owner already reads.
    if (only === 'sepa_debit' || only === 'bacs_debit' || only === 'acss_debit' || only === 'au_becs_debit') {
        return 'direct_debit';
    }
    // `customer_balance` is Stripe's bank-transfer method: the member is given
    // account details and sends the money.
    if (only === 'customer_balance')
        return 'transfer';
    return 'other';
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
function gymOrderPaymentRow(args) {
    const { orderId, order, session, membershipId, takenAt } = args;
    const fromStripe = typeof session.amountTotal === 'number' && Number.isFinite(session.amountTotal)
        ? Math.round(session.amountTotal)
        : null;
    const quoted = typeof order.amountCents === 'number' && Number.isFinite(order.amountCents)
        ? Math.round(order.amountCents)
        : null;
    const amountCents = fromStripe ?? quoted;
    if (amountCents == null || amountCents < 0)
        return null;
    const currency = (session.currency ?? '').trim().toUpperCase()
        || (order.currency ?? '').trim().toUpperCase();
    if (!currency)
        return null;
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
function onlineNote(session) {
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
function isClosedMonthRefusal(err) {
    if (!err)
        return false;
    if ((err.code ?? '') === 'P0001')
        return true;
    return /has closed that month/i.test(String(err.message ?? ''));
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
 *
 *   · REFUNDED IN STRIPE, AND NOT IN THE LEDGER. The mirror of the case above
 *     and the reason supabase/parts/800 exists. The gym pressed Refund in its
 *     own Stripe dashboard, the money went back, and `gym_payments` still
 *     holds the whole original amount — so /money, /revenue, /accounting and
 *     /close all go on counting it.
 *
 *     This one is worse to leave unlisted than either of the others, because
 *     there is nothing wrong-LOOKING anywhere. A failed order has no
 *     entitlement behind it and a paid order with no ledger row is missing
 *     from a total. Here the sale, the entitlement and the payment row all
 *     exist and all read as correct. The payment is simply too big, and no
 *     screen in the product would draw it any differently.
 *
 * A paid order that reached the ledger, and whose refunds — if any — reached it
 * too, is not listed at all. It is an ordinary payment.
 */
function onlineOrderProblem(o) {
    if (o.status === 'failed') {
        const why = (o.failureNote ?? '').trim();
        return why
            ? `Paid, and not fulfilled: ${why}`
            : 'Paid, and not fulfilled. The reason was not recorded.';
    }
    if (o.status === 'paid' && !o.inLedger) {
        return 'Paid, and not in the payment record. The member has what they bought and this money is missing from every figure on this page. The usual cause is the month having been closed when the sale landed.';
    }
    // Deliberately after the two above and deliberately not merged with them. An
    // order that never reached the ledger cannot have a reversal against it
    // either, and reporting both would tell an owner to fix two things when there
    // is one.
    //
    // No figures in this sentence, and that is not squeamishness. This module is
    // a leaf — it may not import `money()` from src/lib/gymRecord.ts — so the
    // only way it could state an amount is bare or in a currency it assumed, and
    // both are the defect scripts/check-currency.mjs exists to stop. The amounts
    // are on the row the screen draws this beside.
    const refunded = typeof o.refundedCents === 'number' && Number.isFinite(o.refundedCents) ? o.refundedCents : 0;
    if (refunded > 0) {
        const reversed = typeof o.reversedCents === 'number' && Number.isFinite(o.reversedCents)
            ? Math.abs(o.reversedCents)
            : 0;
        if (reversed < refunded) {
            const why = (o.refundNote ?? '').trim();
            // "Some of it" and "none of it" are different jobs. A partly mirrored
            // refund means one instalment landed and another did not, and an owner
            // reading "not in the payment record" would go looking for a reversal
            // that is sitting right there.
            const head = reversed > 0
                ? 'Refunded in Stripe, and only part of that refund is in the payment record.'
                : 'Refunded in Stripe, and not in the payment record.';
            const tail = 'Every figure on this page still counts this money as taken.';
            return why ? `${head} ${tail} ${why}` : `${head} ${tail}`;
        }
    }
    return null;
}
/**
 * A refund Stripe has actually sent back, as opposed to one it is thinking
 * about.
 *
 * `charge.refunded` fires on the charge, and the refunds hanging off it are not
 * all necessarily money that has moved: a refund to a delayed-settlement method
 * sits at 'pending' and one that bounces ends at 'failed' or 'canceled'.
 * Mirroring a pending refund would take money off a gym's takings that its
 * member has not been given back, and there is no later event that would put it
 * right in the direction that matters — the gym would simply under-report until
 * somebody noticed.
 *
 * A refund with NO status stated is treated as settled. Stripe has always
 * stated one on a real refund; the missing case is a hand-built object in a
 * test or an older API shape, and refusing those would silently mirror nothing
 * at all rather than visibly mirroring the wrong thing.
 */
function refundHasSettled(r) {
    const s = String(r.status ?? '').trim().toLowerCase();
    return s === '' || s === 'succeeded';
}
/**
 * Which of a charge's refunds this ledger has not recorded yet.
 *
 * The webhook reads the `stripe_refund_id`s already sitting against the sale
 * and passes them in. That read is the cheap guard and the UNIQUE index from
 * supabase/parts/800 is the one that actually holds — two deliveries racing
 * both find nothing and both try, and exactly one of them gets 23505.
 *
 * Duplicated ids WITHIN the list are collapsed, because Stripe's refund list is
 * paginated and a caller stitching pages together can hand the same object
 * twice. Two inserts of the same id in one delivery would collide with each
 * other, which is not wrong but is a 23505 that means something different from
 * the one the index is there to raise.
 */
function refundsToMirror(refunds, alreadyMirrored) {
    const seen = new Set((alreadyMirrored ?? []).map((x) => String(x ?? '').trim()).filter(Boolean));
    const out = [];
    for (const r of refunds ?? []) {
        const id = String(r?.id ?? '').trim();
        if (!id || seen.has(id))
            continue;
        if (!refundHasSettled(r))
            continue;
        seen.add(id);
        out.push(r);
    }
    return out;
}
/**
 * When a reversal is dated, and why it is not the sale's date.
 *
 * supabase/parts/180 argues this at length: a refund handed back in September
 * belongs in September. Back-dating it onto the original's `taken_at` would
 * change a month that has already been reported, and it would quietly walk
 * around the closed-month lock supabase/parts/182 exists to enforce — the
 * refund would land in a filed August and restate a figure somebody has given
 * their accountant.
 *
 * It is Stripe's instant for the REFUND and not for the event and not now(). A
 * delivery retried three days late must not file Saturday's money on Tuesday,
 * and one `charge.refunded` can carry refunds made on different days.
 */
function refundTakenAt(r, fallbackISO) {
    const s = r.createdSeconds;
    if (typeof s === 'number' && Number.isFinite(s) && s > 0) {
        return new Date(Math.round(s) * 1000).toISOString();
    }
    return fallbackISO;
}
/** What the note on a reversal says, and why it says the id. */
function refundNote(refundId) {
    const ref = String(refundId ?? '').trim();
    // The row an owner lands on when the bank statement and the ledger disagree.
    // The only useful thing it can carry is the string that finds the refund in
    // the Stripe dashboard.
    return ref ? `Refunded through Stripe. ${ref}` : 'Refunded through Stripe.';
}
/**
 * The reversal for one Stripe refund, or the reason it cannot honestly be
 * written.
 *
 * ── PARTIAL REFUNDS: what is mirrored is what was refunded ────────────────
 *
 * `refund.amount` and nothing else. Not the sale's amount, not
 * `charge.amount_refunded`, and not a figure recomputed from either.
 *
 *   · NOT THE SALE. `charge.refunded` fires for a partial refund exactly as it
 *     does for a full one, and there is nothing in the event that says which it
 *     was. A gym refunding one month of a twelve-month membership that a member
 *     is leaving mid-term is the ordinary case, not the exotic one. Reversing
 *     the whole sale for it would take eleven months of somebody's money off
 *     the gym's takings, and — because a reversal nets silently into every SUM
 *     in the console — it would do it without anything looking wrong.
 *
 *   · NOT THE RUNNING TOTAL. `charge.amount_refunded` is the sum across every
 *     refund on the charge. The client-side tables assign it, and that is right
 *     for them because they hold ONE `refunded_cents` per sale. It is exactly
 *     wrong here: rows ACCUMULATE, so a second partial refund carrying the
 *     running total would reverse the first one twice. Two 2000 refunds would
 *     take 6000 off the ledger.
 *
 *   · NOT RECOMPUTED. Nothing here divides, multiplies or prorates. The amount
 *     is Stripe's integer of minor units, negated, in the sale's own currency.
 *     `Math.round` is applied only because Stripe's field is typed as a number
 *     and a fractional minor unit is not a thing this column can hold.
 *
 * The running total still matters — it is what the reconciliation compares the
 * sum of these rows against — and it is stored on `gym_orders.refunded_cents`
 * by the webhook, well away from anything that adds money up.
 *
 * ── Why it can refuse ─────────────────────────────────────────────────────
 *
 * A CURRENCY THAT DISAGREES. `reversePayment` in src/lib/gymRecord.ts states
 * the rule for the hand-entered case: "You cannot refund pounds against a
 * payment taken in dirhams." A reversal is denominated in the original's money
 * because that is the only way it nets against it; a row in another currency
 * would sit in the ledger as an unexplained pair and would be added to a total
 * in a unit it is not in. Stripe refunds in the charge's currency, so a
 * disagreement here means this app's record of the sale and Stripe's disagree
 * about what was taken — which is a thing for a person, not a thing to net.
 *
 * A ZERO OR NEGATIVE AMOUNT. Part 180's `gym_payments_correction_shape`
 * requires a reversal to be strictly negative, and it is right to: a zero
 * reversal reverses nothing and a positive one is a second payment. Zero is
 * legal on the SALE side — a fully discounted joining fee is a real transaction
 * — and that asymmetry is deliberate and is argued in part 180's header.
 *
 * A refusal is a string an owner can read, because it ends up on
 * `gym_orders.refund_note` and from there on the reconciliation screen. It is
 * not an exception: the webhook must go on to record what Stripe did even when
 * it cannot mirror it, and throwing would lose that.
 */
function gymRefundRow(args) {
    const { sale, refund, fallbackAtISO } = args;
    const refundId = String(refund?.id ?? '').trim();
    if (!refundId) {
        return { row: null, refusal: 'Stripe sent a refund with no id on it, so there is no way to record it once and only once.' };
    }
    const amount = typeof refund.amountCents === 'number' && Number.isFinite(refund.amountCents)
        ? Math.round(refund.amountCents)
        : null;
    if (amount == null || amount <= 0) {
        return { row: null, refusal: 'Stripe stated no amount on this refund, so nothing could be taken off the payment record.' };
    }
    const saleCurrency = String(sale.currency ?? '').trim().toUpperCase();
    if (!saleCurrency) {
        // Unreachable through the webhook — `gym_payments.currency` is NOT NULL and
        // has had no default since supabase/parts/150 — and refused rather than
        // assumed anyway. There is nothing to fall back on in a white-label
        // product: a currency invented here is a permanent wrong stamp on a row an
        // accountant files.
        return { row: null, refusal: 'The payment being refunded states no currency, so a reversal against it could not be denominated.' };
    }
    const refundCurrency = String(refund.currency ?? '').trim().toUpperCase();
    if (refundCurrency && refundCurrency !== saleCurrency) {
        return {
            row: null,
            refusal: `Stripe refunded in ${refundCurrency} and the payment it reverses was taken in ${saleCurrency}. A reversal in a different money would not net against the payment, so it has been left for a person.`,
        };
    }
    return {
        row: {
            tenant_id: sale.tenantId,
            member_id: sale.memberId,
            membership_id: sale.membershipId,
            stripe_refund_id: refundId,
            // What makes this a correction rather than a bare negative. Part 180's
            // CHECK requires it, and the `on delete restrict` on it means the
            // original cannot be lost while this row stands.
            reverses_payment_id: sale.paymentId,
            amount_cents: -amount,
            // The original's money, always.
            currency: saleCurrency,
            // How it arrived. Not chosen here: `reversePayment` defaults a
            // hand-entered correction to the original's method for the same reason,
            // and a card sale refunded to the same card is the only shape a Stripe
            // refund has.
            method: sale.method,
            taken_at: refundTakenAt(refund, fallbackAtISO),
            note: refundNote(refundId),
            kind: 'refund',
            // Nobody at the desk handed this back. `recorded_by` names a member of
            // staff and filling it with anybody would be a false statement about who
            // handled the money.
            recorded_by: null,
        },
        refusal: null,
    };
}
/**
 * Stripe has sent back more than this ledger thinks was ever taken — by how
 * much, or 0 when it has not.
 *
 * All figures in minor units and positive. `alreadyReversedCents` is the sum of
 * what is already recorded against the payment, `thisRefundCents` the one being
 * added.
 *
 * ── Why this does not refuse ──────────────────────────────────────────────
 *
 * `reversalBlocker` in src/lib/gymRecord.ts REFUSES an over-reversal, and that
 * is right for the screen it guards: an owner typing a bigger number than is
 * left on a payment has made a mistake and the form should say so before it
 * writes anything.
 *
 * This is the opposite situation and takes the opposite answer. The money has
 * already gone back. It went back in Stripe, days ago, and nothing this code
 * does can un-refund it. Declining to record it would leave the ledger
 * overstating the gym's takings by the whole refund — which is precisely the
 * defect this module was written to fix — in exchange for keeping one row's
 * arithmetic tidy.
 *
 * So it is recorded, and the discrepancy is reported. The only way here is that
 * this app's `amount_cents` for the sale is smaller than what Stripe actually
 * charged: the sale fell back to the order's QUOTE because the checkout session
 * stated no total (see `gymOrderPaymentRow`), or somebody edited the charge in
 * Stripe. Both are facts about a disagreement between two systems, and both
 * need a person rather than a silently dropped write. It is the same call the
 * client-side branch makes when part 192's `refunded_cents <= amount_cents`
 * CHECK fires: log it, accept the event, leave the row visibly wrong rather
 * than invisibly retried.
 */
function overReversedBy(saleAmountCents, alreadyReversedCents, thisRefundCents) {
    const sale = Number.isFinite(saleAmountCents) ? saleAmountCents : 0;
    const already = Number.isFinite(alreadyReversedCents) ? Math.abs(alreadyReversedCents) : 0;
    const now = Number.isFinite(thisRefundCents) ? Math.abs(thisRefundCents) : 0;
    const over = already + now - sale;
    return over > 0 ? over : 0;
}
/**
 * The note left on `gym_orders.refund_note` when a refund could not be
 * mirrored, or null when every one of them was.
 *
 * One line per reason, joined, because a charge can carry several refunds and
 * they can fail for different reasons — a first one refused by a closed month
 * and a second one in a currency that disagrees. A note that reported only the
 * last would send the owner to fix half of it.
 *
 * This is the REASON, not the exception. The exception is derived from
 * `gym_orders.refunded_cents` against the sum of reversals — see part 800 —
 * so it clears itself the moment somebody records the correction by hand.
 * A note that was itself the exception would sit there forever, because Stripe
 * does not redeliver an event it has already had a 200 for and nothing would
 * ever come back to take it down.
 */
function refusalNote(refusals) {
    const lines = (refusals ?? []).map((r) => String(r ?? '').trim()).filter(Boolean);
    if (!lines.length)
        return null;
    // Deduplicated: two refunds on one charge refused by the closed-month lock
    // produce the same sentence twice, and repeating it says nothing the first
    // one did not.
    const seen = [];
    for (const l of lines)
        if (!seen.includes(l))
            seen.push(l);
    return seen.join(' ');
}
/**
 * What Stripe did, as the three columns supabase/parts/800 put on `gym_orders`.
 *
 * The webhook writes this FIRST and unconditionally, before it attempts a
 * single reversal, and that order is the point. `gym_orders` is not locked by
 * part 182's closed-month trigger (only `gym_payments` and `gym_invoices` are),
 * so this write always lands — which means the record of what Stripe did
 * survives even when the ledger refuses the consequence of it. Written last, it
 * would be missing in exactly the case this whole part exists for.
 *
 * The note is deliberately NOT here. It is the outcome of trying, so it is a
 * second write after the loop, through `refusalNote`.
 *
 * The total is Stripe's `amount_refunded`, ASSIGNED. Never added: an addition
 * is wrong under the retry this whole module is defending against, and wrong in
 * the same way `client_purchases.refunded_cents` would be — two deliveries
 * racing, each adding its own figure to a total it read a moment earlier.
 * Assignment is idempotent by construction, and it is also the reason this
 * figure lives on the ORDER and not in the ledger: `gym_payments` accumulates
 * rows, and a running total assigned into an accumulating table is the double
 * count `gymRefundRow` refuses above.
 *
 * The currency is Stripe's, upper-cased, and is NOT defaulted to the order's.
 * If they disagree the reversal is refused above, and this column is how a
 * screen can say what the disagreement was rather than drawing a figure in a
 * money nobody chose.
 */
function refundStateForOrder(args) {
    const total = typeof args.amountRefundedCents === 'number' && Number.isFinite(args.amountRefundedCents)
        ? Math.max(0, Math.round(args.amountRefundedCents))
        : 0;
    const cur = String(args.currency ?? '').trim().toUpperCase();
    return {
        refundedCents: total,
        // NULL rather than a guess. supabase/parts/800's CHECK accepts only three
        // upper-case letters, and a blank string would fail the write outright on
        // an event that happened to state nothing.
        refundedCurrency: /^[A-Z]{3}$/.test(cur) ? cur : null,
        refundedAt: args.atISO,
    };
}
