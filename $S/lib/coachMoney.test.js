"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// What a coach is told about their own money.
// Compile with tsc, run with node.
//
// Four things are defended here, and every one of them is a figure that would
// look entirely ordinary on the payments screen while being false about
// somebody's income:
//
// 1. Two currencies are never added together. A coach who takes AED from their
//    regulars and GBP from a visitor has two pots, not a total of 690 of
//    nothing. This is the whole reason `sumTaken` returns a list.
//
// 2. A purchase whose currency is unknown is neither summed nor dropped.
//    `client_purchases` carries its own `currency` since part 132 — the
//    stripe-webhook writes the Checkout Session's own unit onto every sale —
//    so an unlabelled amount is now a narrow case rather than the common one
//    this comment used to describe. What is left is a sale made BEFORE that
//    column existed whose package had already been deleted: the unit lived only
//    on that package, and it is gone forever. Summed, it corrupts the total
//    with a number in the wrong denomination; dropped, it makes the total
//    quietly short. It is counted separately so the screen can say so.
//
// 3. A membership has no credits, so it has no balance — `null`, not `0`.
//    "0 sessions left" beside a membership reads as a client who has used up
//    everything they paid for, and it is the sentence that would have a coach
//    chasing somebody for money they do not owe.
//
// 4. `sumTaken` does not touch the array it is handed. The payments screen
//    passes the same rows to the summary and to the list beside it, and a sort
//    in place would silently reorder a list the coach is reading.
//
// No formatted date is asserted against a literal: `npm test` runs three times
// under three timezones (`test:zones`), and `monthStart` is a LOCAL boundary,
// so the expectations here are computed with the same helper the code uses.
// 5. A coach's takings come from two tables and are added up in one figure.
//    One-off sales live in `client_purchases`; renewals live in
//    `client_subscription_payments` (part 132), which did not exist until the
//    webhook was taught to write it. `combineTaken` merges the two subtotals,
//    and it has to keep every rule above while doing it: currencies stay apart,
//    the counts of unlabelled and unpriced rows ADD rather than being taken
//    from whichever side had more, and neither subtotal is modified — the
//    screen renders both of them beside the total.
const coachMoney_1 = require("./coachMoney");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const T = (over) => ({ amount_cents: 60000, currency: 'aed', created_at: '2026-08-10T09:00:00.000Z', ...over });
/* ── money, in the currency it was actually charged in ────────────────────── */
eq((0, coachMoney_1.minorMoney)(60000, 'aed'), 'AED 600.00', 'minor units divide by a hundred and the code is spelled out');
eq((0, coachMoney_1.minorMoney)(60000, 'AED'), 'AED 600.00', 'the currency code is case-insensitive coming in');
eq((0, coachMoney_1.minorMoney)(50000, 'jpy'), 'JPY 50,000', 'a zero-decimal currency is not divided — ¥50,000 is not ¥500');
eq((0, coachMoney_1.minorMoney)(1234567, 'gbp'), 'GBP 12,345.67', 'four digits and up carry a thousands separator');
eq((0, coachMoney_1.wholeMoney)(75, 'aed'), 'AED 75.00', 'a rate somebody typed is already in whole units');
eq((0, coachMoney_1.wholeMoney)(5000, 'jpy'), 'JPY 5,000', 'a whole-unit zero-decimal amount is left alone too');
eq((0, coachMoney_1.wholeMoney)(75.5, 'gbp'), 'GBP 75.50', 'a typed rate keeps its half');
// `gymMoney` in src/ui/tenant.tsx is a one-line delegate to this, and it used
// to convert a whole-unit figure UP by a hundred and let `minorMoney` divide it
// back down. That round trip is exact in the currencies that have a hundred
// minor units and in no others, so a JPY 6,300 session fee printed as
// "JPY 630,000" and a KWD 40 one as "KWD 4.000". This is the line that has to
// stay true for the owner console's payroll figures.
eq((0, coachMoney_1.wholeMoney)(6300, 'jpy'), 'JPY 6,300', 'a whole-unit yen figure is neither multiplied nor divided');
eq((0, coachMoney_1.wholeMoney)(40, 'kwd'), 'KWD 40.000', 'and a whole-unit dinar keeps its own three places rather than losing a factor of ten');
// The half that matters in a white-label product. There is no currency this
// code could fall back to that is not wrong for one of the gyms running it.
eq((0, coachMoney_1.minorMoney)(60000, null), null, 'no currency is not dollars — the amount is withheld');
eq((0, coachMoney_1.minorMoney)(60000, '  '), null, 'a blank currency is no currency');
eq((0, coachMoney_1.minorMoney)(null, 'aed'), null, 'no amount is not zero');
eq((0, coachMoney_1.minorMoney)(0, 'aed'), 'AED 0.00', 'a real zero is a real zero and is still printed');
eq((0, coachMoney_1.moneyIn)(Number.NaN, 'aed', true), null, 'NaN is not a figure');
/* ── how many decimal places this money has ───────────────────────────────── */
eq((0, coachMoney_1.currencyDecimals)('gbp'), 2, 'most of the world has two');
eq((0, coachMoney_1.currencyDecimals)('JPY'), 0, 'and a yen has none');
eq((0, coachMoney_1.currencyDecimals)('kwd'), 3, 'and a dinar has three — a thousand fils in it, not a hundred');
eq((0, coachMoney_1.currencyDecimals)(null), null, 'and a currency nobody stated has no answer at all, which is not two');
eq((0, coachMoney_1.currencyDecimals)('  '), null, 'a blank currency is no currency here either');
// The figure a hundred times out. Stripe stores a KWD amount in fils, so 12340
// of them is KWD 12.340 — printed at two places it read as KWD 123.40.
eq((0, coachMoney_1.minorMoney)(12340, 'kwd'), 'KWD 12.340', 'a three-decimal currency divides by a thousand');
eq((0, coachMoney_1.minorMoney)(12340, 'bhd'), 'BHD 12.340', 'and so does every other one of them');
/* ── an amount a coach typed, in minor units ──────────────────────────────── */
const typed = (s, cur) => {
    const r = (0, coachMoney_1.readMinorAmount)(s, cur);
    return r.ok ? r.minorUnits : null;
};
eq(typed('12.50', 'gbp'), 1250, 'a two-place amount becomes minor units exactly');
eq(typed('12,50', 'gbp'), 1250, 'the decimal COMMA on a French or German keyboard is the same amount');
eq(typed('12.5', 'gbp'), 1250, 'a short fraction is padded, not misread as five minor units');
eq(typed('12', 'gbp'), 1200, 'and a whole figure is not twelve pence');
eq(typed('0.01', 'gbp'), 1, 'the smallest real amount is readable');
eq(typed('  12.50 ', 'gbp'), 1250, 'surrounding space is not part of the number');
eq(typed('.5', 'gbp'), 50, 'a leading point is a fraction of one');
// The multiplication that is never done. 12.35 * 100 is 1234.9999999999998 in
// floating point, and a reader that rounds it back is a reader that can round
// the wrong way on some other figure.
eq(typed('12.35', 'gbp'), 1235, 'the conversion is done on the digits, so no float rounds it');
eq(typed('1234567.89', 'gbp'), 123456789, 'and a large amount survives it too');
// No default currency, here as everywhere else.
ok(!(0, coachMoney_1.readMinorAmount)('12.50', null).ok, 'an amount with no currency is not an amount');
ok(!(0, coachMoney_1.readMinorAmount)('12.50', '   ').ok, 'nor is one whose currency is blank');
// A yen has no minor unit, so a "£12.50" box in front of one is the wrong box.
eq(typed('500', 'jpy'), 500, 'a zero-decimal amount is itself, not a hundredth of itself');
ok(!(0, coachMoney_1.readMinorAmount)('500.50', 'jpy').ok, 'and half a yen is a slip rather than an amount');
ok(/no smaller unit/i.test((0, coachMoney_1.readMinorAmount)('500.5', 'krw').reason), 'and the coach is told why rather than having it silently truncated');
// Three places, and Stripe's own rule about the last of them.
eq(typed('12.340', 'kwd'), 12340, 'a dinar amount is read in thousandths');
eq(typed('12.34', 'kwd'), 12340, 'and a short fraction pads to the thousandth');
ok(!(0, coachMoney_1.readMinorAmount)('12.345', 'kwd').ok, 'an amount Stripe cannot charge is refused rather than rounded');
// Ambiguity is refused, never resolved. "1,234" is one thousand two hundred and
// thirty-four to one reader and one and a bit to another, and neither reading
// may be chosen on somebody's behalf when the answer credits a card.
ok(!(0, coachMoney_1.readMinorAmount)('1,234', 'gbp').ok, 'a thousands separator is refused rather than guessed at');
ok(!(0, coachMoney_1.readMinorAmount)('1,234.50', 'gbp').ok, 'and so is the fully grouped spelling');
ok(/thousands separator/i.test((0, coachMoney_1.readMinorAmount)('1,234', 'gbp').reason), 'and the refusal says what to type instead');
ok(!(0, coachMoney_1.readMinorAmount)('', 'gbp').ok, 'an empty box is not an amount');
ok(!(0, coachMoney_1.readMinorAmount)('   ', 'gbp').ok, 'nor is a box holding a space');
ok(!(0, coachMoney_1.readMinorAmount)('-5', 'gbp').ok, 'a negative refund is not a refund');
ok(!(0, coachMoney_1.readMinorAmount)('12.5.0', 'gbp').ok, 'two separators are not a number');
ok(!(0, coachMoney_1.readMinorAmount)('£12.50', 'gbp').ok, 'a symbol is refused rather than stripped');
ok(!(0, coachMoney_1.readMinorAmount)('12abc', 'gbp').ok, 'and so is trailing text — this is not a half-typed load');
ok(!(0, coachMoney_1.readMinorAmount)('99999999999999999', 'gbp').ok, 'a figure past what integers hold is refused, not silently rounded');
/* ── adding up a period ───────────────────────────────────────────────────── */
const mixed = (0, coachMoney_1.sumTaken)([
    T({ amount_cents: 60000, currency: 'aed' }),
    T({ amount_cents: 9000, currency: 'gbp' }),
    T({ amount_cents: 40000, currency: 'aed' }),
]);
eq(mixed.pots.length, 2, 'two currencies make two pots, never one total');
eq(mixed.pots[0].currency, 'AED', 'the bigger pot leads');
eq(mixed.pots[0].minorUnits, 100000, 'same-currency amounts add');
eq(mixed.pots[0].count, 2, 'and the pot says how many purchases it is made of');
eq(mixed.pots[1].currency, 'GBP', 'the smaller pot follows');
eq((0, coachMoney_1.minorMoney)(mixed.pots[0].minorUnits, mixed.pots[0].currency), 'AED 1,000.00', 'a pot prints in its own currency');
// The hole in the total, counted rather than hidden. A package deleted after
// the sale leaves the amount with no unit anywhere in the database.
const holed = (0, coachMoney_1.sumTaken)([
    T({ amount_cents: 60000, currency: 'aed' }),
    T({ amount_cents: 25000, currency: null }),
    T({ amount_cents: null, currency: 'aed' }),
]);
eq(holed.pots.length, 1, 'an amount with no currency joins no pot');
eq(holed.pots[0].minorUnits, 60000, 'and is not added to another currency');
eq(holed.unlabelled, 1, 'it is counted, so the screen can say the total is short');
eq(holed.unpriced, 1, 'an amount Stripe never stated is counted apart again');
const none = (0, coachMoney_1.sumTaken)([]);
eq(none.pots.length, 0, 'nothing sold is no pots');
eq(none.unlabelled, 0, 'and nothing missing');
// Mutation check: the payments screen hands the same array to the summary and
// to the list rendered beside it.
const rows = [T({ amount_cents: 100, currency: 'gbp' }), T({ amount_cents: 900, currency: 'aed' })];
const before = rows.map((r) => r.amount_cents).join(',');
(0, coachMoney_1.sumTaken)(rows);
eq(rows.map((r) => r.amount_cents).join(','), before, 'sumTaken leaves the caller’s array in the order it arrived');
eq(rows.length, 2, 'and does not add or remove rows from it');
/* ── the two halves of what a coach has taken ─────────────────────────────── */
// A month of one-off sales and a month of renewals, added into one figure per
// currency. This is the arithmetic behind "earned this month".
const oneOff = (0, coachMoney_1.sumTaken)([
    T({ amount_cents: 60000, currency: 'aed' }),
    T({ amount_cents: 9000, currency: 'gbp' }),
]);
const renewed = (0, coachMoney_1.sumTaken)([
    T({ amount_cents: 60000, currency: 'aed' }),
    T({ amount_cents: 60000, currency: 'aed' }),
]);
const earned = (0, coachMoney_1.combineTaken)(oneOff, renewed);
eq(earned.pots.length, 2, 'the two halves merge per currency, not into one number');
eq(earned.pots[0].currency, 'AED', 'the bigger pot still leads after merging');
eq(earned.pots[0].minorUnits, 180000, 'one sale and two renewals in AED add to all three');
eq(earned.pots[0].count, 3, 'and the pot counts every payment in it, from either half');
eq(earned.pots[1].currency, 'GBP', 'a currency that only one half has survives the merge');
eq(earned.pots[1].minorUnits, 9000, 'at its own amount, untouched');
eq((0, coachMoney_1.minorMoney)(earned.pots[0].minorUnits, earned.pots[0].currency), 'AED 1,800.00', 'and the total prints in its own currency');
// The holes add. A sale with no unit and a renewal with no amount are two
// different amounts missing from one total, and the screen says how many.
const holes = (0, coachMoney_1.combineTaken)((0, coachMoney_1.sumTaken)([T({ amount_cents: 1000, currency: null })]), (0, coachMoney_1.sumTaken)([T({ amount_cents: null, currency: 'aed' })]));
eq(holes.pots.length, 0, 'neither half contributed a pot, so neither does the total');
eq(holes.unlabelled, 1, 'an unlabelled amount from either half is unlabelled in the total');
eq(holes.unpriced, 1, 'and so is one with no amount at all');
eq((0, coachMoney_1.combineTaken)().pots.length, 0, 'nothing to combine is no pots, not a crash');
eq((0, coachMoney_1.combineTaken)(oneOff).pots.length, 2, 'one half alone combines to itself');
// Mutation check, and the one that matters most here: the payments screen
// renders `oneOff` and `renewed` as the breakdown UNDERNEATH the combined
// total, so a merge that added into the inputs' own pots would silently double
// the figure a coach reads beside it.
const oneOffAedBefore = oneOff.pots.find((p) => p.currency === 'AED').minorUnits;
(0, coachMoney_1.combineTaken)(oneOff, renewed);
eq(oneOff.pots.find((p) => p.currency === 'AED').minorUnits, oneOffAedBefore, 'combineTaken does not add into the subtotals it was handed');
eq(oneOff.pots.length, 2, 'and does not add pots to them either');
/* ── what is priced to recur ──────────────────────────────────────────────── */
const rec = (0, coachMoney_1.sumRecurring)([
    { amount_cents: 60000, currency: 'aed', billing_interval: 'month' },
    { amount_cents: 60000, currency: 'aed', billing_interval: 'month' },
    { amount_cents: 500000, currency: 'aed', billing_interval: 'year' },
    { amount_cents: 9000, currency: 'gbp', billing_interval: 'month' },
]);
eq(rec.pots.length, 3, 'a currency at two intervals is two pots — a year is not twelve months divided');
eq(rec.pots[0].interval, 'year', 'the biggest standing price leads');
const aedMo = rec.pots.find((p) => p.currency === 'AED' && p.interval === 'month');
eq(aedMo?.minorUnits, 120000, 'two AED monthlies add');
eq(aedMo?.count, 2, 'and the pot knows how many subscribers it is');
const recHoled = (0, coachMoney_1.sumRecurring)([
    { amount_cents: 60000, currency: 'aed', billing_interval: null },
    { amount_cents: 60000, currency: null, billing_interval: 'month' },
    { amount_cents: null, currency: 'aed', billing_interval: 'month' },
]);
eq(recHoled.pots.length, 0, 'a price with no period, and a price with no unit, are not prices');
eq(recHoled.unlabelled, 2, 'both are counted rather than assumed');
eq(recHoled.unpriced, 1, 'and an amount Stripe never stated is counted apart');
/* ── periods ──────────────────────────────────────────────────────────────── */
const now = new Date('2026-08-31T12:00:00.000Z');
const start = (0, coachMoney_1.monthStart)(now);
ok(start <= now.getTime(), 'the month starts before now');
eq((0, coachMoney_1.monthStart)(now), (0, coachMoney_1.monthStart)(new Date(start)), 'the boundary is idempotent — the 1st is in its own month');
const dated = [
    T({ created_at: new Date(start + 1000).toISOString(), amount_cents: 1 }),
    T({ created_at: new Date(start - 1000).toISOString(), amount_cents: 2 }),
    T({ created_at: 'not a date', amount_cents: 3 }),
];
const thisMonth = (0, coachMoney_1.since)(dated, start);
eq(thisMonth.length, 1, 'only rows on or after the boundary are in the period');
eq(thisMonth[0].amount_cents, 1, 'and it is the right one');
ok(!thisMonth.some((r) => r.amount_cents === 3), 'a purchase we cannot date is not evidence about this month');
eq(dated.length, 3, 'since() does not consume its input');
/* ── session packs ────────────────────────────────────────────────────────── */
const P = (over) => ({ sessions_total: 10, sessions_used: 3, status: 'paid', ...over });
eq((0, coachMoney_1.packLeft)(P({})), 7, 'a pack of ten with three used has seven left');
eq((0, coachMoney_1.packLeft)(P({ sessions_total: null })), null, 'a membership has no credits, so it has no balance — null, not 0');
eq((0, coachMoney_1.packLeft)(P({ sessions_used: 10 })), 0, 'a pack fully drawn down really is zero');
eq((0, coachMoney_1.packLeft)(P({ sessions_used: 12 })), 0, 'a balance never goes negative, whatever a hand-written refund did');
ok((0, coachMoney_1.packRunOut)(P({ sessions_used: 10 })), 'a paid pack with nothing left is the row the coach has to act on');
ok(!(0, coachMoney_1.packRunOut)(P({})), 'a pack with credits left is not run out');
ok(!(0, coachMoney_1.packRunOut)(P({ sessions_total: null })), 'a membership never runs out of credits it never had');
ok(!(0, coachMoney_1.packRunOut)(P({ sessions_used: 10, status: 'refunded' })), 'an unpaid pack is not a client to chase');
/* ── a fee taken from the wrong figure ──────────────────────────────────── */
//
// `client_purchases.fee_variance_cents` (part 311) is the only figure in this
// app derived from a prediction rather than read back from Stripe. NULL, 0 and
// a value are three different facts and collapsing any two of them either hides
// the defect or reports it on every sale in the app.
eq((0, coachMoney_1.feeMismatches)([]).count, 0, 'no sales, nothing to reconcile');
eq((0, coachMoney_1.feeMismatches)([{ fee_variance_cents: null }, {}]).count, 0, 'a sale with no prediction on it is not a mismatch');
eq((0, coachMoney_1.feeMismatches)([{ fee_variance_cents: 0 }]).count, 0, 'and a prediction that was RIGHT is not one either');
eq((0, coachMoney_1.feeMismatches)([{ fee_variance_cents: 1 }]).count, 1, 'one minor unit out is out');
eq((0, coachMoney_1.feeMismatches)([{ fee_variance_cents: -1 }]).count, 1, 'and so is one minor unit the other way');
// The column is a BIGINT, so PostgREST hands it back as a STRING. Read as one,
// `"0" !== 0` and every correctly predicted sale in the app would carry a
// warning about the coach's money.
eq((0, coachMoney_1.feeMismatches)([{ fee_variance_cents: '0' }]).count, 0, 'a bigint nought arriving as a string is still nought');
eq((0, coachMoney_1.feeMismatches)([{ fee_variance_cents: '-25' }]).count, 1, 'and a real one is still a real one');
// A value that will not parse is a column we could not read, not a discrepancy
// we invented from one.
eq((0, coachMoney_1.feeMismatches)([{ fee_variance_cents: 'x' }]).count, 0, 'an unreadable variance is not a mismatch');
// The worst single gap, ignoring sign — a scale rather than a total, because
// variances in different currencies are not summable any more than takings are.
eq((0, coachMoney_1.feeMismatches)([{ fee_variance_cents: 5 }, { fee_variance_cents: -40 }, { fee_variance_cents: 3 }]).worstCents, 40, 'the worst gap is the largest by size, whichever way it went');
eq((0, coachMoney_1.feeMismatches)([{ fee_variance_cents: 0 }]).worstCents, 0, 'and there is no worst gap where there are no gaps');
/* ── minorFromWhole: the converter two screens did by hand, wrongly ────────
 *
 * `sessionFee * 100` was written at app/(trainer)/calendar.tsx and
 * sessions.tsx into `sessions.rate_cents`, the column a gym settles payroll
 * from. These assert the two families where a hundred is the wrong factor,
 * because those are the ones nobody would catch by looking at the screen. */
