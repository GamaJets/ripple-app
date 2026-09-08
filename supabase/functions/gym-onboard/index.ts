// gym-onboard — creates (or reuses) the GYM's own Stripe connected account and
// returns an onboarding link. The owner completes KYC on Stripe's hosted flow;
// `account.updated` webhooks flip `charges_enabled` and the capability columns.
// Uses STRIPE_SECRET_KEY. Request: { refresh_url?, return_url? } (caller
// identified by JWT).
//
// ── Why this is not connect-onboard with a flag ───────────────────────────
//
// connect-onboard is keyed on `trainer_id` and writes `connect_accounts`, which
// is one row per COACH. A gym is not a coach. Putting the gym's memberships on
// the owner's personal coach account would make a different legal entity the
// merchant of record for every membership the gym sells, and nothing anywhere
// would look wrong: the charge succeeds, the member is a member, and the money
// is in the wrong company's Stripe balance with the wrong company's name on the
// card statement.
//
// So a gym has its own row in `gym_connect_accounts` (part 280), keyed on
// `tenant_id`, and this is the function that creates it. Everything about the
// SHAPE of the account is identical to connect-onboard's and deliberately so —
// same `type: 'standard'`, same two capabilities, same `account_onboarding`
// link, same https return urls — because the reasoning is identical and it is
// written out at length in that file's header. What differs is only who the
// account belongs to.
//
// ── One difference that is not cosmetic: there is no legacy ──────────────
//
// connect-onboard reads CONNECT_ACCOUNT_LIABILITY, because coaches onboarded
// before part 161 are on Express accounts that cannot be converted and an
// account that already exists still has to be describable. No gym has ever had
// an account. There is no history for a switch to describe, so there is no
// switch: a gym gets a STANDARD account taking DIRECT charges, which is the one
// arrangement where Stripe puts fraud and dispute liability on the connected
// account, or it does not sell. Part 280 says the same thing about the table.
//
// ── Who may call it ───────────────────────────────────────────────────────
//
// The gym's OWNER, checked here rather than left to RLS: this runs as the
// service role, which RLS does not apply to, so the ownership check RLS would
// have made has to be made explicitly or any signed-in member could start
// onboarding for their gym.
import Stripe from 'npm:stripe@^16';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { checkRedirect, parseRedirectAllow } from '../../../src/lib/redirectTarget.ts';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** Stripe's own refusal, in the response, rather than an uncaught throw. A
 *  refused account creation has real causes an owner can act on — an
 *  unsupported country, a platform profile that has not been completed — and
 *  "Could not set up payments" names none of them. */
const stripeError = (what: string, e: unknown) => {
  const msg = (e as { message?: string })?.message || String(e);
  console.error('gym-onboard: ' + what + ' refused by Stripe:', msg);
  return json({ error: msg }, 502);
};

/** What Stripe currently says the account can do, flattened into the columns
 *  part 280 declares. Written on the REUSE path as well as on creation, so an
 *  owner who finishes verification and comes straight back has an up-to-date
 *  row without waiting for a webhook delivery — and `gym-checkout` reads these
 *  columns before it will take a charge. */
