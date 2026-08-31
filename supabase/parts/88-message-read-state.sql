-- Unread counts were the number 0, written into the roster by hand, on a screen
-- whose whole discipline is never to state a figure it has not read. A coach
-- looking at "Unread 0" beside a client who had messaged them was being told
-- something false in the most ordinary way possible.
--
-- `messages` is one thread per client with a `sender` role, so read state is
-- per thread per SIDE — one row each for the client and the coach — rather than
-- per message. That keeps opening a thread to a single write.
create table if not exists public.message_reads (
  client_id uuid not null references auth.users(id) on delete cascade,
  reader text not null check (reader in ('client', 'coach')),
  last_read_at timestamptz not null default now(),
  primary key (client_id, reader)
);

alter table public.message_reads enable row level security;

drop policy if exists message_reads_client on public.message_reads;
create policy message_reads_client on public.message_reads
  for all using (reader = 'client' and client_id = (select auth.uid()))
  with check (reader = 'client' and client_id = (select auth.uid()));

drop policy if exists message_reads_coach on public.message_reads;
create policy message_reads_coach on public.message_reads
  for all using (reader = 'coach' and is_my_client(client_id))
  with check (reader = 'coach' and is_my_client(client_id));

grant select, insert, update on public.message_reads to authenticated;

-- One row per client on the caller's roster, so the coach's list is one read
-- rather than one per client. A client with no read row has read nothing, which
-- is why the fallback is the epoch and not now().
create or replace function public.coach_unread_counts()
returns table (client_id uuid, unread int)
language sql stable security definer set search_path to 'public'
as $fn$
  select c.id,
         (select count(*)::int from messages m
           where m.client_id = c.id
             and m.sender = 'client'
             and m.created_at > coalesce(
                   (select r.last_read_at from message_reads r
                     where r.client_id = c.id and r.reader = 'coach'),
                   'epoch'::timestamptz))
    from clients c
   where c.trainer_id = auth.uid();
$fn$;

create or replace function public.client_unread_count()
returns int
language sql stable security definer set search_path to 'public'
as $fn$
  select count(*)::int from messages m
   where m.client_id = auth.uid()
     and m.sender = 'coach'
     and m.created_at > coalesce(
           (select r.last_read_at from message_reads r
             where r.client_id = auth.uid() and r.reader = 'client'),
           'epoch'::timestamptz);
$fn$;

-- The side is inferred rather than passed, so a caller cannot mark the other
-- person's side of the thread read.
create or replace function public.mark_thread_read(p_client uuid)
returns boolean
language plpgsql security definer set search_path to 'public'
as $fn$
declare v_role text;
begin
  if auth.uid() is null or p_client is null then return false; end if;
  if p_client = auth.uid() then
    v_role := 'client';
  elsif exists (select 1 from clients c where c.id = p_client and c.trainer_id = auth.uid()) then
    v_role := 'coach';
  else
    return false;
  end if;
  insert into message_reads (client_id, reader, last_read_at)
       values (p_client, v_role, now())
  on conflict (client_id, reader) do update set last_read_at = now();
  return true;
end $fn$;

grant execute on function public.coach_unread_counts() to authenticated;
grant execute on function public.client_unread_count() to authenticated;
grant execute on function public.mark_thread_read(uuid) to authenticated;
