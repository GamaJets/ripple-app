// stripe-checkout — creates a Stripe Checkout Session (mode: subscription) so a
// trainer can subscribe to a platform plan. Server-side only; uses STRIPE_SECRET_KEY.
// Request: { price_id, success_url, cancel_url }  (caller identified by JWT)
//
// ── WHAT `price_id` IS ALLOWED TO BE ──────────────────────────────────────
//
// It used to be whatever the caller said. `String(body.price_id)` went into a
// live Checkout Session with nothing between the two, so any signed-in coach
// could name ANY price on Repple's platform account and subscribe to it: a
// retired price from a plan that no longer exists, a one-off price that is not
// a plan at all, or one made for something else entirely. The webhook then
// files it in `subscriptions` with `plan` read off the price's own nickname, so
// this database's record of what a coach is on is a string the coach chose.
//
// The app only ever sends one of three, from EXPO_PUBLIC_STRIPE_PRICE_STARTER /
// _PRO / _STUDIO in src/lib/billing.ts. Those are BUILD-TIME and PUBLIC — the
// EXPO_PUBLIC_ prefix inlines them into the bundle, which is the same property
// supabase/functions/ocr-scan's header describes for the OCR key — so the list
// is not a secret and is no use as one. What it is, is the server's own copy of
// what the product sells, and until now the server had none.
//
//   STRIPE_PLAN_PRICE_IDS  a comma-separated list of the price ids this
//                          deployment sells. Set it and it is the allow-list,
//                          checked before Stripe is called at all.
//
// Unset, the fallback is not "anything": the price is RETRIEVED from Stripe and
// has to be active and recurring. That refuses the retired price and the
// one-off, which are the two shapes that make a mess of `subscriptions`, and it
// is honest about what it does not do — it cannot tell a plan price from any
// other live recurring price on the account, and it says so rather than
// implying the list is closed. A deployment that wants it closed sets the
// secret.
import Stripe from 'npm:stripe@^16';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { checkRedirect, parseRedirectAllow } from '../../../src/lib/redirectTarget.ts';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** The plan prices this deployment sells, or null when nobody has said. Empty
 *  entries are dropped rather than becoming an id that matches nothing, so a
 *  trailing comma cannot quietly make the list one shorter than it reads. */
