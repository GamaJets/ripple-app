-- The same defect book_session had. cancel_session returned void and updated
-- nothing when the caller was not the client holding the booking, so
-- releaseSession's `!error` reported a cancellation that never happened as
-- done. That is worse here than it was for booking: the screen goes on to tell
-- every other client on that coach's book that a slot just opened, and the slot
-- is still booked — so the quickest of them to respond is the one turned away.
drop function if exists public.cancel_session(uuid);

create function public.cancel_session(p_session uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_rows int;
begin
  update sessions set client_id = null, status = 'available', released = true
   where id = p_session and client_id = auth.uid();
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $fn$;

grant execute on function public.cancel_session(uuid) to authenticated;
