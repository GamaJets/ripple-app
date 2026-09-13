// Who the money on the Payments screen came from — one row per client, per
// currency, over the two Stripe tables that screen already holds.
//
// ── WHAT THIS IS NOT, SAID FIRST ──────────────────────────────────────────
//
// It is not a lifetime value, it does not compete with one, and it must never
// be labelled as one. `clientValue` in src/lib/clientValue.ts is this app's
// answer to "what has this person paid me": it adds `coach_receipts` — the
// cash, the bank transfers and anything taken at a gym's front desk — and for
// most self-employed coaches that half is the LARGER half. It nets refunds off,
// because "what have they paid me and not had back" is the question a retention
// decision is made on. app/(trainer)/money.tsx renders it under "What Each
// Client Has Paid" and app/(trainer)/client.tsx renders it per person, and
// client.tsx says in as many words that nothing else in this app may compute a
// second one.
//
// This module does not. It answers a smaller question that the Payments screen
// asks and could not answer:
//
//     The figure at the top of this screen says AED 18,400 taken through
//     Stripe. WHICH CLIENTS IS THAT?
//
// That is a BREAKDOWN OF A TOTAL ALREADY ON THE SCREEN, not a new total. It is
// card-only because the screen is card-only — `coach_receipts` is not read
// there and adding a read for it would be building the other figure badly a
// second time — and it is GROSS because every takings line on that screen is
// gross. `PAYER_IS_CARD_ONLY` and `PAYER_IS_GROSS` say both of those on the
// screen rather than only here, and `PAYER_WHOLE_FIGURE_IS_ELSEWHERE` points at
// the figure that is the whole of it. A coach who reads this as what somebody
// is worth, and it is the obvious misreading, is reading a number that is short
// by all of their cash.
//
// ── REFUNDS ARE DISCLOSED, NEVER SUBTRACTED ───────────────────────────────
//
// The doctrine on app/(trainer)/payments.tsx, and it is followed here without
// exception: `refunded_cents` is a running total with NO DATE on it. Stripe
// tells this app how much has gone back and never when, so a figure with it
// netted in belongs to no period, and two figures on one screen built on two
// rules are worse than one figure with a sentence beside it.
//
// So each payer carries a second pot — `givenBack` — stated beside the gross
// and taken off nothing. This is the opposite of `clientValue`'s choice and
// deliberately so: that figure is undated by construction (all time, one
// person, no period at all), and this one sits under a heading that also prints
// a month.
//
// ── AND THE RULES EVERY MONEY FIGURE IN THIS APP INHERITS ─────────────────
//
//   · Currencies never merge. A client who paid in GBP and in AED has two
//     figures and there is no third. `sumTaken` pots by currency and nothing
//     here flattens it.
//   · Nothing divides by a hundred. `minorMoney` formats, and it knows that JPY
//     has no minor unit and KWD has three. No arithmetic in this file scales
//     anything; every number in and out is minor units of one stated currency.
//   · An amount with no currency on it is COUNTED, never summed and never
//     dropped. `sumTaken.unlabelled` carries it and the screen prints it.
//   · A client whose name could not be read is not "Unknown". The row is real,
//     the money is real, and the honest sentence names what happened —
//     `PAYER_NAMELESS` is that sentence and it is the same one the Memberships
//     Sold list beside it already uses.
//   · Only a WHOLE read may be grouped. `payerBook` returns null under
//     'loading', 'partial' and 'error' alike, because a per-client breakdown of
//     a truncated read is the one shape of this figure that looks completely
//     right: every row real, every name correct, and a client who has paid for
//     eleven months showing three.
//
// Pure. The reads are `fetchClientPurchases` (src/lib/connect.ts) and
// `fetchMySubscriptionPayments` (src/lib/subscriptions.ts), both already on the
// screen; nothing here goes to the network.
import type { LoadStatus } from '../ui/loadStatus';
import { sumTaken, type Taken, type TakenRow } from './coachMoney';

/**
 * One charge, in the shape both of the screen's two tables can be read as.
 *
 * `client_purchases` and `client_subscription_payments` are different tables
 * with different keys and different dates, and neither of those differences
 * matters to this question: a renewal and a one-off sale are both money this
 * client paid this coach through Stripe. So the caller maps both into this and
 * the difference is carried by `kind`, which exists only so the screen can say
 * how somebody pays rather than to change any arithmetic.
 */
