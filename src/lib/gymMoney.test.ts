// Adding dirhams to pounds is not a sum. Compile with tsc, run with node.
//
// `summarise()` adds `amountCents` across payments and `priceCents` across the
// plans behind active memberships, and for a long time it ignored what currency
// each of those rows stated. That was invisible while every gym was in the UAE
// and is a wrong number the moment one is not: `gym_payments.currency` and
// `membership_plans.currency` are both `not null default 'AED'`, so every row
// written before those write paths demanded a currency is a dirham row. A
// London gym that has since set GBP had those dirhams added to its pounds, and
// the two console screens that show the result — the Overview and Plans &
// payments, the first two figures an owner reads — labelled it GBP.
//
// There is no fixing that inside the sum: converting needs a rate nobody has.
// So the sum REPORTS the currency it can honestly claim and reports null when
// the contributing rows do not agree, and the screens withhold the figure and
// say why. These assertions are what stop the report drifting back to a guess.
import { summarise, sharedCurrency, money, reversalBlocker, type GymPayment, type Membership, type MembershipPlan } from './gymRecord';
import { minorToWhole, wholeToMinor, wholeFieldValue, wholeMoney, ZERO_DECIMAL } from './coachMoney';
import { minorToDecimal } from './gymExport';
import { parseMoneyCents } from './csvImport';
import { parseRate } from './gymPay';
import { parseAmount } from './gymInvoices';
import { parseSpend, spendFieldValue, type CodeReturnRow } from './codeReturn';
import { centsFromAmount } from './adMatch';

/**
 * `require` rather than `import … from 'node:fs'`, and the reason is in
 * src/lib/consoleRoutes.test.ts at length: two TypeScript configurations
 * compile this file and they disagree about Node. `tsconfig.test.json` names
 * `"types": ["node"]` because these tests run under plain node; the ROOT
 * tsconfig is Expo's, has no node types, and type-checks `src/**` for the phone
 * app — so a `node:fs` import fails there with TS2591, and `npx tsc --noEmit`
 * at the root is a gate everybody runs. A module-scoped `declare` is local.
 */
declare const require: (id: string) => any;
const { readFileSync } = require('node:fs') as { readFileSync: (p: string, enc: string) => string };

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── sharedCurrency: the rule, on its own ──────────────────────────────── */

eq(sharedCurrency([]), null, 'an empty set states no currency');
eq(sharedCurrency([{ currency: 'GBP' }]), 'GBP', 'one row states its own');
eq(sharedCurrency([{ currency: 'GBP' }, { currency: 'GBP' }]), 'GBP', 'rows that agree state it');
eq(sharedCurrency([{ currency: 'GBP' }, { currency: 'AED' }]), null,
  'rows that disagree state nothing — this is the legacy-dirham case');
// The one that matters most, and the one an "ignore the nulls" implementation
// gets wrong: a row with no currency is SILENT, and silence is not agreement.
// Reading it as consent is how a single unpriced row lets a whole set be
// labelled with whatever the others happen to say.
eq(sharedCurrency([{ currency: 'GBP' }, { currency: null }]), null,
  'a row stating no currency does not agree with one that does');
eq(sharedCurrency([{ currency: null }, { currency: null }]), null,
  'rows that all state nothing state nothing, not a shared null to print with');
eq(sharedCurrency([{}, {}]), null, 'an absent currency field is the same silence as a null one');
// Order must not decide anything. `rows[0].currency` was the implementation
// this replaces, and reversing the set was enough to change the answer.
eq(sharedCurrency([{ currency: 'AED' }, { currency: 'GBP' }]),
   sharedCurrency([{ currency: 'GBP' }, { currency: 'AED' }]),
   'the answer does not depend on which row sorted first');

/* ── the two sums, and what they claim to be in ────────────────────────── */

const pay = (cents: number, currency: string): GymPayment => ({
  id: `p${cents}${currency}`, memberId: null, memberName: null,
  amountCents: cents, currency, method: 'card',
  takenAt: '2026-08-01T00:00:00Z', note: null,
  kind: 'payment', reversesPaymentId: null, invoiceId: null, membershipId: null,
});

