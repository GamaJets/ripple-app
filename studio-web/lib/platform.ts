// Repple's own book — what trainers and gyms pay Repple, as opposed to what
// members pay a gym.
//
// ── Why this had no screen ────────────────────────────────────────────────
//
// docs/OWNER-PORTAL.md describes the split and says platform data was removed
// from the owner app. Correctly: `role = 'owner'` is a GYM owner and a gym
// owner has no business seeing Repple's MRR. Nothing replaced it, and the
// reason nothing could is not that the screen was hard — it is that after
// supabase/parts/39 and 106 tightened the billing policies, the reader set for
// these three tables is "the trainer themselves, and the owner of that
// trainer's own gym". Nobody at Repple is on that list.
//
// supabase/parts/252 adds exactly one reader: an account on the
// `platform_admins` allowlist. The table ships EMPTY and has no INSERT policy
// for anybody, so this whole surface refuses everybody — including its author —
// until a row is deliberately written with the service role. `isPlatformAdmin`
// below is how the page finds out, and an empty answer is a refusal rather than
// an error.
//
// ── THE FIGURE THIS FILE REFUSES TO PRODUCE ───────────────────────────────
//
// There is no MRR here.
//
// docs/OWNER-PORTAL.md offers the query for one:
//
//   select sum(case plan when 'Starter' then 49 when 'Pro' then 99
//                        when 'Studio' then 249 end) from subscriptions …
//
// and it is exactly the pattern that document's own closing section warns
// against: "a plausible constant standing in for a measurement, then arithmetic
// on top of it, then a confident label". Those three prices are not in this
// database. They are not on `subscriptions`, they are not on a `plans` table,
// and they are not in the app — they are three numbers somebody typed into a
// markdown file, in dollars, for a product whose live tenants price in AED. A
// coupon, a grandfathered price, a currency, an annual plan or a price change
// would each make the total silently wrong, and there would be nothing on the
// figure to doubt.
//
// What IS measured is `invoices.amount_due`, which is what Stripe actually
// billed, in the currency Stripe billed it in. So this reports invoiced and
// paid amounts per currency, and counts subscriptions by plan and status. A
// coach reading "14 on Pro" and "USD 1,386 invoiced this month" has two facts;
// a reader of a synthesised MRR has one number and no way to check it.
//
// ── And no names ──────────────────────────────────────────────────────────
//
// Part 252 deliberately does not widen the read on `profiles`, so nothing here
// can name a trainer. That is not a limitation to be worked around: a screen
// that named people would be making its argument about every person on the
// platform at once, and answering "what is Repple's MRR" needs a count and not
// a name.
import { supabase } from './supabase';
// `minorMoney`, NOT `money` from gymRecord. Both take cents and a currency and
// both refuse to print without one, and only one of them knows that there are
// no sen in a yen: `money()` divides by 100 unconditionally, so a JPY invoice
// would print as a hundredth of itself. `ZERO_DECIMAL` in src/lib/coachMoney.ts
// is the single list of the currencies that has to be true of, and this is the
// platform's book — the one place on the product where the currencies are
// whatever Stripe billed rather than whatever one gym set.
import { minorMoney } from '@lib/coachMoney';

/** Whether the signed-in account may read the platform's own book.
 *
 *  False is the ordinary answer and is not an error: the allowlist is empty
 *  until somebody is deliberately added, so every account gets false on a fresh
 *  project. `unknown` is the read having failed, which is a different sentence
 *  — a page that said "not your console" over a network blip would be telling
 *  somebody something false about their own access. */
export type AdminCheck = 'yes' | 'no' | 'unknown';

export async function isPlatformAdmin(): Promise<AdminCheck> {
  try {
    const { data, error } = await supabase.rpc('is_platform_admin');
    if (error) return 'unknown';
    return data === true ? 'yes' : 'no';
  } catch {
    return 'unknown';
  }
}

