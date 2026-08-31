// What a coach can honestly be told about their own money.
//
// The sibling of connect.ts and subscriptions.ts, holding the part that is pure
// arithmetic: no supabase, no react-native, so it can be run under `npm test`.
// The reads stay next door; this file only decides what may be added up and
// what may be printed.
//
// ── Two rules, and both of them are about currency ─────────────────────────
//
// 1. Amounts in different currencies are never added. AED 600 plus GBP 90 is
//    not 690 of anything, and a coach who trains a visitor from London and
//    charges them in sterling would otherwise be shown a total that is not a
//    sum of money at all. So a period produces a LIST of pots, one per
//    currency, and never a single figure.
//
// 2. An amount we cannot put a unit on is never added either — and never
//    silently dropped. `client_purchases` carries a `currency` only from part
//    132 onward, written from the Checkout Session by the stripe-webhook. Every
//    sale made BEFORE that has whatever the backfill could copy from the
//    `trainer_packages` row it came from — and null if that package had already
//    been deleted, because the unit lived nowhere else and no fallback would be
//    anything but a guess. Dropping those quietly would make every total short
//    by an amount nobody could see. They are counted instead, and the screen
//    says how many are missing from the total.
//
// ── What a coach's takings are made of ────────────────────────────────────
//
// Two tables, both gross, both in minor units, and never one query:
//
//   client_purchases              a one-off sale — a membership or a session pack.
//   client_subscription_payments  one PAID renewal invoice (part 132).
//
// Until part 132 the second did not exist. The webhook handled a paid renewal
// by re-reading the subscription and writing its STATUS, so a year of a client
// paying AED 600 a month left one row saying "active, AED 600 / month" and no
// record that twelve payments had happened — and this file had to say, in
// `sumRecurring` below, that renewals could not be added up at all. They can
// now, and `combineTaken` is what puts the two halves together without letting
// a short read on either one be printed as a total.
//
// The word used on screen for what this produces is "taken", not "earned" and
// not "paid out". It is the gross a client was charged. Stripe's fee, the
// platform fee and whether the money has actually landed in the coach's bank
// are all things Stripe knows and this app has never been told — see the note
// on `Taken` below.

/** Currencies Stripe bills in whole units — there are no fils in a yen, so a
 *  minor-unit amount is not divided by a hundred. Getting this backwards prints
 *  ¥50,000 as ¥500. Single copy: `pkgMoney` in subscriptions.ts delegates here
 *  rather than keeping a second list that can drift from this one. */
export const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);

/**
 * An amount in the currency it is actually charged in — "AED 600.00", never
 * "$600".
 *
 * `minor` says which unit the number is in: true for the fils/cents Stripe
 * stores, false for a whole-unit figure a person typed (a session rate).
 *
 * Returns `null` — not "0", not "$0.00" — when either half is missing. A
 * currency we were not told is not a currency we may guess: Repple is
 * white-labelled, so there is no fallback that is not simply wrong for half the
 * gyms running it, and an amount with the wrong code on it is worse than an
 * amount with no code, because it reads as a considered figure.
 */
