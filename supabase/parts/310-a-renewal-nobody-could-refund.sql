-- ═══════════════════════════════════════════════════════════════════════════
-- The renewal a coach could not give back.
--
-- Part 192 added `refunded_cents` / `refunded_at` to BOTH
-- `client_purchases` and `client_subscription_payments`, and
-- supabase/functions/connect-refund was written with a `kind: 'renewal'`
-- branch from the first day. `refundRenewal` exists in src/lib/connect.ts.
-- Every piece was there and no screen called any of it, so the shape of the
-- thing was never exercised — and one column of it does not exist.
--
-- ── The column ────────────────────────────────────────────────────────────
--
-- connect-refund selects `stripe_account_id` off the row it is about to refund,
-- for the reason its header spends four paragraphs on: every Stripe object
-- lives on exactly ONE account, and a refund issued in the wrong context is
-- answered with "No such charge" for a charge that plainly exists. Part 161
-- added that column to `client_subscriptions` and to `client_purchases`. It
-- never added it here.
--
-- So the renewal branch selects a column that is not on the table. PostgREST
-- answers 42703, supabase-js resolves with an error, and connect-refund returns
-- "could not read that payment" for every renewal that has ever been paid. Not
-- for direct-charge renewals — for ALL of them, including the destination ones
-- the platform could have refunded all along. The branch has never worked and
-- nothing could have told anybody, because nothing called it.
--
-- ── Why not read it off the subscription instead ──────────────────────────
--
-- `client_subscriptions.stripe_account_id` names the same account, and joining
-- to it on `stripe_subscription_id` needs no migration at all. It is rejected
-- as the LIVE lookup for the reason part 132 refuses a foreign key between
-- these two tables in the first place: webhooks are not ordered, the money
-- event can arrive before the subscription is mirrored, and a payment whose
-- subscription row is missing would then be a payment nobody can refund. The
-- account is a fact about THIS charge and belongs on the row that records it.
--
-- The join is exactly right for the BACKFILL, though, and that is what it is
-- used for below — once, over rows already written.
--
-- ── What NULL means here, and it is not "unknown" ─────────────────────────
--
-- The platform. Identical to `client_purchases.stripe_account_id` and read by
-- the same `accountForObject` in src/lib/directCharges.ts, which answers null
-- for an empty or absent value and null means "make this call on the platform
-- account". That is correct for every destination-charge renewal, which is
-- every renewal this database held before part 161, and the backfill below only
-- ever writes a value where the subscription actually names one.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.client_subscription_payments
  add column if not exists stripe_account_id text;

comment on column public.client_subscription_payments.stripe_account_id is
  'The connected account this renewal was charged ON, or NULL for the platform (part 161''s destination model). Written by the stripe-webhook from the event''s own `account`, which is the account the invoice was delivered from. Read by supabase/functions/connect-refund to pick the Stripe context a refund is issued in — never the coach''s CURRENT charge_model, which would send every refund of an older renewal to an account the charge is not on.';

-- ── The backfill ─────────────────────────────────────────────────────────
--
-- One statement, over rows the webhook wrote before it knew to stamp this.
-- A renewal's invoice is always on the same account as the subscription it
-- renewed, so the subscription is an exact source where it exists — and where
-- it does not, or where it names no account, the row is left null, which is
-- the platform and is what a destination-charge renewal actually wants.
--
-- Idempotent: only ever fills a null, so re-running the bundle cannot move a
-- value the webhook has since written.
update public.client_subscription_payments p
   set stripe_account_id = s.stripe_account_id
  from public.client_subscriptions s
 where s.stripe_subscription_id = p.stripe_subscription_id
   and p.stripe_account_id is null
   and s.stripe_account_id is not null
   and btrim(s.stripe_account_id) <> '';

-- No index. It is read as part of the row a refund is already keyed to by
-- primary key, and never filtered or ordered by.
