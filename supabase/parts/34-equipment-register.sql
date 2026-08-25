-- ── The equipment register ──────────────────────────────────────────────────
--
-- Phase 1. What the gym owns, what is out of action, and what is due a service.
--
-- The reason this is not just an inventory list: capacity. A class capacity of
-- 14 is a claim about the room, and it stops being true the moment six of the
-- rowers are broken. Studio already reports fill rate against stated capacity,
-- so without this the gym is measuring itself against a number that quietly
-- became fiction.
--
-- Additive only. Nothing here alters an existing table.

create table if not exists gym_equipment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  -- Loose on purpose. A gym's own words for its kit beat a taxonomy we impose,
  -- and the capacity check matches on this string.
  category text,
  -- Asset tag, serial, or whatever is written on the sticker.
  identifier text,
  quantity integer not null default 1 check (quantity >= 0),
  status text not null default 'in_service'
    check (status in ('in_service', 'out_of_service', 'retired')),
  purchased_on date,
  -- Null means no service schedule — a decision the gym made, not a gap.
  service_interval_days integer check (service_interval_days is null or service_interval_days > 0),
  -- Null with an interval set means the schedule exists but nobody has recorded
  -- a service. That is NOT the same as "serviced today", and
  -- gymEquipment.serviceState reports it as its own state rather than
  -- computing a due date from a date it does not have.
  last_serviced_on date,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_gym_equipment_tenant on gym_equipment(tenant_id, status);
create index if not exists idx_gym_equipment_category on gym_equipment(tenant_id, category)
  where status = 'in_service';
create index if not exists idx_gym_equipment_service on gym_equipment(tenant_id, last_serviced_on)
  where service_interval_days is not null;

-- ── row-level security ──────────────────────────────────────────────────────
-- The helpers are SECURITY DEFINER, so a policy calling them does not re-enter
-- the table it is protecting — the recursion that once made `profiles`
-- unreadable for everyone (see 28-fix-profiles-recursion.sql).
alter table gym_equipment enable row level security;

drop policy if exists gym_equipment_owner on gym_equipment;
create policy gym_equipment_owner on gym_equipment
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

-- Trainers read the register and may take a machine out of action — they are
-- the ones standing next to it when it breaks. They cannot add, price or
-- retire kit, which is the owner's call.
drop policy if exists gym_equipment_staff_r on gym_equipment;
create policy gym_equipment_staff_r on gym_equipment
  for select using (tenant_id = my_tenant() and my_role() in ('trainer', 'owner'));

drop policy if exists gym_equipment_staff_u on gym_equipment;
create policy gym_equipment_staff_u on gym_equipment
  for update using (tenant_id = my_tenant() and my_role() in ('trainer', 'owner'))
  with check (tenant_id = my_tenant() and my_role() in ('trainer', 'owner'));