eq((0, coachMoney_1.minorFromWhole)(40, 'gbp'), 4000, 'a two-decimal currency does multiply by a hundred');
eq((0, coachMoney_1.minorFromWhole)(6300, 'jpy'), 6300, 'yen has no minor unit — a 6,300 yen fee is 6,300, not 630,000');
eq((0, coachMoney_1.minorFromWhole)(40, 'kwd'), 40000, 'a dinar has three places — 40 KWD is 40,000 fils, not 4,000');
eq((0, coachMoney_1.minorFromWhole)(12.345, 'kwd'), 12345, 'and the third place survives the binary floating point');
eq((0, coachMoney_1.minorFromWhole)(40, null), null, 'no currency means no factor, so it refuses rather than assuming one');
eq((0, coachMoney_1.minorFromWhole)(40, ''), null, 'and a blank currency is not a currency either');
eq((0, coachMoney_1.minorFromWhole)(null, 'gbp'), null, 'nothing to convert converts to nothing');
eq((0, coachMoney_1.minorFromWhole)(Number.NaN, 'gbp'), null, 'an unreadable fee is not a zero fee');
eq((0, coachMoney_1.minorFromWhole)(1e18, 'kwd'), null, 'a figure past safe integers is refused rather than silently rounded');
// The round trip the two screens actually perform: read the gym's whole-unit
// fee, store minor units, show it back. It has to survive both odd families.
eq((0, coachMoney_1.majorFromMinor)((0, coachMoney_1.minorFromWhole)(40, 'kwd'), 'kwd'), '40.000', 'a dinar fee reads back as the fee');
eq((0, coachMoney_1.majorFromMinor)((0, coachMoney_1.minorFromWhole)(6300, 'jpy'), 'jpy'), '6300', 'and so does a yen one');
/* ── minorFromDecimal: a figure an OUTSIDE system stated ───────────────────
 *
 * The third door, and the one whose right of refusal differs. Meta and TikTok
 * report a decimal in the ad account's currency and Google's micros arrive as
 * one; a provider figure with more places than the money has must be ROUNDED,
 * because refusing it drops a real cost out of a coach's own spend and reports
 * it as unknown. Everything is done on the digits, so no float is multiplied. */
