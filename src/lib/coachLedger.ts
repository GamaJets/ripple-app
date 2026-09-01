// Two questions, two answers, and never one number.
//
// A coach asking "how am I doing" and a coach asking "what is going out" are
// not asking about the same thing, and a net figure answers neither. So this
// module builds TWO ledgers and provides nothing that subtracts one from the
// other — there is deliberately no `net`, no `profit` and no `balance` here,
// because the moment one exists somebody puts it in a hero.
//
// The arithmetic that adds money up already lives in coachMoney.ts (`sumTaken`,
// `combineTaken`, `Pot`), and that is where it stays. What was missing, and is
// here, is the composition: a single figure on a money screen is fed by several
// separate reads, and the figure is only as honest as the WORST of them.
//
// ── The three failures this file exists to prevent ────────────────────────
//
// 1. A SUBTOTAL PRINTED AS A TOTAL. The coming-in figure is two tables —
//    `client_purchases` and `client_subscription_payments` — read separately,
//    either of which can fail or come back truncated. Adding whichever half
//    landed and calling it the month's takings produces a smaller number with
//    nothing about it to doubt. `ledger()` returns `total: null` unless every
//    contributing read was whole, and names the ones that were not.
//
// 2. A MAJOR-UNIT AMOUNT DIVIDED BY A HUNDRED. Almost every money column in
//    this database is minor units, and `charges.amount` is not: it is
//    `numeric`, in whole units, written from `trainers.late_cancel_fee` which
//    is also numeric and also whole. Feeding it to `minorMoney` prints a
//    recorded AED 40 late-cancellation fee as "AED 0.40". `sumMajor` is the
//    separate path, and it exists so that the two units cannot be confused by
//    reaching for whichever summing function was already imported.
//
// 3. NO SPEND RECORDED READ AS ZERO SPEND. A join code whose cost nobody typed
//    and whose ad account is not connected has an UNKNOWN cost, not a cost of
//    nothing. Summing the codes that do have a figure and presenting it as what
//    the coach spent makes every campaign look cheaper than it was. `sumSpend`
//    counts the silent ones separately so the screen can say how many.
//
// ── And the one that is now the common path ───────────────────────────────
//
// 35 of 54 live tenants have `tenants.currency` NULL — verified against the
// live database, not assumed — and part 150 removed the last database defaults.
// So "nobody has said what money this is" is not an edge case, it is what most
// coaches hit. `denominate` is the primitive for it, and its whole job is to
// keep two different silences apart: a currency that could not be READ is fixed
// by trying again, and a currency nobody has SET is fixed by a person going
// into the gym settings. Telling a coach the second when it was the first sends
// them to a screen where nothing is wrong.
import type { LoadStatus } from '../ui/loadStatus';
import { worstStatus } from '../ui/loadStatus';
import type { Pot, Taken } from './coachMoney';
import { combineTaken } from './coachMoney';

/* ── one read, and how far it can be trusted ──────────────────────────────── */

/**
 * One contributing read on a money screen.
 *
 * `label` is the noun a sentence can be built around — "renewals", "one-off
 * sales" — lower case, because it lands mid-sentence in `Ledger.reason`.
 */
export interface Strand {
  key: string;
  label: string;
  status: LoadStatus;
  taken: Taken;
}

export interface Ledger {
  /** The least trustworthy of the contributing reads. */
  status: LoadStatus;
  /** Null unless every strand was whole. Never a subtotal presented as a
   *  total — a figure over part of somebody's income is not a smaller figure,
   *  it is a wrong one. */
  total: Taken | null;
  /** Why there is no total, or null when there is one. Sentence case: it is
   *  prose under a heading, not a label. */
  reason: string | null;
  /** Labels of the reads that were not whole, in the order given. Named so the
   *  coach knows WHICH half of their money is missing rather than being told
   *  the screen is broken. */
  missing: string[];
}

/**
 * Several reads, added into one ledger — or withheld, with the reason.
 *
 * The rule is all-or-nothing and it is deliberately strict. Two of the three
 * non-ready statuses could arguably be shown partially ('partial' has real rows
 * in it), but a coach reading a money figure is not reading a list: they are
 * deciding whether they can pay rent, and there is no presentation of "some of
 * your takings" that survives being glanced at.
 *
 * Zero strands is a whole ledger of nothing rather than an error, so a screen
 * that has not been given a side yet renders an honest empty rather than a
 * failure it would have to explain.
 */
