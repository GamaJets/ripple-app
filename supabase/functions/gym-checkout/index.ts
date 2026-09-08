// gym-checkout — a member buys a membership term, a drop-in or a class pack
// from their own gym. Creates a Stripe Checkout Session ON THE GYM's connected
// account (a direct charge) and records the order first. Uses
// STRIPE_SECRET_KEY; PLATFORM_FEE_PCT (default 10) is Repple's cut.
//
// Request:
//   { kind: 'membership' | 'pass',
//     plan_id?, pass_type_id?,
//     intent: 'new' | 'renew' | 'upgrade',
//     supersedes_membership_id?,
//     today?, success_url?, cancel_url? }
//
// ═══════════════════════════════════════════════════════════════════════════
// THE FIVE THINGS THIS FILE IS RESPONSIBLE FOR
// ═══════════════════════════════════════════════════════════════════════════
//
// 1. WHOSE ACCOUNT. A coach's package is sold on the coach's account by
//    connect-checkout. A gym's membership is the GYM's, and the account comes
//    from `gym_connect_accounts` keyed on the tenant — never from the owner's
//    personal coach row, which would make a different legal entity the merchant
//    of record for every membership the gym sells. The id it actually used is
//    written onto `gym_orders.stripe_account_id` BEFORE the session is created,
//    so a later refund can be issued in the same context. Nothing downstream
//    re-derives it from the gym's current settings; that is the rule
//    `accountForObject` states in src/lib/directCharges.ts.
//
// 2. DIRECT ONLY. There is no destination-charge branch here and there is not
//    going to be one. A gym sells on a Standard account under direct charges,
//    where Stripe holds the connected account for the fraud and the dispute, or
//    it does not sell. `canTakeDirectCharges` is the gate, imported rather than
//    restated, and src/lib/memberBuy.ts's test asserts the member-facing
//    version of the same check agrees with it on every account shape.
//
// 3. THE QUOTE IS THE SERVER'S. The client sends WHAT it wants to buy and
//    never what it costs or how long it runs. The price comes off
//    `membership_plans` / `gym_pass_types`, the dates come off `termFrom` and
//    `renewStart`, and both are frozen onto the order. A client that could send
//    an amount could send a smaller one.
//
// 4. THE ORDER IS WRITTEN BEFORE STRIPE IS CALLED. An order with no session is
//    a row nobody was charged for. A session with no order is money taken
//    against a purchase this database has no record of, which is the failure
//    that cannot be repaired from either end. So the insert comes first, the
//    session second, and the session id is written back third.
//
// 5. NO SEAT IS SOLD. This function sells memberships and passes, both of which
//    are entitlements the gym can issue any number of. It does not sell a place
//    in a class, because a place is scarce and paying for one is a second act
//    that can fail on its own — the argument is written out at the top of
//    src/lib/memberBuy.ts and it is the reason `kind` has two values and not
//    three.
//
// ── What this deliberately does NOT do ────────────────────────────────────
//
// It creates no Stripe SUBSCRIPTION. A membership is sold one term at a time,
// with a start and an end quoted before the card is touched. Auto-renew is a
// standing promise to charge somebody every month, and honouring one needs a
// renewal ledger, a cancel path, a way to reach an expiring card and a dunning
// story — all of which `client_subscriptions` and part 132 are, for the coach
// side, and half of which shipped would be worse than none.
import Stripe from 'npm:stripe@^16';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { platformFeePct, applicationFeeCents, canTakeDirectCharges } from '../../../src/lib/directCharges.ts';
import { termFrom, renewStart, addDays, expiryFor } from '../../../src/lib/termDates.ts';
import { checkRedirect, parseRedirectAllow } from '../../../src/lib/redirectTarget.ts';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const stripeError = (what: string, e: unknown) => {
  const msg = (e as { message?: string })?.message || String(e);
  console.error('gym-checkout: ' + what + ' refused by Stripe:', msg);
  return json({ error: msg }, 502);
};

const INTERVALS = new Set(['month', 'year', 'once']);
/** The pass kinds a member may buy for themselves. A guest pass names a holder
 *  who is not the buyer and no screen collects one, so it is refused here as
 *  well as filtered in the app. */
const PASS_KINDS = new Set(['drop_in', 'pack']);

/** Today as a bare ISO day, in UTC. */
const utcToday = (): string => new Date().toISOString().slice(0, 10);

