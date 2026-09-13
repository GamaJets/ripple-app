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

/* ── pass sales, snapshotted ──────────────────────────────────────────────── */

/**
 * The pass figures a close files, and the four columns they are written to.
 *
 * Pass sales are the one part of a month `CloseSnapshot` did not carry. Every
 * other figure on the sheet — taken, billed, still owed, payroll — stops moving
 * the moment the month is filed; the passes kept moving, so a close that an
 * owner handed to an accountant said what the gym took at the card machine and
 * said nothing at all about what it sold over the counter, and there was no
 * later way to recover the figure. `buildClose` holds `passes` apart from
 * `income` on purpose (the two tables have no link column and adding them would
 * double-count), which is exactly why the close has to store it separately too:
 * it is not inside `takenCents` and never was.
 *
 * Held as its own interface rather than folded into `CloseSnapshot` because
 * that type lives in src/lib/gymClose.ts, which this lane does not own — see
 * the note on `passDriftSince` about what is still wired and what is not.
 */
export interface PassSnapshot {
  /**
   * Minor units across the month's priced passes, or null.
   *
   * NULL IS NOT ZERO HERE, and it is the whole point of this field. A close row
   * is a record of what was true at close, and there are two true states that
   * are not a number:
   *
   *   · the passes were never read, so nothing is known;
   *   · the priced passes span more than one currency, so a single figure does
   *     not exist. `ClosePasses.cents` is still a raw sum in that case — its
   *     own comment says so, and says a caller must WITHHOLD it — because
   *     `passRevenueCents` has no opinion about money. Adding AED 860 to
   *     GBP 240 gives 1,100 of nothing.
   *
   * Zero would be a claim that the gym sold nothing, which is a different and
   * false statement about a gym that sold four passes in two currencies. So it
   * goes in null, and `passesSold` beside it still carries the count — the
   * figure is withheld, the fact that passes were sold is not.
   *
   * Every reader must handle the null: it is a dash on screen, never a 0, and
   * never a licence to reach for `tenants.currency`.
   */
  passCents: number | null;
  /**
   * What `passCents` is denominated in, or null.
   *
   * Null whenever `passCents` is null, so the pair can never disagree. Null
   * ALSO where a real sum exists whose rows stated no code at all — priced
   * passes that all say nothing are one unknown unit, not two known ones, which
   * is the same distinction `payrollCurrency` draws in gymClose.ts.
   */
  passCurrency: string | null;
  /** How many passes were issued in the month. Null only when the passes were
   *  not read — it survives a mixed-currency month, which is what stops a
   *  withheld total reading as "nothing was sold". */
  passesSold: number | null;
  /** How many of those carried a recorded price. The number that says what
   *  fraction of the month `passCents` is a sum over. */
  passesPriced: number | null;
}

/**
 * The month's pass sales, reduced to what gets filed.
 *
 * Three cases and they are three different records:
 *
 *   · `c.passes` null — the passes slice did not land. All four null. Not a
 *     month with no passes in it; a month nobody can speak for.
 *   · mixed currency — the counts are filed and the money is not, for the
 *     reason written on `passCents`.
 *   · otherwise — the figure and its own code, straight off the rows the figure
 *     is a sum of, exactly as `figureCurrencies` takes the other three.
 */
export function passSnapshotOf(c: MonthClose): PassSnapshot {
  const p = c.passes;
  if (!p) return { passCents: null, passCurrency: null, passesSold: null, passesPriced: null };
  // The counts are true of the month either way, and they are what stops the
  // withheld figure being read as an empty counter.
  const counts = { passesSold: p.sold, passesPriced: p.priced };
  if (p.mixedCurrency) return { passCents: null, passCurrency: null, ...counts };
  return { passCents: p.cents, passCurrency: p.currency, ...counts };
}

/**
 * The pass columns as a stored close carries them.
 *
 * Every field OPTIONAL, and that is a statement about today rather than about
 * the schema. `fetchCloses` in src/lib/gymClose.ts does not select these
 * columns yet — that half of the change belongs to the file this lane does not
 * own — so a row handed to `filingOf` right now has no `passCents` KEY on it at
 * all, which is not the same fact as a `pass_cents` column that is null.
 *
 * Optional rather than `| undefined` so that a plain `MonthCloseRow` still
 * satisfies it, and so that the day `MonthCloseRow` gains the four fields this
 * type is already describing them.
 */
