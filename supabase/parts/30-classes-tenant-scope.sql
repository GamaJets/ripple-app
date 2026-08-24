-- ── Classes belong to a gym, not only to a trainer ──────────────────────────
--
-- Two problems.
--
-- First, `gym_classes` reached its tenant only through trainer_id ->
-- trainers.tenant_id, so a class with no trainer assigned was invisible to the
-- owner of the gym running it — and a gym cannot put a class on the timetable
-- before it knows who is teaching it.
--
-- Second, and worse: `gym_classes_read` was `auth.role() = 'authenticated'`,
-- which let any signed-in person read every class in every gym on the platform.
-- A member of one gym could enumerate a competitor's whole timetable. It was
-- corrected while the table was still empty, so no behaviour changed for
-- existing rows.

alter table gym_classes add column if not exists tenant_id uuid references tenants(id) on delete cascade;
create index if not exists idx_gym_classes_tenant on gym_classes(tenant_id, starts_at);

-- Older code paths (the trainer app) insert a class without naming the gym.
-- Rather than break them, derive it from the trainer so scoping stays direct.
create or replace function public.gym_classes_fill_tenant()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.tenant_id is null and new.trainer_id is not null then
    select t.tenant_id into new.tenant_id from trainers t where t.id = new.trainer_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_gym_classes_fill_tenant on gym_classes;
create trigger trg_gym_classes_fill_tenant
  before insert or update on gym_classes
  for each row execute function public.gym_classes_fill_tenant();

-- ── policies ────────────────────────────────────────────────────────────────
-- A row whose tenant_id is null is invisible to a tenant read rather than
-- visible to everyone: unscoped fails closed.
drop policy if exists gym_classes_read on gym_classes;
create policy gym_classes_read on gym_classes
  for select using (tenant_id = my_tenant());

drop policy if exists gym_classes_owner_rw on gym_classes;
create policy gym_classes_owner_rw on gym_classes
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

-- A trainer keeps managing their own classes.
drop policy if exists gym_classes_write on gym_classes;
create policy gym_classes_write on gym_classes
  for all using (trainer_id = (select auth.uid())) with check (trainer_id = (select auth.uid()));

-- The owner's view of who booked keys off the class's own tenant rather than a
-- second hop through trainers.
drop policy if exists class_bookings_owner_r on class_bookings;
create policy class_bookings_owner_r on class_bookings
  for select using (exists (
    select 1 from gym_classes gc
    where gc.id = class_bookings.class_id and is_owner_of(gc.tenant_id)
  ));

-- An owner marking attendance at the front desk is the whole point of the
-- roster, and previously only the class's own trainer could.
drop policy if exists class_bookings_owner_w on class_bookings;
create policy class_bookings_owner_w on class_bookings
  for update using (exists (
    select 1 from gym_classes gc
    where gc.id = class_bookings.class_id and is_owner_of(gc.tenant_id)
  )) with check (exists (
    select 1 from gym_classes gc
    where gc.id = class_bookings.class_id and is_owner_of(gc.tenant_id)
  ));