const plan = (id: string, priceCents: number, currency: string,
              interval: 'month' | 'year' | 'once' = 'month'): MembershipPlan => ({
  id, name: id, priceCents, currency, interval, active: true,
});

const member = (id: string, planId: string | null): Membership => ({
  id, memberId: `m-${id}`, memberName: null, planId, planName: null,
  status: 'active', startedOn: '2026-01-01', endsOn: null,
});

{
  // The happy case: one currency throughout, and the sum may name it.
  const s = summarise(
    [pay(5000, 'GBP'), pay(2500, 'GBP')],
    [member('a', 'p1'), member('b', 'p1')],
    [plan('p1', 4000, 'GBP')],
  );
  eq(s.takenCents, 7500, 'the total is still the total');
  eq(s.takenCurrency, 'GBP', 'and it says what money it is in');
  eq(s.mrrCents, 8000, 'two monthly memberships on a 40.00 plan');
  eq(s.mrrCurrency, 'GBP', 'priced in the plan’s own currency');
  eq(money(s.takenCents, s.takenCurrency), 'GBP 75.00', 'and renders');
}

{
  // The defect itself: one legacy dirham payment among the pounds. The total is
  // still returned — it is what the rows add to — but nothing may print it.
  const s = summarise(
    [pay(5000, 'GBP'), pay(2500, 'AED')],
    [member('a', 'p1')],
    [plan('p1', 4000, 'GBP')],
  );
  eq(s.takenCents, 7500, 'the arithmetic is unchanged; only the claim about it is');
  eq(s.takenCurrency, null, 'a mixed set of payments is in no one currency');
  eq(money(s.takenCents, s.takenCurrency), null,
    'so money() withholds it rather than labelling dirhams-plus-pounds as pounds');
  // The two sums are judged separately: the plans still agree, so the recurring
  // figure is not withheld because the till was mixed.
  eq(s.mrrCurrency, 'GBP', 'a mixed till does not withhold the recurring figure');
}

{
  // Plans disagreeing, payments fine — the mirror of the above.
  const s = summarise(
    [pay(5000, 'GBP')],
    [member('a', 'p1'), member('b', 'p2')],
    [plan('p1', 4000, 'GBP'), plan('p2', 3000, 'EUR')],
  );
  eq(s.takenCurrency, 'GBP', 'the till is still one currency');
  eq(s.mrrCurrency, null, 'two plans in two currencies have no one monthly total');
  eq(s.mrrCents, 7000, 'the number is reported; printing it is what is refused');
}

{
  // An empty set states nothing to disagree with. This has to stay distinct
  // from "the rows disagree", because the caller falls back to the gym's own
  // tenants.currency in the first case and must withhold in the second.
  const s = summarise([], [], []);
  eq(s.takenCents, null, 'no payments recorded is not zero taken');
  eq(s.takenCurrency, null, 'and no rows state a currency');
  eq(s.payments, 0, 'the row count is what tells the two apart');
  eq(s.mrrCents, null, 'no priced membership is not zero recurring');
}

{
  // A `once` plan is in the price book and contributes nothing to a MONTHLY
  // figure, so its currency must not be allowed to withhold one. This is the
  // reason the currency is asked of the contributing plans rather than of every
  // plan handed in.
  const s = summarise(
    [],
    [member('a', 'p1'), member('b', 'p2')],
    [plan('p1', 4000, 'GBP'), plan('p2', 9900, 'AED', 'once')],
  );
  eq(s.mrrCents, 4000, 'the day pass adds nothing to the monthly figure');
  eq(s.mrrCurrency, 'GBP', 'so its currency does not withhold one either');
}

{
  // An annual plan DOES contribute, so its currency counts.
  const s = summarise(
    [],
    [member('a', 'p1'), member('b', 'p2')],
    [plan('p1', 1200, 'GBP'), plan('p2', 12000, 'AED', 'year')],
  );
  eq(s.mrrCents, 2200, 'the annual plan contributes a twelfth');
  eq(s.mrrCurrency, null, 'and therefore its currency has to agree');
}

