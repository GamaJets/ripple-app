// The month-end close, asked what money its figures are in. Compile with tsc,
// run with node.
//
// Every assertion here is about the same rule said three different ways: a
// figure never states a currency nobody chose, and a WITHHELD figure never
// stands on a screen without the sentence that says why it is missing. The
// three defects it pins are all the same shape — a null that had two causes and
// was read as having one.
//
//  1. `income.takenCents` is null when nobody recorded a payment AND when the
//     payments are in more than one currency. `moneyCheck` folded both into
//     `taken ?? 0`, so a gym with thirty GBP payments and one EUR walk-in was
//     handed `not_entered` — "Invoices mark 12,400.00 as paid this month, and
//     not one payment was recorded against them" — beside a mixed-currency
//     blocker saying thirty-one payments were recorded. Two blockers on one
//     screen, flatly contradicting each other, on the page an owner signs a
//     month off on. `owed.settledCents` had the identical fault from the other
//     side and produced "no invoice in this month is marked paid" over four
//     invoices that were.
//
//  2. Neither side ever asked whether it was in the same money as the OTHER
//     side. Each guarded only its own internal uniformity, so a gym invoicing
//     in EUR and banking in GBP would have had 12,400 held against 12,400 and
//     been told its month reconciles. Latent — no tenant is in that state
//     today — and a missing guard is still a missing guard.
//
//  3. `passRevenueCents` took `Pick<GymPass, 'paidCents'>`, a signature that
//     narrows away the one field deciding whether the sum is an amount of
//     anything, and `buildClose` called it raw. AED 860 + GBP 240 arrived as
//     1,100 with no flag, no note and nothing in `closeBlockers` that could
//     see a pass at all.
import {
  incomeOf, owedOf, moneyCheck, closeBlockers, buildClose, monthWindow,
  type MonthWindow,
} from './monthEnd';
import { passRevenueCents, type GymPass } from './gymPasses';
import { PAY_DELIVERED_ONLY } from './gymSessions';
import { sliceReady } from './memberView';
import type { GymPayment } from './gymRecord';
import { reviewFinances, emptyFinances, type FinInputs } from './finReview';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const W = monthWindow('2026-08') as MonthWindow;
const AFTER = Date.parse('2026-09-02T10:00:00.000Z');

/* ── fixtures ──────────────────────────────────────────────────────────────── */

let seq = 0;
const pay = (amountCents: number, currency: string, at = '2026-08-14T09:00:00.000Z'): GymPayment => ({
  id: `p${++seq}`, memberId: 'm1', memberName: 'A Member', amountCents, currency,
  method: 'card', takenAt: at, note: null, kind: 'payment',
  reversesPaymentId: null, invoiceId: null, membershipId: null,
});

const inv = (amountCents: number, currency: string, status: 'paid' | 'open' = 'paid') => ({
  id: `i${++seq}`, memberId: 'm1', memberName: 'A Member', amountCents, currency,
  issuedOn: '2026-08-03', dueOn: '2026-08-17', status, note: null,
});

const pass = (paidCents: number | null, currency: string | null): GymPass => ({
  id: `x${++seq}`, passTypeId: 't1', passTypeName: 'Ten visits', kind: 'pack',
  covers: 'visit', holderId: 'm1', holderName: 'A Member', hostMemberId: null,
  issuedOn: '2026-08-09', expiresOn: null, usesTotal: 10, usesSpent: 0,
  paidCents, currency, note: null,
});

/* ── 1. one currency written two ways is one currency ──────────────────────── */

// `incomeOf` grouped by the NORMALISED code three lines below while testing the
// raw column here, so a single-currency gym holding one row written 'gbp' —
// nothing in the schema forbids it, `gym_payments.currency` carries no ISO
// check — lost its month's total and was told it had two currencies.
const cased = incomeOf([pay(10000, 'GBP'), pay(5000, ' gbp '), pay(2500, 'gbp')]);
eq(cased.mixedCurrency, false, "'GBP', ' gbp ' and 'gbp' are one currency, not three");
eq(cased.takenCents, 17500, 'so the gym gets the total it is entitled to');
eq(cased.currencies.join(','), 'GBP', 'and it is named once, in the one shape this product stores');

const invCased = owedOf([inv(9000, 'GBP'), inv(3000, 'gbp')], '2026-09-01');
eq(invCased.mixedCurrency, false, 'the invoice side normalises by the same rule');
eq(invCased.settledCents, 12000, 'or the two sides could not be compared at all');

/* ── 2. a mixed month is not an empty month ────────────────────────────────── */

