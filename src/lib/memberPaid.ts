// What a member has actually paid, across every place this app records it —
// and the four reads that have to land before any of it is a total.
//
// ── The figure the member could not see ───────────────────────────────────
//
// app/(client)/receipts.tsx totalled `gym_payments` and nothing else. That is
// the gym's own cash book, and it is one of FOUR places a member's money is
// recorded in this database:
//
//   gym_payments                  what the gym recorded taking at the desk
//   gym_passes.paid_cents         what a drop-in, guest pass or class pack cost
//   client_purchases              a pack or a one-to-one bought from a coach
//                                 through Repple, taken by Stripe
//   client_subscription_payments  each renewal of a coaching subscription
//
// The gym's own console has known this since src/lib/gymPaidTotal.ts: /members
// joins memberships, payments, passes, one-to-ones and packs into one figure.
// The person the money came OUT of was shown a quarter of it, on a screen whose
// heading says what they have paid, and the missing three quarters were exactly
// the parts a member is most likely to be querying — a pack they bought once,
// a subscription that has renewed eleven times.
//
// ── THE FIFTH SOURCE, WHICH IS NOT HERE AND CANNOT BE ─────────────────────
//
// `coach_receipts` (supabase/parts/190) is the coach's record of cash, bank
// transfers and card payments taken at a gym's front desk — for most
// self-employed coaches, the MAJORITY of what they are paid. It is missing from
// this module and it is not an oversight to be corrected later. Part 190's
// header settles it in a section titled "Why there is no client read policy":
// the table carries `coach_receipts_owner_read`, `using (coach_id = auth.uid())`
// and nothing else, and the argument is that a receipt is an unnumbered private
// bookkeeping line with no document behind it — the artefact for telling
// somebody "I have your money" is a `coach_invoices` row, which the coach hands
// over.
//
// So a member paying their coach in cash has money in this database that this
// screen may not read, and `PAID_EXCLUDES_CASH` is on the screen saying so. It
// is the difference between a figure that is short and a figure that is short
// and silent about it, and the member is the one person who can tell which
// payments are missing — they were there when they handed the cash over.
//
// ── The rules inherited, none of them optional ────────────────────────────
//
//   · FOUR READS, ONE TOTAL, ALL OR NOTHING. `ledger()` in coachLedger.ts is
//     the composition and it returns `total: null` unless every contributing
//     read came back WHOLE. A member reading three of their four sources added
//     together is reading a smaller number with nothing about it to doubt, on
//     the screen they would take to a dispute.
//   · 'partial' IS NOT 'ready'. PostgREST stops at 1000 rows in silence
//     (src/lib/rowCap.ts); a sum over a prefix is a subtotal wearing a total's
//     clothes. `isWhole` is the test and `ledger()` applies it.
//   · CURRENCIES NEVER MERGE. `sumTaken` pots by currency and this module never
//     unpots. A member who paid a Dubai gym in dirhams and a London coach in
//     pounds has two figures and no third one.
//   · AN AMOUNT WITH NO CURRENCY IS COUNTED, NEVER SUMMED, NEVER DROPPED. Same
//     for an amount that is absent altogether — `gym_passes.paid_cents` is
//     nullable and its own schema comment says null means "nobody recorded a
//     price", NOT that the pass was free.
//   · NOTHING HERE DIVIDES BY A HUNDRED. Every column above is minor units, the
//     arithmetic is integer addition within one currency, and how many minor
//     units make a whole one is `minorMoney`'s business at the point of
//     printing (there is no sen in a yen; there are a thousand fils in a dinar).
//
// ── Net of refunds, and saying so ─────────────────────────────────────────
//
// A pack bought and refunded in full is money the member does not have gone.
// `keptCents` (src/lib/clientValue.ts) takes `refunded_cents` off the charge and
// floors at nought, exactly as the coach's side of the same money does, so there
// is one implementation of that subtraction rather than two that can drift. What
// went back is returned separately in `refunded` so the screen can state the
// subtraction rather than silently showing a smaller number — a member reading
// "9 payments" over a figure they think is too small is owed the reason.
//
// Refunds apply to the two Stripe sources only. The gym's cash book and its
// passes have no refund column: a gym handing money back records it as another
// row or not at all (supabase/parts/800 is the write-up), and inventing a refund
// for them would be this app asserting something nobody told it.
//
// Pure — every read lives in src/lib/memberRecord.ts.
import type { LoadStatus } from '../ui/loadStatus';
import { minorMoney, sumTaken, type Taken, type TakenRow } from './coachMoney';
import { ledger, joinLabels, type Strand } from './coachLedger';
import { keptCents, paidOnly } from './clientValue';

