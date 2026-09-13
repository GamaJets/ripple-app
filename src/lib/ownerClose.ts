// Can this month be closed, and what is stopping it — on the owner's phone.
//
// ── What was missing ───────────────────────────────────────────────────────
//
// The whole verdict already exists. `buildClose` in src/lib/monthEnd.ts reads
// five parts of a month and answers 'closeable' or 'blocked', `closeBlockers`
// says why in sentences an owner can act on, and `gym_month_closes` records
// what was filed and what it was filed over. All of it is on a laptop. An owner
// standing anywhere else could not find out whether their month was signed off,
// whether it could be, or which twelve sessions nobody had marked — and the
// close is the one month-end act with a deadline on it.
//
// ── Why there is no button here, and why that is the feature ──────────────
//
// Closing a month WRITES A SNAPSHOT (src/lib/gymClose.ts) that every later
// drift line is measured against, and it then LOCKS the month: part 182 refuses
// a payment, an invoice or a cost dated inside a closed month, for everybody,
// until an owner reopens it with a written reason. The desk stops being able to
// take money for that month. That is a filing act taken with the sheet in front
// of you, and `closeBlocker` in gymClose.ts already refuses it over a record of
// closes that could not be read — a refusal that only means anything where the
// whole record is on screen.
//
// So this module produces a view and no action, and `CLOSE_IS_NOT_A_PHONE_ACT`
// says so on the screen rather than leaving the absence of a button to be read
// as an oversight.
//
// ── The three silences this file refuses to collapse ──────────────────────
//
//   · The five reads have not settled → the verdict is UNKNOWN. Not 'blocked'
//     and emphatically not 'closeable': `closeBlockers` already raises
//     'still_loading' and 'read_failed' lines of its own, and a screen that
//     rendered "this month can be closed" off a record it does not hold would
//     be the worst sentence this lane could ship.
//   · `gym_month_closes` could not be read → whether the month is ALREADY
//     filed is unknown. It is never drawn as "not closed yet": an owner told
//     that will close a month that is already closed, and the database answers
//     that with a unique-index violation nobody can act on.
//   · A month that IS filed and whose live figures have since moved is not an
//     error. `driftSince` exists because a September refund correctly changes
//     what August's ledger says, and the person holding the filed figure has to
//     be told. It is reported as movement, never as a blocker.
//
// Pure: no react, no supabase, no clock beyond what the caller hands in.
import { snapshotOf, driftSince, liveCloseFor, type MonthCloseRow } from './gymClose';
import type { MonthClose, Blocker, Owed } from './monthEnd';
import { noGymNote } from './gymLink';
// One place decides what 'none' and 'unknown' mean about a gym link — the same
// import src/lib/coachClose.ts takes, for the same reason.
import type { GymLink } from './coachPayTerms';
import { isWhole, type LoadStatus } from '../ui/loadStatus';

/* ── the sentences ────────────────────────────────────────────────────────── */

/**
 * Why the phone shows the verdict and does not take it.
 *
 * Printed under every state of the section. An absent button reads as a missing
 * feature unless somebody says it was a decision, and the reason is the part an
 * owner needs: closing locks the month against the desk.
 */
export const CLOSE_IS_NOT_A_PHONE_ACT =
  'This is the month as it reads right now. Closing it is done on the web console, and only there: a close files a '
  + 'permanent snapshot of these figures and then locks the month — no payment, invoice or cost dated inside it can be '
  + 'recorded by anybody until an owner reopens it with a written reason. That is a decision taken with the whole sheet '
  + 'in front of you.';

/** The tenant read has not landed. Never rendered as a gym with an open month. */
export const CLOSE_UNREAD_NOTE =
  'Your gym could not be read, so there is no month to report on. This is not a statement about whether anything is closed.';

/**
 * The five reads have not settled.
 *
 * Deliberately not "nothing is blocking this month". The absence of a blocker
 * list under an unfinished read is the absence of an answer.
 */
export const CLOSE_FIGURES_UNREAD_NOTE =
  'The month’s own records are not all in hand, so there is no verdict — not a clean one and not a blocked one. '
  + 'Whatever is already filed for this month is unaffected.';

/**
 * The record of closes did not answer.
 *
 * The sentence that must never become "this month is still open". An owner who
 * reads that about a month they closed last week will try to close it again.
 */
