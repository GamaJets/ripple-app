// An invoice, read by the person it is addressed to.
//
// ── The notification that went nowhere ────────────────────────────────────
//
// supabase/parts/146 writes a member a notification the moment a gym invoice
// leaves draft: "An invoice from your gym". src/lib/notifyInbox.ts carries it
// with `route: null` and says why in as many words — "there is no member screen
// for `gym_invoices` yet, and the bell is what a row with nowhere to go is
// drawn with". So the member is told an amount is being asked of them, is told
// the amount is not stated because the currency on the row may be a default
// nobody chose, and is sent to reception to find out what they owe.
//
// This module is the rule half of the screen that row now opens. The read is in
// src/lib/memberRecord.ts and the screen is app/(client)/invoices.tsx.
//
// ── WHAT IS NOT HERE: the invoice from a COACH ────────────────────────────
//
// `coach_invoices` (supabase/parts/138) carries the same notification wording —
// "An invoice from your coach", also `route: null` — and it is NOT readable by
// the client, deliberately. Part 138's header has a section headed "Who can
// read it" whose answer is "The issuing coach, and nobody else", and the file
// does not merely omit a client policy: it names and DROPS one —
//
//     drop policy if exists coach_invoices_client_read on public.coach_invoices;
//
// so that a policy somebody adds later cannot survive a rebuild of that file.
// The argument is that the client is HANDED the document through the share
// sheet, which is the act that decides they should have it, and that a read of
// the coach's ledger would also hand them the numbers of every other document
// in it — a coach's sequence is gapless per coach, so `seq` tells its reader
// how much business that coach has done.
//
// That is a decision with an argument behind it, not a gap, so this screen does
// not read that table and no policy is widened to let it. What it does instead
// is tell the member where a coach's invoice actually comes from —
// `COACH_INVOICE_NOT_HERE` — because "nothing here" with no explanation reads as
// the app having lost their bill.
//
// ── THE AMOUNT IS PRINTED, AND THE CURRENCY CAVEAT IS PRINTED WITH IT ─────
//
// Part 146 withholds the figure from the NOTIFICATION on purpose:
// `gym_invoices.currency` is `not null default 'AED'`, a default is not a
// choice, and plpgsql has no access to the zero-decimal list that makes a minor
// unit printable. Neither of those holds here. This is app code, `minorMoney`
// carries the list, and the figure is rendered from the row's own currency as
// an ISO code and never a symbol (src/lib/billing.ts is the record of what
// guessing a symbol cost: every unrecognised currency became `$`).
//
// What survives is that the three letters may be a default nobody set, so
// `AMOUNT_AS_RECORDED` says on the screen that the invoice itself is the
// document and this is the app's copy of what was entered. A member who reads a
// currency they have never paid in has been given the one fact that lets them
// query it, which silence would not.
//
// ── A DRAFT IS NOT A BILL ─────────────────────────────────────────────────
//
// `gym_invoices_own_r` is `using (member_id = auth.uid())` with no filter on
// status, so a member can read a gym's DRAFT — the working copy of an invoice
// nobody has issued. Part 146's trigger fires only on 'open' and 'overdue' for
// exactly that reason: a draft has not been issued to anybody.
//
// Drafts are therefore listed, marked, and kept out of every total. Hiding them
// outright was the other option and it is worse: the member can already read the
// row, a screen that silently drops rows it can see is a screen that cannot be
// trusted with the ones it keeps, and a draft appearing later as a bill with an
// older date on it is the surprise this avoids.
//
// Pure — no Supabase, no React.
import type { LoadStatus } from '../ui/loadStatus';
import { sumTaken, type Taken } from './coachMoney';
import { daysBetween } from './memberRecord';

/**
 * One invoice the gym raised against this member.
 *
 * Every money field is nullable although the column is not. `amount_cents` is
 * `not null` and `currency` is `not null default 'AED'`, so a null here can only
 * come from a row written by hand or a column that did not come back — and that
 * row is exactly the one worth naming rather than absorbing into a total.
 * `GymInvoiceRow` in src/lib/gymInvoices.ts is nullable for the same reason.
 */
export interface MemberInvoice {
  id: string;
  /** The number this gym gave this bill, unique per gym per year. Null on rows
   *  raised before the column existed — those were never numbered, and part 180
   *  refuses to invent numbers for them now. It is here because it is the one
   *  thing a member quotes on a bank transfer. */
  number: number | null;
  amountCents: number | null;
  currency: string | null;
  /** A bare 'YYYY-MM-DD' calendar day. Compared as a string, never parsed. */
  issuedOn: string;
  /** Null means the gym set no due date, which is NOT the same as due today
   *  and is why such an invoice can never be late. */
  dueOn: string | null;
  /** As written. A value outside the CHECK constraint is possible on a
   *  hand-written row and reports as 'unknown' rather than as 'open'. */
  status: string | null;
  membershipId: string | null;
  /** What the invoice is for, as the gym typed it into a field its own console
   *  labels "What it is for". The only description the row carries, and the
   *  reason this screen is not an amount with no explanation attached. Null
   *  where nothing was written — which is a gym that billed somebody without
   *  saying what for, and the screen says exactly that rather than inventing a
   *  description. */
  note: string | null;
}

