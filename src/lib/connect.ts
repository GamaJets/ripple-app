// Stripe Connect (marketplace) — trainers get paid by their clients. Trainers
// onboard an Express account and sell packages (memberships / session-packs);
// clients buy via Stripe Checkout, funds go to the trainer minus the platform fee.
// Trainers manage packages directly (RLS); money flows through the connect-* edge
// functions. Credential-ready: activates once Stripe Connect is enabled + keys set.
import { Linking } from 'react-native';
import { appLink } from './deepLink';
import { supabase } from './supabase';
import { reportError } from './reportError';

export interface ConnectStatus { stripe_account_id: string | null; charges_enabled: boolean; details_submitted: boolean }
/**
 * A thing a trainer sells.
 *
 * `sessions` and `billing_interval` are the two axes, and part 97 forbids both
 * at once: null/null is a one-off membership, N sessions is a pack bought once
 * and drawn down, and 'month'/'year' is a subscription that charges again.
 *
 * `currency` is per package and is the only currency any figure about that
 * package may be printed in — never a literal, and never the gym's current
 * setting either, because a package sold last year in one currency was sold in
 * that one whatever the gym charges in today.
 *
 * The column still carries `default 'usd'` from 21-connect, which predates the
 * product being white-labelled and should inherit the tenant's currency
 * instead. Nothing in this file relies on it: `createPackage` refuses to insert
 * without an explicit currency, so the default is never the value that lands.
 * See `pkgMoney` in src/lib/subscriptions.ts and tenants.currency in part 99.
 */
export interface TrainerPackage { id: string; trainer_id: string; name: string; price_cents: number; currency: string; sessions: number | null; billing_interval: string | null; active: boolean }
export interface Purchase { id: string; trainer_id: string | null; package_id: string | null; amount_cents: number | null; sessions_total: number | null; sessions_used: number; status: string; created_at: string }

const openUrl = async (url?: string | null) => { if (url) { try { await Linking.openURL(url); } catch { /* ignore */ } } };

/** Start / resume Stripe Express onboarding for the signed-in trainer. */
export async function startTrainerOnboarding(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('connect-onboard', { body: { refresh_url: appLink('connect/refresh'), return_url: appLink('connect/return') } });
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
    // A refused read used to fall through to the same default a trainer with no
    // account gets — telling somebody who IS set up for payments that they are
    // not. null means "could not read"; the caller renders that differently.
    const { data, error } = await supabase.from('connect_accounts').select('*').eq('trainer_id', uid).maybeSingle();
    if (error) { reportError('connect.fetchMyConnect', error); return null; }
    return (data as ConnectStatus) ?? { stripe_account_id: null, charges_enabled: false, details_submitted: false };
  } catch { return null; }
}

/**
 * Packages the signed-in trainer sells.
 *
 * `[]` means they sell none. **`null` means we could not read them**, which the
 * payments screen must not render as "no packages yet" — a trainer told that
 * about their own price list will build it a second time, and their clients see
 * duplicates of everything they already sell.
 */
export async function fetchMyPackages(): Promise<TrainerPackage[] | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return null;
    const { data, error } = await supabase.from('trainer_packages').select('*').eq('trainer_id', uid).order('created_at', { ascending: false });
    if (error) return null;
    return (data as TrainerPackage[]) ?? [];
  } catch { return null; }
}

/**
 * Put a package on sale.
 *
 * `billing_interval` omitted or null keeps the behaviour every existing caller
 * had: a one-off charge. 'month' or 'year' makes it a subscription, and the
 * client is then charged again every month or year until somebody stops it —
 * which is a large enough difference that it is never inferred from anything,
 * only ever passed in explicitly.
 */
