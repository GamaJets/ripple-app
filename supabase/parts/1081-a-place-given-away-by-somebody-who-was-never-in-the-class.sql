-- ═══════════════════════════════════════════════════════════════════════════
-- A place given away by somebody who was never in the class.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────
--
-- `cancel_class(p_class)` is two statements. The first is correctly scoped and
-- always has been:
--
--     delete from class_bookings where class_id = p_class and user_id = auth.uid();
--
-- The second is not scoped to anything:
--
--     update class_bookings set status = 'booked'
--      where id = (select cb.id from class_bookings cb
--                    join gym_classes gc on gc.id = cb.class_id
--                   where cb.class_id = p_class and cb.status = 'waitlist'
--                     and (select count(*) ...) < gc.capacity
--                   order by cb.created_at asc limit 1);
--
-- Nothing connects the two. The promotion does not ask whether the delete above
-- it removed a row, whether the caller was in the class, or whether the caller
-- has anything to do with the gym that owns it. It runs on every call. Because
-- the function is SECURITY DEFINER, the `class_bookings` and `gym_classes`
-- policies that would otherwise have stopped a stranger never run.
--
-- Its own sibling, twenty lines away, shows what the missing check looks like.
-- `book_class(p_class)` reads the class's tenant and refuses:
--
--     -- A class outside your gym is indistinguishable from one that is not there.
--     if v_tenant is distinct from my_tenant() then return 'notfound'; end if;
--
-- One of the pair guards the gym boundary deliberately and says why. The other
-- does not test anything at all.
--
-- ── THE INVARIANT THE APPLICATION WROTE DOWN TWICE ───────────────────────
--
-- This is not a subtlety nobody had considered. Two files in `studio-web` state
-- the property as settled fact, and both are wrong about it.
--
--   studio-web/app/classes/page.tsx:1126
--     "`cancel_class` only promotes when the MEMBER cancels from their own
--      phone, so every case the gym handles — the phone call, the no-show, the
--      coach who says one more can squeeze in — had no path at all."
--
--   studio-web/app/timetable/page.tsx:1380
--     "Automatic promotion only fires when the MEMBER cancels from their own
--      app, because `cancel_class` deletes `where user_id = auth.uid()`."
--
-- The second sentence names the exact reasoning error: the DELETE is scoped to
-- `auth.uid()`, and the conclusion drawn is about the UPDATE, which is not. A
-- whole feature was then built on the belief — `promoteFromWaitlist()` and
-- `returnToWaitlist()` in src/lib/gymSchedule.ts, and the register buttons that
-- call them — because the console could not otherwise give a waiting member a
-- place. Those are the authorised path, they go through RLS as the invoker, and
-- this file does not touch them.
--
-- ── WHAT SOMEBODY COULD DO WITH ONE UUID ─────────────────────────────────
--
-- A signed-in account with a class id from a gym it has never belonged to calls
-- `cancel_class` on it. The delete matches nothing. The promotion then moves the
-- longest-waiting member of that class from 'waitlist' to 'booked'. Repeating
-- the call walks the queue one person per call until the class is at capacity.
--
-- Class ids travel: they are on the timetable every member of that gym reads,
-- they are the `class_id` on `gym_visits` and on `class_bookings`, and
-- `my_class_history()` hands a member their own back. The caller needs one, and
-- needs nothing else.
--
-- The damage is not overbooking — the `< gc.capacity` test holds, so no seat is
-- created that does not exist. It is that the decision about WHO gets a place,
-- and WHEN, is taken by somebody with no relationship to the gym, at a moment
-- the gym did not choose, on rows belonging to people it cannot see. A promoted
-- row is a booked seat: it is what `class_roster` shows the coach at the door,
-- what `class_attendance_summary` counts, and what the member is marked absent
-- against if they do not turn up to a class they were never told they were in.
-- The gym's own undo for a promotion given to the wrong person is
-- `returnToWaitlist()`, and its comment — "a promotion onto the wrong person's
-- row is a place given away" — is the right description of the harm.
--
-- ── THE SAME LINE IS ALSO A PLAIN BUG ────────────────────────────────────
--
-- Ungated, the promotion also fires for the legitimate caller in a case where
-- no place came free. src/ui/classes.tsx calls `cancel_class` for both of a
-- member's states — its own `was` variable is 'booked' or 'waitlist' — so a
-- member leaving the WAITING LIST promotes the next person behind them into a
-- seat that nobody vacated. That is a seat given away against a cancellation
-- that never freed one, and it is the ordinary, everyday path.
--
-- ── WHY THE FIX IS SHAPED THIS WAY ───────────────────────────────────────
--
-- The promotion is gated on what the caller actually gave up, taken from the
-- delete itself via `returning`. Not on a tenant test, and the choice is
-- deliberate: `my_tenant()` would keep a stranger out but would still leave a
-- member of the RIGHT gym able to shuffle a class they are not in, and would
-- still promote on a cancelled waitlist entry. The question that decides this
-- correctly is not "may this caller see the class" but "did this call free a
-- seat", and only one statement knows the answer.
--
--     v_was is null      → the caller had no booking. Nothing was freed.
--     v_was = 'waitlist' → they left the queue. Nothing was freed.
--     v_was = 'booked'   → a place came free, and the queue moves.
--
-- Written as `is distinct from 'booked'` so the null case and any future status
-- fall on the same side, which is the side that does nothing.
--
-- `returning ... into` on a DELETE rather than a second SELECT: the row is gone
-- by the time anything could re-read it, and re-reading before the delete would
-- reintroduce the gap between deciding and acting that this file is closing.
-- The delete matches at most one row — `class_bookings` is unique on
-- (class_id, user_id), which is the same constraint `book_class`'s
-- `on conflict (class_id, user_id)` relies on — so a single scalar `into` is
-- exact rather than arbitrary.
--
-- The promotion statement itself is copied through unchanged, including the
-- capacity test and the `order by cb.created_at asc` that makes the queue FIFO.
--
-- ── WHAT THIS CHANGES FOR SCREENS THAT EXIST ─────────────────────────────
--
-- Established by reading every caller of `cancel_class` in the repository:
-- src/ui/classes.tsx:384 is the only one. `studio-web` calls neither
-- `cancel_class` nor `book_class` anywhere — timetable/page.tsx:1375 says so
-- outright — and the console's promote and demote buttons go through
-- `promoteFromWaitlist` / `returnToWaitlist`, which write `class_bookings`
-- directly under RLS and are untouched by this file.
--
--   · A member cancelling a BOOKED seat: identical. This is the path the two
--     console comments describe, and it is the one that keeps working.
--   · A member cancelling a WAITLIST entry: their row is still deleted, and the
--     spurious promotion described above no longer happens. This is a fix, not
--     a regression — there was no free place to give.
--   · Anybody else: the call still returns void without error, and now writes
--     nothing.
--
-- The signature and return type are character-for-character the live ones. An
-- overload would leave PostgREST unable to resolve `cancel_class` at all.
--
-- Idempotent and safe to re-run: `create or replace function` replaces the body
-- in place. It reads no rows and writes no data.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.cancel_class(p_class uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_was text;
begin
  -- Unchanged, and the only statement here that was ever scoped to the caller.
  -- `returning` is new: what this row's status WAS is the fact the promotion
  -- below has to be decided on, and after the delete there is nowhere else to
  -- read it from. At most one row matches — `class_bookings` is unique on
  -- (class_id, user_id) — so the scalar is exact.
  delete from class_bookings
   where class_id = p_class and user_id = auth.uid()
  returning status into v_was;

  -- THE GATE THAT WAS MISSING. See the header: without it this UPDATE runs on
  -- every call from every account, so a signed-in stranger holding one class id
  -- could walk another gym's waiting list into its seats one call at a time,
  -- and a member leaving the queue promoted somebody into a place that had not
  -- come free.
  --
  -- `is distinct from` so that the null case — the caller had no booking in
  -- this class at all — lands here with 'waitlist' rather than falling through
  -- a plain equality test on null.
  if v_was is distinct from 'booked' then
    return;
  end if;

  -- Unchanged from here down, capacity test and FIFO order included.
  update class_bookings set status = 'booked'
   where id = (
     select cb.id from class_bookings cb join gym_classes gc on gc.id = cb.class_id
     where cb.class_id = p_class and cb.status = 'waitlist'
       and (select count(*) from class_bookings b where b.class_id = p_class and b.status = 'booked') < gc.capacity
     order by cb.created_at asc limit 1
   );
end; $function$;
