-- Group-class attendance: the trainer checks members into a class so they get
-- paid per attendee, and the owner reads fill rates for payroll and analytics.
-- `gym_classes` and `class_bookings` exist (02-domain-schema) but there was
-- nowhere to record who actually turned up, and all three RPCs the app calls
-- were missing. Reconstructed from src/lib/classAttendance.ts,
-- app/(trainer)/class-checkin.tsx and functions/owner-metrics.

-- ── Attendance lives on the booking ─────────────────────────────────────────
alter table class_bookings add column if not exists attended    boolean not null default false;
alter table class_bookings add column if not exists attended_at timestamptz;

create index if not exists idx_class_bookings_attended
  on class_bookings(class_id) where attended;

-- ── The check-in roster for one class ───────────────────────────────────────
-- Trainer-only: this is the screen that decides who gets paid for what.
create or replace function class_roster(p_class uuid)
returns table (user_id uuid, name text, status text, attended boolean)
language sql
security definer
set search_path to 'public'
as $function$
  select b.user_id,
         coalesce(nullif(btrim(p.full_name), ''), 'Member') as name,
         b.status,
         b.attended
    from class_bookings b
    join gym_classes g on g.id = b.class_id
    left join profiles p on p.id = b.user_id
   where b.class_id = p_class
     and g.trainer_id = auth.uid()
   order by 2;
$function$;

revoke all on function class_roster(uuid) from public;
revoke execute on function class_roster(uuid) from anon;
grant execute on function class_roster(uuid) to authenticated;

-- ── Mark one member present or absent ───────────────────────────────────────
create or replace function set_class_attendance(p_class uuid, p_user uuid, p_present boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (
    select 1 from gym_classes g
     where g.id = p_class
       and g.trainer_id = auth.uid()
  ) then
    raise exception 'That class is not yours to check in.';
  end if;

  update class_bookings
     set attended    = p_present,
         attended_at = case when p_present then now() else null end
   where class_id = p_class
     and user_id  = p_user;
end
$function$;

revoke all on function set_class_attendance(uuid, uuid, boolean) from public;
revoke execute on function set_class_attendance(uuid, uuid, boolean) from anon;
grant execute on function set_class_attendance(uuid, uuid, boolean) to authenticated;

-- ── Gym-wide attendance over a date range ───────────────────────────────────
-- Parameter names are load-bearing: PostgREST binds by name, so `p_from`/`p_to`
-- must match src/lib/classAttendance.ts exactly. functions/owner-metrics was
-- calling this with `from_ts`/`to_ts` and could never have bound to any single
-- signature; that call site is corrected to match.
--
-- This one crosses trainers, so it is owner-scoped rather than caller-scoped.
-- auth.uid() is null when owner-metrics calls it with the service role; EXECUTE
-- is revoked from anon so a null uid here means a trusted server-side caller.
create or replace function class_attendance_summary(p_from timestamptz, p_to timestamptz)
returns table (
  class_id     uuid,
  title        text,
  kind         text,
  branch       text,
  trainer_id   uuid,
  trainer_name text,
  starts_at    timestamptz,
  booked       int,
  attended     int
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and not exists (
    select 1 from profiles where id = auth.uid() and role = 'owner'
  ) then
    raise exception 'Owner access required.';
  end if;

  return query
    select g.id,
           g.title,
           coalesce(g.kind, ''),
           coalesce(nullif(btrim(g.branch), ''), '—'),
           g.trainer_id,
           coalesce(nullif(btrim(p.full_name), ''), 'Trainer'),
           g.starts_at,
           count(b.id) filter (where b.status = 'booked')::int,
           count(b.id) filter (where b.attended)::int
      from gym_classes g
      left join profiles p on p.id = g.trainer_id
      left join class_bookings b on b.class_id = g.id
     where g.starts_at >= p_from
       and g.starts_at <= p_to
     group by g.id, p.full_name
     order by g.starts_at desc;
end
$function$;

revoke all on function class_attendance_summary(timestamptz, timestamptz) from public;
revoke execute on function class_attendance_summary(timestamptz, timestamptz) from anon;
grant execute on function class_attendance_summary(timestamptz, timestamptz) to authenticated;
