// connect-onboard — creates (or reuses) a Stripe connected account for a
// trainer and returns an onboarding link. The trainer completes KYC on Stripe's
// hosted flow; account.updated webhooks flip charges_enabled. Uses STRIPE_SECRET_KEY.
// Request: { refresh_url?, return_url? }  (caller identified by JWT)
//
// ── What kind of account this creates, and why it is not negotiable ───────
//
// This used to create `type: 'express'` unconditionally, and then briefly a
// controller hash that kept the Express Dashboard while moving the backstop.
// It now creates `type: 'standard'`, and that one word is the whole decision:
// it fixes who Stripe holds responsible when a payment goes wrong, and it
// cannot be changed afterwards — Stripe says plainly "After you create a
// connected account, you can't change its type."
//
// THE RULE THAT DECIDED IT. Stripe's account-type table gives, for Fraud and
// dispute liability: Standard "Connected account for direct charges, Platform
// for destination charges"; Express "Platform"; Custom "Platform". Express is
// "Platform" flat — no charge-type qualifier — because on an Express account
// `controller.losses.payments` is 'application', meaning REPPLE. So moving an
// Express coach to direct charges moves the refund and chargeback DEBIT to them
// and leaves Repple carrying the fraud, the dispute and any negative balance
// the coach cannot repay. Stripe's own footnote adds that direct charges on
// legacy Express or Custom accounts bill the connected account at sticker rates
// and recommends destination charges there instead. There is no combination of
// Express and direct charges that gets Repple off the hook.
//
// Standard does get Repple off the hook, and the price is that it is genuinely
// the coach's business: they are the merchant of record, they pay Stripe's
// processing fees out of their own balance, they answer the disputes, and they
// get the full Stripe Dashboard rather than the Express one. That is what the
// owner decided, and `app/(trainer)/payments.tsx` says all three of those
// things to the coach before they start.
//
// So CONNECT_ACCOUNT_LIABILITY decides the shape of NEW accounts, and the
// DEFAULT IS 'coach' — Standard. If you are about to "simplify" that default
// back to the platform, the paragraph above is why you must not: an account's
// type is permanent, so a coach onboarded by accident onto Express is a coach
// whose chargebacks Repple pays for the life of their business, and nothing in
// the app or the database would look wrong.
//
//   'coach'     (default) `type: 'standard'`, `charge_model: 'direct'`. The
//               coach is the merchant of record and carries the loss.
//   'platform'  `type: 'express'`, `charge_model: 'destination'`. The legacy
//               arrangement every existing coach is on. Reachable by name so an
//               account that already exists is still describable — not so new
//               ones are made this way.
//
// EXISTING accounts are never touched here. There is no API that converts one,
// and pretending otherwise would be worse than leaving them alone: a coach on
// an old Express account keeps selling under destination charges until they are
// deliberately re-onboarded onto a new account, with new KYC and new bank
// details. That is a decision about people, and it is not made in this file.
//
// ── What Standard onboarding needs that is different ──────────────────────
//
// CAPABILITIES ARE STILL REQUESTED, and that is a choice rather than a
// leftover. Stripe says that for accounts with full Dashboard access, "some
// capabilities are requested automatically, based on their country. You can
// also request other capabilities for them" — so the automatic set is
// country-dependent and this function would be trusting a country it never
// looks at. It also says flatly that "for an Account to have the `card_payments`
// capability, you must request both `card_payments` and `transfers`". Asking
// for both costs a little more onboarding and removes the failure where a
// coach finishes verification in a country whose automatic set did not include
// card payments and discovers it at a client's checkout page.
//
// THE ACCOUNT LINK IS THE SAME CALL. `accountLinks.create` takes `account`,
// `refresh_url`, `return_url` and `type`, all four required, for Standard
// exactly as for Express. `account_onboarding` is the only type available here:
// Stripe permits `account_update` links only where the PLATFORM collects
// requirements, and "You can't create them for accounts that have access to a
// Stripe-hosted Dashboard" — which is Standard and Express both.
//
// THE RETURN URLS, AND WHY THEY ARE https. Stripe: "You can use HTTP for your
// `return_url` and `refresh_url` while you're in a testing environment (for
// example, to test with localhost), but you can only use HTTPS in live mode."
// The caller used to pass `Linking.createURL('connect/…')` — a CUSTOM SCHEME,
// `repplecoach://connect/return` — which is neither http nor https, so it works
// in test and is refused the day Connect goes live. It had never been hit
// because live Connect had never run; it would have surfaced as the first real
// coach failing to onboard, at the moment they were handing Stripe their
// passport and their bank details.
//
// src/lib/connect.ts now sends `${WEB_ORIGIN}/connect-return` and
// `/connect-refresh` — per brand, so a white-label chain's coach is not
// redirected onto Repple's website halfway through setting up their own
// payouts. The pages are web/connect-return.html and web/connect-refresh.html,
// and each explains in its own header what Stripe means by landing there.
// Neither congratulates anybody: reaching `return_url` does not mean onboarding
// succeeded, only that the coach left the hosted flow, and the honest source of
// truth is `charges_enabled` on the account.
//
// The fallbacks below are the brand-less last resort for a caller that sends
// nothing. They point at Repple's own pages rather than a custom scheme so that
// such a call is at least live-legal; a caller that knows its brand must send
// its own, and every caller in this repo does.
import Stripe from 'npm:stripe@^16';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { liabilityFrom, accountTypeFor, chargeModelFor } from '../../../src/lib/directCharges.ts';
import { checkRedirect, parseRedirectAllow } from '../../../src/lib/redirectTarget.ts';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** Stripe's own refusal, in the response, rather than an uncaught throw — the
 *  same reasoning as connect-checkout's. A refused account creation has real
 *  causes a coach can act on (an unsupported country, a platform profile that
 *  has not been completed), and "Could not set up payouts" names none of them. */
