// A discount code on a package. Compile with tsc, run under plain node.
//
// The failure this file is mostly about is not a wrong discount, it is a code
// that LOOKS like it works and does not:
//
//   · a code on a ONE-OFF package whose discount this app cannot state exactly.
//     Repple's cut there is an absolute figure Stripe wants in the same call it
//     works the discount out in, so it has to come off a total THIS CODE
//     computed — and Stripe documents no rounding rule for a percentage
//     discount anywhere, so a total that needed rounding is a guess and a guess
//     one minor unit out is a coach underpaid on every sale of that package
//     forever. Every shape that cannot be computed exactly is refused by name;
//   · a discount so large the platform fee exceeds what is left, which is the
//     same failure arriving through a number rather than through a package
//     kind;
//   · a code the coach was shown one way and Stripe stored another, so the
//     poster says NEWYEAR25 and the working code is NEWYEAR;
//   · an expired or used-up code still reading as live;
//   · an amount off rather than a percentage, which would need a currency in a
//     white-label product and would do nothing at all for a client paying in a
//     different one.
//
// The same module runs on the server: supabase/functions/connect-promo imports
// it, so the rule the screen enforces and the rule a code is actually created
// against cannot drift apart.
import {
  normaliseCode,
  promoBlocker,
  promoState,
  promoStateLabel,
  promoUseLine,
  MAX_PERCENT_OFF,
  exactPercentOff,
  wholePercentsFor,
  oneOffDiscount,
  CODE_CANNOT_COME_OFF_THIS_ONE,
  type CouponShape,
  type CodeRestrictions,
  PROMO_IS_A_PERCENTAGE,
  PROMO_IS_TYPED_AT_CHECKOUT,
  PROMO_LIVES_AT_STRIPE,
  PROMO_WITHDRAW_IS_FORWARD_ONLY,
  checkoutCodeBlocker,
  codeAppliesTo,
  CODE_IS_FOR_ANOTHER_PACKAGE,
  type PromoCode,
  type PromoTarget,
} from './packagePromo';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => { if (!Object.is(a, b)) errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); };

const monthly: PromoTarget = { id: 'pk_sub', name: 'Monthly Coaching', billingInterval: 'month', active: true, priceCents: 60000 };
const yearly: PromoTarget = { id: 'pk_yr', name: 'Yearly Coaching', billingInterval: 'year', active: true, priceCents: 600000 };
// A round price: 30% of 25000 is 7500 exactly, so a code may go on it.
const oneOff: PromoTarget = { id: 'pk_pack', name: '10-Session Pack', billingInterval: null, active: true, priceCents: 25000 };
// The awkward one. No whole percentage divides 4999 exactly, so every code is
// refused on it and the coach is told to price the pack at a round figure.
const oddPriced: PromoTarget = { id: 'pk_odd', name: 'Taster Pack', billingInterval: null, active: true, priceCents: 4999 };

const promo = (over: Partial<PromoCode> = {}): PromoCode => ({
  id: 'promo_1',
  code: 'NEWYEAR',
  percentOff: 20,
  active: true,
  timesRedeemed: 0,
  maxRedemptions: null,
  expiresOn: null,
  packageId: 'pk_sub',
  ...over,
});

/* ── 1. the code a client actually types ────────────────────────────────── */

// Normalised HERE rather than left to Stripe, so the coach is shown the code
// their client will have to type. A coach shown "new year 25" while Stripe
// stored NEWYEAR25 prints the wrong thing on a poster.
eq(normaliseCode('new year 25'), 'NEWYEAR25', 'spaces go and the case is raised');
eq(normaliseCode('  SUMMER!  '), 'SUMMER', 'punctuation is dropped rather than kept');
eq(normaliseCode('sept-20'), 'SEPT20', 'and so are dashes');
eq(normaliseCode(''), '', 'nothing in, nothing out');
eq(normaliseCode('x'.repeat(60)).length, 40, 'and a very long one is cut rather than refused by Stripe later');

/* ── 2. THE restriction, and it is refused with a reason ────────────────── */

