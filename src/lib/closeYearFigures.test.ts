// A year read down the column, and the four ways that column can lie.
//
// The sentences this file exists to make impossible, each of which a year-end
// total arrived at by `reduce` would have printed:
//
//   · "AED 72,000" over a gym that filed eight months in dirhams and four in
//     pounds. There is no such amount of money.
//   · "£38,400" over a year with nine months closed and three never signed off.
//     That is nine months wearing the year's name.
//   · "£38,400" over a year one of whose closes filed no amount at all,
//     because the month it covered held two moneys.
//   · A payroll figure priced with the code a card machine took, borrowed off
//     the pre-2540 single `currency` column.
//
// Compile with tsc, run with node.
import {
  closeYearFigures, yearFigureNote, figureOn, CLOSE_FIGURE_LABEL,
  type CloseFigure,
} from './closeYearFigures';
import type { MonthCloseRow } from './gymClose';
import type { YearMonth, MonthCloseState } from './closeYear';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** A stored close, with only the columns this module reads stated. */
function close(over: Partial<MonthCloseRow> = {}): MonthCloseRow {
  return {
    id: 'c', monthKey: '2026-01', closedAt: '', closedBy: null, closedByName: null, note: null,
    takenCents: null, invoicedCents: null, outstandingCents: null, payrollCents: null,
    takenCurrency: null, invoicedCurrency: null, outstandingCurrency: null, payrollCurrency: null,
    currency: null,
    ...over,
  } as MonthCloseRow;
}

function month(key: string, state: MonthCloseState, live: MonthCloseRow | null): YearMonth {
  return { key, label: key, state, live, history: live ? [live] : [], reopens: [], blockersAtClose: null } as YearMonth;
}

/** A closed month that filed one amount of one money for all four figures. */
function filed(key: string, cents: number, ccy: string): YearMonth {
  return month(key, 'closed', close({
    monthKey: key,
    takenCents: cents, takenCurrency: ccy,
    invoicedCents: cents, invoicedCurrency: ccy,
    outstandingCents: cents, outstandingCurrency: ccy,
    payrollCents: cents, payrollCurrency: ccy,
  }));
}

const pick = (fs: ReturnType<typeof closeYearFigures>, f: CloseFigure) =>
  fs.find((x) => x.figure === f)!;

/* ── four columns, always, and each one labelled ───────────────────────────── */
{
  const fs = closeYearFigures([filed('2026-01', 10000, 'GBP')]);
  eq(fs.length, 4, 'the four figures a close files');
  eq(fs.map((f) => f.label).join(','), 'Taken,Billed,Still owed,Payroll',
    'named the way the tiles on the month are named');
  eq(CLOSE_FIGURE_LABEL.outstanding, 'Still owed', 'and the map is the one the screen reads');
}

/* ── a clean year adds up, and says so ─────────────────────────────────────── */
{
  const months = ['01', '02', '03'].map((m) => filed(`2026-${m}`, 10000, 'GBP'));
  const t = pick(closeYearFigures(months), 'taken');
  eq(t.q.pots.length, 1, 'one money');
  eq(t.q.pots[0].minorUnits, 30000, 'and the three months are one figure');
  eq(t.closed, 3, 'three months filed it');
  eq(t.unfiled, 0, 'none is missing');
  ok(t.whole, 'so this is a figure another may be derived from');
  ok(yearFigureNote(t, 2026).includes('Every one of the 3 months'),
    `the sentence says the year is complete — got: ${yearFigureNote(t, 2026)}`);
}

/* ── two moneys down one column are two figures ────────────────────────────── */
{
  // The defect, at the year scale: eight months in dirhams, four in pounds.
  const months = [
    ...['01', '02'].map((m) => filed(`2026-${m}`, 600000, 'AED')),
    ...['03', '04'].map((m) => filed(`2026-${m}`, 40000, 'GBP')),
  ];
  const t = pick(closeYearFigures(months), 'taken');
  eq(t.q.pots.length, 2, 'two currencies are two pots');
  eq(t.q.pots[0].currency, 'AED', 'biggest first');
  eq(t.q.pots[0].minorUnits, 1200000, 'and each is a total of like things');
  eq(t.q.pots[1].minorUnits, 80000, 'the other one is not folded into it');
  ok(!t.whole, 'and nothing may be derived from a column holding two moneys');
  ok(yearFigureNote(t, 2026).includes('never added down the column'),
    'and the sentence says they were not added');
}