export function ledger(strands: readonly Strand[]): Ledger {
  const status = strands.length ? worstStatus(...strands.map((s) => s.status)) : 'ready';
  const missing = strands.filter((s) => s.status !== 'ready').map((s) => s.label);
  if (status === 'ready') {
    return { status, total: combineTaken(...strands.map((s) => s.taken)), reason: null, missing: [] };
  }
  const list = joinLabels(missing);
  const reason = status === 'loading'
    ? `Still reading ${list}, so no figure is stated yet.`
    : status === 'partial'
      ? `There are more ${list} on record than could be read in one request, so no total is stated. What is listed is real; it is not all of it.`
      : `Your ${list} could not be read, so no total is stated. An empty figure here is not a statement that you were paid nothing.`;
  return { status, total: null, reason, missing };
}

/** "sales", "sales and renewals", "sales, renewals and fees". Oxford comma
 *  omitted to match the prose everywhere else in the app. */
export function joinLabels(labels: readonly string[]): string {
  if (labels.length === 0) return 'nothing';
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/* ── whole units, which are not cents ─────────────────────────────────────── */

/** Money in whole units of its currency — a recorded late-cancellation fee. */
export interface MajorPot { currency: string; units: number; count: number }

export interface MajorSum {
  pots: MajorPot[];
  /** Rows carrying an amount with no currency on it. Counted, never summed and
   *  never dropped: an amount with no unit is a hole in the total, and the size
   *  of the hole is the thing worth reporting. */
  unlabelled: number;
  /** Rows with no amount at all. */
  unpriced: number;
}

/**
 * Add up whole-unit amounts, per currency.
 *
 * The twin of `sumTaken`, for the one family of rows in this database that is
 * NOT in minor units: `charges.amount` is `numeric` and holds 40, not 4000, for
 * a fee of forty. It is a separate function rather than a flag on the existing
 * one because a boolean parameter called `minor` is exactly the kind of thing
 * that gets passed wrong once and then prints somebody's fee as a hundredth of
 * itself forever.
 *
 * Currencies never merge, for the same reason they never merge anywhere else:
 * AED 40 plus GBP 25 is not 65 of anything.
 */
export function sumMajor(rows: readonly { amount: number | null; currency: string | null }[]): MajorSum {
  const by = new Map<string, MajorPot>();
  let unlabelled = 0;
  let unpriced = 0;
  for (const r of rows) {
    if (r.amount == null || !Number.isFinite(r.amount)) { unpriced += 1; continue; }
    const cur = (r.currency || '').trim().toUpperCase();
    if (!cur) { unlabelled += 1; continue; }
    const pot = by.get(cur);
    if (pot) { pot.units += r.amount; pot.count += 1; }
    else by.set(cur, { currency: cur, units: r.amount, count: 1 });
  }
  const pots = [...by.values()].sort((a, b) => (b.units - a.units) || a.currency.localeCompare(b.currency));
  return { pots, unlabelled, unpriced };
}

/* ── what the coach spent, and what nobody wrote down ─────────────────────── */

/** One join code's recorded cost, as `my_code_returns` hands it back. Null
 *  where nobody has typed a figure and no ad sync has supplied one. */
export interface SpendRow { spend: { cents: number; currency: string } | null }

export interface SpendSum {
  pots: Pot[];
  /** Codes whose cost is not recorded at all. NOT zero — a campaign whose cost
   *  nobody wrote down cost something, and rolling it in as nothing makes every
   *  return figure on the screen above it flattering and wrong. */
  unrecorded: number;
}

export function sumSpend(rows: readonly SpendRow[]): SpendSum {
  const by = new Map<string, Pot>();
  let unrecorded = 0;
  for (const r of rows) {
    const cents = r.spend?.cents;
    const cur = (r.spend?.currency || '').trim().toUpperCase();
    // A spend of zero IS a recorded figure and belongs in the total; only an
    // absent one is unrecorded. The two used to be the same value and a coach
    // who cleared a wrong number could not tell that they had.
    if (cents == null || !Number.isFinite(cents) || !cur) { unrecorded += 1; continue; }
    const pot = by.get(cur);
    if (pot) { pot.minorUnits += cents; pot.count += 1; }
    else by.set(cur, { currency: cur, minorUnits: cents, count: 1 });
  }
  const pots = [...by.values()].sort((a, b) => (b.minorUnits - a.minorUnits) || a.currency.localeCompare(b.currency));
  return { pots, unrecorded };
}

/* ── the currency, which most coaches do not have ─────────────────────────── */

/**
 * Whether a figure may be denominated, and if not, which silence this is.
 *
 * `unset` and `unread` lead to different actions and so are never collapsed:
 * an owner fixes the first in the gym settings and nobody can fix the second
 * except by trying again. A screen that says "ask your owner to set a currency"
 * when the read simply failed sends a coach to a settings page where the value
 * is already correct, and they conclude the app is lying to them.
 */
export type Denom =
  | { ok: true; currency: string }
  | { ok: false; why: 'unread' | 'unset'; note: string };

export function denominate(currency: string | null | undefined, status: LoadStatus): Denom {
  if (status === 'error') {
    return {
      ok: false,
      why: 'unread',
      note: 'We couldn’t read what currency you charge in, so amounts that depend on it are withheld rather than printed in one we picked. Nothing is missing from your settings — the read failed. Open this again in a moment.',
    };
  }
  const code = (currency || '').trim().toUpperCase();
  if (code.length < 3) {
    return {
      ok: false,
      why: 'unset',
      note: 'Nobody has set a currency for you yet. Repple is white-labelled, so there is no default that would be right for every gym, and a figure with the wrong three letters on it is a different amount of money. Your gym owner sets one in the gym settings, or it comes from the currency you price a package in.',
    };
  }
  return { ok: true, currency: code };
}

/* ── what an empty ledger means, which depends entirely on the read ───────── */

export type LedgerSide = 'in' | 'out';

/**
 * The sentence under a ledger with nothing in it.
 *
 * A confident zero over a failed read is the most expensive sentence this app
 * can say, and "you have taken nothing" is the most expensive version of it.
 * Every money table in this database is empty today — verified live — so this
 * is not a rare branch: it is the first thing most coaches will read on this
 * screen, and it has to be true.
 */
export function ledgerEmptyLine(side: LedgerSide, status: LoadStatus): string {
  if (status === 'error') {
    return side === 'in'
      ? 'Nothing is shown because the read failed, not because nobody has paid you. Anything already recorded still stands.'
      : 'Nothing is shown because the read failed, not because you owe nothing. Anything already charged to you still stands.';
  }
  // Deliberately one sentence for both sides. Truncation says the same thing
  // about money coming in and money going out, and two identical strings behind
  // a branch is a branch nobody can get wrong later by editing one of them.
  if (status === 'partial') return 'There is more on record than could be read in one request, so nothing here is a total.';
  if (status === 'loading') return 'Still reading.';
  return side === 'in'
    ? 'Nothing has been recorded as paid to you yet. Money taken through Repple lands here; cash and transfers do not, so this is not the whole of what you earn.'
    : 'Nothing has been recorded as going out. Your Repple plan and any ad spend you record show up here.';
}

/* ── the sentences that keep the screen from overclaiming ─────────────────── */

/**
 * Why the two halves are never one number.
 *
 * On the screen rather than only in this comment, because the absence of a net
 * figure reads as an omission unless somebody says it was a decision.
 */
export const NO_NET_NOTE =
  'What comes in and what goes out are kept apart and are never subtracted from each other. They are recorded in different places, in currencies that may differ, and neither is complete on its own — a single net figure would be a number about neither question.';

/**
 * What Stripe knows and this app has never been told.
 *
 * Every takings figure here is GROSS: what a client was charged. Stripe's
 * processing fee, the platform's application fee and whether the money has
 * cleared into the coach's bank are facts that live at Stripe, and no webhook
 * in this repo writes any of them. `supabase/parts/138` says the same thing
 * about an invoice, from the other direction: this app's document is the
 * coach's own statement, not a receipt for money that moved.
 */
export const STRIPE_AUTHORITY_NOTE =
  'These are amounts clients were charged, before Stripe’s fee and the platform fee. Repple is not told what Stripe paid out or when it cleared — your Stripe dashboard is the record of what actually landed in your bank.';

/** What a period figure counts, said next to the period. A total with no
 *  stated span is read as "all time" by half its readers and "this month" by
 *  the other half. */
export const PERIOD_NOTE =
  'Counted by the date the money was charged, not the date the record was written, so a payment confirmed late still falls in the month the client paid.';