eq(promoBlocker('NEWYEAR', 20, monthly).length, 0, 'a monthly package may carry a code');
eq(promoBlocker('NEWYEAR', 20, yearly).length, 0, 'and so may a yearly one');

// The one that matters, and it is now conditional rather than flat. A one-off
// takes a code exactly where the discount lands on a whole number of minor
// units — because Repple's cut there is derived from the discounted total and
// Stripe documents no rounding rule for a percentage discount anywhere.
eq(promoBlocker('NEWYEAR', 30, oneOff).length, 0, '30% of a 25000 pack is 7500 exactly, so a one-off may carry that code');
eq(promoBlocker('NEWYEAR', 20, oneOff).length, 0, 'and so may 20%, which is 5000');

// A price that is a whole number of major units takes EVERY whole percentage,
// because it already divides by 100. That is not an accident of these numbers,
// it is the reason the rule is usable at all: a coach pricing a pack at £250.00
// can run any offer they like, and one pricing it at £49.99 can run none.
eq(promoBlocker('NEWYEAR', 33, oneOff).length, 0, 'any whole percentage divides a price that is whole major units');
eq(promoBlocker('NEWYEAR', 7, oneOff).length, 0, 'including the awkward-looking ones');
{
  const blocked = promoBlocker('NEWYEAR', 20, oddPriced);
  ok(blocked.length > 0, 'a percentage that does not divide the price exactly is refused');
  const why = blocked.join(' ');
  ok(/whole number of the smallest unit/i.test(why), 'and the reason names what is actually wrong');
  ok(/does not say anywhere how it rounds/i.test(why), 'and that the gap is in Stripe’s own documentation');
  ok(why.includes('Taster Pack'), 'and names the package, so a coach with six knows which one');
  ok(/nothing after the decimal point/i.test(why), 'and tells the coach what to do about it');
}

// A one-off with no usable price cannot carry one either, and says so as a
// price problem rather than as a percentage one.
ok(promoBlocker('NEWYEAR', 20, { ...oneOff, priceCents: 0 }).length > 0, 'a one-off with no price has nothing for a percentage to come off');

// The price never enters into a SUBSCRIPTION. Its cut is a percentage and comes
// down with the discount by itself, so 20% off an awkward 4999 is fine there
// and refused on the pack — which is the whole asymmetry this feature rests on.
eq(promoBlocker('NEWYEAR', 20, { ...monthly, priceCents: 4999 }).length, 0, 'a subscription takes any percentage at any price');

ok(promoBlocker('NEWYEAR', 20, null).length > 0, 'a code needs a package to be for');
ok(promoBlocker('NEWYEAR', 20, { ...monthly, active: false }).length > 0, 'a withdrawn package cannot carry one');

/* ── 3. the code, and the percentage ────────────────────────────────────── */

ok(promoBlocker('', 20, monthly).length > 0, 'a code with nothing in it is refused');
ok(promoBlocker('!!', 20, monthly).length > 0, 'and one that normalises to nothing');
ok(promoBlocker('AB', 20, monthly).length > 0, 'and one too short for Stripe to take');
eq(promoBlocker('ABC', 20, monthly).length, 0, 'three characters is enough');

ok(promoBlocker('NEWYEAR', 0, monthly).length > 0, 'a discount of nothing is not an offer');
ok(promoBlocker('NEWYEAR', -10, monthly).length > 0, 'nor is a negative one');
ok(promoBlocker('NEWYEAR', 12.5, monthly).length > 0, 'a fractional percentage is refused rather than rounded');
ok(promoBlocker('NEWYEAR', NaN, monthly).length > 0, 'NaN is not a percentage');
eq(promoBlocker('NEWYEAR', 1, monthly).length, 0, 'one per cent is a real offer');
eq(promoBlocker('NEWYEAR', MAX_PERCENT_OFF, monthly).length, 0, 'and the ceiling itself is allowed');

