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
// And three writes that take money AWAY, added because under direct charges all
// of them happen somewhere this app was never looking:
//
//   refunded_cents                  from `charge.refunded`. A coach on a
//                                   standard account has a full Stripe
//                                   dashboard with a working Refund button, and
//                                   until this branch existed a refund made
//                                   there reached nothing here — the sale went
//                                   on showing the money as taken, forever.
//   gym_payments (negative)         also from `charge.refunded`, for a GYM's
//                                   online sale, which is in neither table
//                                   `saleForCharge` looks in. Same defect, same
//                                   dashboard, and it survived the fix above
//                                   because the lookup only knew about the two
//                                   client tables. A gym sale leaves money
//                                   through a REVERSING ROW rather than a
//                                   column — supabase/parts/180 argues why at
//                                   length — keyed on the Stripe refund id by
//                                   part 800 so a retry cannot record it twice.
//   client_disputes                 from `charge.dispute.*`. The screen tells a
//                                   coach a chargeback is theirs to answer
//                                   while giving them no way to know one
//                                   exists, and the evidence deadline is a
//                                   fixed date that passes whether or not
//                                   anybody was told. See part 611.
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
// The ledger row an online gym sale leaves behind, and the two refusals it can
// answer with. Also a leaf, for the same reason. Asserted in
// src/lib/gymOrderPayment.test.ts.
// And the same module's other half: money going back OUT of a gym's ledger,
// when the gym refunded an online sale from its own Stripe dashboard. Both
// directions live in one leaf because they are one ledger and one argument.
import {
  gymOrderPaymentRow, isClosedMonthRefusal,
  gymRefundRow, refundsToMirror, refundStateForOrder, refusalNote, overReversedBy,
  type RefundFacts, type ReversibleSale,
} from '../../../src/lib/gymOrderPayment.ts';
// The day a session pack's validity window closes, worked out by the same
// arithmetic the app reads it back with. A leaf, for the same reason. Asserted
// in src/lib/packExpiry.test.ts.
import { expiresOn } from '../../../src/lib/packExpiry.ts';
// What a chargeback is, as a row and as a decision. Shared with
// app/(trainer)/payments.tsx so the screen and the server cannot disagree about
// which cases are live. Also a leaf. Asserted in src/lib/disputes.test.ts.
import { disputeRow, type StripeDisputeLike } from '../../../src/lib/disputes.ts';

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
   * The Stripe options that put a call in the right account's context.
   *
   * `undefined` for the platform. Written once because every lookup a
   * `charge.*` event needs is about an object on whichever account the event
   * arrived from, and a Stripe call made on the platform about a connected
   * account's Checkout Session answers "No such session" — which becomes a 500
   * and a retry loop on an event that will never succeed.
   */
  const acctOpts = eventAccount ? { stripeAccount: eventAccount } : undefined;

  /** Which of the two money tables a charge belongs to, and the row in it. */
  type SaleRef = {
    table: 'client_purchases' | 'client_subscription_payments';
    id: string;
    trainerId: string | null;
    clientId: string | null;
  };

  /**
   * The sale a Stripe charge paid for, or null when this database has no record
   * of one.
   *
   * ── Why null is a real answer and not a failure ─────────────────────────
   *
   * A client can charge back a payment whose `checkout.session.completed` was
   * never delivered — which is exactly the hole the header of this file spends
   * four paragraphs on. A dispute against a payment nothing here recorded is
   * still a dispute and still has a deadline on it, so the callers below write
   * what they have rather than dropping the event.
   *
   * ── The three ways back, in the order they are cheap ────────────────────
   *
   *   1. THE INVOICE. `charge.invoice` on a subscription charge is the
   *      `stripe_invoice_id` that part 132 made `not null unique` on the
   *      renewal ledger. One indexed read, no Stripe call.
   *   2. THE PAYMENT INTENT, on `client_purchases.stripe_payment_intent`.
   *      Stamped at checkout since part 610.
   *   3. THE PAYMENT INTENT, through Stripe. Every sale made BEFORE part 610
   *      has no intent recorded and never will — the column can only be filled
   *      at the moment of checkout and those moments are gone — so the session
   *      is asked for. This is the slow path and it is the one that keeps the
   *      feature true for the whole back catalogue.
   *
   * A DATABASE read that fails is returned as `dbError` rather than as "not
   * found", and the callers answer Stripe with a 500 for it. The two are
   * completely different: one is a sale this app never had, the other is a sale
   * it could not look at this second, and treating the second as the first
   * would silently skip mirroring a refund that has already happened.
   */
  const saleForCharge = async (
    invoiceId: string | null,
    paymentIntent: string | null,
  ): Promise<{ sale: SaleRef | null; dbError: string | null }> => {
    if (invoiceId) {
      const { data, error } = await service.from('client_subscription_payments')
        .select('id, trainer_id, client_id').eq('stripe_invoice_id', invoiceId).maybeSingle();
      if (error) return { sale: null, dbError: error.message };
      if (data?.id) {
        return { sale: { table: 'client_subscription_payments', id: data.id, trainerId: data.trainer_id ?? null, clientId: data.client_id ?? null }, dbError: null };
      }
    }
    if (!paymentIntent) return { sale: null, dbError: null };

    const { data: byPi, error: piErr } = await service.from('client_purchases')
      .select('id, trainer_id, client_id').eq('stripe_payment_intent', paymentIntent).maybeSingle();
    if (piErr) return { sale: null, dbError: piErr.message };
    if (byPi?.id) {
      return { sale: { table: 'client_purchases', id: byPi.id, trainerId: byPi.trainer_id ?? null, clientId: byPi.client_id ?? null }, dbError: null };
    }

    // The back catalogue. Thrown rather than returned by the Stripe client, so
    // it is caught here: a listing that fails is "we could not find it", not a
    // reason to answer Stripe with a 500 on an event about money that has
    // already moved.
    let sessionIds: string[] = [];
    try {
      const list = await stripe.checkout.sessions.list({ payment_intent: paymentIntent, limit: 5 }, acctOpts);
      sessionIds = (list.data ?? []).map((x) => x.id).filter(Boolean);
    } catch (e) {
      console.warn('stripe-webhook: could not list sessions for ' + paymentIntent + ':', (e as Error).message);
    }
    if (!sessionIds.length) return { sale: null, dbError: null };

    const { data: bySess, error: sessErr } = await service.from('client_purchases')
      .select('id, trainer_id, client_id').in('stripe_session_id', sessionIds).limit(1);
    if (sessErr) return { sale: null, dbError: sessErr.message };
    const row = (bySess ?? [])[0];
    if (!row?.id) return { sale: null, dbError: null };
    return { sale: { table: 'client_purchases', id: row.id, trainerId: row.trainer_id ?? null, clientId: row.client_id ?? null }, dbError: null };
  };

  /** A gym's own online sale, which is in neither of the two tables above. */
  type GymSaleRef = {
    orderId: string;
    tenantId: string;
    /** The ledger row to reverse, or null when the sale never reached the
     *  ledger at all — a closed month, or a sale that stated no currency. */
    payment: ReversibleSale | null;
  };

  /**
   * The GYM sale a Stripe charge paid for, or null when this database has no
   * record of one.
   *
   * ── Why this exists beside `saleForCharge` and not inside it ────────────
   *
   * `saleForCharge` answers "which of the two CLIENT money tables is this", and
   * both of its answers are handled identically by the caller: assign Stripe's
   * running total to `refunded_cents` on the row it found. A gym sale is not a
   * third row of that shape. supabase/parts/180 settled that money leaves
   * `gym_payments` as a NEGATIVE ROW naming what it undoes, never as an edit to
   * the original, so the write is an INSERT with completely different
   * arithmetic behind it — and folding a third variant into `SaleRef` would
   * have produced a union whose every consumer had to switch on it anyway.
   *
   * ── The same two answers, kept apart ────────────────────────────────────
   *
   * A DATABASE read that fails is returned as `dbError` and becomes a 500, so
   * Stripe retries. "No gym sale" is returned as null and becomes a 200. The
   * distinction is the one `saleForCharge`'s header spends a paragraph on and
   * it matters more on this path than on that one: treating "could not look" as
   * "no such sale" here would silently leave a refund unmirrored while the
   * ledger went on counting the money, and nothing would ever try again.
   *
   * ── Two ways back, and a third answer that is not a failure ─────────────
   *
   *   1. THE PAYMENT INTENT, on `gym_orders.stripe_payment_intent`. Stamped
   *      when the order was closed as paid. One indexed read, no Stripe call.
   *   2. THE CHECKOUT SESSION, through Stripe, for an order whose intent was
   *      never stamped — an order fulfilled before that write existed, or one
   *      that failed fulfilment and was closed without it. Same slow path
   *      `saleForCharge` uses, and a listing that throws is "we could not find
   *      it" rather than a reason to answer Stripe with a 500.
   *
   * A gym order found with NO `gym_payments` row against it is a real answer
   * and not an error: part 480's own closed-month case leaves exactly that.
   * There is nothing to reverse, and the caller records the refund on the order
   * so the reconciliation screen says so, rather than logging into the void.
   */
  const gymSaleForCharge = async (
    paymentIntent: string | null,
  ): Promise<{ gym: GymSaleRef | null; dbError: string | null }> => {
    if (!paymentIntent) return { gym: null, dbError: null };

    // `.limit(1)` and an array rather than `.maybeSingle()`, because
    // `gym_orders.stripe_payment_intent` carries no unique index — a member who
    // abandoned a checkout and came back can leave two orders naming one intent
    // — and `maybeSingle` answers a second row with an error, which would turn
    // a findable sale into a 500 that never stops.
    const { data: byPi, error: piErr } = await service.from('gym_orders')
      .select('id, tenant_id').eq('stripe_payment_intent', paymentIntent)
      .order('paid_at', { ascending: false }).limit(1);
    if (piErr) return { gym: null, dbError: piErr.message };
    let order = (byPi ?? [])[0] ?? null;

    if (!order) {
      let sessionIds: string[] = [];
      try {
        const list = await stripe.checkout.sessions.list({ payment_intent: paymentIntent, limit: 5 }, acctOpts);
        sessionIds = (list.data ?? []).map((x) => x.id).filter(Boolean);
      } catch (e) {
        console.warn('stripe-webhook: could not list sessions for gym refund on ' + paymentIntent + ':', (e as Error).message);
      }
      if (!sessionIds.length) return { gym: null, dbError: null };
      const { data: bySess, error: sessErr } = await service.from('gym_orders')
        .select('id, tenant_id').in('stripe_session_id', sessionIds).limit(1);
      if (sessErr) return { gym: null, dbError: sessErr.message };
      order = (bySess ?? [])[0] ?? null;
    }
    if (!order?.id) return { gym: null, dbError: null };

    // `maybeSingle` IS right here: part 480 put a partial UNIQUE index on
    // `gym_payments.gym_order_id`, so there is at most one, and a second row
    // would be the doubled takings that index exists to make impossible.
    const { data: pay, error: payErr } = await service.from('gym_payments')
      .select('id, tenant_id, member_id, membership_id, amount_cents, currency, method')
      .eq('gym_order_id', order.id).maybeSingle();
    if (payErr) return { gym: null, dbError: payErr.message };

    return {
      gym: {
        orderId: String(order.id),
        tenantId: String(order.tenant_id),
        payment: pay?.id
          ? {
              paymentId: String(pay.id),
              tenantId: String(pay.tenant_id),
              memberId: pay.member_id ?? null,
              membershipId: pay.membership_id ?? null,
              amountCents: Number(pay.amount_cents),
              currency: String(pay.currency ?? ''),
              method: String(pay.method ?? ''),
            }
          : null,
      },
      dbError: null,
    };
  };

  /**
   * Every refund on a charge, as this mirror needs them.
   *
   * `charge.refunds` rides along on the event and is the cheap answer, but it
   * is a paginated list: Stripe embeds the first ten and sets `has_more` when
   * there are others. A charge refunded in eleven instalments is not a shape
   * anybody plans for, and mirroring only the ten that happened to be embedded
   * would be a ledger that is quietly short — so `has_more`, and an event that
   * carries no list at all, both fall through to asking Stripe.
   *
   * A listing that throws returns what the event had rather than nothing, and
   * the caller does not fail for it. Nothing is lost by that: the running total
   * is written to `gym_orders.refunded_cents` regardless, so a refund this
   * could not enumerate is still VISIBLE as a gap between what Stripe sent back
   * and what the ledger took off. That property is what makes every partial
   * failure on this path safe to accept rather than retry.
   */
  const refundsOnCharge = async (charge: Stripe.Charge): Promise<RefundFacts[]> => {
    const asFacts = (list: readonly Stripe.Refund[]): RefundFacts[] => list.map((r) => ({
      id: r.id,
      amountCents: r.amount,
      currency: r.currency,
      createdSeconds: r.created,
      status: r.status ?? null,
    }));

    const embedded = (charge.refunds?.data ?? []) as Stripe.Refund[];
    if (embedded.length && !charge.refunds?.has_more) return asFacts(embedded);

    try {
      const list = await stripe.refunds.list({ charge: charge.id, limit: 100 }, acctOpts);
      const all = (list.data ?? []) as Stripe.Refund[];
      if (all.length) return asFacts(all);
    } catch (e) {
      console.warn('stripe-webhook: could not list refunds for charge ' + charge.id + ':', (e as Error).message);
    }
    return asFacts(embedded);
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

          // ── THE MONEY ───────────────────────────────────────────────────
          //
          // Written here, between the entitlement and the closing of the order,
          // and it used to be written nowhere at all. `gym_orders` records that
          // Stripe took the money; `gym_payments` is the LEDGER, and it is the
          // only table /money, /revenue, /accounting and /close count. Without
          // this insert a gym selling online reconciled its bank statement
          // against a figure short by every online sale it had ever made.
          //
          // WHAT KEYS IT. `gym_payments.gym_order_id`, added by part 480 with a
          // partial UNIQUE index, exactly as part 281 keyed the entitlement.
          // One order, at most one payment. A retried delivery finds the row
          // the first delivery wrote instead of recording the sale twice, and
          // if two ever race the index refuses the second rather than doubling
          // a month's takings. It cannot be keyed on the amount: two members on
          // the same plan pay the same money in the same minute.
          //
          // WHY IT IS ORDERED HERE. The order is marked 'paid' only after this
          // has landed, so 'paid' means the entitlement AND the money were
          // recorded. A transient failure answers Stripe with a 500, the order
          // stays 'pending', and the retry re-enters this branch, finds the
          // entitlement by its `gym_order_id` and writes only what is missing.
          //
          // NOTHING IS DOUBLE COUNTED. `gym_orders` is read by the member's own
          // purchase history and by nothing that adds money up. The pass figure
          // on /close comes from `gym_passes.paid_cents` and is reported beside
          // the takings rather than inside them, which is already true of every
          // pass sold at the desk.
          if (!problem) {
            const { data: paid, error: paidErr } = await service.from('gym_payments')
              .select('id').eq('gym_order_id', orderId).maybeSingle();
            if (paidErr) return fail('gym_payments lookup', paidErr.message);

            if (!paid?.id) {
              // Named `ledgerRow` and not `row`: `writeConnectSub` above holds a
              // `const row` of client_subscriptions columns, and
              // scripts/check-schema.mjs resolves `.insert(row)` by name — it
              // read those columns as gym_payments ones and failed the gate.
              const ledgerRow = gymOrderPaymentRow({
                orderId,
                order: {
                  tenantId: order.tenant_id,
                  memberId: order.member_id,
                  amountCents: order.amount_cents,
                  currency: order.currency,
                },
                session: {
                  amountTotal: sess.amount_total,
                  currency: sess.currency,
                  methodTypes: sess.payment_method_types ?? null,
                  sessionId: sess.id,
                  paymentIntent: pi,
                },
                // The hard link between money and what it was for, written at
                // the one moment anything knows both. /accounting's 45-day
                // amount-and-member guess exists because this column was always
                // empty; an online sale now arrives already attributed.
                membershipId: order.kind === 'membership' ? membershipId : null,
                takenAt: eventAt,
              });

              if (!ledgerRow) {
                // Refused rather than guessed. The only way here is a sale that
                // states no currency or no amount anywhere, and there is no
                // honest fallback for either: a currency invented here is a
                // permanent wrong stamp on a row an accountant files.
                console.error('stripe-webhook: gym order ' + orderId + ' was paid and could not be written to the ledger — the session and the order both state no usable amount or currency. Session ' + sess.id + '. The entitlement stands; the money is recorded only in Stripe.');
              } else {
                const { error: payErr } = await service.from('gym_payments').insert(ledgerRow);
                if (payErr && String(payErr.code ?? '') === '23505') {
                  // Two deliveries raced and the index did its job. The payment
                  // is recorded once, which is the whole point of the key.
                  console.warn('stripe-webhook: gym order ' + orderId + ' already had a ledger row when this delivery tried to write one. The unique index refused the second.');
                } else if (payErr && isClosedMonthRefusal(payErr)) {
                  // The owner has signed off the month this sale falls in.
                  // Final, not transient: every retry is refused identically,
                  // so answering with a 500 would spend Stripe's retry budget
                  // and then abandon the delivery with nothing recorded.
                  //
                  // The entitlement stands and the order is still closed as
                  // paid. The gap is visible rather than silent: a paid order
                  // with no payment pointing at it is what the reconciliation
                  // screen lists, and reopening the month and recording it is a
                  // decision for a person.
                  console.error('stripe-webhook: gym order ' + orderId + ' was paid into a month this gym has closed, so the ledger refused it: ' + payErr.message + ' The membership or pass stands. Reopen the month on /close and record the payment against the order.');
                } else if (payErr) {
                  return fail('gym_payments', payErr.message);
                }
              }
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

        // The PaymentIntent this sale was charged on. It is what `charge.*`
        // events carry and what `client_purchases.stripe_payment_intent` (part
        // 610) is for: without it, a refund or a dispute arriving months later
        // can only find this sale by asking Stripe to list every Checkout
        // Session against the intent, which is a round trip on the hot path of
        // a money event and fails outright for a session Stripe has aged out.
        const pi = typeof sess.payment_intent === 'string'
          ? sess.payment_intent
          : (sess.payment_intent?.id ?? null);

        // ── how long the credits last ────────────────────────────────────
        //
        // Read from the package NOW and written on to the sale, because the
        // window belongs to the sale and not to the package (part 612). A pack
        // is the only thing that can carry one — `validity_days` on a
        // membership is refused by a check constraint — so this asks only when
        // the checkout granted sessions.
        //
        // A read that fails leaves the pack with no window. That is the right
        // direction for the one error available here: a pack that should have
        // expired and does not is a conversation, and a pack that expires
        // because a lookup failed is somebody's paid-for sessions taken away by
        // a network blip. Logged rather than swallowed, because it means a
        // coach's stated validity silently did not apply to that sale.
        let packExpiresOn: string | null = null;
        if (!isNaN(sessions as number) && sessions != null) {
          const { data: pkg, error: pkgErr } = await service.from('trainer_packages')
            .select('validity_days').eq('id', meta.package_id).maybeSingle();
          if (pkgErr) {
            console.error('stripe-webhook: could not read validity_days for package ' + meta.package_id + ', so session ' + sess.id + ' was recorded with no expiry:', pkgErr.message);
          } else {
            packExpiresOn = expiresOn(eventAt, pkg?.validity_days ?? null);
          }
        }

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
          // The PaymentIntent, so a refund or a dispute arriving later can find
          // this sale without asking Stripe to list sessions (part 610). It is
          // the object those events carry; the Checkout Session is not.
          ...(pi ? { stripe_payment_intent: pi } : {}),
          sessions_total: isNaN(sessions as number) ? null : sessions,
          // The day the credits on this pack stop being usable, or null for a
          // pack that does not expire — which is every pack whose coach set no
          // validity, and every pack sold before part 612.
          //
          // Computed ONCE, here, and never again. That is the whole safety
          // property of the feature: if a screen recomputed it from
          // `trainer_packages.validity_days` at render time, a coach adding a
          // ninety-day window to a package they had been selling for two years
          // would void every unspent credit every one of those clients was
          // holding, at the instant they pressed Save. See src/lib/packExpiry.ts.
          ...(packExpiresOn ? { expires_on: packExpiresOn } : {}),
          status: 'paid',
          // NULL when nothing was predicted, 0 when the prediction was right,
          // and the signed difference otherwise. See part 311 — the three are
          // different facts and the column is worthless if they collapse.
          fee_variance_cents: variance,
        }, { onConflict: 'stripe_session_id' });
        if (error) return fail('client_purchases', error.message);
      }
    } else if (event.type === 'charge.refunded') {
      // ── MONEY GOING BACK, FROM WHEREVER IT WAS SENT BACK ────────────────
      //
      // supabase/functions/connect-refund makes a refund and mirrors it itself.
      // This branch is for every OTHER way one happens, and under direct
      // charges that is the ordinary way: the coach is the merchant of record,
      // their Stripe dashboard is the full one, and the Refund button in it
      // works with no involvement from this app at all. Before this, a refund
      // made there reached nothing here — the sale went on showing the money as
      // taken, the coach's takings figure overstated them permanently, and the
      // client showed as having paid for a pack they had been given the money
      // back for.
      //
      // `amount_refunded` is Stripe's RUNNING TOTAL across every refund on the
      // charge, which is exactly what part 192's column holds — so this is a
      // plain assignment and never an addition. That also makes it idempotent
      // and makes it correct in the one case connect-refund's arithmetic is
      // not: two refunds racing, where each side adds its own amount to a total
      // it read a moment earlier.
      const charge = event.data.object as Stripe.Charge;
      const refunded = typeof charge.amount_refunded === 'number' ? charge.amount_refunded : 0;
      const chargePi = typeof charge.payment_intent === 'string' ? charge.payment_intent : (charge.payment_intent?.id ?? null);
      const chargeInv = typeof charge.invoice === 'string' ? charge.invoice : (charge.invoice?.id ?? null);

      if (refunded > 0) {
        const { sale, dbError } = await saleForCharge(chargeInv, chargePi);
        if (dbError) return fail('refund lookup', dbError);
        if (!sale) {
          // ── A GYM'S OWN ONLINE SALE, WHICH IS IN NEITHER OF THOSE TABLES ──
          //
          // This branch used to end here, at the log line below, and for a gym
          // that was the whole story: `saleForCharge` looks in
          // `client_subscription_payments` and `client_purchases`, and a
          // membership or pass bought through supabase/functions/gym-checkout
          // is in `gym_orders` and `gym_payments`. So an owner refunding a
          // membership from their own Stripe dashboard — the ordinary way,
          // because under direct charges the gym is the merchant of record and
          // has the full dashboard — produced one log line and a `gym_payments`
          // row still holding the entire original amount. The gym's ledger, its
          // month-end close and its revenue screen all went on counting money
          // that had gone back, and nothing on any screen looked wrong.
          //
          // Asked only when the client-side lookup found nothing, which costs a
          // gym refund one extra read and costs a coach's refund nothing at
          // all. The two are disjoint by construction: a gym checkout is
          // stamped `repple_kind: 'gym_order'` and never writes either client
          // table.
          const { gym, dbError: gymErr } = await gymSaleForCharge(chargePi);
          // A read that failed is a 500 and a retry, exactly as above. "We
          // could not look" is not "there is nothing there", and collapsing
          // them would leave a gym's takings permanently overstated with no
          // second attempt.
          if (gymErr) return fail('gym refund lookup', gymErr);

          if (!gym) {
            // Money has gone back on a charge this database has no sale for.
            // Retrying cannot conjure the row, so the event is accepted and the
            // fact is logged as loudly as a log can be — Stripe is the surviving
            // record and somebody has to reconcile it by hand.
            console.error('stripe-webhook: REFUND WITH NO SALE TO MIRROR IT ON. Charge ' + charge.id + ', intent ' + (chargePi ?? 'none') + ', invoice ' + (chargeInv ?? 'none') + ', account ' + (eventAccount ?? 'platform') + '. The coach\'s or gym\'s takings figure still counts this money.');
          } else {
            // ── WHAT STRIPE DID, WRITTEN BEFORE ANYTHING IS ATTEMPTED ──────
            //
            // First, unconditionally, and on `gym_orders` rather than on the
            // ledger. Part 182's closed-month trigger guards `gym_payments` and
            // `gym_invoices` and deliberately not this table, so this write
            // always lands — which means the record of what Stripe did survives
            // even when the ledger refuses the consequence of it. Written after
            // the loop instead, it would be missing in exactly the case this
            // work exists for.
            //
            // `refunded_cents` is Stripe's RUNNING TOTAL, assigned and never
            // added, so a redelivery cannot inflate it. It is not a ledger
            // figure and no money screen sums it. Its only job is to be one
            // half of a comparison — against the sum of reversals actually
            // recorded — that makes an unmirrored refund visible on
            // /accounting, and that CLEARS ITSELF once somebody records the
            // missing correction by hand.
            const refundState = refundStateForOrder({
              amountRefundedCents: refunded,
              currency: charge.currency,
              atISO: eventAt,
            });
            const { error: stateErr } = await service.from('gym_orders').update({
              refunded_cents: refundState.refundedCents,
              refunded_currency: refundState.refundedCurrency,
              refunded_at: refundState.refundedAt,
              updated_at: new Date().toISOString(),
            }).eq('id', gym.orderId);
            // A 500 here, and not a log: this is the write that makes every
            // later failure visible, so losing it silently would put the whole
            // path back to where it started.
            if (stateErr) return fail('gym_orders refund', stateErr.message);

            const refusals: string[] = [];

            if (!gym.payment) {
              // The sale itself never reached the ledger — part 480's own
              // closed-month case leaves precisely this. Part 180's CHECK
              // requires a reversal to name what it reverses, so there is
              // nothing legal to write, and a bare negative row would be the
              // unexplained figure that constraint exists to refuse.
              refusals.push('This sale never reached the payment record, so there was no row to reverse. Record the sale and the refund together.');
              console.error('stripe-webhook: gym order ' + gym.orderId + ' was refunded in Stripe and has no ledger row to reverse. Charge ' + charge.id + '. The sale is missing from this gym’s takings and so is the refund.');
            } else {
              const salePayment = gym.payment;
              // What is already recorded against this payment: the refund ids,
              // which is the cheap idempotency guard, and the amounts, which is
              // what says whether Stripe has now sent back more than this app
              // thinks was ever taken.
              const { data: doneRows, error: doneErr } = await service.from('gym_payments')
                .select('stripe_refund_id, amount_cents').eq('reverses_payment_id', salePayment.paymentId);
              if (doneErr) return fail('gym refund lookup', doneErr.message);

              const alreadyIds = (doneRows ?? [])
                .map((d: { stripe_refund_id: string | null }) => d.stripe_refund_id)
                .filter((x): x is string => !!x);
              let reversedSoFar = (doneRows ?? [])
                .reduce((a: number, d: { amount_cents: number | null }) => a + Math.abs(Number(d.amount_cents) || 0), 0);

              const onCharge = await refundsOnCharge(charge);
              for (const one of refundsToMirror(onCharge, alreadyIds)) {
                const built = gymRefundRow({ sale: salePayment, refund: one, fallbackAtISO: eventAt });
                if (!built.row) {
                  // Refused rather than guessed — a currency that disagrees
                  // with the payment it reverses, or an amount Stripe did not
                  // state. Recorded where an owner reads it, not just logged.
                  refusals.push(built.refusal ?? 'This refund could not be recorded.');
                  console.error('stripe-webhook: refund ' + one.id + ' on gym order ' + gym.orderId + ' was not mirrored: ' + (built.refusal ?? 'no reason given'));
                  continue;
                }
                const refundRow = built.row;

                // Stripe has sent back more than this app has recorded as
                // taken. Logged and still written: the money has already gone,
                // and declining to record it would leave the ledger overstating
                // the gym's takings by the whole refund — which is the defect
                // being fixed — to keep one row's arithmetic tidy. Same call
                // the client-side branch makes when part 192's CHECK fires.
                const over = overReversedBy(salePayment.amountCents, reversedSoFar, Math.abs(refundRow.amount_cents));
                if (over > 0) {
                  console.error('stripe-webhook: refund ' + one.id + ' takes gym order ' + gym.orderId + ' past what this ledger records as taken, by ' + over + ' minor units of ' + salePayment.currency + '. Charge ' + charge.id + '. It is recorded anyway, because the money has gone; the sale’s amount and Stripe disagree and that needs a person.');
                }

                const { error: revErr } = await service.from('gym_payments').insert(refundRow);
                if (revErr && String(revErr.code ?? '') === '23505') {
                  // Two deliveries raced and part 800's unique index did its
                  // job. Mirrored once, which is the whole point of keying on
                  // the refund id: a refund recorded twice halves this gym's
                  // takings a second time, and unlike a doubled SALE — money an
                  // owner notices not arriving — a doubled refund only makes
                  // the month look worse, which nobody goes looking for.
                  console.warn('stripe-webhook: refund ' + one.id + ' on gym order ' + gym.orderId + ' was already mirrored when this delivery tried. The unique index refused the second.');
                } else if (revErr && isClosedMonthRefusal(revErr)) {
                  // The owner has signed off the month this refund falls in.
                  // A refund is dated when it was MADE (part 180), so this is a
                  // refund made inside a month already closed.
                  //
                  // FINAL, not transient: every retry is refused identically
                  // until a person reopens the month, so a 500 would spend
                  // Stripe's retry budget on a write that cannot land and then
                  // the delivery would be abandoned. Same decision part 480
                  // takes on the sale side — but it must NOT be dropped the
                  // same way, because there the gap showed up as a paid order
                  // with no payment row, and here the payment row exists and
                  // reads as perfectly correct. It is simply too big. So the
                  // reason goes on the order, where /accounting draws it.
                  refusals.push('Stripe refunded this sale into a month this gym has closed, so the payment record refused the reversal. Reopen that month on Close, with a reason, and record the refund against the original payment.');
                  console.error('stripe-webhook: refund ' + one.id + ' on gym order ' + gym.orderId + ' falls in a month this gym has closed: ' + revErr.message + ' The ledger still counts the original in full.');
                } else if (revErr) {
                  // An ordinary write failure. Worth a 500, because Stripe
                  // retries one and the next attempt may well succeed — and the
                  // refund ids already written are skipped when it does.
                  return fail('gym_payments refund', revErr.message);
                } else {
                  reversedSoFar += Math.abs(refundRow.amount_cents);
                }
              }
            }

            // The reason, second and separately, because it is the outcome of
            // trying. `refusalNote` answers null when nothing was refused,
            // which is what clears a note left by an earlier delivery once a
            // later one gets through.
            const { error: noteErr } = await service.from('gym_orders').update({
              refund_note: refusalNote(refusals),
              updated_at: new Date().toISOString(),
            }).eq('id', gym.orderId);
            // Logged rather than fatal. The exception an owner sees is derived
            // from the two figures above, both of which are already written;
            // this note only says WHY. Answering with a 500 would risk
            // re-running the loop for a sentence.
            if (noteErr) console.error('stripe-webhook: could not record why a refund on gym order ' + gym.orderId + ' was not mirrored:', noteErr.message);
          }
        } else {
          const { error: refErr } = await service.from(sale.table).update({
            refunded_cents: refunded,
            // Stripe's own instant for the event, not now(): a delivery retried
            // three days late must not move a refund into a different month.
            refunded_at: eventAt,
          }).eq('id', sale.id);
          // 23514 is the CHECK in part 192 — `refunded_cents <= amount_cents`.
          // It should be unreachable, because Stripe refuses to refund more than
          // was charged; if it fires, this app's `amount_cents` disagrees with
          // the charge, and answering with a 500 would put Stripe into a retry
          // loop on an event that is refused identically every time. Logged and
          // accepted instead, which leaves the sale visibly wrong rather than
          // invisibly retried.
          if (refErr && String(refErr.code ?? '') === '23514') {
            console.error('stripe-webhook: refund of ' + refunded + ' on ' + sale.table + ' ' + sale.id + ' was refused by the amount check — this app has a smaller amount recorded than Stripe refunded. Charge ' + charge.id + '. Reconcile by hand.');
          } else if (refErr) {
            return fail(sale.table + ' refund', refErr.message);
          }
        }
      }
    } else if (event.type.startsWith('charge.dispute.')) {
      // ── A CHARGEBACK, WHICH HAS A DEADLINE ON IT ────────────────────────
      //
      // app/(trainer)/payments.tsx tells a coach on a standard account that a
      // dispute is theirs to answer, and until this branch existed that was the
      // whole of what this app did about one: it told them the job was theirs
      // while giving them no way to know a case existed. The money is taken
      // back the moment a dispute opens, Stripe stops accepting evidence on a
      // fixed date, and an empty response loses by default.
      //
      // See src/lib/disputes.ts for the shape and supabase/parts/611 for the
      // table and the notification. The row is built by `disputeRow` rather
      // than assembled here so the screen and the server cannot disagree about
      // which cases are live.
      const d = event.data.object as Stripe.Dispute;
      const dPi = typeof d.payment_intent === 'string' ? d.payment_intent : (d.payment_intent?.id ?? null);
      const dCharge = typeof d.charge === 'string' ? d.charge : (d.charge?.id ?? null);

      // Who this is about. The sale carries the coach and the client; a dispute
      // against a payment this app never recorded falls back to the account,
      // which under direct charges resolves to the coach who owns it. Both can
      // come back null, and the row is written anyway — a chargeback nobody can
      // be told about is still one somebody has to find.
      const { sale, dbError } = await saleForCharge(null, dPi);
      if (dbError) return fail('dispute lookup', dbError);
      const disputeTrainer = sale?.trainerId ?? (await trainerOfAccount(eventAccount)) ?? null;

      const mirror = disputeRow(
        {
          id: d.id,
          charge: dCharge,
          paymentIntent: dPi,
          amount: typeof d.amount === 'number' ? d.amount : null,
          currency: d.currency ?? null,
          reason: d.reason ?? null,
          status: d.status ?? null,
          evidenceDueBy: d.evidence_details?.due_by ?? null,
          created: d.created ?? null,
        } as StripeDisputeLike,
        {
          trainerId: disputeTrainer,
          clientId: sale?.clientId ?? null,
          purchaseId: sale?.table === 'client_purchases' ? sale.id : null,
          renewalId: sale?.table === 'client_subscription_payments' ? sale.id : null,
          stripeAccountId: eventAccount,
        },
        eventAt,
      );

      if (!mirror) {
        // The only way here is an event with no dispute id, which Stripe does
        // not send. Accepted rather than retried, and logged so that a Stripe
        // API change producing it is visible rather than silent.
        console.error('stripe-webhook: a ' + event.type + ' arrived with no dispute id. Nothing was recorded.');
      } else {
        // Insert-if-absent then guarded update, the same shape `writeConnectSub`
        // uses and for the same reason: webhooks are not ordered, and an
        // `updated` from 10:00:00 delivered after the `closed` from 10:00:01
        // would reopen a case the coach has already been told the result of —
        // and they would go and prepare evidence for it.
        //
        // The split also drives the notification. Part 611's triggers fire on
        // the INSERT and on the update that first sets `closed_at`, so the coach
        // is told once when a case opens and once when it is decided, and never
        // for the status changes in between.
        const { error: insErr } = await service.from('client_disputes')
          .upsert(mirror, { onConflict: 'stripe_dispute_id', ignoreDuplicates: true });
        if (insErr) return fail('client_disputes', insErr.message);

        // Two plain filters rather than one `.or(...)`: an ISO timestamp inside
        // PostgREST's or() grammar is a value full of the punctuation that
        // grammar parses on, and a filter that silently fails to apply here is a
        // filter that lets a stale event overwrite a live case.
        const { error: updErr } = await service.from('client_disputes').update(mirror)
          .eq('stripe_dispute_id', mirror.stripe_dispute_id).lte('stripe_event_at', eventAt);
        if (updErr) return fail('client_disputes', updErr.message);
        const { error: nullErr } = await service.from('client_disputes').update(mirror)
          .eq('stripe_dispute_id', mirror.stripe_dispute_id).is('stripe_event_at', null);
        if (nullErr) return fail('client_disputes', nullErr.message);
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
//     charge.refunded
//     charge.dispute.created
//     charge.dispute.updated
//     charge.dispute.closed
//
// The last four are new and the last three are the ones with a clock on them.
// `charge.refunded` is how a refund the coach made in their own dashboard
// reaches this app at all — under direct charges that is the ordinary way to
// make one, and without the subscription the sale goes on showing the money as
// taken forever. The three `charge.dispute.*` events are how a coach learns a
// chargeback exists: Stripe stops accepting evidence on a fixed date, an empty
// response loses by default, and the date passes whether or not anybody was
// told. A destination not subscribed to those is a coach losing disputes they
// never heard about.
//
// All four also belong on the PLATFORM destination, because destination-charge
// coaches — every account onboarded before part 161 — still produce their
// refunds and their disputes there.
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

