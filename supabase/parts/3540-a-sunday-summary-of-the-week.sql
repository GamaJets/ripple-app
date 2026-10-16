-- A Sunday summary of the week, for each client and their coach.
--
-- app/(client)/report.tsx has long drawn a weekly report — but only for a
-- member who went looking for it. This writes the week down and says so:
-- at 18:00 on Sunday in each person's own zone (claim_notice_pass, part 1890,
-- plus a local-weekday test), one row per person per week in weekly_reports
-- (the unique key IS the dedupe) and one notification.
--
--   · Client: workouts, sets, volume, records, streak and InBody change, on
--     '/(client)/report' with channel 'training' set explicitly, so send-push
--     applies the Training switch and quiet hours (notification_channel has no
--     mapping for that route, and an unmapped route would go ungated).
--   · Coach: at THEIR 18:00 Sunday, one roll-up across their clients on
--     '/(trainer)/dashboard' (channel 'clients').
--
-- Records use the app's one Epley (w × (1 + r/30), src/lib/streaks.ts est1RM)
-- against everything strictly before the week, ignoring bodyweight and timed
-- sets, and a movement with no earlier loaded set is a first, not a record —
-- the same rules as src/lib/sessionRecords.ts.
--
-- Members with nothing logged in 30 days are skipped: a weekly "you did
-- nothing" to somebody who has left is not a report, it is spam.
--
-- Additive only: one table, three functions, one cron job.

create table if not exists public.weekly_reports (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  audience    text not null check (audience in ('client', 'coach')),
  week_start  date not null,
  figures     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (user_id, audience, week_start)
);

create index if not exists weekly_reports_user_idx on public.weekly_reports (user_id, week_start desc);

alter table public.weekly_reports enable row level security;
revoke all on table public.weekly_reports from public, anon, authenticated;
revoke all on sequence public.weekly_reports_id_seq from public, anon, authenticated;

comment on table public.weekly_reports is
  'One Sunday summary per person per week (part 3540). Written only by run_weekly_reports(); read through my_weekly_reports(). No direct grants.';

