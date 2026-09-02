// What a coach actually earned, and what they actually delivered.
//
// ══ 1 · THE FIGURE THAT COUNTED NO-SHOWS ═══════════════════════════════════
//
// app/(trainer)/analytics.tsx computed a coach's month like this:
//
//     sessions.filter(s => s.status === 'booked' && startsAt <= now).length
//       * sessionFee
//
// which is the clock, not the record. `src/lib/gymSessions.ts` names that exact
// inference in its own header — "That counts no-shows, un-cancelled slots, and
// sessions the trainer never turned up to" — and part 33 was written to end it.
// It WAS ended, for the gym owner. The coach's own hero figure, their
// at-risk-revenue figure and the AI digest composed from both still had it, and
// `rowToSession` in src/ui/sessions.tsx now carries `outcome` and `outcomeAt`,
// so the data to fix it has been arriving all along.
//
// The fix is not to guess better. It is the same one gymSessions made:
//
//   delivered   `outcome === 'completed'`, and nothing else.
//   unmarked    the hour is over, the session was booked, and nobody has said
//               what happened. Its OWN state. Never folded into either side,
//               never silently counted, never silently dropped.
//   the rest    a no-show, a cancellation, a late cancellation. Recorded, and
//               not income.
//
// The vocabulary is borrowed rather than invented: `pastVerdict` and
// `PAST_STATE_*` in src/lib/sessionHistory.ts already read `sessions.outcome`
// for four screens, and gymSessions already calls the null state "still needs
// an outcome recorded" and already refuses to price a payroll run while any
// exist. A coach reading "3 still need an outcome" here and on the marking
// queue is reading about the same thing, in the same words.
//
// An unmarked session is therefore money that is neither claimed nor denied,
// and `unmarkedValue` prices it SEPARATELY so a coach can see the size of what
// they have not yet recorded. That is the honest shape: a month that reads
// "AED 6,180 delivered, with 12 sessions still to mark" is useful. One that
// reads AED 7,060 because it counted the twelve is a dispute.
//
// ══ 2 · THE FIGURE AN ONLINE COACH ACTUALLY EARNS ══════════════════════════
//
// For a coach with no in-person clients the old figure was not inflated, it was
// meaningless. They sell no sessions. Their money is packages, subscriptions
// and whatever they were handed outside the app, and all three already exist:
// `sumTaken` / `combineTaken` in src/lib/coachMoney.ts, `ledger` in
// src/lib/coachLedger.ts, `client_purchases`, `client_subscription_payments`
// and `coach_receipts`. app/(trainer)/money.tsx has read all three for months.
//
// So nothing here invents a second money rule. `takingsStrands` below is the
// SAME strand composition the Money screen was already using, lifted out of
// that screen so the two cannot drift, and everything downstream of it is
// `ledger()` unchanged — which means the currency rules come along for free:
// two currencies never sum, an amount with no currency is counted rather than
// dropped, and there is no default currency anywhere.
//
// ── What is deliberately NOT here ─────────────────────────────────────────
//
// Anything that adds the two halves together. Sessions priced at a coach's own
// rate is the coach's arithmetic about work they did; takings is money that
// actually moved through Stripe or was handed over. A coach on a package who
// also delivers the sessions in it would have both counted, and the sum would
// be roughly double. They are two figures, printed apart and labelled apart,
// and there is no function here that adds them for the same reason
// src/lib/coachLedger.ts has no function that computes a net.
//
// Pure — no react, no supabase, so `npm test` runs it.
import type { LoadStatus } from '../ui/loadStatus';
import { isWhole } from '../ui/loadStatus';
import { hasEnded, pastVerdict, wasBooked, type HistoryRow } from './sessionHistory';
import { sumTaken, type TakenRow } from './coachMoney';
import type { Strand } from './coachLedger';

/* ── the month ────────────────────────────────────────────────────────────── */

/** Midnight on the 1st of the month containing `now`, local time, through to
 *  `now` itself. The same boundary `monthStart` in coachMoney.ts uses, so the
 *  sessions half and the money half of a screen describe the same span. */
export function monthToDate(now: Date = new Date()): { from: number; to: number } {
  const d = new Date(now.getTime());
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return { from: d.getTime(), to: now.getTime() };
}

/* ── what happened, counted ───────────────────────────────────────────────── */

/**
 * A month of sessions, by what the record says became of them.
 *
 * Every field is `number | null` and they are all null together: these are
 * counts, and src/ui/loadStatus.ts forbids a count over a read that is not
 * whole. A subtotal of a coach's month printed as their month is the defect
 * this shape exists to make impossible rather than to remember not to commit.
 */
