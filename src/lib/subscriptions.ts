// Recurring packages — a client subscribes to a coach ("Online coaching, AED
// 600/month") instead of buying a pack once. The sibling of connect.ts: same
// trainer_packages row, same Connect checkout, same edge function. What lives
// here is everything that only exists because the charge REPEATS — is it still
// running, when does it renew, and how does somebody stop it.
//
// The one rule this file exists to hold: nothing here ever states that a
// subscription is active, or what somebody is paying, unless the server said
// so. `null` means "could not read", the same way it does in connect.ts, and it
// is not the same as "you are not subscribed" — which is the sentence that
// makes a paying client subscribe a second time.
import { Linking } from 'react-native';
import { appLink } from './deepLink';
import { supabase } from './supabase';
import { reportError } from './reportError';
import { capLimit, capped } from './rowCap';
import { minorMoney } from './coachMoney';
import type { LoadStatus } from '../ui/loadStatus';

export type BillingInterval = 'month' | 'year';

export interface ClientSubscription {
  id: string;
  client_id: string | null;
  trainer_id: string | null;
  package_id: string | null;
  stripe_subscription_id: string;
  status: string;
  /** Minor units (fils / cents), and null when Stripe never stated one. Null
   *  stays null all the way to the screen — see `pkgMoney`. */
  amount_cents: number | null;
  currency: string | null;
  billing_interval: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
}

/** A subscription that is costing the client money, or about to. Everything
 *  else — canceled, incomplete_expired, unpaid — is over, and a screen that
 *  lumps them together tells somebody they are subscribed to a coach they
 *  stopped paying in March. `past_due` is in here on purpose: the card failed,
 *  the subscription has NOT ended, and that is precisely when the client needs
 *  to see it and fix it. */
export const LIVE_STATUSES = ['trialing', 'active', 'past_due'] as const;
export const isLive = (s: string | null | undefined): boolean => !!s && (LIVE_STATUSES as readonly string[]).includes(s);

const STATUS_LABEL: Record<string, string> = {
  trialing: 'Trial', active: 'Active', past_due: 'Payment failed', unpaid: 'Unpaid',
  canceled: 'Cancelled', incomplete: 'Incomplete', incomplete_expired: 'Expired', paused: 'Paused',
};
/** Stripe's word, in English, or Stripe's word verbatim if it invents a new
 *  one. Never a word this app made up for a state it cannot confirm. */
export const statusLabel = (s: string | null | undefined): string => (s ? STATUS_LABEL[s] || s : '—');

export const intervalLabel = (i: string | null | undefined): string =>
  i === 'month' ? 'month' : i === 'year' ? 'year' : '';

/**
 * A package price, in MINOR units, in the currency that package is actually
 * sold in.
 *
 * Returns `null` — not "0", not "$0.00" — when the amount is unknown, so the
 * caller renders it through `fig()` as a dash. `money()` in src/lib/billing.ts
 * does `(cents ?? 0) / 100`, which turns an amount nobody knows into a free
 * membership, and it maps every currency it does not recognise onto '$', so a
 * coach charging AED 600 has been showing their clients "$600" — a different
 * amount, in a currency they do not take.
 *
 * It returns null for a MISSING CURRENCY too, and that is the important half.
 * Repple is white-labelled: a gym in London and a gym in Dubai run this code,
 * so there is no currency this function could fall back to that is not simply
 * wrong for one of them. A default that silently applies is worse than a
 * missing value, because "AED 600" on a London screen reads as a considered
 * figure rather than as a setting nobody has filled in. See tenants.currency in
 * part 99 — nullable on purpose, for exactly this reason.
 *
 * The code is printed rather than a symbol ("AED 600.00", "GBP 90.00") because
 * $ is only unambiguous when it is the only currency on screen, and in a
 * white-label product it never is.
 *
 * The body moved to `minorMoney` in coachMoney.ts, which is pure and therefore
 * testable — including the zero-decimal list, which used to exist here only and
 * had no test anywhere. Behaviour is unchanged; this stays as the name every
 * screen already imports.
 */
export function pkgMoney(minorUnits: number | null | undefined, currency: string | null | undefined): string | null {
  return minorMoney(minorUnits, currency);
}

/** "AED 600.00 / month" — the whole price of a recurring package as it is read
 *  aloud. Null when the amount is unknown; the interval alone is not a price. */
export function pkgPriceLine(minorUnits: number | null | undefined, currency: string | null | undefined, interval: string | null | undefined): string | null {
  const m = pkgMoney(minorUnits, currency);
  if (!m) return null;
  const i = intervalLabel(interval);
  return i ? `${m} / ${i}` : m;
}

const openUrl = async (url?: string | null) => { if (url) { try { await Linking.openURL(url); } catch { /* ignore */ } } };