export const FILING_UNKNOWN_NOTE =
  'Whether this month has already been signed off could not be read, so nothing here says it is open. '
  + 'What the figures below show is how the month reads today, which is a different question.';

/** A filed month whose live rows have moved since. Movement, never an error. */
export const DRIFT_IS_NOT_AN_ERROR =
  'A filed month whose figures have since moved is ordinary — a refund recorded later correctly changes what an '
  + 'earlier month’s ledger says. It is not a mistake and nothing needs undoing. It is the thing anybody holding the '
  + 'filed figure has to be told about.';

/* ── the shapes ───────────────────────────────────────────────────────────── */

/** Whether the month has been signed off, and the third answer that is neither. */
export type Filing =
  | { state: 'unknown' }
  | { state: 'open' }
  | {
      state: 'filed';
      /** As the row carried it. Formatted by the screen, never here. */
      at: string;
      /** Who filed it, or null where the name could not be read. */
      by: string | null;
      note: string | null;
      /** What was outstanding when they filed it anyway, verbatim. */
      blockersAtClose: string | null;
      /** One line per figure that has moved since. Empty means it reads today
       *  exactly as it read when it was filed. */
      drift: string[];
    };

/** 'unknown' is the read, not the month. See the header. */
export type OwnerVerdict = 'closeable' | 'blocked' | 'unknown';

export type OwnerCloseView =
  | { kind: 'unread'; note: string }
  | { kind: 'no_gym'; note: string }
  | {
      kind: 'month';
      /** 'August 2026', in the reader's own language. */
      monthLabel: string;
      /** 'YYYY-MM'. */
      monthKey: string;
      filing: Filing;
      verdict: OwnerVerdict;
      /** The one sentence at the top. Never a figure beside a refusal. */
      headline: string;
      /** Why it will not close, in `closeBlockers`' own words. Empty under
       *  'unknown' — an unfinished read has no list of reasons, only the fact
       *  that it is unfinished. */
      blockers: Blocker[];
      /** `closeWarning` — which part could not be read, and what that costs. */
      warning: string | null;
    };

/* ── pure rules ───────────────────────────────────────────────────────────── */

/** What a set of invoices agrees it is denominated in, or null. Mirrors the
 *  console's own `agreedIn`: the currency is read back off the summary that
 *  produced the sum, never re-derived from a wider set of rows. */
const agreedIn = (o: Owed | null): string | null =>
  (o && !o.mixedCurrency && o.currencies.length === 1 ? o.currencies[0] : null);

/**
 * One currency per figure, each taken from the rows that figure is a sum of.
 *
 * This exists because `snapshotOf` needs three codes and getting them from the
 * gym's own `tenants.currency` is the defect supabase/parts/2540 was written to
 * close — a gym whose August card takings were all AED filed its GBP invoices,
 * arrears and payroll as dirhams, permanently. Here the stakes are smaller and
 * the rule is the same: these three feed `driftSince`, and a borrowed code
 * would report a currency change that never happened.
 *
 * `takenCents` is null under a mixed month, so the code is null with it — the
 * pair always agree, which is what stops a withheld figure acquiring a unit.
 */
export function figureCurrencies(c: MonthClose): { taken: string | null; invoiced: string | null; outstanding: string | null } {
  const taken = c.income && !c.income.mixedCurrency && c.income.currencies.length === 1
    ? c.income.currencies[0]
    : null;
  return { taken, invoiced: agreedIn(c.owed), outstanding: agreedIn(c.arrears) };
}

/**
 * The sentence at the top of the section.
 *
 * Four cases and they are four different claims. The filed ones lead with the
 * filing, because "August is closed" is the answer to the question an owner
 * away from their desk actually asked — and the live verdict under a filed
 * month is about today's rows rather than about whether it may be signed off.
 */
