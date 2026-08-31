-- ── The attendance a member generates about themselves and cannot read ─────
--
-- The client app had no record that anybody had ever turned up. The coach app
-- takes the register (app/(trainer)/class-checkin.tsx), the owner console marks
-- it and the Studio reads the door log, and the member — the person the rows
-- are ABOUT — had no screen at all. app/(client)/attendance.tsx is that screen.
-- This part is the audit that had to come first, because RLS narrows a GRANT
-- and the GRANT on all three tables is the blanket `authenticated` one.
--
-- Modelled on 125-a-member-can-read-their-own-membership.sql, which asked the
-- same question about memberships a few hours ago and found the answer was
-- already yes. It is already yes here too — and, unlike part 125, the reason
-- the screen still could not be built honestly turned out to be a hole rather
-- than a gap.
--
-- ── What the audit found (run against the live project, not read off) ───────
--
-- Both self-reads exist and both work:
--
--   class_bookings_self  for all    using (user_id  = (select auth.uid()))   -- part 02
--   gym_visits_own_r     for select using (member_id = (select auth.uid()))  -- part 32
--
-- Proved with two real client profiles in two different tenants, each holding a
-- scratch booking and scratch visits, queried under `set local role
-- authenticated` with the other member's uid in request.jwt.claims:
--
--   member A: own bookings 2, own visits 3.
--   member B: own bookings 1, own visits 1; A's booking by primary key 0,
--             A's visit by primary key 0.
--   anon:     the read never reaches a policy — it dies at `permission denied
--             for function my_tenant`, the SECURITY DEFINER helper anon has no
--             EXECUTE on. It fails closed.
--
-- So nothing below re-grants a member their own attendance. They had it.
--
-- ── 1. What they could not read: the class they attended ────────────────────
--
-- A booking row names a class_id and an attended_at and nothing else. Every
-- human-readable fact about the class — its TITLE, when it STARTED, who taught
-- it, which branch it was at — lives in `gym_classes`, whose only member-facing
-- policy is
--
--     gym_classes_read  for select using (tenant_id = my_tenant())
--
-- my_tenant() reads profiles.tenant_id, which is where the member is NOW. A
-- member who changes gyms keeps every booking and every visit they ever made —
-- both are keyed on the person, not the tenant, and part 125 argued at length
-- for keeping them that way — but loses the ability to read the classes those
-- rows point at. Proved live: member A holding one booking at their own gym and
-- one at another read TWO bookings and TWO class-linked visits, and exactly ONE
-- class row.
--
-- That is not a blank field, it is a wrong answer. `class_bookings.class_id` is
-- `not null references gym_classes(id) on delete cascade`, so a booking CANNOT
-- outlive its class: a booking whose class reads as nothing is never a deleted
-- class, it is always one being withheld. A screen showing the row unlabelled
-- says "some class, we can't say which" about a session the member attended and
-- the gym has a register for. A screen dropping the row says they did not come.
--
-- ── 2. The hole that had to be closed before the fix could be safe ──────────
--
-- The obvious policy — a member may read a class they hold a booking for — is
-- an ENUMERATION of every gym's timetable, and the reason is `class_bookings_self`
-- being `for all` rather than `for select`. Its WITH CHECK is `user_id =
-- auth.uid()` and says nothing about the class. Proved live, as a real member
-- under `set local role authenticated`:
--
--     insert into class_bookings (class_id, user_id, status, attended_at)
--     values (<a class in a gym they have never been to>, <themselves>, 'booked', now());
--     -- 1 row
--
-- Two separate harms, and only the second is about this part:
--
--   · A member can write the gym's attendance register. `attended_at` is what
--     class_attendance_summary counts, what the Studio's retention page reads
--     and what the owner's members page shows. Anyone could mark themselves
--     present at a class they did not attend, or absent from one they did, or
--     delete the record outright — and the gym has no way to see it happened.
--   · With that insert available, any policy keyed on "a class I have a booking
--     for" is a policy keyed on "a class whose id I can name", which is the
--     platform-wide timetable read 30-classes-tenant-scope.sql closed.
--
-- The member does not need the pen. Every legitimate write to their own booking
-- already goes through a SECURITY DEFINER function that bypasses RLS entirely:
-- `book_class` takes the seat (and refuses a class outside my_tenant(), which
-- is the check the raw insert skips), `cancel_class` releases it and promotes
-- the waitlist. Nothing in the client app, the coach app or the Studio inserts,
-- updates or deletes a class_bookings row as the member. So the policy is
-- narrowed to SELECT, which is what it was always doing.
--
-- Proved live under the narrowed policy: `book_class` still returns 'booked'
-- and the seat is visible to the member; `cancel_class` still releases it; and
-- the member's own UPDATE and DELETE now move ZERO rows. Zero rows, not an
-- error — PostgREST does not raise on an RLS-filtered write, which is why that
-- proof counts rows rather than trusting an exception to arrive.
drop policy if exists class_bookings_self on class_bookings;
create policy class_bookings_self_r on class_bookings
  for select using (user_id = (select auth.uid()));

