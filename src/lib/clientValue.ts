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
import { sumTaken, combineTaken, type Taken, type TakenRow } from './coachMoney';
import { ledger, type Ledger, type Strand } from './coachLedger';
import { num } from './format';

/* ── the three sources, in the one shape that can be added ────────────────── */

/** One one-off sale, as `fetchClientPurchases` hands it back. */
export interface ValuePurchase {
  client_id: string | null;
  amount_cents: number | null;
  currency: string | null;
  created_at: string;
  /** Stripe's word. Only 'paid' is money; see `paidOnly`. */
  status: string | null;
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
 * 'pending', 'failed' or 'refunded' is not a payment. The old instinct here is
 * `status !== 'refunded'`, which is a denylist and is wrong the first time
 * Stripe adds a status — the new one would count as income by default. Only
 * 'paid' counts.
 *
 * A null status is NOT counted. Every row the webhook writes carries one, so a
 * null is a row from somewhere else or a row that never completed, and a
 * payment nobody can confirm should not appear in what somebody is worth.
 */
export const paidOnly = <T extends { status: string | null }>(rows: readonly T[]): T[] =>
  rows.filter((r) => (r.status || '').trim().toLowerCase() === 'paid');

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
   * All three together — or withheld, with the reason.
   *
   * `total` is null unless EVERY contributing read was whole, including the
   * receipts. See the header for why the cash half is not optional.
   */
  ledger: Ledger;
  /** How many payments are behind the figure, across all three sources. Counted
   *  even where the total is withheld: "we could not total 14 payments" is a
   *  more useful sentence than "we could not total your payments". */
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

  const saleRows = mySales.map((p) => row(p.amount_cents, p.currency, p.created_at));
  // `paid_at` is Stripe's word on when the money moved; `created_at` is when
  // the webhook wrote the row. The fallback is deliberate and is the lesser
  // wrong: without it a renewal Stripe stated no date for would have no date at
  // all, and this figure's `firstAt`/`lastAt` would silently skip it.
  const renewalRows = myRenewals.map((r) => row(r.amount_cents, r.currency, r.paid_at || r.created_at));
  const receiptRows = myReceipts.map((r) => row(r.amountCents, r.currency, r.receivedOn));

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

/** The sentence for them. Null when there are none — a "0 unattributed" line
 *  under every screen is furniture, and the line that matters would be lost in
 *  it. */
export function unattributedLine(count: number): string | null {
  if (count <= 0) return null;
  return `${num(count)} recorded ${count === 1 ? 'payment is' : 'payments are'} not attached to anybody's account — cash from somebody you bill by hand has a name you typed and no Repple client behind it. ${count === 1 ? 'It is' : 'They are'} real income and ${count === 1 ? 'it is' : 'they are'} not in any of the per-client figures here.`;
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
export const VALUE_MAY_DOUBLE_COUNT =
  'A payment recorded by hand that Stripe also took is counted twice here. The two rows share nothing this app can read, so nothing can spot it — record only what did not go through Repple.';

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
