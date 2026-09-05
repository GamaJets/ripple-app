// What one client has actually paid this coach, across every place the money
// was recorded.
//
// ── The figure that did not exist ─────────────────────────────────────────
//
// Nowhere in this app could a coach see that Ana has paid them £2,400 across
// eighteen months. `fetchClientPurchases` lists the sales, `fetchMySubscription
// Payments` lists the renewals, `fetchMyReceipts` lists the cash — three lists,
// three screens, no per-person total anywhere. So the decision a coach makes
// when somebody goes quiet, or asks for a discount, or is one of forty rows in
// a bulk tidy-up, is made without the one number that would change it.
//
// It is a sum of rows that already exist. It is not a projection, not a
// forecast, not "lifetime value" in the sense of a model — every figure here is
// money already charged or already handed over. The word "worth" on the screen
// means what they have paid, past tense, and `VALUE_IS_PAST` says so.
//
// ── THE RULE THAT MAKES OR BREAKS THIS FIGURE ─────────────────────────────
//
// **CASH IS NOT OPTIONAL.**
//
// A lifetime value computed from Stripe alone is wrong for most coaches, and it
// is wrong in the direction that makes them undervalue the person in front of
// them. `coach_receipts` (part 190) is the half of the book Stripe never saw —
// cash, bank transfers, and anything taken on a gym's front-desk terminal — and
// for most self-employed coaches card is the MINORITY of income. Leaving it out
// would not make this figure slightly low; it would make it a different number
// about a different business, and there is nothing on it that would say so.
//
// So a receipts read that did not come back whole withholds the TOTAL, exactly
// as a failed purchases read does. There is no "Stripe only" version of this
// figure with a footnote, because the footnote is not what a coach carries into
// the conversation — the number is.
//
// The counterweight, and it is stated on the screen rather than only here: a
// receipt and a Stripe sale can be the SAME money. A coach who records the cash
// deposit for a pack whose balance Stripe also took has two rows describing one
// payment, they share no key, and nothing in this app can detect it.
// `RECEIPT_MAY_DOUBLE_COUNT` in src/lib/coachReceipts.ts is the sentence for
// that and this module does not repeat it — it points at it.
//
// ── MONEY THAT CAME BACK ──────────────────────────────────────────────────
//
// This is the ONE figure in this app that is net of refunds, and the exception
// is deliberate rather than an oversight in the other direction.
//
// `paidOnly` below reads like the guard for it and is not. Verified against the
// live schema on 5 Sep 2026: `client_purchases.status` is `text not null
// default 'paid'`, the only writer in the repo is the checkout branch of
// supabase/functions/stripe-webhook, which hardcodes `'paid'`, and NOTHING
// anywhere writes `'refunded'`. A refund is mirrored into `refunded_cents` /
// `refunded_at` (part 192) by supabase/functions/connect-refund and by the
// `charge.refunded` branch of the webhook, and the row's status is left alone
// on purpose — a refunded sale is still a sale that happened. So the allowlist
// never excluded anything, and the docstring promising it did was describing a
// status this database has never held.
//
// The cost of that was Ana buying a ten-pack for AED 2,400, being refunded in
// full, and still reading as the coach's most valuable client on the one screen
// that tells them to make a retention decision from this figure.
//
// So the sale is netted, not dropped: `keptCents` takes `refunded_cents` off
// `amount_cents` and floors at nought. A PARTIAL refund reduces the figure by
// what went back and leaves the rest standing, which is the whole reason a
// running total is the right shape for it; a FULL refund leaves a payment
// worth nothing rather than a payment that never happened. The row still
// counts in `payments`, still dates `firstAt`/`lastAt`, and what went back is
// reported beside the figure by `refundedLine` — because a coach reading
// "3 payments" over a smaller number than they expected is owed the reason,
// and because the money did move, twice.
//
// ── AND THE TAKINGS FIGURES ARE STILL GROSS ───────────────────────────────
//
// Nothing here changes them and nothing here may. `app/(trainer)/payments.tsx`
// carries the policy at length: every takings line in this app is what a client
// was CHARGED, a refund is shown BESIDE the sale rather than silently inside
// it, and `Purchase.refunded_cents` in src/lib/connect.ts says in as many words
// that `sumTaken` is not given the net figure. That policy is about "what came
// through my business this month". This module asks a different question —
// "what has this person paid me and not had back" — and it is the question a
// coach answers a retention decision with. `VALUE_IS_NET_OF_REFUNDS` says so on
// the screen, because two figures on one page that are arrived at differently
// have to say which is which.
//
// ── And the rules it inherits ─────────────────────────────────────────────
//
//   · currencies never merge. A client who paid in AED and once in GBP has two
//     pots, and there is no single figure for them. `sumTaken` already refuses
//     this and `combineTaken` refuses it across sources.
//   · an amount with no currency is counted, never dropped and never summed.
//   · zero-decimal currencies are not divided by a hundred. Nothing here
//     formats anything — `minorMoney` does, and it knows.
//   · a subtotal is never printed as a total. `ledger()` in coachLedger.ts is
//     the composition and it returns `total: null` unless every contributing
//     read was whole.
//
// Pure — the reads live in connect.ts, subscriptions.ts and ui/coachReceipts.ts.
import type { LoadStatus } from '../ui/loadStatus';
import { worstStatus } from '../ui/loadStatus';
import { sumTaken, combineTaken, minorMoney, type Taken, type TakenRow } from './coachMoney';
import { ledger, type Ledger, type Strand } from './coachLedger';
import { num } from './format';

