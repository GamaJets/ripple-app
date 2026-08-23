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

/** The signed-in trainer's current subscription (or null). */
export async function fetchMySubscription(): Promise<Subscription | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return null;
    const { data } = await supabase.from('subscriptions').select('*').eq('trainer_id', uid).maybeSingle();
    return (data as Subscription) ?? null;
  } catch { return null; }
}

/** Owner dunning: invoices that failed / are unpaid, newest first. */
export async function fetchFailedInvoices(): Promise<Invoice[]> {
  try {
    const { data } = await supabase.from('invoices').select('*').in('status', ['open', 'uncollectible']).order('created_at', { ascending: false });
    return (data as Invoice[]) ?? [];
  } catch { return []; }
}

export const money = (cents: number | null, cur: string | null = 'usd'): string => {
  const v = (cents ?? 0) / 100;
  const sym = cur === 'gbp' ? '£' : cur === 'eur' ? '€' : '$';
  return sym + v.toLocaleString(undefined, { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
};
