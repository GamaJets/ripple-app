// Who the gym pays, and whether a category is moving.
//
// ── The seven this file exists to stop ────────────────────────────────────
//
//   1. TWO CURRENCIES ADDED. A gym paying a British engineer in pounds and a
//      German one in euros has two amounts of money. Every line here is keyed
//      on (category, currency) or (supplier, currency), and the assertions
//      below check that one payee in two currencies is two lines and that no
//      figure anywhere is their sum.
//
//   2. AN AVERAGE OVER MONTHS THE GYM DOES NOT HAVE. A four-month-old gym read
//      over a six-month look-back would have every run rate cut by a third,
//      and every category in its books would read as rising. The denominator
//      is months ON RECORD.
//
//   3. NOTHING RECORDED READ AS A SAVING. A category with a history and no
//      invoice typed yet is `nothing-this-month` and says so — it is never a
//      zero, never "100% below", and the wording is asserted.
//
//   4. A FIRST-EVER COST READ AS AN INFINITE RISE. A new supplier's first
//      invoice has no baseline, and the answer is a sentence rather than a
//      percentage.
//
//   5. A FIGURE OUT OF A READ THAT DID NOT COME BACK WHOLE. 'loading',
//      'error' AND 'partial' all give null on both functions, never an empty
//      list — an empty supplier table is the claim "this gym pays nobody".
//
//   6. A MISSING AMOUNT OR A MISSING CURRENCY COUNTED AS NOUGHT. Both are
//      counted out and reported, on both functions.
//
//   7. A DATE READ AS AN INSTANT. `paid_on` is a DATE, and `new Date(
//      '2026-06-01')` is May west of Greenwich — so a cost on the first of a
//      month would land in the previous month's average for half the world.
//      The month is taken with a string slice, and `npm run test:zones` runs
//      this in six.
//
// Compile with tsc, run with node.
import {
  supplierSpend, categoryTrend, trendNote, unnamedPayeeNote,
  type TrendLine,
} from './costTrend';
import type { GymCost } from './gymCosts';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

let n = 0;
const cost = (over: Partial<GymCost> & { paidOn: string }): GymCost => ({
  id: `c${(n += 1)}`, description: 'Power', supplier: 'Dunmarrow Power',
  category: 'utilities', amountCents: 100_000, currency: 'GBP',
  note: null, createdAt: null,
  ...over,
});

/** The six complete months before September 2026, newest first, exactly as
 *  `monthsBefore` hands them to the screen. */
const WINDOW = ['2026-08', '2026-07', '2026-06', '2026-05', '2026-04', '2026-03'];

const line = (t: ReturnType<typeof categoryTrend>, category: string, currency: string): TrendLine | undefined =>
  t?.lines.find((l) => l.category === category && l.currency === currency);

/* ── 1. an unread side produces nothing, never an empty answer ───────────── */
{
  const rows = [cost({ paidOn: '2026-09-02' })];
  for (const bad of ['loading', 'partial', 'error'] as const) {
    eq(supplierSpend(rows, bad), null, `supplierSpend refuses a '${bad}' read`);
    eq(categoryTrend(rows, rows, WINDOW, bad, 'ready'), null,
       `categoryTrend refuses a '${bad}' month`);
    eq(categoryTrend(rows, rows, WINDOW, 'ready', bad), null,
       `categoryTrend refuses a '${bad}' history`);
  }
  ok(supplierSpend(rows, 'ready') !== null, 'and answers a whole one');
  ok(categoryTrend(rows, rows, WINDOW, 'ready', 'ready') !== null, 'on both sides');
}

