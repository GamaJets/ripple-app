// marketplace-checkout — a member buys a coach's ready-made program (a
// marketplace listing, supabase/parts/3310).
// Request: { listing_id, success_url?, cancel_url? }
//
// Mirrors connect-checkout's one-off path and nothing more:
//   · the caller is whoever the JWT says, and is the buyer;
//   · the price and currency come from the LISTING ROW, never from the request;
//   · the charge goes through the coach's existing Connect account, on the
//     model that account is on (`modelForAccount`: direct charges ON the
//     connected account, or destination charges for legacy Express accounts);
//   · the platform's cut is connect-checkout's own PLATFORM_FEE_PCT, read and
//     applied by the same functions in src/lib/directCharges.ts. No other fee;
//   · redirects go through the same allowlist (REDIRECT_ALLOW).
//
// It writes one `marketplace_purchases` row, pending, keyed by the Checkout
// Session id. stripe-webhook completes it through `marketplace_fulfil()` on
// checkout.session.completed with metadata.repple_kind = 'marketplace', which
// is also what assigns the program. Nothing is assigned here: a session that
// was opened is not money that moved.
//
// Metadata carries no `package_id` on purpose: the webhook's package branch
// keys on that, and a program sale filed as a session pack would grant credits.
import Stripe from 'npm:stripe@^16';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { authReadFate } from '../../../src/lib/authReadFate.ts';
import {
  modelForAccount, optionsForObject, platformFeePct, applicationFeeCents, canTakeDirectCharges,
} from '../../../src/lib/directCharges.ts';
import { checkRedirect, parseRedirectAllow } from '../../../src/lib/redirectTarget.ts';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) return json({ error: 'Set STRIPE_SECRET_KEY as a Supabase secret.' }, 400);
  const stripe = new Stripe(key, { apiVersion: '2024-06-20' });

  const feeRead = platformFeePct(Deno.env.get('PLATFORM_FEE_PCT'));
  if (!feeRead.ok) {
    console.error('marketplace-checkout: ' + feeRead.reason);
    return json({ error: 'Payments are misconfigured on this server, so nothing has been charged. The platform fee setting is not usable.' }, 500);
  }

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  const { data: auth, error: authErr } = await service.auth.getUser(jwt);
  if (authErr && authReadFate(authErr) === 'unreadable') {
    return json({ error: 'Repple could not check who you are just now. That is our end, not yours. Nothing has been charged. Try again in a moment.' }, 503);
  }
  const uid = auth?.user?.id;
  if (!uid) return json({ error: 'no user' }, 401);

  const listingId = String(body.listing_id || '');
  if (!listingId) return json({ error: 'missing listing_id' }, 400);

  const allow = parseRedirectAllow(Deno.env.get('REDIRECT_ALLOW'));
  const okBack = checkRedirect(body.success_url, 'repple://marketplace/success', allow);
  if (!okBack.ok) return json({ error: okBack.reason }, 400);
  const cancelBack = checkRedirect(body.cancel_url, 'repple://marketplace/cancel', allow);
  if (!cancelBack.ok) return json({ error: cancelBack.reason }, 400);

  // The listing, live, on the buyer's own tenant. Read with the service role,
  // so the tenant test is written out here rather than left to RLS.
  const { data: listing, error: lErr } = await service.from('marketplace_listings')
    .select('id, coach_id, tenant_id, title, price_cents, currency, status').eq('id', listingId).maybeSingle();
  if (lErr) return json({ error: 'could not read the program: ' + lErr.message }, 500);
  if (!listing || listing.status !== 'live') return json({ error: 'This program is no longer on sale. Nothing has been charged.' }, 404);
  const { data: me, error: meErr } = await service.from('profiles').select('tenant_id').eq('id', uid).maybeSingle();
  if (meErr) return json({ error: 'could not read your account: ' + meErr.message }, 500);
  if (!me?.tenant_id || String(me.tenant_id) !== String(listing.tenant_id)) return json({ error: 'This program is not sold at your gym.' }, 403);
  if (listing.coach_id === uid) return json({ error: 'You cannot buy your own program.' }, 400);
  // Buying assigns the program, which replaces what the member trains from and
  // makes the seller their assigning coach (marketplace_fulfil, part 3310). A
  // member who already has a coach would lose that coach's plan to a stranger's
  // without either coach having a say, so they buy from their own coach only.
  // Owner's rule, 22 Sep 2026.
  const { data: rel, error: relErr } = await service.from('clients').select('trainer_id').eq('id', uid).maybeSingle();
  if (relErr) return json({ error: 'could not check who coaches you: ' + relErr.message }, 500);
  if (rel?.trainer_id && String(rel.trainer_id) !== String(listing.coach_id)) {
    return json({ error: 'You train with a coach already, so you can only buy programs from them. Nothing has been charged.' }, 409);
  }

  // Already owned: refuse before charging twice for the same thing.
  const { data: owned, error: oErr } = await service.from('marketplace_purchases')
    .select('id').eq('listing_id', listingId).eq('buyer_id', uid).eq('status', 'paid').limit(1);
  if (oErr) return json({ error: 'could not check your purchases: ' + oErr.message }, 500);
  if (owned && owned.length) return json({ error: 'You already own this program. It is on your Train tab.' }, 409);

  const { data: acct, error: acctErr } = await service.from('connect_accounts')
    .select('stripe_account_id, charges_enabled, charge_model, card_payments_status, account_type').eq('trainer_id', listing.coach_id).maybeSingle();
  if (acctErr) return json({ error: 'could not check the payout account: ' + acctErr.message }, 500);
  // connect-checkout's sentence, so both Buy buttons say the same thing.
  if (!acct?.stripe_account_id || !acct.charges_enabled) return json({ error: 'This trainer is not set up to take payments yet.' }, 400);

  const model = modelForAccount(acct);
  if (model === 'direct') {
    const ready = canTakeDirectCharges(acct);
    if (!ready.ok) return json({ error: ready.reason }, 400);
  }
  const acctOpts = model === 'direct' ? optionsForObject(acct) : undefined;
  const acctMeta = model === 'direct' ? String(acct.stripe_account_id) : '';

  const currency = String(listing.currency || '').trim().toLowerCase();
  if (!currency) return json({ error: 'This program has no currency set, so it cannot be sold.' }, 400);
  const feeCalc = applicationFeeCents(Number(listing.price_cents), feeRead.pct);
  if (!feeCalc.ok) {
    console.error('marketplace-checkout: ' + feeCalc.reason);
    return json({ error: 'This program cannot be charged for as priced, so nothing has been charged.' }, 400);
  }
  const fee = feeCalc.fee;

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price_data: { currency, unit_amount: Number(listing.price_cents), product_data: { name: String(listing.title) } }, quantity: 1 }],
      payment_intent_data: {
        ...(fee === null ? {} : { application_fee_amount: fee }),
        ...(model === 'direct' ? {} : { transfer_data: { destination: acct.stripe_account_id } }),
      },
      customer_creation: 'always',
      success_url: okBack.url,
      cancel_url: cancelBack.url,
      metadata: {
        repple_kind: 'marketplace',
        listing_id: listingId,
        coach_id: String(listing.coach_id),
        buyer_id: uid,
        repple_account: acctMeta,
      },
    }, acctOpts);
  } catch (e) {
    const msg = (e as { message?: string })?.message || String(e);
    console.error('marketplace-checkout: checkout refused by Stripe:', msg);
    return json({ error: msg }, 502);
  }

  // Written after the session exists, because the session id is the key the
  // webhook completes it by. If this write fails the member is not sent to pay:
  // a payment with no pending row would be money with nothing to fulfil.
  const { error: pErr } = await service.from('marketplace_purchases').insert({
    listing_id: listingId,
    buyer_id: uid,
    coach_id: listing.coach_id,
    amount_cents: Number(listing.price_cents),
    currency: String(listing.currency).toUpperCase(),
    stripe_session_id: session.id,
    status: 'pending',
  });
  if (pErr) {
    console.error('marketplace-checkout: pending purchase not written for ' + session.id + ': ' + pErr.message);
    try { await stripe.checkout.sessions.expire(session.id, undefined, acctOpts); } catch { /* the session lapses on its own */ }
    return json({ error: 'Your purchase could not be started, so nothing has been charged. Try again in a moment.' }, 500);
  }
  return json({ url: session.url });
});