export async function createPackage(p: { name: string; price_cents: number; sessions: number | null; currency: string; billing_interval?: 'month' | 'year' | null }): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return { ok: false, error: 'Not signed in.' };
    // No fallback currency, on purpose. This used to be `p.currency || 'usd'`,
    // which is a literal that silently applies — and Repple is white-labelled,
    // so there is no currency that is right for both a London gym and a Dubai
    // one. A package with no currency is not created; the coach is told the gym
    // has not set one. See tenants.currency (part 99).
    const currency = (p.currency || '').trim();
    if (!currency) return { ok: false, error: 'Your gym has not set a currency yet, so there is nothing to price this in. An owner sets it in the gym settings.' };
    const interval = p.billing_interval ?? null;
    // Part 97 refuses this combination in the database; refusing it here too
    // turns a constraint violation into a sentence. A recurring pack would
    // charge again every month for credits that are granted once.
    if (interval && p.sessions != null) return { ok: false, error: 'A recurring package cannot also be a session pack — sessions are granted once and nothing renews them.' };
    const { error } = await supabase.from('trainer_packages').insert({ trainer_id: uid, name: p.name, price_cents: p.price_cents, sessions: p.sessions, billing_interval: interval, currency, active: true });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/**
 * Stop selling a package. Returns whether it actually stopped.
 *
 * Returned void and swallowed the error, so the screen refreshed and said
 * nothing either way — a trainer who "removed" a package that is still on sale
 * keeps selling something they believe they withdrew, and finds out when
 * somebody buys it.
 */
export async function deactivatePackage(id: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('trainer_packages').update({ active: false }).eq('id', id);
    return !error;
  } catch { return false; }
}

/**
 * Active packages a client can buy from a given trainer.
 *
 * `[]` means this trainer sells none. **`null` means we could not read them** —
 * the same distinction fetchMyPackages already makes, and this twin did not.
 * A client shown "this coach sells nothing" because a read failed is a lost
 * sale explained as a fact about the coach.
 */
export async function fetchTrainerPackages(trainerId: string): Promise<TrainerPackage[] | null> {
  try {
    const { data, error } = await supabase.from('trainer_packages').select('*').eq('trainer_id', trainerId).eq('active', true).order('price_cents', { ascending: true });
    if (error) { reportError('connect.fetchTrainerPackages', error); return null; }
    return (data as TrainerPackage[]) ?? [];
  } catch { return null; }
}

/**
 * The currency each of a set of packages is priced in.
 *
 * `client_purchases` records `amount_cents` and no currency at all, so the only
 * place the unit of a past purchase is written down is the package it was
 * bought from. That makes an amount unlabelled whenever the package is gone or
 * unreadable — an inactive package is invisible to the client who bought it
 * under the pkg_read policy — and an unlabelled amount renders as a dash rather
 * than as a number in a currency we picked.
 *
 * Ids absent from the returned map are ids we could not label. A read that
 * fails returns an empty map, which lands in the same place: dashes, not
 * dollars.
 */
export async function packageCurrencies(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  try {
    const { data, error } = await supabase.from('trainer_packages').select('id, currency').in('id', unique);
    if (error) { reportError('connect.packageCurrencies', error); return new Map(); }
    return new Map(((data as { id: string; currency: string | null }[]) ?? []).filter((p) => p.currency).map((p) => [p.id, p.currency as string]));
  } catch (e) { reportError('connect.packageCurrencies', e); return new Map(); }
}

/** Client buys a package → Stripe Checkout (funds to the trainer, minus fee). */
export async function buyPackage(packageId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('connect-checkout', { body: { package_id: packageId, success_url: appLink('purchase/success'), cancel_url: appLink('purchase/cancel') } });
    if (error) return { ok: false, error: error.message };
    if (data?.url) { await openUrl(data.url); return { ok: true }; }
    return { ok: false, error: data?.error || 'Could not start checkout.' };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/**
 * The signed-in client's purchases (session-pack balances).
 *
 * `[]` means they have bought nothing. **`null` means we could not read it** —
 * and the packages screen renders "No purchases yet" for an empty list, so a
 * refused read told a paying customer their money bought nothing. That is the
 * single worst sentence this app can show someone who has paid.
 */
export async function fetchMyPurchases(): Promise<Purchase[] | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return null;
    const { data, error } = await supabase.from('client_purchases').select('*').eq('client_id', uid).order('created_at', { ascending: false });
    if (error) return null;
    return (data as Purchase[]) ?? [];
  } catch { return null; }
}