{
  // A membership whose plan carries no currency at all. The plan is priced, so
  // it contributes; it states nothing, so the total cannot be named.
  const s = summarise(
    [],
    [member('a', 'p1'), member('b', 'p2')],
    // `membership_plans.currency` is `not null default 'AED'`, so a plan that
    // says nothing says it as an empty string rather than as a null. The two
    // are the same fact and sharedCurrency normalises them together — money()
    // already refuses '' for exactly this reason.
    [plan('p1', 4000, 'GBP'), plan('p2', 4000, '')],
  );
  eq(s.mrrCents, 8000, 'both are monthly and both are priced');
  eq(s.mrrCurrency, null, 'but one of them will not say in what');
}


/* ── there are no sen in a yen ─────────────────────────────────────────────
 *
 * Everything below is one defect wearing sixteen currency codes, and it is the
 * one this file's `money()` assertions above cannot see: they are all in AED
 * and GBP, where a hundred minor units really do make one whole unit, so a
 * `* 100` and a `/ 100` written by hand are indistinguishable from a correct
 * conversion.
 *
 * They are not the same in JPY, KRW, VND, CLP or the other twelve in
 * `ZERO_DECIMAL`. Stripe stores ¥50,000 as 50000 — the minor unit IS the yen —
 * and the whole codebase stores money on that understanding because Stripe is
 * where most of it comes from. So every hand-written hundred is a hundredfold
 * error for those currencies, in one direction or the other, and the reason it
 * survived this long is that nobody reviewing the code bills in one of them.
 *
 * Two shapes of it, and the second is the one that lasts:
 *
 *   DISPLAY. A stored integer divided by a hundred on its way to a screen. A
 *   wrong number somebody can look at again.
 *
 *   WRITE. A typed figure multiplied by a hundred on its way into a column.
 *   Permanent, and every figure derived from it afterwards is wrong too — a
 *   payroll run, an invoice a member is chased for, a campaign a coach stops
 *   running because it looks a hundred times more expensive than it was.
 *
 * And a third that is worse than either: a PAIR of them that cancel. A field
 * prefilled with `stored / 100` and saved with `typed * 100` round-trips
 * perfectly and shows the person editing it a hundredth of the real figure the
 * whole time. It only bites when somebody acts on what they were shown, which
 * is the one thing a form exists for.
 *
 * These assertions are what stop each of them coming back. Every one names the
 * function it is about, because the fix was a sweep and a sweep is exactly the
 * kind of change that gets half-reverted.
 */

/* ── the converters themselves ─────────────────────────────────────────── */

eq(ZERO_DECIMAL.has('jpy'), true, 'the yen has no subdivision');
eq(ZERO_DECIMAL.has('gbp'), false, 'the pound does');
// Lowercase is the stored form and every caller normalises to it. An uppercase
// hit here would mean the set was being asked the wrong question somewhere.
eq(ZERO_DECIMAL.has('JPY' as string), false, 'the list is lowercase; callers normalise before asking');

eq(minorToWhole(123456, 'GBP'), 1234.56, 'a hundredths currency divides');
eq(minorToWhole(50000, 'JPY'), 50000, 'a whole-unit one does not — the stored integer IS the amount');
eq(minorToWhole(50000, 'jpy'), 50000, 'and the case it is asked in does not decide that');
eq(minorToWhole(50000, null), null, 'no currency, no scale — a figure is withheld, not guessed');
eq(minorToWhole(null, 'JPY'), null, 'and no amount is still no amount');

eq(wholeToMinor(1234.56, 'GBP'), 123456, 'a typed pounds figure becomes pence');
eq(wholeToMinor(50000, 'JPY'), 50000, 'a typed yen figure is already the integer to store');
eq(wholeToMinor(50000, 'GBP'), 5000000, 'and the same digits in sterling are not');
eq(wholeToMinor(74.995, 'GBP'), 7500, 'the one rounding in the path happens here');
eq(wholeToMinor(6000.4, 'JPY'), 6000, 'a fraction of a yen is rounded here rather than refused by the column');
eq(wholeToMinor(50, ''), null, 'an empty currency is the same silence as a null one');

