"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// What actually landed in the bank. Compile with tsc, run under plain node.
//
// This section answers the one figure coaches argue with, so the ways it can be
// wrong are all ways of overstating what a coach has:
//
//   · money IN TRANSIT counted as money in a bank account, which is the figure
//     somebody plans a rent payment around and then does not have;
//   · a Stripe status this app does not recognise read as "arrived", which is
//     the coercion that feels natural and is the one that lies;
//   · a payout SUBTRACTED from the charges above it, producing a "fees" figure
//     that is wrong on all three numbers because a payout is a balance rather
//     than the proceeds of a sale;
//   · an empty list read as "Stripe has paid you nothing", when the far more
//     likely cause is that the Connect webhook destination has not been
//     subscribed to payout events yet;
//   · a total stated over a read that did not come back whole.
const coachPayouts_1 = require("./coachPayouts");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => { if (!Object.is(a, b))
    errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); };
const pay = (over = {}) => ({
    id: 'po_1',
    amountCents: 428100,
    currency: 'aed',
    status: 'paid',
    arrivalOn: '2026-08-28',
    failureMessage: null,
    ...over,
});
/* ── 1. Stripe's word, never coerced ────────────────────────────────────── */
eq((0, coachPayouts_1.payoutState)('paid'), 'arrived', 'paid is arrived');
eq((0, coachPayouts_1.payoutState)('pending'), 'on-the-way', 'pending is on the way');
eq((0, coachPayouts_1.payoutState)('in_transit'), 'on-the-way', 'and so is in transit');
eq((0, coachPayouts_1.payoutState)('failed'), 'failed', 'failed is failed');
eq((0, coachPayouts_1.payoutState)('canceled'), 'failed', 'and so is cancelled, however it is spelled');
eq((0, coachPayouts_1.payoutState)('cancelled'), 'failed', 'either spelling');
eq((0, coachPayouts_1.payoutState)('PAID'), 'arrived', 'case is not a different status');
// THE coercion that must not happen. Stripe may add a status tomorrow, and
// treating anything not obviously bad as arrived tells a coach money is in
// their bank when Stripe never said it was.
eq((0, coachPayouts_1.payoutState)('settled'), 'unknown', 'a status this app has never seen is unknown, never arrived');
eq((0, coachPayouts_1.payoutState)(''), 'unknown', 'and so is an empty one');
eq((0, coachPayouts_1.payoutState)(null), 'unknown', 'and a missing one');
eq((0, coachPayouts_1.payoutStateLabel)('settled'), 'Not Stated', 'and it says so on the row rather than guessing');
eq((0, coachPayouts_1.payoutStateLabel)('paid'), 'Arrived', 'a known status has its own label');
/* ── 2. only what has actually arrived is added up ──────────────────────── */
{
    const s = (0, coachPayouts_1.payoutSummary)([
        pay({ id: 'a', amountCents: 400000 }),
        pay({ id: 'b', amountCents: 100000, status: 'in_transit' }),
        pay({ id: 'c', amountCents: 50000, status: 'failed', failureMessage: 'Account number is invalid.' }),
        pay({ id: 'd', amountCents: 900000, status: 'settled' }),
    ], 'ready');
    eq(s.arrived.pots.length, 1, 'one currency, one pot');
    // 400000 only. Money in transit is not money in a bank account, and a total
    // that mixed the two is the figure a coach plans a rent payment around.
    eq(s.arrived.pots[0].minorUnits, 400000, 'only the arrived payout is in the figure');
    eq(s.onTheWay, 1, 'the one in transit is counted separately');
    eq(s.failed, 1, 'so is the failed one');
    eq(s.unknown, 1, 'and so is the one with a status nobody recognises');
    eq(s.withheld, null, 'nothing is withheld under a whole read');
}
// Currencies never merge, here as everywhere.
{
    const s = (0, coachPayouts_1.payoutSummary)([pay({ id: 'a', currency: 'aed' }), pay({ id: 'b', currency: 'gbp', amountCents: 90000 })], 'ready');
    eq(s.arrived.pots.length, 2, 'two currencies stay two pots');
}
// An amount with no unit is a hole in the total, counted rather than dropped.
{
    const s = (0, coachPayouts_1.payoutSummary)([pay({ currency: null })], 'ready');
    eq(s.arrived.unlabelled, 1, 'an unlabelled payout is counted');
    eq(s.arrived.pots.length, 0, 'and is in no pot');
}
/* ── 3. no figure over a read that was not whole ────────────────────────── */
for (const bad of ['error', 'partial', 'loading']) {
    const s = (0, coachPayouts_1.payoutSummary)([pay()], bad);
    eq(s.arrived, null, `no arrived figure under '${bad}'`);
    eq(s.onTheWay, null, `and no count of what is in transit under '${bad}'`);
    eq(s.failed, null, `and no count of failures under '${bad}'`);
    ok(!!s.withheld, `and a reason is given under '${bad}'`);
}
ok(/not a statement that nothing has been paid out/i.test((0, coachPayouts_1.payoutSummary)([], 'error').withheld), 'a failed read says outright that it is not a statement about the bank');
/* ── 4. a payout that bounced is the row to act on ──────────────────────── */
{
    const line = (0, coachPayouts_1.payoutFailureLine)(pay({ status: 'failed', failureMessage: 'Account number is invalid.' }));
    ok(!!line, 'a failed payout produces a sentence');
    // Stripe's words, QUOTED rather than paraphrased. This app does not know what
    // any particular failure means and would be guessing.
    ok(line.includes('Account number is invalid.'), 'and it quotes Stripe’s own reason');
    ok(/stays in your Stripe balance/i.test(line), 'and says where the money is instead');
}
{
    const line = (0, coachPayouts_1.payoutFailureLine)(pay({ status: 'failed', failureMessage: null }));
    ok(!!line, 'a failure with no reason still produces a sentence');
    ok(/did not say why/i.test(line), 'that says the reason is missing rather than inventing one');
}
eq((0, coachPayouts_1.payoutFailureLine)(pay({ status: 'paid' })), null, 'an arrived payout has no failure line');
eq((0, coachPayouts_1.payoutFailureLine)(pay({ status: 'in_transit' })), null, 'and neither has one on the way');
/* ── 5. an empty list is not "you have been paid nothing" ───────────────── */
// The far more likely cause is that the Connect webhook destination has not
// been subscribed to `payout.*` yet — part 194's deployment note is the other
// half of this. A coach told the confident version would be told something
// false about their own bank account.
{
    const line = (0, coachPayouts_1.payoutsEmptyLine)('ready');
    ok(/not the same as not having been paid/i.test(line), 'a whole read over nothing says it is not a statement about the bank');
    ok(/switched on at Stripe/i.test(line), 'and names the reason nothing may be arriving here');
}
ok(/could not be read/i.test((0, coachPayouts_1.payoutsEmptyLine)('error')), 'a failed read says the read failed');
ok(!/not the same as not having been paid/i.test((0, coachPayouts_1.payoutsEmptyLine)('error')), 'and does not reuse the other sentence');
/* ── 6. the subtraction that must never be offered ──────────────────────── */
// "Taken 4,800, landed 4,281, so the fees were 519" is wrong on all three
// numbers: they cover different transactions over different periods on Stripe's
// own schedule. The page says so rather than leaving the reader to do it.
ok(/not the proceeds of one sale/i.test(coachPayouts_1.PAYOUT_IS_NOT_A_SALE), 'the page says a payout is not a sale');
ok(/never subtracted from each other/i.test(coachPayouts_1.PAYOUT_IS_NOT_A_SALE), 'and that the two are never netted');
ok(/less what Stripe and Repple took/i.test(coachPayouts_1.PAYOUT_IS_NOT_A_SALE), 'and says what a balance is made of');
ok(/cannot see your bank/i.test(coachPayouts_1.PAYOUT_STRIPE_IS_THE_RECORD), 'and that this app holds no bank details');
ok(/Stripe dashboard is the record/i.test(coachPayouts_1.PAYOUT_STRIPE_IS_THE_RECORD), 'and that Stripe remains the authority');
console.log(errors.length ? 'COACH PAYOUT FAILURES:\n' + errors.join('\n') : 'ALL COACH PAYOUT TESTS PASSED');
if (errors.length)
    process.exit(1);
