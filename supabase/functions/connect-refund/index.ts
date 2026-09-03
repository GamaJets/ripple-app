// connect-refund — a coach gives a client their money back, from inside the app.
//
// Request: { kind: 'purchase' | 'renewal', id, amount_cents? }
//   `id` is the `client_purchases.id` or `client_subscription_payments.id`.
//   `amount_cents` omitted means the whole of what is left.
//
// ── Why this is its own function ──────────────────────────────────────────
//
// connect-checkout manages a SUBSCRIPTION and is keyed on
// `subscription_id`. A refund is about a CHARGE, and the two charges a coach
// can refund — a one-off sale and one paid renewal invoice — live in two
// different tables under two different keys, neither of which is a
// subscription id. Threading a third key through that function's dispatch
// would put a refund inside the branch that cancels subscriptions, which is
// exactly the confusion this feature must not create: ending a subscription
// and giving money back are separate acts and are separate everywhere.
//
// ── THE THREE WAYS A REFUND GOES WRONG ────────────────────────────────────
//
// 1. THE WRONG LEDGER. Every Stripe object exists on exactly one account. A
//    sale taken under DESTINATION charges is a charge on the PLATFORM; one
//    taken under DIRECT charges (part 161) is a charge on the COACH's
//    connected account, and the two id spaces are unrelated. Asking the coach's
//    CURRENT `charge_model` which context to use would send every refund of an
//    older sale to the wrong account, where Stripe answers "No such charge" —
//    so `optionsForObject` reads `stripe_account_id` off the SALE ROW, exactly
//    as the cancel branch of connect-checkout reads it off the subscription.
//
//    On a RENEWAL that column did not exist until part 310. Part 161 put it on
//    `client_purchases` and on `client_subscriptions` and not on
//    `client_subscription_payments`, so the select below asked PostgREST for a
//    column that was not there and every renewal refund failed on the read with
//    42703 — not just the direct-charge ones, all of them. Nothing caught it
//    because no screen called this branch at all until the Renewals Paid list
//    on app/(trainer)/payments.tsx.
//
// 2. A REFUND THE APP BELIEVES IN AND STRIPE DID NOT MAKE. Stripe is called
//    FIRST and the row is written only from its answer. A takings figure the
//    app reduced for a refund that never happened is the worst kind of wrong,
//    because the coach and the client are both looking at it and neither can
//    tell which side is lying.
//
// 3. A REFUND MADE TWICE. The row is re-read inside the same request and the
//    amount is checked against what is LEFT rather than against the original
//    price, so a double tap cannot give back twice. This is not a lock and does
//    not claim to be: two requests genuinely in flight at once could both pass
//    the check. Stripe is the backstop — it refuses to refund more than the
//    charge — and the CHECK constraint in part 192 is the second one.
//
//    THAT BACKSTOP DOES NOT CATCH THE ORDINARY CASE, which is why there is now
//    an idempotency key on the Stripe call. Stripe refuses a refund that takes
//    the total PAST the charge; it accepts two half refunds of the same sale
//    quite happily, because together they are exactly the charge. So a coach
//    double-tapping Refund on a 100 sale for 50 used to make TWO refunds of 50
//    — the client got the whole sale back, and both writes below computed
//    `already + 50` from the same `already` they had each read a moment
//    earlier, so this database recorded 50. The screen showed half of what had
//    actually gone.
//
//    The key is derived from the state the refund was decided against —
//    the table, the row, what was already refunded, and the amount asked for.
//    A second request that read the SAME state produces the SAME key and
//    Stripe replays its first answer instead of moving money again. A genuine
//    second refund cannot collide with it: `refunded_cents` has moved by then,
//    so `already` differs and the key differs with it. (Stripe holds a key for
//    24 hours, which is longer than any window this races in.)
//
//    It also repairs the retry-after-a-lost-mirror case, and in the right
//    direction: if the money went back and the row below did not record it, the
//    coach's second attempt is the same key, and Stripe returns the first
//    refund rather than making another.
//
// ── Whose money it is ─────────────────────────────────────────────────────
//
// The COACH's, on both models, and the note the app shows says which way it
// reaches them (`refundBalanceNote` in src/lib/refunds.ts). Under direct
// charges Stripe debits the coach's own balance. Under destination charges it
// debits Repple's and pulls the coach's share back through the transfer, which
// is what `reverse_transfer` is for — without it Repple refunds the client and
// the coach keeps the money, and the platform is out of pocket every time.
//
// `refund_application_fee` returns Repple's cut in proportion on both models.
// Not doing it would mean the platform keeping a fee on a sale that no longer
// exists, which is not a position this product wants to be in with a coach
// reading their own statement.
//
// ── Who may call it ───────────────────────────────────────────────────────
//
// The COACH on the sale, and nobody else — not the client, who cannot be
// allowed to refund themselves, and not the gym owner, who may read these rows
// and has never been given the act. This runs as the service role, which RLS
// does not apply to, so the ownership check RLS would have made is made here
// explicitly. A stranger gets the same 404 as an id that does not exist, so
// guessing ids reveals nothing.
import Stripe from 'npm:stripe@^16';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { optionsForObject } from '../../../src/lib/directCharges.ts';
import { refundBlocker, refundableRow, refundableCents, refundAmountBlocker, type Refundable } from '../../../src/lib/refunds.ts';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** Stripe's own refusal, in the response, rather than an uncaught throw. A
 *  rejected call would otherwise become a bare 500 with no body, which the app
 *  reports as a shrug — and the reasons here are specific and actionable: a
 *  balance too short to refund from, a charge already fully refunded, a charge
 *  too old for the payment method. The coach needs to read that. */