eq((0, coachMoney_1.minorFromDecimal)('120.00', 'gbp'), 12000, 'a two-place currency scales by a hundred');
eq((0, coachMoney_1.minorFromDecimal)('1234', 'jpy'), 1234, 'a yen has no minor unit, so the figure is already in them');
eq((0, coachMoney_1.minorFromDecimal)('12.340', 'kwd'), 12340, 'a dinar has a thousand fils in it');
eq((0, coachMoney_1.minorFromDecimal)('12.345', 'kwd'), 12345, 'and a third place is kept — this is not a Stripe charge');
eq((0, coachMoney_1.minorFromDecimal)('12.3456', 'kwd'), 12346, 'a fourth place is rounded rather than refusing the whole figure');
eq((0, coachMoney_1.minorFromDecimal)('12.345', 'gbp'), 1235, 'rounding is half-up');
eq((0, coachMoney_1.minorFromDecimal)('12.344', 'gbp'), 1234, 'and down below the half');
eq((0, coachMoney_1.minorFromDecimal)('1234.5', 'jpy'), 1235, 'a fraction a yen does not have is rounded, not dropped');
eq((0, coachMoney_1.minorFromDecimal)('0', 'gbp'), 0, 'a real zero is a real figure — an ad that ran and cost nothing');
eq((0, coachMoney_1.minorFromDecimal)('1,250.50', 'gbp'), 125050, 'a provider grouping is not ambiguity: a machine wrote it');
eq((0, coachMoney_1.minorFromDecimal)('120.00', null), null, 'no currency, no factor, no figure');
eq((0, coachMoney_1.minorFromDecimal)('120.00', ''), null, 'and a blank currency is the same silence');
eq((0, coachMoney_1.minorFromDecimal)(null, 'gbp'), null, 'a missing amount is unknown, never a zero');
eq((0, coachMoney_1.minorFromDecimal)('unknown', 'gbp'), null, 'and so is a word');
eq((0, coachMoney_1.minorFromDecimal)('-5', 'gbp'), null, 'a negative is not something an ad account reports');
// Deliberately NOT a float multiplication. 12.345 * 100 is 1234.4999999999998
// in binary, which truncates to 1234 and loses a penny per ad.
eq((0, coachMoney_1.minorFromDecimal)('12.345', 'gbp'), Math.round(12.345 * 100), 'and it agrees with the rounding a float would have reached, without doing one');
/* ── readMinorAmount refuses Stripe's rule only where Stripe is involved ─── */
const kwdCharge = (0, coachMoney_1.readMinorAmount)('12.345', 'KWD');
ok(!kwdCharge.ok, 'a dinar amount Stripe cannot charge is refused in a box whose value goes to Stripe');
const kwdStated = (0, coachMoney_1.readMinorAmount)('12.345', 'KWD', false);
ok(kwdStated.ok && kwdStated.minorUnits === 12345, 'and accepted where the coach is stating what something already cost them, which Stripe has no opinion about');
const stillAmbiguous = (0, coachMoney_1.readMinorAmount)('1,234', 'GBP', false);
ok(!stillAmbiguous.ok, 'every other refusal still stands: a thousands separator is ambiguity, not a charging rule');
ok(!(0, coachMoney_1.readMinorAmount)('250.50', 'JPY', false).ok, 'and a yen still has nothing after the point');
ok(!(0, coachMoney_1.readMinorAmount)('250', null, false).ok, 'and no currency is still no amount');
if (errors.length) {
    console.error(`coachMoney: ${errors.length} failure(s)\n` + errors.map((e) => '  - ' + e).join('\n'));
    process.exit(1);
}
console.log('coachMoney ok — currencies stay apart, the two halves of a coach’s takings add without merging currencies, unlabelled amounts stay counted, memberships have no balance');
