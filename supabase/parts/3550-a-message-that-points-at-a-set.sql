-- A message that points at a workout or a form check.
--
-- The thread already carries text, photos, video, voice and files (parts 124,
-- 3360), live over Realtime, pushed by notify_on_message and gated by the
-- Chat switch and quiet hours. What neither side could do was say "THIS
-- session" or "THIS clip" without describing it in words. A reference is two
-- nullable columns, not a copy: the card is drawn from the row it names, so it
-- can never disagree with the log, and it shows nothing once that row is gone.
--
-- The guard: a reference may only name a row belonging to the thread's own
-- client. Without it a coach could reference another client's workout id in
-- this thread — RLS would still stop the read, but the id would sit in a
-- thread it has nothing to do with.
--
-- Additive only: two columns, two checks, one trigger function.

alter table public.messages add column if not exists ref_kind text;
alter table public.messages add column if not exists ref_id uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'messages_ref_kind_chk') then
    alter table public.messages add constraint messages_ref_kind_chk
      check (ref_kind is null or ref_kind in ('workout', 'form_clip'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'messages_ref_pair_chk') then
    alter table public.messages add constraint messages_ref_pair_chk
      check ((ref_kind is null) = (ref_id is null));
  end if;
end $$;

comment on column public.messages.ref_kind is 'What ref_id names: a workouts row or a form_clips row of this thread''s client (part 3550).';

create or replace function public.message_ref_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if new.ref_kind is null then
    return new;
  end if;
  if new.ref_kind = 'workout' and not exists (
       select 1 from public.workouts w where w.id = new.ref_id and w.user_id = new.client_id) then
    raise exception 'That workout is not part of this conversation.' using errcode = '42501';
  end if;
  if new.ref_kind = 'form_clip' and not exists (
       select 1 from public.form_clips f where f.id = new.ref_id and f.user_id = new.client_id) then
    raise exception 'That form check is not part of this conversation.' using errcode = '42501';
  end if;
  return new;
end $fn$;

revoke all on function public.message_ref_guard() from public, anon, authenticated;

drop trigger if exists messages_ref_guard on public.messages;
create trigger messages_ref_guard
  before insert or update of ref_kind, ref_id on public.messages
  for each row execute function public.message_ref_guard();