/**
 * Sessions remaining across the client's active packs (optionally for one trainer).
 *
 * **`null` means we could not count them**, and is not the same as `0`.
 *
 * This returned `0` on a failed read, which is a number, and a wrong one. Two
 * things on the calendar screen are decided by it, and a fabricated zero got
 * both backwards for the one client it matters most to — somebody holding
 * credits whose read just failed:
 *
 *   - the "Pack credits" row silently disappears, so they cannot see the
 *     balance they paid for;
 *   - `hadCredits` goes false, which SUPPRESSES the warning that a booking was
 *     not drawn from their pack. They book, nothing is deducted, and the app
 *     says nothing at all, because it believes there was no pack to deduct from.
 *
 * The two functions on either side of this one — `fetchMyPurchases` above and
 * `redeemSession` below — were both fixed for exactly this. This one was
 * missed, and it feeds the screen the other two protect.
 */
export async function sessionsRemaining(trainerId?: string): Promise<number | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return null;
    let q = supabase.from('client_purchases').select('sessions_total, sessions_used').eq('client_id', uid).eq('status', 'paid').not('sessions_total', 'is', null);
    if (trainerId) q = q.eq('trainer_id', trainerId);
    const { data, error } = await q;
    if (error) { reportError('connect.sessionsRemaining', error); return null; }
    if (!data) return null;
    return (data as { sessions_total: number | null; sessions_used: number }[])
      .reduce((a, r) => a + Math.max(0, (r.sessions_total || 0) - r.sessions_used), 0);
  } catch (e) { reportError('connect.sessionsRemaining', e); return null; }
}

/** Draw down one credit from the client's oldest active pack for a trainer.
 *  Best-effort: no-ops (ok:false) when there is no pack — booking still proceeds. */
export async function redeemSession(trainerId: string): Promise<{ ok: boolean; remaining?: number; error?: string }> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return { ok: false, error: 'Not signed in.' };
    const { data, error: readErr } = await supabase.from('client_purchases').select('*').eq('client_id', uid).eq('trainer_id', trainerId).eq('status', 'paid').not('sessions_total', 'is', null).order('created_at', { ascending: true });
    // A refused read was becoming "No sessions left in a pack" — telling
    // somebody who has paid for ten that they have none. Different sentence.
    if (readErr) {
      reportError('connect.redeemSession.read', readErr);
      return { ok: false, error: 'Your session packs could not be read, so none was drawn down. This is not the same as having none left.' };
    }
    const packs = (data as Purchase[]) ?? [];
    const pack = packs.find((p) => (p.sessions_total || 0) - p.sessions_used > 0);
    if (!pack) return { ok: false, error: 'No sessions left in a pack.' };
    const { error } = await supabase.from('client_purchases').update({ sessions_used: pack.sessions_used + 1 }).eq('id', pack.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, remaining: (pack.sessions_total || 0) - pack.sessions_used - 1 };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** The trainer OTHER clients, to push a freed slot to. Server-side lookup so no
 *  other-client identity leaks to the caller beyond opaque ids. */
export async function reofferSlot(sessionId: string): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc('reoffer_client_ids', { p_session: sessionId });
    if (error) { reportError('connect.reofferSlot', error); return []; }
    return Array.isArray(data) ? data.map((r: any) => r.client_id).filter(Boolean) : [];
  } catch { return []; }
}

/** Refund one credit (e.g. the client cancelled a booked session). Best-effort. */
export async function refundSession(trainerId: string): Promise<{ ok: boolean }> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return { ok: false };
    const { data, error: readErr } = await supabase.from('client_purchases').select('*').eq('client_id', uid).eq('trainer_id', trainerId).eq('status', 'paid').not('sessions_total', 'is', null).order('created_at', { ascending: false });
    // A credit not returned because the read failed is a credit taken. Report
    // it rather than resolving false, which reads as "nothing to refund".
    if (readErr) { reportError('connect.refundSession.read', readErr); return { ok: false }; }
    const pack = ((data as Purchase[]) ?? []).find((p) => p.sessions_used > 0);
    if (!pack) return { ok: false };
    const { error } = await supabase.from('client_purchases').update({ sessions_used: pack.sessions_used - 1 }).eq('id', pack.id);
    return { ok: !error };
  } catch { return { ok: false }; }
}