/* ── the three sources, in the one shape that can be added ────────────────── */

/** One one-off sale, as `fetchClientPurchases` hands it back. */
export interface ValuePurchase {
  client_id: string | null;
  amount_cents: number | null;
  currency: string | null;
  created_at: string;
  /** Stripe's word. Only 'paid' is money; see `paidOnly`. It is NOT how a
   *  refund is recorded — nothing writes 'refunded' here; see `keptCents`. */
  status: string | null;
  /**
   * Minor units already given back on this sale, as a RUNNING TOTAL across
   * every refund on it (part 192).
   *
   * Zero, never null, on a sale nobody has refunded — the column is `not null
   * default 0` and only supabase/functions/connect-refund and the webhook's
   * `charge.refunded` branch write it, from Stripe's own answer. Optional and
   * string-tolerant here for the same two reasons `refundableRow` in
   * src/lib/refunds.ts is: it is a `bigint`, which PostgREST can hand back as a
   * string, and a caller reading a narrower column set has none.
   */
  refunded_cents?: number | string | null;
}

/** One paid renewal invoice, as `fetchMySubscriptionPayments` hands it back. */
export interface ValueRenewal {
  client_id: string | null;
  amount_cents: number | null;
  currency: string | null;
  /** When Stripe says the money moved. Null when Stripe stated none — the
   *  payment is real and belongs to no month anybody can name. */
  paid_at: string | null;
  created_at: string;
  /** The same running total, on the same terms, for a renewal
   *  (`client_subscription_payments.refunded_cents`, part 192). A coach
   *  refunding "last month" is refunding one of these, and a figure that netted
   *  one-off sales while leaving renewals gross would be the same defect
   *  half-fixed. */
  refunded_cents?: number | string | null;
}

/** One recorded cash/transfer payment, as `fetchMyReceipts` hands it back. */
export interface ValueReceipt {
  clientId: string | null;
  amountCents: number | null;
  currency: string | null;
  /** 'YYYY-MM-DD', the day the coach says the money arrived. */
  receivedOn: string;
}

/**
 * Only the sales that are money.
 *
 * `client_purchases.status` carries Stripe's own word, and a row that is
 * 'pending' or 'failed' is not a payment. The old instinct here is `status !==
 * 'refunded'`, which is a denylist and is wrong the first time Stripe adds a
 * status — the new one would count as income by default. Only 'paid' counts.
 *
 * A null status is NOT counted. Every row the webhook writes carries one, so a
 * null is a row from somewhere else or a row that never completed, and a
 * payment nobody can confirm should not appear in what somebody is worth.
 *
 * ── WHAT THIS DOES NOT DO, AND USED TO CLAIM IT DID ───────────────────────
 *
 * It does not exclude a refunded sale, and it never could. This docstring said
 * "a row that is 'pending', 'failed' or 'refunded' is not a payment", and
 * 'refunded' is a status this database has never held: verified live, the
 * column is `text not null default 'paid'`, the only writer in the repo
 * hardcodes `'paid'`, and a refund is mirrored into `refunded_cents` /
 * `refunded_at` instead — deliberately, so a refunded sale is still a sale that
 * can be listed. So every AED of a fully refunded ten-pack went on counting as
 * money the client had paid.
 *
 * The refund arithmetic is `keptCents`, below, and it is applied to the AMOUNT
 * rather than to the row. This stays an allowlist over the status because that
 * is still the right guard for a pending or failed checkout, and because a
 * status Stripe adds tomorrow must not become income by default.
 */
