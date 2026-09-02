-- ─────────────────────────────────────────────────────────────────────────
-- A member who phones up or walks in could not be put on a class register.
--
-- `bookOnto` has been in src/lib/gymSchedule.ts since the class screens were
-- built and has never had a caller. supabase/parts/136 says why, in its own
-- closing note: `class_bookings_owner_w` is UPDATE only, there is no INSERT
-- policy for staff, and `bookOnto` inserts directly — "so it is refused today
-- and was refused before this part … Left alone rather than fixed blind: an
-- INSERT policy written without that screen in front of it is a guess."
--
-- The screen is now in front of it. This is the answer, and it is deliberately
-- not the INSERT policy that note contemplated.
--
-- ── Why a function and not a policy ─────────────────────────────────────
--
-- Because capacity lives inside `book_class` and nowhere else. There is no
-- constraint, no trigger and no index that stops a class of twelve taking a
-- thirteenth booking as `booked` — `book_class` counts under a row lock and
-- writes 'waitlist' when the class is full, and it is the ONLY thing that does.
-- An INSERT policy would let the front desk write `status: 'booked'` straight
-- past that, so the first walk-in booked at the desk would over-sell a full
-- class silently, and the waiting list the member app maintains would be
-- bypassed by the very screen that promotes people off it.
--
-- So this is `book_class` with one difference: it books the person the DESK
-- names rather than `auth.uid()`. Everything else — the row lock, the count,
-- the choice between booked and waitlist — is the same logic for the same
-- reason.
--
-- ── What makes a SECURITY DEFINER function safe here ────────────────────
--
-- The tenant is DERIVED, never accepted. It is read off the class, and the
-- caller is then checked against it: `my_tenant()` must match and `my_role()`
-- must be trainer or owner. A definer function that takes a tenant id from its
-- caller is the exact bug 35-class-capacity-and-scope.sql was written to fix.
--
-- The member is checked too, and this is the part that would be easy to leave
-- out. Without it a member of staff could book ANY uuid onto their class —
-- another gym's member, or a person who has no relationship with this business
-- at all — and that row would then appear on that person's own attendance
-- screen. So p_user must hold a membership in the same tenant. The console's
-- picker is fed from exactly that table, so nothing legitimate is refused.
--
-- ── A member already on the class ───────────────────────────────────────
--
-- Returns their CURRENT status and changes nothing. `book_class` uses
-- `on conflict … do update set status = excluded.status`, which is right for a
-- member re-booking themselves and wrong here: a desk clicking twice on a class
-- that filled up in between would demote somebody who already holds a
-- confirmed place to the waiting list. A place already given is not taken back
-- by a second click.
--
-- Additive only. It adds one function; it changes no table, no policy and no
-- existing function, and it widens nobody's read of anything.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.book_class_for(p_class uuid, p_user uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_cap int;
  v_count int;
  v_status text;
  v_existing text;
begin
  -- The lock comes first, exactly as it does in `book_class`: the count below
  -- is only capacity-safe if nothing else can book between reading it and
  -- writing.
  perform 1 from gym_classes where id = p_class for update;

  select gc.tenant_id, gc.capacity into v_tenant, v_cap
    from gym_classes gc where gc.id = p_class;
  if v_tenant is null then
    -- A class with no tenant is unscoped, and unscoped fails closed — the same
    -- position part 165 took on the staff read policy.
    return 'notfound';
  end if;

  if not (v_tenant = my_tenant() and my_role() in ('trainer', 'owner')) then
    raise exception 'Only this gym''s staff can book somebody onto its classes.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from memberships m
     where m.tenant_id = v_tenant and m.member_id = p_user
  ) then
    raise exception 'That person is not on this gym''s roster, so they cannot be put on its register.'
      using errcode = 'foreign_key_violation';
  end if;

  select cb.status into v_existing
    from class_bookings cb
   where cb.class_id = p_class and cb.user_id = p_user;
  if v_existing is not null then
    -- Already on it. Their place is not re-decided by a second click.
    return v_existing;
  end if;

  select count(*) into v_count
    from class_bookings where class_id = p_class and status = 'booked';
  v_status := case when v_count < coalesce(v_cap, 0) then 'booked' else 'waitlist' end;

  insert into class_bookings (class_id, user_id, status)
  values (p_class, p_user, v_status);

  return v_status;
end $$;

revoke all on function public.book_class_for(uuid, uuid) from public;
revoke all on function public.book_class_for(uuid, uuid) from anon;
grant execute on function public.book_class_for(uuid, uuid) to authenticated;

comment on function public.book_class_for(uuid, uuid) is
  'Puts a named member on a class from the front desk — the walk-in and the phone booking. Capacity-safe under a row lock, exactly like book_class, and returns ''booked'', ''waitlist'' or ''notfound''. The tenant is derived from the class and never accepted from the caller; the caller must be trainer or owner of it, and the member must hold a membership in it. See part 492.';
