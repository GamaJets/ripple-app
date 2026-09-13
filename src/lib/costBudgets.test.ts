// What the gym meant to spend, beside what it did.
//
// ── The six this file exists to stop ──────────────────────────────────────
//
//   1. A VARIANCE WITH ONE SIDE MISSING. A budget and an actual are different
//      kinds of fact — one typed, one produced by the register — and a
//      difference between them is only a fact when both are. Four separate
//      refusals are asserted here: no budget, nothing recorded, a read that did
//      not come back whole, and two currencies.
//
//   2. AN ACTUAL OF ZERO PRESENTED AS AN UNDER-SPEND. This is the dangerous
//      one, because it is silent, plausible and flattering: a gym whose
//      electricity invoice is still in a drawer is not a gym that spent nothing
//      on power, and "80% under budget" is the sentence it would be told on the
//      day it is furthest from true.
//
//   3. TWO CURRENCIES SUBTRACTED. A GBP budget and a EUR premium are two
//      amounts of money and this product holds no rate. Neither a variance nor
//      a percentage may be produced across them, and the currencies must both
//      be named.
//
//   4. A PROPORTION OF NOTHING. A budget of zero is a real intention and it is
//      not a denominator. The money over-spend is stated; the percentage is
//      withheld, because "∞% over" is not a figure anybody can act on.
//
//   5. A REVISION THAT REWRITES THE PAST. A rent budget of 2,400 from January
//      and 2,650 from June must measure May against 2,400 and July against
//      2,650. A single mutable row would have made every month before June
//      quietly agree with the figure typed after it.
//
//   6. A DATE READ AS AN INSTANT. `starts_on` and `ends_on` are DATE columns,
//      and `new Date('2026-06-01')` is May west of Greenwich — so a budget
//      effective from the first of a month would apply to the wrong month for
//      half the world. `npm run test:zones` runs this in six zones.
//
// Compile with tsc, run with node.
import {
  budgetBlockers, budgetFor, budgetReview, budgetNote, budgetsEmptyLine,
  BUDGET_IS_TYPED_NOT_MEASURED, NO_VARIANCE_WITHOUT_BOTH_SIDES,
  type CostBudget, type CostBudgetDraft,
} from './costBudgets';
import type { GymCost } from './gymCosts';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const bud = (over: Partial<CostBudget> = {}): CostBudget => ({
  id: 'b1', category: 'utilities', amountCents: 300_000, currency: 'GBP',
  startsOn: '2026-01-01', endsOn: null, note: null, createdAt: null,
  ...over,
});

const cost = (over: Partial<GymCost> & { paidOn: string }): GymCost => ({
  id: `c${Math.random()}`, description: 'Power', supplier: 'Dunmarrow Power',
  category: 'utilities', amountCents: 420_000, currency: 'GBP',
  note: null, createdAt: null,
  ...over,
});

const draft = (over: Partial<CostBudgetDraft> = {}): CostBudgetDraft => ({
  category: 'utilities', amountText: '3000.00', currency: 'GBP', startsOn: '2026-01-01',
  ...over,
});

const only = (lines: ReturnType<typeof budgetReview>, category: string) =>
  lines.find((l) => l.category === category);