export const paidOnly = <T extends { status: string | null }>(rows: readonly T[]): T[] =>
  rows.filter((r) => (r.status || '').trim().toLowerCase() === 'paid');

/**
 * `refunded_cents` as a number of minor units — 0 for anything that is not one.
 *
 * A `bigint` reaches a phone as a string often enough that src/lib/refunds.ts
 * carries the same coercion and says why. A negative or unparseable value is
 * read as no refund rather than as a credit: nothing may ever ADD to what
 * somebody paid by way of this column.
 */
const refundedMinor = (v: number | string | null | undefined): number => {
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};

/**
 * What is left of one charge after what has gone back on it — minor units.
 *
 * Null in, null out: an amount Stripe never stated is still an amount nobody
 * can put a figure on, and a refund against it does not make it nought. It
 * stays `unpriced` in the total, exactly as before.
 *
 * Floored at nought, and that floor is not decoration. `sumTaken` has no notion
 * of a negative pot and no screen in this app renders one, so a row that
 * somehow claimed more back than was charged would otherwise print a coach a
 * client who has paid them minus four hundred pounds. The database's
 * `client_purchases_refund_within_charge` constraint should make it
 * unreachable; "should be unreachable" is how the last such figure got out.
 *
 * NOTHING HERE DIVIDES BY A HUNDRED. Both sides are minor units in the same
 * currency — one subtraction of two integers — so the number of decimal places
 * that currency has never enters into it. `currencyDecimals()` returns null
 * rather than 2 for a currency nobody stated, and the only place that matters
 * is formatting, which is `minorMoney`'s job and not this one's.
 */
export function keptCents(
  amountCents: number | null | undefined,
  refundedCents: number | string | null | undefined,
): number | null {
  if (amountCents == null || !Number.isFinite(amountCents)) return null;
  return Math.max(0, Math.trunc(amountCents) - refundedMinor(refundedCents));
}

/* ── one client ───────────────────────────────────────────────────────────── */

export interface ClientValue {
  clientId: string;
  /** What Stripe took as one-off sales. */
  sales: Taken;
  /** What Stripe took as renewals. */
  renewals: Taken;
  /** What the coach recorded as cash, transfer or a terminal elsewhere. */
  recorded: Taken;
  /**
   * What has gone back out of `sales` and `renewals`, per currency.
   *
   * Already subtracted from all three figures above and from `ledger` — this is
   * the size of the subtraction, kept so the screen can say it happened rather
   * than quietly showing a smaller number. Empty pots on a client nobody has
   * refunded, which is nearly everybody.
   *
   * A recorded cash payment can never appear here: `coach_receipts` has no
   * refund column, a coach handing cash back records it as a cost or not at
   * all, and inventing a refund for it would be this app asserting something
   * nobody told it. `VALUE_NEEDS_YOUR_RECORDS` already says the cash half is
   * only as good as what was written down.
   */
  refunded: Taken;
  /**
   * All three together — or withheld, with the reason.
   *
   * `total` is null unless EVERY contributing read was whole, including the
   * receipts. See the header for why the cash half is not optional.
   */
  ledger: Ledger;
  /** How many payments are behind the figure, across all three sources. Counted
   *  even where the total is withheld: "we could not total 14 payments" is a
   *  more useful sentence than "we could not total your payments".
   *
   *  A refunded sale is still counted. The money moved — twice — and the date
   *  it moved on is what makes this a LIFETIME rather than a period; dropping
   *  the row would silently move `firstAt` and shorten a relationship that
   *  really did start then. `refundedLine` is what keeps the count and a
   *  smaller figure from reading as a contradiction. */
  payments: number;
  /** The earliest payment on record, ISO, or null. What makes it a LIFETIME
   *  rather than a period. */
  firstAt: string | null;
  /** The most recent, ISO, or null. */
  lastAt: string | null;
}