export interface SessionMonth {
  /** `outcome === 'completed'`. The only thing that is income. */
  delivered: number | null;
  /** Booked, the hour is over, and nobody has said what happened. */
  unmarked: number | null;
  /** `no_show`. */
  missed: number | null;
  /** `cancelled`, with notice. */
  cancelled: number | null;
  /** `late_cancelled`, inside the notice period. */
  lateCancelled: number | null;
  /** Sessions the client has objected to. Independent of the state above: a
   *  session marked delivered AND disputed is both, and both are shown. */
  disputed: number | null;
}

/** Nothing established, which is what a short read gets. */
export const UNKNOWN_MONTH: SessionMonth = {
  delivered: null, unmarked: null, missed: null,
  cancelled: null, lateCancelled: null, disputed: null,
};

/**
 * Count a window of sessions by outcome.
 *
 * ── The two bounds, and why they are not the same test ────────────────────
 *
 * DELIVERED is bounded by `startsAt` alone, at both ends. A coach may mark a
 * session before its slot has passed — they finished early, or the slot was
 * mis-scheduled — and `deliveredBetween` in src/lib/trainerSessions.ts already
 * allows exactly that. Refusing to count it would tell a coach who has just
 * marked a session that it did not happen.
 *
 * UNMARKED additionally requires the hour to be OVER, and that is the whole
 * difference. Every future booking is unmarked, by construction, and counting
 * next Tuesday as "waiting on an outcome" would put a permanent unclearable
 * badge on a working coach's dashboard. `hasEnded` uses the END of the session,
 * not its start, so the hour somebody is standing in is not history either.
 *
 * A row that was never booked and carries no outcome is not a session at all —
 * an `available` slot that has gone by is an hour nobody took, and treating it
 * as one is the same inference part 33 exists to end. `wasBooked` is the test.
 */
export function sessionMonth(
  rows: readonly HistoryRow[],
  status: LoadStatus,
  from: number,
  to: number,
): SessionMonth {
  if (!isWhole(status)) return UNKNOWN_MONTH;
  const m: SessionMonth = {
    delivered: 0, unmarked: 0, missed: 0, cancelled: 0, lateCancelled: 0, disputed: 0,
  };
  for (const r of rows) {
    if (!wasBooked(r)) continue;
    const at = Date.parse(r.startsAt);
    if (!Number.isFinite(at) || at < from || at > to) continue;
    const v = pastVerdict(r);
    if (v.state === 'unmarked' && !hasEnded(r, to)) continue;
    if (v.disputed) m.disputed = (m.disputed ?? 0) + 1;
    switch (v.state) {
      case 'delivered': m.delivered = (m.delivered ?? 0) + 1; break;
      case 'missed': m.missed = (m.missed ?? 0) + 1; break;
      case 'cancelled': m.cancelled = (m.cancelled ?? 0) + 1; break;
      case 'late_cancelled': m.lateCancelled = (m.lateCancelled ?? 0) + 1; break;
      case 'unmarked': m.unmarked = (m.unmarked ?? 0) + 1; break;
    }
  }
  return m;
}

/**
 * The same count, narrowed to a set of clients.
 *
 * Used for the at-risk figure, which is the money a coach is about to lose
 * rather than the money they made. It takes the ids as a set so the caller's
 * roster filter is the roster filter — this module has no opinion about who is
 * at risk, only about what those people's sessions came to.
 *
 * A session with no `clientId` is out. An unattributed hour is not evidence
 * about any particular person leaving.
 */
export function sessionMonthFor(
  rows: readonly (HistoryRow & { clientId?: string | null })[],
  clientIds: ReadonlySet<string>,
  status: LoadStatus,
  from: number,
  to: number,
): SessionMonth {
  return sessionMonth(
    rows.filter((r) => r.clientId != null && clientIds.has(r.clientId)),
    status, from, to,
  );
}

/* ── what that is worth ───────────────────────────────────────────────────── */

/**
 * Delivered sessions at the coach's own rate, or null.
 *
 * Null — never 0 — when either half is unknown. A rate of 0 is a rate somebody
 * could charge, so it cannot also mean "no rate set", and a count that was
 * never established cannot be multiplied by anything. This is deliberately the
 * coach's own arithmetic about work they did and NOT a payout: Repple processes
 * none of it, which is what the note on the screen says.
 */
export function deliveredValue(m: SessionMonth, sessionFee: number | null | undefined): number | null {
  if (m.delivered == null || sessionFee == null || !Number.isFinite(sessionFee)) return null;
  return m.delivered * sessionFee;
}