/* ── 1. the four refusals ───────────────────────────────────────────────── */
{
  // (a) No budget. The spending still shows; the comparison does not, and there
  //     is no zero standing in for the plan.
  const noBudget = budgetReview([], [cost({ paidOn: '2026-08-03' })], '2026-08', 'ready');
  eq(noBudget.length, 1, 'a category with spending and no budget is still a line');
  eq(noBudget[0].kind, 'no-budget', 'and it states that there is no budget');
  ok(/on its own/.test(budgetNote(noBudget[0], 'August')), 'saying the figure stands alone');

  // (b) Nothing recorded. THE dangerous one — this must never read as an
  //     under-spend of the whole budget.
  const nothing = budgetReview([bud()], [], '2026-08', 'ready');
  eq(nothing[0].kind, 'nothing-recorded', 'a budget with no costs entered is not an under-spend');
  ok(/not an under-spend/.test(budgetNote(nothing[0], 'August')),
     'and the sentence says so in as many words');
  ok(/nobody has entered|nobody has entered yet|invoice nobody has entered/.test(budgetNote(nothing[0], 'August')),
     'and names the likeliest reason');

  // (c) A read that did not come back whole. Neither side may be stated,
  //     including the actual — a prefix of a month's costs is a smaller actual
  //     and a smaller actual is an under-spend.
  for (const status of ['partial', 'error', 'loading'] as const) {
    const unknown = budgetReview([bud()], [cost({ paidOn: '2026-08-03' })], '2026-08', status);
    eq(unknown[0].kind, 'unknown', `a '${status}' read states no variance`);
    ok(/unknown rather than nothing/.test(budgetNote(unknown[0], 'August')),
       `and a '${status}' read says unknown rather than nothing`);
  }

  // (d) Two currencies. Named on both sides, subtracted on neither.
  const gap = budgetReview(
    [bud({ category: 'insurance' })],
    [cost({ paidOn: '2026-08-03', category: 'insurance', currency: 'EUR', amountCents: 90_000 })],
    '2026-08', 'ready');
  eq(gap[0].kind, 'currency-gap', 'a budget in one currency and costs in another is not a variance');
  const note = budgetNote(gap[0], 'August');
  ok(/GBP/.test(note) && /EUR/.test(note), 'and both currencies are named');
  ok(/no exchange rate/.test(note), 'and the reason is stated rather than implied');

  ok(/both sides are real/.test(NO_VARIANCE_WITHOUT_BOTH_SIDES),
     'and the screen carries the rule the four of these come from');
  ok(/typed/.test(BUDGET_IS_TYPED_NOT_MEASURED), 'and says a budget is a figure somebody typed');
}

/* ── 2. a measured variance, both ways ──────────────────────────────────── */
{
  const over = budgetReview([bud()], [cost({ paidOn: '2026-08-03', amountCents: 420_000 })], '2026-08', 'ready');
  eq(over[0].kind, 'measured', 'a budget and spending in one currency is measured');
  if (over[0].kind === 'measured') {
    eq(over[0].actualCents, 420_000, 'the actual is the register’s figure');
    eq(over[0].diffCents, 120_000, 'the difference is actual less budget');
    eq(over[0].pct, 40, 'and forty per cent over reads as forty');
    eq(over[0].uncovered.length, 0, 'with nothing left out');
  }
  ok(/40% over/.test(budgetNote(over[0], 'August')), 'and the sentence says forty per cent over');

  const under = budgetReview([bud()], [cost({ paidOn: '2026-08-03', amountCents: 240_000 })], '2026-08', 'ready');
  if (under[0].kind === 'measured') {
    eq(under[0].diffCents, -60_000, 'an under-spend is negative');
    eq(under[0].pct, -20, 'and its percentage is negative');
  }
  ok(/20% under/.test(budgetNote(under[0], 'August')), 'and reads as under, not as minus twenty over');

  const exact = budgetReview([bud()], [cost({ paidOn: '2026-08-03', amountCents: 300_000 })], '2026-08', 'ready');
  ok(/Exactly on budget/.test(budgetNote(exact[0], 'August')), 'landing on it says so');

  // Several costs in a category add up, in the one currency they share.
  const many = budgetReview([bud()], [
    cost({ paidOn: '2026-08-03', amountCents: 150_000 }),
    cost({ paidOn: '2026-08-17', amountCents: 200_000 }),
  ], '2026-08', 'ready');
  if (many[0].kind === 'measured') {
    eq(many[0].actualCents, 350_000, 'two bills in a month are one actual');
    eq(many[0].actualCount, 2, 'and the count says how many made it');
  }

  // Costs dated outside the month are the caller's to exclude, and the review
  // takes the rows it is given — but a cost in ANOTHER category must never
  // reach this budget.
  const elsewhere = budgetReview([bud()], [
    cost({ paidOn: '2026-08-03', amountCents: 300_000 }),
    cost({ paidOn: '2026-08-04', category: 'rent', amountCents: 900_000 }),
  ], '2026-08', 'ready');
  const util = only(elsewhere, 'utilities');
  ok(util?.kind === 'measured' && util.diffCents === 0, 'rent is not utilities');
  eq(only(elsewhere, 'rent')?.kind, 'no-budget', 'and rent gets its own unbudgeted line');
}

