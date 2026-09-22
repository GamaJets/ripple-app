// Money the gym decided not to collect, and the reason it decided that.
//
// ── The defect ─────────────────────────────────────────────────────────────
//
// `gym_invoices.status` has allowed 'void' and 'written_off' since part 29.
// `owedOf` in src/lib/monthEnd.ts folds both into a bucket it calls `dropped`
// and describes exactly right — "Money the gym has decided it will not collect
// is not money it is owed, and it is not money it took either". The amount
// leaves the receivables, leaves the takings, lands in a figure on the close,
// and the row carried nothing saying who decided that, when, or why.
//
// The only column that could have held it is `note`, which is the invoice's own
// description of what was billed. An owner typing the reason there overwrites
// what the bill was FOR, which is the fact a member disputes it with.
//
// Every other decision of this size in this schema already records its reason:
// `payroll_settlements.reverse_reason` (part 183), `payroll_adjustments.note`
// (183), the reason a month is reopened (182), the reason an exception is
// accepted off a reconciliation (181). A bad debt is the same shape and a
// larger number. supabase/parts/2642 gives it the same three columns and this
// module is the rule over them.
//
// ── VOID AND WRITTEN OFF ARE NOT SYNONYMS ─────────────────────────────────
//
// They arithmetically agree — both leave the receivable — and they are
// different facts about a business, in the same way `payroll_adjustments`
// keeps a reimbursement apart from a bonus when both add.
//
//   · VOID says the bill should never have existed. The wrong member, the
//     wrong amount, a duplicate, a service that was not delivered. Nothing was
//     ever owed, so nothing was lost.
//   · WRITTEN OFF says the bill was right and the money is not coming. The
//     member emigrated, the debt is uncollectable, the gym chose not to chase
//     a long-standing customer. Something WAS owed and the gym has taken the
//     loss.
//
// An accountant treats those differently and only one of them is a bad-debt
// figure. So the reason is required for both and the two are never collapsed,
// and `WRITE_OFF_PROMPT` below asks the question in the words of whichever one
// was chosen rather than with one generic placeholder.
//
// ── Reopening is a second fact, not an erasure ────────────────────────────
//
// An invoice that was written off and is later reopened — the member turns up
// and pays — keeps `dropped_at` and `drop_reason` exactly where they are.
// supabase/parts/2642 deliberately does NOT tie those columns to the status for
// this reason, and `writeOffHistory` below is what turns the resulting pair of
// facts into one honest sentence: "written off on the 12th because X; now
// marked paid" rather than either half on its own.
//
// Pure apart from the one write at the bottom, which takes the Supabase client
// as an argument the way src/lib/gymInvoices.ts does.
import { assertWrote } from './wroteRows';
import { isWhole, type LoadStatus } from '../ui/loadStatus';

type Queryable = { from: (table: string) => any };

/* ── the two decisions ────────────────────────────────────────────────────── */

export type DropStatus = 'void' | 'written_off';

/** The two statuses that take an invoice out of what the gym is owed. Exactly
 *  the pair `owedOf` counts into `dropped`, so the two files cannot drift about
 *  what "not going to be collected" means. */
export const DROP_STATUSES: readonly DropStatus[] = ['void', 'written_off'] as const;

export const isDropStatus = (s: string | null | undefined): s is DropStatus =>
  s === 'void' || s === 'written_off';

/**
 * What each of the two says, in words an owner is choosing between — not the
 * words on the register.
 *
 * `INVOICE_STATUS_LABEL` in src/lib/gymInvoices.ts labels a stored row and is
 * right for a table cell. These are the sentences that make the choice, and
 * they are longer on purpose: the difference between them is what an accountant
 * needs and it is not obvious from the two words.
 */
export const DROP_MEANS: Record<DropStatus, string> = {
  void: 'Void: this bill should never have existed. Wrong member, wrong amount, a duplicate, or something that was not delivered. Nothing was owed, so nothing has been lost.',
  written_off: 'Written off: the bill was right and the money is not coming. Something WAS owed and the gym is taking the loss, which is a different line in the accounts.',
};

/** The question, asked in the words of the decision being made. A single
 *  "Reason" box gets "n/a" typed into it; a question gets an answer. */
export const WRITE_OFF_PROMPT: Record<DropStatus, string> = {
  void: 'Why should this bill not have existed?',
  written_off: 'Why is this money not going to be collected?',
};