/** A payment reduced to what a total depends on. `at` is the date the money
 *  moved and never the date the row was written — a webhook retried three days
 *  late, or a coach writing up three weeks of cash on a Sunday, must not shift
 *  when somebody paid. */
const row = (amount_cents: number | null, currency: string | null, at: string): TakenRow =>
  ({ amount_cents, currency, created_at: at });

/**
 * Everything one client has paid, from all three sources.
 *
 * The three statuses are passed separately because they are three separate
 * reads that fail independently, and the whole job of `ledger()` is to refuse a
 * total when any one of them did. Callers that genuinely have no receipts read
 * must pass 'error' rather than 'ready' with an empty array — an absent read is
 * not an empty one, and this is the figure where that difference decides
 * whether a coach undervalues somebody by two thirds.
 */
export function clientValue(
  clientId: string,
  purchases: readonly ValuePurchase[],
  renewals: readonly ValueRenewal[],
  receipts: readonly ValueReceipt[],
  status: { purchases: LoadStatus; renewals: LoadStatus; receipts: LoadStatus },
): ClientValue {
  const mySales = paidOnly(purchases).filter((p) => p.client_id === clientId);
  const myRenewals = renewals.filter((r) => r.client_id === clientId);
  const myReceipts = receipts.filter((r) => r.clientId === clientId);

  // NET OF WHAT WENT BACK. `keptCents` is the whole of the refund handling and
  // it is applied here rather than by dropping rows: the sale still happened,
  // still counts as a payment and still dates the relationship. See MONEY THAT
  // CAME BACK at the top — and note that this is the ONE figure in this app
  // that is not gross, which `VALUE_IS_NET_OF_REFUNDS` states on the screen.
  const saleRows = mySales.map((p) => row(keptCents(p.amount_cents, p.refunded_cents), p.currency, p.created_at));
  // `paid_at` is Stripe's word on when the money moved; `created_at` is when
  // the webhook wrote the row. The fallback is deliberate and is the lesser
  // wrong: without it a renewal Stripe stated no date for would have no date at
  // all, and this figure's `firstAt`/`lastAt` would silently skip it.
  const renewalRows = myRenewals.map((r) => row(keptCents(r.amount_cents, r.refunded_cents), r.currency, r.paid_at || r.created_at));
  const receiptRows = myReceipts.map((r) => row(r.amountCents, r.currency, r.receivedOn));

  // The size of the subtraction, dated by the CHARGE rather than by
  // `refunded_at`. Nothing here is a period figure — this module is all-time —
  // and the charge's date is the one both sides of the pair already agree on;
  // `refunded_at` is only the LAST refund on a sale that may have had several,
  // which is a date this app is careful never to present as the only one.
  //
  // Rows with nothing back are filtered out before summing, so a client nobody
  // has refunded gets empty pots rather than a pot of noughts — `refundedLine`
  // is null on empty pots and a "refunded AED 0.00" line under every client is
  // the furniture `unattributedLine` refuses for the same reason.
  const refunded = sumTaken([
    ...mySales
      .filter((p) => refundedMinor(p.refunded_cents) > 0)
      .map((p) => row(refundedMinor(p.refunded_cents), p.currency, p.created_at)),
    ...myRenewals
      .filter((r) => refundedMinor(r.refunded_cents) > 0)
      .map((r) => row(refundedMinor(r.refunded_cents), r.currency, r.paid_at || r.created_at)),
  ]);

  const sales = sumTaken(saleRows);
  const renewalsTaken = sumTaken(renewalRows);
  const recorded = sumTaken(receiptRows);

  const strands: Strand[] = [
    { key: 'sales', label: 'one-off sales', status: status.purchases, taken: sales },
    { key: 'renewals', label: 'renewals', status: status.renewals, taken: renewalsTaken },
    // Named for what a coach calls it rather than for the table. "Receipts" is
    // this app's word; "cash and transfers" is theirs, and the reason sentence
    // this label lands in is one they have to act on.
    { key: 'recorded', label: 'cash and transfers', status: status.receipts, taken: recorded },
  ];

  const times = [...saleRows, ...renewalRows, ...receiptRows]
    .map((r) => Date.parse(r.created_at))
    .filter((n) => Number.isFinite(n));

  return {
    clientId,
    sales,
    renewals: renewalsTaken,
    recorded,
    refunded,
    ledger: ledger(strands),
    payments: saleRows.length + renewalRows.length + receiptRows.length,
    firstAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    lastAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
  };
}

