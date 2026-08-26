// stripe-webhook — receives Stripe events and mirrors subscription + invoice
// state into Supabase (for real MRR + dunning). Verifies the signature with
// STRIPE_WEBHOOK_SECRET. Configure the endpoint in the Stripe dashboard to send
// customer.subscription.* and invoice.* events. Writes via the service role.
import Stripe from 'npm:stripe@^16';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  const whSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!key || !whSecret) return json({ error: 'Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.' }, 400);
  const stripe = new Stripe(key, { apiVersion: '2024-06-20' });

  const sig = req.headers.get('stripe-signature') || '';
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, whSecret, undefined, Stripe.createSubtleCryptoProvider());
  } catch (e) {
    return json({ error: 'signature verification failed: ' + (e as Error).message }, 400);
  }

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const trainerOf = async (customerId: string | null, metaId?: string | null): Promise<string | null> => {
    if (metaId) return metaId;
    if (!customerId) return null;
    const { data } = await service.from('billing_customers').select('trainer_id').eq('stripe_customer_id', customerId).maybeSingle();
    return data?.trainer_id ?? null;
  };

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

  try {
    if (event.type.startsWith('customer.subscription.')) {
      const sub = event.data.object as Stripe.Subscription;
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
      if (meta.package_id) {
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
  } catch (e) {
    return json({ error: 'handler error: ' + (e as Error).message }, 500);
  }
  return json({ received: true });
});
