// connect-checkout — a client buys a trainer's package. Creates a Stripe Checkout
// Session whose funds go to the trainer's connected account, with the platform
// taking an application fee. Uses STRIPE_SECRET_KEY. PLATFORM_FEE_PCT (default 10)
// is the platform's cut. Request: { package_id, success_url?, cancel_url? }
//
// It now also sells RECURRING packages. A trainer_packages row with a
// billing_interval of 'month' or 'year' is a subscription; null — which is every
// package that existed before part 97 — is the one-off it always was. The two
// take completely separate branches below and share no Stripe parameters,
// deliberately: mode 'payment' and mode 'subscription' reject each other's
// fields outright, and this is live money, so the one-off path is the same code
// it was rather than the same code with conditionals threaded through it.
//
// And it manages a subscription once sold: { action: 'cancel' | 'resume' |
// 'portal', subscription_id }. That does not belong in stripe-portal, which is
// the PLATFORM's billing portal — it looks the caller up in billing_customers
// by trainer_id, so it can only ever find a coach paying Repple, never a client
// paying a coach. Two different customers on two different ledgers.
//
// ── Who the caller is, and why that used to be assumed ────────────────────
//
// The uid on the JWT was called `clientId` here, and the manage branch scoped
// its lookup with `.eq('client_id', clientId)`. For a purchase that name is
// right — the caller IS the buyer. For managing a subscription already sold it
// was a guess, and it was wrong half the time: a COACH calling `cancel` on
// their own client's subscription matched no row and got "subscription not
// found" every time, so the coach's payments screen could list who was paying
// them and do nothing whatsoever about it.
//
// It is now `uid`, because that is all a JWT tells us, and the manage branch
// asks the ROW who the parties are instead of assuming. The rule is in
// src/lib/subscriptionScope.ts, imported rather than written here, because it
// is the only thing stopping one coach cancelling another coach's
// subscriptions and a rule like that has to be assertable in a test.
import Stripe from 'npm:stripe@^16';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { refusalFor } from '../../../src/lib/subscriptionScope.ts';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

/**
 * Stripe's own refusal, in the response, rather than an uncaught throw.
 *
 * A rejected Stripe call used to escape the handler and become a bare 500 with
 * no body, which the app reports as "Could not start checkout" — a sentence
 * that hides the actual reason and cannot be acted on. The reasons are real and
 * specific: a connected account cannot necessarily present every currency, and
 * a charge whose currency the platform or the connected account's country does
 * not support is refused at this call. The coach needs to read that, not a
 * shrug.
 */
const stripeError = (what: string, e: unknown) => {
  const msg = (e as { message?: string })?.message || String(e);
  console.error('connect-checkout: ' + what + ' refused by Stripe:', msg);
  return json({ error: msg }, 502);
};

/** The only intervals part 97's check constraint allows. Anything else is a row
 *  that should not exist, and is refused here rather than sent to Stripe. */
