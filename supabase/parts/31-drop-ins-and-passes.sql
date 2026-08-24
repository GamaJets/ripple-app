-- ── Drop-ins, guest passes and class packs ──────────────────────────────────
--
-- Phase 1, F16. A gym takes money from people who are not members: the walk-in
-- who pays for one session, the friend a member brings, the ten-class pack sold
-- at the desk. None of that fits `memberships`, which assumes a profile and a
-- recurring plan, so it was going unrecorded — and every attendance and revenue
-- figure was short by however much of it happens.
--
-- Additive only. Nothing here alters an existing table.

-- ── what the gym sells at the desk ──────────────────────────────────────────
create table if not exists gym_pass_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  -- drop_in: one visit, bought by anyone.
  -- guest:   one visit, bought by (or gifted to) a member for someone else.
  -- pack:    a block of visits used over time.
  kind text not null default 'drop_in' check (kind in ('drop_in','guest','pack')),
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'AED',
  -- How many visits one purchase is worth. A drop-in is 1; a pack is n.
  uses integer not null default 1 check (uses >= 1),
  -- Days from issue until it expires. Null means it does not expire, which is
  -- a deliberate choice a gym makes, not a missing value.
  valid_days integer check (valid_days is null or valid_days > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_gym_pass_types_tenant on gym_pass_types(tenant_id, active);

-- ── an issued pass ──────────────────────────────────────────────────────────
create table if not exists gym_passes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  -- A type may be retired while passes sold on it are still valid, so this
  -- goes null rather than taking the pass with it.
  pass_type_id uuid references gym_pass_types(id) on delete set null,
  -- The holder is either a profile (a member, or a walk-in who made an account)
  -- or just a name written at the desk. Requiring an account to sell someone a
  -- day pass would mean the sale went unrecorded, which is how we got here.
  holder_id uuid references profiles(id) on delete set null,
  holder_name text,
  -- Who brought them, when this is a guest pass. Useful on its own: guests of
  -- members convert differently from cold walk-ins.
  host_member_id uuid references profiles(id) on delete set null,
  issued_on date not null default current_date,
  expires_on date,
  uses_total integer not null check (uses_total >= 1),
  uses_spent integer not null default 0 check (uses_spent >= 0),
  -- What was actually taken for it. Null means nobody recorded a price — not
  -- that it was free. `gymPasses.passRevenueCents` returns null for that rather
  -- than quietly counting it as zero.
  paid_cents integer check (paid_cents is null or paid_cents >= 0),
  currency text not null default 'AED',
  note text,
  created_at timestamptz not null default now(),
  -- A pass with no holder at all cannot be checked in against anyone.
  constraint gym_passes_holder_present
    check (holder_id is not null or nullif(btrim(holder_name), '') is not null),
  -- The database refuses to let a pass be spent past its own limit; the app
  -- checks too, but the app is not the last line.
  constraint gym_passes_not_overspent check (uses_spent <= uses_total)
);
create index if not exists idx_gym_passes_tenant on gym_passes(tenant_id, issued_on desc);
create index if not exists idx_gym_passes_holder on gym_passes(holder_id) where holder_id is not null;

-- ── each redemption, kept rather than just decremented ──────────────────────
-- A counter tells you a pass was used; a row tells you when, by whom, and
-- against which class. Only the second can be disputed and resolved.
create table if not exists gym_pass_redemptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  pass_id uuid not null references gym_passes(id) on delete cascade,
  class_id uuid references gym_classes(id) on delete set null,
  redeemed_at timestamptz not null default now(),
  -- The staff member who took it, not the person using it.
  redeemed_by uuid references profiles(id) on delete set null
);
create index if not exists idx_gym_pass_redemptions_pass on gym_pass_redemptions(pass_id, redeemed_at desc);
create index if not exists idx_gym_pass_redemptions_tenant on gym_pass_redemptions(tenant_id, redeemed_at desc);

-- ── keep the counter and the rows honest ────────────────────────────────────
-- uses_spent is a cache of count(redemptions). Letting the app maintain both
-- independently guarantees they drift, so the trigger owns it.
create or replace function gym_passes_sync_uses() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update gym_passes p
     set uses_spent = (select count(*) from gym_pass_redemptions r where r.pass_id = p.id)
   where p.id = coalesce(new.pass_id, old.pass_id);
  return coalesce(new, old);
end $$;

drop trigger if exists trg_gym_pass_redemptions_sync on gym_pass_redemptions;
create trigger trg_gym_pass_redemptions_sync
  after insert or delete on gym_pass_redemptions
  for each row execute function gym_passes_sync_uses();

-- A redemption inherits the pass's tenant, so the desk never has to supply it
-- and can never supply the wrong one.
create or replace function gym_pass_redemptions_fill_tenant() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tenant_id is null then
    select p.tenant_id into new.tenant_id from gym_passes p where p.id = new.pass_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_gym_pass_redemptions_tenant on gym_pass_redemptions;
create trigger trg_gym_pass_redemptions_tenant
  before insert on gym_pass_redemptions
  for each row execute function gym_pass_redemptions_fill_tenant();

-- ── row-level security ──────────────────────────────────────────────────────
-- The helpers are SECURITY DEFINER, so a policy calling them does not re-enter
-- the table it is protecting — the recursion that once made `profiles`
-- unreadable for everyone (see 28-fix-profiles-recursion.sql).
alter table gym_pass_types       enable row level security;
alter table gym_passes           enable row level security;
alter table gym_pass_redemptions enable row level security;

drop policy if exists gym_pass_types_owner on gym_pass_types;
create policy gym_pass_types_owner on gym_pass_types
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

drop policy if exists gym_passes_owner on gym_passes;
create policy gym_passes_owner on gym_passes
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

drop policy if exists gym_pass_redemptions_owner on gym_pass_redemptions;
create policy gym_pass_redemptions_owner on gym_pass_redemptions
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

-- What is on sale at the desk is not private, and the booking screens need it.
drop policy if exists gym_pass_types_tenant_r on gym_pass_types;
create policy gym_pass_types_tenant_r on gym_pass_types
  for select using (tenant_id = my_tenant() and active);

-- A holder reads their own passes and nobody else's. Note this is scoped to
-- holder_id, so a desk-written walk-in (holder_name only) is visible to the
-- gym alone — there is no account for it to leak to.
drop policy if exists gym_passes_own_r on gym_passes;
create policy gym_passes_own_r on gym_passes
  for select using (holder_id = (select auth.uid()));

drop policy if exists gym_pass_redemptions_own_r on gym_pass_redemptions;
create policy gym_pass_redemptions_own_r on gym_pass_redemptions
  for select using (
    exists (select 1 from gym_passes p
             where p.id = gym_pass_redemptions.pass_id
               and p.holder_id = (select auth.uid()))
  );

-- Staff need to take a pass at the desk without being an owner. A trainer in
-- the gym may record a redemption, but may not issue or price a pass.
drop policy if exists gym_pass_redemptions_staff_w on gym_pass_redemptions;
create policy gym_pass_redemptions_staff_w on gym_pass_redemptions
  for insert with check (tenant_id = my_tenant() and my_role() in ('trainer','owner'));

drop policy if exists gym_passes_staff_r on gym_passes;
create policy gym_passes_staff_r on gym_passes
  for select using (tenant_id = my_tenant() and my_role() in ('trainer','owner'));
