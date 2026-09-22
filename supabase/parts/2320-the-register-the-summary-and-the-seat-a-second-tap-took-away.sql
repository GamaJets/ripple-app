-- ═══════════════════════════════════════════════════════════════════════════
-- Three faults in the class flow, found by reading it before it was used live
-- ═══════════════════════════════════════════════════════════════════════════
--
-- All three verified against the LIVE database with pg_get_functiondef before
-- this file was written, not inferred from the parts. Each is a case where the
-- database answers with something plausible instead of refusing, so the app has
-- nothing to report and the screen states a wrong thing calmly.
--
-- ── 1 · class_roster was never widened when set_class_attendance was ───────
--
-- Part 460 widened WHO MAY MARK a register:
--
--     ( gc.tenant_id is not null and gc.tenant_id = my_tenant()
--       and my_role() in ('trainer','owner') ) or gc.trainer_id = auth.uid()
--
-- so a coach covering somebody else's class can tick people in. The READ that
-- fills that register, class_roster, kept part 38's original:
--
--     gc.trainer_id = auth.uid() or is_owner_of(gc.tenant_id)
--
-- The two have disagreed ever since. And because the guard is in the WHERE of a
-- `language sql` set-returning function, failing it is not an error — it is
-- zero rows. src/lib/classAttendance.ts:40 returns null only on `error`, so it
-- hands back an empty array, and app/(trainer)/class-checkin.tsx:238 sets
-- `counted = true` on it. The covering coach stands in front of a full room
-- reading "0 / 0" and "No bookings on this class yet."
--
-- Nobody can be ticked in, so the class reaches class_attendance_summary with
-- attended = 0 and the coach is paid for nobody.
--
-- This is not a rare path. app/(trainer)/classes.tsx:889 puts a Check In button
-- on every class the coach can see, and gym_classes_read is the whole gym's
-- timetable. It fires whenever the coach did not personally create the class:
-- the owner made it, a colleague made it, the class was covered, or it came
-- from studio-web — where createClass takes trainerId as OPTIONAL, leaving
-- trainer_id null and, through the fill trigger, tenant_id null too.
--
-- No privilege is widened by fixing it: class_bookings_staff_r already lets
-- that same coach read those same rows directly. The function was simply the
-- stricter of two guards that were meant to be one.
--
-- ── 2 · a called-off class counted as a class that ran ─────────────────────
--
-- class_attendance_summary filters on the date window and the caller, and says
-- nothing about gc.status. Part 195 deliberately KEEPS a cancelled class and
-- its bookings, so this is the ordinary case rather than an edge one, and the
-- row arrives as capacity 16, booked 12, attended 0.
--
-- Three screens then state something false, and the third costs money:
--
--   · app/(owner)/class-analytics.tsx — the Classes count includes a class
--     nobody taught, and Avg Show is dragged down by 12 booked against 0
--     attended. summariseClassRows sums first and divides once, so there is no
--     later opportunity to notice.
--
--   · app/(trainer)/my-register.tsx — missingRegisters sees bookings, nothing
--     marked and a start time in the past, and tells the coach they still owe
--     a register for a class that was called off.
--
--   · Payroll. classPayAmount in src/lib/gymPay.ts:438 is `if (kind ===
--     'per_class') return rateCents` — the headcount is never consulted — and
--     classPayBlocker has no cancelled test. So the cancelled class is listed
--     with an Add To Payroll button and the full flat rate beside it, and the
--     owner pays a coach in full for a class that never opened.
--
-- Filtered at the source, which fixes all three at once and needs no change in
-- the app. The trade-off is stated rather than hidden: a cancelled class now
-- disappears from the owner's class log entirely. The richer alternative is to
-- return gc.status and let each caller decide, which means a changed return
-- type and three call sites. It is not obviously better — every consumer this
-- function has today is asking about classes that RAN, and a class that was
-- called off is not one. An owner who wants a cancellations log should have a
-- query that is about cancellations, not a wrong number in one that is not.
--
-- ── 3 · a second tap taking away a seat the member already held ────────────
--
-- book_class ends with:
--
--     on conflict (class_id, user_id) do update set status = excluded.status
--
-- Part 492 identified exactly this and fixed it for the DESK path only. Its
-- header: "a desk clicking twice on a class that filled up in between would
-- demote somebody who already holds a confirmed place to the waiting list. A
-- place already given is not taken back by a second click." book_class_for
-- returns the existing status untouched. book_class still overwrites.
--
-- The member reaches it through a failure that is already handled everywhere
-- else. src/ui/classes.tsx:296-311: if the "which seats do I hold" read fails,
-- myStatus stays {} while the class list is populated, so
-- app/(client)/classes.tsx:314 draws Book on classes the member already holds.
-- One tap on a class that has since filled re-runs the upsert; the count
-- includes their own row, so it is >= capacity; and they are moved to the
-- waitlist and told "Added to waitlist — we'll move you up if a spot opens."
-- They have just lost a seat they had, and the app sounds pleased about it.
--
-- Re-booking after a genuine cancel still works: cancel_class DELETES the
-- member's row (it updates a different one, to promote off the waitlist), so
-- there is no row for this guard to find. Checked on the live definition.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 ──────────────────────────────────────────────────────────────────────
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
  join gym_classes gc on gc.id = cb.class_id
  left join profiles p on p.id = cb.user_id
  where cb.class_id = p_class
    -- Identical to set_class_attendance's guard (part 460), and that is the
    -- point of this part: the register you may MARK and the register you may
    -- READ have to be the same register.
    and ( ( gc.tenant_id is not null and gc.tenant_id = my_tenant()
            and my_role() in ('trainer', 'owner') )
          or gc.trainer_id = auth.uid() )
  order by name;