/* ── the whole book, ranked ───────────────────────────────────────────────── */

export interface RankedClient {
  clientId: string;
  /** Whatever name the caller holds. Null renders as a dash — the money beside
   *  it is still real. */
  name: string | null;
  value: ClientValue;
}

/**
 * Every client who has ever paid, biggest first.
 *
 * ── Why the ranking is per currency and not one list ──────────────────────
 *
 * Sorting a mixed-currency book by "amount" would put AED 5,000 above GBP 900
 * because five thousand is more than nine hundred, and the order would be a
 * fact about exchange rates nobody supplied. So the ranking is over ONE
 * currency at a time — `currency` says which — and a coach with two currencies
 * gets two lists rather than one wrong one.
 *
 * Clients whose figure is in a different currency are still returned, at the
 * bottom, with a zero pot for this currency. They are NOT dropped: a client
 * missing from a list headed "what your clients have paid you" reads as a
 * client who has paid nothing.
 */
export function rankByValue(rows: readonly RankedClient[], currency: string): RankedClient[] {
  const cur = currency.trim().toUpperCase();
  const potOf = (r: RankedClient): number =>
    r.value.ledger.total?.pots.find((p) => p.currency === cur)?.minorUnits ?? -1;
  return [...rows].sort((a, b) => {
    const pa = potOf(a); const pb = potOf(b);
    if (pa !== pb) return pb - pa;
    return (a.name || '').localeCompare(b.name || '');
  });
}

/**
 * Which currencies this book has been paid in at all.
 *
 * Returned so a screen can say "you have been paid in two currencies and they
 * are not added together" rather than silently picking the first. Sorted by
 * total so the coach's main one leads.
 */
export function currenciesIn(rows: readonly RankedClient[]): string[] {
  const by = new Map<string, number>();
  for (const r of rows) {
    const t = r.value.ledger.total;
    if (!t) continue;
    for (const p of t.pots) by.set(p.currency, (by.get(p.currency) ?? 0) + p.minorUnits);
  }
  return [...by.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0])).map(([c]) => c);
}

/* ── receipts nobody can attribute ────────────────────────────────────────── */

/**
 * Recorded payments with no client account behind them.
 *
 * `coach_receipts.client_id` is nullable on purpose — most cash comes from
 * somebody the coach bills by hand, with a name they typed and no Repple
 * account. Those payments are real income and cannot be attributed to any row
 * in this list, so they are COUNTED and reported rather than dropped. A screen
 * that showed only the attributable ones would be a per-client breakdown that
 * silently omits most of the cash, which is the same defect this whole module
 * exists to close, one level down.
 */
export function unattributedReceipts(receipts: readonly ValueReceipt[]): { count: number; taken: Taken } {
  const orphan = receipts.filter((r) => !r.clientId);
  return {
    count: orphan.length,
    taken: sumTaken(orphan.map((r) => row(r.amountCents, r.currency, r.receivedOn))),
  };
}

/**
 * The sentence for them.
 *
 * Null when there are none — a "0 unattributed" line under every screen is
 * furniture, and the line that matters would be lost in it.
 *
 * ── THE STATUS IS NOT OPTIONAL ────────────────────────────────────────────
 *
 * This took a bare count and stated it as a fact. Under a receipts read that
 * came back TRUNCATED, every per-client amount above it correctly dashed —
 * `ledger()` withholds a total the moment a strand is not whole — and then this
 * line said flatly "330 recorded payments are not attached to anybody's
 * account". A number counted over a prefix of the data, printed as the whole of
 * it, on the one line on the screen that was still confidently stating a
 * figure. Whatever the true number is, it is not smaller than 330, so the count
 * is worth keeping; what it is not is a total.
 *
 * So a whole read states it and anything else states it as a floor, in the same
 * words `paymentsFloorLine` uses in this file for the same shape of fact. The
 * distinction between "we counted them" and "we counted the ones we could see"
 * is exactly the one app/(owner)/financials.tsx keeps four silences apart for.
 */
