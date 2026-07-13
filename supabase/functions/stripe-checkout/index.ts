// stripe-checkout — creates a Stripe Checkout Session (mode: subscription) so a
// trainer can subscribe to a platform plan. Server-side only; uses STRIPE_SECRET_KEY.
// Request: { price_id, success_url, cancel_url }  (caller identified by JWT)
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
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  const priceId = String(body.price_id || '');
  const successUrl = String(body.success_url || 'repple://billing/success');
  const cancelUrl = String(body.cancel_url || 'repple://billing/cancel');
  if (!priceId) return json({ error: 'missing price_id' }, 400);

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  const { data: auth } = await service.auth.getUser(jwt);
  const userId = auth?.user?.id;
  const email = auth?.user?.email || undefined;
  if (!userId) return json({ error: 'no user' }, 401);

  // Find or create the Stripe customer for this trainer.
  let customerId = '';
  const { data: existing } = await service.from('billing_customers').select('stripe_customer_id').eq('trainer_id', userId).maybeSingle();
  if (existing?.stripe_customer_id) {
    customerId = existing.stripe_customer_id;
  } else {
    const customer = await stripe.customers.create({ email, metadata: { trainer_id: userId } });
    customerId = customer.id;
    await service.from('billing_customers').upsert({ trainer_id: userId, stripe_customer_id: customerId, email });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
    metadata: { trainer_id: userId },
    subscription_data: { metadata: { trainer_id: userId } },
  });
  return json({ url: session.url, id: session.id });
});
