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
import { readByIds } from './idLookup';
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

/**
 * Open a Stripe-issued URL, and SAY whether it opened.
 *
 * It used to swallow the failure — an empty catch and no return value — so
 * every caller here could only ever learn that a URL had come back,
 * never that a browser had taken it. `Linking.openURL` rejects when nothing on
 * the device can handle the URL, and on some platforms it resolves `false`
 * instead of throwing; both are the same failure and both come back false.
 *
 * This is `openUrl` in src/lib/connect.ts, verbatim, for the reason that file
 * gives at length: the member is left staring at a screen that says their
 * purchase will appear once Stripe confirms it, waiting on a checkout that was
 * never reached. The one-off arm has answered honestly since; the subscription
 * arm in this file did not, and app/(client)/packages.tsx says so in a comment
 * naming this module.
 */
const openUrl = async (url?: string | null): Promise<boolean> => {
  if (!url) return false;
  try {
    const r = await Linking.openURL(url);
    return r !== false;
  } catch { return false; }
};

/** What a member is told when the URL was issued and nothing opened. Their
 *  money has not moved: the checkout was never reached. */
const BROWSER_DID_NOT_OPEN = 'Your browser did not open, so nothing has been started and nothing has been charged. Try again in a moment.';

/** The same, for the billing portal — where there was nothing to charge in the
 *  first place, so saying "nothing has been charged" would answer a question
 *  nobody asked and imply one had been in prospect. */
const PORTAL_DID_NOT_OPEN = 'Your browser did not open, so your billing page could not be shown. Nothing about your subscription has changed. Try again in a moment.';

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
 *
 * ── This function answers about a GYM, and only about a gym ───────────────
 *
 * It is not the whole answer any more and it is deliberately unchanged.
 * `{ currency: null, error: null }` here means "this account is attached to no
 * gym", which used to be the end of the road: there was no other place a
 * currency could live, so every screen correctly withheld every figure and told
 * the coach to go and find a gym owner who did not exist.
 *
 * Part 940 gives a coach with no gym a currency of their own on
 * `trainers.currency`, and `fetchMyCurrency()` in src/lib/myCurrency.ts is the
 * read that puts the two in order — the gym first, always, and the coach's own
 * ONLY when there is provably no gym. A screen that needs to know what this
 * coach is priced in should call that one.
 *
 * This is left as it is rather than widened because widening it would change
 * what five existing callers are being told, silently, in the direction of
 * "there is always an answer". `assistant.tsx`, `analytics.tsx` and
 * `src/ui/coachSetup.ts` still ask this question and still get the gym's
 * answer; moving them is a separate, visible edit.
 */