export function moneyIn(amount: number | null | undefined, currency: string | null | undefined, minor: boolean): string | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  const cur = (currency || '').trim().toLowerCase();
  if (!cur) return null;
  const zero = ZERO_DECIMAL.has(cur);
  const whole = minor && !zero ? amount / 100 : amount;
  const dp = zero ? 0 : 2;
  return `${cur.toUpperCase()} ${whole.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

/** A Stripe amount, in minor units. */
export const minorMoney = (amount: number | null | undefined, currency: string | null | undefined): string | null => moneyIn(amount, currency, true);

/** A whole-unit amount somebody typed — a session rate, a revenue target. */
export const wholeMoney = (amount: number | null | undefined, currency: string | null | undefined): string | null => moneyIn(amount, currency, false);

/** One payment — a one-off sale or a renewal — reduced to the three things a
 *  total depends on. */
export interface TakenRow {
  /** Minor units. Null when Stripe never told us one. */
  amount_cents: number | null;
  /** What that amount is denominated in. Stripe's own word on the sale for
   *  anything recorded since part 132; for older purchases, whatever could be
   *  recovered from the package it was bought from, and null when that package
   *  is gone or could not be read. */
  currency: string | null;
  /**
   * When the money moved. A renewal passes its `paid_at`, not the row's
   * `created_at` — a webhook retried three days late must not land somebody's
   * payment in the wrong month — and a payment whose date is unknown passes a
   * value that will not parse, which keeps it out of every period rather than
   * sweeping it into the current one.
   */
  created_at: string;
}

/** Money taken in one currency. Never merged with another pot. */
export interface Pot { currency: string; minorUnits: number; count: number }

/**
 * What a period of selling came to.
 *
 * This is money a client was CHARGED, gross. It is deliberately not called a
 * balance, a payout or earnings, because the app holds none of those: Stripe's
 * processing fee, the platform's application fee and the state of the coach's
 * payout schedule live at Stripe and no webhook in this repo writes them here.
 * A figure with those subtracted would be plausible and made up, and the one
 * number a working trainer must be able to trust is the one about their money.
 */
export interface Taken {
  /** One per currency, biggest first, then by code so the order is stable. */
  pots: Pot[];
  /** Rows carrying an amount we could not put a unit on. Counted, never summed
   *  — and shown, so nobody reads a short total as the whole of it. */
  unlabelled: number;
  /** Rows Stripe never stated an amount for at all. */
  unpriced: number;
}

/**
 * Add up purchases, per currency.
 *
 * Does not sort, filter or otherwise touch `rows` — the caller usually holds
 * the same array for a list on the same screen.
 */
export function sumTaken(rows: readonly TakenRow[]): Taken {
  const by = new Map<string, Pot>();
  let unlabelled = 0;
  let unpriced = 0;
  for (const r of rows) {
    if (r.amount_cents == null || !Number.isFinite(r.amount_cents)) { unpriced += 1; continue; }
    const cur = (r.currency || '').trim().toUpperCase();
    // An amount with no unit is not zero and is not dollars. It is a hole in
    // the total, and the size of the hole is the thing worth reporting.
    if (!cur) { unlabelled += 1; continue; }
    const pot = by.get(cur);
    if (pot) { pot.minorUnits += r.amount_cents; pot.count += 1; }
    else by.set(cur, { currency: cur, minorUnits: r.amount_cents, count: 1 });
  }
  const pots = [...by.values()].sort((a, b) => (b.minorUnits - a.minorUnits) || a.currency.localeCompare(b.currency));
  return { pots, unlabelled, unpriced };
}

/**
 * Two periods of selling, added together — one currency at a time.
 *
 * A coach's takings come from two tables that can never be one query:
 * `client_purchases` is a one-off sale, `client_subscription_payments` (part
 * 132) is a paid renewal. Both are gross amounts in minor units and both are
 * money the same coach was paid, so the figure a coach actually wants is the
 * two of them together — but the merging has to happen HERE rather than by
 * concatenating the rows, because the two sides are read separately and either
 * one can come back short. The caller holds both subtotals and the total, and
 * prints the total only when both reads were whole.
 *
 * The pots still never merge across currencies, and `unlabelled` / `unpriced`
 * still add up rather than being taken from whichever side had more: an amount
 * missing from either half is missing from the total, and the count of them is
 * the only thing that keeps the printed figure honest.
 *
 * Neither argument is modified — the caller renders both of them beside the
 * result — and the pots that come out are fresh objects, not shared with the
 * inputs. Sharing them would make a later `combineTaken` on the same subtotal
 * add into a pot the screen is already displaying.
 */
export function combineTaken(...parts: readonly Taken[]): Taken {
  const by = new Map<string, Pot>();
  let unlabelled = 0;
  let unpriced = 0;
  for (const part of parts) {
    unlabelled += part.unlabelled;
    unpriced += part.unpriced;
    for (const p of part.pots) {
      const pot = by.get(p.currency);
      if (pot) { pot.minorUnits += p.minorUnits; pot.count += p.count; }
      else by.set(p.currency, { currency: p.currency, minorUnits: p.minorUnits, count: p.count });
    }
  }
  const pots = [...by.values()].sort((a, b) => (b.minorUnits - a.minorUnits) || a.currency.localeCompare(b.currency));
  return { pots, unlabelled, unpriced };
}

/** One live subscription, reduced to what it is priced at. */
export interface RecurringRow { amount_cents: number | null; currency: string | null; billing_interval: string | null }

/** What is priced to recur, in one currency, at one interval. */
export interface RecurringPot { currency: string; interval: string; minorUnits: number; count: number }

/**
 * What the coach's live subscriptions are PRICED at — not what has been taken.
 *
 * The distinction is the whole point of a separate function, and it survives
 * part 132 unchanged. Renewals ARE now recorded as money, in
 * `client_subscription_payments`, and `sumTaken` over those rows is what a
 * coach has actually been paid. This is a different statement: it is the
 * standing price of the subscriptions running TODAY — what is expected to be
 * charged next, at today's prices, if nobody cancels and no card fails. A
 * forward-looking price added to a backward-looking takings figure would be a
 * number about neither, so the two are printed apart and labelled apart.
 *
 * Monthly and yearly are kept apart rather than divided into each other. A
 * yearly package spread over twelve is a number this app invented, and the
 * coach can do that division themselves knowing they did it.
 */
export function sumRecurring(rows: readonly RecurringRow[]): { pots: RecurringPot[]; unlabelled: number; unpriced: number } {
  const by = new Map<string, RecurringPot>();
  let unlabelled = 0;
  let unpriced = 0;
  for (const r of rows) {
    if (r.amount_cents == null || !Number.isFinite(r.amount_cents)) { unpriced += 1; continue; }
    const cur = (r.currency || '').trim().toUpperCase();
    const iv = (r.billing_interval || '').trim().toLowerCase();
    // No unit, or no period, and it is not a recurring price — "AED 600" with
    // no idea how often is not a figure a coach can plan against.
    if (!cur || !iv) { unlabelled += 1; continue; }
    const k = cur + '|' + iv;
    const pot = by.get(k);
    if (pot) { pot.minorUnits += r.amount_cents; pot.count += 1; }
    else by.set(k, { currency: cur, interval: iv, minorUnits: r.amount_cents, count: 1 });
  }
  const pots = [...by.values()].sort((a, b) => (b.minorUnits - a.minorUnits) || a.currency.localeCompare(b.currency) || a.interval.localeCompare(b.interval));
  return { pots, unlabelled, unpriced };
}

/** Rows created on or after `fromMs`. Rows with an unparseable date are kept
 *  out of a period rather than swept into it — a purchase we cannot date is not
 *  evidence about this month. */
export function since<T extends { created_at: string }>(rows: readonly T[], fromMs: number): T[] {
  return rows.filter((r) => {
    const t = Date.parse(r.created_at);
    return Number.isFinite(t) && t >= fromMs;
  });
}

/** Midnight on the 1st of the month containing `now`, local time — the same
 *  month boundary the analytics screen counts sessions against. */
export function monthStart(now: Date = new Date()): number {
  const d = new Date(now.getTime());
  d.setDate(1); d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** One session-pack purchase, reduced to its balance. */
export interface PackRow { sessions_total: number | null; sessions_used: number; status: string }

/**
 * Sessions left on a pack, or `null` when the row is not a pack at all.
 *
 * Null rather than 0 for a membership: a one-off membership has no credits to
 * run out of, and "0 left" beside it reads as a client who has used everything
 * they paid for. Clamped at zero because a refund written by hand could take
 * `sessions_used` past `sessions_total`, and "-1 sessions left" is not a
 * sentence anybody should read about their own client.
 */
export function packLeft(r: PackRow): number | null {
  if (r.sessions_total == null || !Number.isFinite(r.sessions_total)) return null;
  return Math.max(0, r.sessions_total - (Number.isFinite(r.sessions_used) ? r.sessions_used : 0));
}

/** True for a pack that has been paid for and has nothing left on it — the one
 *  row on this screen a coach has to act on, because the next session is not
 *  covered by anything. */
export function packRunOut(r: PackRow): boolean {
  return r.status === 'paid' && packLeft(r) === 0;
}