create or replace function public.weekly_report_figures(p_user uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v jsonb;
begin
  with s as (
    select w.exercise, w.performed_at, (x.v->>0)::numeric as reps, (x.v->>1)::numeric as kg
      from public.workouts w
      cross join lateral jsonb_array_elements(case when jsonb_typeof(w.sets) = 'array' then w.sets else '[]'::jsonb end)
           with ordinality as x(v, i)
     where w.user_id = p_user
       and w.performed_at < p_to
       and jsonb_typeof(x.v) = 'array'
       and coalesce((w.bw -> (x.i::int - 1))::text, 'false') <> 'true'
       and coalesce((w.timed -> (x.i::int - 1))::text, 'false') <> 'true'
  ), loaded as (
    select exercise, performed_at, reps, kg, round(kg * (1 + reps / 30)) as e1
      from s where reps > 0 and kg > 0
  ), wk as (
    select exercise, max(e1) e1 from loaded where performed_at >= p_from group by exercise
  ), before as (
    select exercise, max(e1) e1 from loaded where performed_at < p_from group by exercise
  ), scan_end as (
    select weight_kg, body_fat_pct, skeletal_muscle_kg from public.scans
     where client_id = p_user and taken_at < (p_to)::date + 1 order by taken_at desc, created_at desc limit 1
  ), scan_start as (
    select weight_kg, body_fat_pct, skeletal_muscle_kg from public.scans
     where client_id = p_user and taken_at < (p_from)::date order by taken_at desc, created_at desc limit 1
  ), scan_in as (
    select count(*) n from public.scans where client_id = p_user and taken_at >= (p_from)::date and taken_at < (p_to)::date + 1
  )
  select jsonb_build_object(
    'workouts', (select count(distinct w.performed_at) from public.workouts w
                  where w.user_id = p_user and w.performed_at >= p_from and w.performed_at < p_to),
    'sets', (select count(*) from s where performed_at >= p_from),
    'volume_kg', (select round(coalesce(sum(reps * kg), 0)) from loaded where performed_at >= p_from),
    'prs', (select count(*) from wk join before b using (exercise) where wk.e1 > b.e1),
    'scan_this_week', (select n > 0 from scan_in),
    'weight_delta_kg', case when (select n from scan_in) > 0 then (select e.weight_kg - b.weight_kg from scan_end e, scan_start b) end,
    'body_fat_delta_pct', case when (select n from scan_in) > 0 then (select e.body_fat_pct - b.body_fat_pct from scan_end e, scan_start b) end,
    'muscle_delta_kg', case when (select n from scan_in) > 0 then (select e.skeletal_muscle_kg - b.skeletal_muscle_kg from scan_end e, scan_start b) end
  ) into v;
  return v;
end $fn$;

revoke all on function public.weekly_report_figures(uuid, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.run_weekly_reports()
returns integer
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_due    uuid[];
  v_sent   int := 0;
  v_tz     text;
  v_today  date;
  v_from   timestamptz;
  v_to     timestamptz;
  v_week   date;
  v_fig    jsonb;
  v_streak int;
  v_id     bigint;
  v_n      int;
  v_tr     int;
  v_prs    int;
  r        record;
begin
  -- ── clients ────────────────────────────────────────────────────────────
  select public.claim_notice_pass('weekly-report', coalesce(array_agg(c.id), '{}'::uuid[]), 18)
    into v_due
    from public.clients c
   where exists (select 1 from public.workouts w where w.user_id = c.id and w.performed_at > now() - interval '30 days');

  for r in select unnest(coalesce(v_due, '{}'::uuid[])) as id loop
    v_tz := coalesce(public.notice_local_tz(r.id), 'UTC');
    v_today := (now() at time zone v_tz)::date;
    continue when extract(isodow from v_today) <> 7;
    v_week := v_today - 6;
    v_from := v_week::timestamp at time zone v_tz;
    v_to   := (v_today + 1)::timestamp at time zone v_tz;
    v_fig := public.weekly_report_figures(r.id, v_from, v_to);
    v_streak := public.member_streak_through_yesterday(r.id)
      + case when exists (select 1 from public.workouts w where w.user_id = r.id and w.performed_at >= v_today::timestamp at time zone v_tz) then 1 else 0 end;
    v_fig := v_fig || jsonb_build_object('streak', v_streak);

    insert into public.weekly_reports (user_id, audience, week_start, figures)
    values (r.id, 'client', v_week, v_fig)
    on conflict (user_id, audience, week_start) do nothing
    returning id into v_id;
    continue when v_id is null;

    insert into public.notifications (user_id, title, body, icon, route, channel)
    values (r.id, 'Your week in training',
      case when (v_fig->>'workouts')::int = 0
        then 'No sessions logged this week. Your weekly report is ready, and next week starts tomorrow.'
        else (v_fig->>'workouts') || ' session' || case when (v_fig->>'workouts')::int = 1 then '' else 's' end
             || ', ' || (v_fig->>'sets') || ' sets'
             || case when (v_fig->>'prs')::int > 0 then ', ' || (v_fig->>'prs') || ' new best' || case when (v_fig->>'prs')::int = 1 then '' else 's' end else '' end
             || case when v_streak >= 2 then ', ' || v_streak || '-day streak' else '' end
             || '. Tap for your weekly report.'
      end,
      'train', '/(client)/report', 'training');
    v_sent := v_sent + 1;
  end loop;

  -- ── coaches ────────────────────────────────────────────────────────────
  select public.claim_notice_pass('weekly-report-coach', coalesce(array_agg(distinct c.trainer_id), '{}'::uuid[]), 18)
    into v_due
    from public.clients c
   where c.trainer_id is not null;

  for r in select unnest(coalesce(v_due, '{}'::uuid[])) as id loop
    v_tz := coalesce(public.notice_local_tz(r.id), 'UTC');
    v_today := (now() at time zone v_tz)::date;
    continue when extract(isodow from v_today) <> 7;
    v_week := v_today - 6;
    v_from := v_week::timestamp at time zone v_tz;
    v_to   := (v_today + 1)::timestamp at time zone v_tz;

    select count(*)::int,
           count(*) filter (where (f->>'workouts')::int > 0)::int,
           coalesce(sum((f->>'prs')::int), 0)::int
      into v_n, v_tr, v_prs
      from (select public.weekly_report_figures(c.id, v_from, v_to) f
              from public.clients c
             where c.trainer_id = r.id and c.id <> r.id
               and exists (select 1 from public.workouts w where w.user_id = c.id and w.performed_at > now() - interval '30 days')) q;
    continue when coalesce(v_n, 0) = 0;

    insert into public.weekly_reports (user_id, audience, week_start, figures)
    values (r.id, 'coach', v_week, jsonb_build_object('clients', v_n, 'trained', v_tr, 'prs', v_prs))
    on conflict (user_id, audience, week_start) do nothing
    returning id into v_id;
    continue when v_id is null;

    insert into public.notifications (user_id, title, body, icon, route, channel)
    values (r.id, 'Your clients'' week',
      v_tr || ' of ' || v_n || ' active client' || case when v_n = 1 then '' else 's' end || ' trained this week'
        || case when v_prs > 0 then ', with ' || v_prs || ' new best' || case when v_prs = 1 then '' else 's' end else '' end
        || '. Each client''s weekly report is on their page.',
      'heart', '/(trainer)/dashboard', 'clients');
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end $fn$;

revoke all on function public.run_weekly_reports() from public, anon, authenticated;

comment on function public.run_weekly_reports() is
  'Sunday 18:00 local (claim_notice_pass + isodow 7): writes one weekly_reports row per active client and per coach, deduped by (user, audience, week_start), and one notification each with an explicit channel so send-push applies switches and quiet hours.';

create or replace function public.my_weekly_reports()
returns table (week_start date, figures jsonb, created_at timestamptz)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select r.week_start, r.figures, r.created_at
    from public.weekly_reports r
   where r.user_id = auth.uid() and r.audience = 'client'
     and r.week_start > current_date - 91
   order by r.week_start desc;
$fn$;

revoke all on function public.my_weekly_reports() from public, anon;
grant execute on function public.my_weekly_reports() to authenticated;

comment on function public.my_weekly_reports() is
  'The calling member''s own Sunday summaries, newest first, the last 13 weeks.';

-- Hourly at :52, clear of :41, :47, :55 and :58.
select cron.unschedule('weekly-reports')
 where exists (select 1 from cron.job where jobname = 'weekly-reports');

select cron.schedule('weekly-reports', '52 * * * *', $cron$select public.run_weekly_reports();$cron$);