/* ── 3. a proportion of nothing ─────────────────────────────────────────── */
{
  const zero = budgetReview(
    [bud({ category: 'marketing', amountCents: 0 })],
    [cost({ paidOn: '2026-08-03', category: 'marketing', amountCents: 45_000 })],
    '2026-08', 'ready');
  eq(zero[0].kind, 'measured', 'a budget of nothing that was broken is still measured');
  if (zero[0].kind === 'measured') {
    eq(zero[0].diffCents, 45_000, 'the over-spend is stated in money');
    eq(zero[0].pct, null, 'and the percentage is withheld');
  }
  const note = budgetNote(zero[0], 'August');
  ok(/Over budget/.test(note), 'the sentence still says over budget');
  ok(/proportion of nothing/.test(note), 'and says why there is no percentage');
  ok(!/%/.test(note), 'and contains no percentage at all');

  // A zero budget that was kept is exactly on budget, not an over-spend.
  const kept = budgetReview([bud({ category: 'marketing', amountCents: 0 })], [], '2026-08', 'ready');
  eq(kept[0].kind, 'nothing-recorded', 'a zero budget with nothing recorded is still the honest answer');
}

/* ── 4. a currency the budget does not cover, beside one it does ────────── */
{
  // A gym renting in pounds that paid one supplier in euros. The pound half is
  // measured; the euro half is named and is no part of the arithmetic.
  const mixed = budgetReview([bud()], [
    cost({ paidOn: '2026-08-03', amountCents: 320_000, currency: 'GBP' }),
    cost({ paidOn: '2026-08-09', amountCents: 90_000, currency: 'EUR' }),
  ], '2026-08', 'ready');
  eq(mixed[0].kind, 'measured', 'the side in the budget’s own currency is measured');
  if (mixed[0].kind === 'measured') {
    eq(mixed[0].actualCents, 320_000, 'and the euros are NOT in the actual');
    eq(mixed[0].diffCents, 20_000, 'so the variance is the pounds only');
    eq(mixed[0].uncovered.length, 1, 'with the other currency carried separately');
    eq(mixed[0].uncovered[0].currency, 'EUR', 'and named');
    eq(mixed[0].uncovered[0].minorUnits, 90_000, 'at its own figure, unconverted');
  }
}

/* ── 5. a revision does not rewrite the past ────────────────────────────── */
{
  const budgets = [
    bud({ id: 'old', category: 'rent', amountCents: 240_000, startsOn: '2026-01-01' }),
    bud({ id: 'new', category: 'rent', amountCents: 265_000, startsOn: '2026-06-01' }),
  ];
  eq(budgetFor(budgets, 'rent', '2026-05')?.id, 'old', 'May is measured against what was planned in January');
  eq(budgetFor(budgets, 'rent', '2026-06')?.id, 'new', 'June against the figure that starts in June');
  eq(budgetFor(budgets, 'rent', '2026-07')?.id, 'new', 'and so is July');
  eq(budgetFor(budgets, 'rent', '2025-12'), null, 'a month before the first plan has none');

  // A budget effective from mid-month applies to the whole of that month: it is
  // a monthly figure, and ignoring it until the following month would leave the
  // month somebody was thinking about when they typed it uncompared.
  const mid = [bud({ id: 'mid', category: 'rent', startsOn: '2026-06-14' })];
  eq(budgetFor(mid, 'rent', '2026-06')?.id, 'mid', 'a mid-month start covers that month');
  eq(budgetFor(mid, 'rent', '2026-05'), null, 'and not the one before it');

  // Ending one stops it applying afterwards and leaves the months it did apply
  // to measurable.
  const ended = [bud({ id: 'e', category: 'stock', startsOn: '2026-01-01', endsOn: '2026-06-30' })];
  eq(budgetFor(ended, 'stock', '2026-06')?.id, 'e', 'the month it ended in is still covered');
  eq(budgetFor(ended, 'stock', '2026-07'), null, 'and the one after is not');

  eq(budgetFor(budgets, 'rent', 'not-a-month'), null, 'a non-month has no budget');
  eq(budgetFor(budgets, 'utilities', '2026-07'), null, 'and a category with no plan has none');
}

