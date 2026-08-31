-- book_session updated nothing when the slot was already taken, or when the
-- caller is not that trainer's client, and said nothing about it: an UPDATE
-- matching zero rows is not an error, and the function returned void, so the
-- app could not tell a booking from a refusal. It returns whether a row was
-- actually booked, and src/ui/sessions.tsx believes that rather than `!error`.
--
-- Before this, a client who tapped a slot somebody else had just taken got a
-- booked-looking calendar, a "session in 1 hour" reminder for a session that
-- did not exist, and a credit drawn off their pack.
drop function if exists public.book_session(uuid);

create function public.book_session(p_session uuid)
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
end $fn$;

grant execute on function public.book_session(uuid) to authenticated;