/* ── a month nobody closed is not a month that took nothing ────────────────── */
{
  const months = [
    ...['01', '02', '03'].map((m) => filed(`2026-${m}`, 10000, 'GBP')),
    month('2026-04', 'open', null),
    month('2026-05', 'open', null),
  ];
  const t = pick(closeYearFigures(months), 'taken');
  eq(t.closed, 3, 'three months are filed');
  eq(t.unfiled, 2, 'two ended and were never signed off');
  eq(t.q.pots[0].minorUnits, 30000, 'the figure is the three that were');
  eq(t.q.unpriced, 0, 'and the two are NOT rows that filed no amount');
  ok(!t.whole, 'a year missing two months is not the year');
  const note = yearFigureNote(t, 2026);
  ok(note.includes('Covering the 3 of 5 months'), `the sentence names the gap — got: ${note}`);
  ok(note.includes('left out rather than counted as nothing'), 'and what was done with it');
}

/* ── a month that has not happened is not a month anybody is waiting on ─────── */
{
  const months = [
    ...['01', '02'].map((m) => filed(`2026-${m}`, 10000, 'GBP')),
    month('2026-03', 'running', null),
  ];
  const t = pick(closeYearFigures(months), 'taken');
  eq(t.running, 1, 'one month has not ended');
  eq(t.unfiled, 0, 'and it is not counted as unsigned');
  ok(t.whole, 'so the year so far is still a whole figure');
  ok(yearFigureNote(t, 2026).includes('not waiting on anybody'),
    'and the sentence says why the running month is not a gap');
}

/* ── a month closed and then reopened has withdrawn its figure ──────────────── */
{
  // The close carried a real amount and was deliberately taken apart, with a
  // written reason. Carrying the withdrawn number into the year would erase
  // that decision.
  const withdrawn = close({ monthKey: '2026-02', takenCents: 999999, takenCurrency: 'GBP', reopenedAt: '2026-03-01T00:00:00Z' } as Partial<MonthCloseRow>);
  const months = [
    filed('2026-01', 10000, 'GBP'),
    { ...month('2026-02', 'reopened', null), history: [withdrawn], reopens: [withdrawn] } as YearMonth,
  ];
  const t = pick(closeYearFigures(months), 'taken');
  eq(t.q.pots[0].minorUnits, 10000, 'the reopened month contributes nothing');
  eq(t.unfiled, 1, 'and it counts as a month with no close in force');
  ok(!t.whole, 'so the year is not whole');
}

/* ── a close that filed no amount is not a close that filed nothing ─────────── */
{
  // `takenCents` is null on a close taken over a month whose payments spanned
  // two moneys. The month IS closed; the record cannot price it.
  const months = [
    ...['01', '02'].map((m) => filed(`2026-${m}`, 10000, 'GBP')),
    month('2026-03', 'closed', close({ monthKey: '2026-03', takenCents: null, takenCurrency: null })),
  ];
  const t = pick(closeYearFigures(months), 'taken');
  eq(t.closed, 3, 'three months are closed');
  eq(t.unfiled, 0, 'none is unsigned');
  eq(t.q.unpriced, 1, 'and one of the three filed no amount');
  eq(t.q.pots[0].minorUnits, 20000, 'which is outside the figure, not inside it at nothing');
  ok(!t.whole, 'so nothing may be derived from it');
  const note = yearFigureNote(t, 2026);
  ok(note.includes('1 filed no amount for it'), `and the sentence names it — got: ${note}`);
}