export interface PayerCharge {
  /** Who paid. Null when the sale carries no client — counted apart, never
   *  attached to a guess. */
  client_id: string | null;
  /** Their name as `profiles` gave it to the coach-side read. Null when it
   *  could not be read; the money beside it is still real. */
  client_name: string | null;
  /** Minor units, GROSS. Null when Stripe stated no amount — counted out of
   *  every figure by `sumTaken`, never read as nought. */
  amount_cents: number | null;
  /** What that amount is denominated in. Null for a pre-part-132 sale whose
   *  package has since been deleted, which is unrecoverable rather than
   *  unread. */
  currency: string | null;
  /**
   * Minor units already given back on this charge, as a RUNNING TOTAL across
   * every refund on it (part 192). Zero, never null, on a charge nobody has
   * refunded. Optional and string-tolerant for the two reasons src/lib/
   * refunds.ts and src/lib/clientValue.ts both carry the same coercion: it is a
   * `bigint`, which PostgREST can hand back as a string, and a caller reading a
   * narrower column set has none.
   */
  refunded_cents?: number | string | null;
  /** Which half of the takings this is. Never used in any sum. */
  kind: 'one-off' | 'renewal';
}

/** What one client has been charged through Stripe, per currency. */
export interface Payer {
  clientId: string;
  /** Null when no charge of theirs carried a readable name. NOT a placeholder
   *  and NOT the word "Unknown" — see `PAYER_NAMELESS`. */
  name: string | null;
  /** Gross, per currency, with `unlabelled` / `unpriced` carrying the holes. */
  taken: Taken;
  /** What has gone back on those same charges, per currency. Stated beside
   *  `taken` and subtracted from nothing. Empty for nearly everybody. */
  givenBack: Taken;
  /** How many of their charges are renewals rather than one-off sales. A count
   *  of rows, never of money. */
  renewals: number;
}

/** The whole breakdown, or nothing. */
export interface PayerBook {
  /** One per client, ordered by `orderedBy` — see `payerBook`. */
  payers: Payer[];
  /** Charges carrying no client id at all. Real money with nobody to attach it
   *  to, counted and reported rather than dropped out of a breakdown of a total
   *  that includes it. */
  unattached: Taken;
  /** How many of the payers above have no readable name. */
  nameless: number;
  /** Every currency anybody paid in, biggest pot across the book first. Two
   *  entries means two separate amounts of money and no single ranking. */
  currencies: string[];
  /** The currency the order above is by, or null when nobody has a pot in any
   *  currency at all. Never "the total" — there is no total across currencies. */
  orderedBy: string | null;
}

/**
 * `refunded_cents` as a number of minor units — 0 for anything that is not one.
 *
 * The third copy of this coercion in the repository, and the other two say why:
 * a `bigint` reaches a phone as a string often enough to be the normal case.
 * A negative or unparseable value reads as no refund rather than as a credit —
 * nothing may ever make a refund figure smaller by being unreadable.
 */
const refundedMinor = (v: number | string | null | undefined): number => {
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};

/** The pot for one currency inside a `Taken`, or 0 where there is none. */
const potIn = (taken: Taken, currency: string | null): number => {
  if (!currency) return 0;
  const pot = taken.pots.find((p) => p.currency === currency);
  return pot ? pot.minorUnits : 0;
};

/**
 * Group the screen's charges by client, per currency.
 *
 * `null` under anything but 'ready', and the guard is the point of the
 * function rather than an edge case in it. Under 'partial' the rows that came
 * back are real and the SET is a prefix: every name correct, every amount
 * correct, and a client who has been paying for a year showing three payments
 * because the read stopped at PostgREST's ceiling. There is no sentence that
 * makes that safe to print beside a person's name, so the caller draws
 * `PartialRead` and this returns nothing to draw.
 *
 * ── THE ORDER, WHICH IS THE ONE PLACE A CURRENCY COULD LEAK ───────────────
 *
 * Sorting a mixed book by "amount" would put AED 5,000 above GBP 900 because
 * five thousand is more than nine hundred, and the resulting order would be a
 * statement about exchange rates that nobody supplied. So the book is ordered
 * within ONE currency — the one with the largest pot summed across the whole
 * book — and `orderedBy` names it so the screen can say which. A payer with no
 * pot in that currency sorts after everybody who has one, by name, and their
 * own figures are printed in their own currency exactly as they were paid.
 *
 * Ties break on name and then on id, so the order is stable across renders: a
 * list that reshuffles two equal rows on every draw is a list a coach cannot
 * point at.
 */
