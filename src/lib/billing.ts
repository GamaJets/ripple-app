// Stripe billing (platform subscriptions — the owner charges trainers). Talks to
// the stripe-checkout / stripe-portal edge functions and reads the subscriptions
// + invoices tables that the stripe-webhook keeps in sync. Credential-ready:
// activates once STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET are set as Supabase
// secrets and each plan's Stripe price id is provided via EXPO_PUBLIC_STRIPE_PRICE_*.
import { Linking } from 'react-native';
import { appLink } from './deepLink';
import { supabase } from './supabase';
// `currencyDecimals` is the one place that answers "how many minor units make a
// whole one", and it answers **null** rather than 2 when nobody said which
// money it is. This file used to import the zero-decimal LIST and branch on it
// by hand, which is how it stayed wrong for the five three-decimal currencies
// while looking swept.
import { currencyDecimals } from './coachMoney';
import { capLimit, capped } from './rowCap';
import type { LoadStatus } from '../ui/loadStatus';

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
 * Empty rows under 'ready' means nothing is outstanding. **'error' means we
 * could not find out.**
 *
 * This is the worst place in the app to conflate the two. The owner dashboard
 * renders the "Failed payments" callout only when this is non-empty, so a
 * refused read did not show an error — the callout simply was not there. An
 * owner sees a clean dashboard, concludes every payment went through, and
 * chases nobody. The money is missing and the screen that exists to say so is
 * the reason nobody looked.
 *
 * ── The third answer this read can give, which it could not say ────────────
 *
 * There was no `.limit()`, and no limit is not no ceiling: PostgREST applies
 * its own 1000 and says nothing about having applied it. app/(trainer)/money.tsx
 * prints this list's LENGTH as a sentence — "{n} invoices on your own account
 * are outstanding" — so at a thousand and one unpaid invoices that sentence
 * states a floor as a total, in the one place somebody is deciding how much
 * they owe. `capLimit()` asks for one row past the ceiling and `capped()` turns
 * the overflow into 'partial', which is a thing the screen can say out loud.
 *
 * `.in('status', …)` here is two string literals, not an id list, so this one
 * carries no request-line risk however many invoices exist; the chunking that
 * belongs on the uuid `.in()`s elsewhere in this repo would be noise here.
 */
export async function fetchFailedInvoices(): Promise<{ rows: Invoice[]; status: LoadStatus }> {
  try {
    const { data, error } = await supabase.from('invoices').select('*')
      .in('status', ['open', 'uncollectible'])
      // `.order('id')` behind the date, so which invoices the cap drops is the
      // same on every read rather than whatever Postgres does with a tie.
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .limit(capLimit());
    if (error) return { rows: [], status: 'error' };
    const page = capped((data as Invoice[]) ?? []);
    return { rows: page.rows, status: page.truncated ? 'partial' : 'ready' };
  } catch { return { rows: [], status: 'error' }; }
}