// The round trip that every money form in the product is built on. It has to
// hold in BOTH currencies, and it is the pair that used to cancel.
eq(wholeToMinor(minorToWhole(50000, 'JPY'), 'JPY'), 50000, 'yen survives a field being opened and saved');
eq(wholeToMinor(minorToWhole(123456, 'GBP'), 'GBP'), 123456, 'and so does sterling');

eq(wholeFieldValue(25000, 'GBP'), '250', 'a round amount comes back without decimals it does not need');
eq(wholeFieldValue(25050, 'GBP'), '250.50', 'and a pennies amount keeps both places');
eq(wholeFieldValue(50000, 'JPY'), '50000', 'a yen amount is not divided on its way into the box');
eq(wholeFieldValue(0, 'GBP'), '0', 'a recorded zero is a figure somebody entered, not an empty box');
eq(wholeFieldValue(null, 'GBP'), '', 'and nothing recorded is an empty box, never "0" and never "null"');
eq(wholeFieldValue(50000, null), '', 'no currency, no scale, no figure');

/* ── gymMoney: the trap this whole sweep was about ─────────────────────── */

// `gymMoney` in src/ui/tenant.tsx is the owner app's one money formatter, and
// it took MAJOR units while reaching `money()` — which takes MINOR units —
// through `money(Math.round(whole * 100), currency)`. The multiply and the
// divide cancelled, so it was right for exactly as long as `money()` divided by
// a hundred in every currency. It stopped doing that, and nothing failed: six
// owner screens, the emailed owner report and the Operations screen that
// confirms a session fee was saved all quietly stated a Tokyo gym's figures a
// hundredfold.
//
// The behaviour is asserted through `wholeMoney`, which `gymMoney` is now a
// one-line delegation to. It cannot be called here directly: tenant.tsx is a
// React component module that imports react-native and supabase, and this suite
// is plain node.
eq(wholeMoney(6300, 'JPY'), 'JPY 6,300', 'a whole-unit yen fee is rendered as the figure the owner set');
eq(wholeMoney(6300, 'GBP'), 'GBP 6,300.00', 'and the same figure in sterling gains the two places sterling has');
eq(wholeMoney(0, 'JPY'), 'JPY 0', 'a real zero is still a real zero');
eq(wholeMoney(null, 'JPY'), null, 'an unknown figure is withheld, not rendered as zero');
eq(wholeMoney(6300, null), null, 'and so is one whose currency the gym has never set');

// And the delegation itself, read from the source, because the assertions above
// are about `wholeMoney` and would keep passing while `gymMoney` went back to
// multiplying. That is not a hypothetical: the multiply survived the change to
// `money()` precisely because nothing anywhere named the pair. `feeAmountLine`
// in src/lib/booking.ts and the owner report in src/lib/exportShare.ts made the
// same move and are checked the same way.
//
// A source read rather than an import for the reason above — and it is checking
// for one expression, not parsing TypeScript.
//
// Comments are stripped first, and that is not a detail. All three files
// explain the removed expression at length, in prose that quotes it, because a
// fix nobody can find the reason for is a fix somebody reverts. Matching the
// raw text would fail on the explanation of the defect rather than on the
// defect — which is the most annoying possible false positive, since the only
// way to make it pass would be to delete the reason.
const withoutComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

for (const [file, fn] of [
  ['src/ui/tenant.tsx', 'gymMoney'],
  ['src/lib/booking.ts', 'feeAmountLine'],
  ['src/lib/exportShare.ts', 'the owner report’s session-value line'],
] as const) {
  const code = withoutComments(readFileSync(file, 'utf8'));
  ok(!/\*\s*100\b/.test(code),
    `${file}: ${fn} must not multiply a whole-unit figure into minor units on its way to a formatter — that only cancels in the currencies that have hundredths`);
}

