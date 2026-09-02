-- ═══════════════════════════════════════════════════════════════════════════
-- The register a covering coach cannot take, and the show rate over 100%.
--
-- Two functions from part 25, both about `class_bookings.attended_at`, both
-- still counting or guarding the way they did before the rest of the product
-- moved. Part 165 already made the argument for the first of them and changed
-- the TABLE policies; the RPC the phone actually calls never got the change.
--
-- ── 1 · `set_class_attendance` still says 'not your class' ─────────────────
--
-- The guard is `gc.trainer_id = auth.uid()`. Part 165 widened
-- `class_bookings_staff_r` / `_staff_u` to the gym's staff and set out why in
-- full; the two reasons that matter here are quoted rather than paraphrased,
-- because they are the whole justification for this file:
--
--   "Classes are covered — illness, holiday, a swap arranged in the group chat
--    — and the person standing in the room is the person who knows who turned
--    up. A register only the named coach can take is a register that does not
--    get taken on precisely the days it is hardest to reconstruct afterwards."
--
--   "Every class already on the board has `trainer_id` NULL. studio-web's Add
--    a class wrote free-text `instructor` and never the id, so a
--    trainer_id-scoped policy would match no existing class for anybody."
--
-- The consequence on the phone is not an empty screen, it is a refusal: the
-- RPC RAISES, `setAttendance` and the floor queue both read that as the server
-- declining, and app/(trainer)/class-checkin.tsx takes the `refused` branch —
-- which correctly does NOT move the row and correctly does not queue it,
-- because the same bytes would be refused every time. So on every covered
-- class, and on every class the console created, the coach taps a member and
-- is told it did not save. The register goes unrecorded and per-attendee pay
-- with it.
--
-- The new guard is the same line part 165 drew, stated the same way: the
-- class's own tenant, and a staff role in it. The class's named trainer is
-- kept as its own arm rather than folded in, because an INDEPENDENT coach —
-- no gym, `my_tenant()` null — runs classes too, and a purely tenant-scoped
-- guard would lock them out of their own register. Both arms, and a class
-- whose `tenant_id` is null is reachable only by its named trainer. Unscoped
-- fails closed.
--
-- ── 2 · `class_attendance_summary` counts a waitlister as a show ───────────
--
-- `booked` filters `cb.status = 'booked'`. `attended` does not filter at all:
-- it is `count(cb.attended_at)` over every booking row on the class, waitlist
-- included. The register lists waitlisters and every row is tappable — by
-- design, because a place comes free at the door and the coach ticks the
-- person in front of them — so this is the ordinary case and not an edge one.
--
-- Two people off the waitlist on a class of 12 with 12 booked and 10 present
-- gives attended 12 over booked 12: a show rate of 100% on a class two of the
-- people who paid for it did not attend. Push it further and the rate goes
-- over 100%, which is not a rate at all. `summariseClassRows` sums both
-- columns across a month and divides once, so one class does this to the
-- month's figure.
--
-- `attended` is therefore narrowed to booked rows, which is what its own
-- comment in src/lib/classRates.ts has always claimed it was: "Of those
-- booked, how many were marked present."
--
-- The people who came off the waitlist are COUNTED, not discarded. They really
-- trained, the gym really has to pay for them, and dropping them would fix a
-- rate by losing a fact. `waitlist_attended` is a new column, which is exactly
-- what `GymClass.waitlistAttended` in src/lib/gymSchedule.ts already holds for
-- the console's own read of the same table, and for the reason stated there:
-- "a number that can exceed its own denominator is not a rate".
--
-- The return type changes, so the function is dropped and recreated. Every
-- existing caller reads columns by name and is unaffected by a new one on the
-- end; `attended` keeps its name and gets the meaning it was documented with.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · anyone standing in the room may take the register ───────────────────
create or replace function public.set_class_attendance(p_class uuid, p_user uuid, p_present boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Two arms, deliberately. The first is the gym's staff, matching
  -- class_bookings_staff_u from part 165 line for line so the phone and the
  -- console cannot disagree about who may take a register. The second is the
  -- class's own trainer, kept because an independent coach has no tenant and
  -- would otherwise be locked out of their own class by a tenant-scoped guard.
  if not exists (
    select 1 from gym_classes gc
    where gc.id = p_class
      and ( ( gc.tenant_id is not null
              and gc.tenant_id = my_tenant()
              and my_role() in ('trainer', 'owner') )
            or gc.trainer_id = auth.uid() )
  ) then
    -- The message is what the phone shows the coach, so it says which of the
    -- two things is wrong rather than repeating a possessive that is no longer
    -- the test. `refusedLine` in src/lib/floorQueue.ts puts it beside "was not
    -- saved and is not waiting to send".
    raise exception 'this class is not yours to register';
  end if;
  update class_bookings
     set attended_at = case when p_present then now() else null end
   where class_id = p_class and user_id = p_user;
end; $function$;

grant execute on function public.set_class_attendance(uuid, uuid, boolean) to authenticated;

-- ── 2 · a show rate that cannot exceed its own denominator ──────────────────
drop function if exists public.class_attendance_summary(timestamptz, timestamptz);

create function public.class_attendance_summary(p_from timestamptz, p_to timestamptz)
returns table(class_id uuid, title text, kind text, branch text, trainer_id uuid,
              trainer_name text, starts_at timestamptz,
              capacity integer, booked integer, attended integer,
              waitlist_attended integer)
language sql
security definer
set search_path to 'public'
as $function$
  select gc.id, gc.title, gc.kind, gc.branch, gc.trainer_id,
         coalesce(tp.full_name, 'Trainer') as trainer_name, gc.starts_at,
         coalesce(gc.capacity, 0)::int as capacity,
         count(cb.id) filter (where cb.status = 'booked')::int as booked,
         -- Of THOSE BOOKED, how many were marked present. The filter is the
         -- whole fix: without it a waitlister ticked in at the door counted
         -- against a denominator they were never in.
         count(cb.attended_at) filter (where cb.status = 'booked')::int as attended,
         -- And the people who came off the waitlist and trained. Counted apart
         -- rather than dropped: they are real attendance the gym pays for, and
         -- they belong nowhere near the numerator of a show rate.
         count(cb.attended_at) filter (where cb.status <> 'booked')::int as waitlist_attended
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