const accountState = (acct: Stripe.Account) => ({
  charges_enabled: !!acct.charges_enabled,
  details_submitted: !!acct.details_submitted,
  payouts_enabled: !!acct.payouts_enabled,
  card_payments_status: acct.capabilities?.card_payments ?? null,
  transfers_status: acct.capabilities?.transfers ?? null,
  losses_owner: acct.controller?.losses?.payments ?? null,
  // Read off Stripe, never off what this function meant to create. It is the
  // fact `canTakeDirectCharges` gates on, and the two could only ever disagree
  // in the direction that matters.
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

  const { data: prof, error: profErr } = await service.from('profiles')
    .select('role, tenant_id').eq('id', userId).maybeSingle();
  if (profErr) return json({ error: 'could not check who you are: ' + profErr.message }, 500);
  if (!prof?.tenant_id) return json({ error: 'You are not attached to a gym, so there is nothing to set up payments for.' }, 400);
  if (prof.role !== 'owner') return json({ error: 'Only the gym’s owner can set up its payments.' }, 403);
  const tenantId = String(prof.tenant_id);

  let acctId = '';
  const { data: existing, error: readErr } = await service.from('gym_connect_accounts')
    .select('stripe_account_id').eq('tenant_id', tenantId).maybeSingle();
  // A refused READ is not "this gym has no account". Falling through would
  // create a SECOND connected account for a gym that already has one — a
  // duplicate that splits its takings across two ledgers and cannot be merged.
  if (readErr) return json({ error: 'could not check your gym’s payment account: ' + readErr.message }, 500);

  if (existing?.stripe_account_id) {
    acctId = existing.stripe_account_id;
    try {
      const acct = await stripe.accounts.retrieve(acctId);
      // no-count-ok: the same argument connect-onboard makes at the same write,
      // one table across.
      //
      // `existing.stripe_account_id` came off this row a few lines above under
      // the service role, and nothing else filters this update, so zero rows
      // means the gym's `gym_connect_accounts` row went away between that read
      // and this write. What that costs is not a stale capability column — it
      // is a gym with no payment account row at all, and gym-checkout already
      // refuses on it in front of the member: "Your gym cannot take card
      // payments yet, so nothing has been charged. Reception can still take
      // your money at the desk." That is the report, in the place where it is
      // worth something, to the person it stops.
      //
      // And `account.updated` in stripe-webhook writes these same columns and
      // is the path that matters, because an owner who finishes verification on
      // Stripe's hosted flow may never come back through this function.
      const { error: updErr } = await service.from('gym_connect_accounts').update(accountState(acct)).eq('tenant_id', tenantId);
      // Not fatal. The link below is what the owner came for, and the webhook
      // writes the same columns. Losing this refresh delays a capability
      // reading; refusing the link over it strands them entirely.
      if (updErr) console.error('gym-onboard: could not mirror account state:', updErr.message);
    } catch (e) {
      console.error('gym-onboard: could not re-read account ' + acctId + ':', (e as Error).message);
    }
  } else {
    // BOTH capabilities. Stripe is explicit that "for an Account to have the
    // `card_payments` capability, you must request both `card_payments` and
    // `transfers`", and that a full-Dashboard account gets some capabilities
    // requested automatically "based on their country" — a country this
    // function never looks at. `transfers` is not used under direct charges;
    // it is requested because Stripe makes it the precondition for taking a
    // card at all.
    //
    // `type: 'standard'` sent alone. `type` and `controller` are alternatives
    // and sending both is how an account ends up in an arrangement nobody
    // chose. It is also the one field here Stripe will never let us change.
    let acct: Stripe.Account;
    try {
      acct = await stripe.accounts.create({
        email,
        metadata: { tenant_id: tenantId, repple_kind: 'gym' },
        capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
        type: 'standard',
      }, {
        // Keyed on the GYM, and it closes the window the note under the upsert
        // below describes and then leaves open: Stripe creates the account, the
        // row fails, and "the next call would create a second one" — which is
        // the owner tapping "Set up payments" again a minute later. Inside
        // Stripe's 24-hour idempotency window that repeat now returns the FIRST
        // account instead of making a second, and outside it the log line is
        // the remedy it always was.
        //
        // The tenant and not the owner: the account belongs to the gym, and an
        // ownership change must not be able to produce a second one. Only
        // reached when no row exists, so it cannot collide with the reuse path.
        idempotencyKey: `repple-gym-account:${tenantId}`,
      });
    } catch (e) { return stripeError('account creation', e); }
    acctId = acct.id;

    const { error: insErr } = await service.from('gym_connect_accounts').upsert({
      tenant_id: tenantId,
      stripe_account_id: acctId,
      ...accountState(acct),
    });
    // Stripe has already created the account. Answering with an error now would
    // leave a real connected account this database has never heard of, and the
    // next call would create a second one. Logged loudly, and the id returned,
    // which is the only record of it that survives.
    if (insErr) console.error('gym-onboard: created Stripe account ' + acctId + ' for tenant ' + tenantId + ' but could not record it:', insErr.message);
  }

  try {
    const link = await stripe.accountLinks.create({ account: acctId, refresh_url: refreshUrl, return_url: returnUrl, type: 'account_onboarding' });
    return json({ url: link.url, account_id: acctId });
  } catch (e) { return stripeError('onboarding link', e); }
});
