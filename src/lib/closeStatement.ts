// The close as a STATEMENT, rather than as the screen it was read off.
//
// ── what was wrong with the file that already existed ────────────────────
//
// /close has exported a CSV since the month-end wave. It is a good export and
// most of this module is not a replacement for it: the verdict first, the
// blockers above every figure, a currency on every row. What it is is a dump of
// the SCREEN, and the screen is a working surface for the owner on the day.
// An accountant opening the same file three weeks later is asking four
// questions the file could not answer at all:
//
//   1. "Is this month closed?" The file's Verdict field is `c.state`, which is
//      recomputed from live rows every time the page loads. A month closed and
//      filed in August exported as "Closeable" — a statement about whether it
//      COULD be closed, from a document produced after it was. Nothing in the
//      file said it had been, who by, or when.
//   2. "Has it moved since?" `gym_month_closes` holds the figures as filed and
//      /close already names every difference on screen (`driftSince`). None of
//      that reached the file, so the one artefact that leaves the building was
//      the one artefact that could not show the filed position beside today's.
//   3. "What is this figure in?" Every amount was exported in MINOR UNITS with
//      the code in a neighbouring column. That is the honest storage
//      denomination and it is the wrong denomination for a statement: reading
//      `50000` requires knowing that JPY has no minor unit and KWD has three,
//      and an accountant who assumes a hundred is out by a hundred in Tokyo and
//      by ten in Kuwait. `minorToDecimal` already solves this for the data
//      bundle; the close's own file did not use it.
//   4. "What am I looking at, and what is NOT in it?" A statement declares its
//      basis. This one had no basis line, so a reader could reasonably take
//      "Taken" for revenue and the month for a profit figure — and the costs
//      the gym records in `gym_costs` are deliberately not netted against
//      anything on this screen (src/lib/gymCosts.ts forbids it in capitals).
//
// ── what this module is, and what it deliberately is not ─────────────────
//
// It builds the SHAPE: an ordered list of titled sections, each with its own
// prose and its own table. It formats no dates, reads no database and renders
// no CSV — /close hands in strings it has already formatted on the gym's clock
// (see src/lib/gymWhen.ts for why a date may not be formatted anywhere else),
// and turns the sections into a file with `toCsv`. What is testable under plain
// node is therefore the thing that was actually wrong: which sections exist, in
// what order, and what each one says when a figure, a currency or a whole read
// is missing.
//
// ── one comparison, not two ──────────────────────────────────────────────
//
// The movement lines are `driftSince`'s, passed in verbatim. This module does
// NOT re-derive which figures moved, and that is deliberate rather than lazy:
// a second copy of "was === is && wasCcy === isCcy" is a second rule, and the
// day they disagree the screen and the file it produced would be saying
// different things about the same filed month. The doctrine in
// src/lib/coachSettlements.ts applies with full force here — the snapshot is
// the record, a difference is REPORTED and never corrected — and a statement
// that quietly recomputed a filed figure would be the worst possible place to
// break it.
import { minorToDecimal } from './gymExport';

/** A cell as `toCsv` takes it. Null is an empty cell and never a zero. */
export type StatementCell = string | number | null;

/**
 * One titled block of the statement.
 *
 * `prose` is printed under the heading before any table, and a section may be
 * prose alone — which is what an unreadable or an un-filed part looks like.
 * `columns` null means there is no table, and it is NOT the same as a table
 * with no rows: an empty table is a claim that the thing is empty.
 */
export interface StatementSection {
  title: string;
  prose: string[];
  columns: string[] | null;
  rows: StatementCell[][];
}

/** One figure as it was FILED and as it reads today. Both sides carry their own
 *  currency, because a close written since supabase/parts/2540 stores one code
 *  per figure and the two sides can legitimately differ. */
export interface StatementFigure {
  label: string;
  filedCents: number | null;
  filedCurrency: string | null;
  liveCents: number | null;
  liveCurrency: string | null;
}

/** One currency's worth of receipts. Never summed with another. */
export interface StatementReceipt {
  /** Null when the rows themselves state no code — its own fact, not a gap. */
  currency: string | null;
  count: number;
  cents: number;
}

