-- ── The door log ────────────────────────────────────────────────────────────
--
-- Phase 1. Attendance is currently only counted where a class was booked and
-- ticked off. Every member who walks in, trains on the floor and leaves is
-- invisible — which in most gyms is the majority of visits.
--
-- That under-count matters beyond the headline: retention is inferred from
-- attendance pattern breaks, so a member who switched from classes to the
-- floor currently looks like a member who stopped coming.
--
-- Additive only. Nothing here alters an existing table.

create table if not exists gym_visits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  -- Null for an anonymous head-count: a turnstile that counts bodies without
  -- identifying them still tells the gym about capacity, even though it says
  -- nothing about retention.
  member_id uuid references profiles(id) on delete set null,
  -- Set when the visit was paid for with a drop-in or guest pass, so the two
  -- records reconcile instead of double counting the same person.
  pass_id uuid references gym_passes(id) on delete set null,
  -- Set when the visit was attendance at a booked class, so class attendance
  -- and floor attendance can be told apart in the same table.
  class_id uuid references gym_classes(id) on delete set null,
  entered_at timestamptz not null default now(),
  -- Null means either still inside or nobody recorded an exit. The two are
  -- indistinguishable here on purpose — see gymVisits.averageDwellMinutes,
  -- which refuses to average over visits with no exit rather than guessing.
  exited_at timestamptz,
  source text not null default 'desk'
    check (source in ('desk','qr','door','app','manual')),
  note text,
  created_at timestamptz not null default now(),
  -- A visit cannot end before it began. Clock skew on a door terminal is real,
  -- and a negative dwell time poisons every average built on it.
  constraint gym_visits_exit_after_entry
    check (exited_at is null or exited_at >= entered_at)
);

create index if not exists idx_gym_visits_tenant on gym_visits(tenant_id, entered_at desc);
create index if not exists idx_gym_visits_member on gym_visits(member_id, entered_at desc)
  where member_id is not null;
create index if not exists idx_gym_visits_open on gym_visits(tenant_id)
  where exited_at is null;

-- A visit paid for by a pass inherits that pass's tenant, so a terminal never
-- has to supply it and can never supply the wrong one.
create or replace function gym_visits_fill_tenant() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tenant_id is null and new.pass_id is not null then
    select p.tenant_id into new.tenant_id from gym_passes p where p.id = new.pass_id;
  end if;
  if new.tenant_id is null and new.class_id is not null then
    select c.tenant_id into new.tenant_id from gym_classes c where c.id = new.class_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_gym_visits_tenant on gym_visits;
create trigger trg_gym_visits_tenant
  before insert on gym_visits
  for each row execute function gym_visits_fill_tenant();

-- ── row-level security ──────────────────────────────────────────────────────
-- The helpers are SECURITY DEFINER, so a policy calling them does not re-enter
-- the table it is protecting — the recursion that once made `profiles`
-- unreadable for everyone (see 28-fix-profiles-recursion.sql).
alter table gym_visits enable row level security;

drop policy if exists gym_visits_owner on gym_visits;
create policy gym_visits_owner on gym_visits
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

-- Staff work the door; they may record visits without being an owner.
drop policy if exists gym_visits_staff_rw on gym_visits;
create policy gym_visits_staff_rw on gym_visits
  for select using (tenant_id = my_tenant() and my_role() in ('trainer','owner'));

drop policy if exists gym_visits_staff_w on gym_visits;
create policy gym_visits_staff_w on gym_visits
  for insert with check (tenant_id = my_tenant() and my_role() in ('trainer','owner'));

drop policy if exists gym_visits_staff_u on gym_visits;
create policy gym_visits_staff_u on gym_visits
  for update using (tenant_id = my_tenant() and my_role() in ('trainer','owner'))
  with check (tenant_id = my_tenant() and my_role() in ('trainer','owner'));

-- A member sees their own visit history and nobody else's. This is deliberately
-- readable to them: "when did I actually come in" is their record too, and it
-- is the evidence behind any retention conversation the gym starts.
drop policy if exists gym_visits_own_r on gym_visits;
create policy gym_visits_own_r on gym_visits
  for select using (member_id = (select auth.uid()));
