-- ═══════════════════════════════════════════════════════════════════════════
-- A member can buy what the gym sells.
--
-- `membership_plans` (part 29) and `gym_pass_types` (part 31) have both been
-- readable by members since the day they were written — `membership_plans_
-- tenant_r` and `gym_pass_types_tenant_r` publish the price book to anyone in
-- the tenant. What has never existed is any way to ACT on it. A member could
-- read the price of the plan they are on and had no way to renew it, no way to
-- move to a different one, and no way to buy a day pass or a class pack.
--
-- This is the record of one attempt to buy. Not the entitlement — a paid order
-- CREATES a `memberships` row or a `gym_passes` row, and those tables stay the
-- record of what somebody holds. This table is the record of the money and of
-- which account it landed on.
--
-- ── Why the account id is NOT NULL here, and nullable on the coach tables ──
--
-- `client_purchases.stripe_account_id` and `client_subscriptions.stripe_account
-- _id` are nullable and null MEANS THE PLATFORM, because every row written
-- before part 161 was created on the platform under destination charges and the
-- absence is the correct value for them.
--
-- No gym sale has ever happened. There is no history for a null to describe, and
-- there is no destination-charge path for a gym (see part 280): a gym sells on
-- its own Standard account under direct charges or it does not sell. So a gym
-- order without an account id is not "a sale on the platform", it is a row
-- nobody could later refund, because a refund on a direct charge must be issued
-- in the connected account's context and there would be nothing here saying
-- which one. NOT NULL, written at the moment the Checkout Session is created,
-- from the account the session was actually created on — never re-derived later
-- from the gym's current settings, which is the rule `accountForObject` exists
-- to state.
--
-- ── The quote is stored, because the quote is what was agreed ─────────────
--
-- `amount_cents`, `currency`, `term_starts_on`, `term_ends_on` and `uses_total`
-- are all written when the session is created, from the plan or pass type as it
-- read THEN. A gym that reprices on Tuesday must not change what somebody was
-- charged on Monday, and a member who was shown "runs to 31 October" must get a
-- membership that runs to 31 October. Fulfilment copies these across rather
-- than recomputing them.
--
-- `currency` is NOT NULL with NO DEFAULT, which is part 150's rule for filed
-- money restated: an amount with no currency is not a record with a gap in it,
-- it is a figure nobody can act on.
--
-- ── The order is written BEFORE Stripe is called ──────────────────────────
--
-- `stripe_session_id` is nullable for exactly one window: between the insert
-- that records the intent and the update that records the session. The ordering
-- is deliberate and it is the safe one — an order with no session is a row
-- nobody was charged for and nothing ever fulfils, whereas a session with no
-- order would be money taken against a purchase this database has no record of.
-- If the Stripe call fails, a pending row with a null session id is left behind
-- and is visible to the member as a purchase that never started.
--
-- Idempotent. Additive only.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists gym_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  member_id uuid not null references profiles(id) on delete cascade,

  -- What is being bought. A membership term, or a pass (a drop-in or a class
  -- pack). Guest passes are not sold here — `gym_passes` needs a holder who is
  -- not the buyer and there is no screen that collects one.
  kind text not null check (kind in ('membership', 'pass')),

  -- Why. 'new' is a first membership or one bought after a gap; 'renew' extends
  -- the plan they are already on; 'upgrade' moves them to a different plan and
  -- supersedes the one they hold. Always 'new' for a pass, which supersedes
  -- nothing.
  intent text not null default 'new' check (intent in ('new', 'renew', 'upgrade')),

  -- Exactly one of these is set, and which one follows from `kind`. Both go
  -- null rather than taking the order with them if the gym deletes what it
  -- sold: the order is the record of money that moved, and it outlives the
  -- price-book row it was made from.
  plan_id uuid references membership_plans(id) on delete set null,
  pass_type_id uuid references gym_pass_types(id) on delete set null,

  -- The membership this renews or replaces. Null for 'new' and for every pass.
  supersedes_membership_id uuid references memberships(id) on delete set null,

  -- ── the quote ───────────────────────────────────────────────────────────
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null,
  -- Bare dates: a membership term is a run of calendar days in the member's own
  -- life, not an instant. Null `term_ends_on` is open-ended, which is what a
  -- plan with interval 'once' buys and is NOT the same as expired.
  term_starts_on date,
  term_ends_on date,
  -- How many visits a pass order is worth, and when it stops being usable.
  uses_total integer check (uses_total is null or uses_total >= 1),
  expires_on date,

  -- ── Stripe ──────────────────────────────────────────────────────────────
  -- Which ledger the charge was created on. See the header: never null, never
  -- re-derived.
  stripe_account_id text not null,
  stripe_session_id text unique,
  stripe_payment_intent text,

  -- 'pending'   the session was created and Stripe has not said anything yet.
  -- 'paid'      checkout.session.completed arrived and the entitlement below
  --             was written.
  -- 'abandoned' the session expired without payment. Nobody was charged.
  -- 'failed'    Stripe took the money and the entitlement could not be written.
  --             A state that must exist so it can be found and fixed by hand,
  --             rather than a paid member with nothing to show for it and
  --             nothing anywhere recording that we know.
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'abandoned', 'failed')),
  -- What went wrong, for a 'failed' row. Never shown to the member as-is.
  failure_note text,

  -- ── what it produced ────────────────────────────────────────────────────
  membership_id uuid references memberships(id) on delete set null,
  pass_id uuid references gym_passes(id) on delete set null,

  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A membership order names a plan and a pass order names a pass type. Not
  -- enforced through the FKs, which cannot see each other, so it is spelled
  -- out: an order that names neither is unfulfillable and an order that names
  -- both is ambiguous about what somebody paid for.
  constraint gym_orders_names_one_thing check (
    (kind = 'membership' and plan_id is not null and pass_type_id is null)
    or (kind = 'pass' and pass_type_id is not null and plan_id is null)
  ),
  -- Only a membership can supersede one.
  constraint gym_orders_supersedes_is_membership check (
    supersedes_membership_id is null or kind = 'membership'
  ),
  -- A term that ends before it starts is a quote nobody could honour.
  constraint gym_orders_term_in_order check (
    term_ends_on is null or term_starts_on is null or term_ends_on >= term_starts_on
  )
);