export interface StatementInput {
  gymName: string | null;
  monthKey: string;
  /** "August 2026", already worded by the caller. */
  periodLabel: string;
  /** Bare `YYYY-MM-DD`, compared and printed as strings and never parsed —
   *  see the house rule; parsing the 1st as UTC files it in the month before. */
  firstDay: string;
  lastDay: string;
  /** Already formatted on the GYM's clock by the caller. */
  generatedAt: string;
  /** Who pressed the button that produced this file, by name. */
  preparedBy: string | null;
  /**
   * Whether `gym_month_closes` could be read at all.
   *
   * False is NOT "the month is open". A statement that says a month was never
   * closed because the table 500'd is the same class of lie as an empty CSV
   * over a failed read, and it is worse here: somebody would close it again.
   */
  filingRead: boolean;
  /** The live close for this month, or null when the read succeeded and there
   *  is none. Meaningless when `filingRead` is false. */
  filing: {
    closedAt: string;
    closedByName: string | null;
    note: string | null;
    blockersAtClose: string | null;
  } | null;
  /** Every superseded close for this month, oldest first — a month closed,
   *  reopened and closed again is the history an auditor asks for. */
  history: Array<{
    closedAt: string;
    closedByName: string | null;
    reopenedAt: string | null;
    reopenedByName: string | null;
    reopenReason: string | null;
  }>;
  /** Filed against today, per figure. Empty when the month is not filed. */
  figures: StatementFigure[];
  /** `driftSince`'s own sentences, verbatim. Empty means nothing moved. */
  drift: string[];
  /** One entry per currency the month's payments actually state. */
  receipts: StatementReceipt[];
  /**
   * Whether the payments read came back WHOLE.
   *
   * False covers both 'error' and 'partial' (src/ui/loadStatus.ts: a truncated
   * read may be listed and may never be totalled). A false here suppresses the
   * receipts table entirely rather than shrinking it, because a subtotal over
   * an unknown fraction of a month is the one number an accountant would carry
   * forward without checking.
   */
  receiptsWhole: boolean;
}

/**
 * What this statement is a statement OF, said once, at the bottom.
 *
 * An accountant's document declares its basis or it is not one. Every clause
 * here is a thing somebody has already assumed wrongly off this screen: that
 * "Taken" is revenue (it is receipts, on the date recorded), that the month is
 * a profit figure (nothing is netted — src/lib/gymCosts.ts), that the figures
 * are bank-confirmed (nothing here has seen a bank; that is what the banked
 * line is for), and that payroll is a payment (it is what the sessions in this
 * month price to, whether or not anybody has been paid).
 */
export const STATEMENT_BASIS: string[] = [
  'Basis: receipts and billing as recorded in this gym’s own register, dated as recorded. It is not an accruals statement and it is not a profit figure.',
  'Nothing on this statement is netted against anything else. Costs the gym has recorded are not subtracted from receipts, and a refund is a row of its own rather than a reduction of an earlier one.',
  'Nothing here has been reconciled against a bank or a card processor by this software. Where a figure for what actually reached the bank appears below, it is a figure a person typed from a statement they were holding.',
  'Payroll is what this month’s sessions price to under the rates recorded against them. It is not a record that anybody has been paid.',
  'Amounts are shown in whole units of the currency named on the same row. Where no currency is recorded the amount is left blank rather than written in a currency nobody chose.',
];

/**
 * The statement, in order.
 *
 * The order is the argument. Provenance first — what this is, whose it is, and
 * whether it has been filed — then the filed position, then the movement, then
 * the detail, then the basis. The existing export opens with the verdict and
 * the blockers for the same reason and those keep their place: this module adds
 * the sections around them rather than replacing the file.
 */
export function closeStatementSections(i: StatementInput): StatementSection[] {
  return [header(i), filing(i), filedPosition(i), movement(i), receipts(i), basis()];
}

/* ── the sections ──────────────────────────────────────────────────────────── */

function header(i: StatementInput): StatementSection {
  return {
    title: 'STATEMENT OF MONTH-END CLOSE',
    prose: [],
    columns: ['Field', 'Value'],
    rows: [
      // A gym whose name could not be read says so. An empty cell in the entity
      // field of a statement is a document about nobody.
      ['Gym', i.gymName ?? '(the gym’s name could not be read)'],
      ['Period', i.periodLabel],
      ['Month key', i.monthKey],
      ['Period start', i.firstDay],
      ['Period end', i.lastDay],
      ['Filing status', filingWord(i)],
      ['Prepared by', i.preparedBy ?? '(the name could not be read)'],
      ['Prepared at', i.generatedAt],
    ],
  };
}

/**
 * Three answers, and the third is the one that did not exist.
 *
 * "Not closed" was being printed for a failed read of `gym_month_closes` on
 * every screen that asked before this distinction was drawn, and it is the
 * answer that gets a month closed twice.
 */
function filingWord(i: StatementInput): string {
  if (!i.filingRead) return 'UNKNOWN — the record of closed months could not be read';
  return i.filing ? 'CLOSED' : 'NOT CLOSED';
}

