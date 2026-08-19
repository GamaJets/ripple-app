-- Client approval of a delivered PT session, with the optional comment the
-- pt-sessions screen has always collected and never sent anywhere.
--
-- The approval lives in its own table rather than as columns on `sessions`
-- because `sessions_client_read` lets a client read sessions belonging to their
-- trainer. A note column on `sessions` would therefore be readable by every
-- other client of that trainer. Row-level security cannot restrict individual
-- columns, so the note gets its own table with its own policy: the client who
-- wrote it, and the trainer who delivered the session.

create table if not exists public.session_approvals (
  session_id  uuid primary key references public.sessions(id) on delete cascade,
  client_id   uuid not null references auth.users(id) on delete cascade,
  approved_at timestamptz not null default now(),
  note        text
);

alter table public.session_approvals enable row level security;

drop policy if exists session_approvals_read on public.session_approvals;
create policy session_approvals_read on public.session_approvals
  for select using (
    client_id = (select auth.uid())
    or exists (
      select 1 from public.sessions s
       where s.id = session_approvals.session_id
         and s.trainer_id = (select auth.uid())
    )
  );

-- Deliberately no insert/update/delete policies. Every write goes through
-- approve_session() so a client cannot approve on someone else's behalf, and
-- cannot reach status or trainer_id while doing it.
grant select on public.session_approvals to authenticated;

create or replace function public.approve_session(p_session uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not exists (
    select 1 from sessions s
     where s.id = p_session
       and s.client_id = auth.uid()
       and s.status = 'booked'
       and s.starts_at <= now()
  ) then
    -- Covers all three refusals: not yours, not booked, or not yet delivered.
    raise exception 'That session cannot be approved.';
  end if;

  insert into session_approvals (session_id, client_id, note)
  values (p_session, auth.uid(), v_note)
  on conflict (session_id) do update
     set note = excluded.note, approved_at = now();
end
$function$;

revoke all on function public.approve_session(uuid, text) from public;
revoke execute on function public.approve_session(uuid, text) from anon;
grant execute on function public.approve_session(uuid, text) to authenticated;

-- Unrelated to approvals, found while reading the policy: clients could read
-- every session of their trainer, including which client was booked into each
-- slot. Every client screen already filters to `available` or `mine`, so
-- narrowing this changes no UI -- it just stops other clients' rows leaving the
-- database.
drop policy if exists sessions_client_read on public.sessions;
create policy sessions_client_read on public.sessions
  for select using (
    client_id = (select auth.uid())
    or (
      status = 'available'
      and exists (
        select 1 from public.clients c
         where c.id = (select auth.uid())
           and c.trainer_id = sessions.trainer_id
      )
    )
  );
