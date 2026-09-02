// stripe-webhook — receives Stripe events and mirrors subscription + invoice
// state into Supabase (for real MRR + dunning). Verifies the signature with
// STRIPE_WEBHOOK_SECRET. Configure the endpoint in the Stripe dashboard to send
// customer.subscription.* and invoice.* events. Writes via the service role.
//
// Two different subscription businesses arrive down this one pipe and must not
// be confused with each other:
//
//   PLATFORM      the owner charges a coach for Repple. Rows in `subscriptions`
//                 and `invoices`, keyed by trainer_id. This is what drives MRR.
//   CONNECT       a client pays a coach for a recurring package (part 97). Rows
//                 in `client_subscriptions`, keyed by the Stripe subscription id,
//                 and — since part 132 — one row per PAID invoice in
//                 `client_subscription_payments`, which is the coach's ledger.
//
// Both carry a trainer_id in their metadata, and they are told apart by
// `repple_kind`, which connect-checkout stamps on the subscription itself.
// Getting that wrong in the obvious direction would file every client's AED 600
// coaching fee as the coach's own Repple plan and count it as platform MRR.
//
// ── WHICH ACCOUNT AN EVENT CAME FROM, and why that is now the first question ──
//
// It used to be true that both businesses arrived as events "on the platform
// account". Under DESTINATION charges the charge is created on the platform, so
// every checkout, subscription and invoice event fired there.
//
// Direct charges break that, and they break it silently. A charge created on
// the coach's connected account produces its events ON THAT ACCOUNT, with
// `event.account` set to `acct_...`. Those events do not arrive at a webhook
// endpoint that is not configured to listen to connected accounts — they are
// simply never delivered. The failure mode is the worst one available in this
// system: the coach is paid, Stripe is happy, and nothing is written here, so
// the client's purchase does not exist in the app. No error, no retry, no row.
//
// That is a DASHBOARD setting, not a code change, and no amount of care in this
// file substitutes for it. See the deployment note at the bottom.
//
// What this file must do is the other half:
//
//   · `event.account` is read on every event and treated as authoritative. An
//     event that arrived from a connected account CANNOT be a platform
//     subscription or a platform invoice, whatever its metadata says, and is
//     never written to `subscriptions` or `invoices`.
//   · Every Stripe API call made about a connected-account object is made in
//     that account's context. `subscriptions.retrieve(subId)` on the platform
//     returns "No such subscription" for a subscription that is charging
//     somebody's card monthly — and that throw becomes a 500, and Stripe
//     retries it forever while the payment goes unrecorded.
//   · The account is STAMPED on the row (part 161), because it is the only way
//     anything later — a cancel, a billing portal, a refund — can find the
//     object again.
//   · When metadata has been stripped in the Stripe dashboard, the account is
//     resolved back to a coach through `connect_accounts`. Under destination
//     charges there was no such fallback and none was needed; under direct
//     charges the account id is often the strongest identity on the event.
//
// ── What is recorded as MONEY, and what is only recorded as a state ────────
//
// Three writes in here are money and are the only ones a coach's earnings may
// ever be added up from:
//
//   client_purchases                a one-off sale, from checkout.session.completed.
//                                   Now carries the SESSION's currency, so the unit
//                                   no longer dies with a deleted package.
//   client_subscription_payments    a paid renewal, from invoice.paid /
//                                   invoice.payment_succeeded. One row per invoice.
//   invoices                        the PLATFORM's, and nothing to do with a coach.
//
// Everything else here is a status. `client_subscriptions.amount_cents` in
// particular is a PRICE — what the subscription is set to charge — and summing
// it over a period would be inventing renewals that may never have been paid.
//
// Every amount written is GROSS. Stripe's processing fee, the platform's
// application fee and the payout schedule are not in any of these events, and
// nothing in here may ever write a column that implies otherwise.
import Stripe from 'npm:stripe@^16';
import { createClient } from 'jsr:@supabase/supabase-js@2';
// The two decisions gym fulfilment turns on, imported rather than restated so a
// screen and its server cannot disagree about what a renewal or an upgrade does
// to somebody's membership. Both are asserted in src/lib/memberBuy.test.ts.
import { renewalIsContiguous, supersedeRow } from '../../../src/lib/termDates.ts';

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

/** Invoice events that change what a subscriber should be told. The rest of
 *  `invoice.*` (created, finalized, updated, …) says nothing a subscription
 *  screen renders, and each one would cost a Stripe round-trip to mirror. */
const INVOICE_ACTIONABLE = new Set([
  'invoice.paid',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'invoice.payment_action_required',
  'invoice.marked_uncollectible',
]);

/** Invoice events that mean MONEY MOVED, as opposed to the ones above that only
 *  mean something to say. Both of these describe the same invoice — Stripe
 *  sends `paid` and `payment_succeeded` for one renewal — and both write the
 *  same row, keyed on the invoice id, so a month's rent is recorded once
 *  however many times Stripe mentions it. */
