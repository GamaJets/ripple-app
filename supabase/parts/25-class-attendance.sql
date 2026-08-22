-- Group-class attendance: the trainer checks members into a class, the owner
-- reads fill rates for payroll and analytics.
--
-- DUMPED FROM THE LIVE DATABASE. The important detail, and the one a
-- reconstruction got wrong: attendance is recorded as `class_bookings.attended_at
-- is not null`. There is no `attended` boolean column. Adding one and switching
-- the functions to it would have orphaned every attendance already recorded.

alter table class_bookings add column if not exists attended_at timestamptz;

create index if not exists idx_class_bookings_user_id on class_bookings(user_id);

-- The owner of the tenant that owns the class can read its bookings.
drop policy if exists class_bookings_owner_r on class_bookings;
create policy class_bookings_owner_r on class_bookings
  for select using (exists (
    select 1 from gym_classes gc
      join trainers t on t.id = gc.trainer_id
     where gc.id = class_bookings.class_id and is_owner_of(t.tenant_id)));

-- ── The check-in roster for one class ───────────────────────────────────────
-- Readable by the class's trainer OR an owner.
create or replace function public.class_roster(p_class uuid)
returns table(user_id uuid, name text, status text, attended boolean)
language sql
security definer
set search_path to 'public'
as $function$
  select cb.user_id,
         coalesce(p.full_name, 'Member') as name,
         cb.status,
         (cb.attended_at is not null) as attended
  from class_bookings cb
  left join profiles p on p.id = cb.user_id
  where cb.class_id = p_class
    and ( exists (select 1 from gym_classes gc where gc.id = p_class and gc.trainer_id = auth.uid())
          or exists (select 1 from profiles o where o.id = auth.uid() and o.role = 'owner') )
  order by name;
$function$;

-- ── Mark one member present or absent ───────────────────────────────────────
create or replace function public.set_class_attendance(p_class uuid, p_user uuid, p_present boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from gym_classes gc where gc.id = p_class and gc.trainer_id = auth.uid()) then
    raise exception 'not your class';
  end if;
  update class_bookings
     set attended_at = case when p_present then now() else null end
   where class_id = p_class and user_id = p_user;
end; $function$;

-- ── Attendance over a date range ────────────────────────────────────────────
-- Visible to the class's own trainer OR an owner, and the range is half-open
-- (>= p_from, < p_to). Parameter names are load-bearing: PostgREST binds by
-- name, so they must match src/lib/classAttendance.ts exactly.
--
-- Note for anything calling this server-side: the guard is on auth.uid(), which
-- is NULL under the service role, so a service-role call returns zero rows.
create or replace function public.class_attendance_summary(p_from timestamptz, p_to timestamptz)
returns table(class_id uuid, title text, kind text, branch text, trainer_id uuid,
              trainer_name text, starts_at timestamptz, booked integer, attended integer)
language sql
security definer
set search_path to 'public'
as $function$
  select gc.id, gc.title, gc.kind, gc.branch, gc.trainer_id,
         coalesce(tp.full_name, 'Trainer') as trainer_name, gc.starts_at,
         count(cb.id) filter (where cb.status = 'booked')::int as booked,
         count(cb.attended_at)::int as attended
  from gym_classes gc
  left join class_bookings cb on cb.class_id = gc.id
  left join profiles tp on tp.id = gc.trainer_id
  where gc.starts_at >= p_from and gc.starts_at < p_to
    and ( gc.trainer_id = auth.uid()
          or exists (select 1 from profiles o where o.id = auth.uid() and o.role = 'owner') )
  group by gc.id, tp.full_name
  order by gc.starts_at desc;
$function$;
