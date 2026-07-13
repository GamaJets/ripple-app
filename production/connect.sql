-- Stripe Connect — trainers get paid by THEIR clients (marketplace layer on top
-- of the platform subscription billing in billing.sql). Each trainer is a Stripe
-- Express connected account; clients pay via Checkout with the platform taking an
-- application fee. Connect tables are written by the connect-* edge functions via
-- the service role; trainers manage their own packages directly (RLS). Idempotent.

create table if not exists connect_accounts (
  trainer_id uuid primary key references profiles(id) on delete cascade,
  stripe_account_id text unique,
  charges_enabled boolean not null default false,
  details_submitted boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists trainer_packages (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  price_cents integer not null,        -- price in cents
  currency text not null default 'usd',
  sessions integer,                    -- null = membership/one-off; N = a session pack
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_packages_trainer on trainer_packages (trainer_id) where active;

create table if not exists client_purchases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references profiles(id) on delete set null,
  trainer_id uuid references profiles(id) on delete set null,
  package_id uuid references trainer_packages(id) on delete set null,
  stripe_session_id text unique,
  amount_cents integer,
  sessions_total integer,
  sessions_used integer not null default 0,
  status text not null default 'paid',
  created_at timestamptz not null default now()
);
create index if not exists idx_purchases_client on client_purchases (client_id, created_at desc);
create index if not exists idx_purchases_trainer on client_purchases (trainer_id, created_at desc);

alter table connect_accounts enable row level security;
alter table trainer_packages enable row level security;
alter table client_purchases enable row level security;

-- Connect account: the trainer reads their own; the owner reads all.
drop policy if exists conn_read on connect_accounts;
create policy conn_read on connect_accounts for select using (
  trainer_id = auth.uid() or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner'));

-- Packages: any signed-in user reads ACTIVE packages (clients browse); a trainer
-- fully manages their own (create/edit/deactivate) straight from the app.
drop policy if exists pkg_read on trainer_packages;
create policy pkg_read on trainer_packages for select using (active or trainer_id = auth.uid());
drop policy if exists pkg_write on trainer_packages;
create policy pkg_write on trainer_packages for all using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());

-- Purchases: the client sees their own, the trainer sees theirs, the owner all.
drop policy if exists purch_read on client_purchases;
create policy purch_read on client_purchases for select using (
  client_id = auth.uid() or trainer_id = auth.uid()
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner'));