// The ceiling is about Stripe, not about generosity: an application fee must be
// strictly less than the charge, and a near-total discount leaves a charge
// smaller than the fee — which the CLIENT meets as a checkout that will not
// complete, with nothing anywhere naming the cause.
{
  const blocked = promoBlocker('NEWYEAR', MAX_PERCENT_OFF + 1, monthly);
  ok(blocked.length > 0, 'a discount past the ceiling is refused');
  ok(/checkout that simply fails/i.test(blocked.join(' ')), 'and the reason says what the client would meet');
}
ok(MAX_PERCENT_OFF < 100, 'the ceiling leaves something on the charge for the fee to be less than');

// Every problem at once, not the first: somebody who has left three fields
// wrong should be told all three rather than made to press the button thrice.
ok(promoBlocker('', 0, null).length >= 3, 'every problem is reported together');

/* ── 4. where a code stands ─────────────────────────────────────────────── */

const TODAY = '2026-09-01';

eq(promoState(promo(), TODAY), 'live', 'an ordinary code is live');
eq(promoState(promo({ active: false }), TODAY), 'withdrawn', 'a withdrawn one says so');
eq(promoState(promo({ expiresOn: '2026-08-31' }), TODAY), 'expired', 'a code past its end date is expired');
eq(promoState(promo({ expiresOn: '2026-09-01' }), TODAY), 'live', 'the end day itself still works, which is what a coach means by it');
eq(promoState(promo({ expiresOn: '2026-09-02' }), TODAY), 'live', 'and so does the day before');
eq(promoState(promo({ maxRedemptions: 5, timesRedeemed: 5 }), TODAY), 'used-up', 'a code at its limit is used up');
eq(promoState(promo({ maxRedemptions: 5, timesRedeemed: 4 }), TODAY), 'live', 'one short of the limit is still live');
eq(promoState(promo({ maxRedemptions: null, timesRedeemed: 400 }), TODAY), 'live', 'and a code with no limit never runs out');

// Withdrawn is read FIRST. A coach who has withdrawn a code has decided about
// it, and reporting it as merely expired would suggest extending the date
// would bring it back.
eq(promoState(promo({ active: false, expiresOn: '2020-01-01' }), TODAY), 'withdrawn', 'withdrawn is read ahead of expired');

eq(promoStateLabel('live'), 'Live', 'each state has its own label');
eq(promoStateLabel('used-up'), 'Used Up', 'including the one that is two words');

/* ── 5. what it has done ────────────────────────────────────────────────── */

ok(/Nobody has used it yet/i.test(promoUseLine(promo())), 'an unused code says nobody has used it, not "0 times"');
ok(/Used 1 time\b/.test(promoUseLine(promo({ timesRedeemed: 1 }))), 'one use is singular');
ok(/Used 4 times/.test(promoUseLine(promo({ timesRedeemed: 4 }))), 'and four is plural');
ok(/of 10/.test(promoUseLine(promo({ timesRedeemed: 4, maxRedemptions: 10 }))), 'a limit is shown beside the count');
ok(/stops working after 2026-12-31/.test(promoUseLine(promo({ expiresOn: '2026-12-31' }))), 'and an end date is named');
ok(!/of /.test(promoUseLine(promo({ timesRedeemed: 4 })).replace('Used 4 times', '')), 'and no limit is implied where there is none');

/* ── 5b. the client's end of the same code ──────────────────────────────── */

// The field on the client's checkout, and the rule the server re-runs. Its
// whole reason for existing is that a code typed on Stripe's own page is one
// nothing in this repo can see — so neither of the two rules below could be
// enforced at all until it existed.
eq(checkoutCodeBlocker('NEWYEAR25', monthly), null, 'a real code on a monthly package goes through');
eq(checkoutCodeBlocker('newyear25', yearly), null, 'a yearly package takes one too, and the case does not matter');
eq(checkoutCodeBlocker('  new year 25 ', monthly), null, 'and it is normalised the same way the coach saw it');

// A one-off is no longer refused HERE, and that is a statement about where the
// test can run rather than about the rule. Whether a code comes off a one-off
// depends on the COUPON, which only the server holds — it is resolved by
// `promotionCodes.list` on the coach's own Stripe account, after this has run.
// So this passes it through and `oneOffDiscount` below is the real gate.
eq(checkoutCodeBlocker('NEWYEAR25', oneOff), null, 'a one-off no longer refuses a code before the coupon is even known');

