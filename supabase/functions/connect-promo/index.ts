// connect-promo — a coach's discount codes, held at Stripe and nowhere else.
//
// Request: { action: 'create' | 'list' | 'archive', … }
//   create   { code, percent_off, package_id, expires_on?, max_redemptions? }
//   list     {}
//   archive  { promotion_code_id }
//
// ── Why there is no table behind this ─────────────────────────────────────
//
// Stripe already holds the code, the percentage, the expiry, the redemption
// limit AND the redemption count, and it is the thing that actually applies the
// discount at checkout. A mirror of all that in this database would be a second
// copy of a system this app does not control, and the first time the two
// disagreed the screen would be showing a coach an offer that is not the one
// their clients are getting. src/lib/packagePromo.ts carries the long form.
//
// ── ON WHICH ACCOUNT ──────────────────────────────────────────────────────
//
// The coach's connected account, always, and never the platform. A Coupon
// belongs to ONE account and the two id spaces are unrelated — a platform
// coupon id is simply not found on a connected account, which is the same trap
// documented for Customers in connect-checkout. This matters even for a coach
// still on DESTINATION charges: their Checkout Sessions are created on the
// platform, so a promotion code on their connected account would not be found
// at checkout at all.
//
// That is the reason `list` and `create` refuse a coach whose `charge_model` is
// not 'direct'. It is not caution: it is that the discount would silently never
// apply, which is worse than not offering the feature — a coach would print the
// code on a poster and clients would type it into a page that shrugs.
//
// ── WHICH PACKAGES TAKE A CODE ────────────────────────────────────────────
//
// Every subscription, and a one-off only where the discount lands on a whole
// number of minor units. `promoBlocker` decides, from the same module the
// coach's screen runs it from, so the screen's answer and this one cannot
// differ.
//
// The reason a one-off is conditional at all is the platform fee. On a
// subscription Repple's cut is `application_fee_percent` and scales with the
// discount by itself. On a one-off it is an absolute figure Stripe wants in the
// SAME call in which it works the discount out, so it has to come off a total
// connect-checkout computed — and that total is only trustworthy where nothing
// had to be rounded to reach it, because Stripe documents no rounding rule for
// a percentage discount anywhere. 30% of £100.00 is exact; 20% of £49.99 is
// 999.8 minor units and is refused here, with the percentages that DO divide
// that price named in the refusal so the coach has something to type.
//
// Checked again at the checkout, deliberately: a package can be repriced after
// a code is made, and an exactness checked once is one that stops being true.
//
// ── Who may call it ───────────────────────────────────────────────────────
//
// The signed-in coach, about their own account, and nobody else. This runs as
// the service role, which RLS does not apply to, so every lookup below is
// scoped by `trainer_id = uid` explicitly.
import Stripe from 'npm:stripe@^16';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { modelForAccount } from '../../../src/lib/directCharges.ts';
import { normaliseCode, promoBlocker, MAX_PERCENT_OFF, type PromoTarget } from '../../../src/lib/packagePromo.ts';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** Stripe's own refusal, in the response, rather than an uncaught throw. A
 *  rejected call would otherwise become a bare 500 with no body, which the app
 *  reports as a shrug — and the reasons here are specific and actionable, the
 *  commonest being that the code is already in use on this account. */
const stripeError = (what: string, e: unknown) => {
  const msg = (e as { message?: string })?.message || String(e);
  console.error('connect-promo: ' + what + ' refused by Stripe:', msg);
  return json({ error: msg }, 502);
};

/** `YYYY-MM-DD` to the epoch second Stripe wants, at the END of that day in
 *  UTC. A coach who says "ends on the 31st" means the 31st is still good, and
 *  midnight-at-the-start would cut a day off every offer. */
