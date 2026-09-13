// The line items of a statement of record, ON THE SCREEN THAT SENDS THEM.
//
// ── The defect this file exists for ───────────────────────────────────────
//
// `statementItemsCsv` in src/lib/coachStatement.ts builds a file listing every
// row this app holds for a period: each invoice the coach issued, each
// late-cancellation fee, each refund, each chargeback, each cost. The Statement
// screen has had a "Share the Line Items as CSV" button on it since that file
// was written and has never DRAWN a single one of those lines. Everything above
// the button was a per-section total.
//
// So the one artefact on this screen that names people, dates and individual
// amounts left the phone unread. A coach could not check, before it went to an
// accountant, that the invoice to the client who disputed it was in there, that
// a cost they thought they had deleted was not, or that the refund they
// remember is on the date they remember. The first sight of the contents was
// somebody else's inbox, and a statement about a self-employed person's own
// income is the last document in this product that should be sent unseen.
//
// ── Why this is a second reader and not a second answer ───────────────────
//
// src/lib/coachSettlements.ts states the doctrine: a document about money shows
// its own snapshot and never a recomputation. The danger in drawing the same
// rows a second time is that the screen and the file come to disagree — the
// header of `statementItemsCsv` says exactly this about the FILTER, and refuses
// to let its caller hand over a pre-filtered set for that reason.
//
// This file therefore performs no filtering of its own. It calls the same
// `splitByDay` / `splitByPeriod` against the same accessors and the same
// period, gated by the same `periodReads`, in the same order, and formats the
// amounts through the same `minorToPlain` / `majorToPlain`. Every line it
// produces carries the CSV's own seven cells verbatim in `part`, `day`, `who`,
// `what`, `currency`, `plain` and `status` — and src/lib/statementLines.test.ts
// PARSES the file `statementItemsCsv` actually builds and asserts, row for row,
// that the screen's lines are the file's item rows. A divergence is a failing
// test rather than a coach vouching for a document they did not read.
//
// The screen-only additions are additive and never replace a cell: `when` is
// `day` spelled out in the reader's own language, and `money` is `plain` with
// its currency beside it, through the one money formatter this codebase has.
//
// ── Nothing here is summed ────────────────────────────────────────────────
//
// No total, no net, no signed amount — the same refusal the file makes, for the
// same reason. A refund and an invoice are money moving in opposite directions
// and are listed in the same column, so any column total would be arithmetic
// nobody asked for; and the amounts are in whatever currency each row carries,
// which is the other reason (Repple is white-labelled and two currencies are
// never added). `count` below counts ROWS, which is not money.
//
// ── A count is withheld where the read was not whole ──────────────────────
//
// The lines themselves are shown under 'partial': those rows came back and they
// are real. What may not be stated is how many there are, because a prefix of an
// unknown set is not a total — `withheldReason` supplies the sentence, the same
// one the sections above use. Under 'error' there are no rows at all, and a
// group drawn as empty without that sentence would tell a coach they issued no
// invoices in a quarter when the truth is that nobody could look.
import type { LoadStatus } from '../ui/loadStatus';
import {
  periodReads, periodRange, splitByDay, splitByPeriod,
  minorToPlain, majorToPlain, dayLabel, withheldReason,
  PERIOD_UNREADABLE,
  type StatementInput,
} from './coachStatement';
import { minorMoney, wholeMoney } from './coachMoney';
import { localDate } from './localDate';
import { isoDay } from './weekStart';

/** The `part` cell of the CSV, verbatim. These strings are the file's own and
 *  are matched against it by the test, so they are not re-worded for display —
 *  `title` on the group is what a reader sees. */
export type StatementLinePart = 'invoice' | 'late cancellation' | 'refund' | 'chargeback' | 'cost';

/** The one sentence written beside every empty amount, character for character
 *  as `statementItemsCsv` writes it. A hole and a nought are different facts and
 *  the hole has to say so where it is. */
export const NO_CURRENCY_LINE =
  'No currency is recorded on this one, so no amount is written. Do not read the empty cell as nothing charged.';

export interface StatementLine {
  /** For a list key only. Nothing reads it as an identifier of a row. */
  key: string;
  part: StatementLinePart;
  /** The CSV's `date` cell: `YYYY-MM-DD`, or '' where the instant would not
   *  parse. Compared as a string and never parsed as UTC. */
  day: string;
  /** `day` as a person reads it, in their own language, or '—'. */
  when: string;
  /** The CSV's `who` cell. '' where the row carries no name — deliberately not
   *  filled in from a lookup this file did not make. */
  who: string;
  /** The CSV's `what` cell. */
  what: string;
  currency: string | null;
  /** The CSV's `amount` cell: a plain decimal, or null where it cannot be
   *  denominated. NEVER "0.00" for a hole. */
  plain: string | null;
  /** The same amount with its currency, for the screen — "AED 600.00", never
   *  "$600" and never a bare number. Null for exactly the same rows `plain` is. */
  money: string | null;
  /** The CSV's `status` cell, which is the row's own word and not a judgement. */
  status: string;
  /** Why this line shows no amount, or null. */
  note: string | null;
}