ok(!!checkoutCodeBlocker('', monthly), 'an empty box is not a code');
ok(!!checkoutCodeBlocker('!!!', monthly), 'and nor is punctuation, which normalises to nothing');
ok(!!checkoutCodeBlocker('AB', monthly), 'two characters is shorter than Stripe will take');
ok(!!checkoutCodeBlocker('NEWYEAR25', null), 'a package that could not be read cannot have a code checked against it');

// The restriction Stripe does not enforce. connect-promo records the package in
// METADATA, because this app's packages are inline prices with no Product for
// Stripe's `applies_to` to point at — so this is the only place it can hold.
ok(codeAppliesTo('pk_sub', 'pk_sub'), 'a code used on the package it was made for applies');
ok(!codeAppliesTo('pk_sub', 'pk_other'), 'and one used on another package does not');
ok(codeAppliesTo(null, 'pk_sub'), 'a code with no package recorded is not restricted by this app');
ok(codeAppliesTo('   ', 'pk_sub'), 'and a blank restriction is no restriction, not a refusal of everything');
ok(!/pk_/.test(CODE_IS_FOR_ANOTHER_PACKAGE), 'the refusal names no ids at a client');

/* ── 6. the four things the screen has to keep saying ───────────────────── */

// An amount off would need a CURRENCY, and Repple is white-labelled: a "£20
// off" code would do nothing for a client paying in dirhams, silently.
ok(/never a fixed amount/i.test(PROMO_IS_A_PERCENTAGE), 'the screen says why it is a percentage');
ok(/white-labelled/i.test(PROMO_IS_A_PERCENTAGE), 'and names the reason');

ok(/in the app/i.test(PROMO_IS_TYPED_AT_CHECKOUT), 'the coach is told where their client types it');
ok(/Have A Code/.test(PROMO_IS_TYPED_AT_CHECKOUT), 'and the words on the control they have to look for');
ok(/one copy of it and Stripe keeps it/i.test(PROMO_LIVES_AT_STRIPE), 'and that there is one copy of the count');

// The thing a coach would otherwise assume, and be wrong about a year later.
ok(/does not change what somebody already subscribed/i.test(PROMO_WITHDRAW_IS_FORWARD_ONLY),
  'withdrawing is forward-only and says so');
ok(/keep the price they signed up at/i.test(PROMO_WITHDRAW_IS_FORWARD_ONLY), 'and says what existing subscribers keep');

/* ── 7. WHAT ACTUALLY COMES OFF A ONE-OFF ───────────────────────────────── */
//
// The arithmetic Repple's cut on a one-off sale is derived from. Every
// assertion here is aimed at the same failure: a fee taken from a total Stripe
// did not charge, which underpays the coach by roughly the platform percentage
// of the difference on EVERY sale of that package, silently, forever.

/* exactPercentOff — the whole feature rests on this returning null rather than
   a rounded figure. Stripe does not document how it rounds a percentage
   discount, so where rounding would be needed there is no answer to give. */
eq(exactPercentOff(10000, 30), 3000, '30% of £100.00 is 3000 minor units exactly');
eq(exactPercentOff(25000, 7), 1750, 'and 7% of £250.00 is 1750');
eq(exactPercentOff(10000, 100), 10000, 'the whole of it is a legitimate discount');
eq(exactPercentOff(4999, 20), null, '20% of £49.99 is 999.8, which is not a number of pennies');
eq(exactPercentOff(4999, 50), null, 'and half of an odd number of pennies is half a penny');
eq(exactPercentOff(5000, 50), 2500, 'while half of £50.00 is exact');

// A yen has no minor unit, so its "minor units" ARE whole yen and the same rule
// reads correctly: 10% of ¥5000 is 500, and 10% of ¥5005 is 500.5 and refused.
eq(exactPercentOff(5000, 10), 500, 'a zero-decimal currency needs no special case');
eq(exactPercentOff(5005, 10), null, 'and it refuses a fraction of a yen the same way');