/* ── the four sources, in the one shape that can be added ─────────────────── */

/** One payment the gym recorded taking, as `fetchMyPayments` hands it back. */
export interface PaidGymPayment {
  amountCents: number | null;
  currency: string | null;
  /** timestamptz — an instant. */
  takenAt: string;
}

/** One pass the member holds, as `fetchMyPasses` hands it back. */
export interface PaidPass {
  /** Null means NOBODY RECORDED A PRICE. It does not mean the pass was free,
   *  and `sumTaken` counts it as `unpriced` rather than adding a nought. */
  paidCents: number | null;
  currency: string | null;
  /** A bare 'YYYY-MM-DD'. Carried onto the row a total is built from and never
   *  parsed by this module — `sumTaken` adds amounts and does not read dates,
   *  and a bare date parsed as a UTC instant is the day before west of
   *  Greenwich (src/lib/localDate.ts). */
  issuedOn: string;
}

/** One one-off purchase from a coach, as `fetchMyCoachSales` hands it back. */
export interface PaidCoachSale {
  amountCents: number | null;
  currency: string | null;
  /** Stripe's own word. Only 'paid' is money — `paidOnly` is the allowlist. */
  status: string | null;
  /** Minor units already given back, a running total across every refund on
   *  this sale. A `bigint`, so PostgREST may hand it over as a string. */
  refundedCents?: number | string | null;
  createdAt: string;
}

/** One coaching renewal, as `fetchMyCoachRenewals` hands it back. */
export interface PaidCoachRenewal {
  amountCents: number | null;
  currency: string | null;
  refundedCents?: number | string | null;
  /** When Stripe says the money moved. Null when Stripe stated none. */
  paidAt: string | null;
  createdAt: string;
}

export interface PaidSources {
  payments: readonly PaidGymPayment[];
  passes: readonly PaidPass[];
  sales: readonly PaidCoachSale[];
  renewals: readonly PaidCoachRenewal[];
}

/** One `LoadStatus` per source. They are passed separately because they are
 *  four separate reads that fail independently, and refusing a total when any
 *  one of them did is the whole job of this module. A caller with no read for a
 *  source must pass 'error' rather than 'ready' with an empty array: an absent
 *  read is not an empty one. */
export interface PaidStatuses {
  payments: LoadStatus;
  passes: LoadStatus;
  sales: LoadStatus;
  renewals: LoadStatus;
}

/* ── the answer ───────────────────────────────────────────────────────────── */

/**
 * The four sources added, or withheld with the reason.
 *
 * Deliberately NOT the `Ledger` that `ledger()` returns, and the one difference
 * is the reason sentence. `Ledger.reason` is written in the coach's voice —
 * "Your renewals could not be read … a statement that you were paid nothing" —
 * because every caller of it until now was a coach's money screen. Said to the
 * member it is exactly backwards: they are the one who PAID. Re-voicing it here
 * rather than exposing the Ledger means nobody can render the wrong sentence by
 * reaching for the field that is already there.
 */
export interface PaidLedger {
  /** The least trustworthy of the four reads. */
  status: LoadStatus;
  /** Null unless all four were whole. Never a subtotal shown as a total. */
  total: Taken | null;
  /** Why there is no total, member-voiced, or null when there is one. */
  reason: string | null;
  /** Which sources were not whole, named so the member knows which part of
   *  their own money is missing rather than being told the screen is broken. */
  missing: string[];
}

export interface MemberPaid {
  /** What the gym recorded taking at the desk. */
  gym: Taken;
  /** What drop-ins, guest passes and class packs cost. */
  passes: Taken;
  /** Packs and one-to-ones bought from a coach through Repple. */
  sales: Taken;
  /** Coaching subscription renewals. */
  renewals: Taken;
  /**
   * What has come back out of `sales` and `renewals`, per currency.
   *
   * Already subtracted from those two and from the total — this is the SIZE of
   * the subtraction, kept so the screen can say it happened. Empty pots for
   * the overwhelming majority of members, who have never been refunded.
   */
  refunded: Taken;
  /** All four together, or withheld. */
  ledger: PaidLedger;
  /** How many payments are behind the figure, across all four sources. Counted
   *  even where the total is withheld: "we could not total 23 payments" is a
   *  more useful sentence than "we could not total your payments". A refunded
   *  payment still counts — the money moved, twice. */
  payments: number;
}

/** A row reduced to what a total depends on. `created_at` on `TakenRow` is the
 *  date the money MOVED and never the date the row was written: a webhook
 *  retried three days late, or a desk writing up a week of cash on a Sunday,
 *  must not shift when somebody paid. */
