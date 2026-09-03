"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAYOUT_STRIPE_IS_THE_RECORD = exports.PAYOUT_IS_NOT_A_SALE = void 0;
exports.payoutState = payoutState;
exports.payoutStateLabel = payoutStateLabel;
exports.payoutFailureLine = payoutFailureLine;
exports.payoutSummary = payoutSummary;
exports.payoutsEmptyLine = payoutsEmptyLine;
const coachMoney_1 = require("./coachMoney");
function payoutState(status) {
    const s = String(status ?? '').trim().toLowerCase();
    if (s === 'paid')
        return 'arrived';
    if (s === 'pending' || s === 'in_transit')
        return 'on-the-way';
    if (s === 'failed' || s === 'canceled' || s === 'cancelled')
        return 'failed';
    return 'unknown';
}
/** The label for a row. Title Case: it heads a value rather than reading as
 *  prose. An unknown status says so rather than guessing. */
function payoutStateLabel(status) {
    const st = payoutState(status);
    if (st === 'arrived')
        return 'Arrived';
    if (st === 'on-the-way')
        return 'On The Way';
    if (st === 'failed')
        return 'Did Not Arrive';
    return 'Not Stated';
}
/**
 * What a failed payout means to the person waiting for the money.
 *
 * The most useful sentence this feature produces, and the reason
 * `failure_message` is stored at all: a payout that bounced because the bank
 * details are wrong is a coach who is not being paid and does not know it. The
 * message is STRIPE'S, quoted rather than paraphrased — this app does not know
 * what any particular failure means and would be guessing.
 */
function payoutFailureLine(p) {
    if (payoutState(p.status) !== 'failed')
        return null;
    const why = String(p.failureMessage ?? '').trim();
    return why
        ? `This one did not reach your bank. Stripe’s reason: ${why}. Until it is fixed, money stays in your Stripe balance rather than arriving.`
        : 'This one did not reach your bank and Stripe did not say why. Until it is sorted out, money stays in your Stripe balance rather than arriving.';
}
/**
 * Payouts summed by what Stripe says happened to them.
 *
 * ONLY the arrived ones are added up. A payout in transit is not money in a
 * bank account, and a total that mixed the two would be exactly the figure a
 * coach plans a rent payment around and then does not have.
 *
 * Through `sumTaken` rather than a private loop, for its two rules: currencies
 * never merge, and an amount with no unit is counted rather than dropped.
 */
function payoutSummary(rows, status) {
    if (status !== 'ready') {
        return {
            arrived: null,
            onTheWay: null,
            failed: null,
            unknown: null,
            withheld: status === 'partial'
                ? 'More payouts are on record than could be read in one request, so no figure is stated. What is listed is real; it is not all of it.'
                : status === 'loading'
                    ? 'Still reading what Stripe has paid out to you.'
                    : 'What Stripe has paid out to you could not be read, so no figure is stated. This is not a statement that nothing has been paid out.',
        };
    }
    const arrivedRows = [];
    let onTheWay = 0;
    let failed = 0;
    let unknown = 0;
    for (const p of rows) {
        const st = payoutState(p.status);
        if (st === 'arrived') {
            arrivedRows.push({
                amount_cents: p.amountCents,
                currency: p.currency,
                // The day the money reached the bank, which is the date a coach
                // reconciles on. A payout with no arrival date will not parse and is
                // therefore in no period, which is right: it is in the all-time figure
                // and in no month.
                created_at: p.arrivalOn ?? '',
            });
        }
        else if (st === 'on-the-way')
            onTheWay += 1;
        else if (st === 'failed')
            failed += 1;
        else
            unknown += 1;
    }
    return { arrived: (0, coachMoney_1.sumTaken)(arrivedRows), onTheWay, failed, unknown, withheld: null };
}
/* ── the sentences that keep this section honest ──────────────────────────── */
/**
 * That a payout is a balance and not a sale.
 *
 * On the screen, because the subtraction a reader would otherwise make in their
 * head — "taken 4,800, received 4,281, so the fees were 519" — is wrong on
 * every one of the three numbers. They cover different transactions over
 * different periods on Stripe's own schedule.
 */
exports.PAYOUT_IS_NOT_A_SALE = 'A payout is your Stripe balance reaching your bank, not the proceeds of one sale. It is many charges at once, less what Stripe and Repple took and anything refunded, on Stripe’s own schedule — so it does not line up with any figure above it and the two are deliberately never subtracted from each other.';
/**
 * That Stripe remains the record.
 *
 * This app now mirrors payouts and still holds no balance, no fee breakdown and
 * no bank details. What is here is what a webhook was told at the time.
 */
exports.PAYOUT_STRIPE_IS_THE_RECORD = 'These are mirrored from Stripe as each payout happens. Repple does not hold your balance, does not know what Stripe charged in fees, and cannot see your bank. Your Stripe dashboard is the record of what actually moved.';
/**
 * The sentence under an empty list, which depends entirely on the read AND on
 * whether the webhook is even subscribed.
 *
 * An empty list here is much more likely to mean "the Connect destination has
 * not been subscribed to payout events yet" than "Stripe has paid you nothing",
 * and a coach told the second about their own bank account would be told
 * something false. Part 194's deployment note is the other half of this.
 */
function payoutsEmptyLine(status) {
    if (status === 'error') {
        return 'Your payouts could not be read, so nothing is listed. That is not a statement that Stripe has paid you nothing.';
    }
    if (status === 'partial')
        return 'There are more payouts on record than could be read in one request, so nothing here is a total.';
    if (status === 'loading')
        return 'Still reading.';
    return 'No payout has been recorded here yet. That is not the same as not having been paid: this app only learns about a payout when Stripe tells it about one, and if that has not been switched on at Stripe’s end nothing will appear here however much has reached your bank. Your Stripe dashboard is the record either way.';
}
