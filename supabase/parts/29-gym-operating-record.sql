-- ── The gym's operating record ──────────────────────────────────────────────
--
-- Phase 1 of the web roadmap. None of this existed, which is why every
-- financial figure in the owner portal read zero: `invoices` and `subscriptions`
-- are keyed on trainer_id and are Repple billing trainers for the product, and
-- `trainer_packages` is a trainer's own PT packages. A gym had nowhere to record
-- a membership or a payment at all.
--
-- Additive only. Nothing here alters an existing table.

-- what the gym sells
create table if not exists membership_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'AED',
  -- `once` covers a day pass or a joining fee; it is not a recurring plan.
  interval text not null default 'month' check (interval in ('month','year','once')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_membership_plans_tenant on membership_plans(tenant_id, active);

-- who holds one
create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  member_id uuid not null references profiles(id) on delete cascade,
  -- A plan may be retired while a membership sold on it is still running, so
  -- this goes null rather than taking the membership with it.
  plan_id uuid references membership_plans(id) on delete set null,
  started_on date not null default current_date,
  -- null means open-ended, which is not the same as expired.
  ends_on date,
  status text not null default 'active'
    check (status in ('active', 'frozen', 'cancelled', 'expired')),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_memberships_tenant on memberships(tenant_id, status);
create index if not exists idx_memberships_member on memberships(member_id);

-- money the gym actually received. Recorded, never inferred: a row here means
-- somebody took money, and there is no other way for one to appear.
create table if not exists gym_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  member_id uuid references profiles(id) on delete set null,
  membership_id uuid references memberships(id) on delete set null,
  amount_cents integer not null,
  currency text not null default 'AED',
  method text not null default 'card'
    check (method in ('card', 'cash', 'transfer', 'direct_debit', 'other')),
  taken_at timestamptz not null default now(),
  note text,
  recorded_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_gym_payments_tenant on gym_payments(tenant_id, taken_at desc);
create index if not exists idx_gym_payments_member on gym_payments(member_id);

-- what the gym billed
create table if not exists gym_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  member_id uuid not null references profiles(id) on delete cascade,
  membership_id uuid references memberships(id) on delete set null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'AED',
  issued_on date not null default current_date,
  due_on date,
  status text not null default 'open'
    check (status in ('draft', 'open', 'paid', 'overdue', 'void', 'written_off')),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_gym_invoices_tenant on gym_invoices(tenant_id, status, due_on);
create index if not exists idx_gym_invoices_member on gym_invoices(member_id);

-- ── row-level security ──────────────────────────────────────────────────────
-- The helpers are SECURITY DEFINER, so a policy calling them does not re-enter
-- the table it is protecting — the recursion that once made `profiles`
-- unreadable for everyone (see 28-fix-profiles-recursion.sql).
alter table membership_plans enable row level security;
alter table memberships     enable row level security;
alter table gym_payments    enable row level security;
alter table gym_invoices    enable row level security;

drop policy if exists membership_plans_owner on membership_plans;
create policy membership_plans_owner on membership_plans
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

drop policy if exists memberships_owner on memberships;
create policy memberships_owner on memberships
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

drop policy if exists gym_payments_owner on gym_payments;
create policy gym_payments_owner on gym_payments
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

drop policy if exists gym_invoices_owner on gym_invoices;
create policy gym_invoices_owner on gym_invoices
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

-- Anyone in the gym may see what is on sale — a price book is not private, and
-- the member-facing booking pages will need it.
drop policy if exists membership_plans_tenant_r on membership_plans;
create policy membership_plans_tenant_r on membership_plans
  for select using (tenant_id = my_tenant() and active);

-- A member reads their own membership, invoices and payments, and nobody else's.
drop policy if exists memberships_own_r on memberships;
create policy memberships_own_r on memberships
  for select using (member_id = (select auth.uid()));

drop policy if exists gym_payments_own_r on gym_payments;
create policy gym_payments_own_r on gym_payments
  for select using (member_id = (select auth.uid()));

drop policy if exists gym_invoices_own_r on gym_invoices;
create policy gym_invoices_own_r on gym_invoices
  for select using (member_id = (select auth.uid()));