/* ── 6. a DATE is not an instant ────────────────────────────────────────── */
{
  // The first of a month is that month in every zone. Parsed as UTC it is the
  // month before for half the world, and the budget would apply one month early.
  const first = [bud({ id: 'f', category: 'rent', startsOn: '2026-06-01' })];
  eq(budgetFor(first, 'rent', '2026-06')?.id, 'f', 'a budget from the 1st starts that month, in every zone');
  eq(budgetFor(first, 'rent', '2026-05'), null, 'and not the month before');

  const last = [bud({ id: 'l', category: 'rent', startsOn: '2026-01-01', endsOn: '2026-06-30' })];
  eq(budgetFor(last, 'rent', '2026-06')?.id, 'l', 'ending on the last day of a month covers that month');
  eq(budgetFor(last, 'rent', '2026-07'), null, 'and stops after it');

  // Across a year boundary, where a key built by subtraction goes wrong.
  const ny = [bud({ id: 'n', category: 'rent', startsOn: '2027-01-01' })];
  eq(budgetFor(ny, 'rent', '2026-12'), null, 'January is after the December before it');
  eq(budgetFor(ny, 'rent', '2027-01')?.id, 'n', 'and covers its own month');
}

/* ── the order the list comes out in ────────────────────────────────────── */
{
  const budgets = [
    bud({ id: 'u', category: 'utilities', amountCents: 300_000 }),
    bud({ id: 'r', category: 'rent', amountCents: 1_000_000 }),
    bud({ id: 's', category: 'stock', amountCents: 100_000 }),
    bud({ id: 'm', category: 'marketing', amountCents: 200_000 }),
  ];
  const lines = budgetReview(budgets, [
    cost({ paidOn: '2026-08-01', category: 'utilities', amountCents: 420_000 }),  // +40%
    cost({ paidOn: '2026-08-01', category: 'rent', amountCents: 1_100_000 }),     // +10%
    cost({ paidOn: '2026-08-01', category: 'stock', amountCents: 95_000 }),       //  −5%
    // marketing: nothing recorded
    cost({ paidOn: '2026-08-01', category: 'finance', amountCents: 8_000 }),      // no budget
  ], '2026-08', 'ready');

  eq(lines[0].category, 'utilities', 'the worst over-spend is first');
  eq(lines[1].category, 'rent', 'then the next one');
  eq(lines[2].category, 'finance', 'then the lines that state no variance');
  eq(lines[3].category, 'marketing', 'including the budget with nothing entered against it');
  eq(lines[4].category, 'stock', 'and the categories inside their budget come last');

  // A category neither side mentions is absent, not shown at zero: a
  // "Licences — 0.00 of 0.00" row is a statement about money nobody has made.
  ok(!lines.some((l) => l.category === 'licensing'), 'a category with neither a budget nor a cost is absent');

  // A budget that does not cover this month does not create a line either.
  const future = budgetReview([bud({ category: 'licensing', startsOn: '2027-01-01' })], [], '2026-08', 'ready');
  eq(future.length, 0, 'a budget that starts next year makes no line this year');
}

/* ── what the form refuses ──────────────────────────────────────────────── */
{
  eq(budgetBlockers(draft()).length, 0, 'a complete draft has nothing wrong with it');
  eq(budgetBlockers(draft({ amountText: '0' })).length, 0,
     'a budget of nothing is a real intention and is accepted');

  ok(budgetBlockers(draft({ currency: null })).some((b) => /currency/i.test(b)),
     'a gym with no currency cannot set a budget at all');
  ok(budgetBlockers(draft({ amountText: '' })).length > 0, 'a budget with no figure is not a budget');
  ok(budgetBlockers(draft({ amountText: '12.5', currency: 'JPY' })).length > 0,
     'a yen with a decimal place is refused by the currency’s own reader');
  ok(budgetBlockers(draft({ amountText: '1,234.50' })).length > 0,
     'and a thousands separator is refused rather than guessed at');
  eq(budgetBlockers(draft({ amountText: '1250.500', currency: 'KWD' })).length, 0,
     'and a Kuwaiti dinar keeps its third place');
  ok(budgetBlockers(draft({ startsOn: '' })).some((b) => /starts from/i.test(b)),
     'a budget with no start month is refused');
  ok(budgetBlockers(draft({ category: 'not-a-category' as never })).some((b) => /which kind/i.test(b)),
     'and a category the cost table would refuse is caught here');
}

/* ── an empty list says which kind of empty it is ───────────────────────── */
{
  ok(/could not be read/.test(budgetsEmptyLine('error')), 'a failed read says the read failed');
  ok(/not all of them/.test(budgetsEmptyLine('partial')), 'a truncated one says it is a prefix');
  ok(/No budget is set/.test(budgetsEmptyLine('ready')), 'and a real empty says nothing is set');
  ok(!/could not be read/.test(budgetsEmptyLine('ready')), 'without borrowing the failure’s sentence');
}

if (errors.length) {
  console.error(`costBudgets: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('costBudgets: ok');
