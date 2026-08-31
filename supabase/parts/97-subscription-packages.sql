-- Recurring packages — a coach sells "Online coaching, AED 600/month" and a
-- client subscribes to it. Sits on top of the Connect marketplace in 21-connect:
-- same trainer_packages row, same Checkout, same destination charge to the
-- trainer's Express account. What is new is that the charge repeats, so there
-- has to be somewhere that says whether it is STILL repeating.
--
-- Nothing here is written by an app. The subscription record is Stripe's answer
-- mirrored back by the stripe-webhook edge function under the service role;
-- client and coach read it and nothing else. A row a client could write is a
-- row a client could write "active" into. Idempotent.

-- ── the interval on a package ───────────────────────────────────────────────
-- null is one-off, and every trainer_packages row that exists today is one-off,
-- so the column is added null and every existing package keeps behaving exactly
-- as it does — which matters more here than anywhere else in the schema,
-- because the difference between the two is whether somebody is charged once or
-- charged every month forever.
alter table trainer_packages add column if not exists billing_interval text;

alter table trainer_packages drop constraint if exists trainer_packages_billing_interval_ck;
alter table trainer_packages add constraint trainer_packages_billing_interval_ck
  check (billing_interval is null or billing_interval in ('month', 'year'));

-- A recurring package cannot also be a session pack.
--
-- `sessions` is a BALANCE: connect-checkout stamps it into metadata, the
-- webhook writes it to client_purchases.sessions_total once, and redeemSession
-- draws it down. Nothing renews it. So "10 sessions, monthly" would sell a
-- client a repeating charge against a balance that is granted once and never
-- topped up — they would pay in month two for credits they already spent in
-- month one. Until there is a renewal rule written down somewhere, the two are
-- mutually exclusive and the database says so rather than the screen.
alter table trainer_packages drop constraint if exists trainer_packages_recurring_no_pack_ck;
alter table trainer_packages add constraint trainer_packages_recurring_no_pack_ck
  check (billing_interval is null or sessions is null);

-- ── the live subscription ───────────────────────────────────────────────────
-- One row per Stripe subscription, not one per (client, trainer): a client who
-- cancels in March and comes back in June has two, and collapsing them would
-- lose the fact that the first one ended. "Am I subscribed to this coach?" is
-- therefore a question about STATUS, and every reader asks it that way.
--
-- amount_cents/currency are copied from the Stripe price at the time the
-- subscription was created, not read through package_id. A coach who raises
-- their price next month has not raised it for people already subscribed, and
-- showing an existing subscriber the new number would be telling them they are
-- paying something they are not. Minor units (fils/cents), like everywhere
-- else. Nullable, and a null must render as a dash — never as zero.
create table if not exists client_subscriptions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references profiles(id) on delete set null,
  trainer_id uuid references profiles(id) on delete set null,
  package_id uuid references trainer_packages(id) on delete set null,
  stripe_subscription_id text not null unique,
  stripe_customer_id text,
  -- Stripe's own vocabulary, stored raw: incomplete, incomplete_expired,
  -- trialing, active, past_due, canceled, unpaid, paused. Not translated on the
  -- way in — a status this app invented would be a status Stripe cannot confirm.
  status text not null,
  amount_cents integer,
  currency text,
  billing_interval text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  -- When Stripe generated the event this row was last written from. Webhooks
  -- are not delivered in order, so a `customer.subscription.updated` from
  -- 10:00 can arrive after the `deleted` from 10:01 and would otherwise
  -- resurrect a cancelled subscription on screen. Every write is filtered on
  -- this being no newer than the event doing the writing.
  stripe_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_client_subs_client on client_subscriptions (client_id, created_at desc);
create index if not exists idx_client_subs_trainer on client_subscriptions (trainer_id, created_at desc);

-- ── webhook replay ──────────────────────────────────────────────────────────
-- Stripe retries, and a retry is not a second event. Every write the webhook
-- makes is already an upsert on a unique key so a replay overwrites rather than
-- duplicates, but that is a property of each branch that a future branch can
-- quietly fail to have. This is the belt to that pair of braces: the event id
-- is remembered after it is handled, and an id already here is skipped.
--
-- Recorded AFTER the handler succeeds, never before. Recording first and
-- failing second would mark an event done that never happened, and Stripe's
-- retry — the one chance to record money that moved — would be discarded as a
-- duplicate.
create table if not exists stripe_webhook_events (
  id text primary key,
  type text,
  handled_at timestamptz not null default now()
);

alter table client_subscriptions enable row level security;
alter table stripe_webhook_events enable row level security;

-- The client reads their own subscriptions, the coach reads their own clients',
-- the owner reads all — the same shape as client_purchases in 21-connect.
--
-- There is deliberately no insert, update or delete policy on either table. RLS
-- denies what no policy permits, so both are read-only to every signed-in user
-- and writable only by the service role the stripe-webhook runs as. The status
-- of a subscription is Stripe's to state, not the subscriber's.
-- The owner branch is scoped THROUGH THE TRAINER'S TENANT, matching
-- `purch_read` on client_purchases exactly. An earlier draft of this policy
-- read `exists (select 1 from profiles p where p.id = auth.uid() and p.role =
-- 'owner')`, which is not the same shape at all: it lets ANY owner read EVERY
-- subscription on the platform. That is survivable while one company runs one
-- set of gyms and is a cross-tenant leak the moment Repple is white-labelled —
-- one customer's owner reading another customer's revenue, client by client.
drop policy if exists client_subs_read on client_subscriptions;
create policy client_subs_read on client_subscriptions for select using (
  client_id = (select auth.uid())
  or trainer_id = (select auth.uid())
  or exists (
    select 1 from trainers tr
     where tr.id = client_subscriptions.trainer_id
       and is_owner_of(tr.tenant_id)));

-- No policy at all: the replay ledger is nobody's business but the webhook's.

-- And the grant, without which none of the above does anything. RLS narrows
-- what a GRANT permits; it does not confer access on its own, so a policy on a
-- table `authenticated` cannot select from is inert — and inert in the
-- direction that looks fine in review and returns nothing at runtime. SELECT
-- only: writes stay with the service role the webhook runs as, which is the
-- whole point of there being no insert or update policy.
grant select on public.client_subscriptions to authenticated;
