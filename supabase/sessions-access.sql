-- Repple sessions/bookings access. A trainer manages their own slots; a client
-- reads their coach's slots + their own bookings, and books/cancels via RPCs
-- (SECURITY DEFINER, so no broad client UPDATE grant is needed).
-- Depends on schema.sql (sessions, clients). Idempotent; safe to re-run.

alter table sessions enable row level security;

drop policy if exists sessions_trainer on sessions;
create policy sessions_trainer on sessions for all
  using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());

drop policy if exists sessions_client_read on sessions;
create policy sessions_client_read on sessions for select
  using (
    client_id = auth.uid()
    or exists (select 1 from clients c where c.id = auth.uid() and c.trainer_id = sessions.trainer_id)
  );

create or replace function book_session(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update sessions set client_id = auth.uid(), status = 'booked', released = false
   where id = p_session and status = 'available'
     and exists (select 1 from clients c where c.id = auth.uid() and c.trainer_id = sessions.trainer_id);
end $$;

create or replace function cancel_session(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update sessions set client_id = null, status = 'available', released = true
   where id = p_session and client_id = auth.uid();
end $$;