const stripeError = (what: string, e: unknown) => {
  const msg = (e as { message?: string })?.message || String(e);
  console.error('connect-refund: ' + what + ' refused by Stripe:', msg);
  return json({ error: msg }, 502);
};

interface SaleRow {
  id: string;
  trainer_id: string | null;
  amount_cents: number | string | null;
  currency: string | null;
  status?: string | null;
  refunded_cents: number | string | null;
  stripe_account_id: string | null;
  stripe_session_id?: string | null;
  stripe_invoice_id?: string | null;
}

// The bigint-as-string coercion that used to live here — PostgREST hands a
// bigint back as a STRING so a value above 2^53 can survive JSON, and left
// alone `"48000"` fails every arithmetic check and a real sale is refused as
// one with no amount on it — moved into `refundableRow` in
// src/lib/refunds.ts, where it is asserted and where the screen gets it too.

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

  const kind = String(body.kind || '');
  const id = String(body.id || '');
  if (kind !== 'purchase' && kind !== 'renewal') return json({ error: 'kind must be purchase or renewal' }, 400);
  if (!id) return json({ error: 'missing id' }, 400);

  const table = kind === 'purchase' ? 'client_purchases' : 'client_subscription_payments';
  const cols = kind === 'purchase'
    ? 'id, trainer_id, amount_cents, currency, status, refunded_cents, stripe_account_id, stripe_session_id'
    : 'id, trainer_id, amount_cents, currency, refunded_cents, stripe_account_id, stripe_invoice_id';

  const { data: row, error: readErr } = await service.from(table).select(cols).eq('id', id).maybeSingle();
  if (readErr) return json({ error: 'could not read that payment: ' + readErr.message }, 500);
  // A stranger and a missing id get the same answer, so that guessing ids tells
  // nobody which ones are real.
  if (!row) return json({ error: 'payment not found' }, 404);
  const sale = row as unknown as SaleRow;
  if (String(sale.trainer_id ?? '').trim() !== uid) {
    console.warn(`connect-refund: refused ${kind} ${id} for ${uid}`);
    return json({ error: 'payment not found' }, 404);
  }

  // ── what Stripe object this refund is made against ──────────────────────
  //
  // A one-off sale is a Checkout Session, and a Session is not a charge: the
  // PaymentIntent it created is. It is fetched rather than stored, because a
  // column holding it would be a second copy of a fact Stripe owns and would be
  // null on every row written before it existed. A renewal names its invoice,
  // and the invoice names its PaymentIntent the same way.
  //
  // Both lookups happen IN THE SALE'S OWN ACCOUNT CONTEXT. A direct-charge
  // session retrieved without it is simply not found.
  const acctOpts = optionsForObject(sale);
  let paymentIntent: string | null = null;
  try {
    if (kind === 'purchase') {
      const ref = String(sale.stripe_session_id ?? '').trim();
      if (ref) {
        const sess = await stripe.checkout.sessions.retrieve(ref, acctOpts);
        paymentIntent = typeof sess.payment_intent === 'string' ? sess.payment_intent : sess.payment_intent?.id ?? null;
      }
    } else {
      const ref = String(sale.stripe_invoice_id ?? '').trim();
      if (ref) {
        const inv = await stripe.invoices.retrieve(ref, acctOpts);
        paymentIntent = typeof inv.payment_intent === 'string' ? inv.payment_intent : inv.payment_intent?.id ?? null;
      }
    }
  } catch (e) { return stripeError('reading the original charge', e); }

  // The SAME rule the screen ran, run again here. The screen's copy is a
  // convenience so a coach is not sent to the server to be told no; this copy
  // is the rule. src/lib/refunds.ts is imported by both so they cannot drift.
  // `refundableRow` is the mapping, and it is shared with the screen rather
  // than written twice. It carries the two things this used to decide inline
  // and that a second copy gets wrong: the bigint-as-string coercion
  // `refunded_cents` needs, and the fact that a renewal row exists ONLY because
  // Stripe reported the invoice paid — so there is no status column on that
  // table to check and reaching for one would refuse every renewal refund.
  const refundable: Refundable = refundableRow(kind, sale, paymentIntent);
  const blocked = refundBlocker(refundable);
  if (blocked) return json({ error: blocked }, 409);

  // What this sale has already had back. Read here rather than after the Stripe
  // call because it is half of the idempotency key below as well as half of the
  // running total afterwards, and the two must be the same number: the key has
  // to describe the state the refund was DECIDED against.
  const already = refundable.refundedCents;
  const left = refundableCents(refundable);
  // Omitted means the whole of what is LEFT, never the whole of the original
  // price — a second refund on a partly refunded sale must not try to give back
  // the full amount again.
  const asked = body.amount_cents == null ? left : Math.trunc(Number(body.amount_cents));
  const amountProblem = refundAmountBlocker(asked, left);
  if (amountProblem) return json({ error: amountProblem }, 400);

  // ── Stripe first, always ────────────────────────────────────────────────
  let refund: Stripe.Refund | null = null;
  try {
    refund = await stripe.refunds.create({
      payment_intent: paymentIntent!,
      amount: asked,
      // Repple's cut comes back in proportion. Without it the platform keeps a
      // fee on a sale that no longer exists, which is not a position to be in
      // with a coach reading their own statement.
      refund_application_fee: true,
      // Only meaningful on a DESTINATION charge, where the money was sent on to
      // the coach and has to be pulled back; Stripe ignores it on a direct
      // charge, where the money never left the coach's account. Sending it
      // unconditionally is safe and is one branch fewer to get wrong — and
      // without it on a destination charge, Repple refunds the client and the
      // coach keeps the money.
      reverse_transfer: true,
    }, {
      ...acctOpts,
      // The state this refund was decided against, so that a request deciding
      // the same thing twice moves money once. See THE THREE WAYS A REFUND
      // GOES WRONG, point 3, at the top of this file. `already` is in the key
      // deliberately: it is what makes a genuine SECOND refund of the same
      // amount a different call rather than a replay of the first.
      idempotencyKey: `repple-refund:${table}:${id}:${already}:${asked}`,
    });
  } catch (e) { return stripeError('refund', e); }
  if (!refund || refund.status === 'failed' || refund.status === 'canceled') {
    return json({ error: 'Stripe did not make that refund, so nothing has been given back and nothing here has changed.' }, 502);
  }

  // ── then the mirror ─────────────────────────────────────────────────────
  //
  // Written from Stripe's own `refund.amount`, not from what was asked for.
  // They are the same today; a Stripe-side adjustment that made them differ
  // would otherwise leave this app's running total permanently out by it.
  // `already` is read further up, with the idempotency key that describes it.
  const total = already + (Number.isFinite(refund.amount) ? refund.amount : asked);
  const { error: wErr, count: wCount } = await service.from(table).update({
    refunded_cents: total,
    refunded_at: new Date().toISOString(),
  }, { count: 'exact' }).eq('id', id);

  // The money HAS gone back. Reporting a failure now would be false, and the
  // coach would refund it a second time — which is the one outcome worse than
  // the figure on the screen being stale. It is logged loudly instead, because
  // it means a coach's takings figure is overstating them by this amount until
  // somebody notices.
  if (wErr) console.error('connect-refund: REFUNDED AT STRIPE BUT NOT MIRRORED', { table, id, amount: refund.amount, err: wErr.message });
  else if (wCount === 0) console.error('connect-refund: REFUNDED AT STRIPE BUT NO ROW MATCHED', { table, id });

  return json({
    ok: true,
    refunded_cents: refund.amount,
    refunded_total_cents: total,
    currency: refund.currency,
    status: refund.status,
    // False when the refund landed and the row did not. The app says so rather
    // than showing a figure it knows is stale.
    mirrored: !wErr && wCount !== 0,
  });
});
