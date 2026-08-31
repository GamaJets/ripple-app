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
//                 in `client_subscriptions`, keyed by the Stripe subscription id.
//
// Both are `customer.subscription.*` events on the platform account, and both
// carry a trainer_id in their metadata. Told apart by `repple_kind`, which
// connect-checkout stamps on the subscription itself. Getting that wrong in the
// obvious direction would file every client's AED 600 coaching fee as the
// coach's own Repple plan and count it as platform MRR.
import Stripe from 'npm:stripe@^16';
import { createClient } from 'jsr:@supabase/supabase-js@2';

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

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  // TWO secrets, because Stripe's event destinations are scoped and one endpoint
  // cannot receive both scopes. Everything about a subscription or a checkout
  // happens on the PLATFORM account — with destination charges the charge lives
  // there, not on the coach's account — while `account.updated`, which is how we
  // learn a coach has finished onboarding and can take money, only ever comes
  // from a CONNECTED account. Stripe requires a separate destination for each,
  // and issues each its own signing secret.
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

  /** Is this a client paying a coach, rather than a coach paying Repple? */
  const isConnect = (meta: Record<string, string> | null | undefined) =>
    !!meta && (meta.repple_kind === 'connect_subscription' || !!meta.package_id);

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

    // The amount is what Stripe bills, in minor units, taken from the price on
    // the subscription — not from trainer_packages, which the coach can edit
    // after the fact. Null when Stripe does not state one, and it stays null:
    // a subscription rendered as "AED 0.00" is a lie about somebody's money.
    const row: Record<string, unknown> = {
      ...identity,
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
      // Stripe Connect: a trainer's Express account status changed.
      const acct = event.data.object as Stripe.Account;
      const { error } = await service.from('connect_accounts').update({
        charges_enabled: !!acct.charges_enabled,
        details_submitted: !!acct.details_submitted,
        updated_at: new Date().toISOString(),
      }).eq('stripe_account_id', acct.id);
      if (error) return fail('connect_accounts', error.message);
    } else if (event.type === 'checkout.session.completed') {
      // A client bought a trainer's package (Connect checkout).
      const sess = event.data.object as Stripe.Checkout.Session;
      const meta = (sess.metadata || {}) as Record<string, string>;
      // A subscription checkout also completes, with an amount_total that is
      // only the FIRST month. Recording it as a purchase would put a one-off
      // sale in the client's history for a thing that recurs, and — worse —
      // grant session credits from `sessions` metadata that nothing renews.
      // `customer.subscription.created` is the record of a subscription.
      if (meta.package_id && sess.mode !== 'subscription') {
        const sessions = meta.sessions ? parseInt(meta.sessions, 10) : null;
        const { error } = await service.from('client_purchases').upsert({
          client_id: meta.client_id || null,
          trainer_id: meta.trainer_id || null,
          package_id: meta.package_id,
          stripe_session_id: sess.id,
          amount_cents: sess.amount_total,
          sessions_total: isNaN(sessions as number) ? null : sessions,
          status: 'paid',
        }, { onConflict: 'stripe_session_id' });
        if (error) return fail('client_purchases', error.message);
      }
    } else if (event.type.startsWith('invoice.')) {
      const inv = event.data.object as Stripe.Invoice;
      const subMeta = (inv.subscription_details?.metadata || {}) as Record<string, string>;
      if (isConnect(subMeta)) {
        // A renewal, or a renewal that failed, on a client's coaching
        // subscription. It is not a platform invoice and does not belong in
        // `invoices` — that table feeds the owner's failed-payments callout,
        // and a coach's client's card being declined is not the coach failing
        // to pay Repple.
        //
        // The invoice says what was billed; the SUBSCRIPTION says what the
        // client is now — trialing, active, past_due, unpaid. Re-read it rather
        // than infer it, and stamp it as current-as-of-now, because that is
        // what a live re-read is. Monthly, so the round-trip is cheap.
        if (INVOICE_ACTIONABLE.has(event.type) && inv.subscription) {
          const subId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription.id;
          const fresh = await stripe.subscriptions.retrieve(subId);
          const why = await writeConnectSub(fresh, new Date().toISOString());
          if (why) return fail('client_subscriptions', why);
        }
      } else {
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