const INVOICE_PAID = new Set(['invoice.paid', 'invoice.payment_succeeded']);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  // TWO secrets, because Stripe's event destinations are scoped and one endpoint
  // cannot receive both scopes. `account.updated`, which is how we learn a coach
  // has finished onboarding and can take money, only ever comes from a CONNECTED
  // account; the platform's own subscription and invoice events come from the
  // platform. Stripe requires a separate destination for each, and issues each
  // its own signing secret.
  //
  // STRIPE_WEBHOOK_SECRET_CONNECT stopped being optional in practice the moment
  // direct charges were switched on for a single coach. Under destination
  // charges it only carried `account.updated`, so an unset secret cost a
  // capability flag; under direct charges it carries every checkout, every
  // subscription and every paid invoice for every coach on the new model, and
  // an unset secret means their clients' money is never recorded. The code
  // below still tolerates it being unset — a half-configured dashboard should
  // not read like a bug in here — but the deployment note at the bottom of this
  // file says plainly what that now costs.
  //
  // So both are tried. A signature is a cheap HMAC and there are at most two, so
  // trying the second costs nothing measurable and saves running a second copy
  // of this whole function under a different name.
  //
  // The connect one is OPTIONAL: with it unset this behaves exactly as it did
  // before, which is what keeps a half-finished dashboard setup working rather
  // than failing in a way that reads like a bug in here.
  const whSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  const whSecretConnect = Deno.env.get('STRIPE_WEBHOOK_SECRET_CONNECT');
  if (!key || !whSecret) return json({ error: 'Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.' }, 400);
  const stripe = new Stripe(key, { apiVersion: '2024-06-20' });

  const sig = req.headers.get('stripe-signature') || '';
  const raw = await req.text();
  let event: Stripe.Event | null = null;
  let firstError = '';
  for (const secret of [whSecret, whSecretConnect]) {
    if (!secret) continue;
    try {
      event = await stripe.webhooks.constructEventAsync(raw, sig, secret, undefined, Stripe.createSubtleCryptoProvider());
      break;
    } catch (e) {
      // Kept from the FIRST attempt: it is the platform secret, the one almost
      // every event arrives under, and so the one whose message is worth
      // reading when nothing verifies.
      if (!firstError) firstError = (e as Error).message;
    }
  }
  if (!event) {
    return json({ error: 'signature verification failed: ' + firstError }, 400);
  }

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // WHICH ACCOUNT this event came from. Null for the platform; `acct_...` for a
  // connected account, which under direct charges is where a coach's every sale
  // now happens.
  //
  // This single field is the most reliable thing on the event. Metadata can be
  // stripped by anyone editing a subscription in the Stripe dashboard — the
  // comments below and in `writeConnectSub` are all about surviving that — but
  // the account an event was delivered from is Stripe's own routing and is not
  // editable. So it is read first and trusted furthest.
  const eventAccount = typeof event.account === 'string' && event.account.trim() ? event.account.trim() : null;

  // The coach who owns a connected account. Only ever consulted when the
  // metadata that normally carries `trainer_id` is gone: under direct charges
  // the account id is frequently the strongest identity left on an event, and
  // without this a renewal with stripped metadata would be a payment filed
  // against nobody, which is a payment no coach can ever see.
  //
  // A failed read returns null rather than throwing: the callers below all
  // treat a null trainer as "identity unknown, write what we do have", which is
  // strictly better than dropping money on the floor.
  const trainerOfAccount = async (acctId: string | null): Promise<string | null> => {
    if (!acctId) return null;
    const { data, error } = await service.from('connect_accounts').select('trainer_id').eq('stripe_account_id', acctId).maybeSingle();
    if (error) { console.error('stripe-webhook: could not resolve account ' + acctId + ' to a trainer:', error.message); return null; }
    return data?.trainer_id ?? null;
  };

  const trainerOf = async (customerId: string | null, metaId?: string | null): Promise<string | null> => {
    if (metaId) return metaId;
    if (!customerId) return null;
    const { data } = await service.from('billing_customers').select('trainer_id').eq('stripe_customer_id', customerId).maybeSingle();
    return data?.trainer_id ?? null;
  };

  // When Stripe says this happened. Webhooks are retried and are NOT ordered,
  // so every write below that can be superseded is stamped with this and
  // filtered on it, rather than trusting arrival order.
  const eventAt = new Date((event.created || Math.floor(Date.now() / 1000)) * 1000).toISOString();

  // Already handled? Every branch here is an upsert on a unique key, so a
  // replay overwrites rather than doubles — this is the second line of defence,
  // and the one that keeps that true for branches added later.
  //
  // A failure to READ the ledger is not a reason to drop the event: the
  // branches are idempotent, so handling it twice is survivable and dropping it
  // is not.
  const { data: seen, error: seenErr } = await service.from('stripe_webhook_events').select('id').eq('id', event.id).maybeSingle();
  if (seenErr) console.error('stripe-webhook: replay ledger unreadable, handling anyway:', seenErr.message);
  else if (seen) return json({ received: true, duplicate: true });

  // A write that failed must not be answered with 200.
  //
  // supabase-js resolves with { error } rather than throwing, so the catch
  // below never sees a rejected write — every branch here used to fall through
  // to `{ received: true }`. Stripe treats that as delivered and never retries,
  // so a purchase the database refused (a deleted client_id, a constraint, a
  // type error on amount_cents) disappears: the money moved and nothing records
  // it. A 5xx is what asks Stripe to try again, and every write below is an
  // upsert on a unique key, so being tried again is safe.
  const fail = (what: string, why: string) => json({ error: what + ' write failed: ' + why }, 500);

  /**
   * Is this a client paying a coach, rather than a coach paying Repple?
   *
   * `eventAccount` first, and on its own sufficient. An event delivered from a
   * connected account cannot be the platform's own billing: Repple's coaches
   * pay Repple on the PLATFORM account, and nothing about that arrangement ever
   * touches a coach's connected account. So a connected-account event is a
   * Connect event by construction, whatever its metadata does or does not say.
   *
   * That is not a shortcut, it is the repair for a hole direct charges open. A
   * direct-charge subscription whose metadata was stripped in the dashboard
   * would fall through the metadata test below, be read as the coach's own
   * Repple plan, and be filed in `subscriptions` — inventing platform MRR out
   * of a client's coaching fee, which is exactly the confusion the header of
   * this file exists to prevent.
   */
  const isConnect = (meta: Record<string, string> | null | undefined) =>
    !!eventAccount || (!!meta && (meta.repple_kind === 'connect_subscription' || !!meta.package_id));

  /**
   * Which account a Connect object should be recorded as living on.
   *
   * The event's own account is the truth. `repple_account`, which
   * connect-checkout stamps into metadata, is the fallback for the one case the
   * event cannot answer: a `checkout.session.completed` that Stripe delivers on
   * the platform for a session that was nonetheless created on a connected
   * account. Empty string in that metadata means the platform, deliberately —
   * Stripe metadata values are strings and there is no null to send.
   *
   * Null means the platform, which is where every object created before this
   * change lives, and null is therefore also the right answer when neither
   * source says anything.
   */
  const accountForRow = (meta: Record<string, string> | null | undefined): string | null => {
    if (eventAccount) return eventAccount;
    const stamped = (meta?.repple_account || '').trim();
    return stamped || null;
  };

  /**
   * One membership term, written from a paid gym order.
   *
   * Every value comes off the ORDER and none is recomputed here. The member was
   * quoted a start and an end before their card was touched (see
   * supabase/functions/gym-checkout), and a webhook that arrives a day late
   * must not shorten what they bought.
   *
   * `gym_order_id` is stamped in the same insert, which is what makes a retry
   * of this event find the row instead of writing a second one — the unique
   * index in part 281 is the backstop if two ever race.
   */
  const insertMembership = async (order: any, orderId: string): Promise<{ id: string | null; error: string | null }> => {
    const { data, error } = await service.from('memberships').insert({
      tenant_id: order.tenant_id,
      member_id: order.member_id,
      plan_id: order.plan_id,
      started_on: order.term_starts_on,
      ends_on: order.term_ends_on,
      status: 'active',
      gym_order_id: orderId,
    }).select('id').maybeSingle();
    if (error) return { id: null, error: error.message };
    return { id: data?.id ?? null, error: null };
  };

  /**
   * Mirror one Connect subscription. `at` is how current the object is — the
   * event's own timestamp for an event payload, now() for something just
   * re-read from Stripe.
   *
   * Written as insert-if-absent then guarded update rather than a plain upsert
   * because the guard is the whole point: an `updated` from 10:00:00 delivered
   * after the `deleted` from 10:00:01 would otherwise put a cancelled
   * subscription back on the client's screen as active, and they would believe
   * their cancellation had not gone through and cancel it again.
   */
  const writeConnectSub = async (sub: Stripe.Subscription, at: string): Promise<string | null> => {
    const meta = (sub.metadata || {}) as Record<string, string>;
    const price = sub.items?.data?.[0]?.price;
    // Identity comes from metadata and is only ever written, never cleared: a
    // subscription edited in the Stripe dashboard can come back with its
    // metadata stripped, and nulling client_id would orphan a live paying
    // subscriber from the person paying it.
    const identity: Record<string, unknown> = {};
    if (meta.client_id) identity.client_id = meta.client_id;
    if (meta.trainer_id) identity.trainer_id = meta.trainer_id;
    if (meta.package_id) identity.package_id = meta.package_id;

    // The coach, recovered from the account when the metadata that normally
    // names them has been stripped. Only ever fills a GAP — `meta.trainer_id`
    // wins whenever it is there — because the account resolves to the coach who
    // owns it, which is the right answer for a direct charge and no answer at
    // all for a destination one.
    if (!identity.trainer_id && eventAccount) {
      const fromAcct = await trainerOfAccount(eventAccount);
      if (fromAcct) identity.trainer_id = fromAcct;
    }

    // Which ledger this subscription lives on, written once and then read by
    // every later call about it: connect-checkout's cancel, resume and billing
    // portal all scope themselves with this column. Like the identity fields it
    // is only ever written, never cleared — a subscription that came back from
    // a dashboard edit with nothing on it must not lose the one field that says
    // where to find it.
    const onAccount = accountForRow(meta);

    // The amount is what Stripe bills, in minor units, taken from the price on
    // the subscription — not from trainer_packages, which the coach can edit
    // after the fact. Null when Stripe does not state one, and it stays null:
    // a subscription rendered as "AED 0.00" is a lie about somebody's money.
    const row: Record<string, unknown> = {
      ...identity,
      ...(onAccount ? { stripe_account_id: onAccount } : {}),
      stripe_subscription_id: sub.id,
      stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : (sub.customer as Stripe.Customer | null)?.id ?? null,
      status: sub.status,
      amount_cents: price?.unit_amount ?? null,
      currency: price?.currency ?? meta.package_currency ?? null,
      billing_interval: price?.recurring?.interval ?? null,
      current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
      cancel_at_period_end: !!sub.cancel_at_period_end,
      stripe_event_at: at,
      updated_at: new Date().toISOString(),
    };

    const { error: insErr } = await service.from('client_subscriptions')
      .upsert(row, { onConflict: 'stripe_subscription_id', ignoreDuplicates: true });
    if (insErr) return insErr.message;

    // Two plain filters rather than one `.or(...)`: an ISO timestamp inside
    // PostgREST's or() grammar is a value full of the punctuation that grammar
    // parses on, and a filter that silently fails to apply here is a filter
    // that lets a stale event overwrite a live subscription.
    const { error: updErr } = await service.from('client_subscriptions').update(row)
      .eq('stripe_subscription_id', sub.id).lte('stripe_event_at', at);
    if (updErr) return updErr.message;
    const { error: nullErr } = await service.from('client_subscriptions').update(row)
      .eq('stripe_subscription_id', sub.id).is('stripe_event_at', null);
    if (nullErr) return nullErr.message;
    return null;
  };

  try {
    if (event.type.startsWith('customer.subscription.')) {
      const sub = event.data.object as Stripe.Subscription;
      if (isConnect(sub.metadata as Record<string, string>)) {
        // A client's coaching subscription. It is NOT the coach's Repple plan,
        // and must not land in `subscriptions` — that table is the platform's
        // revenue, and a client's fee counted there is invented MRR.
        const why = await writeConnectSub(sub, eventAt);
        if (why) return fail('client_subscriptions', why);
      } else {
        // The platform's own billing. Unreachable from a connected account by
        // construction — `isConnect` returns true for any event with an
        // `account`, so arriving here means this event came from the platform,
        // where Repple's coaches pay Repple.
        const trainerId = await trainerOf(sub.customer as string, (sub.metadata as any)?.trainer_id);
        if (trainerId) {
          const { error } = await service.from('subscriptions').upsert({
            trainer_id: trainerId,
            stripe_subscription_id: sub.id,
            plan: sub.items?.data?.[0]?.price?.nickname ?? sub.items?.data?.[0]?.price?.id ?? null,
            status: sub.status,
            current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
            cancel_at_period_end: !!sub.cancel_at_period_end,
            updated_at: new Date().toISOString(),
          });
          if (error) return fail('subscriptions', error.message);
        }
      }
    } else if (event.type === 'account.updated') {
      // Stripe Connect: a trainer's connected account status changed.
      //
      // The capability columns part 161 added are written here as well as
      // in connect-onboard, and this is the path that matters: a coach finishes
      // verification on Stripe's hosted flow and never comes back through the
      // app, so `account.updated` is the only thing that will ever tell us
      // `card_payments` went active. connect-checkout refuses a DIRECT charge
      // while that capability is present and not active, so a coach whose
      // status is never written stays unable to sell.
      //
      // `losses_owner` is recorded because it is the answer to who pays for a
      // chargeback, it is fixed at account creation, and it cannot be worked
      // out later from anything else this database holds.
      //
      // `account_type` is recorded for the same reason and is the one
      // connect-checkout actually gates on: a direct charge is refused on
      // anything that is not 'standard', because on a legacy Express account
      // Stripe still holds the PLATFORM for the fraud, the dispute and the
      // negative balance whatever `charge_model` says. Writing it here is also
      // how every coach onboarded before today gets 'express' filled in without
      // opening the app — Stripe sends `account.updated` for its own reasons,
      // and a null type is refused, so the column must not depend on the coach
      // coming back through connect-onboard.
      const acct = event.data.object as Stripe.Account;
      const { error } = await service.from('connect_accounts').update({
        charges_enabled: !!acct.charges_enabled,
        details_submitted: !!acct.details_submitted,
        payouts_enabled: !!acct.payouts_enabled,
        card_payments_status: acct.capabilities?.card_payments ?? null,
        transfers_status: acct.capabilities?.transfers ?? null,
        losses_owner: acct.controller?.losses?.payments ?? null,
        account_type: acct.type ?? null,
        updated_at: new Date().toISOString(),
      }).eq('stripe_account_id', acct.id);
      if (error) return fail('connect_accounts', error.message);

      // The same event, for a GYM's own account (part 280).
      //
      // Written as a second UPDATE rather than as a branch, because an account
      // id belongs to exactly one of the two tables and neither read is
      // expensive: `connect_accounts` is keyed on the coach and
      // `gym_connect_accounts` on the tenant, and an id in one is in neither
      // the other's index nor its rows. An UPDATE that matches nothing is not
      // an error in PostgREST and costs one index probe.
      //
      // It matters as much here as it does for a coach and for the same reason:
      // an owner finishes verification on Stripe's hosted flow and may never
      // come back through the app, so this is the only thing that will ever
      // tell us `card_payments` went active. `gym-checkout` refuses a charge
      // while that capability is present and not active, so a gym whose status
      // is never written stays unable to sell to anybody.
      const { error: gymErr } = await service.from('gym_connect_accounts').update({
        charges_enabled: !!acct.charges_enabled,
        details_submitted: !!acct.details_submitted,
        payouts_enabled: !!acct.payouts_enabled,
        card_payments_status: acct.capabilities?.card_payments ?? null,
        transfers_status: acct.capabilities?.transfers ?? null,
        losses_owner: acct.controller?.losses?.payments ?? null,
        account_type: acct.type ?? null,
        updated_at: new Date().toISOString(),
      }).eq('stripe_account_id', acct.id);
      if (gymErr) return fail('gym_connect_accounts', gymErr.message);
    } else if (event.type === 'payout.paid' || event.type === 'payout.failed'
               || event.type === 'payout.updated' || event.type === 'payout.canceled') {
      // ── what actually landed in the coach's bank ─────────────────────────
      //
      // Every takings figure in this app is GROSS — what a client was charged —
      // and `STRIPE_AUTHORITY_NOTE` has always said that Stripe's fee, the
      // platform's fee and whether the money cleared are things this app was
      // never told. The gap between "AED 4,800 taken" and "AED 4,281 in my
      // account" is the gap a coach fills with a suspicion about the platform,
      // and nothing in the product could answer it.
      //
      // A payout is a BALANCE reaching a bank: the residue of many charges,
      // minus fees, minus refunds. It can never be traced back to a particular
      // sale and nothing here tries — see `PAYOUT_IS_NOT_A_SALE` in
      // src/lib/coachPayouts.ts, which is the sentence on the screen.
      const payout = event.data.object as Stripe.Payout;

      // THE guard. Repple has a Stripe balance too and it pays out; those
      // events arrive on the PLATFORM destination with no `event.account`, and
      // recording one would put the platform's own banking on a coach's money
      // screen. A payout with no connected account behind it is not a coach's.
      if (!eventAccount) {
        console.log('stripe-webhook: platform payout ' + payout.id + ' ignored — not a coach’s');
      } else {
        // Null when the account resolves to no coach. The row is still written:
        // a payout this database cannot attribute still happened, and dropping
        // it to protect a join would lose money from the record. Nobody can
        // read such a row, which is the honest outcome rather than a guess.
        const coachId = await trainerOfAccount(eventAccount);
        if (!coachId) console.warn('stripe-webhook: payout ' + payout.id + ' on ' + eventAccount + ' resolves to no coach');

        // Upserted on Stripe's own payout id, so at-least-once delivery and a
        // `payout.updated` following a `payout.paid` overwrite rather than
        // double. `stripe_event_at` moves with it and is what a later-arriving
        // OLDER event would be filtered on by anything that reads these in
        // order — webhooks are retried and are not ordered.
        const { error } = await service.from('coach_payouts').upsert({
          id: payout.id,
          coach_id: coachId,
          stripe_account_id: eventAccount,
          amount_cents: payout.amount,
          currency: payout.currency,
          // Stripe's word, verbatim and never coerced. A status Stripe adds
          // later must land here unchanged rather than be mapped to the nearest
          // one this app knows — and `payoutStateLabel` resolves an unknown one
          // to "not stated" rather than to "paid".
          status: payout.status,
          arrival_on: payout.arrival_date ? new Date(payout.arrival_date * 1000).toISOString().slice(0, 10) : null,
          // The single most useful string on the row. A payout that bounced
          // because the bank details are wrong is a coach who is not being paid
          // and does not know it.
          failure_message: payout.failure_message ?? null,
          stripe_event_at: eventAt,
        });
        if (error) return fail('coach_payouts', error.message);
      }
    } else if (event.type === 'checkout.session.completed') {
      // A client bought a trainer's package (Connect checkout).
      const sess = event.data.object as Stripe.Checkout.Session;
      const meta = (sess.metadata || {}) as Record<string, string>;

      // ── a member bought something from their GYM ─────────────────────────
      //
      // A third business arrives down this pipe. `repple_kind: 'gym_order'`
      // tells it apart, the same way `connect_subscription` tells a client's
      // coaching subscription from a coach's own Repple plan, and getting it
      // wrong in the obvious direction would file a gym's membership income as
      // a coach's package sale on a `trainer_id` nobody set.
      //
      // WHAT FULFILMENT MEANS HERE. `gym_orders` is the money; the ENTITLEMENT
      // is a row in `memberships` or `gym_passes`, and it is written here
      // because this is the only moment anything knows the money moved. Every
      // date and every figure is copied off the ORDER rather than recomputed:
      // the member was quoted a term before their card was touched, and a
      // webhook that arrives a day late must not shorten it.
      //
      // IDEMPOTENCE, which a webhook needs and a payment needs more than most.
      // Three guards, in order of how much they cost: the replay ledger above
      // catches the ordinary duplicate delivery; an order already marked 'paid'
      // is left alone; and the entitlement itself carries `gym_order_id` with a
      // UNIQUE index (part 281), which is the one that covers the dangerous
      // window — a retry after the membership was inserted and before the order
      // was closed. Without the third, one payment buys two memberships.
      if (meta.repple_kind === 'gym_order' && meta.order_id) {
        const orderId = meta.order_id;
        const nowIso = new Date().toISOString();
        const { data: order, error: ordErr } = await service.from('gym_orders')
          .select('id, tenant_id, member_id, kind, intent, status, amount_cents, currency, plan_id, pass_type_id, supersedes_membership_id, term_starts_on, term_ends_on, uses_total, expires_on, membership_id, pass_id')
          .eq('id', orderId).maybeSingle();
        if (ordErr) return fail('gym_orders lookup', ordErr.message);

        if (!order) {
          // Money has moved against an order this database has no record of.
          // Retrying cannot conjure the row, so the event is accepted and the
          // fact is logged as loudly as a log can be: the Stripe payment is the
          // surviving record and somebody has to reconcile it by hand.
          console.error('stripe-webhook: PAID gym order ' + orderId + ' has no row in gym_orders. Session ' + sess.id + ', account ' + (eventAccount ?? 'platform') + '. Nothing was fulfilled.');
        } else if (order.status === 'paid') {
          // Already done. Not an error and not worth a second write.
        } else if (sess.payment_status !== 'paid' && sess.payment_status !== 'no_payment_required') {
          // A completed session is not necessarily a paid one — a delayed
          // payment method completes and settles later. Nothing is granted
          // until it does, and the order stays pending rather than being
          // closed against a payment that has not happened.
          console.warn('stripe-webhook: gym order ' + orderId + ' completed with payment_status ' + String(sess.payment_status) + '; nothing granted yet.');
        } else {
          const pi = typeof sess.payment_intent === 'string' ? sess.payment_intent : (sess.payment_intent?.id ?? null);
          let membershipId: string | null = order.membership_id ?? null;
          let passId: string | null = order.pass_id ?? null;
          let problem: string | null = null;

          if (order.kind === 'membership') {
            // Anything this order has already produced. The unique index makes
            // this the authoritative answer rather than a guess.
            const { data: already, error: alreadyErr } = await service.from('memberships')
              .select('id').eq('gym_order_id', orderId).maybeSingle();
            if (alreadyErr) return fail('memberships lookup', alreadyErr.message);

            if (already?.id) {
              membershipId = already.id;
            } else if (order.intent === 'renew' && order.supersedes_membership_id) {
              // Extend, or start again after a gap. `renewalIsContiguous` is
              // the decision and it is not cosmetic: pushing `ends_on` out
              // across a lapse would leave a membership row claiming somebody
              // was a member through weeks they were not, and that row is what
              // an attendance or billing dispute is settled against.
              const { data: held, error: heldErr } = await service.from('memberships')
                .select('id, member_id, plan_id, started_on, ends_on').eq('id', order.supersedes_membership_id).maybeSingle();
              if (heldErr) return fail('memberships lookup', heldErr.message);
              if (!held || String(held.member_id) !== String(order.member_id)) {
                problem = 'The membership this renewal was for could not be found.';
              } else if (renewalIsContiguous(held.ends_on ?? null, String(order.term_starts_on))) {
                const { error: extErr, count } = await service.from('memberships').update({
                  ends_on: order.term_ends_on,
                  status: 'active',
                  gym_order_id: orderId,
                }, { count: 'exact' }).eq('id', held.id);
                if (extErr) return fail('memberships', extErr.message);
                // A write that matched no rows is not an error in PostgREST. It
                // would mean the renewal was paid for and the membership never
                // moved, which is exactly the state that must not be recorded
                // as success.
                if (count === 0) problem = 'The membership could not be extended.';
                else membershipId = held.id;
              } else {
                const fresh = await insertMembership(order, orderId);
                if (fresh.error) return fail('memberships', fresh.error);
                membershipId = fresh.id;
                if (!membershipId) problem = 'The new term could not be recorded.';
              }
            } else {
              const fresh = await insertMembership(order, orderId);
              if (fresh.error) return fail('memberships', fresh.error);
              membershipId = fresh.id;
              if (!membershipId) problem = 'The membership could not be recorded.';
              // An upgrade closes the one it replaces. Written AFTER the new
              // membership exists, so a failure here leaves somebody with two
              // running memberships rather than none.
              if (membershipId && order.intent === 'upgrade' && order.supersedes_membership_id) {
                const { data: held, error: heldErr } = await service.from('memberships')
                  .select('id, member_id, started_on').eq('id', order.supersedes_membership_id).maybeSingle();
                if (heldErr) return fail('memberships lookup', heldErr.message);
                if (held && String(held.member_id) === String(order.member_id)) {
                  const close = supersedeRow({ startedOn: String(held.started_on) }, String(order.term_starts_on));
                  if (close) {
                    const { error: closeErr } = await service.from('memberships')
                      .update({ status: close.status, ends_on: close.ends_on }).eq('id', held.id);
                    // Logged, not fatal, and not `problem`: the member HAS the
                    // plan they paid for. What is wrong is that the old one is
                    // still open beside it, which is a tidy-up rather than a
                    // reason to tell somebody their purchase failed.
                    if (closeErr) console.error('stripe-webhook: gym order ' + orderId + ' upgraded but the old membership ' + held.id + ' was not closed:', closeErr.message);
                  }
                }
              }
            }
          } else {
            const { data: already, error: alreadyErr } = await service.from('gym_passes')
              .select('id').eq('gym_order_id', orderId).maybeSingle();
            if (alreadyErr) return fail('gym_passes lookup', alreadyErr.message);
            if (already?.id) {
              passId = already.id;
            } else {
              const { data: made, error: passErr } = await service.from('gym_passes').insert({
                tenant_id: order.tenant_id,
                pass_type_id: order.pass_type_id,
                holder_id: order.member_id,
                expires_on: order.expires_on,
                uses_total: order.uses_total,
                // What was ACTUALLY taken, from Stripe, in the unit Stripe
                // charged in. `gym_passes.paid_cents` is null when nobody
                // recorded a price, which is a different fact from free, and
                // `passRevenueCents` counts those out of a total rather than as
                // zero. Stripe stated both here, so both are recorded.
                paid_cents: sess.amount_total ?? order.amount_cents,
                currency: (sess.currency ?? order.currency ?? '').toUpperCase(),
                gym_order_id: orderId,
              }).select('id').maybeSingle();
              if (passErr) return fail('gym_passes', passErr.message);
              passId = made?.id ?? null;
              if (!passId) problem = 'The pass could not be recorded.';
            }
          }

          if (problem) {
            // The money moved and the entitlement did not. Recorded as 'failed'
            // with the reason, because a member who has paid and holds nothing
            // must not be left looking at a screen that shows no membership and
            // says nothing about why.
            const { error: markErr } = await service.from('gym_orders').update({
              status: 'failed',
              failure_note: problem,
              stripe_session_id: sess.id,
              stripe_payment_intent: pi,
              paid_at: eventAt,
              updated_at: nowIso,
            }).eq('id', orderId);
            if (markErr) return fail('gym_orders', markErr.message);
            console.error('stripe-webhook: gym order ' + orderId + ' was paid and could not be fulfilled: ' + problem);
          } else {
            const { error: doneErr } = await service.from('gym_orders').update({
              status: 'paid',
              membership_id: membershipId,
              pass_id: passId,
              stripe_session_id: sess.id,
              stripe_payment_intent: pi,
              paid_at: eventAt,
              failure_note: null,
              updated_at: nowIso,
            }).eq('id', orderId);
            if (doneErr) return fail('gym_orders', doneErr.message);
          }
        }
      }

      // A subscription checkout also completes, with an amount_total that is
      // only the FIRST month. Recording it as a purchase would put a one-off
      // sale in the client's history for a thing that recurs, and — worse —
      // grant session credits from `sessions` metadata that nothing renews.
      // `customer.subscription.created` is the record of a subscription.
      if (meta.package_id && sess.mode !== 'subscription') {
        const sessions = meta.sessions ? parseInt(meta.sessions, 10) : null;
        // The coach, recovered from the account if the metadata is gone. A
        // one-off sale filed against a null trainer_id is a sale that never
        // appears on the coach's payments screen, and there is no later event
        // that would correct it — unlike a subscription, a one-off is
        // mentioned by Stripe exactly once.
        const trainerId = meta.trainer_id || (await trainerOfAccount(eventAccount)) || null;

        // ── the prediction, checked ──────────────────────────────────────
        //
        // A discount code on a one-off is the one place this app computes a
        // figure it cannot read back from Stripe first. Repple's cut there is
        // `application_fee_amount`, an INPUT to the call whose OUTPUT is
        // `amount_total`, so connect-checkout derives the fee from a total it
        // worked out and stamps that total here. Part 311 has the full
        // argument, including why this is recorded rather than refused.
        //
        // Only present when a code was involved. With no discount the fee comes
        // off the list price, which is what Stripe charges, and there is
        // nothing predicted — so the column stays NULL and null means exactly
        // that, never "checked and equal".
        const predicted = meta.repple_expected_total ? Number(meta.repple_expected_total) : null;
        const charged = typeof sess.amount_total === 'number' ? sess.amount_total : null;
        const variance = predicted != null && Number.isFinite(predicted) && charged != null
          ? charged - predicted
          : null;
        if (variance) {
          // Loudly, and with everything needed to work out who is short and by
          // how much. Repple's cut on this sale came off `predicted`, so the
          // coach is out by roughly the platform percentage of `variance` — and
          // if this ever fires it fires on EVERY sale of that package, because
          // the cause is arithmetic rather than luck.
          console.error('stripe-webhook: ONE-OFF FEE TAKEN FROM THE WRONG TOTAL', {
            session: sess.id,
            package: meta.package_id,
            trainer: trainerId,
            predicted,
            charged,
            variance,
          });
        }

        const { error } = await service.from('client_purchases').upsert({
          client_id: meta.client_id || null,
          trainer_id: trainerId,
          package_id: meta.package_id,
          stripe_session_id: sess.id,
          // Which ledger the charge was created on. Null is the platform, which
          // is where every sale before this change was made. It is recorded on
          // a one-off — which has no further Stripe calls made about it in the
          // ordinary course — because a REFUND does, and a refund on a direct
          // charge has to be issued in the connected account's context.
          ...(accountForRow(meta) ? { stripe_account_id: accountForRow(meta) } : {}),
          // The Stripe Customer this sale was charged to (part 282), so a
          // client who has only ever bought one-off packs has a billing portal
          // to reach. Null on every sale made before `customer_creation` was
          // asked for, and null stays null: there is no Customer at Stripe to
          // point at and one cannot be manufactured afterwards.
          ...(typeof sess.customer === 'string' && sess.customer ? { stripe_customer_id: sess.customer } : {}),
          amount_cents: sess.amount_total,
          // The unit the amount beside it is in, from the SESSION — what Stripe
          // actually charged in, not what the package row says today.
          //
          // Until part 132 this column did not exist and the unit lived only in
          // `trainer_packages`, so a coach who deleted a package left every sale
          // made from it denominated in nothing, forever: an amount the app can
          // never print again, because in a white-label product there is no
          // currency it could assume that is not simply wrong for half the gyms
          // running it. Stripe has stated it right here on every one of these
          // events all along.
          //
          // Null if Stripe somehow states none, and it stays null — the screen
          // counts those out of the total and says how many are missing, which
          // is the honest handling of a hole rather than a reason to fill it in.
          currency: sess.currency ?? null,
          sessions_total: isNaN(sessions as number) ? null : sessions,
          status: 'paid',
          // NULL when nothing was predicted, 0 when the prediction was right,
          // and the signed difference otherwise. See part 311 — the three are
          // different facts and the column is worthless if they collapse.
          fee_variance_cents: variance,
        }, { onConflict: 'stripe_session_id' });
        if (error) return fail('client_purchases', error.message);
      }
    } else if (event.type.startsWith('invoice.')) {
      const inv = event.data.object as Stripe.Invoice;
      const subMeta = (inv.subscription_details?.metadata || {}) as Record<string, string>;
      const subId = inv.subscription ? (typeof inv.subscription === 'string' ? inv.subscription : inv.subscription.id) : null;

      // Which of the two businesses is this invoice on?
      //
      // The metadata is the primary answer, as it is everywhere else in here.
      // But it is metadata: a subscription edited in the Stripe dashboard can
      // come back with it stripped, and this branch is the one where that
      // matters most — a client's renewal misread as a platform invoice is
      // filed as the COACH failing to pay Repple, and the money it represents
      // is never recorded at all.
      //
      // So a subscription id we have already mirrored is treated as proof.
      // `client_subscriptions` only ever holds Connect subscriptions (nothing
      // else is written there), so a hit is conclusive and a miss changes
      // nothing. It also recovers the client and the coach when the metadata is
      // gone, which is what lets the payment below still know whose it is.
      //
      // A failed READ is not a guess. Both branches from here write money or
      // something about money, and neither may run on a coin toss — so the
      // event is failed and Stripe retries it. Every write below is an upsert
      // on a unique key, so being tried again is free.
      let known: { client_id: string | null; trainer_id: string | null } | null = null;
      if (subId) {
        const { data: mirrored, error: mirrorErr } = await service.from('client_subscriptions')
          .select('client_id, trainer_id').eq('stripe_subscription_id', subId).maybeSingle();
        if (mirrorErr) return fail('client_subscriptions lookup', mirrorErr.message);
        known = mirrored ?? null;
      }

      if (isConnect(subMeta) || known) {
        // A renewal, or a renewal that failed, on a client's coaching
        // subscription. It is not a platform invoice and does not belong in
        // `invoices` — that table feeds the owner's failed-payments callout,
        // and a coach's client's card being declined is not the coach failing
        // to pay Repple.

        // ── the money ────────────────────────────────────────────────────
        //
        // This is the row that did not exist until part 132, and its absence is
        // the reason the payments screen could not answer the only question a
        // coach asks of it. A renewal used to be handled by re-reading the
        // subscription and writing its STATUS: after a year of a client paying
        // AED 600 a month this database held "active, AED 600 / month" and no
        // record that twelve payments had happened. A month of renewals could
        // not be added up from anything we held, and the screen had to say so.
        //
        // Written FIRST, before the status re-read below, because the re-read
        // is a network call to Stripe that can fail — and of the two, the money
        // is the one that cannot be reconstructed later from anything else we
        // hold. The status can: the next event carries it, and so does a
        // re-read on any later invoice.
        //
        // Keyed on the invoice id, so `invoice.paid` and
        // `invoice.payment_succeeded` — both of which Stripe sends for one
        // renewal — and every retry of either land on one row instead of
        // counting the month two or three times.
        //
        // `inv.status === 'paid'` as well as the event type: an event that says
        // paid about an invoice that does not is not a payment, and this table
        // holds only money that actually moved.
        if (INVOICE_PAID.has(event.type) && inv.id && inv.status === 'paid') {
          // Stripe's own timestamp for when it was paid, not now and not the
          // event's. A webhook retried three days later must not move somebody's
          // payment into a different month.
          const paidSec = inv.status_transitions?.paid_at ?? null;
          const { error: payErr } = await service.from('client_subscription_payments').upsert({
  // Metadata first, the mirrored subscription second, the connected
            // account last. The third is new and is what direct charges made
            // necessary: an event on a coach's account whose metadata has been
            // stripped and whose subscription we have somehow not mirrored
            // still names the coach, because it arrived from their account.
            client_id: subMeta.client_id || known?.client_id || null,
            trainer_id: subMeta.trainer_id || known?.trainer_id || (await trainerOfAccount(eventAccount)) || null,
            stripe_subscription_id: subId,
            stripe_invoice_id: inv.id,
            // GROSS, in minor units — what the client was charged, which is
            // what `amount_paid` is. Stripe's processing fee and the platform's
            // application fee are not in this event and are not deducted
            // anywhere: a "net" here would be a number this function invented
            // about somebody's income.
            amount_cents: inv.amount_paid ?? null,
            // The invoice's own currency. Never defaulted — Repple is
            // white-labelled and there is no fallback that is not wrong for
            // half the gyms running it.
            currency: inv.currency ?? null,
            // Stripe's word, raw: subscription_create for the first payment,
            // subscription_cycle for a renewal.
            billing_reason: inv.billing_reason ?? null,
            paid_at: paidSec ? new Date(paidSec * 1000).toISOString() : eventAt,
            // WHICH LEDGER this renewal was charged on (part 310), and it is
            // the only place the answer can be recorded. A refund of this
            // invoice has to be issued in the same account context the charge
            // was made in — Stripe answers "No such charge" otherwise — and
            // that cannot be recovered later from the coach's current
            // `charge_model`, because a coach who moves to direct charges
            // still has last month's renewals on the platform.
            //
            // `eventAccount` rather than the mirrored subscription: the event
            // IS the delivery, and an invoice can arrive before the
            // subscription has been mirrored at all. Null for a platform
            // event, which is exactly what `accountForObject` reads as "the
            // platform" — the same null `client_purchases` has carried since
            // part 161.
            stripe_account_id: eventAccount,
          }, { onConflict: 'stripe_invoice_id' });
          if (payErr) return fail('client_subscription_payments', payErr.message);
        }

        // ── the status ───────────────────────────────────────────────────
        //
        // The invoice says what was billed; the SUBSCRIPTION says what the
        // client is now — trialing, active, past_due, unpaid. Re-read it rather
        // than infer it, and stamp it as current-as-of-now, because that is
        // what a live re-read is. Monthly, so the round-trip is cheap.
        //
        // IN THE SUBSCRIPTION'S OWN ACCOUNT CONTEXT. This is the single line
        // that direct charges break hardest. A subscription created on a
        // coach's connected account does not exist on the platform, so this
        // retrieve throws "No such subscription" — which the catch below turns
        // into a 500, which asks Stripe to retry, which throws again. The
        // renewal above IS recorded (it is written first, deliberately), but
        // the subscription's status never updates again: a client who cancels
        // stays "active" on screen forever, and a failed card never shows as
        // past_due to either party.
        //
        // The context comes from the event itself, which is the account the
        // invoice was delivered from — not from the mirrored row, because an
        // invoice can arrive before the subscription has been mirrored.
        if (INVOICE_ACTIONABLE.has(event.type) && subId) {
          const fresh = await stripe.subscriptions.retrieve(subId, eventAccount ? { stripeAccount: eventAccount } : undefined);
          const why = await writeConnectSub(fresh, new Date().toISOString());
          if (why) return fail('client_subscriptions', why);
        }
      } else {
        // The PLATFORM's invoice — a coach paying Repple. Unreachable from a
        // connected account: `isConnect` is true for every event carrying an
        // `account`, so this branch only runs on platform events.
        //
        // That guard is doing real work. A client's renewal on a coach's
        // account whose metadata had been stripped would otherwise land here,
        // in the table that feeds the owner's failed-payments callout — filing
        // a client's declined card as the COACH failing to pay Repple, and
        // recording none of the money.
        const trainerId = await trainerOf(inv.customer as string, (inv.subscription_details?.metadata as any)?.trainer_id);
        const { error } = await service.from('invoices').upsert({
          id: inv.id,
          trainer_id: trainerId,
          amount_due: inv.amount_due,
          currency: inv.currency,
          status: inv.status,
          attempt_count: inv.attempt_count,
          hosted_invoice_url: inv.hosted_invoice_url,
        });
        if (error) return fail('invoices', error.message);
      }
    }
  } catch (e) {
    return json({ error: 'handler error: ' + (e as Error).message }, 500);
  }

  // Remembered only now the handler has succeeded. Marked before, a handler
  // that then failed would have burned the event: Stripe's retry — the one
  // chance to record money that has already moved — would arrive and be
  // discarded as a duplicate. A ledger write that fails is logged and not
  // fatal; the branches above are idempotent, which is what the ledger is
  // insuring rather than replacing.
  const { error: ledgerErr } = await service.from('stripe_webhook_events').upsert({ id: event.id, type: event.type });
  if (ledgerErr) console.error('stripe-webhook: could not record event ' + event.id + ':', ledgerErr.message);

  return json({ received: true });
});