export interface StoredPassColumns {
  passCents?: number | null;
  passCurrency?: string | null;
  passesSold?: number | null;
  passesPriced?: number | null;
}

/**
 * What the passes say now, against what the close filed about them.
 *
 * The pass half of `driftSince`, and the same argument: a closed month whose
 * pass sales have since moved is not an error — a pass voided in September
 * correctly changes what August sold — but somebody holding the filed figure
 * has to be told.
 *
 * ── the silence this refuses ──────────────────────────────────────────────
 *
 * A row that carries NONE of the four keys was read by a select that did not
 * ask for the columns, and it answers nothing. It is emphatically not a close
 * that recorded null passes: reporting it as one would put "pass sales were not
 * one figure at the close" on every filed month in the product, permanently,
 * off a read that never posed the question. So a row with no pass keys produces
 * no lines, and the check becomes real the moment `fetchCloses` selects them.
 *
 * ── and the null it does report ───────────────────────────────────────────
 *
 * Where the keys ARE present, null on either side is named rather than dashed,
 * and it is named as what it is — "not a single amount", never "0" and never
 * "not known", because a mixed-currency month is a month whose figure exists
 * and is not one number. The counts are compared separately and carry on
 * speaking through it.
 */
export function passDriftSince(
  stored: MonthCloseRow & StoredPassColumns,
  now: PassSnapshot,
  fmt: (cents: number | null, currency: string | null) => string,
): string[] {
  const asked = 'passCents' in stored || 'passCurrency' in stored
    || 'passesSold' in stored || 'passesPriced' in stored;
  if (!asked) return [];

  const out: string[] = [];
  const wasCents = stored.passCents ?? null;
  const wasCcy = stored.passCurrency ?? null;
  // A CHANGE OF CURRENCY is a drift line on its own, for the reason driftSince
  // states at length: 860 recorded in GBP and reading 860 in AED today has not
  // moved as a number and has moved as money.
  if (wasCents !== now.passCents || wasCcy !== now.passCurrency) {
    const side = (cents: number | null, ccy: string | null) =>
      cents == null ? 'not a single amount' : fmt(cents, ccy);
    out.push(`Pass sales were ${side(wasCents, wasCcy)} at the close and are ${side(now.passCents, now.passCurrency)} now.`);
  }
  const wasSold = stored.passesSold ?? null;
  if (wasSold !== now.passesSold) {
    out.push(`${wasSold ?? 'An unknown number of'} pass(es) were sold in the month at the close; ${now.passesSold ?? 'an unknown number'} are now.`);
  }
  const wasPriced = stored.passesPriced ?? null;
  if (wasPriced !== now.passesPriced) {
    out.push(`${wasPriced ?? 'An unknown number'} of them carried a price at the close; ${now.passesPriced ?? 'an unknown number'} do now.`);
  }
  return out;
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
 *
 * The pass lines come from `passDriftSince` and are appended to the money ones
 * rather than held apart, because the question the headline counts is "how many
 * figures have moved since this was filed" and pass sales are one of the
 * figures. Its own guard is what keeps it silent until `fetchCloses` selects
 * the columns — see the note on it.
 */
export function filingOf(
  monthKey: string,
  closes: { status: LoadStatus; rows: readonly (MonthCloseRow & StoredPassColumns)[] | null },
  c: MonthClose | null,
  fmt: (cents: number | null, currency: string | null) => string,
): Filing {
  if (!isWhole(closes.status) || !closes.rows) return { state: 'unknown' };
  const live = liveCloseFor(monthKey, [...closes.rows]);
  if (!live) return { state: 'open' };
  const drift = c
    ? [
        ...driftSince(live, snapshotOf(c, figureCurrencies(c)), fmt),
        ...passDriftSince(live, passSnapshotOf(c), fmt),
      ]
    : [];
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
  closes: { status: LoadStatus; rows: readonly (MonthCloseRow & StoredPassColumns)[] | null },
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