/**
 * The currency the signed-in user's gym charges in — ISO 4217, uppercase, from
 * `tenants.currency` (part 99).
 *
 * `null` means the gym has not set one, and it is returned as null rather than
 * softened into anything: this is the value a coach prices a package in, and a
 * package priced in a currency nobody chose is a wrong number in front of a
 * paying customer every time it is shown. The caller renders a dash and asks
 * the owner to set it.
 *
 * `error` and a null currency are different again — one is "your gym has not
 * told us", the other is "we could not find out" — because the first is fixed
 * by an owner in settings and the second is fixed by trying again.
 */
export async function myTenantCurrency(): Promise<{ currency: string | null; error: string | null }> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return { currency: null, error: 'Not signed in.' };
    const { data: prof, error: profErr } = await supabase.from('profiles').select('tenant_id').eq('id', uid).maybeSingle();
    if (profErr) { reportError('subscriptions.myTenantCurrency.profile', profErr); return { currency: null, error: profErr.message }; }
    const tid = (prof as { tenant_id: string | null } | null)?.tenant_id ?? null;
    // No gym is not a failure, and it is not a currency either.
    if (!tid) return { currency: null, error: null };
    const { data, error } = await supabase.from('tenants').select('currency').eq('id', tid).maybeSingle();
    if (error) { reportError('subscriptions.myTenantCurrency.tenant', error); return { currency: null, error: error.message }; }
    const c = (data as { currency: string | null } | null)?.currency ?? null;
    return { currency: c ? c.toUpperCase() : null, error: null };
  } catch (e) { return { currency: null, error: (e as Error).message }; }
}

/**
 * The coach the signed-in client is linked to, so they can be shown what that
 * coach sells.
 *
 * `null` for both "no coach" and "could not read" would be the usual bug, but
 * the two lead to the same screen here — there is nothing to offer either way —
 * so the distinction is carried anyway and the caller decides which sentence to
 * print underneath.
 */
export async function myCoachId(): Promise<{ coachId: string | null; error: string | null }> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return { coachId: null, error: 'Not signed in.' };
    const { data, error } = await supabase.from('clients').select('trainer_id').eq('id', uid).maybeSingle();
    if (error) { reportError('subscriptions.myCoachId', error); return { coachId: null, error: error.message }; }
    return { coachId: (data as { trainer_id: string | null } | null)?.trainer_id ?? null, error: null };
  } catch (e) { return { coachId: null, error: (e as Error).message }; }
}

/**
 * The signed-in client's subscriptions, newest first.
 *
 * `[]` means they have never subscribed to anybody. **`null` means we could not
 * read them** — and the screen must not answer "you are not subscribed" with
 * it, because the obvious response to that sentence is to subscribe, and the
 * client is then paying their coach twice a month.
 */
export async function fetchMySubscriptions(): Promise<ClientSubscription[] | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return null;
    const { data, error } = await supabase.from('client_subscriptions').select('*')
      .eq('client_id', uid).order('created_at', { ascending: false });
    if (error) { reportError('subscriptions.fetchMySubscriptions', error); return null; }
    return (data as ClientSubscription[]) ?? [];
  } catch (e) { reportError('subscriptions.fetchMySubscriptions', e); return null; }
}

export interface Subscriber extends ClientSubscription {
  /** null when the name could not be read. The subscription is still real and
   *  still being paid; only the label is missing, and it renders as a dash. */
  client_name: string | null;
}

/**
 * Who is subscribed to the signed-in coach.
 *
 * Returns the rows AND how much to trust them, because two of the three answers
 * a coach can get here look identical as a list: 'ready' with nothing is a
 * coach nobody has subscribed to, 'error' with nothing is a coach who cannot be
 * told, and 'partial' is more subscribers than one read returns — on which a
 * count is not a count.
 */
export async function fetchMySubscribers(): Promise<{ rows: Subscriber[]; status: LoadStatus }> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return { rows: [], status: 'error' };
    const { data, error } = await supabase.from('client_subscriptions').select('*')
      .eq('trainer_id', uid).order('created_at', { ascending: false }).limit(capLimit());
    if (error) { reportError('subscriptions.fetchMySubscribers', error); return { rows: [], status: 'error' }; }
    const page = capped((data as ClientSubscription[]) ?? []);
    const ids = [...new Set(page.rows.map((r) => r.client_id).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (ids.length) {
      // Bounded by `ids`, which the cap above already holds at ROW_CAP or fewer.
      // no-error-ok: a name we cannot read stays null and renders as a dash; the subscription it labels is still real and still charging
      const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids).limit(capLimit());
      (profs ?? []).forEach((p: any) => { if (p?.id) names.set(p.id, (p.full_name || '').trim()); });
    }
    const rows: Subscriber[] = page.rows.map((r) => ({ ...r, client_name: (r.client_id && names.get(r.client_id)) || null }));
    return { rows, status: page.truncated ? 'partial' : 'ready' };
  } catch (e) { reportError('subscriptions.fetchMySubscribers', e); return { rows: [], status: 'error' }; }
}

/**
 * One paid renewal invoice — a row of `client_subscription_payments` (part
 * 132), which is the only place in this database where a subscription renewal
 * is recorded as an AMOUNT rather than as a status.
 */
