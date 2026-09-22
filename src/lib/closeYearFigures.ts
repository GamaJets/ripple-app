// A year of FILED figures, read down the column the way an accountant reads it.
//
// ── the gap ───────────────────────────────────────────────────────────────
//
// Every product a gym owner might leave to come here — Mindbody, Glofox,
// Xplor/Clubworx, TeamUp, Zen Planner — opens its finance area on a period
// comparison: this month beside last month, and a year-to-date column. Repple's
// /close answers "is THIS month closed" superbly and could not answer "what did
// we file for the year" at all. `closeYear` was the first view to read the
// history as a year, and it reads only the STATE of each month — closed,
// reopened, open, running — while `gym_month_closes` has carried the four
// filed figures and (since supabase/parts/2540) a currency column for each of
// them on every row it returns.
//
// So the figures were already in the browser, already read, already scoped to
// the gym, and nothing looked down the column. That is what this module does,
// and it is the whole of it: no read, no schema change, no new dependency.
//
// ── why it is not a `reduce` ──────────────────────────────────────────────
//
// Three separate ways a year total can be a lie, and a sum has none of them:
//
//   1. TWO MONEYS. A gym that filed August in AED and September in GBP has two
//      year figures, not one. `quotedTotal.ts` holds that rule for the two
//      screens and it holds it here — one pot per currency, side by side, never
//      added, because this app has no rate and a figure built from a rate
//      nobody chose is the worst thing a year-end column could produce.
//   2. A MONTH THAT WAS NEVER CLOSED. It contributes nothing, and it is not a
//      month that took nothing. A twelve-month column summing nine closed
//      months is not the year — it is nine months wearing the year's name — and
//      the gap is exactly what a person reading a year-end column cannot see
//      from the number. So it is counted and said.
//   3. A MONTH WHOSE OWN FIGURE WAS NULL WHEN IT WAS FILED. `takenCents` is
//      null on a close taken over a month whose payments spanned two moneys, or
//      whose read did not come back. That is a month the record cannot price,
//      not a month worth nothing, and `quotedOf` already has a name for it.
//
// A month that was CLOSED and then REOPENED and not closed again contributes
// nothing either, and that is deliberate rather than incidental: `live` is null
// for it, the figure it once filed was taken apart on purpose with a written
// reason, and carrying the withdrawn number into a year total would be the
// erasure of that decision.
//
// ── the legacy currency column ────────────────────────────────────────────
//
// `MonthCloseRow.currency` is the single code /close wrote before 2540, and it
// was derived payments-first. It may therefore speak for `takenCents` and for
// nothing else on the row — pricing a filed payroll figure with the code a card
// machine happened to take that month is the defect the four columns were split
// to end. The two "at the close" readers on /close already apply that rule by
// hand; it lives here now so the year column and the month tiles cannot drift.
//
// Pure: rows in, figures out. No client, no `Date`, no formatter — the caller
// brings its own, for the reason quotedTotal.ts gives at length.
import { quotedOf, quotedShort, quotedWhole, type Quoted, type QuotedRow } from './quotedTotal';
import type { MonthCloseRow } from './gymClose';
import type { YearMonth } from './closeYear';

/** The four figures a close files. */
export type CloseFigure = 'taken' | 'invoiced' | 'outstanding' | 'payroll';

export const CLOSE_FIGURE_LABEL: Record<CloseFigure, string> = {
  taken: 'Taken',
  invoiced: 'Billed',
  outstanding: 'Still owed',
  payroll: 'Payroll',
};

/**
 * One filed figure, read off one stored close.
 *
 * The one place the four columns are named, and the one place the legacy code
 * is allowed to stand in — for `taken` only. Exported so a test can assert the
 * borrowing rule directly rather than through a year of rows.
 */
export function figureOn(row: MonthCloseRow, figure: CloseFigure): QuotedRow {
  switch (figure) {
    case 'taken':
      // The ONLY figure the pre-2540 single code may speak for. See the header.
      return { amountCents: row.takenCents, currency: row.takenCurrency ?? row.currency };
    case 'invoiced':
      return { amountCents: row.invoicedCents, currency: row.invoicedCurrency };
    case 'outstanding':
      return { amountCents: row.outstandingCents, currency: row.outstandingCurrency };
    case 'payroll':
      return { amountCents: row.payrollCents, currency: row.payrollCurrency };
  }
}

