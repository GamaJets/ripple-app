-- ═══════════════════════════════════════════════════════════════════════════
-- A refund, and a subscription that can stop today.
--
-- Both were refused on purpose and the refusal was written down in four places.
-- The argument was that "a half-working refund button is worse than no refund
-- button", and it was right about half-working: Stripe refunds are a separate
-- API with consequences nothing in this repo modelled — partial amounts,
-- reversing the platform's application fee, pulling money back out of a
-- connected account that may already have paid out.
--
-- What the refusal cost was the coach's worst customer moment. Somebody asks
-- for their money back and the app that took the money tells the coach to find
-- a laptop and log into a dashboard belonging to a company their client has
-- never heard of.
--
-- ── What this part adds, and what it deliberately does not ───────────────
--
-- Four columns and nothing else. NO function, NO policy change, and no way for
-- an app to write any of them: the refund itself is made by
-- supabase/functions/connect-refund, which runs as the service role, calls
-- Stripe first, and writes these columns ONLY from Stripe's own answer.
--
-- That ordering is the whole design. A refund the app believes in and Stripe
-- never made is the worst kind of wrong, because both the coach and the client
-- are looking at it — the coach's takings drop, the client's card is not
-- credited, and neither of them can tell which side is lying. The columns are
-- therefore a MIRROR of Stripe, in the same sense `client_subscriptions.status`
-- is, and the write policies below stay exactly as they were so nothing on a
-- phone can move them.
--
-- ── Why a column and not a refunds table ─────────────────────────────────
--
-- A running total rather than a log, and this is a real trade rather than a
-- shortcut. What every screen in this app asks is "how much of this sale still
-- stands", which is one subtraction from one row; what a log would additionally
-- answer is "when, and in how many goes", which nothing asks and which Stripe
-- already holds in full. Duplicating Stripe's refund objects into a table this
-- app would then have to keep in step is the reconciliation problem
-- `STRIPE_AUTHORITY_NOTE` spends a paragraph refusing to take on.
--
-- The consequence is stated rather than hidden: `refunded_at` is the LAST
-- refund, not the only one, and the column comment says so.
--
-- ── The constraint that matters ──────────────────────────────────────────
--
-- `refunded_cents <= amount_cents`. Stripe refuses to refund more than was
-- charged, so this should be unreachable — and it is here because "should be
-- unreachable" is how a takings figure goes negative and a coach reads that
-- they earned minus four hundred pounds this month. `sumTaken` has no notion of
-- a negative pot and no screen in this app renders one.
-- ─────────────────────────────────────────────────────────────────────────

-- ── One-off sales ────────────────────────────────────────────────────────

alter table public.client_purchases
  add column if not exists refunded_cents bigint not null default 0,
  add column if not exists refunded_at timestamptz;

alter table public.client_purchases drop constraint if exists client_purchases_refund_within_charge;
alter table public.client_purchases add constraint client_purchases_refund_within_charge
  check (
    refunded_cents >= 0
    and (amount_cents is null or refunded_cents <= amount_cents)
    -- Nought refunded and a refund time are contradictory facts about the same
    -- row. Either the money went back or it did not.
    and (refunded_cents = 0) = (refunded_at is null)
  );

comment on column public.client_purchases.refunded_cents is
  'Minor units given back, as a RUNNING TOTAL across every refund on this sale. Written only by supabase/functions/connect-refund, from Stripe''s own answer, never optimistically. Zero means none, never unknown.';
comment on column public.client_purchases.refunded_at is
  'When the LAST refund on this sale was made — not the only one. Stripe holds the full list of refund objects; this app deliberately does not duplicate them.';

-- ── Subscription renewals ────────────────────────────────────────────────
--
-- The same pair, because a renewal is a charge like any other and a coach
-- refunding "last month" is refunding one of these rather than the sale that
-- started the subscription. Ending a subscription does NOT refund anything and
-- the two acts are kept separate everywhere — see `END_NOW_TAKES_THE_REST` in
-- src/lib/refunds.ts, which is printed in front of the coach before they end
-- one.

alter table public.client_subscription_payments
  add column if not exists refunded_cents bigint not null default 0,
  add column if not exists refunded_at timestamptz;

alter table public.client_subscription_payments drop constraint if exists csp_refund_within_charge;
alter table public.client_subscription_payments add constraint csp_refund_within_charge
  check (
    refunded_cents >= 0
    and (amount_cents is null or refunded_cents <= amount_cents)
    and (refunded_cents = 0) = (refunded_at is null)
  );

comment on column public.client_subscription_payments.refunded_cents is
  'Minor units given back on this renewal, as a running total. Written only by supabase/functions/connect-refund from Stripe''s own answer.';
comment on column public.client_subscription_payments.refunded_at is
  'When the last refund on this renewal was made. Stripe holds the full list.';

-- No index. Both columns are read as part of the row they are on, never
-- filtered or ordered by — a refunded sale is still listed beside every other
-- sale, marked, because a row that disappeared when it was refunded is a coach
-- looking for money they gave back and finding nothing at all.