eq(exactPercentOff(10000, 0), null, 'nought per cent is not a discount');
eq(exactPercentOff(10000, -10), null, 'and a negative one is not a discount either');
eq(exactPercentOff(10000, 101), null, 'more than the whole thing is not a percentage off');
eq(exactPercentOff(10000, 12.5), null, 'a fractional percentage is refused rather than rounded');
eq(exactPercentOff(10000.5, 20), null, 'and a price that is not whole minor units is not a price');
eq(exactPercentOff(-100, 20), null, 'nor is a negative one');

// The multiplication happens before the division, on integers, so no float ever
// holds an intermediate. Written the other way round, `(4999 * 20) / 100` is
// 999.8000000000001 on some inputs and a whole-number test passes by accident.
eq(exactPercentOff(333333, 3), null, '3% of 333333 is 9999.99 minor units, so there is no answer to give');

/* wholePercentsFor — the half of the refusal the coach can act on. */
ok(/Any whole percentage/i.test(wholePercentsFor(10000)), 'a price in whole major units takes every percentage, and says so rather than listing ninety');
ok(/2%, 4%/.test(wholePercentsFor(250)), 'a price that takes only some is given the ones that work');
ok(/among others/.test(wholePercentsFor(250)), 'and told the list is not the whole of it');
ok(/No whole percentage/i.test(wholePercentsFor(4999)), 'and a price where none does is told that plainly');
ok(/nothing after the decimal point/i.test(wholePercentsFor(4999)), 'with the thing to do about it');
// Currency-neutral, because this sentence is read by a coach charging in
// dirhams as often as by one charging in sterling.
ok(!/pound|dollar|dirham|£|\$/i.test(wholePercentsFor(4999)), 'and names no currency, in a white-label product');
ok(/50%/.test(wholePercentsFor(2)), 'a two-unit price takes only 50% and 100%, and says so');

/* oneOffDiscount — the gate at the checkout, with the real coupon in hand. */
const coupon = (over: Partial<CouponShape> = {}): CouponShape => ({
  percentOff: 30,
  amountOff: null,
  amountOffCurrency: null,
  multiCurrency: false,
  appliesToProducts: false,
  valid: true,
  ...over,
});
const noLimits: CodeRestrictions = { minimumAmount: null, firstTimeTransaction: false, multiCurrency: false };

// The plain case, and the one the feature exists for.
{
  const plan = oneOffDiscount(10000, 'gbp', coupon(), noLimits);
  ok(plan.ok, '30% off a £100.00 pack is a discount this app can state');
  if (plan.ok) {
    eq(plan.discountCents, 3000, 'and it is 3000 minor units');
    eq(plan.totalCents, 7000, 'leaving 7000 for the fee to be worked out from');
  }
}

// An amount off in the SAME currency is the safest shape there is: Stripe
// subtracts an integer from an integer and nothing rounds anywhere.
{
  const plan = oneOffDiscount(10000, 'gbp', coupon({ percentOff: null, amountOff: 2500, amountOffCurrency: 'gbp' }), noLimits);
  ok(plan.ok, 'an amount off in the package’s own currency is exact');
  if (plan.ok) eq(plan.totalCents, 7500, 'and comes straight off the price');
}
{
  const plan = oneOffDiscount(10000, 'GBP', coupon({ percentOff: null, amountOff: 2500, amountOffCurrency: 'gbp' }), noLimits);
  ok(plan.ok, 'and the currencies are compared without caring about case');
}

// THE currency refusal. Repple is white-labelled: a "£20 off" coupon meeting a
// dirham package is either an error, a no-op or twenty dirhams off, and Stripe
// documents which of those nowhere at all.
{
  const plan = oneOffDiscount(60000, 'aed', coupon({ percentOff: null, amountOff: 2000, amountOffCurrency: 'gbp' }), noLimits);
  ok(!plan.ok, 'an amount off in another currency is refused rather than guessed at');
  if (!plan.ok) ok(/GBP/.test(plan.why) && /AED/.test(plan.why), 'and the reason names both currencies');
}