/**
 * The calendar day the BUYER is standing in, bounded.
 *
 * A membership term is a run of calendar days in the member's own life
 * (src/lib/localDate.ts), and this server is UTC. A member in Kiritimati at one
 * in the morning is a day ahead of it and one in Midway is most of a day
 * behind, so a term quoted from the server's own date starts on a day that is
 * not theirs.
 *
 * So the client sends its own date and this clamps it to within one day of
 * UTC's, which is the whole real range of earth's timezones. A client that
 * sends nothing, or something outside that window, gets the server's date: the
 * value decides a start and an end date on somebody's membership, and a field
 * a caller controls without limit is a field a caller can set to any year.
 */
function buyerToday(raw: unknown): string {
  const server = utcToday();
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return server;
  const day = raw.trim();
  const lo = addDays(server, -1);
  const hi = addDays(server, 1);
  if (!lo || !hi) return server;
  return day >= lo && day <= hi ? day : server;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) return json({ error: 'Set STRIPE_SECRET_KEY as a Supabase secret.' }, 400);
  const stripe = new Stripe(key, { apiVersion: '2024-06-20' });

  // The platform's cut, checked rather than coerced. `Number('ten')` is NaN and
  // NaN travels: an `application_fee_amount` of NaN is refused by Stripe and
  // the symptom is that nobody at any gym can buy anything, with a typo in one
  // secret as the cause and nothing naming it.
  const feeRead = platformFeePct(Deno.env.get('PLATFORM_FEE_PCT'));
  if (!feeRead.ok) {
    console.error('gym-checkout: ' + feeRead.reason);
    return json({ error: 'Payments are misconfigured on this server, so nothing has been charged.' }, 500);
  }
  const feePct = feeRead.pct;

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  const { data: auth } = await service.auth.getUser(jwt);
  const uid = auth?.user?.id;
  if (!uid) return json({ error: 'no user' }, 401);

  const kind = String(body.kind || '');
  if (kind !== 'membership' && kind !== 'pass') return json({ error: 'missing or unknown kind' }, 400);
  const intentRaw = String(body.intent || 'new');
  const intent = intentRaw === 'renew' || intentRaw === 'upgrade' ? intentRaw : 'new';
  // The return addresses, checked rather than passed straight through. Each
  // used to be `String(body.x || 'default')` with nothing between a request
  // body and a payments API. src/lib/redirectTarget.ts holds the rule and
  // says what it is and is not: an unset REDIRECT_ALLOW still refuses the
  // four schemes that are never a redirect target, and setting it makes the
  // list closed.
  const redirectAllow = parseRedirectAllow(Deno.env.get('REDIRECT_ALLOW'));
  const okBack = checkRedirect(body.success_url, 'repple://membership', redirectAllow);
  if (!okBack.ok) return json({ error: okBack.reason }, 400);
  const cancelBack = checkRedirect(body.cancel_url, 'repple://membership', redirectAllow);
  if (!cancelBack.ok) return json({ error: cancelBack.reason }, 400);
  const successUrl = okBack.url;
  const cancelUrl = cancelBack.url;
  const today = buyerToday(body.today);

  // Which gym the buyer belongs to. Read from the profile rather than taken
  // from the request: a tenant id in a body is a tenant id somebody can change.
  const { data: prof, error: profErr } = await service.from('profiles')
    .select('tenant_id').eq('id', uid).maybeSingle();
  if (profErr) return json({ error: 'could not check which gym you are at: ' + profErr.message }, 500);
  const tenantId = prof?.tenant_id ? String(prof.tenant_id) : '';
  if (!tenantId) return json({ error: 'You are not attached to a gym, so there is nothing to buy here.' }, 400);

  // ── the gym's account ─────────────────────────────────────────────────────
  const { data: acct, error: acctErr } = await service.from('gym_connect_accounts')
    .select('stripe_account_id, charges_enabled, card_payments_status, account_type')
    .eq('tenant_id', tenantId).maybeSingle();
  // A refused read is not "this gym cannot take payments". That is a statement
  // about the gym which the member repeats back to reception, and supabase-js
  // resolves with a null `data` on a database error, so the two would otherwise
  // be the same sentence.
  if (acctErr) return json({ error: 'could not check your gym’s payment account: ' + acctErr.message }, 500);
  const ready = canTakeDirectCharges(acct);
  if (!ready.ok) {
    return json({ error: 'Your gym cannot take card payments yet, so nothing has been charged. Reception can still take your money at the desk.' }, 400);
  }
  const gymAccount = String(acct!.stripe_account_id);
  // The request option that makes it a direct charge: Stripe's `Stripe-Account`
  // header. There is no branch without it here.
  const acctOpts = { stripeAccount: gymAccount };

  // ── what is being bought ──────────────────────────────────────────────────
  let name = '';
  let priceCents = 0;
  let currency = '';
  const order: Record<string, unknown> = {
    tenant_id: tenantId,
    member_id: uid,
    kind,
    intent: kind === 'pass' ? 'new' : intent,
    stripe_account_id: gymAccount,
    status: 'pending',
  };

  if (kind === 'membership') {
    const planId = String(body.plan_id || '');
    if (!planId) return json({ error: 'missing plan_id' }, 400);

    const { data: plan, error: planErr } = await service.from('membership_plans')
      .select('id, tenant_id, name, price_cents, currency, interval, active').eq('id', planId).maybeSingle();
    if (planErr) return json({ error: 'could not read the plan: ' + planErr.message }, 500);
    if (!plan || plan.active !== true) return json({ error: 'That plan is not on sale.' }, 404);
    // The plan must belong to the buyer's own gym. Nothing in the schema forces
    // a membership's tenant to match its plan's — they are two independent
    // foreign keys — so a plan id from another gym would otherwise be sellable
    // to anybody who could guess one.
    if (String(plan.tenant_id) !== tenantId) return json({ error: 'That plan is not sold by your gym.' }, 403);

    const interval = String(plan.interval || '');
    if (!INTERVALS.has(interval)) return json({ error: 'That plan is billed in a way this app does not sell.' }, 400);

    // Where the term starts, which is the whole difference between the three
    // intents. Renewing picks up the day after the current term ends; buying
    // and upgrading both start today.
    let startsOn = today;
    let supersedes: string | null = null;

    if (intent === 'renew' || intent === 'upgrade') {
      const mid = String(body.supersedes_membership_id || '');
      if (!mid) return json({ error: 'missing supersedes_membership_id' }, 400);
      const { data: held, error: heldErr } = await service.from('memberships')
        .select('id, member_id, tenant_id, plan_id, started_on, ends_on, status').eq('id', mid).maybeSingle();
      if (heldErr) return json({ error: 'could not read your membership: ' + heldErr.message }, 500);
      // A membership id is a bearer token if the server never asks whose it is.
      // The same 404 for somebody else's row as for one that does not exist, so
      // that guessing ids reveals nothing about which ones are real.
      if (!held || String(held.member_id) !== uid) return json({ error: 'membership not found' }, 404);
      if (String(held.tenant_id) !== tenantId) return json({ error: 'membership not found' }, 404);
      if (held.status === 'frozen') return json({ error: 'Your membership is frozen, so nothing can be bought against it here. Reception can restart it.' }, 400);

      if (intent === 'upgrade' && String(held.plan_id || '') === planId) {
        // Switching to the plan they are already on is a renewal, and calling
        // it an upgrade would close the membership and open an identical one
        // beside it — two rows, one plan, and a start date that moved for no
        // reason a member could explain.
        return json({ error: 'That is already your plan. Renew it rather than switching to it.' }, 400);
      }
      if (intent === 'renew') {
        if (String(held.plan_id || '') !== planId) return json({ error: 'That is not the plan you are on, so it cannot be renewed. Switching to it is a different purchase.' }, 400);
        const from = renewStart({ endsOn: held.ends_on ?? null }, today);
        // Null means there is no term to extend: an open-ended membership, or a
        // date this app could not read. Computing one anyway is the "Valid until
        // <today + 1 year>" invention src/lib/memberRecord.ts exists to refuse.
        if (!from) return json({ error: 'Your gym has not recorded an end date for this membership, so there is no term to extend. Reception can tell you where it stands.' }, 400);
        startsOn = from;
      }
      supersedes = String(held.id);
    } else {
      // A 'new' purchase over a membership that is still running would leave the
      // member holding two overlapping memberships, paying for both, with
      // `primaryMembership` picking whichever started later. Refused with the
      // two things they can actually do instead.
      const { data: live, error: liveErr } = await service.from('memberships')
        .select('id, ends_on, status').eq('member_id', uid).eq('tenant_id', tenantId)
        .in('status', ['active', 'frozen']).limit(50);
      if (liveErr) return json({ error: 'could not check what you already hold: ' + liveErr.message }, 500);
      const running = (live ?? []).some((m: any) => m.status === 'frozen' || !m.ends_on || String(m.ends_on) >= today);
      if (running) return json({ error: 'You already have a membership running. Renew it or switch plans instead of buying a second one.' }, 409);
    }

    const term = termFrom(startsOn, interval as 'month' | 'year' | 'once');
    name = String(plan.name || '');
    priceCents = Number(plan.price_cents);
    currency = String(plan.currency || '').trim().toLowerCase();
    order.plan_id = planId;
    order.supersedes_membership_id = supersedes;
    order.term_starts_on = term.startsOn;
    order.term_ends_on = term.endsOn;
  } else {
    const typeId = String(body.pass_type_id || '');
    if (!typeId) return json({ error: 'missing pass_type_id' }, 400);

    const { data: pt, error: ptErr } = await service.from('gym_pass_types')
      .select('id, tenant_id, name, kind, price_cents, currency, uses, valid_days, active').eq('id', typeId).maybeSingle();
    if (ptErr) return json({ error: 'could not read the pass: ' + ptErr.message }, 500);
    if (!pt || pt.active !== true) return json({ error: 'That pass is not on sale.' }, 404);
    if (String(pt.tenant_id) !== tenantId) return json({ error: 'That pass is not sold by your gym.' }, 403);
    if (!PASS_KINDS.has(String(pt.kind))) return json({ error: 'That kind of pass is sold at the desk rather than in the app.' }, 400);

    const uses = Number(pt.uses);
    if (!Number.isInteger(uses) || uses < 1) return json({ error: 'That pass is not set up with a number of visits, so it cannot be sold.' }, 400);

    name = String(pt.name || '');
    priceCents = Number(pt.price_cents);
    currency = String(pt.currency || '').trim().toLowerCase();
    order.pass_type_id = typeId;
    order.uses_total = uses;
    // Quoted from TODAY, and honoured at fulfilment, so a member who was shown
    // an expiry date gets that date rather than one recomputed from whenever
    // Stripe got round to confirming.
    order.expires_on = expiryFor(today, pt.valid_days == null ? null : Number(pt.valid_days));
  }

  // No fallback currency. A literal here does not merely mislabel a price, it
  // CHARGES in the wrong money: a London gym's ninety-pound plan sold with an
  // unreadable currency would be billed as ninety of whatever was assumed.
  // `membership_plans.currency` and `gym_pass_types.currency` are both NOT NULL
  // since part 150, so this is unreachable in a healthy database and is checked
  // anyway, because the failure it prevents is somebody's card.
  if (!currency) return json({ error: 'This is priced in a currency your gym has not set, so it cannot be sold yet.' }, 400);
  if (!Number.isInteger(priceCents) || priceCents < 0) return json({ error: 'This is not priced, so it cannot be sold.' }, 400);
  order.amount_cents = priceCents;
  order.currency = currency.toUpperCase();

  // Repple's cut. `fee: null` means OMIT the field and is a different thing
  // from zero: Stripe requires `application_fee_amount` to be positive and
  // strictly less than the charge, so a literal 0 — which is what a 10% fee on
  // a cheap day pass rounds to — is a rejected session and a member staring at
  // a checkout that will not open on a correctly priced pass.
  const feeCalc = applicationFeeCents(priceCents, feePct);
  if (!feeCalc.ok) {
    console.error('gym-checkout: ' + feeCalc.reason);
    return json({ error: 'This cannot be charged for as priced, so nothing has been charged.' }, 400);
  }
  const fee = feeCalc.fee;

  // ── the order, before Stripe ──────────────────────────────────────────────
  const { data: written, error: insErr } = await service.from('gym_orders').insert(order).select('id').maybeSingle();
  if (insErr || !written?.id) {
    console.error('gym-checkout: could not record the order:', insErr?.message ?? 'no row came back');
    return json({ error: 'We could not record this purchase, so nothing has been charged. Try again in a moment.' }, 500);
  }
  const orderId = String(written.id);

  // ── the session, on the gym's own account ────────────────────────────────
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price_data: { currency, unit_amount: priceCents, product_data: { name } }, quantity: 1 }],
      // No `transfer_data`. Under a direct charge the money is already the
      // gym's because the charge was created on their account; pointing the
      // account at itself is a parameter Stripe refuses. The application fee
      // travels the other way, to Repple.
      payment_intent_data: {
        ...(fee === null ? {} : { application_fee_amount: fee }),
      },
      // A Customer and a real Invoice, so the member has something to download
      // and somewhere to reach the card. `mode: 'payment'` creates neither
      // unless it is asked to, which is exactly the hole part 282 records on the
      // coach side of the same problem.
      customer_creation: 'always',
      invoice_creation: { enabled: true },
      success_url: successUrl,
      cancel_url: cancelUrl,
      // `order_id` is the whole identity this needs. The webhook looks the order
      // up by it and copies the quote across; everything else on the row was
      // decided here, by the server, and is not re-derived from metadata.
      // `repple_kind` is what tells the webhook this is a gym sale rather than a
      // coach's package, which is the distinction it already draws for the two
      // subscription businesses arriving down the same pipe.
      metadata: {
        repple_kind: 'gym_order',
        order_id: orderId,
        tenant_id: tenantId,
        member_id: uid,
        repple_account: gymAccount,
      },
    }, {
      ...acctOpts,
      // Keyed on the order, which is written above and exists before this call.
      //
      // What it stops: the Stripe SDK retrying this request itself after a
      // network error, which without a key mints a SECOND live Checkout Session
      // against one `gym_orders` row — and only the second one's id is recorded
      // below, so the first becomes a payable session this app has no record of.
      // `connect-onboard` and `gym-onboard` took keys for the same reason and
      // this was the sale left without one.
      //
      // What it does NOT stop, said plainly rather than left to be assumed: a
      // member tapping Buy twice. That is two requests, so two order rows and
      // two ids, so two keys — and the fix for it is to dedupe the ORDER, not
      // the session, which is a change to what this function does rather than
      // to how safely it does it.
      idempotencyKey: `repple-gym-session:${orderId}`,
    });
  } catch (e) {
    // Nobody was charged: there is no session. The order is closed rather than
    // left pending forever, so the member's screen does not show a purchase
    // waiting on a Stripe confirmation that can never arrive.
    //
    // no-count-ok: and DELIBERATELY not counted, against its counted sibling
    // twenty lines below, because the two writes fail into opposite states.
    //
    // Both are keyed on a row inserted moments earlier under the service role,
    // so for both zero rows can only mean the order has gone — cascaded away by
    // a member deletion mid-flight. Below, that is the alarming state and the
    // only place able to notice it: a live Stripe checkout page in front of a
    // member with no order row behind it. Here there IS no session — this is
    // the catch around the call that failed to create one — so nobody has been
    // charged and nothing will be. The only thing this write exists to prevent
    // is a pending row nobody will ever close, and a row that is not there is
    // not a pending row. Zero rows IS the state being asked for.
    const { error: closeErr } = await service.from('gym_orders')
      .update({ status: 'abandoned', failure_note: 'The checkout session was never created.', updated_at: new Date().toISOString() })
      .eq('id', orderId);
    if (closeErr) console.error('gym-checkout: could not close order ' + orderId + ':', closeErr.message);
    return stripeError('checkout', e);
  }

  const { error: linkErr, count: linked } = await service.from('gym_orders')
    .update({ stripe_session_id: session.id, updated_at: new Date().toISOString() }, { count: 'exact' })
    .eq('id', orderId);
  // The session exists and the member is about to be sent to it. Answering with
  // an error now would tell somebody nothing was charged while a live checkout
  // page is open in front of them. The webhook can still find this order: the
  // session carries `order_id` in its metadata, which is the identity it looks
  // up by, and the session id here is a convenience for reconciliation rather
  // than the key.
  if (linkErr) console.error('gym-checkout: created session ' + session.id + ' for order ' + orderId + ' but could not record it:', linkErr.message);
  // ── and the same for a write that was accepted and changed nothing ────────
  //
  // COUNTED but deliberately NOT returned, and the two halves of that need
  // saying separately.
  //
  // Why it is counted: the row was inserted moments earlier under the service
  // role and its id came back, so nothing filters this update and zero rows can
  // only mean the order row has gone — cascaded away by a member deletion
  // mid-flight is the reachable one. `linkErr` is null in that case, so before
  // this the single most alarming state in the file wrote NOTHING anywhere: a
  // live Stripe checkout page in front of a member, with no order row behind
  // it. This is the only place that can notice it, because it is the only code
  // that holds the session id and the order id at once.
  //
  // Why it is not returned: nothing changes for the member, and nothing about
  // fulfilment depends on this write. `checkout.session.completed` looks the
  // order up by `metadata.order_id` and stamps `stripe_session_id` and
  // `stripe_payment_intent` onto it itself, so an order that IS still there
  // gets its session id from the webhook regardless of this line. And an order
  // that is NOT still there fails visibly at the webhook, which already logs
  // "PAID gym order … has no row in gym_orders … Nothing was fulfilled." What
  // is lost meanwhile is reconciliation of an order that is never paid: an
  // abandoned checkout leaves a pending row with no session id and no intent,
  // and matching it back to a Stripe session by hand is the job this stamp
  // exists to save. That is a report to read, not an error to show a member.
  if (!linkErr && !linked) {
    console.error(
      'gym-checkout: created session ' + session.id + ' for order ' + orderId +
      ' and the order row was not there to record it on. The member has been sent to a live ' +
      'checkout page for an order this database has no row for.',
    );
  }

  return json({ url: session.url, order_id: orderId });
});
