// connect-checkout — a client buys a trainer's package. Creates a Stripe Checkout
// Session whose funds go to the trainer's connected account, with the platform
// taking an application fee. Uses STRIPE_SECRET_KEY. PLATFORM_FEE_PCT (default 10)
// is the platform's cut. Request: { package_id, success_url?, cancel_url? }
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
  const feePct = Number(Deno.env.get('PLATFORM_FEE_PCT') ?? '10');

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  const packageId = String(body.package_id || '');
  if (!packageId) return json({ error: 'missing package_id' }, 400);
  const successUrl = String(body.success_url || 'repple://purchase/success');
  const cancelUrl = String(body.cancel_url || 'repple://purchase/cancel');

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  const { data: auth } = await service.auth.getUser(jwt);
  const clientId = auth?.user?.id;
  if (!clientId) return json({ error: 'no user' }, 401);

  // Load the package and the trainer's connected account.
  const { data: pkg } = await service.from('trainer_packages').select('*').eq('id', packageId).eq('active', true).maybeSingle();
  if (!pkg) return json({ error: 'package not found' }, 404);
  const { data: acct } = await service.from('connect_accounts').select('stripe_account_id, charges_enabled').eq('trainer_id', pkg.trainer_id).maybeSingle();
  if (!acct?.stripe_account_id || !acct.charges_enabled) return json({ error: 'This trainer is not set up to take payments yet.' }, 400);

  const fee = Math.round((pkg.price_cents * feePct) / 100);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price_data: { currency: pkg.currency || 'usd', unit_amount: pkg.price_cents, product_data: { name: pkg.name } }, quantity: 1 }],
    payment_intent_data: { application_fee_amount: fee, transfer_data: { destination: acct.stripe_account_id } },
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { package_id: packageId, trainer_id: pkg.trainer_id, client_id: clientId, sessions: String(pkg.sessions ?? '') },
  });
  return json({ url: session.url });
});
