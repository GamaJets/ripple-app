/**
 * WHAT ONE SESSION WAS FILED AS BEING WORTH — read in the row's own currency,
 * or not read at all.
 *
 * ── The two columns, and why they are always read together ───────────────
 *
 * `sessions.rate_cents` is an integer of minor units, snapshotted at the moment
 * a session is marked delivered (src/lib/rateSnapshot.ts) so that changing a
 * fee next month cannot rewrite what last month cost. `sessions.rate_currency`
 * is what that integer is denominated in, added by
 * supabase/parts/1010-a-rate-snapshotted-in-nothing.sql, whose whole subject is
 * that the first column without the second names no money at all. Its own
 * comment on the column:
 *
 *     "NULL means the unit was never recorded (every row written before this
 *      part), and must be read as unknown, NEVER as the gym's currency today."
 *
 * And on the figure: "Read it with rate_currency or not at all — the integer
 * alone names no money."
 *
 * This module is that sentence made unavoidable. There is no way to get a
 * figure out of it without a currency, because there is no arithmetic that
 * could produce one: the minor-unit factor is a property of the currency and it
 * is 1, 100 or 1000 (src/lib/coachMoney.ts holds both lists). 4500 minor units
 * is ¥4,500, or £45.00, or 4.500 Kuwaiti dinar — three figures two orders of
 * magnitude apart — and nothing on the row says which. So an un-united rate
 * renders as NOTHING plus a sentence, never as a bare 4500 that a reader will
 * silently supply their own currency and their own decimal point for.
 *
 * ── Why the member sees this at all ──────────────────────────────────────
 *
 * Because it is a fact about their own session, on a row `sessions_client_read`
 * (supabase/parts/22) already lets them read whole, and it was dropped on the
 * way in by `rowToSession` in src/ui/sessions.tsx — the same mapper that used to
 * drop `outcome` and `outcome_at`, for the same reason: nobody had asked for
 * them, so nobody carried them. The member could see that an hour had been
 * booked and delivered and nothing about what it was worth.
 *
 * ── What this deliberately does NOT claim ────────────────────────────────
 *
 * That the member paid it, owes it, or was invoiced for it. Repple takes no
 * payment for PT — `charges` is a record for two people to settle between them
 * and carries no payment intent (supabase/parts/126) — and this column is the
 * rate FILED AGAINST THE SESSION when it was marked delivered, which is what
 * payroll is computed from. Calling it "what you paid" would be this app
 * asserting a transaction it has never seen. Every sentence below says
 * "recorded" or "filed", and none of them says "owe".
 *
 * ── And it never totals ──────────────────────────────────────────────────
 *
 * Two sessions in two currencies are two amounts and no sum; there is no rate
 * anywhere in this product to make one. See src/lib/sumCurrency.ts. Nothing
 * here takes a list.
 *
 * Pure and framework-free.
 */
import { minorMoney } from './coachMoney';

/** Why a session's rate cannot be printed, or 'priced' when it can. */
export type RateState =
  /** There is a figure and the row says what money it is in. */
  | 'priced'
  /** A figure was filed and the unit was not. Every row written before part
   *  1010, and any writer since that sets the integer alone. The figure exists;
   *  it cannot be read, and that is a fact about the record rather than about
   *  the session. */
  | 'unstated'
  /** No rate was ever filed against this session. NOT a session that was free —
   *  a session nobody priced, which is the ordinary state of one that has not
   *  been marked delivered yet. */
  | 'none';

export interface SessionRate {
  state: RateState;
  /** The amount, already in its own currency, or null when there is none to
   *  print. Never a bare number: see the header. */
  amount: string | null;
  /** The sentence that goes under a missing figure, or null under a real one.
   *  A screen may print the amount alone; it may not print nothing alone. */
  note: string | null;
}

const NONE: SessionRate = {
  state: 'none',
  amount: null,
  // No note. "Nothing was filed" is the ordinary state of most rows on this
  // table and a sentence about it on every one of them would be noise that
  // trains a reader to skip the line that matters — which is the 'unstated'
  // one directly below, about a figure that DOES exist and cannot be read.
  note: null,
};

const UNSTATED: SessionRate = {
  state: 'unstated',
  amount: null,
  note: 'A rate is recorded against this session but not the currency it was in, '
    + 'so there is no amount that can honestly be shown. Your coach has the figure.',
};

/**
 * One session's rate, as a screen may state it.
 *
 * `rateCents` arrives from PostgREST, where an integer column can come back as
 * a string — so it is read rather than trusted, and anything unreadable is
 * 'none' rather than NaN. A zero is kept and priced: a session filed at nought
 * is a real filing (a comped hour, a make-good) and is not the same as no
 * filing, which is what `NONE` is for.
 */
export function sessionRate(
  rateCents: number | string | null | undefined,
  rateCurrency: string | null | undefined,
): SessionRate {
  if (rateCents == null) return NONE;
  const cents = typeof rateCents === 'number' ? rateCents : Number(rateCents);
  if (!Number.isFinite(cents)) return NONE;
  const cur = (rateCurrency ?? '').trim();
  if (!cur) return UNSTATED;
  const amount = minorMoney(cents, cur);
  // `minorMoney` returns null for a currency it could make nothing of, and a
  // null here would leave a state of 'priced' with no figure under it. The row
  // stated something and it did not resolve, which is the same position as a row
  // that stated nothing: the figure cannot be read.
  return amount == null ? UNSTATED : { state: 'priced', amount, note: null };
}

/**
 * The standing line under a list of priced sessions.
 *
 * Printed once, by a screen that has drawn at least one figure. It exists
 * because the figure looks like a bill and is not one: Repple takes no PT
 * payment, and a member who reads a rate as an outstanding amount goes looking
 * for a way to pay it inside an app that has none.
 */
export const RATE_MEANING_NOTE =
  'This is what your coach recorded the session as being worth when they marked '
  + 'it delivered — not a bill, and not something to settle here.';
