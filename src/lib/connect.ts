// Stripe Connect (marketplace) — trainers get paid by their clients. Trainers
// onboard an Express account and sell packages (memberships / session-packs);
// clients buy via Stripe Checkout, funds go to the trainer minus the platform fee.
// Trainers manage packages directly (RLS); money flows through the connect-* edge
// functions. Credential-ready: activates once Stripe Connect is enabled + keys set.
import { Linking } from 'react-native';
import { supabase } from './supabase';

export interface ConnectStatus { stripe_account_id: string | null; charges_enabled: boolean; details_submitted: boolean }
export interface TrainerPackage { id: string; trainer_id: string; name: string; price_cents: number; currency: string; sessions: number | null; active: boolean }
export interface Purchase { id: string; trainer_id: string | null; package_id: string | null; amount_cents: number | null; sessions_total: number | null; sessions_used: number; status: string; created_at: string }

const openUrl = async (url?: string | null) => { if (url) { try { await Linking.openURL(url); } catch { /* ignore */ } } };

/** Start / resume Stripe Express onboarding for the signed-in trainer. */
export async function startTrainerOnboarding(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('connect-onboard', { body: { refresh_url: 'repple://connect/refresh', return_url: 'repple://connect/return' } });
    if (error) return { ok: false, error: error.message };
    if (data?.url) { await openUrl(data.url); return { ok: true }; }
    return { ok: false, error: data?.error || 'Could not start onboarding.' };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** The signed-in trainer's Connect account status. */
export async function fetchMyConnect(): Promise<ConnectStatus | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return null;
    const { data } = await supabase.from('connect_accounts').select('*').eq('trainer_id', uid).maybeSingle();
    return (data as ConnectStatus) ?? { stripe_account_id: null, charges_enabled: false, details_submitted: false };
  } catch { return null; }
}

/** Packages the signed-in trainer sells. */
export async function fetchMyPackages(): Promise<TrainerPackage[]> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return [];
    const { data } = await supabase.from('trainer_packages').select('*').eq('trainer_id', uid).order('created_at', { ascending: false });
    return (data as TrainerPackage[]) ?? [];
  } catch { return []; }
}

export async function createPackage(p: { name: string; price_cents: number; sessions: number | null; currency?: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return { ok: false, error: 'Not signed in.' };
    const { error } = await supabase.from('trainer_packages').insert({ trainer_id: uid, name: p.name, price_cents: p.price_cents, sessions: p.sessions, currency: p.currency || 'usd', active: true });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function deactivatePackage(id: string): Promise<void> {
  try { await supabase.from('trainer_packages').update({ active: false }).eq('id', id); } catch { /* ignore */ }
}

/** Active packages a client can buy from a given trainer. */
export async function fetchTrainerPackages(trainerId: string): Promise<TrainerPackage[]> {
  try {
    const { data } = await supabase.from('trainer_packages').select('*').eq('trainer_id', trainerId).eq('active', true).order('price_cents', { ascending: true });
    return (data as TrainerPackage[]) ?? [];
  } catch { return []; }
}

/** Client buys a package → Stripe Checkout (funds to the trainer, minus fee). */
export async function buyPackage(packageId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('connect-checkout', { body: { package_id: packageId, success_url: 'repple://purchase/success', cancel_url: 'repple://purchase/cancel' } });
    if (error) return { ok: false, error: error.message };
    if (data?.url) { await openUrl(data.url); return { ok: true }; }
    return { ok: false, error: data?.error || 'Could not start checkout.' };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** The signed-in client's purchases (session-pack balances). */
export async function fetchMyPurchases(): Promise<Purchase[]> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return [];
    const { data } = await supabase.from('client_purchases').select('*').eq('client_id', uid).order('created_at', { ascending: false });
    return (data as Purchase[]) ?? [];
  } catch { return []; }
}

/** Sessions remaining across the client's active packs (optionally for one trainer). */
export async function sessionsRemaining(trainerId?: string): Promise<number> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return 0;
    let q = supabase.from('client_purchases').select('sessions_total, sessions_used').eq('client_id', uid).eq('status', 'paid').not('sessions_total', 'is', null);
    if (trainerId) q = q.eq('trainer_id', trainerId);
    const { data } = await q;
    return ((data as { sessions_total: number | null; sessions_used: number }[]) ?? []).reduce((a, r) => a + Math.max(0, (r.sessions_total || 0) - r.sessions_used), 0);
  } catch { return 0; }
}

/** Draw down one credit from the client's oldest active pack for a trainer.
 *  Best-effort: no-ops (ok:false) when there is no pack — booking still proceeds. */
export async function redeemSession(trainerId: string): Promise<{ ok: boolean; remaining?: number; error?: string }> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return { ok: false, error: 'Not signed in.' };
    const { data } = await supabase.from('client_purchases').select('*').eq('client_id', uid).eq('trainer_id', trainerId).eq('status', 'paid').not('sessions_total', 'is', null).order('created_at', { ascending: true });
    const packs = (data as Purchase[]) ?? [];
    const pack = packs.find((p) => (p.sessions_total || 0) - p.sessions_used > 0);
    if (!pack) return { ok: false, error: 'No sessions left in a pack.' };
    const { error } = await supabase.from('client_purchases').update({ sessions_used: pack.sessions_used + 1 }).eq('id', pack.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, remaining: (pack.sessions_total || 0) - pack.sessions_used - 1 };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** Refund one credit (e.g. the client cancelled a booked session). Best-effort. */
export async function refundSession(trainerId: string): Promise<{ ok: boolean }> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return { ok: false };
    const { data } = await supabase.from('client_purchases').select('*').eq('client_id', uid).eq('trainer_id', trainerId).eq('status', 'paid').not('sessions_total', 'is', null).order('created_at', { ascending: false });
    const pack = ((data as Purchase[]) ?? []).find((p) => p.sessions_used > 0);
    if (!pack) return { ok: false };
    const { error } = await supabase.from('client_purchases').update({ sessions_used: pack.sessions_used - 1 }).eq('id', pack.id);
    return { ok: !error };
  } catch { return { ok: false }; }
}
