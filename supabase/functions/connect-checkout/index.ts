// connect-checkout — a client buys a trainer's package. Creates a Stripe Checkout
// Session whose funds go to the trainer's connected account, with the platform
// taking an application fee. Uses STRIPE_SECRET_KEY. PLATFORM_FEE_PCT (default 10)
// is the platform's cut.
// Request: { package_id, success_url?, cancel_url?, promo_code? }
//   `promo_code` is the coach's own discount code as the client typed it. It is
//   accepted on a SUBSCRIPTION package and refused on a one-off, by name and
//   with the reason — see `checkoutCodeBlocker` and the note in the
//   subscription branch. Omitted is the ordinary case.
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
  normaliseCode, checkoutCodeBlocker, codeAppliesTo,
  CODE_IS_NOT_FOR_A_ONE_OFF, CODE_IS_FOR_ANOTHER_PACKAGE, type PromoTarget,
} from '../../../src/lib/packagePromo.ts';
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

  // ── the billing portal for a ONE-OFF sale ─────────────────────────────────
  //
  // Somebody who has only ever bought session packs had no route to an invoice,
  // to their card, or to a refund. Not because the button was in the wrong
  // place — app/(client)/packages.tsx renders it inside `liveSubs.map(...)`,
  // which is the only place it COULD go, because the `portal` action below is
  // keyed on a subscription and reads its `stripe_customer_id`. A pack buyer
  // has no `client_subscriptions` row, so there was no id to pass.
  //
  // The missing thing was underneath: a Checkout Session in `mode: 'payment'`
  // creates neither a Customer nor an Invoice unless it is asked to, so there
  // was nothing for a portal to show even if one could have been opened. The
  // one-off branch at the bottom of this file now asks for both, the webhook
  // records the customer on `client_purchases` (part 282), and this action
  // opens it.
  //
  // NULL customer is a SENTENCE, not an error to hide. Every sale made before
  // that change has no Customer at Stripe and none can be manufactured now, so
  // the screen is told so plainly rather than being handed a button that opens
  // a failure.
  if (action === 'purchase_portal') {
    const purchaseId = String(body.purchase_id || '');
    if (!purchaseId) return json({ error: 'missing purchase_id' }, 400);

    const { data: row, error: readErr } = await service.from('client_purchases')
      .select('id, client_id, stripe_customer_id, stripe_account_id').eq('id', purchaseId).maybeSingle();
    if (readErr) return json({ error: 'could not read your purchase: ' + readErr.message }, 500);
    if (!row) return json({ error: 'purchase not found' }, 404);

    // The BUYER's alone, and not the coach's. The portal opens somebody's card,
    // their invoices and their receipts, which is the same rule
    // src/lib/subscriptionScope.ts states for the subscription portal: a coach
    // may cancel a subscription they are paid through and may not look inside
    // their client's wallet. A stranger gets the same 404 as an id that does
    // not exist, so guessing reveals nothing about which ones are real.
    if (String(row.client_id ?? '') !== uid) {
      console.warn('connect-checkout: refused purchase_portal on ' + purchaseId + ' for ' + uid);
      return json({ error: 'purchase not found' }, 404);
    }
    if (!row.stripe_customer_id) {
      return json({ error: 'Stripe has no billing account for this purchase, so there is nothing to open. Your coach can send a receipt or arrange a refund.' }, 404);
    }

    // In the purchase's OWN account context. A Customer belongs to exactly one
    // account: under destination charges the buyer is a customer of the
    // PLATFORM, and under direct charges Checkout created them on the COACH's
    // connected account. The two id spaces are unrelated and a `cus_...` from
    // one is simply not found in the other — which is the whole reason
    // `accountForObject` reads the object's own column rather than the coach's
    // current setting.
    try {
      const portal = await stripe.billingPortal.sessions.create({
        customer: row.stripe_customer_id,
        return_url: String(body.return_url || 'repple://packages'),
      }, optionsForObject(row));
      return json({ url: portal.url });
    } catch (e) { return stripeError('billing portal', e); }
  }

  // ── managing a subscription already sold ──────────────────────────────────
  if (action === 'cancel' || action === 'resume' || action === 'portal' || action === 'end_now') {
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

    // ── ending it TODAY ──────────────────────────────────────────────────
    //
    // Separate from the switch below, and separate on purpose. `cancel` and
    // `resume` are one boolean thrown back and forth on a subscription that
    // keeps running to the end of a period somebody has paid for; `end_now`
    // deletes the subscription at Stripe and there is no way back from it
    // except a new checkout at today's price.
    //
    // It exists because the alternative was worse. A client who asks to be
    // cancelled today and is billed again in three weeks writes the review that
    // costs the coach the next five clients, and until now the only answer this
    // app had for them was "it stops at the end of the period" — true, and not
    // what they asked for.
    //
    // WHAT IT DOES NOT DO IS REFUND. No proration, no credit note, no invoice:
    // `prorate: false`, stated rather than defaulted, so a later Stripe default
    // cannot start issuing credit notes on somebody's behalf. The client has
    // paid for the period they are in and ending it takes the rest of that away
    // from them without giving the money back — which is a real cost to a real
    // person, so `END_NOW_TAKES_THE_REST` in src/lib/refunds.ts is printed in
    // front of the coach BEFORE they confirm, and giving the money back is a
    // separate act through supabase/functions/connect-refund.
    if (action === 'end_now') {
      let ended: Stripe.Subscription | null = null;
      try {
        // In the subscription's OWN account context, for the same reason the
        // update below is: a direct-charge subscription cancelled without it is
        // not found, and this function would tell a coach the cancellation
        // failed while the charge carried on either way.
        ended = await stripe.subscriptions.cancel(subId, { prorate: false }, acctOpts);
      } catch (e) { return stripeError('end_now', e); }
      if (!ended) return json({ error: 'Stripe did not confirm the change, so nothing has changed and the subscription is still running.' }, 502);

      const { error: eErr, count: eCount } = await service.from('client_subscriptions').update({
        status: ended.status,
        // Stripe leaves `cancel_at_period_end` false on a subscription it has
        // actually cancelled, and mirroring that verbatim is right: a screen
        // reading "ends at the end of the period" beside a status of 'canceled'
        // is two contradictory sentences about the same row.
        cancel_at_period_end: !!ended.cancel_at_period_end,
        current_period_end: ended.current_period_end ? new Date(ended.current_period_end * 1000).toISOString() : null,
        stripe_event_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { count: 'exact' }).eq('stripe_subscription_id', subId);
      if (eErr) console.error('connect-checkout: subscription ended at Stripe but not mirrored:', eErr.message);
      else if (eCount === 0) console.error('connect-checkout: subscription ended at Stripe but no row matched ' + subId + ' to mirror it onto');

      return json({
        ok: true,
        status: ended.status,
        ended_now: true,
        cancel_at_period_end: !!ended.cancel_at_period_end,
        current_period_end: ended.current_period_end ? new Date(ended.current_period_end * 1000).toISOString() : null,
      });
    }

    // Cancel at the end of the period: the client has paid for the month they
    // are in and stopping it now would take the rest of it away from them.
    // `resume` is the same switch thrown back, and exists because a
    // cancellation the client can only undo by resubscribing at today's price
    // is a trap rather than a setting. This stays the default and the screens
    // offer it first — `end_now` above is the exception, taken deliberately.
    //
    // Still no refund on this path, and none is implied by it: refunds are a
    // different Stripe API with different consequences and they now live in
    // supabase/functions/connect-refund, which is keyed on the CHARGE rather
    // than on the subscription. Ending a subscription and giving money back are
    // separate acts and are separate everywhere.
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

  // ── the coach's discount code, if the client typed one ────────────────────
  //
  // It arrives WITH this request now. It used to be collected on Stripe's own
  // hosted page through `allow_promotion_codes`, which is less to build and
  // could enforce neither of the two rules that matter:
  //
  //   · WHICH PACKAGE the code is for. connect-promo records that in Stripe
  //     METADATA, because this app's packages are inline `price_data` with no
  //     stored Product for Stripe's `applies_to` to point at — so Stripe does
  //     not enforce it, and a box on Stripe's page is a box no code in this
  //     repo ever sees. A code made for one recurring package therefore worked
  //     on every other one the coach sells.
  //   · THAT A ONE-OFF TAKES NO CODE. `promoBlocker` stops a coach ATTACHING a
  //     code to a one-off package; nothing stopped a subscription's code being
  //     typed against a one-off sale. The only reason that never happened is
  //     that the one-off branch below never set the flag, which is a property
  //     of a missing feature rather than a rule.
  //
  // Both are `checkoutCodeBlocker` in src/lib/packagePromo.ts, imported rather
  // than written here so the client's screen and this cannot say different
  // things.
  const typedCode = normaliseCode(String(body.promo_code ?? ''));
  let promotionCodeId: string | null = null;
  if (typedCode) {
    const promoTarget: PromoTarget = {
      id: packageId,
      name: String(pkg.name ?? ''),
      billingInterval: interval,
      active: !!pkg.active,
    };
    const refusal = checkoutCodeBlocker(typedCode, promoTarget);
    if (refusal) return json({ error: refusal }, 400);

    // A code lives on the COACH's connected account and is only ever consulted
    // by a Checkout Session created there too. Under destination charges the
    // session is created on the PLATFORM, where a connected account's promotion
    // code simply does not exist — which is the same reason connect-promo
    // refuses to create one for a coach on that model. Refused here rather than
    // sent to Stripe to come back as "No such promotion code".
    if (model !== 'direct') {
      return json({ error: 'Your coach’s payment setup does not take discount codes. Nothing has been charged — buy it at the price shown, or ask them about the code.' }, 409);
    }

    let found: Stripe.PromotionCode | null = null;
    try {
      // Stripe's own list, on the coach's account, filtered by the string the
      // client typed. There is no local table to consult: the code, the
      // percentage, the expiry, the limit and the redemption count all live at
      // Stripe and this app keeps no copy of any of them.
      const list = await stripe.promotionCodes.list({ code: typedCode, active: true, limit: 1, expand: ['data.coupon'] }, acctOpts);
      found = list.data[0] ?? null;
    } catch (e) { return stripeError('checking that code', e); }
    if (!found) {
      return json({ error: 'That code is not one your coach is running, or it has stopped working. Nothing has been charged — check it with them.' }, 404);
    }
    if (!codeAppliesTo(found.metadata?.repple_package_id, packageId)) {
      return json({ error: CODE_IS_FOR_ANOTHER_PACKAGE }, 400);
    }
    promotionCodeId = found.id;
  }

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
        // ── the coach's own discount code ────────────────────────────────
        //
        // Applied to the session by id, from the code the client typed in the
        // app. `allow_promotion_codes: true` used to stand here instead, which
        // put the box on Stripe's hosted page, and it is GONE rather than kept
        // as a second route: the two rules set out where the code is resolved
        // above can only be checked on a code that passes through this
        // function, so leaving the box on Stripe's page would leave the
        // package restriction optional — a client who skipped the field in the
        // app would be back to a code that works on anything the coach sells.
        // An enforcement with a way round it is not one. (Stripe rejects a
        // session carrying both fields in any case.)
        //
        // ON THE SUBSCRIPTION BRANCH ONLY, and the reason is the platform fee.
        // Here Repple's cut is `application_fee_percent` — a percentage — so a
        // 20% off code means the client pays 20% less and Repple takes its
        // share of the smaller amount, correctly, with no arithmetic anywhere.
        //
        // On the one-off branch below the cut is `application_fee_amount`: an
        // absolute figure in minor units, and Stripe requires it in the SAME
        // call that creates the session — the call in which Stripe itself works
        // out what the discount comes to. There is therefore no ordering in
        // which that fee is derived from what Stripe actually charged: it can
        // only be derived from a discounted total this app predicted, and a
        // predicted total that is one minor unit out is a coach underpaid on
        // every sale of that package. Left as it was, the coach would be worse
        // off still — a 30% off code on a £100 pack pays them £70 and charges a
        // fee worked out on £100, and at a large enough discount the fee
        // exceeds the charge and Stripe refuses the payment outright.
        //
        // So the one-off refusal stands, and it is now enforced HERE as well as
        // on the coach's screen. See `checkoutCodeBlocker`.
        ...(promotionCodeId ? { discounts: [{ promotion_code: promotionCodeId }] } : {}),
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

  // No code reaches this branch. `checkoutCodeBlocker` above already refused
  // one against a package with no billing interval, and this is the second
  // copy of that refusal rather than a first: everything below computes an
  // application fee from `pkg.price_cents`, the LIST price, and the moment a
  // discount exists that figure is a fee on money the coach never received.
  // If the two rules are ever allowed to disagree, the disagreement stops here
  // rather than at somebody's charge.
  if (typedCode) return json({ error: CODE_IS_NOT_FOR_A_ONE_OFF }, 400);

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
      // A Customer and a real Invoice for a one-off sale.
      //
      // `mode: 'payment'` creates neither by default, and that absence was the
      // whole of the defect above: a client who had only ever bought packs had
      // nothing for a billing portal to open, so the button could only ever be
      // drawn beside a subscription. `customer_creation: 'always'` gives the
      // sale a Customer, `invoice_creation` gives it an invoice the buyer can
      // download, and the webhook records the customer id on the purchase.
      //
      // On a DIRECT charge both are created on the coach's connected account,
      // which is where the `purchase_portal` action above opens them — the same
      // context the charge was made in, read off the purchase's own column.
      customer_creation: 'always',
      invoice_creation: { enabled: true },
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