const endOfDayUnix = (isoDay: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDay ?? ''));
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) return json({ error: 'Set STRIPE_SECRET_KEY as a Supabase secret.' }, 400);
  const stripe = new Stripe(key, { apiVersion: '2024-06-20' });

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  const { data: auth } = await service.auth.getUser(jwt);
  const uid = auth?.user?.id;
  if (!uid) return json({ error: 'no user' }, 401);

  // The coach's connected account, and which model it is on. Both matter: a
  // code lives on the connected account, and it is only ever consulted at
  // checkout when the Checkout Session is created there too.
  const { data: acct, error: acctErr } = await service.from('connect_accounts')
    .select('stripe_account_id, charge_model, charges_enabled').eq('trainer_id', uid).maybeSingle();
  if (acctErr) return json({ error: 'could not read your payout account: ' + acctErr.message }, 500);
  if (!acct?.stripe_account_id) {
    return json({ error: 'You have no Stripe account connected yet, so there is nowhere for a code to live. Set up payments first.' }, 409);
  }
  if (modelForAccount(acct) !== 'direct') {
    // Not caution. A code on the connected account is never consulted by a
    // Checkout Session created on the platform, so it would appear to exist and
    // would do nothing — a coach printing it on a poster and clients typing it
    // into a page that shrugs.
    return json({
      error: 'Discount codes are not available on your account yet. Your sales are taken with Repple as the merchant, and a code created on your own Stripe account would never be seen by the payment page — so it would look like it existed and would do nothing at all.',
    }, 409);
  }
  const acctOpts = { stripeAccount: acct.stripe_account_id as string };

  const action = String(body.action || 'list');

  /* ── list ──────────────────────────────────────────────────────────────── */
  if (action === 'list') {
    try {
      // Stripe's own list, with the coupon expanded so the percentage comes
      // back with it. There is no local copy to reconcile against, which is the
      // whole point: the redemption count below is exact because there is only
      // one of it.
      const codes = await stripe.promotionCodes.list({ limit: 100, expand: ['data.coupon'] }, acctOpts);
      return json({
        ok: true,
        codes: codes.data.map((p) => {
          const coupon = p.coupon as Stripe.Coupon;
          return {
            id: p.id,
            code: p.code,
            percentOff: Number(coupon?.percent_off ?? 0),
            active: !!p.active,
            timesRedeemed: Number(p.times_redeemed ?? 0),
            maxRedemptions: p.max_redemptions ?? null,
            expiresOn: p.expires_at ? new Date(p.expires_at * 1000).toISOString().slice(0, 10) : null,
            // Written into metadata at creation, because Stripe's own
            // `applies_to.products` is about PRODUCTS and this app's packages
            // are inline prices with no stored product to point at.
            packageId: (p.metadata?.repple_package_id as string) || null,
          };
        }),
      });
    } catch (e) { return stripeError('listing codes', e); }
  }

  /* ── archive ───────────────────────────────────────────────────────────── */
  if (action === 'archive') {
    const id = String(body.promotion_code_id || '');
    if (!id) return json({ error: 'missing promotion_code_id' }, 400);
    try {
      // Deactivated rather than deleted. Stripe will not delete a promotion
      // code that has been used, and it should not: somebody already
      // subscribed on it keeps the price they signed up at, and a record with
      // no code behind it would leave that unexplainable.
      const updated = await stripe.promotionCodes.update(id, { active: false }, acctOpts);
      return json({ ok: true, id: updated.id, active: !!updated.active });
    } catch (e) { return stripeError('withdrawing a code', e); }
  }

  /* ── create ────────────────────────────────────────────────────────────── */
  if (action !== 'create') return json({ error: 'unknown action' }, 400);

  const code = normaliseCode(String(body.code || ''));
  const percentOff = Math.trunc(Number(body.percent_off));
  const packageId = String(body.package_id || '');
  if (!packageId) return json({ error: 'Choose which package this is for.' }, 400);

  // The package must be one of this coach's own, and the RULE about which kind
  // of package may carry a code is run from the same module the screen runs it
  // from — so the screen's copy is a convenience and this copy is the rule.
  const { data: pkg, error: pkgErr } = await service.from('trainer_packages')
    .select('id, name, billing_interval, active, trainer_id, price_cents').eq('id', packageId).maybeSingle();
  if (pkgErr) return json({ error: 'could not read that package: ' + pkgErr.message }, 500);
  // A stranger's package and a missing one get the same answer.
  if (!pkg || pkg.trainer_id !== uid) return json({ error: 'package not found' }, 404);

  const target: PromoTarget = {
    id: pkg.id,
    name: pkg.name,
    billingInterval: pkg.billing_interval ?? null,
    active: !!pkg.active,
    // The price, because on a ONE-OFF it is half of whether a code may exist at
    // all: Repple's cut there is derived from the discounted total, and that
    // total may only ever be one nothing had to round to reach. `promoBlocker`
    // is where that is decided, from the same module the coach's screen runs it
    // from. Read from the row rather than taken from the request, so a client
    // of this function cannot claim a price.
    priceCents: Number(pkg.price_cents),
  };
  const problems = promoBlocker(code, percentOff, target);
  if (problems.length) return json({ error: problems[0] }, 400);
  // Unreachable while `promoBlocker` holds the same ceiling, and here so that a
  // future divergence between the two produces a refusal rather than a coupon
  // Stripe will make a checkout fail on.
  if (percentOff > MAX_PERCENT_OFF) return json({ error: 'that discount is too large' }, 400);

  const expiresAt = body.expires_on ? endOfDayUnix(String(body.expires_on)) : null;
  if (body.expires_on && expiresAt == null) return json({ error: 'That end date could not be read.' }, 400);

  const maxRedemptions = body.max_redemptions == null ? null : Math.trunc(Number(body.max_redemptions));
  if (maxRedemptions != null && (!Number.isFinite(maxRedemptions) || maxRedemptions < 1)) {
    return json({ error: 'A limit of nought uses is a code nobody can use.' }, 400);
  }

  try {
    // A Coupon carries the discount; a Promotion Code is the string a person
    // types and points at the coupon. Two objects because Stripe models them
    // that way — one coupon can have several codes — and this creates exactly
    // one of each so that withdrawing the code cannot leave a coupon reachable
    // by another route.
    //
    // `duration: 'forever'` on a subscription coupon means the discount applies
    // to every renewal for as long as that subscription runs. That is what a
    // coach means by "20% off": the client who joined on the offer keeps the
    // offer price. `duration: 'once'` would discount the first month and then
    // quietly put them up, which is the shape of a thing customers write
    // reviews about.
    const coupon = await stripe.coupons.create({
      percent_off: percentOff,
      duration: 'forever',
      name: `${percentOff}% off ${pkg.name}`,
      metadata: { repple_package_id: packageId, repple_trainer_id: uid },
    }, acctOpts);

    // ── the half-made offer ────────────────────────────────────────────────
    //
    // Two Stripe objects, created one after the other, and the second one is
    // the one that fails: the commonest refusal this function meets is "code
    // already in use on this account", and it can only be discovered HERE,
    // after the coupon exists. Left alone, that coupon stays on the coach's
    // account for ever — invisible in Repple, because `list` reads promotion
    // codes and there is no code pointing at it, and visible in the coach's
    // own Stripe dashboard as a discount they never made and cannot explain.
    // A coach retrying with a different code accumulates one per attempt.
    //
    // So the second call is caught rather than allowed to escape into the outer
    // handler, and the coupon it was going to belong to is deleted. Stripe
    // permits deleting a coupon that has never been redeemed, which is exactly
    // what one created a moment ago is. The delete is best-effort and its own
    // failure is logged rather than reported: what the coach needs to read is
    // WHY THE CODE WAS REFUSED, and replacing that with a message about
    // tidying up would answer a question they did not ask.
    let promo: Stripe.PromotionCode;
    try {
      promo = await stripe.promotionCodes.create({
        coupon: coupon.id,
        code,
        ...(expiresAt ? { expires_at: expiresAt } : {}),
        ...(maxRedemptions ? { max_redemptions: maxRedemptions } : {}),
        // The package this is FOR, stamped where the list read can find it
        // again. Stripe's own `applies_to.products` is about Products, and this
        // app's packages are inline `price_data` with no stored Product to
        // point at — so the restriction is recorded here and Stripe never acts
        // on it. It used to be enforced by nothing at all beyond which package
        // the coach handed the code out for, so a code made for one recurring
        // package worked on every other one they sell. It is enforced now, at
        // the point the client's code reaches connect-checkout, by
        // `codeAppliesTo` in src/lib/packagePromo.ts — which only became
        // possible once the code was typed in the app rather than on Stripe's
        // own hosted page, where nothing in this repo could see it.
        metadata: { repple_package_id: packageId, repple_trainer_id: uid },
      }, acctOpts);
    } catch (e) {
      try {
        await stripe.coupons.del(coupon.id, acctOpts);
      } catch (delErr) {
        console.error('connect-promo: code ' + code + ' was refused and its coupon ' + coupon.id
          + ' could not be removed from ' + acct.stripe_account_id + ', so it is stranded on that account:',
          (delErr as Error).message);
      }
      return stripeError('creating a code', e);
    }

    return json({
      ok: true,
      id: promo.id,
      code: promo.code,
      percentOff,
      active: !!promo.active,
      timesRedeemed: 0,
      maxRedemptions: promo.max_redemptions ?? null,
      expiresOn: promo.expires_at ? new Date(promo.expires_at * 1000).toISOString().slice(0, 10) : null,
      packageId,
    });
  } catch (e) { return stripeError('creating a code', e); }
});
