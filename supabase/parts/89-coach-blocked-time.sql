-- A coach marking time they are NOT available. `sessions.status` has allowed
-- 'blocked' since the first schema and nothing has ever written it; this makes
-- it mean something.
--
-- A blocked row is invisible to clients by construction: the client read policy
-- exposes `status = 'available'` plus their own bookings, and a block is neither.

-- The double-booking guarantee now covers blocked time too, so the database —
-- not the app — is what stops a client booking across a coach's holiday.
alter table public.sessions drop constraint if exists sessions_no_double_booking;
alter table public.sessions add constraint sessions_no_double_booking
  exclude using gist (
    trainer_id with =,
    session_span(starts_at, duration_min) with &&
  ) where (status in ('booked', 'blocked'));

-- Blocking a period has to do two things at once, or it does neither honestly:
-- put the block down, and withdraw the open slots inside it. Leaving those
-- offers up would show clients a bookable time the server then refuses — the
-- app advertising something it will not honour.
--
-- A BOOKED session in the way is never silently removed. Somebody has arranged
-- to be there, so this refuses and says so, and the coach cancels it themselves
-- — which notifies the client, as cancelling should.
create or replace function public.block_time(p_starts_at timestamptz, p_duration_min int)
returns table (ok boolean, withdrawn int, reason text)
language plpgsql security definer set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_withdrawn int := 0;
  v_clash int := 0;
begin
  if v_uid is null then
    return query select false, 0, 'not-signed-in'::text; return;
  end if;
  if p_duration_min is null or p_duration_min <= 0 then
    return query select false, 0, 'bad-duration'::text; return;
  end if;

  select count(*) into v_clash
    from sessions s
   where s.trainer_id = v_uid
     and s.status = 'booked'
     and session_span(s.starts_at, s.duration_min) && session_span(p_starts_at, p_duration_min);
  if v_clash > 0 then
    return query select false, 0, 'booked'::text; return;
  end if;

  delete from sessions s
   where s.trainer_id = v_uid
     and s.status = 'available'
     and session_span(s.starts_at, s.duration_min) && session_span(p_starts_at, p_duration_min);
  get diagnostics v_withdrawn = row_count;

  insert into sessions (trainer_id, client_id, starts_at, duration_min, status, released)
  values (v_uid, null, p_starts_at, p_duration_min, 'blocked', false);

  return query select true, v_withdrawn, null::text;
end $fn$;

grant execute on function public.block_time(timestamptz, int) to authenticated;
