// stripe-portal — returns a Stripe Billing Portal URL so a trainer can manage
// their subscription, payment method, and invoices. Uses STRIPE_SECRET_KEY.
// Request: { return_url? }  (caller identified by JWT)
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
  const returnUrl = String(body.return_url || 'repple://billing');

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