export function payerBook(charges: readonly PayerCharge[], status: LoadStatus): PayerBook | null {
  if (status !== 'ready') return null;

  const byClient = new Map<string, { name: string | null; taken: TakenRow[]; back: TakenRow[]; renewals: number }>();
  const loose: TakenRow[] = [];

  for (const c of charges) {
    // `created_at` is required by `TakenRow` and is not read by anything here:
    // this breakdown is all-time and dates nothing. An empty string is passed
    // rather than a date, so that a later `since()` over these rows — which
    // would be a different figure needing a different argument — cannot quietly
    // succeed against a date this module invented.
    const row: TakenRow = { amount_cents: c.amount_cents, currency: c.currency, created_at: '' };
    const id = (c.client_id || '').trim();
    if (!id) { loose.push(row); continue; }

    let entry = byClient.get(id);
    if (!entry) { entry = { name: null, taken: [], back: [], renewals: 0 }; byClient.set(id, entry); }

    // The first readable name wins and a later blank never unsets it. The two
    // tables resolve the name through the same `profiles` read, so they agree
    // whenever both have one; where only one of them does — a client known to
    // the renewals read and not to the sales read — taking whichever arrived is
    // the whole of the difference between a name and a dash.
    const name = (c.client_name || '').trim();
    if (!entry.name && name) entry.name = name;

    entry.taken.push(row);
    if (c.kind === 'renewal') entry.renewals += 1;

    const back = refundedMinor(c.refunded_cents);
    // Only charges something has actually come back on. Filtering first keeps
    // `unpriced` on the refund pot about refunds rather than about every sale
    // nobody refunded, which is what makes the number beside it readable.
    if (back > 0) entry.back.push({ amount_cents: back, currency: c.currency, created_at: '' });
  }

  const payers: Payer[] = [...byClient.entries()].map(([clientId, e]) => ({
    clientId,
    name: e.name,
    taken: sumTaken(e.taken),
    givenBack: sumTaken(e.back),
    renewals: e.renewals,
  }));

  // Which currency the book is ordered by: the one holding the most money
  // across everybody. Summed per currency and compared within each — the
  // comparison is between two totals in the SAME currency at every step, never
  // across two.
  const across = new Map<string, number>();
  for (const p of payers) for (const pot of p.taken.pots) across.set(pot.currency, (across.get(pot.currency) ?? 0) + pot.minorUnits);
  for (const pot of sumTaken(loose).pots) across.set(pot.currency, (across.get(pot.currency) ?? 0) + pot.minorUnits);
  const currencies = [...across.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([cur]) => cur);
  const orderedBy = currencies[0] ?? null;

  // Named before nameless within a tie, and that clause is not cosmetic. A
  // null name compares as the empty string, which sorts BEFORE every real name
  // — so a row reading "A client whose name could not be read" led every group
  // of payers with no pot in the ordering currency. The first thing a coach saw
  // under a heading about their clients was the one row that names nobody.
  payers.sort((a, b) =>
    (potIn(b.taken, orderedBy) - potIn(a.taken, orderedBy))
    || (Number(!a.name) - Number(!b.name))
    || (a.name ?? '').localeCompare(b.name ?? '')
    || a.clientId.localeCompare(b.clientId));

  return {
    payers,
    unattached: sumTaken(loose),
    nameless: payers.filter((p) => !p.name).length,
    currencies,
    orderedBy,
  };
}

/**
 * How many payments this client has made, or null when there is no count to
 * state.
 *
 * A count over the pots rather than over the rows, so that a charge with no
 * amount and a charge with no currency — both of which are counted OUT of the
 * figures — are counted out of the sentence beside them too. "4 payments" over
 * three visible amounts is the small dishonesty this avoids; the missing ones
 * get their own line.
 */
export function payerPayments(p: Payer): number {
  return p.taken.pots.reduce((a, pot) => a + pot.count, 0);
}

/**
 * Whether anything has gone back to this client at all.
 *
 * The pots AND `unlabelled`, because a refund whose currency was only ever on a
 * package since deleted is still money that went back — it has no figure, it
 * gets a sentence, and a test that looked only at the pots would draw neither.
 *
 * No line is composed here. The screen prints one row per currency beside the
 * gross, exactly as the "Given back" block above it does, because a refund in
 * dirhams and a refund in sterling are two facts and a joined string is one.
 */
export function payerGaveBack(p: Payer): boolean {
  return p.givenBack.pots.length > 0 || p.givenBack.unlabelled > 0;
}

/** The name for somebody whose name could not be read. Never "Unknown": the
 *  row is a real payment by a real person and the failure is ours to state. */
export const PAYER_NAMELESS = 'A client whose name could not be read';

/** Said under the list, because the obvious misreading of a per-client figure
 *  on a Stripe screen is that it is everything somebody has ever paid. */
export const PAYER_IS_CARD_ONLY =
  'Card only. Cash, bank transfers and anything taken at a gym’s front desk are recorded under Receipts and are not in these figures.';

/** The same sentence the takings figure above it carries, in the one place a
 *  coach is looking at a single person rather than at a month. */
export const PAYER_IS_GROSS =
  'Gross — what each client was charged, before Stripe’s fee and the platform fee. Anything refunded is stated beside it and has not been taken off.';

/** Where the whole figure lives, named rather than implied. */
export const PAYER_WHOLE_FIGURE_IS_ELSEWHERE =
  'What Each Client Has Paid, on your Money screen, is the whole of it: it adds the payments you have recorded yourself and it takes refunds off.';