/** One subscription row as this screen needs it. No name, by design. */
export interface PlatformSubscription {
  plan: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

/** One platform invoice. `amountDue` is CENTS, as Stripe stores it. */
export interface PlatformInvoice {
  id: string;
  amountDue: number | null;
  currency: string | null;
  status: string | null;
  attemptCount: number | null;
  createdAt: string;
}

/**
 * Both reads, each with its own outcome.
 *
 * `null` rows mean the read did not come back — never an empty array for a
 * failure. Every figure on the page is a count or a sum over one of these, and
 * an empty array under a failed read would produce a confident zero on a screen
 * about whether the business has any revenue.
 */
export interface PlatformBook {
  subscriptions: PlatformSubscription[] | null;
  invoices: PlatformInvoice[] | null;
  /** How many Stripe customers exist at all — the denominator for "how many of
   *  the accounts we have opened are actually paying". Null on a failed read. */
  customers: number | null;
}

/** How far back the invoice read goes. Ninety days: long enough to see a
 *  quarter and short enough that the read stays one page for a platform of this
 *  size. A screen that needs more than this needs a warehouse, not a browser. */
export const INVOICE_WINDOW_DAYS = 90;

export async function fetchPlatformBook(): Promise<PlatformBook> {
  const since = new Date(Date.now() - INVOICE_WINDOW_DAYS * 86400000).toISOString();
  const [subs, invs, custs] = await Promise.all([
    supabase.from('subscriptions').select('plan, status, current_period_end, cancel_at_period_end'),
    supabase.from('invoices').select('id, amount_due, currency, status, attempt_count, created_at')
      .gte('created_at', since).order('created_at', { ascending: false }),
    supabase.from('billing_customers').select('trainer_id', { count: 'exact', head: true }),
  ]);
  return {
    subscriptions: subs.error ? null : (subs.data ?? []).map((r: any) => ({
      plan: r.plan ?? null,
      status: r.status ?? null,
      currentPeriodEnd: r.current_period_end ?? null,
      cancelAtPeriodEnd: r.cancel_at_period_end === true,
    })),
    invoices: invs.error ? null : (invs.data ?? []).map((r: any) => ({
      id: String(r.id),
      amountDue: typeof r.amount_due === 'number' ? r.amount_due : (Number.isFinite(Number(r.amount_due)) ? Number(r.amount_due) : null),
      currency: (r.currency ?? '').trim() || null,
      status: r.status ?? null,
      attemptCount: Number.isFinite(Number(r.attempt_count)) ? Number(r.attempt_count) : null,
      createdAt: String(r.created_at),
    })),
    customers: custs.error ? null : (custs.count ?? 0),
  };
}

/* ── the arithmetic, such as it is ────────────────────────────────────────── */

/** Subscriptions in one state, counted by plan. A plan nobody set is counted
 *  under 'Not stated' rather than dropped: a subscription with no plan on it is
 *  a row somebody has to go and look at, and dropping it would make the total
 *  disagree with the table it came from. */
export function byPlan(rows: readonly PlatformSubscription[], statuses: readonly string[]): Array<[string, number]> {
  const want = new Set(statuses);
  const by = new Map<string, number>();
  for (const r of rows) {
    if (!want.has((r.status ?? '').trim().toLowerCase())) continue;
    const key = (r.plan ?? '').trim() || 'Not stated';
    by.set(key, (by.get(key) ?? 0) + 1);
  }
  return [...by.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
}

/** Every distinct status and how many are in it. The whole set, so a status
 *  this code has never heard of shows up rather than being silently excluded
 *  from a "total". */
export function byStatus(rows: readonly PlatformSubscription[]): Array<[string, number]> {
  const by = new Map<string, number>();
  for (const r of rows) {
    const key = (r.status ?? '').trim() || 'Not stated';
    by.set(key, (by.get(key) ?? 0) + 1);
  }
  return [...by.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
}

/** Invoiced money in one currency. Never merged across currencies — Stripe
 *  bills different accounts in different money and USD 49 plus GBP 39 is not 88
 *  of anything. An invoice with no currency on it is counted separately rather
 *  than added to whichever pot happened to be first. */
export interface InvoicePot { currency: string; cents: number; count: number }

export interface InvoiceSum {
  pots: InvoicePot[];
  /** Invoices carrying an amount with no currency. Counted, never summed. */
  unlabelled: number;
  /** Invoices with no amount at all. */
  unpriced: number;
}

export function sumInvoices(rows: readonly PlatformInvoice[], statuses?: readonly string[]): InvoiceSum {
  const want = statuses ? new Set(statuses) : null;
  const by = new Map<string, InvoicePot>();
  let unlabelled = 0;
  let unpriced = 0;
  for (const r of rows) {
    if (want && !want.has((r.status ?? '').trim().toLowerCase())) continue;
    if (r.amountDue == null || !Number.isFinite(r.amountDue)) { unpriced += 1; continue; }
    const cur = (r.currency ?? '').trim().toUpperCase();
    if (!cur) { unlabelled += 1; continue; }
    const pot = by.get(cur);
    if (pot) { pot.cents += r.amountDue; pot.count += 1; }
    else by.set(cur, { currency: cur, cents: r.amountDue, count: 1 });
  }
  return {
    pots: [...by.values()].sort((a, b) => (b.cents - a.cents) || a.currency.localeCompare(b.currency)),
    unlabelled,
    unpriced,
  };
}

/** A pot, rendered — or a dash.
 *
 *  Every pot out of `sumInvoices` carries a currency by construction (the ones
 *  without are counted under `unlabelled` and never reach here), so the null
 *  branch is for a pot somebody built by hand, and a dash is the honest answer
 *  to an amount whose unit nobody stated. */
export const potLabel = (p: InvoicePot): string => minorMoney(p.cents, p.currency) ?? '\u2014';

/**
 * Invoices that need somebody to do something: open or uncollectible, or paid
 * only after Stripe had to try more than once.
 *
 * `attempt_count > 1` is in because a card that failed twice and then went
 * through is a card about to fail for good, and it is invisible in a "paid"
 * total. This is the one list on the screen that is meant to be acted on.
 */
export function needsAttention(rows: readonly PlatformInvoice[]): PlatformInvoice[] {
  return rows.filter((r) => {
    const s = (r.status ?? '').trim().toLowerCase();
    if (s === 'open' || s === 'uncollectible') return true;
    return (r.attemptCount ?? 0) > 1;
  });
}

/* ── the sentences ────────────────────────────────────────────────────────── */

export const NO_MRR_NOTE =
  'There is no MRR figure here, and that is deliberate. What a plan costs is not in this database — no column holds it and no table lists it — so any MRR would be a sum over three prices typed into a document, in one currency, ignoring coupons, annual plans and every price change since. What is below is what Stripe actually billed and what it was actually billed in.';

export const NOT_GYM_MONEY_NOTE =
  'This is what trainers and gyms pay Repple. It is not any gym’s own takings — those are on that gym’s own screens, in that gym’s own currency, and the two are never mixed.';

export const EMPTY_BOOK_NOTE =
  'No subscriptions and no invoices came back. On a project where nobody has subscribed yet that is the truth; if you expected rows, check that this account is on the platform_admins allowlist before concluding the business has no revenue.';

export const UNREAD_NOTE =
  'This read did not come back, so nothing here is a figure. Empty means unknown rather than nil.';

export const REFUSED_NOTE =
  'This console area is for Repple’s own billing and your account is not on the allowlist for it. Nothing is wrong with your account — the list is deliberately empty until somebody is added to it directly in the database.';
