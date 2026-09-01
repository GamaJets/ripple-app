// connect-checkout — a client buys a trainer's package. Creates a Stripe Checkout
// Session whose funds go to the trainer's connected account, with the platform
// taking an application fee. Uses STRIPE_SECRET_KEY. PLATFORM_FEE_PCT (default 10)
// is the platform's cut. Request: { package_id, success_url?, cancel_url? }
//
// ── Which account the charge is created ON, and why it moved ──────────────
//
// Two models live in this file, and both are load-bearing.
//
//   DESTINATION  the Checkout Session is created on the PLATFORM account and
//                `transfer_data.destination` sends the money on to the coach.
//                Repple is the merchant of record; Stripe debits REPPLE's
//                balance for every refund and every chargeback on a coach's
//                client. Every charge this repo has ever taken is one of these.
//   DIRECT       the Checkout Session is created ON the coach's connected
//                account, via the `stripeAccount` request option — Stripe's
//                `Stripe-Account` header. The coach is the merchant of record;
//                Stripe debits the COACH's balance for refunds and disputes.
//                There is no `transfer_data`, because the money never leaves
//                the coach's account in the first place. The platform's cut is
//                the application fee, which travels the other way.
//
// The owner's decision is that liability sits with the coach, so direct is
// where this is going. The reason both are still here is not caution, it is
// that Stripe will not let them be collapsed: a connected account's controller
// and dashboard type are fixed at creation, so every coach onboarded before
// today is on an Express account that CANNOT be converted to the arrangement
// direct charges are supposed to deliver. They keep selling under destination
// charges until they are deliberately re-onboarded onto a new account.
//
// Which one a coach is on is `connect_accounts.charge_model` (part 161), read
// through `modelForAccount` — which answers 'destination' for anything it does
// not recognise, so a missing or garbled column can never move a coach onto a
// model their Stripe account is not configured for.
//
// The two branches share no Stripe parameters, for the same reason the one-off
// and subscription branches below share none: `transfer_data` and a direct
// charge are mutually exclusive, this is live money, and the way to keep the
// working path working is to leave it as the code it was rather than thread
// conditionals through it.
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
import {
  modelForAccount, optionsForObject, platformFeePct, applicationFeeCents, canTakeDirectCharges,
} from '../../../src/lib/directCharges.ts';

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

  // The platform's cut, checked rather than coerced.
  //
  // This was `Number(Deno.env.get('PLATFORM_FEE_PCT') ?? '10')` and nothing
  // looked at the answer. `Number('ten')` is NaN, and NaN travelled: the one-off
  // path sent `application_fee_amount: NaN` and the subscription path sent
  // `application_fee_percent: NaN` into a live recurring charge. Stripe refuses
  // both, so a typo in one secret stopped every client of every coach from
  // buying anything, with nothing anywhere naming the cause.
  const feeRead = platformFeePct(Deno.env.get('PLATFORM_FEE_PCT'));
  if (!feeRead.ok) {
    console.error('connect-checkout: ' + feeRead.reason);
    return json({ error: 'Payments are misconfigured on this server, so nothing has been charged. The platform fee setting is not usable.' }, 500);
  }
  const feePct = feeRead.pct;

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
      .select('stripe_subscription_id, stripe_customer_id, stripe_account_id, client_id, trainer_id').eq('stripe_subscription_id', subId).maybeSingle();
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

    // WHICH STRIPE ACCOUNT this subscription lives on. Everything below this
    // line is a call about an object that already exists, and an object exists
    // on exactly one ledger: the platform for a subscription sold under
    // destination charges, the coach's connected account for one sold under
    // direct charges.
    //
    // Read off the ROW, never off the coach's current `charge_model`. A coach
    // who moves to direct charges still has subscriptions created on the
    // platform, and asking their account which context to use would send every
    // cancel, resume and portal for those to the wrong ledger. Stripe answers
    // "No such subscription" there, and this function turns that into a client
    // being told their subscription does not exist while their card is still
    // being charged every month.
    //
    // Null means the platform, and null is what every row written before part
    // 161 holds — which is exactly right, because that is where they all are.
    const acctOpts = optionsForObject(row);

    if (action === 'portal') {
      // The card, the invoices, the receipts.
      //
      // A Customer belongs to ONE account. Under destination charges the client
      // is a customer of the PLATFORM; under direct charges Checkout created
      // them as a customer of the COACH's connected account, and the two id
      // spaces are unrelated — a `cus_...` from one is simply not found in the
      // other. So the portal session is created in the same context as the
      // subscription that named the customer, or the client cannot reach their
      // own card to update it and cannot cancel from Stripe's side at all.
      if (!row.stripe_customer_id) return json({ error: 'no billing account on this subscription yet' }, 404);
      try {
        const portal = await stripe.billingPortal.sessions.create({
          customer: row.stripe_customer_id,
          return_url: String(body.return_url || 'repple://packages'),
        }, acctOpts);
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
      // In the subscription's OWN account context. A direct-charge subscription
      // updated without it is not found, and this function would answer "Stripe
      // did not confirm the change" to somebody who then believes their
      // cancellation failed — while the charge carries on either way.
      updated = await stripe.subscriptions.update(subId, { cancel_at_period_end: cancelAtPeriodEnd }, acctOpts);
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
  const { data: acct, error: acctErr } = await service.from('connect_accounts')
    .select('stripe_account_id, charges_enabled, charge_model, card_payments_status, account_type').eq('trainer_id', pkg.trainer_id).maybeSingle();
  if (acctErr) return json({ error: 'could not check the payout account: ' + acctErr.message }, 500);
  if (!acct?.stripe_account_id || !acct.charges_enabled) return json({ error: 'This trainer is not set up to take payments yet.' }, 400);

  // Which ledger this coach's charges are created on. Anything other than the
  // exact word 'direct' is 'destination' — the model every account used before
  // part 161 — so a column that is null, absent or garbled cannot move a coach
  // onto a model their Stripe account was never configured for.
  const model = modelForAccount(acct);

  // Direct charges have two preconditions destination charges do not.
  //
  // THE ACCOUNT MUST BE A STANDARD ONE. `charge_model` is a column, and part
  // 161 describes the owner writing it a coach at a time. Written onto a legacy
  // EXPRESS account it does not deliver what it promises: the charge really is
  // created on the coach's ledger, and Stripe still holds REPPLE for the fraud,
  // the dispute and any balance the coach cannot repay — Stripe's account-type
  // table gives Express "Platform" liability flat, with no charge-type
  // qualifier. Nothing would look wrong until a chargeback arrived, so the
  // account's own type is checked and only 'standard' passes.
  //
  // AND STRIPE MUST HAVE FINISHED WITH THEM. Stripe requires `card_payments` to
  // be ACTIVE on the connected account; an account halfway through onboarding
  // has it merely requested, and `charges_enabled` alone does not distinguish
  // those. Checked here so the coach is told they have not finished verifying,
  // rather than the client meeting a raw Stripe refusal on a payment page.
  //
  // A null capability status is an ABSENCE, not a refusal — see
  // canTakeDirectCharges. Every row written before part 161 has one. A null
  // account TYPE is a refusal, and the difference is deliberate: no row is
  // 'direct' until this ships, so nothing that sells today is affected, and a
  // row that is both direct and untyped is one somebody edited by hand.
  if (model === 'direct') {
    const ready = canTakeDirectCharges(acct);
    if (!ready.ok) return json({ error: ready.reason }, 400);
  }

  // The request option that makes it a direct charge: Stripe's `Stripe-Account`
  // header. Undefined for destination charges, which are created on the
  // platform exactly as they always have been.
  const acctOpts = model === 'direct' ? optionsForObject(acct) : undefined;

  // Stamped into the metadata of everything created below, so the webhook can
  // write it onto the row it mirrors. That column is what every LATER Stripe
  // call about the object reads to know which ledger to talk to, and it cannot
  // be recovered afterwards from the coach's current setting — a coach who
  // switches models would make every subscription sold before the switch
  // unreachable. Empty string for destination charges rather than the account
  // id, because Stripe metadata values are strings and the webhook turns an
  // empty one into the null that means "the platform".
  const acctMeta = model === 'direct' ? String(acct.stripe_account_id) : '';

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

    // On a subscription the fee is a PERCENT, not an amount, under BOTH models.
    // Stripe rejects application_fee_amount in subscription_data, and recomputes
    // the percent against every future invoice — which is the point, because a
    // fixed amount would be wrong the moment the price changes.
    //
    // What differs between the models is the `transfer_data`, and it differs by
    // being absent. Under a direct charge the money is already the coach's; a
    // `transfer_data.destination` pointing the coach's own account at itself is
    // not a no-op, it is a parameter Stripe refuses.
    //
    // Metadata on the SUBSCRIPTION, not just on the checkout session. Session
    // metadata is not copied onto the subscription, and every event that
    // matters from here on — subscription.updated, .deleted, invoice.paid —
    // carries the subscription's metadata and never the session's. Without this
    // the webhook gets a renewal in month four with no idea whose it is. Under
    // direct charges that is worse than it was: the event arrives on the
    // CONNECTED account, so the metadata is not merely the easiest identity, it
    // is most of the identity there is.
    const subMeta = {
      repple_kind: 'connect_subscription',
      package_id: packageId,
      trainer_id: pkg.trainer_id,
      client_id: uid,
      package_currency: currency,
      repple_account: acctMeta,
    };
    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price_data: { currency, unit_amount: pkg.price_cents, recurring: { interval: interval as 'month' | 'year' }, product_data: { name: pkg.name } }, quantity: 1 }],
        subscription_data: {
          application_fee_percent: feePct,
          ...(model === 'direct' ? {} : { transfer_data: { destination: acct.stripe_account_id } }),
          metadata: subMeta,
        },
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { repple_kind: 'connect_subscription', package_id: packageId, trainer_id: pkg.trainer_id, client_id: uid, repple_account: acctMeta },
      }, acctOpts);
      return json({ url: session.url });
    } catch (e) { return stripeError('subscription checkout', e); }
  }

  // One-off.
  //
  // The fee arithmetic moved to src/lib/directCharges.ts, because it has a rule
  // in it that this line did not obey: Stripe requires application_fee_amount
  // to be POSITIVE and STRICTLY LESS than the charge. `Math.round((price *
  // feePct) / 100)` produces 0 for any package cheap enough — 4 minor units at
  // 10% — and a literal 0 is not "no fee", it is a rejected Checkout Session.
  // The client would meet "Could not start checkout" on a package that is
  // priced perfectly correctly, and the cause would be a rounding boundary
  // nothing in this file mentioned.
  //
  // So `fee: null` means OMIT the field, and that is a different thing from
  // zero. It is returned rather than thrown because a cheap package is not an
  // error — Repple simply takes nothing on it.
  const feeCalc = applicationFeeCents(pkg.price_cents, feePct);
  if (!feeCalc.ok) {
    console.error('connect-checkout: ' + feeCalc.reason);
    return json({ error: 'This package cannot be charged for as priced, so nothing has been charged.' }, 400);
  }
  const fee = feeCalc.fee;
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price_data: { currency, unit_amount: pkg.price_cents, product_data: { name: pkg.name } }, quantity: 1 }],
      // Under a direct charge there is no transfer: the money lands in the
      // coach's balance because the charge was created there, and the
      // application fee travels the other way, to Repple. Sending
      // `transfer_data` as well would point the coach's account at itself,
      // which Stripe refuses.
      payment_intent_data: {
        ...(fee === null ? {} : { application_fee_amount: fee }),
        ...(model === 'direct' ? {} : { transfer_data: { destination: acct.stripe_account_id } }),
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
      // `repple_account` is how the webhook learns which ledger to stamp on
      // `client_purchases`. It is worth carrying even on a one-off, which has
      // no later Stripe calls made about it: a refund does, and a refund on a
      // direct charge has to be issued in the connected account's context.
      metadata: { package_id: packageId, trainer_id: pkg.trainer_id, client_id: uid, sessions: String(pkg.sessions ?? ''), repple_account: acctMeta },
    }, acctOpts);
    return json({ url: session.url });
  } catch (e) { return stripeError('checkout', e); }
});