/* ── 2. a supplier in two currencies is two lines, never one sum ─────────── */
{
  const s = supplierSpend([
    cost({ paidOn: '2026-09-02', supplier: 'Hale Engineering', amountCents: 40_000, currency: 'GBP' }),
    cost({ paidOn: '2026-09-11', supplier: 'Hale Engineering', amountCents: 25_000, currency: 'EUR' }),
    cost({ paidOn: '2026-09-19', supplier: 'Hale Engineering', amountCents: 10_000, currency: 'GBP' }),
  ], 'ready')!;
  eq(s.lines.length, 2, 'one payee in two currencies is two lines');
  const gbp = s.lines.find((l) => l.currency === 'GBP')!;
  const eur = s.lines.find((l) => l.currency === 'EUR')!;
  eq(gbp.minorUnits, 50_000, 'the pounds are added to each other');
  eq(eur.minorUnits, 25_000, 'and the euros to each other');
  ok(!s.lines.some((l) => l.minorUnits === 75_000), 'and nothing anywhere holds their sum');
  eq(gbp.count, 2, 'the count is of rows in that currency');
  eq(gbp.lastPaidOn, '2026-09-19', 'and the last payment is the newest day');
}

/* ── 3. the payee is matched case-insensitively and read back as written ─── */
{
  const s = supplierSpend([
    cost({ paidOn: '2026-07-01', supplier: 'edf energy', amountCents: 30_000 }),
    cost({ paidOn: '2026-09-01', supplier: 'EDF Energy', amountCents: 30_000 }),
  ], 'ready')!;
  eq(s.lines.length, 1, 'one payee spelled two ways is one line');
  eq(s.lines[0].supplier, 'EDF Energy', 'read back as the gym most recently wrote it');
  eq(s.lines[0].months, 2, 'and seen in two distinct months');
}

/* ── 4. a cost with no payee is counted out, never given an invented name ── */
{
  const s = supplierSpend([
    cost({ paidOn: '2026-09-02', supplier: null, amountCents: 9_000 }),
    cost({ paidOn: '2026-09-03', supplier: '   ', amountCents: 9_000 }),
    cost({ paidOn: '2026-09-04', supplier: 'Hale', amountCents: 1_000 }),
  ], 'ready')!;
  eq(s.unnamed, 2, 'both unnamed costs are counted');
  eq(s.lines.length, 1, 'and neither becomes a supplier');
  ok(!s.lines.some((l) => /not stated|unknown|other/i.test(l.supplier)),
     'nothing in the table is a made-up payee');
  ok(/no payee/.test(unnamedPayeeNote(s) ?? ''), 'and the note says how many are outside it');
}

/* ── 5. no amount and no currency are counted out on both functions ──────── */
{
  const rows = [
    cost({ paidOn: '2026-09-02', supplier: 'Hale', amountCents: null }),
    cost({ paidOn: '2026-09-03', supplier: 'Hale', currency: null }),
    cost({ paidOn: '2026-09-04', supplier: 'Hale', amountCents: 5_000 }),
  ];
  const s = supplierSpend(rows, 'ready')!;
  eq(s.uncounted, 2, 'a row with no amount and one with no currency are both counted out');
  eq(s.lines[0].minorUnits, 5_000, 'and neither is added in as a nought');
  ok(/not a nought|not noughts/.test(unnamedPayeeNote(s) ?? ''), 'and the note refuses to call them zero');

  const t = categoryTrend(rows, [], WINDOW, 'ready', 'ready')!;
  eq(t.uncounted, 2, 'the trend counts them out too');
}

/* ── 6. the average divides by months ON RECORD, not by the window ───────── */
{
  // Two months of history in a six-month window: 100,000 in each.
  const past = [
    cost({ paidOn: '2026-07-10', amountCents: 100_000 }),
    cost({ paidOn: '2026-08-10', amountCents: 100_000 }),
  ];
  const t = categoryTrend([cost({ paidOn: '2026-09-10', amountCents: 150_000 })], past, WINDOW, 'ready', 'ready')!;
  eq(t.monthsOnRecord, 2, 'two months hold costs, so the denominator is two');
  eq(t.monthsLookedAt, 6, 'though six were looked at');
  const l = line(t, 'utilities', 'GBP')!;
  ok(l.kind === 'measured', 'both sides are real, so this is measured');
  if (l.kind === 'measured') {
    eq(l.average, 100_000, 'the run rate is 200,000 over TWO months and not over six');
    eq(l.diff, 50_000, 'this month is 50,000 above it');
    eq(l.pct, 50, 'which is fifty per cent');
  }
  // The defect this guards: dividing by six would give 33,333 and call this
  // month 350% above its run rate.
  if (l.kind === 'measured') ok(l.average !== 33_333, 'never the window-width average');
}