const mixedIn = incomeOf([pay(1200000, 'GBP'), pay(4000, 'EUR')]);
eq(mixedIn.takenCents, null, 'two currencies are not one total');
eq(mixedIn.mixedCurrency, true, 'and the reason is a field, not an inference from a null');
eq(mixedIn.count, 2, 'the COUNT is always sayable — it is the amount that is not');

const owedGbp = owedOf([inv(1240000, 'GBP')], '2026-09-01');
const check1 = moneyCheck(mixedIn, owedGbp, (c) => String(c));
ok(check1 != null, 'a mixed month still gets a reconciliation object — silence is not an answer');
eq(check1?.uncomparable, 'taken_mixed', 'and it says the comparison could not be run, not that it failed');
eq(check1?.r.state, 'unreadable', 'nothing is asserted about either record');
eq(check1?.gapCents, null, 'and no gap is quoted, because there is no figure to take a gap from');
ok(!/not one payment was recorded/.test(check1?.note ?? ''),
  `the sentence may not claim no payments were recorded — got "${check1?.note}"`);
ok(/GBP/.test(check1?.note ?? '') && /EUR/.test(check1?.note ?? ''),
  `it names the two currencies the owner has to go and fix — got "${check1?.note}"`);
ok(!/1240000|12,400/.test(check1?.note ?? ''),
  `and quotes no amount: every figure it could quote is the one being withheld — got "${check1?.note}"`);

// The same fault from the other side. Mixed invoices null `settledCents`, which
// `reconcile` reads as `no_record` — "no invoice in this month is marked paid"
// — over four invoices that are.
const mixedOwed = owedOf([inv(900000, 'GBP'), inv(30000, 'EUR')], '2026-09-01');
const incGbp = incomeOf([pay(900000, 'GBP')]);
const check2 = moneyCheck(incGbp, mixedOwed, (c) => String(c));
eq(check2?.uncomparable, 'owed_mixed', 'the invoice side refuses the comparison in its own name');
ok(!/no invoice in this month is marked paid/.test(check2?.note ?? ''),
  `and may not claim nothing was marked paid — got "${check2?.note}"`);

/* ── 3. each side agreeing with itself is not the two sides agreeing ───────── */

const takenGbp = incomeOf([pay(1240000, 'GBP')]);
const owedEur = owedOf([inv(1240000, 'EUR')], '2026-09-01');
const check3 = moneyCheck(takenGbp, owedEur, (c) => String(c));
eq(check3?.uncomparable, 'sides_differ', 'equal numbers in unequal money do not reconcile');
ok(check3?.r.state !== 'agrees', 'and above all they are never reported as agreeing');
ok(/GBP/.test(check3?.note ?? '') && /EUR/.test(check3?.note ?? ''),
  `both currencies are named — got "${check3?.note}"`);

/* ── 4. the ordinary month is untouched ────────────────────────────────────── */

const plain = moneyCheck(incomeOf([pay(1240000, 'GBP')]), owedOf([inv(1240000, 'GBP')], '2026-09-01'));
eq(plain?.uncomparable, null, 'one currency on both sides is comparable');
eq(plain?.r.state, 'agrees', 'and inside the 2% tolerance it agrees, exactly as before');
eq(plain?.note, null, 'a console that congratulates itself is one people stop reading');

const gap = moneyCheck(incomeOf([pay(900000, 'GBP')]), owedOf([inv(1240000, 'GBP')], '2026-09-01'));
eq(gap?.r.state, 'differs', 'a real gap is still a real gap');
eq(gap?.uncomparable, null, 'and is not reclassified as an unrunnable comparison');
ok((gap?.gapCents ?? 0) > 0, 'the gap keeps its sign: the register expected more than arrived');

const noPayments = moneyCheck(incomeOf([]), owedOf([inv(1240000, 'GBP')], '2026-09-01'));
eq(noPayments?.r.state, 'not_entered', 'a month with genuinely no payments still reaches not_entered');
ok(/not one payment was recorded/.test(noPayments?.note ?? ''),
  'and that sentence is still said where it is true');

/* ── 5. the blockers say what the withheld figures mean ────────────────────── */

const emptyRec = {
  payments: sliceReady([]), invoices: sliceReady([]), sessions: sliceReady([]),
  memberships: sliceReady([]), passes: sliceReady([]),
} as unknown as Parameters<typeof closeBlockers>[0];

const mixedBlockers = closeBlockers(emptyRec, W, null, check1, mixedIn, owedGbp, null, AFTER);
ok(mixedBlockers.some((b) => b.kind === 'mixed_currency'),
  'a mixed-currency month is refused and told which currencies');
