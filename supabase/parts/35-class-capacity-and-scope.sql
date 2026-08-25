-- ─────────────────────────────────────────────────────────────────────────
-- class_attendance_summary: add capacity, and scope it to the caller's gym.
--
-- TWO changes, one function.
--
-- 1. CAPACITY. The summary returned booked and attended but not capacity, so
--    the owner's class screen could only ever compute attended/booked. It
--    printed that under the label "fill", while gymSchedule.ts reserves fill
--    for booked/capacity — the same class read 71% on the timetable and 80%
--    on the analytics screen. gym_classes.capacity has been there all along;
--    the summary simply never selected it. With it present the screen can
--    show both rates and mean each honestly.
--
-- 2. TENANT SCOPE — a cross-tenant read. The function is SECURITY DEFINER, so
--    it runs as its owner and RLS on gym_classes does not apply to it. Its own
--    guard was:
--
--      gc.trainer_id = auth.uid()
--      or exists (select 1 from profiles o
--                  where o.id = auth.uid() and o.role = 'owner')
--
--    The second arm asks "is this caller AN owner", never "is this caller the
--    owner of THIS gym". Any owner of any tenant could therefore read every
--    other gym's class titles, trainer names, booking and attendance counts.
--    Every RLS policy added in 30-classes-tenant-scope.sql already uses
--    is_owner_of(tenant_id); this brings the function into line with them.
--
-- The return type changes, so the function has to be dropped rather than
-- replaced. Both signatures are dropped because an older build may have left
-- either behind.
-- ─────────────────────────────────────────────────────────────────────────

drop function if exists public.class_attendance_summary(timestamptz, timestamptz);

create function public.class_attendance_summary(p_from timestamptz, p_to timestamptz)
returns table(class_id uuid, title text, kind text, branch text, trainer_id uuid,
              trainer_name text, starts_at timestamptz,
              capacity integer, booked integer, attended integer)
language sql
security definer
set search_path to 'public'
as $function$
  select gc.id, gc.title, gc.kind, gc.branch, gc.trainer_id,
         coalesce(tp.full_name, 'Trainer') as trainer_name, gc.starts_at,
         coalesce(gc.capacity, 0)::int as capacity,
         count(cb.id) filter (where cb.status = 'booked')::int as booked,
         count(cb.attended_at)::int as attended
  from gym_classes gc
  left join class_bookings cb on cb.class_id = gc.id
  left join profiles tp on tp.id = gc.trainer_id
  where gc.starts_at >= p_from and gc.starts_at < p_to
    and ( gc.trainer_id = auth.uid()
          -- the caller must own THIS class's gym, not merely be an owner
          or is_owner_of(gc.tenant_id) )
  group by gc.id, tp.full_name
  order by gc.starts_at desc;
$function$;

grant execute on function public.class_attendance_summary(timestamptz, timestamptz) to authenticated;