/* ── 7. a month on record counts even when THIS category was not in it ───── */
{
  const past = [
    cost({ paidOn: '2026-07-10', category: 'rent', amountCents: 500_000 }),
    cost({ paidOn: '2026-08-10', category: 'utilities', amountCents: 100_000 }),
  ];
  const t = categoryTrend([cost({ paidOn: '2026-09-10', amountCents: 100_000 })], past, WINDOW, 'ready', 'ready')!;
  eq(t.monthsOnRecord, 2, 'both months are on record, whatever was in them');
  const l = line(t, 'utilities', 'GBP')!;
  if (l.kind === 'measured') {
    eq(l.average, 50_000, 'so a category present in one of two months averages over two');
    eq(l.pct, 100, 'and this month reads as double its run rate, which it is');
  }
}

/* ── 8. nothing recorded this month is never a saving ────────────────────── */
{
  const past = [
    cost({ paidOn: '2026-07-10', amountCents: 100_000 }),
    cost({ paidOn: '2026-08-10', amountCents: 100_000 }),
  ];
  const t = categoryTrend([], past, WINDOW, 'ready', 'ready')!;
  const l = line(t, 'utilities', 'GBP')!;
  eq(l.kind, 'nothing-this-month', 'a history with nothing this month has its own arm');
  ok(!('thisMonth' in l), 'and carries no this-month figure at all — there is none');
  const note = trendNote(l, 'September 2026', t.monthsOnRecord);
  ok(/not a saving/.test(note), 'the sentence says it is not a saving');
  ok(/nobody has entered/.test(note), 'and names the commonest cause');
  ok(!/100%|below/.test(note), 'and never states a proportion below the run rate');
}

/* ── 9. a first-ever cost is a new line, not an infinite rise ────────────── */
{
  const past = [cost({ paidOn: '2026-08-10', category: 'rent', amountCents: 500_000 })];
  const t = categoryTrend([cost({ paidOn: '2026-09-10', category: 'insurance', amountCents: 80_000 })],
                          past, WINDOW, 'ready', 'ready')!;
  const l = line(t, 'insurance', 'GBP')!;
  eq(l.kind, 'first-time', 'a category with no history is first-time');
  ok(!/%/.test(trendNote(l, 'September 2026', t.monthsOnRecord)), 'and is given no percentage');
  ok(/not a rise/.test(trendNote(l, 'September 2026', t.monthsOnRecord)), 'and says so');
}

/* ── 10. a gym with no history at all gets a sentence, not a comparison ──── */
{
  const t = categoryTrend([cost({ paidOn: '2026-09-10', amountCents: 80_000 })], [], WINDOW, 'ready', 'ready')!;
  eq(t.monthsOnRecord, 0, 'no month before this one holds anything');
  const l = line(t, 'utilities', 'GBP')!;
  eq(l.kind, 'no-baseline', 'so the line refuses to compare');
  ok(/nothing to compare/.test(trendNote(l, 'September 2026', 0)), 'and says why');
}

/* ── 11. a run rate of nothing is not a denominator ──────────────────────── */
{
  // A month on record holding a cost of zero: the average is 0, and a
  // proportion of nothing is not a number.
  const past = [cost({ paidOn: '2026-08-10', amountCents: 0 })];
  const t = categoryTrend([cost({ paidOn: '2026-09-10', amountCents: 40_000 })], past, WINDOW, 'ready', 'ready')!;
  const l = line(t, 'utilities', 'GBP')!;
  if (l.kind === 'measured') {
    eq(l.average, 0, 'the run rate really is nothing');
    eq(l.pct, null, 'so there is no percentage');
    eq(l.diff, 40_000, 'and the money difference is stated instead');
    ok(/not a number/.test(trendNote(l, 'September 2026', 1)), 'and the sentence says why');
  } else {
    ok(false, 'a zero run rate with spending this month is still measured');
  }
}