/** One column of the year. */
export interface YearFigure {
  figure: CloseFigure;
  label: string;
  /**
   * The year's answer: one pot per currency, biggest first, never added.
   *
   * Its `rows` is the number of CLOSED months — the months that had a filed
   * figure to offer — and its `unpriced`/`unlabelled` are the closed months
   * whose figure the record could not state. Months that were never closed are
   * NOT in it: they are a different hole and they are counted below, because
   * folding them in would say a month was filed without an amount when in fact
   * it was never filed at all.
   */
  q: Quoted;
  /** Months of this year with a close in force. The denominator of `q`. */
  closed: number;
  /** Months that have ENDED and carry no close in force — never closed, or
   *  closed and then reopened. Not zero-valued months. */
  unfiled: number;
  /** Months that have not ended yet. Not outstanding and not a hole. */
  running: number;
  /**
   * Whether this column is one amount of one money covering every month of the
   * year that could be filed — the only shape another figure may be derived
   * from, and the gate any later average or comparison must ask first.
   */
  whole: boolean;
}

/**
 * The four columns of one year, from the months `closeYear` already built.
 *
 * `months` is `CloseYear.months`, which is EMPTY when the record could not be
 * read — `closeYear` refuses to fabricate a grid over a null list, and this
 * inherits that refusal exactly: no months in, four columns covering nothing,
 * and `yearFigureNote` then says "no month of this year is closed" rather than
 * anything about money. The caller must still branch on `CloseYear.read` before
 * printing any of it, for the reason closeYear.ts states: an empty year and an
 * unread year are two different documents and only one of them is a document.
 */
export function closeYearFigures(months: readonly YearMonth[]): YearFigure[] {
  const filed = months.filter((m) => m.live != null);
  const unfiled = months.filter((m) => m.state === 'open' || m.state === 'reopened').length;
  const running = months.filter((m) => m.state === 'running').length;

  return (['taken', 'invoiced', 'outstanding', 'payroll'] as CloseFigure[]).map((figure) => {
    const q = quotedOf(filed.map((m) => figureOn(m.live as MonthCloseRow, figure)));
    return {
      figure,
      label: CLOSE_FIGURE_LABEL[figure],
      q,
      closed: filed.length,
      unfiled,
      running,
      // A whole year is a whole `Quoted` AND no month missing from it. The
      // second half is the one a `quotedWhole` on its own cannot know about:
      // nine closed months in one money are a perfectly whole nine months, and
      // calling that the year is the mistake this flag exists to stop.
      whole: quotedWhole(q) && unfiled === 0,
    };
  });
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The sentence under a year column — what it covers and what it does not.
 *
 * Deliberately not `quotedNote`. That function words a set of PAYMENTS or
 * INVOICES, where every row is in the set by construction; here the rows are
 * months and the interesting hole is the month that produced no row at all. Two
 * different silences reach one sentence and both have to be in it:
 *
 *   · "covering the 9 of 12 months that were closed" — the months with no filed
 *     figure to offer.
 *   · "1 of those was filed with no amount" — a month that WAS closed and whose
 *     figure the record could not state.
 *
 * `year` is the number, so the sentence stands on its own in an export.
 */
export function yearFigureNote(f: YearFigure, year: number): string {
  const months = f.closed + f.unfiled + f.running;

  if (!f.closed) {
    // `f.running > 0` and not `f.running === months`, which is also true of
    // ZERO months — the shape `closeYear` returns for a record it could not
    // read. That arm said "no month of 2026 has finished yet" about a year the
    // console had not managed to ask about, which is a confident claim about
    // the calendar built out of a failed query.
    return f.running > 0 && f.running === months
      ? `No month of ${year} has finished yet, so there is nothing filed to read down this column.`
      : `No month of ${year} is closed, so there is no filed figure to read. That is not a year in which nothing happened. It is a year nobody has signed off.`;
  }

  const parts: string[] = [];
  parts.push(f.unfiled === 0
    ? `Every one of the ${count(f.closed, 'month', 'months')} of ${year} that could be filed is in this figure.`
    : `Covering the ${f.closed} of ${count(f.closed + f.unfiled, 'month', 'months')} of ${year} that have ended and been closed: ${count(f.unfiled, 'month is', 'months are')} not signed off, and ${f.unfiled === 1 ? 'it is' : 'they are'} left out rather than counted as nothing.`);

  if (f.running) {
    parts.push(`${count(f.running, 'month has', 'months have')} not finished, so ${f.running === 1 ? 'it is' : 'they are'} not waiting on anybody.`);
  }

  const short = quotedShort(f.q);
  if (short) {
    const holes: string[] = [];
    if (f.q.unpriced) holes.push(`${f.q.unpriced} filed no amount for it`);
    if (f.q.unlabelled) holes.push(`${f.q.unlabelled} filed an amount and no currency`);
    parts.push(`Of the closed months, ${holes.join(' and ')}: ${short === 1 ? 'that month is' : 'those months are'} outside the figure rather than inside it at nothing.`);
  }

  if (f.q.pots.length > 1) {
    parts.push(`The ${f.q.pots.length} are quoted apart and never added down the column: this app holds no rate between them, and a year total built from a rate nobody chose is the one figure this page must not produce.`);
  }

  return parts.join(' ');
}
