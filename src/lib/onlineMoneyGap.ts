// Money Stripe took that this gym's ledger does not hold.
//
// ── what `gym_orders.status = 'failed'` actually means ────────────────────
//
// Not a declined card. supabase/parts/281 defines the four states and says it
// in one line:
//
//   'failed'  Stripe took the money and the entitlement could not be written.
//
// And `supabase/functions/stripe-webhook` gates the LEDGER write on the same
// condition — `if (!problem)` wraps the `gym_payments` insert, and the `failed`
// mark is written in the branch where `problem` is set. So a failed order is
// money that ARRIVED at Stripe, produced no membership or pass for the member,
// and never reached `gym_payments`.
//
// That matters because `gym_payments` is the only table /revenue, /money,
// /accounting and /close count. A failed order is therefore invisible in every
// takings figure in the product, and it is invisible in the one direction that
// costs the gym twice: the member has paid and holds nothing, and the owner has
// no figure anywhere telling them it happened.
//
// ── why it is NEVER netted against takings ───────────────────────────────
//
// Two reasons, and the weaker one is the obvious one.
//
//   · It is not a negative sale. Nothing has been refunded and nothing has been
//     reversed; a reversal is a ROW (supabase/parts/180) and there is no such
//     row here. Subtracting it would invent one.
//   · It is not in the takings figure to begin with, so it cannot be netted
//     out of it — and ADDING it would be just as wrong, because "taken" on that
//     screen means "somebody recorded receiving it" and nobody did. These are
//     two different facts about two different piles of money, and they belong
//     in two different sentences.
//
// ── the second, quieter half ─────────────────────────────────────────────
//
// A 'paid' order with `inLedger` false is the same shortfall arriving by a
// different route: the entitlement WAS written, the member holds what they
// bought, and the `gym_payments` insert was refused — most often because the
// owner had already closed the month the sale landed in. The webhook logs it
// and closes the order as paid.
//
// Kept as a SEPARATE side rather than added to the first, because the two need
// opposite actions: an unfulfilled order needs somebody to give a paying member
// what they bought, and an unledgered one needs somebody to reopen a month and
// record a payment. A single combined figure would be a number an owner cannot
// act on.
//
// ── the currency rules are the existing ones ─────────────────────────────
//
// `sharedCurrency` decides what a set of rows is denominated in and `totalMoney`
// decides which silence a missing answer is. Both are imported rather than
// restated: a rule about money that exists twice will eventually be two rules,
// which is the sentence both of those files already carry.
//
// Pure: no react, no supabase client, no clock, no formatting.
import { sharedCurrency, normaliseCurrency } from './gymRecord';
import { totalMoney, type TotalGap } from './sumCurrency';

/**
 * The four fields of an online order this module reads.
 *
 * Structural, so `OnlineOrder` from src/lib/gymRecord.ts satisfies it without
 * this module depending on the whole of that interface — and so a test can
 * build a row by hand.
 */
export interface OrderLike {
  status: string;
  amountCents: number | null;
  currency: string | null;
  /** Whether a `gym_payments` row names this order. See part 480. */
  inLedger: boolean;
}

/** One pile of money that did not reach the ledger. */
export interface MoneyGapSide {
  /** Orders in this state, whatever currency and whether or not their amount
   *  could be read. A count is always stateable; a total is not. */
  count: number;
  /**
   * Minor units across the orders whose amount AND currency both read, or null
   * when there is no single figure — no such orders, or they do not agree on a
   * currency. Null is never zero here: these are orders Stripe charged, so a
   * zero would claim the gym is missing nothing.
   */
  cents: number | null;
  /** What `cents` is in, or null when it must be withheld. */
  currency: string | null;
  /** Which silence a null `cents` is, from `totalMoney`. */
  gap: TotalGap;
  /**
   * Orders in this state whose amount or currency could not be read, and which
   * are therefore counted and NOT summed. `gym_orders.amount_cents` and
   * `.currency` are both `not null`, so this should always be zero — it exists
   * because `fetchOnlineOrders` maps an unparseable amount to null rather than
   * throwing, and a row silently dropped from a shortfall figure is the one
   * thing this module must not do.
   */
  unstated: number;
}