/**
 * Where one invoice stands today, from the DATES first and the status second.
 *
 * The same order `standingOf` keeps for a membership in src/lib/memberRecord.ts,
 * and for the same reason: 'overdue' is a FUNCTION of the due date and today,
 * not a column anybody keeps up to date. src/lib/gymInvoices.ts says so where it
 * refuses to offer 'overdue' in the owner's picker, and `isOverdue` in
 * src/lib/monthEnd.ts is the owner-side computation of it. This is the member's
 * side of the same rule, kept in the same shape so the two cannot disagree about
 * one row.
 *
 * An invoice due TODAY is not late today — the same rule `standingOf` keeps for
 * a membership ending today, and for the same reason: a gym chasing somebody on
 * the morning of the day it asked for the money has a complaint, not a policy.
 */
export type InvoiceStanding =
  /** Raised but not issued. Not a bill; the member is not being asked to pay. */
  | { kind: 'draft' }
  /** Issued and unpaid, with a date still to come, or no date at all. */
  | { kind: 'due'; dueOn: string | null; daysLeft: number | null }
  /** Issued, unpaid and past the day the gym asked for it. */
  | { kind: 'overdue'; dueOn: string; daysLate: number | null }
  | { kind: 'paid' }
  /** Cancelled by the gym before payment. Nothing to pay and nothing owed. */
  | { kind: 'void' }
  /** The gym has given up on it. Still not a debt this app will chase. */
  | { kind: 'written_off' }
  /** A status nothing in this app writes. Named, never guessed at. */
  | { kind: 'unknown'; raw: string | null };

/** `today` is a bare 'YYYY-MM-DD' in the READER's own zone — an invoice falls
 *  due on a day in the life of the person paying it, not at a UTC instant. Both
 *  sides of every comparison below are bare dates compared as STRINGS, which is
 *  ordering the ISO format was designed for and which no timezone can move. */
export function invoiceStanding(inv: Pick<MemberInvoice, 'status' | 'dueOn'>, today: string): InvoiceStanding {
  const s = (inv.status || '').trim().toLowerCase();
  if (s === 'paid') return { kind: 'paid' };
  if (s === 'void') return { kind: 'void' };
  if (s === 'written_off') return { kind: 'written_off' };
  if (s === 'draft') return { kind: 'draft' };
  if (s === 'open' || s === 'overdue') {
    // A stored 'overdue' is honoured even with no date on it: somebody wrote it
    // down, and the app disagreeing with the gym's own word about its own
    // invoice is not a disagreement the member can act on. With a date, the
    // date decides — a paid-late invoice moved back to 'open' would otherwise
    // stay marked late forever.
    if (inv.dueOn && inv.dueOn < today) {
      return { kind: 'overdue', dueOn: inv.dueOn, daysLate: daysBetween(inv.dueOn, today) };
    }
    if (s === 'overdue' && !inv.dueOn) return { kind: 'overdue', dueOn: '', daysLate: null };
    return { kind: 'due', dueOn: inv.dueOn, daysLeft: inv.dueOn ? daysBetween(today, inv.dueOn) : null };
  }
  return { kind: 'unknown', raw: inv.status ?? null };
}

/** True while this invoice is money the gym is still asking for. The one test
 *  every total on the screen is filtered by, written once so that "what you
 *  owe" and "what is listed as owing" cannot come apart. */
export function isOwed(s: InvoiceStanding): boolean {
  return s.kind === 'due' || s.kind === 'overdue';
}

/** One word for a badge. Draws on the owner console's own labels where they
 *  mean the same thing, so a member and the person at the desk are reading the
 *  same word about the same row. */
export function invoiceStandingLabel(s: InvoiceStanding): string {
  switch (s.kind) {
    case 'draft': return 'Draft';
    case 'due': return 'Due';
    case 'overdue': return 'Overdue';
    case 'paid': return 'Paid';
    case 'void': return 'Cancelled';
    case 'written_off': return 'Written off';
    // The gym's own word, quoted, rather than a guess dressed as a status. A
    // member who reads it can say it at the desk, which is the only thing that
    // can actually resolve a status this app has never written.
    case 'unknown': return s.raw ? `Marked “${s.raw}”` : 'Not stated';
  }
}