/* ── minorToDecimal: the same figure, in the file a gym hands its accountant ── */

eq(minorToDecimal(45000, 'GBP'), '450.00', 'a hundredths currency gets the point pushed two places');
eq(minorToDecimal(5, 'GBP'), '0.05', 'including the awkward sub-unit one');
eq(minorToDecimal(-4500, 'GBP'), '-45.00', 'and a reversal keeps its sign');
eq(minorToDecimal(50000, 'JPY'), '50000', 'a yen amount is written as the integer it is stored as');
eq(minorToDecimal(50000, 'jpy'), '50000', 'whatever case the column states it in');
// The cell is empty rather than wrong. A spreadsheet is exactly where a bare
// number acquires whatever unit its reader assumes, and every table that calls
// this writes the raw integer and the currency in columns of their own beside
// it, so nothing is lost by withholding the human-readable one.
eq(minorToDecimal(45000, null), '', 'an amount whose currency nobody stated is not written out at all');
eq(minorToDecimal(null, 'GBP'), '', 'and an unrecorded amount is still an empty cell, not "0.00"');

/* ── the export and the importer have to agree ──────────────────────────── */

// gymExport writes `amount`/`price` columns for `previewPayments` and
// `previewPlans` to read back, and both tables' notes promise the file is
// re-importable. A currency-aware writer and a flat `* 100` reader would have
// broken that promise silently and only for the sixteen.
for (const [minor, ccy] of [[45000, 'GBP'], [5, 'GBP'], [50000, 'JPY'], [1234, 'VND']] as const) {
  const back = parseMoneyCents(minorToDecimal(minor, ccy), ccy);
  ok(back.ok && back.value === minor,
    `${ccy} ${minor} survives being exported and re-imported (got ${JSON.stringify(back)})`);
}
eq(parseMoneyCents('50', 'GBP').ok && (parseMoneyCents('50', 'GBP') as { value: number }).value, 5000,
  'a bare integer in a sterling sheet is whole units');
eq(parseMoneyCents('50', 'JPY').ok && (parseMoneyCents('50', 'JPY') as { value: number }).value, 50,
  'and in a yen sheet it is already the stored integer');
eq(parseMoneyCents('50.50', 'JPY').ok, false,
  'a decimal part in a yen column is refused, not silently dropped — that column is not what it looks like');
eq(parseMoneyCents('50', null).ok, false,
  'and with no currency there is no scale to read the sheet at, so the row is refused rather than guessed');

/* ── the writes ────────────────────────────────────────────────────────── */

// Each of these puts an integer into a column somebody is later paid, billed or
// judged by, and each of them used to multiply by a hundred flatly.
const rate = (typed: string, ccy: string | null) => {
  const r = parseRate(typed, ccy);
  return r.kind === 'rate' ? r.cents : r.kind;
};
eq(rate('45.50', 'GBP'), 4550, 'a typed sterling rate becomes pence');
eq(rate('8000', 'JPY'), 8000, 'a typed yen class rate is stored as typed — not ¥800,000');
eq(rate('', 'JPY'), 'clear', 'an empty box still clears, and clearing needs no currency');
eq(rate('', null), 'clear', 'even at a gym that has not set one — a rate must always be undoable');
eq(rate('45', null), 'bad', 'but a rate cannot be stored without one: this is what somebody is paid');

const billed = (typed: string, ccy: string | null) => {
  const r = parseAmount(typed, ccy);
  return r.kind === 'amount' ? r.cents : r.kind;
};
eq(billed('82.50', 'GBP'), 8250, 'a typed sterling invoice becomes pence');
eq(billed('6000', 'JPY'), 6000, 'a typed yen invoice is what the member is asked for, not a hundred times it');
eq(billed('6000', null), 'bad', 'and an invoice cannot be raised in a currency nobody has set');

