-- "No double booking" was, until now, one client-side check: addSession() calls
-- overlaps() against whatever sessions that screen happens to be holding. Two
-- devices, a stale screen, or two clients tapping in the same second all defeat
-- it, and nothing in the database ever said no. A trainer cannot be in two
-- places at once, so the database says it now.
create extension if not exists btree_gist;

-- Postgres marks `timestamptz + interval` STABLE rather than IMMUTABLE, because
-- an interval carrying months or days depends on the session's time zone. A
-- span of N minutes carries neither: it is plain seconds, and adding it to an
-- absolute instant gives the same absolute instant in every time zone. Pinning
-- that here is what lets the span be indexed.
create or replace function public.session_span(p_starts_at timestamptz, p_duration_min int)
returns tstzrange
language sql
immutable
set search_path to 'public'
as $fn$
  select tstzrange(p_starts_at, p_starts_at + make_interval(mins => p_duration_min), '[)')
$fn$;

-- Booked sessions only. Two OPEN slots may overlap on purpose — offering 10:00
-- or 10:30 and letting the client pick is normal — but only one of them can ever
-- be taken, because the moment one is booked the other cannot be.
alter table public.sessions drop constraint if exists sessions_no_double_booking;
alter table public.sessions add constraint sessions_no_double_booking
  exclude using gist (
    trainer_id with =,
    session_span(starts_at, duration_min) with &&
  ) where (status = 'booked');

-- book_session reports a clash the same way it reports a slot somebody else
-- already took: false, not an exception. Both mean "you did not get it", and the
-- client screen has one honest sentence for that.
create or replace function public.book_session(p_session uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_rows int;
begin
  update sessions set client_id = auth.uid(), status = 'booked', released = false
   where id = p_session and status = 'available'
     and exists (select 1 from clients c where c.id = auth.uid() and c.trainer_id = sessions.trainer_id);
  get diagnostics v_rows = row_count;
  return v_rows > 0;
exception
  when exclusion_violation then return false;
end $fn$;

grant execute on function public.book_session(uuid) to authenticated;