export interface OnlineMoneyGap {
  /** Stripe charged, and the member holds nothing. Not in the ledger. */
  unfulfilled: MoneyGapSide;
  /** Stripe charged, the member holds what they bought, and the ledger has no
   *  row for it. */
  unledgered: MoneyGapSide;
  /** True when either side has at least one order. The screen's gate for
   *  showing any of this at all — a gym with no online selling switched on has
   *  nothing here and should not be shown an empty warning. */
  any: boolean;
}

function side(rows: readonly OrderLike[], gymCurrency: string | null | undefined): MoneyGapSide {
  const stated = rows.filter(
    (r) => typeof r.amountCents === 'number'
      && Number.isFinite(r.amountCents)
      && normaliseCurrency(r.currency) !== null,
  );
  const unstated = rows.length - stated.length;
  // Null rather than 0 for an empty set, so `totalMoney` reports 'no_total' —
  // "nothing is being withheld, nothing was computed" — instead of a confident
  // zero shortfall. A gym missing nothing and a gym whose shortfall could not
  // be summed must not render the same.
  const sum = stated.length
    ? stated.reduce((a, r) => a + (r.amountCents as number), 0)
    : null;
  const t = totalMoney(sum, sharedCurrency(stated), gymCurrency);
  return {
    count: rows.length,
    // The figure survives only when `totalMoney` says it can be named. A sum
    // whose rows disagree on currency is a bigger number and not an amount.
    cents: t.gap === 'ok' ? sum : null,
    // Taken from `totalMoney` unchanged rather than nulled alongside `cents`,
    // because the two are not the same question. On 'unstated' it is already
    // null — there is no honest code for a figure whose rows disagree. On
    // 'no_total' it is the gym's own code, which is the money the DASH is in:
    // a side with nothing wrong on it still has a labelled empty tile rather
    // than an unlabelled one, and `totalMoney`'s own header argues that.
    currency: t.currency,
    gap: t.gap,
    unstated,
  };
}

/**
 * Both piles, from one read of `fetchOnlineOrders`.
 *
 * `orders` is that reader's output — paid and failed orders in the window.
 * `gymCurrency` is `tenants.currency`, and it is used for one thing only: to
 * label the DASH on a side with no orders in it, which is what `totalMoney`
 * returns the gym's own code for. It is never applied to a figure whose rows
 * stated something else.
 *
 * A caller holding a failed or still-loading read must not call this at all: an
 * empty array here is "no online sale in this window went wrong", which is the
 * sentence a refused read must never be allowed to print.
 */
export function onlineMoneyGap(
  orders: readonly OrderLike[],
  gymCurrency: string | null | undefined,
): OnlineMoneyGap {
  const unfulfilled = side(orders.filter((o) => o.status === 'failed'), gymCurrency);
  // `status === 'paid'` and not `!== 'failed'`. `fetchOnlineOrders` selects only
  // those two today, and a third status added to that read later — 'pending' and
  // 'abandoned' both already exist on the table — would otherwise be counted
  // here as money the gym is owed. Nobody was charged for an abandoned session.
  const unledgered = side(
    orders.filter((o) => o.status === 'paid' && !o.inLedger),
    gymCurrency,
  );
  return {
    unfulfilled,
    unledgered,
    any: unfulfilled.count > 0 || unledgered.count > 0,
  };
}

/**
 * The sentence that keeps these figures out of the takings figure.
 *
 * One wording in one place, for the reason `MIXED_CURRENCY_NOTE` gives: a rule
 * about money written twice becomes two rules. It names the direction of the
 * error, because both directions are available to a reader looking at two money
 * figures on one screen and the wrong one is very tempting — this money is
 * missing FROM the takings, and adding it in would report as received what
 * nobody has received.
 */
export const NOT_TAKINGS_NOTE =
  'This is not part of what your gym was paid and is not subtracted from it '
  + 'either. Stripe took this money, no payment record was written for it, and '
  + 'no figure on this screen counts it.';
