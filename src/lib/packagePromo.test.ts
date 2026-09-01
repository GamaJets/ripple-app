// A discount code on a package. Compile with tsc, run under plain node.
//
// The failure this file is mostly about is not a wrong discount, it is a code
// that LOOKS like it works and does not:
//
//   · a code on a ONE-OFF package. Repple's cut there is an absolute figure
//     worked out from the list price before anybody types anything, so a coach
//     running 30% off would receive 70% and still pay a fee on 100% — and at a
//     big enough discount Stripe refuses the charge outright and the client
//     meets a checkout that will not complete;
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
  PROMO_IS_A_PERCENTAGE,
  PROMO_IS_TYPED_AT_CHECKOUT,
  PROMO_LIVES_AT_STRIPE,
  PROMO_WITHDRAW_IS_FORWARD_ONLY,
  type PromoCode,
  type PromoTarget,
} from './packagePromo';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => { if (!Object.is(a, b)) errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); };

const monthly: PromoTarget = { id: 'pk_sub', name: 'Monthly Coaching', billingInterval: 'month', active: true };
const yearly: PromoTarget = { id: 'pk_yr', name: 'Yearly Coaching', billingInterval: 'year', active: true };
const oneOff: PromoTarget = { id: 'pk_pack', name: '10-Session Pack', billingInterval: null, active: true };

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

// The one that matters. Not "the option is missing" — the coach reads WHY, in
// terms of their own money, because otherwise the obvious conclusion is that
// the feature is broken.
{
  const blocked = promoBlocker('NEWYEAR', 20, oneOff);
  ok(blocked.length > 0, 'a one-off package may NOT carry a code');
  const why = blocked.join(' ');
  ok(/one-off sale/i.test(why), 'and the reason names what kind of package it is');
  ok(/fee on money you did not receive/i.test(why), 'and says what it would cost the coach');
  ok(/comes down with the price/i.test(why), 'and why a subscription is different');
  ok(why.includes('10-Session Pack'), 'and names the package, so a coach with six knows which one');
}

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
ok(promoBlocker('', 0, oneOff).length >= 3, 'every problem is reported together');

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

/* ── 6. the four things the screen has to keep saying ───────────────────── */

// An amount off would need a CURRENCY, and Repple is white-labelled: a "£20
// off" code would do nothing for a client paying in dirhams, silently.
ok(/never a fixed amount/i.test(PROMO_IS_A_PERCENTAGE), 'the screen says why it is a percentage');
ok(/white-labelled/i.test(PROMO_IS_A_PERCENTAGE), 'and names the reason');

ok(/on the payment page/i.test(PROMO_IS_TYPED_AT_CHECKOUT), 'the coach is told where their client types it');
ok(/one copy of it and Stripe keeps it/i.test(PROMO_LIVES_AT_STRIPE), 'and that there is one copy of the count');

// The thing a coach would otherwise assume, and be wrong about a year later.
ok(/does not change what somebody already subscribed/i.test(PROMO_WITHDRAW_IS_FORWARD_ONLY),
  'withdrawing is forward-only and says so');
ok(/keep the price they signed up at/i.test(PROMO_WITHDRAW_IS_FORWARD_ONLY), 'and says what existing subscribers keep');

declare const process: { exit(code: number): void };
console.log(errors.length ? 'PACKAGE PROMO FAILURES:\n' + errors.join('\n') : 'ALL PACKAGE PROMO TESTS PASSED');
if (errors.length) process.exit(1);