$function$;

-- ── 2 ──────────────────────────────────────────────────────────────────────
create or replace function public.class_attendance_summary(p_from timestamp with time zone, p_to timestamp with time zone)
 returns table(class_id uuid, title text, kind text, branch text, trainer_id uuid, trainer_name text, starts_at timestamp with time zone, capacity integer, booked integer, attended integer, waitlist_attended integer)
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
    -- A class that was called off is not a class that ran. Every caller of this
    -- function — the owner's Classes count and Avg Show, the coach's list of
    -- registers still owed, and the per-class payroll line — is asking about
    -- classes that ran. See this part's header for the trade-off.
    and coalesce(gc.status, '') <> 'cancelled'
    and ( gc.trainer_id = auth.uid()
          -- the caller must own THIS class's gym, not merely be an owner
          or is_owner_of(gc.tenant_id) )
  group by gc.id, tp.full_name
  order by gc.starts_at desc;
$function$;

-- ── 3 ──────────────────────────────────────────────────────────────────────
create or replace function public.book_class(p_class uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_cap int; v_count int; v_status text; v_tenant uuid; v_existing text;
begin
  perform 1 from gym_classes where id = p_class for update;
  select capacity, tenant_id into v_cap, v_tenant from gym_classes where id = p_class;
  if v_cap is null then return 'notfound'; end if;
  -- A class outside your gym is indistinguishable from one that is not there.
  if v_tenant is distinct from my_tenant() then return 'notfound'; end if;

  -- A place already given is not taken back by a second tap. Part 492 made
  -- exactly this change to book_class_for and did not reach this function; the
  -- row is read inside the same `for update` the count below relies on, so the
  -- check and the insert cannot straddle another booking.
  select status into v_existing from class_bookings
   where class_id = p_class and user_id = auth.uid();
  if v_existing is not null then return v_existing; end if;

  select count(*) into v_count from class_bookings where class_id = p_class and status = 'booked';
  v_status := case when v_count < v_cap then 'booked' else 'waitlist' end;
  insert into class_bookings (class_id, user_id, status) values (p_class, auth.uid(), v_status)
    on conflict (class_id, user_id) do update set status = excluded.status;
  return v_status;
end; $function$;

-- All three already existed, so their grants are already as parts 38, 460 and
-- 02 left them. Restated because `create or replace` on a function that did NOT
-- previously exist leaves it executable by PUBLIC, which in a Supabase project
-- includes anon — the failure part 1901 shipped and get_advisors caught.
revoke all on function public.class_roster(uuid) from public, anon;
revoke all on function public.class_attendance_summary(timestamptz, timestamptz) from public, anon;
revoke all on function public.book_class(uuid) from public, anon;
grant execute on function public.class_roster(uuid) to authenticated;
grant execute on function public.class_attendance_summary(timestamptz, timestamptz) to authenticated;
grant execute on function public.book_class(uuid) to authenticated;