// ── myTenantCurrency() lived here, and is gone ────────────────────────────
//
// It answered "what does this coach's GYM charge in", and for as long as that
// was the only place a currency could live it was the whole answer. Part 940
// gave a coach with no gym a currency of their own, and `resolveMyCurrency` in
// src/lib/currencySource.ts is now the read that puts the two in order — the
// gym first, always, and the coach's own ONLY when there is provably no gym.
//
// Its own doc comment used to end by naming `assistant.tsx`, `analytics.tsx`
// and `src/ui/coachSetup.ts` as callers it had deliberately not moved. All
// three have moved, and it was left with no caller outside its own test — which
// `check:dead-exports` then failed on, correctly.
//
// Deleted rather than marked `unused-ok:`, because there was no reason to keep
// it that survived being written down: an unwired function whose every remaining
// mention is a comment explaining what replaced it is not a spare part, it is a
// second answer waiting for somebody to call it. The name is left here so the
// comments in currencySource.ts and currencyGap.ts that still cite it by name
// have something to point at.

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
    try {
      // Chunked, and the limit being argued about here is the REQUEST LINE, not
      // the row cap. `ids` is bounded by the `capLimit()` read above, so a coach
      // with a full page of subscribers sends a thousand uuids; at ~39 bytes
      // each inside `in.("…","…")` that is ~39KB against the 8KB request line
      // nginx and most CDNs enforce by default. Past roughly two hundred ids
      // the proxy answers 414, supabase-js does not reject on it, and it
      // arrives as `data: null` — which reads exactly like no names.
      //
      // no-error-ok (about the ROW ceiling, which one row per id across chunks
      // of 150 cannot reach): a name we cannot read stays null and renders as a
      // dash; the subscription it labels is still real and still charging. The
      // 414 is a different event and that argument never covered it — it is
      // EVERY name at once, so a coach's recurring-income list becomes a column
      // of dashes and there is nobody on it to cancel, chase or thank.
      const profs = await readByIds<any>(
        ids,
        // `.order('id')` on a primary-key lookup is total, which is the
        // contract `readAll` requires of every page it is handed.
        (chunk, from, to) => supabase.from('profiles').select('id, full_name')
          .in('id', chunk).order('id', { ascending: true }).range(from, to),
        'the names of the clients subscribed to you',
      );
      profs.forEach((p: any) => { if (p?.id) names.set(p.id, (p.full_name || '').trim()); });
    } catch { /* a name that will not read is a dash; the subscription is still listed */ }
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
  /** Minor units already given back on this renewal (part 192). ZERO, never
   *  null, on one nobody has refunded — the column has a default and only
   *  supabase/functions/connect-refund writes it, from Stripe's own answer.
   *  Read as the CEILING on the next refund, so a second partial one is
   *  bounded by what remains rather than by what was charged. */
  refunded_cents?: number | null;
  /** When the LAST refund on this renewal was made. Stripe holds the full
   *  list; this app deliberately keeps no copy of it. */
  refunded_at?: string | null;
  /** The connected account this renewal was charged ON, or null for the
   *  platform (part 310). A fact about THIS invoice rather than about the
   *  coach's current setting: a coach who has since moved to direct charges
   *  still has older renewals on the platform, and a refund issued in the
   *  wrong context is answered with "No such charge". */
  stripe_account_id?: string | null;
  /** Who paid it, resolved from `profiles` by the coach-side read below.
   *  Null when the name could not be read, which renders as a dash — the
   *  renewal is still real and still refundable. */
  client_name?: string | null;
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
 *
 * `select('*')` carries part 192's `refunded_cents` / `refunded_at` and part
 * 310's `stripe_account_id` with it, which is what lets the Renewals Paid list
 * on app/(trainer)/payments.tsx say how much of each renewal still stands and
 * whose balance giving it back would leave. The client's NAME is a second read
 * below, because these rows carry an id and a coach refunding "last month"
 * cannot pick between three invoice ids.
 */
export async function fetchMySubscriptionPayments(): Promise<{ rows: SubscriptionPayment[]; status: LoadStatus }> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id; if (!uid) return { rows: [], status: 'error' };
    const { data, error } = await supabase.from('client_subscription_payments').select('*')
      .eq('trainer_id', uid).order('paid_at', { ascending: false }).limit(capLimit());
    if (error) { reportError('subscriptions.fetchMySubscriptionPayments', error); return { rows: [], status: 'error' }; }
    const page = capped((data as SubscriptionPayment[]) ?? []);

    // Who paid it. Needed because a coach refunding "last month" has to be
    // able to tell one renewal from another, and an invoice id is not a
    // person. The same second read `fetchClientPurchases` makes, for the same
    // reason and with the same failure: a name that will not read stays null
    // and renders as a dash, which is a renewal whose client we could not
    // name rather than a renewal that did not happen.
    const clientIds = [...new Set(page.rows.map((r) => r.client_id).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    try {
      // Chunked for the request line, exactly as in `fetchMySubscribers` above:
      // a thousand `capLimit()`-bounded ids is a ~39KB `in.(…)` against an 8KB
      // request line, refused at roughly two hundred with a 414 that arrives as
      // `data: null`.
      //
      // no-error-ok (about the ROW ceiling — one row per id, chunks of 150): a
      // name we cannot read stays null and renders as a dash; the renewal it
      // labels was still paid and can still be refunded. The 414 is the case
      // that argument does not reach: this is the list a coach refunds FROM,
      // and every row unnamed at once means picking between three invoice ids
      // with money attached to them.
      const profs = await readByIds<any>(
        clientIds,
        (chunk, from, to) => supabase.from('profiles').select('id, full_name')
          .in('id', chunk).order('id', { ascending: true }).range(from, to),
        'the names of the clients these renewals were charged to',
      );
      profs.forEach((p: any) => { if (p?.id) names.set(p.id, (p.full_name || '').trim()); });
    } catch { /* a name that will not read is a dash; the renewal is still listed */ }
    const rows: SubscriptionPayment[] = page.rows.map((r) => ({
      ...r,
      client_name: (r.client_id && names.get(r.client_id)) || null,
    }));
    return { rows, status: page.truncated ? 'partial' : 'ready' };
  } catch (e) { reportError('subscriptions.fetchMySubscriptionPayments', e); return { rows: [], status: 'error' }; }
}

