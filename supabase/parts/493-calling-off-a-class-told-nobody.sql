-- ─────────────────────────────────────────────────────────────────────────
-- Calling off a class told the twelve people who booked it nothing at all.
--
-- `cancelClass` in src/lib/gymSchedule.ts is a plain status update, and there is
-- no trigger on `gym_classes` that writes `notifications` — the only
-- class-related notify trigger in this schema is
-- `class_bookings_notify_promoted` (part 159), which fires on a waitlist
-- promotion. So an owner cancels the 6am on a Sunday night, the confirm prompt
-- tells them the bookings are kept, and every one of those twelve people
-- arrives at a locked room on Monday. The gym finds out from the reviews.
--
-- ── Why the trigger, and not the console ─────────────────────────────────
--
-- Because the console is not the only thing that cancels a class. `cancelClass`
-- and `cancelSeriesFrom` both write the status, the trainer's own app has its
-- own path to it, and anything added later will too. A notification written by
-- the screen is one every future caller has to remember; a notification written
-- by the data cannot be missed by a screen that forgot.
--
-- It is also the pattern this schema already settled on. `gym_events` is
-- trigger-written and the compliance screen says why that is what makes it
-- worth reading: the log cannot drift from the data, because it IS the data.
--
-- ── Who is told ──────────────────────────────────────────────────────────
--
-- Everybody attached to the class, booked AND waitlisted. A waitlister has
-- arranged their morning around the chance of a place and is exactly as
-- entitled to know the class is off; and part 195's whole point is that the
-- bookings are KEPT when a class is called off, so the rows to notify are still
-- there when this fires.
--
-- The person who pressed the button is not told. They are watching it happen —
-- the same exclusion `class_promotion_notify` makes for a member who promoted
-- themselves.
--
-- ── Once, on the transition ─────────────────────────────────────────────
--
-- `when (old.status is distinct from new.status)` on the trigger, and the body
-- refuses anything that is not scheduled → cancelled. Re-saving a cancelled
-- class must not send a second round of messages about the same cancellation,
-- and `restoreClass` putting it back on must not send one at all.
--
-- Putting a class BACK is deliberately silent. Twelve people told a class is
-- off, then told it is on again, then off — that is a gym that looks like it
-- does not know what it is doing, and the honest fix is that an owner who puts
-- a class back tells the members themselves. A notification saying "actually it
-- is on" cannot be trusted to arrive before somebody has already made other
-- plans.
--
-- ── The reason is passed on, when there is one ───────────────────────────
--
-- `cancel_reason` is what the owner typed, and it goes in the message: "the
-- coach is ill" and "the room flooded" are different conversations for the
-- member, and a cancellation with no reason reads as one the gym could not be
-- bothered to explain. It is truncated with the rest of the body at 500, the
-- same ceiling part 159 uses.
--
-- Additive only. One function, one trigger, no table and no policy changed.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.class_cancelled_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_when text;
  v_why  text;
begin
  -- Only the transition ONTO cancelled. Not a re-save, and not a restore.
  if not (coalesce(old.status, 'scheduled') <> 'cancelled'
          and new.status = 'cancelled') then
    return new;
  end if;

  -- The member's own clock is the client screen's job; what a notification can
  -- honestly say is which class, on which day, in the gym's own words.
  v_when := to_char(new.starts_at, 'FMDay FMDD FMMon at HH24:MI');
  v_why := nullif(btrim(coalesce(new.cancel_reason, '')), '');

  insert into public.notifications (user_id, title, body, icon, route)
  select
    cb.user_id,
    'A class you booked is not running',
    left(
      '“' || coalesce(nullif(btrim(new.title), ''), 'A class') || '” on ' || v_when
      || ' has been called off'
      || coalesce(': ' || v_why, '')
      || '. '
      || case when cb.status = 'waitlist'
              then 'You were on the waiting list for it, so there is nothing to cancel.'
              else 'Your booking is kept on the record and there is nothing for you to do.'
         end
      || ' Your Classes screen has the rest of the timetable.',
      500)
    ,
    'calendar',
    '/(client)/classes'
  from public.class_bookings cb
  where cb.class_id = new.id
    -- The person who called it off is watching it happen.
    and cb.user_id is distinct from auth.uid();

  return new;
end;
$function$;

comment on function public.class_cancelled_notify() is
  'Writes one inbox row to every member booked or waitlisted on a class at the moment it is called off, excluding whoever called it off. Fires only on the transition onto cancelled, so a re-save sends nothing and a restore sends nothing. See part 493.';

drop trigger if exists gym_classes_notify_cancelled on public.gym_classes;
create trigger gym_classes_notify_cancelled
  after update of status on public.gym_classes
  for each row
  when (old.status is distinct from new.status)
  execute function public.class_cancelled_notify();

revoke all on function public.class_cancelled_notify() from public;
revoke all on function public.class_cancelled_notify() from anon;
revoke all on function public.class_cancelled_notify() from authenticated;