/**
 * What the unmarked sessions WOULD be worth if every one of them turned out to
 * have been delivered.
 *
 * Priced apart from the delivered figure and never added to it. This is the
 * size of what the coach has not recorded — the reason to go and record it —
 * and stating it is the opposite of counting it: the old figure swept exactly
 * this money into the total silently.
 */
export function unmarkedValue(m: SessionMonth, sessionFee: number | null | undefined): number | null {
  if (m.unmarked == null || sessionFee == null || !Number.isFinite(sessionFee)) return null;
  return m.unmarked * sessionFee;
}

/**
 * The sentence about the unmarked ones, or null when there is nothing to say.
 *
 * Null both when there are none and when the count is unknown — a screen must
 * not tell a coach "0 sessions need an outcome" off a failed read, which is an
 * all-clear made out of our own failure.
 *
 * Borrows gymSessions' own wording for the state rather than inventing a
 * second, so the marking queue, the payroll blocker and this line are visibly
 * about one thing.
 */
export function unmarkedLine(m: SessionMonth): string | null {
  if (m.unmarked == null || m.unmarked === 0) return null;
  return m.unmarked === 1
    ? 'One session this month still needs an outcome recorded, so it is counted neither as delivered nor as missed.'
    : `${m.unmarked} sessions this month still need an outcome recorded, so they are counted neither as delivered nor as missed.`;
}

/** Said under the delivered figure, because the change is worth stating once:
 *  it used to be the clock and it is now the record. */
export const DELIVERED_IS_MARKED =
  'Counted from the outcomes you marked, not from the clock. A booking whose time has passed is not a session that happened.';

/**
 * How a session count reads when it could not be established.
 *
 * The three reasons are not interchangeable and only one of them is "you had a
 * quiet month". None of them is zero.
 */
export function sessionsUnknownLine(status: LoadStatus): string {
  if (status === 'loading') return 'Still reading your sessions.';
  if (status === 'partial') return 'Your sessions came back short, so they cannot be counted. A subtotal printed here would be read as a month.';
  return 'Your sessions could not be read, so this is not a count of zero.';
}

/* ── the other half: money that actually moved ────────────────────────────── */

/** The three reads a coach's takings are made of, by status. */
export interface TakingsReads {
  sales: LoadStatus;
  renewals: LoadStatus;
  receipts: LoadStatus;
}

/** The same three, as rows already reduced to what a total depends on. */
export interface TakingsRows {
  sale: readonly TakenRow[];
  renewal: readonly TakenRow[];
  receipt: readonly TakenRow[];
}

/**
 * A coach's income, as strands `ledger()` can add up or refuse to.
 *
 * Lifted out of app/(trainer)/money.tsx rather than copied: two screens now
 * state a coach's takings and a second composition would be a second money
 * rule, which is the thing this codebase keeps finding it has. The labels are
 * the Money screen's own words, unchanged, because `Ledger.reason` builds a
 * sentence around them and a coach reads that sentence on both screens.
 *
 * The cash strand is not optional and is not a footnote. `coach_receipts` is
 * the half of the book Stripe never saw, and for most self-employed coaches it
 * is the LARGER half — src/lib/clientValue.ts makes the argument at length.
 * `ledger()` withholds the whole total the moment any one strand is short,
 * which is exactly right: takings with the cash half missing is not a smaller
 * number, it is a different number about a different business.
 */
export function takingsStrands(reads: TakingsReads, rows: TakingsRows): Strand[] {
  return [
    { key: 'sales', label: 'one-off sales', status: reads.sales, taken: sumTaken(rows.sale) },
    { key: 'renewals', label: 'subscription renewals', status: reads.renewals, taken: sumTaken(rows.renewal) },
    { key: 'receipts', label: 'payments you recorded yourself', status: reads.receipts, taken: sumTaken(rows.receipt) },
  ];
}

/** Said beside the takings figure. Gross, and never a balance — the fee, the
 *  platform's cut and whether the money has landed all live at Stripe and no
 *  webhook in this repo writes them here. */
export const TAKINGS_IS_GROSS =
  'What clients were charged, gross, across packages, subscription renewals and the payments you recorded yourself. Stripe fees and payouts are not subtracted, because this app is never told them.';

/** Said on the sessions figure wherever the takings figure is the headline —
 *  the two are never added, and a coach should be told that rather than left
 *  to wonder why. */
export const TWO_FIGURES_NEVER_SUM =
  'Kept apart from your takings above and never added to it. A package your client paid for and the sessions you delivered out of it are the same money counted twice.';