/**
 * Client subscribes to a recurring package → Stripe Checkout in subscription
 * mode. Same edge function as a one-off buy; the package's billing_interval is
 * what decides which mode it opens, and the app is not trusted to say.
 *
 * `code` is the coach's own discount code, as the client typed it. Sent WITH
 * the session request rather than collected on Stripe's hosted page, and the
 * reason is in `checkoutCodeBlocker` in src/lib/packagePromo.ts: the
 * restriction of a code to one package is recorded in Stripe metadata that
 * Stripe does not enforce, so a box on Stripe's page is a box nothing in this
 * repo can check. Omitted means no code, which is the ordinary case and takes
 * the path it always did.
 *
 * There is deliberately no equivalent on `buyPackage`. A one-off refuses a
 * code — Repple's cut there is an absolute fee that has to be sent in the same
 * call that creates the session, so it cannot be derived from the discounted
 * total Stripe computes inside that call — and connect-checkout refuses one on
 * that branch whoever sends it.
 */
export async function subscribeToPackage(packageId: string, code?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const promo = String(code ?? '').trim();
    const { data, error } = await supabase.functions.invoke('connect-checkout', {
      body: {
        package_id: packageId,
        success_url: appLink('purchase/success'),
        cancel_url: appLink('purchase/cancel'),
        ...(promo ? { promo_code: promo } : {}),
      },
    });
    if (error) return { ok: false, error: error.message };
    // `ok` means a browser opened, not that a URL came back. It used to mean
    // the second, and app/(client)/packages.tsx clears the typed discount code
    // on `ok` — so a member whose browser refused the URL was shown no alert,
    // watched the button stop saying "Opening…", saw nothing open, and lost
    // the code they had typed. src/lib/connect.ts `buyPackage` is this line.
    if (data?.url) return (await openUrl(data.url)) ? { ok: true } : { ok: false, error: BROWSER_DID_NOT_OPEN };
    return { ok: false, error: data?.error || 'Could not start checkout.' };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/**
 * Stop a subscription at the end of the period the client has already paid for
 * — never immediately. They bought this month; cancelling should not take the
 * rest of it off them.
 *
 * EITHER PARTY may call this: the client from their Memberships screen, and the
 * coach from Payments. Both go to the same `connect-checkout` action, which
 * reads the subscription and asks who the caller is to it — see
 * src/lib/subscriptionScope.ts. It used to scope its lookup to
 * `client_id = auth.uid()`, so a coach calling it got "subscription not found"
 * every time and the coach's screen said out loud that it had no button.
 *
 * A refund is NOT here, and that is now a statement about SHAPE rather than a
 * refusal. Refunds exist — `refundPurchase` and `refundRenewal` in
 * src/lib/connect.ts, through supabase/functions/connect-refund — and they are
 * keyed on the CHARGE, because the two things a coach can refund live in two
 * tables under two keys and neither of them is a subscription id. Cancelling
 * and refunding are separate acts and stay separate everywhere: cancelling
 * stops the next charge and returns nothing, refunding returns money and stops
 * nothing.
 *
 * That shape now has a screen on BOTH sides of it. A renewal is refunded from
 * the Renewals Paid list on app/(trainer)/payments.tsx, which is a different
 * section from the Subscribers list this function's buttons live in — far
 * enough apart that stopping and refunding are never adjacent taps, which is
 * the whole reason they were kept separate in the first place.
 *
 * The result is Stripe's answer, not ours. `ok: false` means it is still
 * running, which is exactly the case where a screen must not say "cancelled".
 */
export async function cancelSubscription(subscriptionId: string): Promise<{ ok: boolean; endsAt?: string | null; error?: string }> {
  return setCancelAtPeriodEnd(subscriptionId, 'cancel');
}

/**
 * Stop a subscription TODAY, and give nothing back.
 *
 * The deliberate exception to the rule above, and it exists because the
 * alternative was worse. A client who asks to be cancelled today and is billed
 * again in three weeks writes the review that costs the coach the next five
 * clients — and until now the only answer this app had for them was "it stops
 * at the end of the period", which is true and is not what they asked.
 *
 * IT DOES NOT REFUND. The client has paid for the period they are in and this
 * takes the rest of it off them without returning the money;
 * `END_NOW_TAKES_THE_REST` in src/lib/refunds.ts is the sentence that has to be
 * in front of whoever taps it, and giving the money back is a SEPARATE act
 * through `refundPurchase`/`refundRenewal` in src/lib/connect.ts. The two are
 * kept apart everywhere, including here, because a coach who believes one
 * implies the other has either short-changed their client or refunded somebody
 * they did not mean to.
 *
 * There is no way back from it. Stripe cancels the subscription outright, and
 * resuming is a new checkout at today's price — which is why `cancel` remains
 * the default on every screen and this sits underneath it.
 *
 * Either party may call it, for the reason in src/lib/subscriptionScope.ts: it
 * is usually the client who wants it.
 */
export async function endSubscriptionNow(subscriptionId: string): Promise<{ ok: boolean; status?: string | null; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('connect-checkout', {
      body: { action: 'end_now', subscription_id: subscriptionId },
    });
    if (error) return { ok: false, error: error.message };
    // Stripe's answer, not ours. `ok: false` means it is still running, which is
    // exactly the case where a screen must not say "ended".
    if (data?.ok) return { ok: true, status: data.status ?? null };
    return { ok: false, error: data?.error || 'It was not ended, so it is still running.' };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** Undo a pending cancellation, while it is still pending. Without this the
 *  only way back is to subscribe again — at whatever the coach charges today.
 *  Callable by either party, for the same reason as `cancelSubscription`. */
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
 *  plan and looks the caller up as a trainer.
 *
 *  The CLIENT's, and only theirs. `cancel`/`resume` were widened to the coach;
 *  this deliberately was not. The portal opens somebody's saved card, billing
 *  address and every receipt they have ever been sent, and a coach who needs an
 *  invoice can ask for one. A coach calling this is refused with a 403 that says
 *  so, rather than with a pretence that the subscription is missing. */
export async function openSubscriptionPortal(subscriptionId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('connect-checkout', {
      body: { action: 'portal', subscription_id: subscriptionId, return_url: appLink('packages') },
    });
    if (error) return { ok: false, error: error.message };
    // The same as `subscribeToPackage` above and for the same reason: a portal
    // URL that no browser took is not an opened portal, and a screen told `ok`
    // shows nothing at all while the member waits for a page that is not
    // coming.
    if (data?.url) return (await openUrl(data.url)) ? { ok: true } : { ok: false, error: PORTAL_DID_NOT_OPEN };
    return { ok: false, error: data?.error || 'Could not open billing.' };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