export interface StatementLineGroup {
  part: StatementLinePart;
  /** Title Case, because it is a heading. The same words the summary section
   *  above it uses, so a coach can tell which total these lines belong to. */
  title: string;
  status: LoadStatus;
  /** Stated only under a whole read. Null means unknown, never zero. */
  count: number | null;
  /** The rows that came back and fall inside the period. Real under 'partial'
   *  too — just not all of them, which is what `withheld` says. */
  lines: StatementLine[];
  /** Why no count is stated, or null when one is. */
  withheld: string | null;
}

export interface StatementLines {
  groups: StatementLineGroup[];
  /** Lines listed, across every group. Null the moment any one group's count is
   *  unknown: a sum of four numbers and a hole is not a total. */
  total: number | null;
  /** Why not one line can be listed, or null. Set only where the period itself
   *  does not read — with no period there is nothing to place a row inside. */
  withheld: string | null;
}

/**
 * The date cell for a line item stored as an INSTANT.
 *
 * The same two steps `statementItemsCsv` takes, and they are not shortened.
 * `charges.created_at`, `client_disputes.opened_at` and the two `refunded_at`
 * columns are `timestamptz` and PostgREST serialises them in UTC, so
 * `String(iso).slice(0, 10)` prints Greenwich's calendar day while the FILTER
 * above it places the row on the coach's own. A fee taken at 18:00 on 31 March
 * in California is correctly inside the March period and would print
 * `2026-04-01` beside it. `localDate()` keeps the instant and `isoDay()` reads
 * its LOCAL parts, which is the calendar the period's bounds were built in.
 */
const itemDay = (iso: string | null | undefined): string => {
  const d = localDate(iso);
  return d ? isoDay(d) : '';
};

/** Stripe's own status word, or the absence of one said out loud. An open
 *  dispute must never render as nothing. */
const plainStatus = (s: string | null | undefined, fallback: string): string =>
  String(s || '').trim() || fallback;

/**
 * Every row this app holds for the period, one line each, grouped by part.
 *
 * Takes the whole `StatementInput` rather than a bag of rows, deliberately. The
 * per-part LoadStatus is on it, and a group that cannot say "this read failed"
 * would draw an empty list under a heading — which is the one thing this screen
 * must never do about somebody's own income.
 */
