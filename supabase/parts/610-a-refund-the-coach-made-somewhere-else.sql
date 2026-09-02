-- ═══════════════════════════════════════════════════════════════════════════
-- A refund the coach made in their own Stripe dashboard.
--
-- Part 192 added `refunded_cents` / `refunded_at` to both money tables and
-- wrote, in the column comments, that they are "written only by
-- supabase/functions/connect-refund". That was true of the only writer that
-- existed and it was never the only way a refund happens.
--
-- Under DIRECT charges (part 161) the coach is the merchant of record. Their
-- Stripe dashboard is the full one, the charge is theirs, and the Refund button
-- in it works — with no involvement from this app at all. A coach who refunds a
-- client that way, which is the obvious way when they are already looking at
-- the payment, leaves this database holding a sale that still says the money
-- was taken. Their takings figure overstates them, permanently, and the client
-- shows as having paid for a pack they were given the money back for.
--
-- Stripe already tells us. `charge.refunded` fires on every refund of a charge
-- whatever made it — the dashboard, the API, connect-refund, or Stripe itself
-- reversing a disputed charge. It carries `amount_refunded`, which is the
-- RUNNING TOTAL across every refund on that charge, in the same minor units and
-- the same shape as the column part 192 created. The event was simply never
-- subscribed to and never handled.
--
-- ── What is in this part, and what is in the function ─────────────────────
--
-- The handler is in supabase/functions/stripe-webhook. What is HERE is the one
-- thing it cannot do for itself: a way to get from a Stripe charge back to the
-- row it paid for.
--
--   A RENEWAL already has one. `charge.invoice` is the invoice id and
--   `client_subscription_payments.stripe_invoice_id` is `not null unique`, so
--   the join exists and needs nothing added.
--
--   A ONE-OFF does not. `client_purchases` records `stripe_session_id` — the
--   Checkout Session — and a charge does not carry one. The webhook can walk
--   back through `checkout.sessions.list({ payment_intent })`, and it does for
--   every sale made before this part; but that is a Stripe round trip on the
--   hot path of a money event, and it fails for a session Stripe has aged out.
--   So the PaymentIntent is stamped on the row at checkout from now on, and the
--   list call becomes the fallback rather than the mechanism.
--
-- ── Why the column is nullable and stays nullable ─────────────────────────
--
-- Every sale made before this part has no PaymentIntent recorded and never
-- will: the column can only be filled at the moment of checkout, and those
-- moments are gone. A backfill would mean listing sessions for every historic
-- sale against every connected account, and getting one wrong writes a
-- payment reference onto the wrong person's purchase. NULL means "ask Stripe",
-- which is exactly what the fallback does.
--
-- ── What this part does NOT add ───────────────────────────────────────────
--
-- No refunds table. Part 192's argument stands unchanged: what every screen
-- asks is "how much of this sale still stands", which is one subtraction from
-- one row, and Stripe holds the full list of refund objects. Mirroring them
-- here would be the reconciliation problem that file spends a paragraph
-- refusing.
--
-- No write path for an app. Both columns stay unwritable from a phone, for
-- part 192's reason: a refund this app believes in and Stripe did not make is
-- the worst kind of wrong, because both parties are looking at it.
--
-- Idempotent; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The PaymentIntent on a one-off sale ───────────────────────────────────

alter table public.client_purchases add column if not exists stripe_payment_intent text;

comment on column public.client_purchases.stripe_payment_intent is
  'The Stripe PaymentIntent this sale was charged on, stamped at checkout. NULL on every sale made before part 610 — the webhook walks back through checkout.sessions.list({ payment_intent }) for those. Never backfilled: a mis-resolved reference would attach somebody else''s payment to this purchase.';

-- How `charge.refunded` and `charge.dispute.*` find the sale. Partial, because
-- a row with no PaymentIntent is one this lookup can never match and indexing
-- the nulls would be indexing exactly the rows the query does not want.
create index if not exists client_purchases_payment_intent_idx
  on public.client_purchases (stripe_payment_intent)
  where stripe_payment_intent is not null;

-- ── The two comments part 192 wrote, corrected ────────────────────────────
--
-- Restated here rather than edited in part 192, so the history of the column
-- reads in the order it happened: 192 created it with one writer, this part
-- added the second. Both comments said "written only by connect-refund", which
-- became false the moment the webhook learned to mirror a dashboard refund —
-- and a column comment that names the wrong writer is how the next person
-- concludes a figure cannot have moved and goes looking somewhere else.

comment on column public.client_purchases.refunded_cents is
  'Minor units given back, as a RUNNING TOTAL across every refund on this sale. Written by supabase/functions/connect-refund from Stripe''s answer to a refund it made, and by supabase/functions/stripe-webhook from charge.refunded — which is how a refund the coach made in their own Stripe dashboard reaches this app. Never written optimistically by anything. Zero means none, never unknown.';
comment on column public.client_purchases.refunded_at is
  'When the LAST refund on this sale was made — not the only one. Stripe holds the full list of refund objects; this app deliberately does not duplicate them.';

comment on column public.client_subscription_payments.refunded_cents is
  'Minor units given back on this renewal, as a running total. Written by supabase/functions/connect-refund and by supabase/functions/stripe-webhook''s charge.refunded branch, in both cases from Stripe''s own figure.';
comment on column public.client_subscription_payments.refunded_at is
  'When the last refund on this renewal was made. Stripe holds the full list.';
