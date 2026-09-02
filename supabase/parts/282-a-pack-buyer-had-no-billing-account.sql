-- ═══════════════════════════════════════════════════════════════════════════
-- Somebody who only ever bought a session pack had no billing account at all.
--
-- app/(client)/packages.tsx renders the "Payment & Invoices" button INSIDE
-- `liveSubs.map(...)`. That is not a layout accident, it is the only place the
-- button could go: `openSubscriptionPortal` takes a subscription id, and
-- connect-checkout's `portal` action reads `client_subscriptions.stripe_
-- customer_id` to find the Stripe Customer whose portal to open. A client who
-- has only ever bought one-off packs has no `client_subscriptions` row, so
-- there was no id to pass and no customer to open — no invoice, no card
-- management, and no route to ask for money back other than messaging their
-- coach and hoping.
--
-- Moving the button out of the loop on its own would have produced a button
-- that does nothing, which is worse than the absence. The missing thing is
-- underneath: a one-off Checkout Session in `mode: 'payment'` creates no
-- Customer and no Invoice unless it is asked to, so there was nothing for a
-- portal to show even if we could have opened one.
--
-- ── The three halves of the fix ───────────────────────────────────────────
--
-- 1. connect-checkout's one-off branch now passes `customer_creation: 'always'`
--    and `invoice_creation: { enabled: true }`, so Stripe makes a Customer and
--    a real, downloadable Invoice for a pack the same way it already does for a
--    subscription.
-- 2. The webhook writes that customer id onto the purchase — this column.
-- 3. connect-checkout gains a `purchase_portal` action that opens the billing
--    portal for it, in the purchase's OWN account context (`stripe_account_id`,
--    part 161), because a Customer belongs to one account and a `cus_...` from
--    the platform is simply not found on a coach's connected account.
--
-- ── Nullable, not backfilled ──────────────────────────────────────────────
--
-- Null means no Customer was ever created for this sale, and that is true of
-- every row written before this part: those sessions were created without
-- `customer_creation`, so there is no Customer at Stripe to point at and none
-- can be manufactured now. The screen reads a null as "there is no billing
-- account for this one" and says so, rather than offering a button that opens
-- an error. The same absence, said out loud, instead of an absence with no
-- words for it.
--
-- Idempotent. Additive only.
-- ═══════════════════════════════════════════════════════════════════════════

alter table client_purchases add column if not exists stripe_customer_id text;

comment on column client_purchases.stripe_customer_id is
  'The Stripe Customer this one-off sale was charged to, on the account named by stripe_account_id. NULL on every sale made before the checkout asked Stripe to create one — there is no customer to open a billing portal for, and that is a sentence rather than a dead button.';

-- The portal action looks a purchase up by id and then checks the caller is its
-- buyer; the index that matters for that already exists (`client_purchases` is
-- keyed on `id`). Nothing else is needed: no policy changes, because
-- `purch_read` already lets the buyer read their own row, and every write to
-- this column is made by the service role from the webhook.