/* ── an amount filed with no currency is not the gym's currency ─────────────── */
{
  const months = [
    filed('2026-01', 10000, 'GBP'),
    month('2026-02', 'closed', close({ monthKey: '2026-02', takenCents: 50000, takenCurrency: null })),
  ];
  const t = pick(closeYearFigures(months), 'taken');
  eq(t.q.unlabelled, 1, 'a filed amount naming no money is its own hole');
  eq(t.q.pots[0].minorUnits, 10000, 'and its cents reach nothing');
  ok(yearFigureNote(t, 2026).includes('1 filed an amount and no currency'),
    'named as the kind of hole it is, because it sends somebody somewhere else');
}

/* ── the legacy single code speaks for the takings and for nothing else ─────── */
{
  // The pre-2540 row: one `currency`, derived payments-first, with all four
  // figures under it. Borrowing it for payroll prices a filed pay run with the
  // code a card machine happened to take that month.
  const legacy = close({
    monthKey: '2026-01', currency: 'GBP',
    takenCents: 10000, invoicedCents: 20000, outstandingCents: 3000, payrollCents: 4000,
  });
  eq(figureOn(legacy, 'taken').currency, 'GBP', 'Taken may wear it');
  eq(figureOn(legacy, 'payroll').currency, null, 'Payroll may NOT');
  eq(figureOn(legacy, 'invoiced').currency, null, 'nor Billed');
  eq(figureOn(legacy, 'outstanding').currency, null, 'nor Still owed');

  const fs = closeYearFigures([month('2026-01', 'closed', legacy)]);
  eq(pick(fs, 'taken').q.pots.length, 1, 'so the year has a Taken figure');
  eq(pick(fs, 'payroll').q.pots.length, 0, 'and no Payroll one');
  eq(pick(fs, 'payroll').q.unlabelled, 1, 'the payroll month is an amount in no stated money');
}

/* ── a figure's OWN column wins over the legacy one ─────────────────────────── */
{
  const both = close({ monthKey: '2026-01', currency: 'AED', takenCents: 10000, takenCurrency: 'GBP' });
  eq(figureOn(both, 'taken').currency, 'GBP',
    'the column written since 2540 is the answer; the legacy one is only a fallback');
}

/* ── no months at all is a year nobody closed, never a year of zeroes ───────── */
{
  // `closeYear` hands an EMPTY month list for a record it could not read, and
  // this inherits that refusal: four columns covering nothing, no pot, no zero.
  const fs = closeYearFigures([]);
  eq(fs.length, 4, 'still four columns');
  for (const f of fs) {
    eq(f.q.pots.length, 0, `${f.label}: no pot`);
    eq(f.closed, 0, `${f.label}: nothing filed`);
    ok(!f.whole, `${f.label}: and nothing derivable`);
  }
  ok(yearFigureNote(fs[0], 2026).includes('nobody has signed off'),
    'and the sentence is about the signing off rather than about the money');
}

/* ── a year that has only just started ──────────────────────────────────────── */
{
  const fs = closeYearFigures([month('2027-01', 'running', null)]);
  ok(yearFigureNote(pick(fs, 'taken'), 2027).includes('has finished yet'),
    'a year with nothing ended is not a year nobody closed');
}

/* ── the four columns are independent ───────────────────────────────────────── */
{
  // One month filed a taken figure and no payroll figure — a close taken while
  // the sessions read had failed. Only the payroll column is short.
  const months = [
    filed('2026-01', 10000, 'GBP'),
    month('2026-02', 'closed', close({
      monthKey: '2026-02',
      takenCents: 20000, takenCurrency: 'GBP',
      invoicedCents: 20000, invoicedCurrency: 'GBP',
      outstandingCents: 0, outstandingCurrency: 'GBP',
      payrollCents: null, payrollCurrency: null,
    })),
  ];
  const fs = closeYearFigures(months);
  ok(pick(fs, 'taken').whole, 'the takings are whole');
  ok(!pick(fs, 'payroll').whole, 'and the payroll is not');
  eq(pick(fs, 'payroll').q.unpriced, 1, 'by exactly one month');
  eq(pick(fs, 'outstanding').q.pots[0].minorUnits, 10000,
    'a filed ZERO is a real figure and is counted — it is only null that is not');
  eq(pick(fs, 'outstanding').q.counted, 2, 'both months are inside it');
}

if (errors.length) {
  console.error(`closeYearFigures: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('closeYearFigures ok');