const spend = (typed: string, ccy: string | null) => {
  const r = parseSpend(typed, ccy);
  return r.kind === 'amount' ? r.cents : r.kind;
};
eq(spend('250.50', 'GBP'), 25050, 'a coach typing sterling ad spend gets pence');
eq(spend('50000', 'JPY'), 50000, 'a coach typing yen ad spend gets yen, not a campaign that cost a hundredfold');
eq(spend('', 'JPY'), 'clear', 'an empty box clears the record, which is not the same fact as zero');
eq(spend('', null), 'clear', 'and clearing works with no currency — taking a figure back always must');
eq(spend('250', null), 'bad', 'but nothing is recorded at a scale nobody chose');

// The provider side of the same figure. Ad spend and revenue are divided by one
// another on the coach's screen, so they have to be on one scale: revenue comes
// from Stripe, which means ¥50,000 is 50000, and this used to make it 5,000,000.
eq(centsFromAmount('120.00', 'GBP', ZERO_DECIMAL), 12000, 'a provider decimal becomes minor units');
eq(centsFromAmount('1234', 'JPY', ZERO_DECIMAL), 1234, 'a yen account\u2019s spend is already the stored integer');
eq(centsFromAmount('1234', 'GBP', ZERO_DECIMAL), 123400, 'and the same digits in sterling are not');
eq(centsFromAmount('1234', null, ZERO_DECIMAL), null, 'ads that agreed on no currency have no readable amount');

/* ── the pair that cancels ─────────────────────────────────────────────── */

// A field prefilled by dividing and saved by multiplying round-trips perfectly
// and shows the wrong figure the entire time. These assert the prefill itself,
// because the round trip cannot.
const codeRow = (spendCents: number, ccy: string): CodeReturnRow => ({
  id: 'c1', code: 'K7M2QX', label: 'Instagram', isDefault: false, isLive: true,
  createdAt: null, clients: 0, activeNow: 0, revenue: null,
  spend: { cents: spendCents, currency: ccy },
});
eq(spendFieldValue(codeRow(25000, 'GBP')), '250', 'a sterling spend opens the box at what the coach typed');
eq(spendFieldValue(codeRow(50000, 'JPY')), '50000',
  'and a yen spend opens at ¥50,000 rather than at 500 — the figure the coach then edits');

/* ── reversalBlocker: two figures, no currency, at a front desk ─────────── */

{
  const jpy = pay(6000, 'JPY');
  // The sentence somebody reads while taking money back. It was built with
  // `(remaining / 100).toFixed(2)` and quoted BOTH figures bare — no currency
  // on either, and a hundredth of the real amount in sixteen currencies. On a
  // ¥6,000 payment it said "60.00 of 60.00", which is not a hundredth of ¥6,000
  // in any reading; it is a different pair of numbers in a sentence whose only
  // job is stopping an overshoot.
  const over = reversalBlocker(jpy, 0, 7000);
  ok(over != null && over.includes('JPY 6,000'),
    `the overshoot sentence states the real figure and says what money it is in — got ${JSON.stringify(over)}`);
  ok(over != null && !/\b60\.00\b/.test(over), 'and not a hundredth of it with invented decimal places');

  const gbp = pay(6000, 'GBP');
  const overGbp = reversalBlocker(gbp, 2000, 5000);
  ok(overGbp != null && overGbp.includes('GBP 40.00') && overGbp.includes('GBP 60.00'),
    `sterling states both figures in sterling — got ${JSON.stringify(overGbp)}`);

  // A payment with no currency on it. The check still refuses the overshoot;
  // what it must not do is quote two unlabelled numbers to somebody about to
  // hand money over.
  const silent = reversalBlocker(pay(6000, ''), 0, 7000);
  ok(silent != null, 'an overshoot is still refused when the payment states no currency');
  ok(silent != null && !/\d/.test(silent.replace(/[^0-9]/g, '')),
    `and no bare figures are quoted in it — got ${JSON.stringify(silent)}`);
}

if (errors.length) {
  console.error(`gymMoney: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
console.log('gymMoney: ok (a sum names its currency, and no figure is a hundredfold out)');
