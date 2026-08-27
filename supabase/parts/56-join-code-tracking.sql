-- ─────────────────────────────────────────────────────────────────────────
-- Knowing where a client came from, and being able to change a code.
--
-- 55-coach-join-code.sql shipped the code itself and tracked almost nothing
-- about it. Asked "how do you track them?", the honest answer was: barely.
-- Three things were missing and one was wrong.
--
--   1. A request created by spending a code was indistinguishable from one
--      sent from the directory. So "is the code working?" — the first question
--      anybody asks about a referral mechanism — had no answer.
--
--   2. There was no way to change a code. A code read aloud in a gym, printed
--      on a card and texted to twenty people is not a secret, and the moment a
--      coach wants a new one there was nothing to give them.
--
--   3. `mode` was hardcoded 'inperson'. An online-only coach had every client
--      who used their code marked as training in person, which is wrong on the
--      client's own profile and wrong in the coach's roster.
--
-- The code is recorded ON THE REQUEST as well as on the trainer, because codes
-- rotate: the code a client actually typed is a fact about that moment, and
-- reading it back off `trainers` after a rotation would report a code that
-- client never saw.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.coach_requests
  add column if not exists source    text,
  add column if not exists via_code  text;

comment on column public.coach_requests.source is
  'How this request was made: ''code'', ''directory'', or null for rows predating this column.';
comment on column public.coach_requests.via_code is
  'The code as it stood when it was spent. Codes rotate; this does not.';

-- Null is honest for the rows that already exist: they were created before
-- anything recorded a source, and backfilling them with a guess would make
-- fabricated data indistinguishable from measured data.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'coach_requests_source_ck'
  ) then
    alter table public.coach_requests
      add constraint coach_requests_source_ck
      check (source is null or source in ('code', 'directory'));
  end if;
end $$;

-- The one-argument version MUST go first.
--
-- Adding a defaulted parameter does not replace a function in Postgres, it
-- OVERLOADS it: join_by_code(text) and join_by_code(text, text default) would
-- both exist, and the app's existing one-argument call becomes ambiguous —
-- "function join_by_code(text) is not unique" — which breaks joining entirely
-- for everyone until somebody notices.
drop function if exists public.join_by_code(text);

/**
 * Join a coach by code, recording how and with which code.
 *
 * `p_mode` comes from the client — they know whether their coach trains them in
 * person or online, and the previous version simply asserted 'inperson'.
 * Anything unrecognised falls back to 'online', which is the safer default: a
 * client wrongly marked online sees a slightly thinner set of features, while
 * one wrongly marked in-person appears on an in-person roster for sessions
 * nobody is going to run.
 */
create or replace function public.join_by_code(p_code text, p_mode text default 'online')
returns table (trainer_id uuid, trainer_name text, already boolean)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  t_id uuid;
  t_name text;
  t_code text;
  existing boolean;
  mode_in text := case when p_mode = 'inperson' then 'inperson' else 'online' end;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  select tr.id, tr.join_code into t_id, t_code
  from public.trainers tr
  where tr.join_code is not null
    and upper(tr.join_code) = upper(btrim(coalesce(p_code, '')));

  if t_id is null then
    raise exception 'no coach uses that code';
  end if;

  if t_id = uid then
    raise exception 'that is your own code';
  end if;

  select coalesce(nullif(btrim(p.full_name), ''), 'Your coach') into t_name
  from public.profiles p where p.id = t_id;

  select exists (
    select 1 from public.coaching_relationships r
    where r.coach_id = t_id and r.client_id = uid
  ) or exists (
    select 1 from public.coach_requests q
    where q.trainer_id = t_id and q.client_id = uid and q.status = 'pending'
  ) into existing;

  if not existing then
    insert into public.coach_requests (client_id, trainer_id, mode, status, source, via_code)
    values (uid, t_id, mode_in, 'pending', 'code', upper(t_code));
  end if;

  return query select t_id, coalesce(t_name, 'Your coach'), existing;
end; $$;

/**
 * Issue the signed-in coach a new code, retiring the old one immediately.
 *
 * Requests already made with the old code keep it in `via_code`, so rotating
 * does not rewrite the history of who arrived how.
 */
create or replace function public.rotate_join_code()
returns text language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  code text;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if not exists (select 1 from public.trainers where id = uid) then
    raise exception 'no trainer profile for this account';
  end if;
  code := public.generate_join_code();
  update public.trainers set join_code = code where id = uid;
  return code;
end; $$;

/** How many people have joined this coach by code, and how many are waiting. */
create or replace function public.my_join_code_stats()
returns table (joined bigint, pending bigint)
language sql security definer stable set search_path = public as $$
  select
    count(*) filter (where q.status = 'accepted') as joined,
    count(*) filter (where q.status = 'pending')  as pending
  from public.coach_requests q
  where q.trainer_id = (select auth.uid()) and q.source = 'code';
$$;

grant execute on function public.join_by_code(text, text) to authenticated;
grant execute on function public.rotate_join_code() to authenticated;
grant execute on function public.my_join_code_stats() to authenticated;