// A coupon worth the whole package. Stripe documents this as the way to make a
// session free, and it must produce a total of nought rather than a negative —
// `applicationFeeCents` then omits the fee, which is right twice: Repple's
// share of nothing is nothing, and Stripe creates no PaymentIntent at all.
{
  const plan = oneOffDiscount(10000, 'gbp', coupon({ percentOff: 100 }), noLimits);
  ok(plan.ok, 'a 100%-off code is a shape this app can state exactly');
  if (plan.ok) eq(plan.totalCents, 0, 'and it leaves nought, never a negative');
}
{
  const plan = oneOffDiscount(10000, 'gbp', coupon({ percentOff: null, amountOff: 999999, amountOffCurrency: 'gbp' }), noLimits);
  ok(plan.ok, 'an amount off larger than the price is clamped the way Stripe clamps it');
  if (plan.ok) eq(plan.totalCents, 0, 'to nought, and no further');
}

// The rounding refusal, which is the reason this function exists.
{
  const plan = oneOffDiscount(4999, 'gbp', coupon({ percentOff: 20 }), noLimits);
  ok(!plan.ok, '20% of £49.99 cannot be stated exactly, so it is refused');
  if (!plan.ok) ok(/does not document how it rounds/i.test(plan.why), 'and the reason is Stripe’s missing documentation, not this app’s arithmetic');
}

// Every shape whose effect on ONE line item cannot be computed. Each is a
// separate refusal with its own reason, because the reason is what a coach
// reads out of the log when their client says the code did not work.
{
  const cases: [string, CouponShape, CodeRestrictions][] = [
    ['an invalid coupon', coupon({ valid: false }), noLimits],
    ['a coupon restricted to Stripe products', coupon({ appliesToProducts: true }), noLimits],
    ['a multi-currency coupon', coupon({ multiCurrency: true }), noLimits],
    ['a coupon with both a percentage and an amount', coupon({ amountOff: 500, amountOffCurrency: 'gbp' }), noLimits],
    ['a coupon with neither', coupon({ percentOff: null }), noLimits],
    ['an amount off with no currency named', coupon({ percentOff: null, amountOff: 500 }), noLimits],
    ['an amount off of nought', coupon({ percentOff: null, amountOff: 0, amountOffCurrency: 'gbp' }), noLimits],
    ['a fractional percentage', coupon({ percentOff: 12.5 }), noLimits],
    ['a code with a minimum spend', coupon(), { ...noLimits, minimumAmount: 5000 }],
    ['a first-time-customer code', coupon(), { ...noLimits, firstTimeTransaction: true }],
    ['a code with per-currency minimums', coupon(), { ...noLimits, multiCurrency: true }],
  ];
  for (const [what, c, r] of cases) {
    const plan = oneOffDiscount(10000, 'gbp', c, r);
    ok(!plan.ok, what + ' is refused');
    if (!plan.ok) ok(plan.why.length > 20, 'and ' + what + ' is refused with a reason somebody can read');
  }
}

// A package with nothing usable to discount.
ok(!oneOffDiscount(10000, '', coupon(), noLimits).ok, 'a package with no currency has no money for a discount to be in');
ok(!oneOffDiscount(0, 'gbp', coupon(), noLimits).ok, 'and a price of nought has nothing to come off');
ok(!oneOffDiscount(-100, 'gbp', coupon(), noLimits).ok, 'and a negative price is not a price');

// What the CLIENT reads, which is one sentence for all of the above. They are
// not owed Repple's fee arithmetic and could not act on it; what they need is
// that the price shown is the price.
ok(/price shown/i.test(CODE_CANNOT_COME_OFF_THIS_ONE), 'the client is told the price shown is what they pay');
ok(!/fee|application|round|coupon|Stripe/i.test(CODE_CANNOT_COME_OFF_THIS_ONE), 'and is handed none of the platform’s own arithmetic');
ok(/coach/i.test(CODE_CANNOT_COME_OFF_THIS_ONE), 'and is told who to ask');

declare const process: { exit(code: number): void };
console.log(errors.length ? 'PACKAGE PROMO FAILURES:\n' + errors.join('\n') : 'ALL PACKAGE PROMO TESTS PASSED');
if (errors.length) process.exit(1);