const allowedPrices = (): Set<string> | null => {
  const raw = (Deno.env.get('STRIPE_PLAN_PRICE_IDS') || '').trim();
  if (!raw) return null;
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return ids.length ? new Set(ids) : null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) return json({ error: 'Set STRIPE_SECRET_KEY as a Supabase secret.' }, 400);
  const stripe = new Stripe(key, { apiVersion: '2024-06-20' });

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  const priceId = String(body.price_id || '');
  // The return addresses, checked rather than passed straight through. Each
  // used to be `String(body.x || 'default')` with nothing between a request
  // body and a payments API. src/lib/redirectTarget.ts holds the rule and
  // says what it is and is not: an unset REDIRECT_ALLOW still refuses the
  // four schemes that are never a redirect target, and setting it makes the
  // list closed.
  const redirectAllow = parseRedirectAllow(Deno.env.get('REDIRECT_ALLOW'));
  const okBack = checkRedirect(body.success_url, 'repple://billing/success', redirectAllow);
  if (!okBack.ok) return json({ error: okBack.reason }, 400);
  const cancelBack = checkRedirect(body.cancel_url, 'repple://billing/cancel', redirectAllow);
  if (!cancelBack.ok) return json({ error: cancelBack.reason }, 400);
  const successUrl = okBack.url;
  const cancelUrl = cancelBack.url;
  if (!priceId) return json({ error: 'missing price_id' }, 400);

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  const { data: auth } = await service.auth.getUser(jwt);
  const userId = auth?.user?.id;
  const email = auth?.user?.email || undefined;
  if (!userId) return json({ error: 'no user' }, 401);

  // ── the price, checked before anything is created ───────────────────────
  //
  // Before the Customer, deliberately: a refusal here must not leave a Stripe
  // Customer behind for a subscription that was never going to be made. See the
  // header for what each of the two arms does and does not prove.
  const allowed = allowedPrices();
  if (allowed) {
    if (!allowed.has(priceId)) {
      console.warn('stripe-checkout: refused price ' + priceId + ' for trainer ' + userId + ' — not in STRIPE_PLAN_PRICE_IDS');
      return json({ error: 'That is not a plan this app sells, so nothing has been charged.' }, 400);
    }
  } else {
    let price: Stripe.Price;
    try {
      price = await stripe.prices.retrieve(priceId);
    } catch (e) {
      // Stripe's own words. "No such price" is the answer to a guessed id and
      // to a live-mode id sent at a test key, and those have different remedies.
      const msg = (e as { message?: string })?.message || String(e);
      console.error('stripe-checkout: price ' + priceId + ' refused by Stripe:', msg);
      return json({ error: msg }, 502);
    }
    // Archived, or not a subscription at all. `mode: 'subscription'` on a
    // one-off price is refused by Stripe anyway, several steps later and with a
    // Customer already made; an archived price is accepted by Stripe and is the
    // one that quietly matters — it puts a coach on a plan this product has
    // stopped selling, at the price it stopped selling it at, for ever.
    if (!price.active || !price.recurring) {
      console.warn('stripe-checkout: refused price ' + priceId + ' for trainer ' + userId
        + ' — active=' + String(price.active) + ' recurring=' + String(!!price.recurring));
      return json({ error: 'That plan is not on sale, so nothing has been charged.' }, 400);
    }
  }

  // Find or create the Stripe customer for this trainer.
  let customerId = '';
  const { data: existing } = await service.from('billing_customers').select('stripe_customer_id').eq('trainer_id', userId).maybeSingle();
  if (existing?.stripe_customer_id) {
    customerId = existing.stripe_customer_id;
  } else {
    const customer = await stripe.customers.create({ email, metadata: { trainer_id: userId } }, {
      // ── the second Customer this paragraph is about ──────────────────────
      //
      // The failure below is described exactly right and was left open. A
      // Customer is created at Stripe, the row that links it to this coach
      // fails, and THE NEXT CALL TO THIS FUNCTION creates a second one — which
      // is not a hypothetical retry, it is what happens when the coach taps
      // Subscribe again after the checkout they were shown did not complete.
      //
      // Keyed on the coach, so a repeat within Stripe's 24-hour idempotency
      // window replays the first Customer instead of making another. That is
      // the whole of the window that matters here: inside it the coach is still
      // in front of the screen and still tapping, and outside it the log line
      // below is the remedy it always was.
      //
      // There is no legitimate second Customer for one coach on this account,
      // which is what makes a key this blunt the right one. The reuse path
      // above is what serves an existing coach; reaching this line at all means
      // no row was found.
      idempotencyKey: `repple-platform-customer:${userId}`,
    });
    customerId = customer.id;
    // Stripe has already created the Customer, so this cannot be answered with
    // an error — the session below still works and the coach still subscribes.
    // But a failure here is not harmless and used to be entirely silent:
    // supabase-js resolves with `{ error }` rather than throwing, so nothing saw
    // it. The row is the ONLY link between this trainer and that Customer, and
    // without it
    //
    //   · the next call to this function finds no row and creates a SECOND
    //     Stripe Customer for the same coach — the duplicate connect-onboard's
    //     header spends a paragraph refusing, splitting their billing across two
    //     ledgers with no way to merge them; and
    //   · supabase/functions/stripe-portal looks the coach up in this same table
    //     and answers "no subscription yet" (404) to somebody whose card is
    //     being charged every month, so they cannot cancel, cannot update the
    //     card and cannot reach an invoice.
    //
    // Logged with both ids, because reconnecting them afterwards needs exactly
    // those two and nothing else records the pair.
    const { error: custErr } = await service.from('billing_customers').upsert({ trainer_id: userId, stripe_customer_id: customerId, email });
    if (custErr) console.error('stripe-checkout: created Stripe customer ' + customerId + ' for trainer ' + userId + ' and could not record it:', custErr.message);
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