-- ── 3. The class read, and why it cannot be written inline ─────────────────
--
-- A policy on `gym_classes` may not subquery `class_bookings`. class_bookings
-- carries `class_bookings_owner_r`, which itself subqueries gym_classes, so the
-- two tables' policies re-enter each other. Not a theory — the naive policy was
-- created live and the read failed with
--
--     42P17: infinite recursion detected in policy for relation "gym_classes"
--
-- which is 28-fix-profiles-recursion.sql wearing different tables. The way out
-- is the one part 32 already names: a SECURITY DEFINER helper does not re-enter
-- the table it is protecting, because RLS does not apply inside it.
--
-- Set-returning rather than a `has_attended(class)` boolean on purpose. A
-- scalar helper is called once per candidate row of gym_classes — a table that
-- holds every gym on the platform. This one is STABLE and correlated with
-- nothing outside itself, so the planner evaluates it ONCE per statement as an
-- InitPlan and the policy becomes a hash lookup.
--
-- It is the caller's history and only ever the caller's: both arms are pinned
-- to auth.uid() inside the function, which is the whole of its authority. Under
-- anon auth.uid() is null and both arms match nothing — and anon cannot reach
-- it anyway, having no EXECUTE.
create or replace function public.my_class_history()
returns setof uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select cb.class_id from class_bookings cb
   where cb.user_id = auth.uid()
  union
  select v.class_id from gym_visits v
   where v.member_id = auth.uid() and v.class_id is not null
$function$;

-- `authenticated` MUST keep EXECUTE: a policy's USING clause is evaluated as
-- the querying role, so revoking it would make gym_classes unreadable rather
-- than more private. Supabase's linter flags every such function (0029) and
-- flags 86 others in this project alongside it — is_owner_of, my_tenant,
-- book_class, class_counts. Calling it directly over /rest/v1/rpc returns the
-- caller their own class ids, which they can already list out of their own
-- class_bookings, so the exposed route discloses nothing the tables do not.
revoke execute on function public.my_class_history() from public, anon;
grant  execute on function public.my_class_history() to authenticated;

-- Additive, and narrow on the only axis that exists here: the exact set of rows
-- it admits is the classes this person has a booking for or a recorded visit
-- to. Not "classes at my gym" — that is gym_classes_read and it already covers
-- the timetable. Not "classes I could name".
--
-- The booking arm is only safe because of the narrowing above. With the member
-- unable to create a booking row, every one that exists came from `book_class`,
-- which refuses a class whose tenant is not the caller's — so a booking is now
-- proof that the class WAS the member's gym's when they took the seat, which is
-- exactly the claim this policy needs and could not previously make.
--
-- The visit arm needs no such argument: `gym_visits` has no member INSERT policy
-- at all (part 32 gives writes to `my_role() in ('trainer','owner')`), so a
-- visit row is the gym's own record of a door opening and cannot be forged by
-- the person it names.
drop policy if exists gym_classes_mine_r on gym_classes;
create policy gym_classes_mine_r on gym_classes
  for select using (id in (select public.my_class_history()));

-- The two lookups my_class_history performs. idx_class_bookings_user_id (part
-- 25) already covers the booking arm; idx_gym_visits_member (part 32) leads on
-- member_id but carries entered_at, so this pairs the member with the column
-- actually being selected and keeps the visit arm off the heap.
create index if not exists idx_gym_visits_member_class
  on public.gym_visits (member_id, class_id)
  where class_id is not null;

comment on policy gym_classes_mine_r on public.gym_classes is
  'A member may read a class they hold a booking for or have a recorded visit to, whichever gym it belongs to. gym_classes_read is scoped to my_tenant(), which is where the member is now, so a member who changes gyms kept their bookings and visits and lost every class those rows point at.';

comment on function public.my_class_history() is
  'The class ids the caller has attended or booked. SECURITY DEFINER because a policy on gym_classes cannot subquery class_bookings without recursing through class_bookings_owner_r. Reads nobody''s history but auth.uid()''s.';

-- ── Deliberately NOT done here ─────────────────────────────────────────────
--
-- 1. `gym_visits_own_r` and `class_bookings_self_r` are NOT tenant-scoped, for
--    the reason part 125 sets out for memberships and payments: `= auth.uid()`
--    is already the tightest predicate available, no row it admits belongs to
--    anyone else, and `and tenant_id = my_tenant()` would delete the attendance
--    history of the one member it distinguishes — the one who changed gyms.
--    Their old gym's record of them turning up is still a record of THEM. Which
--    gym a visit belongs to is a question for the screen, which reads tenant_id
--    off the row and says so.
--
-- 2. `gym_visits.note` stays readable by the member, because it already is.
--    Same warning as part 125 made about memberships.note: it is free text the
--    desk writes, in a row the member can read. app/(client)/attendance.tsx
--    therefore does not select it.
--
-- 3. The owner console still cannot book a walk-in onto a class.
--    `class_bookings_owner_w` is UPDATE only, there is no owner INSERT policy,
--    and `bookOnto` in src/lib/gymSchedule.ts inserts directly — so it is
--    refused today and was refused before this part. Narrowing the member's
--    policy does not touch it and does not cause it. Left alone rather than
--    fixed blind: the desk-booking path is the owner console's, not the client
--    app's, and an INSERT policy written without that screen in front of it is
--    a guess.
