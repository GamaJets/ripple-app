-- A streak about to break, said by something that is awake.
--
-- The handset already arms a "Keep your streak alive" local notification
-- (src/lib/motivationNudge.ts, streak-risk), but a local notification only
-- reaches somebody who opened the app that day. Part 3450 closed the same gap
-- for the quiet week; this is the streak half, on the same machinery:
--
--   · claim_notice_pass (part 1890): only at the intended local hour, at most
--     one claim per member per UTC day, race-safe between ticks.
--   · a notifications row on '/(client)/consistency', which
--     notification_channel already maps to 'training'. So part 900's
--     dispatcher pushes it, send-push applies the member's Training switch
--     (Notifications settings) and quiet hours, and nothing new can bypass them.
--
-- ── what it says, and when it refuses ─────────────────────────────────────
--
-- A member whose run of consecutive training days, in their own day, ends
-- YESTERDAY and is at least STREAK_WORTH_PROTECTING (2) long, and who has not
-- logged anything today. Same words as the handset.
--
-- Not spam:
--   · once a day at most (the claim);
--   · never more than three times in any seven days, so somebody who always
--     trains late is not told every evening;
--   · never on a day a quiet-week note already went (the two cannot both be
--     true, but the check is cheap and explicit);
--   · the count is re-read inside the loop, so a session logged in the seconds
--     since the claim is honoured.
--
-- Additive only: one new function and one cron job. No table, column or
-- policy changes.

create or replace function public.member_streak_through_yesterday(p_user uuid)
returns integer
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_tz    text := coalesce(public.notice_local_tz(p_user), 'UTC');
  v_today date := (now() at time zone v_tz)::date;
  v_n     int  := 0;
begin
  -- Anything today means the streak is already safe; the caller checks that
  -- separately, so here a run is counted back from yesterday.
  loop
    exit when v_n >= 366;
    exit when not exists (
      select 1 from public.workouts w
       where w.user_id = p_user
         and w.performed_at >= ((v_today - (v_n + 1))::timestamp at time zone v_tz)
         and w.performed_at <  ((v_today - v_n)::timestamp at time zone v_tz));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $fn$;

revoke all on function public.member_streak_through_yesterday(uuid) from public, anon, authenticated;

create or replace function public.run_streak_risk_nudges()
returns integer
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_due    uuid[];
  v_sent   int := 0;
  v_streak int;
  v_tz     text;
  r        record;
begin
  -- Candidates: trained yesterday-ish (within 48h) but not in the last few
  -- hours. The exact local-day test is below; this only keeps the claim small.
  select public.claim_notice_pass(
           'streak-risk',
           coalesce(array_agg(c.id), '{}'::uuid[]),
           15)
    into v_due
    from public.clients c
   where exists (select 1 from public.workouts w
                  where w.user_id = c.id and w.performed_at > now() - interval '48 hours');

  for r in select unnest(coalesce(v_due, '{}'::uuid[])) as id loop
    v_tz := coalesce(public.notice_local_tz(r.id), 'UTC');

    -- Already trained today, in their own day: nothing at risk.
    if exists (
      select 1 from public.workouts w
       where w.user_id = r.id
         and w.performed_at >= (((now() at time zone v_tz)::date)::timestamp at time zone v_tz)
    ) then
      continue;
    end if;

    v_streak := public.member_streak_through_yesterday(r.id);
    if v_streak < 2 then
      continue;
    end if;

    -- At most three in any seven days.
    if (select count(*) from public.notifications n
         where n.user_id = r.id
           and n.title = 'Keep your streak alive'
           and n.created_at > now() - interval '7 days') >= 3 then
      continue;
    end if;

    -- Not on top of a quiet-week note today.
    if exists (select 1 from public.notifications n
                where n.user_id = r.id
                  and n.route = '/(client)/consistency'
                  and n.created_at > now() - interval '20 hours') then
      continue;
    end if;

    insert into public.notifications (user_id, title, body, icon, route)
    values (
      r.id,
      'Keep your streak alive',
      'One session today keeps your ' || v_streak || '-day streak going.',
      'train',
      '/(client)/consistency');

    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end $fn$;

revoke all on function public.run_streak_risk_nudges() from public, anon, authenticated;

comment on function public.run_streak_risk_nudges() is
  'Writes one "Keep your streak alive" notification per member whose run of consecutive training days ends yesterday (at least 2 days), who has logged nothing today in their own zone, for whom it is the intended local hour, at most three times in seven days. The push, the Training switch and quiet hours are part 900''s dispatcher and send-push; this writes a row and nothing else.';

-- Hourly at :58, clear of every other pass (part 3450 uses :55).
select cron.unschedule('streak-risk-nudges')
 where exists (select 1 from cron.job where jobname = 'streak-risk-nudges');

select cron.schedule('streak-risk-nudges', '58 * * * *', $cron$select public.run_streak_risk_nudges();$cron$);