// ── DEPLOYMENT: what this file cannot do for itself ────────────────────────
//
// Direct charges move a coach's events onto their connected account. Nothing in
// this function can subscribe to those. It is a Stripe dashboard setting, and
// until it is made, the code above is correct and never runs.
//
// In Stripe ▸ Developers ▸ Webhooks / Event destinations, the CONNECT
// destination — the one whose signing secret is STRIPE_WEBHOOK_SECRET_CONNECT —
// must have "Listen to events on Connected accounts" enabled, and must be
// subscribed to every event type this file handles, not only `account.updated`:
//
//     account.updated
//     checkout.session.completed
//     customer.subscription.created / .updated / .deleted
//     invoice.paid
//     invoice.payment_succeeded
//     invoice.payment_failed
//     invoice.payment_action_required
//     invoice.marked_uncollectible
//     payout.paid
//     payout.failed
//
// A GYM's own account (part 280) is a connected account like any other and its
// events arrive on the same connected destination. Nothing extra has to be
// subscribed to for gym sales — `checkout.session.completed` and
// `account.updated` are already on the list above — but the consequence of the
// destination being wrong is now wider than one coach: a member pays for a
// membership, the gym is paid, and the app never grants it. `gym_orders` would
// sit at 'pending' forever, which is at least a row somebody can find, and the
// member would be told their purchase was never confirmed.
//
// The PLATFORM destination keeps the same subscription list it has today: the
// owner's own billing still runs there, and coaches still on destination
// charges still produce their events there. Both destinations point at this one
// function, and the signature loop at the top tries both secrets.
//
// If the connected destination is not extended, the failure is silent and it is
// the worst one in this system: a client pays, the coach is paid, Stripe
// records it, and this database never hears about it. No error is raised
// anywhere, because nothing was ever delivered to fail. The client's purchase,
// their session credits and their subscription simply do not exist in the app.
//
// Verify with the Stripe CLI before trusting it, against a real connected
// account rather than the platform:
//
//     stripe listen --forward-connect-to <function-url>
//     stripe trigger checkout.session.completed --stripe-account acct_...