/**
 * The shortest reason worth storing.
 *
 * Not one character. The CHECK in supabase/parts/2642 refuses only whitespace,
 * which admits "x" — and "x" on a four-figure bad debt is the same silence the
 * column exists to remove, written by somebody getting past a form. Twelve is
 * about three words: "member emigrated", "billed twice", "never delivered" all
 * clear it, and none of them is a shrug.
 */
export const MIN_REASON_CHARS = 12;

/** Matching `text` with no ceiling in the column, so this is the form's limit
 *  rather than the database's — long enough for a paragraph, short enough that
 *  nobody pastes a thread into it. */
export const MAX_REASON_CHARS = 500;

/**
 * Why this invoice cannot be dropped, or null when it can.
 *
 * Checked as somebody types, so the refusal arrives beside the box rather than
 * as a 23514 after the dialog has closed.
 */
export function writeOffBlocker(status: DropStatus, reason: string): string | null {
  if (!isDropStatus(status)) {
    return 'That is not a way of not collecting an invoice. Void it if the bill should never have existed, or write it off if the money is not coming.';
  }
  const r = reason.trim();
  if (!r) {
    return status === 'void'
      ? 'Say why this bill should not have existed. An invoice that vanishes off the receivables with nothing recording why is the row somebody asks about at the year end and nobody can answer.'
      : 'Say why this money is not being collected. A bad debt with no reason on it is a figure in the accounts that nobody can explain, and it is the one an accountant asks about first.';
  }
  if (r.length < MIN_REASON_CHARS) {
    return `That is too short to be a reason. A few words (“member emigrated”, “billed twice”, “class never ran”) is all this needs, and “${r}” will mean nothing to whoever reads it next year.`;
  }
  if (r.length > MAX_REASON_CHARS) {
    return `That is longer than this holds. Keep the reason to a sentence or two; the detail belongs wherever the correspondence is.`;
  }
  return null;
}

/* ── what the row says afterwards ─────────────────────────────────────────── */

/** The three columns supabase/parts/2642 added, as a screen holds them. */
export interface DropRecord {
  /** Null on an invoice nobody has dropped, AND on one dropped before part 2642
   *  existed. `writeOffHistory` tells those two apart using the status. */
  droppedAt: string | null;
  dropReason: string | null;
  droppedBy: string | null;
  droppedByName: string | null;
}

export type WriteOffHistory =
  /**
   * The decision columns were not read.
   *
   * Its own arm, because the alternative is the failure mode this module is
   * built around wearing a different hat: an unread `dropped_at` is null, a null
   * `dropped_at` on a written-off invoice reads as 'dropped_unexplained', and
   * the screen would then tell an owner that a debt they explained carefully in
   * March has no reason recorded — out of a query that failed.
   *
   * It is also the state of every gym whose database has not had
   * supabase/parts/2642 applied yet, which is every gym for as long as it takes
   * somebody to run it.
   */
  | { state: 'unread'; line: string }
  /** Nobody has ever decided not to collect this. */
  | { state: 'live' }
  /** Dropped, with the reason on the row. */
  | { state: 'dropped'; status: DropStatus; line: string }
  /** Dropped, and the row carries no reason — it was dropped before the
   *  columns existed. Reported, never filled in. */
  | { state: 'dropped_unexplained'; status: DropStatus; line: string }
  /** Dropped once, and the status has since moved on. Both facts, in order. */
  | { state: 'reopened'; line: string };

/**
 * What to say beside an invoice about the gym's decision not to collect it.
 *
 * `status` is the invoice's CURRENT status and `rec` is the decision the row
 * remembers. The four answers come from the two being allowed to disagree,
 * which supabase/parts/2642 permits on purpose: clearing the decision when an
 * invoice is reopened would erase the fact that it was ever made.
 *
 * `on` is the stamp as stored. It is NOT formatted here — a `timestamptz` is
 * drawn on the gym's clock by the screen, through `gymDateText`, and a date
 * formatted in this module would be formatted on whoever's machine is asking.
 */