const row = (amount: number | null, currency: string | null, at: string): TakenRow =>
  ({ amount_cents: amount, currency, created_at: at });

/**
 * Everything this member has paid, from every source this app may read.
 *
 * The labels are the nouns the member's own sentence is built around, not the
 * table names: `ledger()` drops them straight into "Still reading …", and
 * "client_subscription_payments" is not a thing anybody has ever paid.
 */
export function memberPaid(src: PaidSources, status: PaidStatuses): MemberPaid {
  // NET OF WHAT CAME BACK, and netted on the AMOUNT rather than by dropping the
  // row: a refunded purchase is still a purchase that happened, still counts as
  // a payment, and its date is still a date the member's money moved.
  const saleRows = paidOnly(src.sales)
    .map((p) => row(keptCents(p.amountCents, p.refundedCents), p.currency, p.createdAt));
  // `paid_at` is Stripe's word on when the money moved and `created_at` is when
  // the webhook wrote the row. The fallback is the lesser wrong: without it a
  // renewal Stripe stated no date for would carry no date at all.
  const renewalRows = src.renewals
    .map((r) => row(keptCents(r.amountCents, r.refundedCents), r.currency, r.paidAt || r.createdAt));
  const gymRows = src.payments.map((p) => row(p.amountCents, p.currency, p.takenAt));
  const passRows = src.passes.map((p) => row(p.paidCents, p.currency, p.issuedOn));

  // Rows with nothing back are filtered out before summing, so a member nobody
  // has refunded gets empty pots rather than a pot of noughts — a line reading
  // "refunded AED 0.00" under every member is furniture that says nothing.
  const refunded = sumTaken([
    ...paidOnly(src.sales)
      .filter((p) => refundedMinor(p.refundedCents) > 0)
      .map((p) => row(refundedMinor(p.refundedCents), p.currency, p.createdAt)),
    ...src.renewals
      .filter((r) => refundedMinor(r.refundedCents) > 0)
      .map((r) => row(refundedMinor(r.refundedCents), r.currency, r.paidAt || r.createdAt)),
  ]);

  const gym = sumTaken(gymRows);
  const passes = sumTaken(passRows);
  const sales = sumTaken(saleRows);
  const renewals = sumTaken(renewalRows);

  const strands: Strand[] = [
    { key: 'payments', label: 'the payments your gym recorded', status: status.payments, taken: gym },
    { key: 'passes', label: 'your passes', status: status.passes, taken: passes },
    { key: 'sales', label: 'what you bought from a coach', status: status.sales, taken: sales },
    { key: 'renewals', label: 'your coaching renewals', status: status.renewals, taken: renewals },
  ];

  const l = ledger(strands);
  return {
    gym,
    passes,
    sales,
    renewals,
    refunded,
    ledger: { status: l.status, total: l.total, reason: paidReason(l.status, l.missing), missing: l.missing },
    payments: gymRows.length + passRows.length + saleRows.length + renewalRows.length,
  };
}

/**
 * `refunded_cents` as minor units — 0 for anything that is not a positive
 * number. A `bigint` reaches a phone as a string often enough that
 * src/lib/refunds.ts and src/lib/clientValue.ts both carry this coercion; a
 * negative or unparseable value reads as no refund, because nothing may ever
 * ADD to what somebody paid by way of this column.
 */
const refundedMinor = (v: number | string | null | undefined): number => {
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};

/**
 * Why there is no total, said to the person who paid.
 *
 * The three non-ready statuses get three different sentences because they ask
 * for three different things from the reader: wait, pull again, or understand
 * that the list below is a prefix. The one thing none of them may do is read as
 * "you have paid nothing" — that sentence, said over a failed read, on the
 * screen a member would take to a dispute, is the worst thing this screen could
 * print.
 */
export function paidReason(status: LoadStatus, missing: readonly string[]): string | null {
  if (status === 'ready') return null;
  const list = joinLabels([...missing]);
  if (status === 'loading') return `Still reading ${list}, so no total is stated yet.`;
  if (status === 'partial') {
    return `There is more on record under ${list} than could be read in one request, so no total is stated. Everything listed below is real; it is not all of it.`;
  }
  return `We couldn’t read ${list}, so no total is stated. That is a read that failed, not a statement that you paid nothing. Ask your gym for a statement if you need the figure today.`;
}

/* ── what the figure covers, said on the screen ───────────────────────────── */