ok(!mixedBlockers.some((b) => b.kind === 'money_gap'),
  'and is NOT also handed a money gap that contradicts it — that pair is the whole defect');

const sidesBlockers = closeBlockers(emptyRec, W, null, check3, takenGbp, owedEur, null, AFTER);
ok(sidesBlockers.some((b) => b.kind === 'mixed_currency'),
  'two sides in two currencies stop the month, or it closes with no check having run');

const cleanBlockers = closeBlockers(emptyRec, W, null, plain, incomeOf([pay(1240000, 'GBP')]),
  owedOf([inv(1240000, 'GBP')], '2026-09-01'), null, AFTER);
ok(!cleanBlockers.some((b) => b.kind === 'mixed_currency'),
  'and a gym in one currency is not stopped by any of this');

/* ── 6. pass revenue carries the money it is in ────────────────────────────── */

const onePass = passRevenueCents([pass(50000, 'AED'), pass(36000, 'aed')]);
eq(onePass.cents, 86000, 'two passes in one currency add up');
eq(onePass.currency, 'AED', 'and the sum knows what it is denominated in');
eq(onePass.mixedCurrency, false, 'case and spacing are not a second currency here either');

const mixedPasses = passRevenueCents([pass(50000, 'AED'), pass(36000, 'AED'), pass(24000, 'GBP'), pass(null, 'GBP')]);
eq(mixedPasses.mixedCurrency, true, 'AED 860 and GBP 240 are not AED 1,100');
eq(mixedPasses.currency, null, 'so there is no currency to put in front of the figure');
eq(mixedPasses.currencies.join(','), 'AED,GBP', 'both are named, so a screen can say which two');
eq(mixedPasses.priced, 3, 'the unpriced pass is counted as unpriced, not as free');

// Only the rows that CONTRIBUTE are asked, exactly as `summarise` in
// gymRecord.ts asks only the plans inside its MRR. A pass carrying no price
// cannot make a sum it is not part of unsayable.
const unpricedNoCcy = passRevenueCents([pass(50000, 'AED'), pass(null, null)]);
eq(unpricedNoCcy.mixedCurrency, false, 'a pass with no price does not withhold a total it is not in');
eq(unpricedNoCcy.currency, 'AED', 'and the priced rows still name their own money');

// A priced pass that states NO currency is a disagreement, because that figure
// cannot be added to a stated one.
const pricedNoCcy = passRevenueCents([pass(50000, 'AED'), pass(24000, null)]);
eq(pricedNoCcy.mixedCurrency, true, 'a priced pass stating no currency is not silently AED');
eq(pricedNoCcy.currency, null, 'so the sum has no currency of its own');
eq(pricedNoCcy.currencies.join(','), 'AED', 'and only the code somebody actually stated is namable');

eq(passRevenueCents([pass(null, 'AED'), pass(null, 'AED')]).cents, null,
  'no priced pass at all is still a dash, not a nil — nothing about that changed');

/* ── 7. and the close refuses over them ────────────────────────────────────── */

const closeRec = {
  payments: sliceReady([pay(86000, 'AED')]),
  invoices: sliceReady([]),
  sessions: sliceReady([]),
  memberships: sliceReady([]),
  passes: sliceReady([pass(86000, 'AED'), pass(24000, 'GBP')]),
} as unknown as Parameters<typeof buildClose>[0];

const closed = buildClose(closeRec, W, { policy: PAY_DELIVERED_ONLY, now: AFTER, today: '2026-09-02' });
eq(closed.passes?.mixedCurrency, true, 'the close now carries the fact, instead of a bare sum');
eq(closed.passes?.currency, null, 'and refuses to name a currency for two currencies');
eq(closed.passes?.currencies.join(','), 'AED,GBP', 'while still naming both for the sentence');
ok(closed.blockers.some((b) => b.kind === 'mixed_currency' && /[Pp]ass/.test(b.text)),
  `a month whose passes were sold in two currencies is refused — got ${closed.blockers.map((b) => b.kind).join(',')}`);
eq(closed.state, 'blocked', 'so it cannot be signed off with an unexplained figure on it');

const closeOneCcy = buildClose({
  ...closeRec, passes: sliceReady([pass(86000, 'AED'), pass(24000, 'AED')]),
} as unknown as Parameters<typeof buildClose>[0], W, { policy: PAY_DELIVERED_ONLY, now: AFTER, today: '2026-09-02' });
eq(closeOneCcy.passes?.currency, 'AED', 'one currency across the passes names itself');
eq(closeOneCcy.passes?.cents, 110000, 'and the figure stands');
ok(!closeOneCcy.blockers.some((b) => b.kind === 'mixed_currency'),
  'with nothing in the way of closing the month');