/**
 * What this invoice means for the member, in a sentence.
 *
 * Nothing here tells them they must pay. This app does not take gym payments,
 * has no payment link for one, and an instruction to pay that ends at a screen
 * with no button on it is worse than a description of where things stand.
 */
export function invoiceNote(s: InvoiceStanding): string {
  switch (s.kind) {
    case 'draft':
      return 'Your gym has not issued this yet. It is a working copy, not a bill, and you are not being asked to pay it.';
    case 'due':
      if (!s.dueOn) return 'Unpaid. Your gym has not recorded a date it wants this by.';
      return s.daysLeft != null && s.daysLeft >= 0
        ? `Unpaid, and your gym has asked for it by ${s.dueOn}.`
        : `Unpaid. Your gym has asked for it by ${s.dueOn}.`;
    case 'overdue':
      return s.dueOn
        ? `Your gym has this marked as past its date — it asked for it by ${s.dueOn}. If you have paid it, ask reception to check it against the payment; what the desk recorded is under Payments.`
        : 'Your gym has this marked as past its date, without recording what date that was. Ask reception what it refers to.';
    case 'paid':
      return 'Your gym has marked this paid. Nothing is outstanding on it.';
    case 'void':
      return 'Your gym cancelled this before it was paid. Nothing is owed on it.';
    case 'written_off':
      return 'Your gym has written this off. It is not chasing it, and nothing here will.';
    case 'unknown':
      return 'This carries a status this app does not recognise, so nothing is claimed about whether it is owed. Reception can tell you what it means.';
  }
}

/**
 * What is still being asked for, per currency, and never across them.
 *
 * `status` is the read's own status and is taken separately from the rows for
 * the reason the whole of this codebase keeps them apart: an empty array from a
 * refused read and an empty array from a member who owes nothing are the same
 * array, and only one of them may be told "you owe nothing". Null is returned
 * under anything but a whole read — including 'partial', where the rows are
 * real and there are more of them than arrived, so a sum over them is a figure
 * computed from an unknown fraction of somebody's debt.
 */
export function owedByCurrency(
  invoices: readonly MemberInvoice[],
  today: string,
  status: LoadStatus,
): Taken | null {
  if (status !== 'ready') return null;
  return sumTaken(
    invoices
      .filter((inv) => isOwed(invoiceStanding(inv, today)))
      // `created_at` on a TakenRow is a date this sum never reads; the issue
      // date goes on it so the row is not carrying an empty string that a later
      // caller might try to parse.
      .map((inv) => ({ amount_cents: inv.amountCents, currency: inv.currency, created_at: inv.issuedOn })),
  );
}

/**
 * The sentence under an empty list, which depends entirely on the read.
 *
 * "Your gym has not invoiced you" is a claim about a gym's billing, and said
 * over a read that failed it is a false one — on the screen a member would open
 * precisely because they have been told an invoice exists.
 */
export function invoicesEmptyLine(status: LoadStatus): string {
  if (status === 'error') {
    return 'Nothing is listed because the read failed, not because your gym has not invoiced you. Anything already raised still stands. Pull down to try again.';
  }
  if (status === 'partial') return 'There are more invoices on record than could be read in one request, so what follows is not all of them.';
  if (status === 'loading') return 'Still reading.';
  return 'Your gym has not raised any invoices against your account. What it has recorded taking from you is under Payments.';
}

/* ── the sentences that keep the screen from overclaiming ─────────────────── */

/**
 * Where an invoice from a personal trainer actually comes from.
 *
 * On the screen because the member has been sent here by a notification that
 * may have said "coach", and a screen headed Invoices that does not contain
 * theirs reads as a bug rather than as a boundary. See the header for why the
 * table is not read and why no policy is widened to read it.
 */
export const COACH_INVOICE_NOT_HERE =
  'These are invoices from your gym. An invoice from a personal trainer is a document they issue and hand to you themselves — it stays in their own records rather than arriving here, so ask them for a copy if you need one.';

/** Why the three letters beside the figure are the gym's and not this app's. */
export const AMOUNT_AS_RECORDED =
  'Amounts are shown in the currency recorded on each invoice, as your gym entered it. The invoice your gym holds is the document; this is the app’s copy of what was written down. If a currency here is not one you have ever paid in, that is worth querying at reception.';

/** Said where the app cannot help the member act, which is honest rather than
 *  apologetic: there is no pay button, and inventing one that opens nothing is
 *  the failure this sentence exists instead of. */
export const NO_PAYMENT_HERE =
  'You cannot pay an invoice in the app. Your gym takes payment the way it always has, and whatever it records taking appears under Payments — usually within a day or two of the money moving.';
