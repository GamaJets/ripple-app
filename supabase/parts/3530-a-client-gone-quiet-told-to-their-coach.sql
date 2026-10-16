-- A client gone quiet, told to their coach.
--
-- The coach's Today queue already colours a drifting client (src/lib/adherence
-- drift), but only for a coach who opens the app. This is the push half: once a
-- day, at the coach's 09:00 local (claim_notice_pass, part 1890), a coach hears
-- about clients with no logged workout in 3+ days.
--
-- ── once per stretch, not once per day ────────────────────────────────────
--
-- A stretch of inactivity is identified by the client's last workout instant.
-- coach_quiet_client_flags holds one row per (coach, client, last workout);
-- the unique key is the dedupe. A client quiet for three weeks is flagged once.
-- When they train again their last-workout instant moves, and the NEXT quiet
-- stretch is a new key, so it can be flagged again.
--
-- Clients who have never logged a workout are not flagged: that is onboarding,
-- which the coach's setup queue already covers, not inactivity.
--
-- Push: one notifications row per coach per run on '/(trainer)/dashboard' or
-- '/(trainer)/client-training' — both map to the coach's 'clients' channel in
-- notification_channel, so part 900's dispatcher and send-push apply the
-- coach's switch and quiet hours. The row carries a name and a day count,
-- nothing about health.
--
-- Additive only: one new table (definer-read only), two functions, one cron.

create table if not exists public.coach_quiet_client_flags (
  id              bigserial primary key,
  coach_id        uuid not null references auth.users(id) on delete cascade,
  client_id       uuid not null references auth.users(id) on delete cascade,
  last_workout_at timestamptz not null,
  flagged_at      timestamptz not null default now(),
  unique (coach_id, client_id, last_workout_at)
);

create index if not exists coach_quiet_client_flags_client_idx
  on public.coach_quiet_client_flags (client_id);

alter table public.coach_quiet_client_flags enable row level security;
revoke all on table public.coach_quiet_client_flags from public, anon, authenticated;
revoke all on sequence public.coach_quiet_client_flags_id_seq from public, anon, authenticated;

comment on table public.coach_quiet_client_flags is
  'One row per client inactivity stretch already told to their coach (part 3530). The stretch is keyed by the client''s last workout instant, so a client is flagged at most once until they train again. Read through coach_quiet_clients(); no direct grants.';

create or replace function public.run_coach_quiet_client_nudges()
returns integer
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_due   uuid[];
  v_sent  int := 0;
  v_n     int;
  v_first uuid;
  r       record;
begin
  select public.claim_notice_pass(
           'quiet-clients',
           coalesce(array_agg(distinct c.trainer_id), '{}'::uuid[]),
           9)
    into v_due
    from public.clients c
   where c.trainer_id is not null;

  for r in select unnest(coalesce(v_due, '{}'::uuid[])) as coach loop
    with quiet as (
      select c.id as client_id, max(w.performed_at) as last_at
        from public.clients c
        join public.workouts w on w.user_id = c.id
       where c.trainer_id = r.coach
         and c.id <> r.coach
       group by c.id
      having max(w.performed_at) < now() - interval '3 days'
    ), ins as (
      insert into public.coach_quiet_client_flags (coach_id, client_id, last_workout_at)
      select r.coach, q.client_id, q.last_at from quiet q
      on conflict (coach_id, client_id, last_workout_at) do nothing
      returning client_id, last_workout_at
    )
    select count(*)::int,
           (array_agg(client_id order by last_workout_at desc))[1]
      into v_n, v_first
      from ins;

    if coalesce(v_n, 0) = 0 then
      continue;
    end if;

    if v_n = 1 then
      insert into public.notifications (user_id, title, body, icon, route)
      select r.coach,
             'A client has gone quiet',
             left(coalesce(nullif(btrim(coalesce(p.full_name, '')), ''), 'A client')
               || ' hasn''t logged a workout in '
               || greatest(3, (now()::date - f.last_workout_at::date))
               || ' days. A quick check-in can help.', 500),
             'heart',
             '/(trainer)/client-training?clientId=' || f.client_id::text
        from public.coach_quiet_client_flags f
        left join public.profiles p on p.id = f.client_id
       where f.coach_id = r.coach and f.client_id = v_first
       order by f.flagged_at desc
       limit 1;
    else
      insert into public.notifications (user_id, title, body, icon, route)
      values (r.coach,
              v_n || ' clients have gone quiet',
              v_n || ' of your clients haven''t logged a workout in 3+ days. They''re at the top of Today.',
              'heart',
              '/(trainer)/dashboard');
    end if;

    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end $fn$;

revoke all on function public.run_coach_quiet_client_nudges() from public, anon, authenticated;

comment on function public.run_coach_quiet_client_nudges() is
  'At each coach''s 09:00 local (claim_notice_pass ''quiet-clients''), flags clients with at least one workout but none in 3+ days, once per inactivity stretch (coach_quiet_client_flags), and writes one notification per coach. Push, the Clients switch and quiet hours are part 900''s dispatcher and send-push.';

-- The coach's Today section: clients flagged and still quiet (no workout since).
create or replace function public.coach_quiet_clients()
returns table (client_id uuid, full_name text, last_workout_at timestamptz, flagged_at timestamptz)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select f.client_id, nullif(btrim(coalesce(p.full_name, '')), ''), f.last_workout_at, f.flagged_at
    from public.coach_quiet_client_flags f
    join public.clients c on c.id = f.client_id and c.trainer_id = f.coach_id
    left join public.profiles p on p.id = f.client_id
   where f.coach_id = auth.uid()
     and not exists (select 1 from public.workouts w
                      where w.user_id = f.client_id and w.performed_at > f.last_workout_at)
   order by f.last_workout_at asc;
$fn$;

revoke all on function public.coach_quiet_clients() from public, anon;
grant execute on function public.coach_quiet_clients() to authenticated;

comment on function public.coach_quiet_clients() is
  'The calling coach''s clients flagged by part 3530 who still have not trained since the flag''s last workout, oldest silence first. Scoped to auth.uid() and to clients still coached by them.';

-- Hourly at :47 (the claim limits each coach to their local 09:00), clear of
-- :41, :55 and :58.
select cron.unschedule('coach-quiet-client-nudges')
 where exists (select 1 from cron.job where jobname = 'coach-quiet-client-nudges');

select cron.schedule('coach-quiet-client-nudges', '47 * * * *', $cron$select public.run_coach_quiet_client_nudges();$cron$);