/* ── 12. the same category in two currencies never meets ─────────────────── */
{
  const past = [
    cost({ paidOn: '2026-07-10', amountCents: 100_000, currency: 'GBP' }),
    cost({ paidOn: '2026-08-10', amountCents: 900_000, currency: 'JPY' }),
  ];
  const t = categoryTrend([
    cost({ paidOn: '2026-09-10', amountCents: 120_000, currency: 'GBP' }),
  ], past, WINDOW, 'ready', 'ready')!;
  const gbp = line(t, 'utilities', 'GBP')!;
  const jpy = line(t, 'utilities', 'JPY')!;
  eq(gbp.kind, 'measured', 'the pounds compare against pounds');
  if (gbp.kind === 'measured') eq(gbp.average, 50_000, 'over two months on record');
  eq(jpy.kind, 'nothing-this-month', 'and the yen have no September figure of their own');
  ok(!t.lines.some((l) => l.kind === 'measured' && l.currency === 'JPY'),
     'no yen line is ever measured against a pound one');
}

/* ── 13. a cost outside the window is not history ────────────────────────── */
{
  const past = [
    // February is before the six-month window ending in August.
    cost({ paidOn: '2026-02-10', amountCents: 600_000 }),
    cost({ paidOn: '2026-08-10', amountCents: 100_000 }),
  ];
  const t = categoryTrend([cost({ paidOn: '2026-09-10', amountCents: 100_000 })], past, WINDOW, 'ready', 'ready')!;
  eq(t.monthsOnRecord, 1, 'only August is inside the window');
  const l = line(t, 'utilities', 'GBP')!;
  if (l.kind === 'measured') eq(l.average, 100_000, 'and February is in no average');
}

/* ── 14. the month is a string slice, so no zone can move it ─────────────── */
{
  // The first of the month, which `new Date('2026-08-01')` reads as 31 July
  // west of Greenwich. Under `npm run test:zones` this runs in six zones and
  // has to give the same answer in all of them.
  const t = categoryTrend(
    [cost({ paidOn: '2026-09-01', amountCents: 100_000 })],
    [cost({ paidOn: '2026-08-01', amountCents: 100_000 })],
    WINDOW, 'ready', 'ready',
  )!;
  eq(t.monthsOnRecord, 1, 'a cost paid on the 1st is in that month, in every timezone');
  const l = line(t, 'utilities', 'GBP')!;
  eq(l.kind, 'measured', 'and September the 1st is this month, not last');
  if (l.kind === 'measured') eq(l.diff, 0, 'so the two match exactly');

  const s = supplierSpend([cost({ paidOn: '2026-03-01', supplier: 'Hale' })], 'ready')!;
  eq(s.lines[0].months, 1, 'and the supplier is seen in exactly one month');
}

/* ── 15. above the run rate sorts first, largest proportion first ────────── */
{
  const past = [
    cost({ paidOn: '2026-08-01', category: 'rent', amountCents: 100_000 }),
    cost({ paidOn: '2026-08-02', category: 'utilities', amountCents: 100_000 }),
    cost({ paidOn: '2026-08-03', category: 'cleaning', amountCents: 100_000 }),
  ];
  const t = categoryTrend([
    cost({ paidOn: '2026-09-01', category: 'rent', amountCents: 110_000 }),        // +10%
    cost({ paidOn: '2026-09-02', category: 'utilities', amountCents: 180_000 }),   // +80%
    cost({ paidOn: '2026-09-03', category: 'cleaning', amountCents: 40_000 }),     // −60%
  ], past, WINDOW, 'ready', 'ready')!;
  eq(t.lines[0].category, 'utilities', 'the largest rise is first');
  eq(t.lines[1].category, 'rent', 'then the smaller one');
  eq(t.lines[2].category, 'cleaning', 'and the fall is last');
}

if (errors.length) {
  console.error(`costTrend: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('costTrend: ok');
