// stripe-portal — returns a Stripe Billing Portal URL so a trainer can manage
// their subscription, payment method, and invoices. Uses STRIPE_SECRET_KEY.
// Request: { return_url? }  (caller identified by JWT)
//
// ── This is the PLATFORM's portal, and direct charges do not touch it ─────
//
// Checked when Connect moved to direct charges, and deliberately left alone.
// This function serves a COACH paying REPPLE: it looks the caller up in
// `billing_customers` by `trainer_id`, and that table only ever holds customers
// created by `stripe-checkout` on the PLATFORM account. There is no client, no
// connected account and no application fee anywhere in this path, so there is
// no account context to add — a `stripeAccount` option here would send a
// platform customer id to a connected account, where it does not exist, and
// break the coach's own billing to fix a problem it does not have.
//
// The portal that DID have to move is the client's, and it is not in this file.
// A client managing the subscription they pay their coach for goes through
// `connect-checkout` with `{ action: 'portal' }`, which reads
// `client_subscriptions.stripe_account_id` and opens the portal in the same
// account context the customer was created in. The two are named similarly and
// are on two different ledgers with two different customer id spaces; the
// header of connect-checkout has said so since part 97 and it is repeated here
// because this is the file somebody would edit by mistake.
//
// So: if a client cannot cancel or update their card, this function is not the
// one to change.
import Stripe from 'npm:stripe@^16';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { checkRedirect, parseRedirectAllow } from '../../../src/lib/redirectTarget.ts';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

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
  const back = checkRedirect(body.return_url, 'repple://billing', redirectAllow);
  if (!back.ok) return json({ error: back.reason }, 400);
  const returnUrl = back.url;

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  const { data: auth } = await service.auth.getUser(jwt);
  const userId = auth?.user?.id;
  if (!userId) return json({ error: 'no user' }, 401);

  const { data: cust } = await service.from('billing_customers').select('stripe_customer_id').eq('trainer_id', userId).maybeSingle();
  if (!cust?.stripe_customer_id) return json({ error: 'no subscription yet' }, 404);

  const portal = await stripe.billingPortal.sessions.create({ customer: cust.stripe_customer_id, return_url: returnUrl });
  return json({ url: portal.url });
});