export function writeOffHistory(
  status: string | null | undefined,
  rec: DropRecord,
  on: string | null,
  read: LoadStatus = 'ready',
): WriteOffHistory {
  if (!isWhole(read)) {
    // Silent about an invoice nobody dropped: there is nothing to be unsure of,
    // and a "not known" against every live invoice on the register is a line
    // the reader stops seeing — after which the ones that matter are invisible
    // too. This is the same reason the door's admission preview says nothing
    // when the answer is 'ok'.
    if (!isDropStatus(status)) return { state: 'live' };
    return {
      state: 'unread',
      line: read === 'loading'
        ? 'Still reading why this was not collected.'
        : 'Why this was not collected could not be read. That is not the same as no reason having been given, and anything already recorded still stands.',
    };
  }
  const who = rec.droppedByName ? ` by ${rec.droppedByName}` : '';
  const when = on ? ` on ${on}` : '';

  if (isDropStatus(status)) {
    const word = status === 'void' ? 'Voided' : 'Written off';
    if (rec.droppedAt && rec.dropReason) {
      return { state: 'dropped', status, line: `${word}${when}${who}: ${rec.dropReason}` };
    }
    return {
      state: 'dropped_unexplained',
      status,
      line: `${word}, with no reason recorded. This was done before Repple could hold one; nothing here knows why, and nothing will invent it.`,
    };
  }

  if (rec.droppedAt) {
    // The status moved back out of the dropped pair and the decision stayed.
    // Both are true and the order is what makes them readable.
    return {
      state: 'reopened',
      line: `This was taken off what the gym is owed${when}${who}${rec.dropReason ? ` (${rec.dropReason})` : ''}, and has since been put back${status ? ` as ${status}` : ''}.`,
    };
  }

  return { state: 'live' };
}

/**
 * The invoices a period dropped that carry no reason.
 *
 * Named on the screen rather than counted, for `periodMovingNote`'s reason in
 * src/lib/gymTax.ts: "One month is open" sends somebody to look at three;
 * "September is open" sends them to one. These are the rows an accountant will
 * ask about, and they are findable only while somebody still remembers.
 */
export function unexplainedDrops<T extends DropRecord & { status: string | null }>(
  rows: readonly T[],
): T[] {
  return rows.filter((r) => isDropStatus(r.status) && !(r.droppedAt && r.dropReason));
}

/* ── the write ────────────────────────────────────────────────────────────── */

/**
 * Take an invoice off what the gym is owed, with the reason on the row.
 *
 * ONE update, not two. The status and the three decision columns move together,
 * so there is no window in which an invoice is void with nothing saying why —
 * which is the state this whole part exists to remove and would be minted by
 * the feature meant to remove it. `settleInvoice` in src/lib/gymInvoices.ts
 * makes the opposite trade for the opposite reason, and says so.
 *
 * `dropped_at` is the CLIENT's instant, the same way `reverseSettlement` in
 * src/lib/gymPay.ts stamps `reversed_at`, and it is an absolute instant rather
 * than a calendar day — so an owner's clock being a few minutes out moves
 * nothing anybody reads. What it must never become is a DAY computed here: the
 * month an invoice belongs to is `issued_on`, which this does not touch, and a
 * day derived from this stamp would be the browser's calendar on a screen that
 * draws every other date on the gym's.
 *
 * THE COUNT IS CHECKED, not `error` alone. `gym_invoices_owner` is
 * `is_owner_of(tenant_id)` and is the only policy granting UPDATE, so an update
 * run by anybody else matches zero rows and returns `error: null` — and the
 * screen would report a four-figure debt as written off while it is still open
 * and still being chased. See src/lib/wroteRows.ts.
 *
 * The row is then READ BACK and the stored reason compared with the one that
 * was sent. A count of one says a row moved; it does not say the CHECK in
 * supabase/parts/2642 was satisfied by a database that has not had the part
 * applied — on one of those the three columns do not exist, PostgREST rejects
 * the whole update, and the count never arrives. What the read-back catches is
 * the case in between: the status moved and the reason did not land.
 */
export async function dropInvoice(
  sb: Queryable,
  invoiceId: string,
  status: DropStatus,
  reason: string,
  droppedBy: string | null,
): Promise<void> {
  const blocker = writeOffBlocker(status, reason);
  if (blocker) throw new Error(blocker);
  const r = await sb
    .from('gym_invoices')
    .update({
      status,
      dropped_at: new Date().toISOString(),
      drop_reason: reason.trim(),
      dropped_by: droppedBy,
    }, { count: 'exact' })
    .eq('id', invoiceId)
    .select('id, status, drop_reason');
  if (r.error) throw r.error;
  assertWrote('That invoice', r);
  const row = (r.data as any[] | null)?.[0];
  if (!row || row.status !== status || (row.drop_reason ?? '').trim() !== reason.trim()) {
    throw new Error(
      'That invoice may not have been changed the way it was meant to be: the row came back without '
      + 'the decision on it. Reload this page and read the invoice’s status before doing it again. '
      + 'an invoice taken off what the gym is owed with no reason recorded is the row this exists to '
      + 'prevent.',
    );
  }
}