/* ── 8. the review sentences count decimal places the way the tiles do ─────── */

// `app/(owner)/financials.tsx` renders these amounts twice on one screen: the
// KPI tiles through `gymMoney`, and the sentences below through `reviewFinances`
// — which carried its own `${currency} ${Math.round(n).toLocaleString()}`. A
// Bahraini owner typing 12,500.25 of net profit read "BHD 12,500.250" in the
// tile and "BHD 12,500" three lines down.
const fin = (patch: Partial<FinInputs>): FinInputs => ({ ...emptyFinances(), ...patch });
const figures = fin({ revenue: 60000.25, expenses: 47500, members: 200, newMembers: 10, churnedMembers: 2 });

const bhd = reviewFinances(figures, 'BHD');
ok(bhd.summary.includes('BHD 12,500.250'),
  `a three-decimal currency keeps its three places — got "${bhd.summary}"`);
ok(!/BHD 12,500\b(?!\.)/.test(bhd.summary),
  `and is never rounded to a whole dinar — got "${bhd.summary}"`);

const jpy = reviewFinances(figures, 'JPY');
ok(jpy.summary.includes('JPY 12,500'), `a zero-decimal currency has no places — got "${jpy.summary}"`);
ok(!jpy.summary.includes('JPY 12,500.'), `and gains none — got "${jpy.summary}"`);

const gbp = reviewFinances(figures, 'GBP');
ok(gbp.summary.includes('GBP 12,500.25'),
  `and two-decimal money keeps the pennies the owner typed — got "${gbp.summary}"`);

// The withheld case is unchanged: percentages survive, amounts do not, and no
// code is invented for a gym that has not set one.
const noCcy = reviewFinances(figures, null);
for (const s of [noCcy.summary, ...noCcy.strengths.map((x) => x.detail), ...noCcy.improvements.map((x) => x.detail)]) {
  ok(!/\b[A-Z]{3}\s[\d,]/.test(s), `no currency set, so no amount may be written — got "${s}"`);
}

/* ── 9. the month's invoices and the arrears are TWO sets ──────────────────── */

// `fetchInvoices` on studio-web/app/close/page.tsx takes no month: it reads
// every invoice the gym has issued up to the month end, because an invoice
// raised in June and still open in August is money owed at the August close.
// `buildClose` then splits that one read in two — `owed` is what was ISSUED IN
// THE MONTH, `arrears` is everything still open up to its end — and sums each
// separately.
//
// The close page derived ONE currency from the rows as they arrived and put it
// beside both figures, so a single EUR invoice raised in 2024 and never paid
// withheld the code from August's GBP billing total. `invoicedCents` then went
// into `gym_month_closes` with a null currency beside it, permanently, and
// gymClose.ts states what an accountant does with an unlabelled figure: prices
// it with the gym's code.
//
// These assertions pin the FACT the fix rests on — that the two sets can give
// two answers. If they ever stop being able to, a single shared answer would be
// correct and this section should fail rather than quietly still pass.
const invOn = (amountCents: number, currency: string, issuedOn: string, status: 'paid' | 'open' = 'paid') =>
  ({ ...inv(amountCents, currency, status), issuedOn });

const spanning = buildClose({
  payments: sliceReady([]),
  invoices: sliceReady([
    invOn(40000, 'EUR', '2024-11-02', 'open'),
    invOn(120000, 'GBP', '2026-08-03', 'paid'),
    invOn(80000, 'GBP', '2026-08-19', 'open'),
  ]),
  sessions: sliceReady([]),
  memberships: sliceReady([]),
  passes: sliceReady([]),
} as unknown as Parameters<typeof buildClose>[0], W, { policy: PAY_DELIVERED_ONLY, now: AFTER, today: '2026-09-02' });

eq(spanning.owed?.currencies.join(','), 'GBP',
  "August's own invoices are all in one money");
eq(spanning.owed?.mixedCurrency, false,
  'so the billing figure for the month is sayable');
eq(spanning.owed?.settledCents, 120000,
  'and it is a real total, not a dash');

eq(spanning.arrears?.currencies.join(','), 'EUR,GBP',
  'while the arrears reach back to a 2024 invoice in another currency');
eq(spanning.arrears?.mixedCurrency, true,
  'so THAT figure is the one that cannot be totalled');
eq(spanning.arrears?.outstandingCents, null,
  'and is withheld, which is correct and always was');

ok(spanning.owed?.mixedCurrency !== spanning.arrears?.mixedCurrency,
  'the two sets disagree about their own money, which is exactly why one answer '
  + 'could not label both figures');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('closeCurrency.test.ts OK');