export function unattributedLine(count: number, status: LoadStatus): string | null {
  if (count <= 0) return null;
  const one = count === 1;
  const what = `recorded ${one ? 'payment is' : 'payments are'} not attached to anybody's account`;
  const why = 'cash from somebody you bill by hand has a name you typed and no Repple client behind it.';
  const outside = `${one ? 'It is' : 'They are'} real income and ${one ? 'it is' : 'they are'} not in any of the per-client figures here.`;
  if (status === 'ready') return `${num(count)} ${what} — ${why} ${outside}`;
  // Truncated, failed or still in flight, the sentence is the same shape: the
  // count is a floor. Which of the three it was is already said, once, by the
  // reason under every per-client figure on the screen — repeating it here
  // would be the third statement of one fact.
  return `At least ${num(count)} ${what} — ${why} The record of your cash and transfers did not come back whole, so that is a floor and not a count. ${outside}`;
}

/* ── what the figure is, said on the screen ───────────────────────────────── */

/**
 * That this is the past and not a forecast.
 *
 * "Lifetime value" means a projection almost everywhere else it is written, and
 * a coach who reads this as one will make a decision about a client on the
 * strength of a number this app has not calculated and could not.
 */
export const VALUE_IS_PAST =
  'This is money already paid, added up. It is not a forecast of what somebody will be worth, and nothing here has been projected forward — a client who paid you every month for a year and stopped in March shows the year and says nothing about April.';

/**
 * That the cash half depends on the coach having written it down.
 *
 * The figure is only as complete as the coach's own record-keeping, and that is
 * a fact about them rather than about the app — so it is said plainly, next to
 * the way to fix it.
 */
export const VALUE_NEEDS_YOUR_RECORDS =
  'Cash, bank transfers and anything taken on a terminal only count here once you have recorded them. Until you do, every figure on this screen is a floor rather than what somebody has actually paid you.';

/**
 * That two rows can be one payment.
 *
 * Points at the receipts screen's own sentence rather than restating it, so
 * there is one wording of this warning in the app.
 */
export const VALUE_IS_NET_OF_REFUNDS =
  'A refund is taken off the figure for the person it went back to. It is the one place in this app where that happens: every takings line is gross — what a client was charged — because that is what takings have always meant here, and what somebody has paid you and not had back is a different question. This section asks that one.';

/**
 * What has gone back, beside the figure it has already come off.
 *
 * Said rather than left implicit, because a netted figure with nothing on it to
 * say so is the same defect as a gross one: a coach reading "3 payments" over a
 * number smaller than the three payments they remember has no way to tell a
 * refund from a bug, and the sentence they would reach for is "this app has
 * lost money of mine".
 *
 * Null on the overwhelming majority of clients — nobody has refunded them
 * anything — and null too where the only refund is against a sale whose
 * currency was never recorded. That refund has come off an amount that is in no
 * pot either way, and the screen already reports those as a hole in the figure;
 * naming an amount in a unit nobody stated is the one thing this app will not
 * do anywhere.
 */
export function refundedLine(v: ClientValue): string | null {
  const parts = v.refunded.pots
    .map((p) => minorMoney(p.minorUnits, p.currency))
    .filter((s): s is string => !!s);
  if (!parts.length) return null;
  const amounts = parts.join(' and ');
  return parts.length === 1
    ? `${amounts} has been given back and is already off the figure above.`
    : `${amounts} have been given back and are already off the figure above.`;
}

export const VALUE_MAY_DOUBLE_COUNT =
  'A payment recorded by hand that Stripe also took is counted twice here. The two rows share nothing this app can read, so nothing can spot it — record only what did not go through Repple.';

/**
 * The number of payments, ONLY when every read behind it was whole.
 *
 * `payments` on the value is a count of the rows that arrived, and it is
 * counted deliberately even where the total is withheld — "we could not total
 * 14 payments" is a better sentence than "we could not total your payments".
 * That is right for a SENTENCE and wrong for a figure in a KPI row, which is
 * where app/(trainer)/client.tsx was printing it: "Payments 4" sat inches from
 * "Worth —", so the dash read as "we cannot price these four" rather than "we
 * do not know there were four". A coach deciding whether to chase somebody for
 * money read four payments as a fact about a paying client, when it was four
 * rows out of an unknown number.
 *
 * Null is the dash. The count survives, in `paymentsFloorLine` below, where it
 * is stated as the floor it is.
 */