const INTERVALS = new Set(['month', 'year']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) return json({ error: 'Set STRIPE_SECRET_KEY as a Supabase secret.' }, 400);
  const stripe = new Stripe(key, { apiVersion: '2024-06-20' });
  const feePct = Number(Deno.env.get('PLATFORM_FEE_PCT') ?? '10');

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  const { data: auth } = await service.auth.getUser(jwt);
  // The signed-in caller, and nothing more than that. Which SIDE of a
  // subscription they are on is a question about the row, not about the token.
  const uid = auth?.user?.id;
  if (!uid) return json({ error: 'no user' }, 401);

  const action = String(body.action || 'checkout');

  // ── managing a subscription already sold ──────────────────────────────────
  if (action === 'cancel' || action === 'resume' || action === 'portal') {
    const subId = String(body.subscription_id || '');
    if (!subId) return json({ error: 'missing subscription_id' }, 400);

    // The row first, then who the caller is to it. RLS would have refused a
    // stranger's read, but this runs as the service role, which RLS does not
    // apply to — so the ownership check RLS would have made has to be made
    // here, explicitly, or any signed-in user could cancel any subscription id
    // they can guess. A `sub_...` id is a bearer token if the server never asks
    // whose it is.
    //
    // BOTH party columns are selected, and the filter that used to be on this
    // query (`.eq('client_id', uid)`) is gone. It was doing two jobs at once —
    // finding the row and deciding who may touch it — and while they were one
    // query the second job could only ever have one answer.
    const { data: row, error: readErr } = await service.from('client_subscriptions')
      .select('stripe_subscription_id, stripe_customer_id, client_id, trainer_id').eq('stripe_subscription_id', subId).maybeSingle();
    if (readErr) return json({ error: 'could not read your subscription: ' + readErr.message }, 500);
    if (!row) return json({ error: 'subscription not found' }, 404);

    // Client or coach may stop and restart the charge. Nobody else — not the
    // gym owner, who may READ this row under `client_subs_read` but has never
    // been given the act, and not another coach. The billing portal stays the
    // client's alone: it opens their card, invoices and receipts, which are
    // not their coach's to see. All of that is decided in subscriptionScope.ts.
    //
    // A stranger gets the same 404 as a subscription id that does not exist, so
    // that guessing ids reveals nothing about which ones are real.
    const refusal = refusalFor(row, uid, action);
    if (refusal) {
      console.warn(`connect-checkout: refused ${action} on ${subId} for ${uid} (${refusal.status})`);
      return json({ error: refusal.error }, refusal.status);
    }

    if (action === 'portal') {
      // The card, the invoices, the receipts. The subscription lives on the
      // PLATFORM account (destination charges), so this is the platform's
      // portal — with the client's customer, not the coach's.
      if (!row.stripe_customer_id) return json({ error: 'no billing account on this subscription yet' }, 404);
      try {
        const portal = await stripe.billingPortal.sessions.create({
          customer: row.stripe_customer_id,
          return_url: String(body.return_url || 'repple://packages'),
        });
        return json({ url: portal.url });
      } catch (e) { return stripeError('billing portal', e); }
    }

    // Cancel at the end of the period, never immediately: the client has paid
    // for the month they are in and cancelling now would take the rest of it
    // away from them. `resume` is the same switch thrown back, and exists
    // because a cancellation the client can only undo by resubscribing at
    // today's price is a trap rather than a setting.
    //
    // That holds just as firmly when it is the COACH throwing the switch, and
    // more so — a coach cancelling immediately would be taking back weeks of
    // coaching somebody has already paid for. There is no immediate cancel in
    // this function for either party, and no refund: refunds are a different
    // Stripe API with different consequences (partial amounts, application-fee
    // reversals, the money leaving a connected account that may already have
    // paid out) and none of that is modelled here. Stripe's own dashboard is
    // where a refund is issued, and the screen says so.
    const cancelAtPeriodEnd = action === 'cancel';
    // A cancellation that failed must say so. Answering ok on a throw would
    // leave somebody believing they had stopped a charge that is still running.
    let updated: Stripe.Subscription | null = null;
    try {
      updated = await stripe.subscriptions.update(subId, { cancel_at_period_end: cancelAtPeriodEnd });
    } catch (e) { return stripeError(action, e); }
    if (!updated) return json({ error: 'Stripe did not confirm the change, so nothing has changed.' }, 502);

    // Write Stripe's answer straight back rather than waiting for the webhook,
    // so the screen that refreshes half a second later shows what actually
    // happened. `stripe_event_at` moves with it: an older webhook still in
    // flight is then filtered out by the same ordering guard the webhook uses
    // on itself, instead of undoing this.
    const { error: wErr, count: wCount } = await service.from('client_subscriptions').update({
      status: updated.status,
      cancel_at_period_end: !!updated.cancel_at_period_end,
      current_period_end: updated.current_period_end ? new Date(updated.current_period_end * 1000).toISOString() : null,
      stripe_event_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { count: 'exact' }).eq('stripe_subscription_id', subId);
    // Stripe has already been told. Saying "could not cancel" now would be
    // false — and the client would try again on a subscription that is
    // cancelled. The webhook writes the same fields moments later.
    //
    // A write that matched NO rows is not an error in PostgREST — it resolves
    // with a null error and nothing changed — so the count is asked for and
    // checked. It should be impossible here (the row was read a moment ago, on
    // the same unique key), and that is exactly why it is worth a line in the
    // log if it ever happens: it would mean the screen is being refreshed from
    // a row that no longer matches Stripe.
    if (wErr) console.error('connect-checkout: subscription updated at Stripe but not mirrored:', wErr.message);
    else if (wCount === 0) console.error('connect-checkout: subscription updated at Stripe but no row matched ' + subId + ' to mirror it onto');

    return json({
      ok: true,
      status: updated.status,
      cancel_at_period_end: !!updated.cancel_at_period_end,
      current_period_end: updated.current_period_end ? new Date(updated.current_period_end * 1000).toISOString() : null,
    });
  }

  // ── buying ────────────────────────────────────────────────────────────────
  const packageId = String(body.package_id || '');
  if (!packageId) return json({ error: 'missing package_id' }, 400);
  const successUrl = String(body.success_url || 'repple://purchase/success');
  const cancelUrl = String(body.cancel_url || 'repple://purchase/cancel');

  // Load the package and the trainer's connected account.
  //
  // A refused read is not "package not found" and not "this trainer is not set
  // up to take payments yet". Both of those are statements about the coach that
  // the client repeats back to them, and both used to be printed whenever
  // PostgREST simply failed to answer — supabase-js resolves with { error } and
  // a null `data`, so the two fell straight through into the sentences below.
  const { data: pkg, error: pkgErr } = await service.from('trainer_packages').select('*').eq('id', packageId).eq('active', true).maybeSingle();
  if (pkgErr) return json({ error: 'could not read the package: ' + pkgErr.message }, 500);
  if (!pkg) return json({ error: 'package not found' }, 404);
  const { data: acct, error: acctErr } = await service.from('connect_accounts').select('stripe_account_id, charges_enabled').eq('trainer_id', pkg.trainer_id).maybeSingle();
  if (acctErr) return json({ error: 'could not check the payout account: ' + acctErr.message }, 500);
  if (!acct?.stripe_account_id || !acct.charges_enabled) return json({ error: 'This trainer is not set up to take payments yet.' }, 400);

  // No fallback currency. This was `pkg.currency || 'usd'`, and a literal here
  // does not merely mislabel a price — it CHARGES in the wrong money. Repple is
  // white-labelled, so a London gym's £90 package with an unreadable currency
  // would have been billed as 90 dollars. A package with no currency is not
  // sellable, and saying so is the only honest answer.
  const currency = String(pkg.currency || '').trim().toLowerCase();
  if (!currency) return json({ error: 'This package has no currency set, so it cannot be sold. The gym needs to set one.' }, 400);
  const interval = pkg.billing_interval ? String(pkg.billing_interval) : null;

  if (interval) {
    if (!INTERVALS.has(interval)) return json({ error: 'This package has a billing interval this app does not sell.' }, 400);

    // Destination charges on a subscription: the fee is a PERCENT, not an
    // amount. Stripe rejects application_fee_amount in subscription_data, and
    // recomputes the percent against every future invoice — which is the point,
    // because a fixed amount would be wrong the moment the price changes.
    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price_data: { currency, unit_amount: pkg.price_cents, recurring: { interval: interval as 'month' | 'year' }, product_data: { name: pkg.name } }, quantity: 1 }],
        subscription_data: {
          application_fee_percent: feePct,
          transfer_data: { destination: acct.stripe_account_id },
          // Metadata on the SUBSCRIPTION, not just on the checkout session.
          // Session metadata is not copied onto the subscription, and every
          // event that matters from here on — subscription.updated, .deleted,
          // invoice.paid — carries the subscription's metadata and never the
          // session's. Without this the webhook gets a renewal in month four
          // with no idea whose it is.
          metadata: {
            repple_kind: 'connect_subscription',
            package_id: packageId,
            trainer_id: pkg.trainer_id,
            client_id: uid,
            package_currency: currency,
          },
        },
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { repple_kind: 'connect_subscription', package_id: packageId, trainer_id: pkg.trainer_id, client_id: uid },
      });
      return json({ url: session.url });
    } catch (e) { return stripeError('subscription checkout', e); }
  }

  // One-off. Unchanged — same fee arithmetic, same parameters, same metadata.
  const fee = Math.round((pkg.price_cents * feePct) / 100);
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price_data: { currency, unit_amount: pkg.price_cents, product_data: { name: pkg.name } }, quantity: 1 }],
      payment_intent_data: { application_fee_amount: fee, transfer_data: { destination: acct.stripe_account_id } },
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { package_id: packageId, trainer_id: pkg.trainer_id, client_id: uid, sessions: String(pkg.sessions ?? '') },
    });
    return json({ url: session.url });
  } catch (e) { return stripeError('checkout', e); }
});