create index if not exists idx_gym_orders_member on gym_orders (member_id, created_at desc);
create index if not exists idx_gym_orders_tenant on gym_orders (tenant_id, created_at desc);
-- The webhook finds an order by the session that paid for it.
create index if not exists idx_gym_orders_session on gym_orders (stripe_session_id)
  where stripe_session_id is not null;

-- ── row-level security ──────────────────────────────────────────────────────
alter table gym_orders enable row level security;

-- The member reads their own, and nothing else. No INSERT and no UPDATE for
-- anybody: every write here is made by the service role from
-- supabase/functions/gym-checkout and supabase/functions/stripe-webhook. A
-- client that could insert its own order row could grant itself a membership.
drop policy if exists gym_orders_own_r on gym_orders;
create policy gym_orders_own_r on gym_orders
  for select using (member_id = (select auth.uid()));

-- The gym's owner reads every order in their own gym. SELECT only, and
-- deliberately not `for all` the way part 29's owner policies are: those tables
-- record what the gym itself did at the desk, and an owner writing one is the
-- gym recording its own act. An order is a record of a Stripe charge, and an
-- owner writing one by hand would be a membership granted with no money behind
-- it and nothing in Stripe to reconcile it against.
drop policy if exists gym_orders_owner_r on gym_orders;
create policy gym_orders_owner_r on gym_orders
  for select using (is_owner_of(tenant_id));

comment on table gym_orders is
  'One attempt by a member to buy a membership term or a pass from their gym. The entitlement lives in memberships/gym_passes; this is the money and the Stripe account it landed on.';

-- ── the idempotency key fulfilment needs ────────────────────────────────────
--
-- A Stripe webhook is retried, and it is retried precisely when the handler
-- failed part way through. The dangerous window is between "the membership row
-- was inserted" and "the order was marked paid": on the retry, an order that
-- still reads 'pending' would be fulfilled a second time and the member would
-- hold two memberships for one payment.
--
-- `gym_orders.membership_id` alone does not close it, because it is written in
-- the same statement that closes the order. So the entitlement carries the
-- order id too, with a UNIQUE index on it: fulfilment looks for a row already
-- stamped with this order before it inserts one, and if two inserts ever race,
-- the second fails loudly on the index instead of quietly doubling somebody's
-- membership.
--
-- The two tables now reference each other. Both columns are nullable and both
-- are `on delete set null`, so neither is a cycle anything has to break.
alter table memberships add column if not exists gym_order_id uuid references gym_orders(id) on delete set null;
create unique index if not exists uq_memberships_gym_order on memberships (gym_order_id) where gym_order_id is not null;

alter table gym_passes add column if not exists gym_order_id uuid references gym_orders(id) on delete set null;
create unique index if not exists uq_gym_passes_gym_order on gym_passes (gym_order_id) where gym_order_id is not null;

comment on column memberships.gym_order_id is
  'The gym_orders row that paid for this membership, or NULL for one the gym recorded at the desk. Unique: it is what stops a retried webhook fulfilling one payment twice.';
comment on column gym_passes.gym_order_id is
  'The gym_orders row that paid for this pass, or NULL for one sold at the desk. Unique, for the same reason.';
