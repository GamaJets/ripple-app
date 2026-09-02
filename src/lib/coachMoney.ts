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
import { appLocale } from './locale';


/** Currencies Stripe bills in whole units — there are no fils in a yen, so a
 *  minor-unit amount is not divided by a hundred. Getting this backwards prints
 *  ¥50,000 as ¥500. Single copy: `pkgMoney` in subscriptions.ts delegates here
 *  rather than keeping a second list that can drift from this one. */
export const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);

/**
 * The other end of the same mistake: currencies whose minor unit is a
 * THOUSANDTH, not a hundredth.
 *
 * A Kuwaiti dinar has 1000 fils in it, and Stripe stores the amount in fils.
 * Divided by a hundred, a KWD 12.340 sale printed as "KWD 1,234.00" — a figure
 * a hundred times too big, on a coach's own takings screen. It went the other
 * way too, and worse: a refund box that reads "12.340" as 1234 minor units
 * gives back a hundredth of what the coach typed, and the screen then agrees
 * with itself about it.
 *
 * Five currencies, and Stripe's own list. It sits beside ZERO_DECIMAL because
 * the two are one question — how many decimal places does this money have —
 * and a codebase that answers it in one place cannot answer it two ways.
 *
 * Stripe additionally requires an amount in one of these to be a whole multiple
 * of ten minor units; `readMinorAmount` refuses one that is not, rather than
 * rounding a figure a person typed.
 */
export const THREE_DECIMAL = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd']);

/**
 * How many decimal places this money has, or null when nobody said which money
 * it is.
 *
 * Null rather than 2. There is no default currency in this product and there is
 * therefore no default number of decimal places either — a "£12.50" box in
 * front of a yen sale is the same class of error as a dollar sign in front of a
 * dirham figure, and both read as considered.
 */
export function currencyDecimals(currency: string | null | undefined): number | null {
  const cur = (currency || '').trim().toLowerCase();
  if (!cur) return null;
  if (ZERO_DECIMAL.has(cur)) return 0;
  if (THREE_DECIMAL.has(cur)) return 3;
  return 2;
}

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
  // How many decimal places this money has — asked, never assumed. Two is the
  // answer for most of the world and it is the answer for none of Japan, Korea,
  // Vietnam or Kuwait.
  const dp = currencyDecimals(cur) ?? 2;
  const whole = minor ? amount / Math.pow(10, dp) : amount;
  return `${cur.toUpperCase()} ${whole.toLocaleString(appLocale(), { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

/** A Stripe amount, in minor units. */
export const minorMoney = (amount: number | null | undefined, currency: string | null | undefined): string | null => moneyIn(amount, currency, true);

/** A whole-unit amount somebody typed — a session rate, a revenue target. */
export const wholeMoney = (amount: number | null | undefined, currency: string | null | undefined): string | null => moneyIn(amount, currency, false);

/* ── an amount a person typed, going the other way ────────────────────────── */

/** Either the exact minor-unit figure, or the reason what was typed is not one.
 *  Never a best guess: the caller of this is about to credit somebody's card. */
export type TypedAmount = { ok: true; minorUnits: number } | { ok: false; reason: string };

/**
 * What a coach typed in a money box, in minor units — or why it is not money.
 *
 * ── Why `readNumber` is not this function ─────────────────────────────────
 *
 * `readNumber` in src/lib/units.ts is the house reader for a typed figure and
 * it is right for what it does: it takes the decimal COMMA a German or French
 * phone puts on the decimal pad, and it is deliberately lenient about a
 * half-typed field so a controlled input does not drop the point as it is
 * typed. Both of those are wrong here. It replaces the first comma with a point
 * and parses, so "1,234.50" becomes 1.234; and leniency on a field whose value
 * is the amount that leaves somebody's balance is how a card gets credited by a
 * figure nobody chose. This one refuses instead, and refuses ambiguity rather
 * than resolving it — "1,234" is not read as either 1234 or 1.234.
 *
 * ── Nothing here rounds ───────────────────────────────────────────────────
 *
 * The conversion is done on the DIGITS, not by multiplying a float: "12.50" in
 * a two-place currency becomes the integer 1250 by padding the fraction, never
 * by `12.5 * 100`, which is a floating-point multiplication whose result has to
 * be rounded back. A refund is the amount the coach typed or it is refused.
 *
 * ── The currency decides the shape of the box ─────────────────────────────
 *
 * There is no default currency, so there is no default here either: with no
 * currency this refuses outright. A yen has no minor unit, so "500.50" is not
 * a smaller amount of yen, it is a slip — and a dinar has three places, where
 * Stripe also requires the last one to be a nought.
 */
export function readMinorAmount(typed: string | null | undefined, currency: string | null | undefined): TypedAmount {
  const cur = (currency || '').trim().toUpperCase();
  const dp = currencyDecimals(currency);
  if (!cur || dp == null) {
    return { ok: false, reason: 'No currency is recorded here, so an amount typed in would not be an amount of any money. Nothing can be worked out from it.' };
  }
  const raw = String(typed ?? '').trim().replace(/\s/g, '');
  if (!raw) return { ok: false, reason: 'Type an amount.' };
  // Digits and at most one separator. A minus sign, a currency symbol and a
  // stray letter are all refused by the same rule, and none of them is quietly
  // stripped: a box that silently drops characters is a box that accepts a
  // different number from the one on the screen.
  if (!/^[0-9]*[.,]?[0-9]*$/.test(raw)) {
    const shape = dp === 0 ? '500' : '12.' + '5'.padEnd(dp, '0');
    return { ok: false, reason: `That is not an amount. Type the figure in digits — ${shape}, for instance — with no symbol and no spaces.` };
  }
  const sep = raw.search(/[.,]/);
  const intPart = sep === -1 ? raw : raw.slice(0, sep);
  const fracPart = sep === -1 ? '' : raw.slice(sep + 1);
  if (!intPart && !fracPart) return { ok: false, reason: 'Type an amount.' };
  if (dp === 0 && sep !== -1) {
    return { ok: false, reason: `${cur} has no smaller unit, so there is nothing after the point. Type a whole number.` };
  }
  if (fracPart.length > dp) {
    // Where the ambiguity is refused rather than guessed. In a two-place
    // currency "1,234" is either one thousand two hundred and thirty-four or
    // one and a bit, depending on which side of the Channel the person typing
    // it grew up on, and neither reading may be chosen on their behalf.
    return {
      ok: false,
      reason: `${cur} has ${dp} decimal place${dp === 1 ? '' : 's'}, and that has ${fracPart.length}. Type the amount without a thousands separator — 1234.50 rather than 1,234.50.`,
    };
  }
  const digits = (intPart || '0') + fracPart.padEnd(dp, '0');
  if (digits.length > 15) {
    return { ok: false, reason: 'That is larger than any amount this can work with.' };
  }
  const minorUnits = Number(digits);
  if (!Number.isSafeInteger(minorUnits)) {
    return { ok: false, reason: 'That is larger than any amount this can work with.' };
  }
  // Stripe's own rule for the thousandth-unit currencies: the amount is charged
  // in minor units and the last of the three must be a nought. Refused rather
  // than rounded, because rounding it is choosing an amount the coach did not.
  if (dp === 3 && minorUnits % 10 !== 0) {
    return { ok: false, reason: `${cur} is charged in thousandths and the last place must be a nought. 12.340 is an amount; 12.345 is not one that can be charged.` };
  }
  return { ok: true, minorUnits };
}

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
