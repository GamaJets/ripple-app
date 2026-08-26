// Stripe billing (platform subscriptions — the owner charges trainers). Talks to
// the stripe-checkout / stripe-portal edge functions and reads the subscriptions
// + invoices tables that the stripe-webhook keeps in sync. Credential-ready:
// activates once STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET are set as Supabase
// secrets and each plan's Stripe price id is provided via EXPO_PUBLIC_STRIPE_PRICE_*.
import { Linking } from 'react-native';
import { appLink } from './deepLink';
import { supabase } from './supabase';

export interface Subscription { trainer_id: string; plan: string | null; status: string | null; current_period_end: string | null; cancel_at_period_end: boolean }
export interface Invoice { id: string; trainer_id: string | null; amount_due: number | null; currency: string | null; status: string | null; attempt_count: number | null; hosted_invoice_url: string | null; created_at: string }

// Stripe price id per plan name — set in eas.json env once created in Stripe.
export const PRICE_IDS: Record<string, string | undefined> = {
  Starter: process.env.EXPO_PUBLIC_STRIPE_PRICE_STARTER,
  Pro: process.env.EXPO_PUBLIC_STRIPE_PRICE_PRO,
  Studio: process.env.EXPO_PUBLIC_STRIPE_PRICE_STUDIO,
};

/** Billing is wired the moment at least one plan has a Stripe price id. */
export const billingAvailable = (): boolean => Object.values(PRICE_IDS).some(Boolean);

const openUrl = async (url?: string | null) => { if (url) { try { await Linking.openURL(url); } catch { /* ignore */ } } };

/** Start a subscription checkout for the signed-in trainer; opens Stripe Checkout. */
export async function subscribeToPlan(planName: string): Promise<{ ok: boolean; error?: string }> {
  const priceId = PRICE_IDS[planName];
  if (!priceId) return { ok: false, error: 'This plan has no Stripe price id yet (set EXPO_PUBLIC_STRIPE_PRICE_' + planName.toUpperCase() + ').' };
  try {
    const { data, error } = await supabase.functions.invoke('stripe-checkout', { body: { price_id: priceId, success_url: appLink('billing/success'), cancel_url: appLink('billing/cancel') } });
    if (error) return { ok: false, error: error.message };
    if (data?.url) { await openUrl(data.url); return { ok: true }; }
    return { ok: false, error: data?.error || 'No checkout url returned.' };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** Open the Stripe billing portal for the signed-in trainer. */
export async function openBillingPortal(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('stripe-portal', { body: { return_url: appLink('billing') } });
    if (error) return { ok: false, error: error.message };
    if (data?.url) { await openUrl(data.url); return { ok: true }; }
    return { ok: false, error: data?.error || 'No portal url returned.' };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/**
 * The signed-in trainer's current subscription.
 *
 * `{ sub: null }` means they have none; `{ error }` means we could not find
 * out. The old signature collapsed both into `null`, so a failed read rendered
 * the "no plan — subscribe" state at somebody who is already paying. The
 * obvious response to that screen is to subscribe again.
 */
export async function fetchMySubscription(): Promise<{ sub: Subscription | null; error: string | null }> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return { sub: null, error: 'Not signed in.' };
    const { data, error } = await supabase.from('subscriptions').select('*').eq('trainer_id', uid).maybeSingle();
    if (error) return { sub: null, error: error.message };
    return { sub: (data as Subscription) ?? null, error: null };
  } catch (e) { return { sub: null, error: (e as Error).message }; }
}

/**
 * Owner dunning: invoices that failed or are unpaid, newest first.
 *
 * `[]` means nothing is outstanding. **`null` means we could not find out.**
 *
 * This is the worst place in the app to conflate the two. The owner dashboard
 * renders the "Failed payments" callout only when this is non-empty, so a
 * refused read did not show an error — the callout simply was not there. An
 * owner sees a clean dashboard, concludes every payment went through, and
 * chases nobody. The money is missing and the screen that exists to say so is
 * the reason nobody looked.
 */
export async function fetchFailedInvoices(): Promise<Invoice[] | null> {
  try {
    const { data, error } = await supabase.from('invoices').select('*').in('status', ['open', 'uncollectible']).order('created_at', { ascending: false });
    if (error) return null;
    return (data as Invoice[]) ?? [];
  } catch { return null; }
}

export const money = (cents: number | null, cur: string | null = 'usd'): string => {
  const v = (cents ?? 0) / 100;
  const sym = cur === 'gbp' ? '£' : cur === 'eur' ? '€' : '$';
  return sym + v.toLocaleString(undefined, { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
};
