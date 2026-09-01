-- ═══════════════════════════════════════════════════════════════════════════
-- A coach cannot take the register for the class they are standing in.
--
-- `class_bookings` carries exactly two policies that matter here, and between
-- them they lock every coach out of the one row the gym is measured on:
--
--   class_bookings_owner_r   select   the class's tenant owner        (part 30)
--   class_bookings_owner_w   update   the class's tenant owner        (part 30)
--   class_bookings_self_r    select   user_id = auth.uid()            (part 136)
--
-- A trainer is none of those. So for a coach:
--
--   · `fetchRoster` — `select … from class_bookings where class_id = …` —
--     returns ZERO ROWS AND NO ERROR. The console's register renders its empty
--     state, which reads "Nobody booked this class. That is a fill problem, not
--     a register one", to a coach looking at fourteen people.
--   · `fetchClasses` counts bookings per class from the same table, so every
--     class on the board reports 0 booked and 0 attended. A false figure, not a
--     blank one — the exact shape that module's own comments spend forty lines
--     guarding against elsewhere.
--   · `setAttendance` updates the row directly. `class_bookings_owner_w` is the
--     only UPDATE policy, so a coach's tick matches zero rows and returns no
--     error. `assertWrote` is what turns that silence into a sentence, and it
--     is the reason the tick reports a refusal instead of appearing to save.
--
-- RLS FILTERS, it does not refuse. Every one of those is an ordinary empty
-- result with `error: null`, which is why none of it has ever appeared in a log.
--
-- ── Why this was survivable until now, and is not any more ────────────────
--
-- The phone app does not touch the table. `set_class_attendance` (part 25) is
-- SECURITY DEFINER and guards on `gc.trainer_id = auth.uid()`, so a coach's own
-- class works there and only there. That single surface —
-- app/(trainer)/class-checkin.tsx, on a phone, for a class the coach is
-- recorded against — has been the entire register for this product.
--
-- studio-web now admits staff to /timetable so a register can be taken at the
-- desk. Without this part that screen would offer a Check in button on a roster
-- that always renders empty, which is worse than not offering it.
--
-- ── Scope: the gym's staff, not just the class's own coach ────────────────
--
-- The obvious narrow policy is `gc.trainer_id = auth.uid()`, matching part 25's
-- RPC. It is the wrong line here, for three reasons:
--
--  1. Cover. Classes are covered — illness, holiday, a swap arranged in the
--     group chat — and the person standing in the room is the person who knows
--     who turned up. A register only the named coach can take is a register
--     that does not get taken on precisely the days it is hardest to
--     reconstruct afterwards.
--  2. Every class already on the board has `trainer_id` NULL. studio-web's Add
--     a class wrote free-text `instructor` and never the id, so a
--     trainer_id-scoped policy would match no existing class for anybody.
--  3. The board a coach reads is gym-wide — `gym_classes_read` is
--     `tenant_id = my_tenant()` — so a per-coach booking read would leave every
--     colleague's class showing 0 booked. A false figure beside a true one is
--     worse than either.
--
-- This is the same line `gym_visits_staff_rw` already draws on the door log,
-- and for the same reason stated there: working the door is staff work. Who
-- booked a class is not more sensitive than who walked into the building, and
-- staff can already read the second.
--
-- Members are unaffected: `class_bookings_self_r` is untouched and nothing here
-- widens what a client can see. Neither INSERT nor DELETE is granted — booking
-- and cancelling stay with the member through `book_class` / `cancel_class`,
-- and an owner still has no INSERT policy either (part 136 notes that
-- deliberately). This adds a read and an attendance write, and nothing else.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── the read ────────────────────────────────────────────────────────────────
-- Scoped through the class's own tenant rather than through trainers, the same
-- way part 30 rescoped the owner's read: a class with no trainer assigned still
-- belongs to a gym, and a row whose tenant_id is null is invisible to this
-- rather than visible to everyone. Unscoped fails closed.
drop policy if exists class_bookings_staff_r on public.class_bookings;
create policy class_bookings_staff_r on public.class_bookings
  for select using (exists (
    select 1 from public.gym_classes gc
    where gc.id = class_bookings.class_id
      and gc.tenant_id = my_tenant()
      and my_role() in ('trainer', 'owner')
  ));

-- ── the register ────────────────────────────────────────────────────────────
-- UPDATE only, and `with check` repeats the `using` clause so a staff member
-- cannot move a booking to a class in another gym on the way past.
--
-- This grants UPDATE on the whole ROW, not on `attended_at` alone — PostgreSQL
-- policies choose rows, and column privileges are the other mechanism. The
-- table-wide UPDATE grant `authenticated` already holds is what makes that so,
-- and narrowing it here would mean revoking the table privilege and granting
-- back a column list for every writer of this table — the shape part 151 spent
-- a whole file untangling. The practical exposure is `status`: a staff member
-- could promote a waitlister by hand. That is a thing a front desk does anyway
-- (`promote_from_waitlist` exists), it is audited by nothing either way, and it
-- is a smaller risk than a class nobody can register.
drop policy if exists class_bookings_staff_u on public.class_bookings;
create policy class_bookings_staff_u on public.class_bookings
  for update using (exists (
    select 1 from public.gym_classes gc
    where gc.id = class_bookings.class_id
      and gc.tenant_id = my_tenant()
      and my_role() in ('trainer', 'owner')
  )) with check (exists (
    select 1 from public.gym_classes gc
    where gc.id = class_bookings.class_id
      and gc.tenant_id = my_tenant()
      and my_role() in ('trainer', 'owner')
  ));

-- The lookup both policies make, on every row they are evaluated against.
-- `gym_classes` is already indexed on (tenant_id, starts_at) by part 30 and has
-- a primary key on id, so the `gc.id = … and gc.tenant_id = …` probe is an
-- index scan; there is nothing to add. Noted rather than left to be rediscovered
-- by whoever reads the plan next.