/**
 * A Stripe amount, in the currency Stripe says it is in.
 *
 * Two things this used to do, both of which matter more now Repple is to be
 * white-labelled:
 *
 *   · `(cents ?? 0) / 100` rendered an amount nobody had read as "$0". A plan
 *     price that failed to load looked like a free plan.
 *   · The symbol was `gbp → £`, `eur → €`, and EVERYTHING ELSE → `$`. So a
 *     gym billed in dirhams read its own invoices in dollars, and every
 *     currency Repple has not met yet reads as dollars too. A wrong symbol in
 *     front of a number is not a cosmetic problem — it is a different amount.
 *
 * Unknown is a dash, and an unrecognised currency prints its ISO code rather
 * than a symbol invented for it. An honest "AED 600.00" beats a confident
 * "$600.00" every time.
 *
 * \u2500\u2500 AND THE THIRD: IT DIVIDED BY A HUNDRED WHATEVER THE CURRENCY WAS \u2500\u2500\u2500\u2500\u2500\u2500
 *
 * `cents / 100` is only true of a currency that has hundredths. Sixteen of the
 * ones Stripe bills in do not \u2014 there is no sen in a yen, no jeon in a won \u2014
 * and for those the amount Stripe sends IS the whole-unit figure. A \u00a55,000
 * subscription was therefore printed as "JPY 50.00": a hundredth of what the
 * customer is actually being charged, on the screen they check to see what they
 * are being charged.
 *
 * \u2500\u2500 AND THE FOURTH, WHICH THE THIRD FIX HID \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 *
 * That fix imported `ZERO_DECIMAL` and branched on it, which is right for the
 * sixteen and still wrong for the five currencies with THREE places. BHD, JOD,
 * KWD, OMR and TND hold thousandths, so dividing by a hundred printed a
 * subscription at TEN TIMES what the gym is charged \u2014 and the import of the
 * zero-decimal list is precisely what made it invisible, because the file
 * looked as though it had been through the currency sweep. It had, for one of
 * the two lists.
 *
 * So the division is `currencyDecimals` and nothing else: one function, which
 * knows about both lists and returns null rather than a default.
 *
 * With NO currency the scale is unknown as well as the unit, because whether
 * this integer is hundredths or whole units is precisely what the currency
 * would have told us. So that branch prints the integer Stripe sent, undivided,
 * and says the currency was not read. A confident "6.00" there is a made-up
 * decimal point on top of a made-up currency.
 */
export const money = (cents: number | null, cur: string | null = null): string => {
  if (cents == null || !Number.isFinite(cents)) return '\u2014';
  const c = (cur || '').trim().toLowerCase();
  // Stripe always sends a currency, so its absence means the read did not land,
  // and guessing is what this whole function exists to refuse.
  if (!c) return `${cents.toLocaleString(undefined)} (currency not read)`;
  // `currencyDecimals`, not a zero/two branch. This function knew about the
  // sixteen zero-decimal currencies and not about the five THREE-decimal ones,
  // so for BHD, JOD, KWD, OMR and TND it divided thousandths by a hundred and
  // printed a subscription price TEN TIMES what the gym is charged — on a live
  // billing screen, in a form that reads as a considered figure. Half-adopting
  // the rule is what made it invisible: the import on line 13 said this file
  // had been through the currency sweep.
  const places = currencyDecimals(c);
  // Unreachable — currencyDecimals only answers null for an empty code, which
  // the line above already returned on. Written as a branch rather than a `!`
  // so that if it ever does answer null this prints the integer it was given
  // instead of scaling by NaN and rendering every figure as a dash.
  if (places == null) return `${cents.toLocaleString(undefined)} (currency not read)`;
  const v = places === 0 ? cents : cents / 10 ** places;
  const amount = v.toLocaleString(undefined, {
    minimumFractionDigits: v % 1 ? places : 0,
    maximumFractionDigits: places,
  });
  const sym = SYMBOLS[c];
  if (sym) return sym + amount;
  return `${c.toUpperCase()} ${amount}`;
};

/**
 * The three currencies Repple can draw a symbol for, keyed by the ISO code
 * Stripe sent.
 *
 * currency-ok: a TRANSLATION of a currency somebody stated, not a guess at one.
 * The code arrives on the invoice row and this table only chooses how to draw
 * it; anything absent falls through to its ISO code above rather than to a
 * symbol invented for it — which is the bug this replaced, where everything
 * that was not GBP or EUR rendered as dollars, dirhams included. The rule
 * check-currency.mjs enforces is that a figure must not state a currency NOBODY
 * CHOSE. Here somebody did, and it was the payment processor.
 *
 * It is a table rather than three `if`s so the literals live under this one
 * explanation instead of needing the marker repeated beside each of them.
 */
const SYMBOLS: Record<string, string> = { gbp: '£', eur: '€', usd: '$' };
