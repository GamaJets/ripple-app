-- Repple billing (Stripe). The platform owner charges TRAINERS a subscription
-- (the white-label fee). These tables are written ONLY by the stripe-webhook
-- edge function via the service role; the app reads its own rows. Idempotent.
-- Depends on schema.sql (profiles with a `role` column). Client payments to
-- trainers (Stripe Connect) are a separate later phase — not in this file.

create table if not exists billing_customers (
  trainer_id uuid primary key references profiles(id) on delete cascade,
  stripe_customer_id text not null unique,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists subscriptions (
  trainer_id uuid primary key references profiles(id) on delete cascade,
  stripe_subscription_id text unique,
  plan text,
  status text,                     -- active | trialing | past_due | canceled | unpaid | incomplete
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists invoices (
  id text primary key,             -- stripe invoice id
  trainer_id uuid references profiles(id) on delete set null,
  amount_due integer,              -- cents
  currency text,
  status text,                     -- paid | open | uncollectible | void
  attempt_count integer,
  hosted_invoice_url text,
  created_at timestamptz not null default now()
);
create index if not exists idx_invoices_trainer on invoices (trainer_id, created_at desc);

alter table billing_customers enable row level security;
alter table subscriptions enable row level security;
alter table invoices enable row level security;

-- A trainer sees their own billing; the owner sees everyone's (for dunning).
drop policy if exists cust_read on billing_customers;
create policy cust_read on billing_customers for select using (
  trainer_id = auth.uid() or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner'));
drop policy if exists sub_read on subscriptions;
create policy sub_read on subscriptions for select using (
  trainer_id = auth.uid() or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner'));
drop policy if exists inv_read on invoices;
create policy inv_read on invoices for select using (
  trainer_id = auth.uid() or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner'));