const stripeError = (what: string, e: unknown) => {
  const msg = (e as { message?: string })?.message || String(e);
  console.error('connect-onboard: ' + what + ' refused by Stripe:', msg);
  return json({ error: msg }, 502);
};

/** What Stripe currently says an account can do, flattened into the five
 *  columns part 161 added. Recorded on every onboarding call, not only on the
 *  `account.updated` webhook, so that a coach who finishes verification and
 *  comes straight back has an up-to-date row without waiting for a delivery.
 *
 *  `account_type` is read off Stripe rather than off what this function meant
 *  to create, because it is the fact `connect-checkout` gates a direct charge
 *  on and the two could only ever disagree in the direction that matters. It is
 *  written on the REUSE path as well, which is how every coach already on an
 *  Express account gets the column filled in with 'express' the next time they
 *  open the payments screen — without which they would sit at null forever and
 *  a hand-edited `charge_model` on one of them would be indistinguishable from
 *  a real Standard account. */
const accountState = (acct: Stripe.Account) => ({
  charges_enabled: !!acct.charges_enabled,
  details_submitted: !!acct.details_submitted,
  payouts_enabled: !!acct.payouts_enabled,
  card_payments_status: acct.capabilities?.card_payments ?? null,
  transfers_status: acct.capabilities?.transfers ?? null,
  losses_owner: acct.controller?.losses?.payments ?? null,
  account_type: acct.type ?? null,
  updated_at: new Date().toISOString(),
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) return json({ error: 'Set STRIPE_SECRET_KEY as a Supabase secret.' }, 400);
  const stripe = new Stripe(key, { apiVersion: '2024-06-20' });

  let body: any = {};
  try { body = await req.json(); } catch { /* optional */ }
  // The return addresses, checked rather than passed straight through. Each
  // used to be `String(body.x || 'default')` with nothing between a request
  // body and a payments API. src/lib/redirectTarget.ts holds the rule and
  // says what it is and is not: an unset REDIRECT_ALLOW still refuses the
  // four schemes that are never a redirect target, and setting it makes the
  // list closed.
  const redirectAllow = parseRedirectAllow(Deno.env.get('REDIRECT_ALLOW'));
  const refreshBack = checkRedirect(body.refresh_url, 'https://www.repplefitness.com/connect-refresh', redirectAllow);
  if (!refreshBack.ok) return json({ error: refreshBack.reason }, 400);
  const returnBack = checkRedirect(body.return_url, 'https://www.repplefitness.com/connect-return', redirectAllow);
  if (!returnBack.ok) return json({ error: returnBack.reason }, 400);
  const refreshUrl = refreshBack.url;
  const returnUrl = returnBack.url;

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  const { data: auth } = await service.auth.getUser(jwt);
  const userId = auth?.user?.id;
  const email = auth?.user?.email || undefined;
  if (!userId) return json({ error: 'no user' }, 401);

  // Find or create the trainer's connected account.
  let acctId = '';
  const { data: existing, error: readErr } = await service.from('connect_accounts')
    .select('stripe_account_id').eq('trainer_id', userId).maybeSingle();
  // A refused READ is not "this trainer has no account". Falling through would
  // create a SECOND connected account for a coach who already has one — a
  // duplicate that splits their money across two ledgers and cannot be merged.
  if (readErr) return json({ error: 'could not check your payout account: ' + readErr.message }, 500);

  if (existing?.stripe_account_id) {
    acctId = existing.stripe_account_id;
    // Refresh what Stripe says about the account they already have. This is the
    // only place a coach from before part 161 gets their capability columns
    // filled in without waiting for an account.updated to happen along, and
    // connect-checkout reads those columns before it will take a direct charge.
    try {
      const acct = await stripe.accounts.retrieve(acctId);
      // no-count-ok: zero rows here cannot be reported to anybody who could act
      // on it, and is already reported to somebody who can.
      //
      // `existing.stripe_account_id` came off this very row a few lines above,
      // under the service role, and nothing else filters this update — so zero
      // rows means the coach's `connect_accounts` row was deleted between that
      // read and this write. That is not a stale capability column, which is
      // all this write is for: it is a coach with NO connect row at all, and
      // connect-checkout already refuses a sale on exactly that state, by name,
      // to the client trying to pay — `if (!acct?.stripe_account_id ||
      // !acct.charges_enabled) … 'This trainer is not set up to take payments
      // yet.'` The gap is visible where it costs money, which is where it can
      // be acted on.
      //
      // And the write itself is not the record: `account.updated` in
      // stripe-webhook writes these same columns and is the path that matters,
      // because a coach who finishes Stripe's hosted flow may never come back
      // through this function at all. This is the catch-up for a coach from
      // before part 161, on the way to the link they actually came for.
      const { error: updErr } = await service.from('connect_accounts').update(accountState(acct)).eq('trainer_id', userId);
      // Not fatal. The link below is what the coach came for, and the webhook
      // writes the same columns. Losing this refresh delays a capability
      // reading; refusing the onboarding link over it strands them entirely.
      if (updErr) console.error('connect-onboard: could not mirror account state:', updErr.message);
    } catch (e) {
      console.error('connect-onboard: could not re-read account ' + acctId + ':', (e as Error).message);
    }
  } else {
    // Standard unless the secret says otherwise, and the secret says otherwise
    // only for the exact word 'platform'. Everything about that asymmetry is in
    // `liabilityFrom`, with a test, because it is a decision about who pays for
    // a chargeback and a typo must not be able to make it.
    const liability = liabilityFrom(Deno.env.get('CONNECT_ACCOUNT_LIABILITY'));
    const accountType = accountTypeFor(liability);
    const chargeModel = chargeModelFor(liability);

    // BOTH capabilities, for both arrangements. Stripe is explicit that "for an
    // Account to have the `card_payments` capability, you must request both
    // `card_payments` and `transfers`", and that a full-Dashboard account gets
    // "some capabilities requested automatically, based on their country" —
    // which is a country this function never looks at. Requesting only
    // `card_payments`, or trusting the automatic set, would leave the account
    // unable to take a card payment at all, and the symptom would appear at a
    // client's checkout rather than here.
    //
    // `transfers` is not used under direct charges — nothing is transferred,
    // the money is already the coach's — and it is requested anyway because
    // Stripe makes it the precondition for `card_payments` rather than because
    // this integration moves money that way.
    const params: Stripe.AccountCreateParams = {
      email,
      metadata: { trainer_id: userId },
      capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
      // One word, sent alone. `type` and `controller` are alternatives and
      // sending both is how an account ends up in an arrangement nobody chose;
      // Stripe's Standard guide asks for exactly this one parameter. It is also
      // the only field here that can never be changed afterwards.
      type: accountType,
    };

    let acct: Stripe.Account;
    try {
      // ── the second connected account ─────────────────────────────────────
      //
      // Read the note under the upsert below before changing this. Stripe
      // creates the account; the row that is the only link between it and this
      // coach fails; the next call finds no row and CREATES ANOTHER ONE. The
      // note calls that outcome "a real connected account that this database
      // has never heard of" and then lets the next call happen anyway.
      //
      // It is worse here than for a Customer, because an account's type is
      // permanent and its KYC is a person's passport and bank details. A coach
      // who ends up with two has to be told which of them to finish, and
      // nothing in the app can tell them.
      //
      // Keyed on the coach, so a repeat inside Stripe's 24-hour idempotency
      // window returns the FIRST account rather than making a second — and that
      // window is the one that matters: it is the coach tapping "Set up
      // payments" again on the same afternoon. Only reached when no row exists,
      // so it can never collide with the reuse path above.
      acct = await stripe.accounts.create(params, { idempotencyKey: `repple-connect-account:${userId}` });
    } catch (e) { return stripeError('account creation', e); }
    acctId = acct.id;

    // The model is written at CREATION and never inferred later, and it is
    // written NEXT TO the account type Stripe just gave back rather than next
    // to the one we asked for. A direct charge on an account that is not
    // Standard is the half-measure this whole change exists to avoid —
    // connect-checkout refuses that combination outright — so the two facts are
    // recorded together, here, once, from the same response.
    const { error: insErr } = await service.from('connect_accounts').upsert({
      trainer_id: userId,
      stripe_account_id: acctId,
      charge_model: chargeModel,
      ...accountState(acct),
    });
    // Stripe has already created the account. Answering with an error now would
    // leave a real connected account that this database has never heard of —
    // and the next call would create a second one. So it is logged loudly and
    // the id is returned, which is the only record of it that survives.
    if (insErr) console.error('connect-onboard: created Stripe account ' + acctId + ' for ' + userId + ' but could not record it:', insErr.message);
  }

  try {
    const link = await stripe.accountLinks.create({ account: acctId, refresh_url: refreshUrl, return_url: returnUrl, type: 'account_onboarding' });
    return json({ url: link.url, account_id: acctId });
  } catch (e) { return stripeError('onboarding link', e); }
});
