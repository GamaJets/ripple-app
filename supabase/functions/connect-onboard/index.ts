// connect-onboard — creates (or reuses) a Stripe Express connected account for a
// trainer and returns an onboarding link. The trainer completes KYC on Stripe's
// hosted flow; account.updated webhooks flip charges_enabled. Uses STRIPE_SECRET_KEY.
// Request: { refresh_url?, return_url? }  (caller identified by JWT)
import Stripe from 'npm:stripe@^16';
import { createClient } from 'jsr:@supabase/supabase-js@2';

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
  const refreshUrl = String(body.refresh_url || 'repple://connect/refresh');
  const returnUrl = String(body.return_url || 'repple://connect/return');

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  const { data: auth } = await service.auth.getUser(jwt);
  const userId = auth?.user?.id;
  const email = auth?.user?.email || undefined;
  if (!userId) return json({ error: 'no user' }, 401);

  // Find or create the trainer's connected account.
  let acctId = '';
  const { data: existing } = await service.from('connect_accounts').select('stripe_account_id').eq('trainer_id', userId).maybeSingle();
  if (existing?.stripe_account_id) {
    acctId = existing.stripe_account_id;
  } else {
    const acct = await stripe.accounts.create({ type: 'express', email, metadata: { trainer_id: userId }, capabilities: { transfers: { requested: true }, card_payments: { requested: true } } });
    acctId = acct.id;
    await service.from('connect_accounts').upsert({ trainer_id: userId, stripe_account_id: acctId });
  }

  const link = await stripe.accountLinks.create({ account: acctId, refresh_url: refreshUrl, return_url: returnUrl, type: 'account_onboarding' });
  return json({ url: link.url, account_id: acctId });
});