function headlineFor(c: MonthClose | null, label: string, filing: Filing): string {
  if (filing.state === 'filed') {
    if (filing.drift.length) {
      return `${label} is closed, and ${filing.drift.length === 1 ? 'one figure has' : `${filing.drift.length} figures have`} moved since it was filed.`;
    }
    return `${label} is closed and reads today exactly as it did when it was filed.`;
  }
  // Not filed, or not known to be. The verdict is about the figures either way,
  // and under 'unknown' the sentence may not imply the month is open.
  const open = filing.state === 'open';
  if (!c) {
    return open
      ? `${label} has not been signed off, and its records are not all in hand — so there is no verdict yet.`
      : `${label}’s records are not all in hand, so there is no verdict yet.`;
  }
  if (c.state === 'blocked') {
    const n = c.blockers.length;
    return open
      ? `${label} is not closed. ${n} thing${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} in the way.`
      : `${n} thing${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} in the way of closing ${label}.`;
  }
  return open
    ? `${label} has nothing outstanding and nothing unexplained. It can be closed, on the console.`
    : `${label} has nothing outstanding and nothing unexplained.`;
}

/**
 * Whether this month is filed, and how it has moved if it is.
 *
 * A read that is not whole answers 'unknown' — including 'partial', which
 * `fetchCloses` cannot produce today (it throws on a truncated read) and which
 * must not be quietly accepted as an answer the day something changes.
 *
 * Drift is only ever computed against a close that was built from a WHOLE
 * record. With `c` null the filed row is reported with no drift rather than
 * with drift against nothing: `snapshotOf` over a half-read month would compare
 * the filed figures against nulls and report every one of them as moved.
 */
export function filingOf(
  monthKey: string,
  closes: { status: LoadStatus; rows: readonly MonthCloseRow[] | null },
  c: MonthClose | null,
  fmt: (cents: number | null, currency: string | null) => string,
): Filing {
  if (!isWhole(closes.status) || !closes.rows) return { state: 'unknown' };
  const live = liveCloseFor(monthKey, [...closes.rows]);
  if (!live) return { state: 'open' };
  const drift = c ? driftSince(live, snapshotOf(c, figureCurrencies(c)), fmt) : [];
  return {
    state: 'filed',
    at: live.closedAt,
    by: live.closedByName,
    note: live.note,
    blockersAtClose: live.blockersAtClose,
    drift,
  };
}

/**
 * The whole section, decided once.
 *
 * `c` is null whenever the five reads have not all landed, and that is the
 * 'unknown' verdict — separate from 'blocked' on purpose. A month whose
 * payments read failed is not a month with a problem in it; it is a month
 * nobody can speak for, and the two want different words and different actions.
 */
export function ownerCloseView(
  link: GymLink,
  month: { key: string; label: string } | null,
  close: MonthClose | null,
  closes: { status: LoadStatus; rows: readonly MonthCloseRow[] | null },
  fmt: (cents: number | null, currency: string | null) => string,
): OwnerCloseView {
  if (link === 'unknown') return { kind: 'unread', note: CLOSE_UNREAD_NOTE };
  // Phrased as a plural noun because `noGymNote` puts it after "there are no".
  if (link === 'none') return { kind: 'no_gym', note: noGymNote('months to close') };
  // No window means the month key was not one. A verdict with no month attached
  // is a verdict about nothing, and on this screen it would be signed.
  if (!month) return { kind: 'unread', note: CLOSE_UNREAD_NOTE };

  const filing = filingOf(month.key, closes, close, fmt);
  return {
    kind: 'month',
    monthLabel: month.label,
    monthKey: month.key,
    filing,
    verdict: close ? close.state : 'unknown',
    headline: headlineFor(close, month.label, filing),
    // The blockers are the close's own, unedited. Under a filed month they are
    // still the truth about today's rows — what changed is what they mean, and
    // the screen says so rather than this list being quietly emptied.
    blockers: close ? close.blockers : [],
    warning: close ? close.warning : null,
  };
}

/**
 * The figure beside the heading, or null.
 *
 * Null for every view that is not a settled verdict, and null for a clean
 * month: "0 in the way" beside a heading reads as a reprimand that has been
 * dealt with, which is not the same as having nothing to report. Same rule
 * `closeQueueNote` states on the coach's side.
 */
export function closeHeadNote(v: OwnerCloseView): string | null {
  if (v.kind !== 'month') return null;
  if (v.filing.state === 'filed') return 'Closed';
  if (v.verdict === 'unknown') return null;
  if (v.verdict === 'blocked') {
    const n = v.blockers.length;
    return `${n} in the way`;
  }
  return null;
}