export const paymentsCounted = (v: ClientValue): number | null =>
  (v.ledger.status === 'ready' ? v.payments : null);

/**
 * The count as a floor, for the sentence under a withheld total.
 *
 * Null when the ledger is whole — the KPI has already said it — and null when
 * nothing arrived at all, because "at least 0 payments" is not a sentence.
 */
export function paymentsFloorLine(v: ClientValue): string | null {
  if (v.ledger.status === 'ready' || v.payments === 0) return null;
  return v.payments === 1
    ? 'At least 1 payment is on record. One of the reads behind this did not come back whole, so that is a floor and not a count.'
    : `At least ${num(v.payments)} payments are on record. One of the reads behind this did not come back whole, so that is a floor and not a count.`;
}

/**
 * What to say where a client's total would have gone.
 *
 * Never "they have paid you nothing" over a read that did not complete. On this
 * screen that sentence is not merely wrong, it is the sentence that decides how
 * hard a coach fights to keep somebody.
 */
export function valueEmptyLine(v: ClientValue): string {
  if (v.ledger.status === 'ready' && v.payments === 0) {
    return 'Nothing has been recorded as paid to you by this person. If they pay you in cash or by transfer, record it and it will show here.';
  }
  return v.ledger.reason
    ?? 'Nothing is stated, and that is not a statement that they have paid you nothing.';
}

/**
 * The same thing for the WHOLE BOOK, where there is no person to point at.
 *
 * `app/(trainer)/money.tsx` had no such sentence and reached for the per-client
 * one, through `valueEmptyLine(clientValue('', [], [], [], reads))` — so the
 * first thing a coach with no clients yet read on the section headed "What Each
 * Client Has Paid" was "Nothing has been recorded as paid to you by this
 * person", with no person anywhere on the screen. Every money table in this
 * database is empty today, verified live, which makes that empty state the one
 * nearly every coach sees first.
 *
 * The WITHHELD branches are deliberately not rewritten: "the read failed" and
 * "there is more than could be read in one request" say the same thing about a
 * book as about a person, and `ledger()` already words them. Only the confident
 * one — the sentence that asserts nothing was paid — has to know it is talking
 * about a book, and it is the parallel of the per-client one rather than a new
 * wording of it.
 */
export function valueBookEmptyLine(status: { purchases: LoadStatus; renewals: LoadStatus; receipts: LoadStatus }): string {
  const v = clientValue('', [], [], [], status);
  if (v.ledger.status === 'ready' && v.payments === 0) {
    return 'Nothing has been recorded as paid to you by anybody yet. If a client pays you in cash or by transfer, record it and it will show here.';
  }
  return valueEmptyLine(v);
}

/** How long they have been paying, in the coach's words. Null when there is no
 *  first payment to date it from. */
export function valueSpanLine(v: ClientValue, now: Date): string | null {
  if (!v.firstAt) return null;
  const first = Date.parse(v.firstAt);
  if (!Number.isFinite(first)) return null;
  const months = Math.max(0, Math.floor((now.getTime() - first) / (30.436875 * 86_400_000)));
  const what = `${num(v.payments)} ${v.payments === 1 ? 'payment' : 'payments'}`;
  if (months < 1) return `${what}, the first of them this month.`;
  if (months < 12) return `${what} across ${num(months)} ${months === 1 ? 'month' : 'months'}.`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const span = rest === 0
    ? `${num(years)} ${years === 1 ? 'year' : 'years'}`
    : `${num(years)} ${years === 1 ? 'year' : 'years'} and ${num(rest)} ${rest === 1 ? 'month' : 'months'}`;
  return `${what} across ${span}.`;
}

/**
 * The worst of the three reads, for a screen that wants one status.
 *
 * Exported rather than left to each caller's `worstStatus(a, b, c)` because the
 * SET is the thing that must not change: a caller that composed two of the
 * three would produce a status that says the figure is trustworthy while the
 * cash half is unread, which is precisely the failure this module is about.
 */
export function valueStatus(s: { purchases: LoadStatus; renewals: LoadStatus; receipts: LoadStatus }): LoadStatus {
  return worstStatus(s.purchases, s.renewals, s.receipts);
}