function filing(i: StatementInput): StatementSection {
  const s: StatementSection = { title: 'FILING', prose: [], columns: null, rows: [] };
  if (!i.filingRead) {
    s.prose.push(
      'The record of closed months could not be read when this statement was produced, so this '
      + 'document cannot say whether this month has been closed. That is not the same as it being '
      + 'open. Do not close it again on the strength of this file.',
    );
    return s;
  }
  if (!i.filing) {
    s.prose.push(
      'This month has not been closed. Every figure below is the register as it stood when this '
      + 'file was produced and may still move, including after you have read it.',
    );
  } else {
    s.columns = ['Field', 'Value'];
    s.rows = [
      ['Closed at', i.filing.closedAt],
      ['Closed by', i.filing.closedByName ?? '(the name could not be read)'],
      // The note and the blockers are separate rows rather than one: a note is
      // what somebody chose to say, and a blocker is what they closed OVER. A
      // reader has to be able to tell which is which.
      ['Note on the close', i.filing.note ?? null],
      ['Outstanding at the close', i.filing.blockersAtClose ?? null],
    ];
    if (!i.filing.blockersAtClose) {
      s.prose.push('Nothing was outstanding on this month when it was closed.');
    } else {
      s.prose.push(
        'This month was closed while the items in the last row were still outstanding. That was a '
        + 'decision somebody took and it is recorded as one; the figures below were filed over it.',
      );
    }
  }
  // The history goes in whether or not the month is filed today: a month that
  // was closed in September and reopened in October is OPEN, and the reopen is
  // the most important fact on the page for anybody holding the September file.
  if (i.history.length) {
    s.prose.push(
      'This month has been closed and reopened. Every close is kept; a reopen carries the reason it '
      + 'was given, and a figure filed by a superseded close is not the figure filed by the live one.',
    );
  }
  return s;
}

function filedPosition(i: StatementInput): StatementSection {
  const s: StatementSection = {
    title: 'FILED POSITION, AND THE SAME FIGURES TODAY',
    prose: [],
    columns: null,
    rows: [],
  };
  if (!i.filingRead || !i.filing || !i.figures.length) {
    s.prose.push(
      'There is no filed position for this month, so there is nothing to compare today’s figures '
      + 'against. The detail below is the register as it stands.',
    );
    return s;
  }
  s.columns = ['Figure', 'At the close', 'Currency', 'Today', 'Currency'];
  s.rows = i.figures.map((f) => [
    f.label,
    // `minorToDecimal` asks the row's OWN currency how many places it has, and
    // returns an empty cell — not a number — where nobody said. A figure
    // printed in no currency is the single mistake this whole tree is built
    // against, and in a file an accountant keys from it is permanent.
    minorToDecimal(f.filedCents, f.filedCurrency) || null,
    f.filedCurrency ?? null,
    minorToDecimal(f.liveCents, f.liveCurrency) || null,
    f.liveCurrency ?? null,
  ]);
  s.prose.push(
    'The left-hand figures are what was filed when this month was closed. They are the record. They '
    + 'are never recomputed and nothing in this software will correct them.',
  );
  return s;
}

function movement(i: StatementInput): StatementSection {
  const s: StatementSection = { title: 'MOVEMENT SINCE THE CLOSE', prose: [], columns: null, rows: [] };
  if (!i.filingRead || !i.filing) {
    s.prose.push('This month has no filed position, so nothing can have moved away from one.');
    return s;
  }
  if (!i.drift.length) {
    s.prose.push('Every figure reads today exactly as it read when this month was closed.');
    return s;
  }
  s.prose.push(
    'These figures read differently today from the way they were filed. A difference is not by itself '
    + 'an error — a refund recorded in a later month, or a payment re-attributed to the right '
    + 'member, correctly changes what this month’s ledger says. It is reported and it is not '
    + 'corrected: the filed figure stands.',
  );
  s.columns = ['What has moved'];
  s.rows = i.drift.map((d) => [d]);
  return s;
}

/**
 * Receipts, one line per currency, with no total anywhere.
 *
 * The existing file has a "what came in, by method" table with a currency on
 * every row, which is right and is not this. An accountant reconciling against
 * a bank statement works per ACCOUNT, and a gym banking in two currencies has
 * two statements; what they need first is the one subtotal per currency that
 * their statement should match. That subtotal did not exist in the file, so it
 * was arrived at by adding a column up — across currencies, in a spreadsheet,
 * silently.
 */
function receipts(i: StatementInput): StatementSection {
  const s: StatementSection = { title: 'RECEIPTS FOR THE PERIOD, BY CURRENCY', prose: [], columns: null, rows: [] };
  if (!i.receiptsWhole) {
    s.prose.push(
      'NOT STATED — the payments for this month did not come back whole, so no subtotal can be '
      + 'given for any currency. This is unknown, not nil: do not read the absence of a line as a '
      + 'month in which nothing was taken.',
    );
    return s;
  }
  if (!i.receipts.length) {
    s.prose.push('No payments are recorded against this month.');
    return s;
  }
  s.columns = ['Currency', 'Payments', 'Amount'];
  s.rows = i.receipts.map((r) => [
    // A row whose payments state no currency is its OWN line and is never
    // folded into another. It is not a gap in a known currency — it is money
    // recorded without one, and an accountant has to see that it exists.
    r.currency ?? '(no currency recorded)',
    r.count,
    minorToDecimal(r.cents, r.currency) || null,
  ]);
  if (i.receipts.length > 1) {
    s.prose.push(
      'There is deliberately no total across these lines. Adding two currencies together would need '
      + 'a rate this software does not hold, and the result would not be an amount of anything. Each '
      + 'line is the figure to reconcile against the account that money was banked into.',
    );
  }
  return s;
}

function basis(): StatementSection {
  return { title: 'BASIS OF PREPARATION', prose: STATEMENT_BASIS, columns: null, rows: [] };
}