/**
 * The cash a coach was handed, which this app may not show the person who
 * handed it over.
 *
 * On the screen and not only in this header, because a total that is silently
 * short is worse than one that is short and says which part is missing — and
 * the member is the only person who can supply the missing part from memory.
 */
export const PAID_EXCLUDES_CASH =
  'Cash or a bank transfer you gave a personal trainer directly is not here. Your trainer writes those into their own book, which this app keeps private to them, so this figure covers only money that went through your gym’s desk or through Repple. If you have paid a trainer another way, ask them for an invoice. That is the document they can hand you.';

/**
 * What a total over four sources is, and is not.
 *
 * Named separately from the sentence above because they answer different
 * questions: that one is about a source that is missing, this one is about how
 * the sources that are here were added.
 */
export const PAID_IS_EVERY_SOURCE =
  'This adds up your gym’s own record of what it took, anything you paid for a pass, and anything you bought from a personal trainer through the app. Amounts in different currencies are never added together. Each currency is its own figure, because there is no exchange rate in this app and a single number over two currencies would be a number in neither.';

/** Said where a refund has been made, beside the smaller figure it caused. A
 *  member reading a total lower than they expected is owed the reason before
 *  they go looking for a missing payment.
 *
 *  `minorMoney` rather than a formatter passed in, for the reason the header
 *  gives: the number of minor units in a whole one is a property of the
 *  currency, one module knows the answer, and a second one here is a second
 *  place to forget that a yen has no sen. */
export function refundedLine(t: Taken): string | null {
  if (!t.pots.length) return null;
  const parts = t.pots.map((p) => minorMoney(p.minorUnits, p.currency)).filter((s): s is string => !!s);
  if (!parts.length) return null;
  return `${joinLabels(parts)} has been refunded to you and is already taken off the figures above.`;
}

/**
 * The sentence under a total of nothing, which depends entirely on the read —
 * and, under a whole one, on whether there were any rows at all.
 *
 * "You have paid nothing" may be said only under a whole read of all four
 * sources. Every other status here is a statement about the READ, and the
 * member is told which.
 *
 * ── `recorded`, and the sentence it was there to stop ─────────────────────
 *
 * Four whole reads produce a `Taken` with NO POTS in two completely different
 * situations, and the screen printed the same sentence for both:
 *
 *   · there genuinely are no rows — the case this sentence was written for;
 *   · there are rows and not one of them states both an amount and a currency.
 *     `sumTaken` counts those as `unpriced` / `unlabelled` and refuses to add
 *     them, exactly as it should, so there is nothing to pot.
 *
 * In the second case the screen told a member "Nothing has been recorded
 * against your account — not at your gym's desk, not on a pass, and not through
 * Repple", and then, two lines lower and off the same object, `unstatedLine`
 * said "3 payments on record state no amount, or no currency". Both are
 * printed; one of them is false; and the false one is the answer, in the
 * position where the figure should be, on the screen a member takes to a
 * dispute. `memberPaid` already counts the rows for exactly this kind of
 * sentence — `payments` — so the count is passed rather than re-derived.
 *
 * It defaults to 0 so that the three non-ready sentences, which are about the
 * read and not about the rows, can still be asked for by status alone.
 */
export function paidEmptyLine(status: LoadStatus, recorded = 0): string {
  if (status === 'error') {
    return 'Nothing is shown because a read failed, not because nothing was paid. Anything already recorded still stands. Pull down to try again.';
  }
  if (status === 'partial') return 'There is more on record than could be read in one request, so nothing here is a total.';
  if (status === 'loading') return 'Still reading.';
  if (recorded > 0) {
    return 'There is no figure here because nothing recorded against your account states both an amount and a currency, not because nothing was paid. What is listed below is real; your gym can tell you what each payment covered.';
  }
  return 'Nothing has been recorded against your account: not at your gym’s desk, not on a pass, and not through Repple. If you have paid, it has not been entered, and reception can add it.';
}

/**
 * Rows that carry an amount nobody can put a currency on, or no amount at all,
 * as one sentence — or null when there are none.
 *
 * These are counted by `sumTaken` and never summed, which means a member with
 * such a row is looking at a total that is genuinely short by an unknown
 * amount. The size of the hole is the thing worth reporting.
 */
export function unstatedLine(t: Taken): string | null {
  const n = t.unlabelled + t.unpriced;
  if (n <= 0) return null;
  const s = n === 1 ? '' : 's';
  return `${n} payment${s} on record state${n === 1 ? 's' : ''} no amount, or no currency, so ${n === 1 ? 'it is' : 'they are'} not in any figure above. Your gym can tell you what ${n === 1 ? 'it' : 'they'} covered.`;
}