export function statementLines(input: StatementInput): StatementLines {
  const period = input.period;

  // No period, no line can be placed in one. Every split would come back empty
  // and a page of empty headings reads as a quiet quarter rather than as an
  // unreadable date. `statementCaveats` has already put this sentence at the top
  // of the screen; this is what stands where the items would have been.
  if (!periodReads(period)) {
    return { groups: [], total: null, withheld: PERIOD_UNREADABLE };
  }
  const range = periodRange(period);

  const invoices = splitByDay(input.invoices.rows, (i) => i.issuedOn, period).inside;
  const fees = splitByPeriod(input.lateCancellations.rows, (f) => f.createdAt, range).inside;
  const refunds = splitByPeriod(input.refunds.rows, (r) => r.refundedAt, range).inside;
  const disputes = splitByPeriod(input.disputes.rows, (d) => d.openedAt, range).inside;
  const costs = splitByDay(input.costs.rows, (c) => c.paidOn, period).inside;

  const line = (
    part: StatementLinePart, n: number, day: string, who: string, what: string,
    currency: string | null, plain: string | null, money: string | null, status: string,
  ): StatementLine => ({
    key: `${part}-${n}`,
    part,
    day,
    when: day ? dayLabel(day) : '—',
    who,
    what,
    currency,
    plain,
    money,
    status,
    // Said on the line, not once at the top: a row is read on its own and a
    // caveat at the top of a long list is not beside the amount it is about.
    note: currency ? null : NO_CURRENCY_LINE,
  });

  const groups: StatementLineGroup[] = [
    {
      part: 'invoice',
      title: 'Invoices You Issued',
      status: input.invoices.status,
      count: input.invoices.status === 'ready' ? invoices.length : null,
      withheld: withheldReason(input.invoices.status, 'invoices'),
      lines: invoices.map((i, n) => line(
        'invoice', n, i.issuedOn, i.billTo, i.description, i.currency,
        minorToPlain(i.amountCents, i.currency), minorMoney(i.amountCents, i.currency),
        // The coach's own word about the document, hedged exactly as the file
        // hedges it. Nothing here upgrades "stated received" into "paid".
        i.voidedAt ? 'voided' : (i.kind === 'received' ? 'stated received' : 'stated requested'),
      )),
    },
    {
      part: 'late cancellation',
      title: 'Late-Cancellation Fees Recorded',
      status: input.lateCancellations.status,
      count: input.lateCancellations.status === 'ready' ? fees.length : null,
      withheld: withheldReason(input.lateCancellations.status, 'late-cancellation fees'),
      // MAJOR units, and through the major formatter. `charges.amount` is
      // numeric and holds whole units; everything else on this statement is
      // minor, and mixing the two is a hundred-fold error in a money column.
      lines: fees.map((f, n) => line(
        'late cancellation', n, itemDay(f.createdAt), '', 'Late-cancellation fee', f.currency,
        majorToPlain(f.amount, f.currency), wholeMoney(f.amount, f.currency),
        // A waived fee is a fact about what happened, not an absence, so the
        // row stays and says which it is.
        f.waivedAt ? 'waived' : 'recorded',
      )),
    },
    {
      part: 'refund',
      title: 'Money You Gave Back',
      status: input.refunds.status,
      count: input.refunds.status === 'ready' ? refunds.length : null,
      withheld: withheldReason(input.refunds.status, 'refunds'),
      // `who` is left empty rather than filled from the sale: the refund
      // columns carry no name, and joining one on would put a person against an
      // amount on the strength of a lookup this screen did not make.
      lines: refunds.map((r, n) => line(
        'refund', n, itemDay(r.refundedAt), '',
        r.on === 'renewal' ? 'Refunded on a subscription renewal' : 'Refunded on a pack or membership sale',
        r.currency, minorToPlain(r.refundedCents, r.currency), minorMoney(r.refundedCents, r.currency),
        'given back',
      )),
    },
    {
      part: 'chargeback',
      title: 'Chargebacks Raised Against You',
      status: input.disputes.status,
      count: input.disputes.status === 'ready' ? disputes.length : null,
      withheld: withheldReason(input.disputes.status, 'chargebacks'),
      lines: disputes.map((d, n) => line(
        'chargeback', n, itemDay(d.openedAt), '',
        d.reason ? `Chargeback — reason given: ${d.reason}` : 'Chargeback — no reason was given',
        d.currency, minorToPlain(d.amountCents, d.currency), minorMoney(d.amountCents, d.currency),
        // Stripe's own status word, verbatim. Nothing here rewrites it into an
        // outcome, and an open one says it is open rather than reading as
        // nothing at all.
        plainStatus(d.status, 'status not stated'),
      )),
    },
    {
      part: 'cost',
      title: 'Costs You Recorded Yourself',
      status: input.costs.status,
      count: input.costs.status === 'ready' ? costs.length : null,
      withheld: withheldReason(input.costs.status, 'costs'),
      lines: costs.map((c, n) => line(
        'cost', n, c.paidOn, '', c.description, c.currency,
        minorToPlain(c.amountCents, c.currency), minorMoney(c.amountCents, c.currency),
        // The coach's own category word, and never read as a claim about tax.
        plainStatus(c.category, 'uncategorised'),
      )),
    },
  ];

  // Rows, not money. Null the moment one part could not be counted: four
  // numbers and a hole do not make a total, and a coach checking a file before
  // they send it is entitled to know the difference.
  const total = groups.some((g) => g.count == null)
    ? null
    : groups.reduce((a, g) => a + (g.count ?? 0), 0);

  return { groups, total, withheld: null };
}

/**
 * What the screen says above the lines about what they are not.
 *
 * Sales and renewals are NOT itemised, here or in the file: they are Stripe's
 * rows, Stripe's record is the artefact, and re-typing them under this app's
 * name would invite somebody to reconcile against a copy rather than against
 * the original. A coach who does not know that will read a short list as a
 * short quarter.
 */
export const LINES_ARE_NOT_EVERYTHING =
  'Packs, memberships and subscription renewals are not listed here and are not in the line-item file either — those are Stripe’s own rows and Stripe’s record is the one that proves them. The totals above cover them; this list covers everything else, which is every row this app holds itself.';

/** What the list is, said where the coach is about to send it. Nothing below
 *  is netted and nothing is signed, so no column of it adds up to anything. */
export const LINES_ARE_NOT_NETTED =
  'Every amount below is the size of what moved, and its heading says which way. Money in and money back out are in the same list and are deliberately not signed, so nothing here is added up for you.';