export interface SubscriptionPayment {
  id: string;
  client_id: string | null;
  trainer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_invoice_id: string;
  /** Minor units, GROSS — what the client was charged. Stripe's processing fee
   *  and the platform's application fee are not deducted and are not known.
   *  Null when Stripe stated no amount, and null stays null: a renewal printed
   *  as "AED 0.00" is a lie about somebody's income. */
  amount_cents: number | null;
  currency: string | null;
  /** Stripe's own word — 'subscription_create' for the first payment,
   *  'subscription_cycle' for a renewal. Stored raw and never translated. */
  billing_reason: string | null;
  /** When Stripe says the money moved. Every period figure filters on this and
   *  never on `created_at`, so a webhook retried days later still counts in the
   *  month the client was actually charged. Null if Stripe stated none, in
   *  which case the payment is real but belongs to no month we can name. */
  paid_at: string | null;
  created_at: string;
}

/**
 * Every renewal the signed-in coach has actually been paid, newest first.
 *
 * The other half of `fetchClientPurchases` in connect.ts. That one is the
 * one-off sales; this is the recurring ones, and until part 132 it could not
 * exist — the webhook wrote a subscription's STATUS on a paid invoice and no
 * money row at all, so a year of a client paying AED 600 a month left nothing
 * that could be added up. The payments screen said so out loud rather than
 * print a figure it could not stand behind.
 *
 * Returns the rows AND how far they can be trusted, and it matters more here
 * than almost anywhere else in the app. 'ready' with nothing is a coach nobody
 * has renewed with. 'error' with nothing is a coach we could not ask. 'partial'
 * is more renewals than one read returns, on which no total may be quoted at
 * all — a subtotal of somebody's income printed as a month's earnings is a
 * plausible number with nothing about it to doubt.
 *
 * No policy was added for this: `client_sub_pay_read` in part 132 grants SELECT
 * where `trainer_id = auth.uid()` (and to the client who paid, and to the owner
 * of that coach's gym, through the tenant). Verified live.
 */
export async function fetchMySubscriptionPayments(): Promise<{ rows: SubscriptionPayment[]; status: LoadStatus }> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return { rows: [], status: 'error' };
    const { data, error } = await supabase.from('client_subscription_payments').select('*')
      .eq('trainer_id', uid).order('paid_at', { ascending: false }).limit(capLimit());
    if (error) { reportError('subscriptions.fetchMySubscriptionPayments', error); return { rows: [], status: 'error' }; }
    const page = capped((data as SubscriptionPayment[]) ?? []);
    return { rows: page.rows, status: page.truncated ? 'partial' : 'ready' };
  } catch (e) { reportError('subscriptions.fetchMySubscriptionPayments', e); return { rows: [], status: 'error' }; }
}

/** Client subscribes to a recurring package → Stripe Checkout in subscription
 *  mode. Same edge function as a one-off buy; the package's billing_interval is
 *  what decides which mode it opens, and the app is not trusted to say. */
export async function subscribeToPackage(packageId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('connect-checkout', {
      body: { package_id: packageId, success_url: appLink('purchase/success'), cancel_url: appLink('purchase/cancel') },
    });
    if (error) return { ok: false, error: error.message };
    if (data?.url) { await openUrl(data.url); return { ok: true }; }
    return { ok: false, error: data?.error || 'Could not start checkout.' };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/**
 * Stop a subscription at the end of the period the client has already paid for
 * — never immediately. They bought this month; cancelling should not take the
 * rest of it off them.
 *
 * The result is Stripe's answer, not ours. `ok: false` means it is still
 * running, which is exactly the case where a screen must not say "cancelled".
 */
export async function cancelSubscription(subscriptionId: string): Promise<{ ok: boolean; endsAt?: string | null; error?: string }> {
  return setCancelAtPeriodEnd(subscriptionId, 'cancel');
}

/** Undo a pending cancellation, while it is still pending. Without this the
 *  only way back is to subscribe again — at whatever the coach charges today. */
export async function resumeSubscription(subscriptionId: string): Promise<{ ok: boolean; endsAt?: string | null; error?: string }> {
  return setCancelAtPeriodEnd(subscriptionId, 'resume');
}

async function setCancelAtPeriodEnd(subscriptionId: string, action: 'cancel' | 'resume'): Promise<{ ok: boolean; endsAt?: string | null; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('connect-checkout', { body: { action, subscription_id: subscriptionId } });
    if (error) return { ok: false, error: error.message };
    if (data?.ok) return { ok: true, endsAt: data.current_period_end ?? null };
    return { ok: false, error: data?.error || 'The change did not go through.' };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** Stripe's hosted billing portal for the client's own coaching subscription —
 *  card, invoices, receipts. Not stripe-portal, which is the coach's Repple
 *  plan and looks the caller up as a trainer. */
export async function openSubscriptionPortal(subscriptionId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('connect-checkout', {
      body: { action: 'portal', subscription_id: subscriptionId, return_url: appLink('packages') },
    });
    if (error) return { ok: false, error: error.message };
    if (data?.url) { await openUrl(data.url); return { ok: true }; }
    return { ok: false, error: data?.error || 'Could not open billing.' };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
