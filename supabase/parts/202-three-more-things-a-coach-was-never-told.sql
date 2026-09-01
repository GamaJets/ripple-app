-- ═════════════════════════════════════════════════════════════════════════
-- Three more things a coach was never told.
--
-- Parts 158, 159, 160 and 163 each closed a silence found by the same sweep:
-- grep `notifications`, `notify_users`, `sendPush`, `sendPushChecked` and
-- `recordInbox` across app/, src/ and supabase/, and read every writer that can
-- touch the fact in question. These are three the sweep found and nobody has
-- taken yet, and all three share a shape the earlier parts did not: they are
-- about things the app ALREADY COMPUTES and shows only to somebody who happens
-- to open the right screen.
--
--   1 · A CLIENT IS PAST THEIR OWN USUAL GAP between visits.
--       src/lib/cadence.ts works this out and app/(trainer)/nudges.tsx renders
--       it. That screen is opened when a coach is already worrying about
--       retention, which is a fortnight after the moment this matters.
--
--   2 · A CLIENT HAS HIT A GOAL THEY SET THEMSELVES.
--       `goal_targets.achieved_at` is written by the client, read by
--       app/(trainer)/client-goals.tsx, and announced to nobody.
--       Congratulating somebody inside the hour is the cheapest retention act
--       in this business and it currently depends on the coach happening to
--       look.
--
--   3 · A CREDENTIAL OR AN INSURANCE POLICY IS ABOUT TO EXPIRE.
--       `credentialState()` in src/lib/coachCredentials.ts returns 'expiring'
--       and 'expired', `EXPIRING_SOON_DAYS` is 60, and the only consumer is
--       app/(trainer)/credentials.tsx. Lapsed public liability means a coach is
--       working uninsured. The app knows the date and says nothing.
--
-- ── Why a scheduled job for 1 and 3, and a trigger for 2 ────────────────
--
-- A trigger fires on a write. Two of these are about the ABSENCE of one:
-- nobody inserts a row saying "this client did not come in" and nobody inserts
-- one saying "your insurance ran out today". There is no write to hang a
-- trigger on, so they are a nightly pass — the same shape parts 48 and 135
-- already use, on the same pg_cron.
--
-- A goal being reached IS a write (`achieved_at` moving from null to a
-- timestamp), so that one is a trigger, and it fires inside the transaction of
-- the client tapping the button — which is what "inside the hour" means.
--
-- ── What is NOT here, and why ───────────────────────────────────────────
--
-- A PERSONAL BEST. It was in scope and it is deliberately left out. A PR is
-- defined in `personalRecords` (src/lib/exerciseHistory.ts) over
-- `workouts.sets`, which is untyped jsonb, and that definition CHANGED in the
-- wave that landed an hour before this part was written — a bodyweight set now
-- carries an explicit `bw` flag and is priced at the member's weight as
-- recorded on or before that day, with sets that cannot be priced excluded
-- rather than counted as zero. Re-stating any of that in plpgsql produces a
-- second definition of a personal record, free to disagree with the first, and
-- the disagreement would surface as a coach being told about a PR the client's
-- own Records screen does not show. Part 163 made the same call about money and
-- for the same reason: one definition, in one place, and the notification says
-- the thing the definition cannot get wrong. This is recorded here so it is a
-- decision rather than an oversight.
--
-- ── The rule every message below keeps ──────────────────────────────────
--
-- NO FIGURE THE APP WOULD RESTATE DIFFERENTLY. Part 163's argument: the second
-- copy of a formatter is the copy that drifts, and a drifted copy tells a coach
-- a number that is not the number. So the overdue message states days and their
-- own usual gap — both computed by the query that sends it, both about the
-- record — and never a drift percentage, which src/lib/clientDrift.ts owns. The
-- goal message names the goal and no measurement. Neither carries money and
-- neither carries a currency; there is no default currency in this product
-- (part 150).
--
-- Idempotent; safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · A client past their own usual gap
-- ═════════════════════════════════════════════════════════════════════════
--
-- ── Why this rule and not the drift verdict ─────────────────────────────
--
-- `assessDrift` compares two RATES over a fourteen-day near window against a
-- six-week baseline. It is the right instrument for "is this person doing less
-- than they used to" and it is retrospective by construction: a client has to
-- have already missed a fortnight. Re-implementing it here would be a large
-- piece of plpgsql whose only job is to agree with a tuned TypeScript module it
-- has no way to stay in step with.
--
-- The interval rule is different and much smaller: their median gap between
-- active days, and how long it has been. It is the rule src/lib/cadence.ts
-- holds, it speaks on day four rather than day fourteen, and it is arithmetic
-- rather than judgement. The constants below are that file's, named after it,
-- and the app's Quiet Clients screen remains the authority on the verdict — the
-- message says what was observed and sends the coach there.
--
-- ── Local days versus UTC ───────────────────────────────────────────────
--
-- The app files activity under the reader's LOCAL day (`localDayKey`, matching
-- `streaks.activeDays`); this job has no reader and files under UTC. The
-- difference can move one visit across one boundary and therefore change a
-- median gap by at most a day. That is inside the tolerance the rule already
-- carries — three days, or half the gap again — and the alternative is storing
-- a time zone per client that nothing else in this schema needs. Stated so the
-- next reader does not treat it as a bug.

-- The dedupe record, and it is the whole reason this can run nightly.
--
-- Without it a coach is told about the same silence every night for a
-- fortnight, which is precisely the nagging src/lib/nudge.ts is written to
-- prevent — and a nightly duplicate is worse than the nudge screen's own
-- repeats because it wakes a phone.
--
-- Keyed on the client's LAST ACTIVE DAY rather than on a timestamp. That is
-- what makes "a new silence" mean something: a client who comes back and then
-- goes quiet again has a different `last_active_on`, so they are notified again
-- — correctly, it is a different spell — while the same unbroken silence
-- notifies once however many nights it lasts.
create table if not exists public.coach_overdue_notices (
  coach_id       uuid not null references public.profiles(id) on delete cascade,
  client_id      uuid not null references public.profiles(id) on delete cascade,
  -- The last day the client did anything, as this job saw it. NOT NULL: a row
  -- here always describes a client with a record, because a client with no
  -- record has no usual gap and never reaches this table.
  last_active_on date not null,
  notified_at    timestamptz not null default now(),
  primary key (coach_id, client_id)
);

comment on table public.coach_overdue_notices is
  'One row per coach and client, recording the silence a coach has already been told about. Keyed on the client''s last active day so a NEW silence notifies again and an unbroken one notifies once.';

alter table public.coach_overdue_notices enable row level security;

-- No policy at all, and that is the intent rather than an omission. RLS with no
-- policy denies every row to every non-superuser role, which is exactly right:
-- this table is bookkeeping for a job that runs as the table owner and nothing
-- in any of the three apps reads or writes it. A coach-readable policy would be
-- a second, differently-shaped answer to "who is quiet" sitting beside the one
-- the Quiet Clients screen computes.

create or replace function public.run_overdue_client_notices()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  -- src/lib/cadence.ts. Named here so a reader can check the two against each
  -- other, and so changing one is visibly not changing the other.
  c_window_days   constant int  := 56;   -- DEFAULT_WINDOWS.historyDays
  c_min_active    constant int  := 4;    -- MIN_ACTIVE_DAYS
  c_min_span      constant int  := 14;   -- MIN_SPAN_DAYS
  c_max_gap       constant numeric := 21;   -- MAX_USUAL_GAP_DAYS
  c_late_fraction constant numeric := 0.5;  -- LATE_FRACTION
  c_min_late      constant int  := 3;    -- MIN_LATE_DAYS
  v_sent integer := 0;
  r      record;
begin
  for r in
    with book as (
      -- Only clients with a live coaching link. `clients.trainer_id` is the
      -- column `is_my_client()` reads and the one `end_coaching()` clears, so a
      -- client who has left produces nothing here from the night they leave.
      select c.id as client_id, c.trainer_id as coach_id
        from public.clients c
       where c.trainer_id is not null
    ),
    acts as (
      -- The same four sources `readClientActivity` reads, and the same
      -- restriction on the third: only a session somebody CONFIRMED took place.
      -- A booked slot whose clock has passed is not evidence the client turned
      -- up — the inference part 33 was written to end — and counting it would
      -- read as a client still attending when they had stopped.
      select b.coach_id, b.client_id, (ci.at at time zone 'UTC')::date as d
        from book b join public.check_ins ci on ci.user_id = b.client_id
       where ci.at >= now() - make_interval(days => c_window_days)
      union
      select b.coach_id, b.client_id, (w.performed_at at time zone 'UTC')::date
        from book b join public.workouts w on w.user_id = b.client_id
       where w.performed_at >= now() - make_interval(days => c_window_days)
      union
      select b.coach_id, b.client_id, (s.starts_at at time zone 'UTC')::date
        from book b join public.sessions s on s.client_id = b.client_id
       where s.starts_at >= now() - make_interval(days => c_window_days)
         and s.outcome = 'completed'
      union
      select b.coach_id, b.client_id, (v.entered_at at time zone 'UTC')::date
        from book b join public.gym_visits v on v.member_id = b.client_id
       where v.entered_at >= now() - make_interval(days => c_window_days)
    ),
    -- UNION above rather than UNION ALL: five exercises logged on one evening
    -- is ONE active day. Counting it as five would give the client a usual gap
    -- of nothing and make them permanently overdue — the same collapse
    -- `activeDayLog` performs in the app.
    days as (
      select coach_id, client_id, d,
             lag(d) over (partition by coach_id, client_id order by d) as prev
        from acts
    ),
    gaps as (
      select coach_id, client_id, (d - prev)::numeric as gap
        from days
       where prev is not null
    ),
    stats as (
      select a.coach_id, a.client_id,
             count(*)                                as active_days,
             min(a.d)                                as first_day,
             max(a.d)                                as last_day,
             (current_date - max(a.d))               as since_last,
             (select percentile_cont(0.5) within group (order by g.gap)
                from gaps g
               where g.coach_id = a.coach_id and g.client_id = a.client_id) as usual_gap
        from acts a
       group by a.coach_id, a.client_id
    )
    select s.*,
           -- MEDIAN and not mean, and this is the most important line in the
           -- query. A client who trains every three days and takes one
           -- three-week holiday has a mean gap of six and a median of three;
           -- paced off the mean the job waits twelve days before saying
           -- anything, having been taught by one holiday to expect another.
           greatest(c_min_late::numeric, s.usual_gap * c_late_fraction) as tolerance
      from stats s
     where s.active_days >= c_min_active
       and (s.last_day - s.first_day) >= c_min_span
       and s.usual_gap is not null
       and s.usual_gap > 0
       and s.usual_gap <= c_max_gap
       -- Past their own gap by more than the tolerance. Everybody is "due"
       -- every week by construction, and a message at "due" is the nagging
       -- this whole family of features refuses.
       and (s.since_last::numeric - s.usual_gap)
             > greatest(c_min_late::numeric, s.usual_gap * c_late_fraction)
  loop
    -- One silence, one message. `is distinct from` rather than `<>` because the
    -- left side is absent on the first sighting, and `null <> date` is null,
    -- which would fail the guard and send nothing at all the first time — the
    -- one time it matters most.
    if exists (
      select 1 from public.coach_overdue_notices n
       where n.coach_id = r.coach_id
         and n.client_id = r.client_id
         and n.last_active_on = r.last_day
    ) then
      continue;
    end if;

    -- Written BEFORE the notification, and the ordering is deliberate. If the
    -- insert into `notifications` fails the whole iteration rolls back and the
    -- coach is told tomorrow; if it succeeded and the bookkeeping then failed,
    -- the coach would be told again every night forever.
    insert into public.coach_overdue_notices (coach_id, client_id, last_active_on, notified_at)
    values (r.coach_id, r.client_id, r.last_day, now())
    on conflict (coach_id, client_id)
      do update set last_active_on = excluded.last_active_on, notified_at = now();

    insert into public.notifications (user_id, title, body, icon, route)
    values (
      r.coach_id,
      'A client is past their usual gap',
      -- The name is theirs to give: the coach can already read it through
      -- `profiles_trainer_r_clients`, so this states nothing they could not see.
      -- A blank or missing name falls back to "A client" and never to an empty
      -- string, which would render a sentence starting with a space.
      left(
        coalesce(
          (select nullif(btrim(coalesce(p.full_name, '')), '') from public.profiles p where p.id = r.client_id),
          'A client'
        )
        || ' has not been in for ' || r.since_last || ' day' || case when r.since_last = 1 then '' else 's' end
        || ', and they usually come about every ' || round(r.usual_gap, 1) || ' day'
        || case when round(r.usual_gap, 1) = 1 then '' else 's' end || '.'
        || ' That is what the app was told, not what they did — an injury, a fortnight away or simply not opening'
        || ' the app all look exactly like this. Quiet Clients has the dates.',
        500),
      'bell',
      '/(trainer)/nudges'
    );
    v_sent := v_sent + 1;
  end loop;

  -- Bookkeeping for clients who have come back. Without this the table grows
  -- one row per client forever and, worse, a client who returns and goes quiet
  -- again at the SAME last-active date as a year ago would be silently skipped.
  delete from public.coach_overdue_notices n
   where n.notified_at < now() - interval '400 days';

  return jsonb_build_object('sent', v_sent);
end $fn$;

revoke all on function public.run_overdue_client_notices() from public, anon, authenticated;

comment on function public.run_overdue_client_notices() is
  'Nightly. Tells a coach when a client is past their OWN median gap between active days by more than the tolerance in src/lib/cadence.ts. One message per silence, keyed on the client''s last active day. States days and their usual gap, never a drift percentage — clientDrift.ts owns that figure.';


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · A client has hit a goal
-- ═════════════════════════════════════════════════════════════════════════
--
-- `goal_targets.achieved_at` is the client's own claim that they got there —
-- the column's comment in part 02 says so, and for a custom goal it is the only
-- signal there will ever be. A trigger on it firing inside the client's own
-- transaction is what makes "congratulate them inside the hour" true.
--
-- ── The guards, each of which is a way this could fail a tap ────────────
--
-- This fires inside the transaction of somebody marking a goal reached. An
-- exception here rolls that back, and a client would tap the button and watch
-- nothing happen. `notifications.user_id` is `not null references profiles(id)`,
-- so the recipient is the only realistic way that happens:
--
--   `clients.trainer_id`  NULLABLE (on delete set null) — GUARDED, and it is
--                         the recipient, so a client with no coach costs this
--                         message entirely rather than costing them the tap.
--
-- Deliberately NOT wrapped in `exception when others then null`, for part 158's
-- reason: that swallows a real defect silently and forever.

create or replace function public.goal_achieved_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_coach uuid;
  v_name  text;
  v_what  text;
begin
  -- Only the crossing, and only upward. A client who un-marks a goal and marks
  -- it again produces one message and not three, and an ordinary edit to the
  -- target date produces none.
  if new.achieved_at is null or old.achieved_at is not null then
    return new;
  end if;

  select c.trainer_id into v_coach from public.clients c where c.id = new.client_id;
  if v_coach is null then
    return new;
  end if;

  select nullif(btrim(coalesce(p.full_name, '')), '')
    into v_name from public.profiles p where p.id = new.client_id;

  -- The goal in the client's own words for a custom one, and the metric's name
  -- for a measured one. NO FIGURE: `target_value` is in kg for weight and
  -- muscle and per cent for body fat, the reader's unit preference lives in
  -- `profiles.weight_unit` (part 82), and a coach who reads in pounds would be
  -- shown a number in kilograms with no unit on it. src/lib/units.ts is the one
  -- place that conversion happens and it is not reachable from here.
  v_what := case new.kind
    when 'custom'  then nullif(btrim(coalesce(new.title, '')), '')
    when 'weight'  then 'their weight goal'
    when 'bodyfat' then 'their body fat goal'
    when 'muscle'  then 'their muscle goal'
    else 'a goal'
  end;

  insert into public.notifications (user_id, title, body, icon, route)
  values (
    v_coach,
    'A client has hit a goal',
    left(
      coalesce(v_name, 'A client') || ' has just marked '
      || coalesce(v_what, 'a goal') || ' as reached.'
      || ' They said so themselves — this is their claim, not a measurement the app checked.'
      || ' A word today is worth more than one next week.',
      500),
    'trophy',
    -- client-goals.tsx reads `clientId` if it is given one and falls back to
    -- its own roster picker if it is not, which src/lib/features.ts records. The
    -- parameter is still passed: without it this opens a picker rather than the
    -- person the message is about.
    '/(trainer)/client-goals?clientId=' || new.client_id::text
  );

  return new;
end;
$function$;

comment on function public.goal_achieved_notify() is
  'Tells the COACH when a client marks one of their own goals reached. Fires on the upward crossing of achieved_at only. Carries no figure — the target is stored in kg or per cent and the reader''s unit preference is not reachable from here.';

drop trigger if exists goal_targets_notify_achieved on public.goal_targets;
create trigger goal_targets_notify_achieved
  after update of achieved_at on public.goal_targets
  for each row execute function public.goal_achieved_notify();

-- Revoked from public, anon AND authenticated. Postgres checks EXECUTE when a
-- trigger is CREATED and not when it fires, so a trigger function needs no
-- grant to anybody (parts 51, 141, 158); Postgres grants EXECUTE to PUBLIC on
-- every new function and `anon` resolves through that grant, so both are named.
revoke all on function public.goal_achieved_notify() from public;
revoke all on function public.goal_achieved_notify() from anon;
revoke all on function public.goal_achieved_notify() from authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · A credential or an insurance policy running out
-- ═════════════════════════════════════════════════════════════════════════
--
-- The one message on this list that is about the coach rather than about a
-- client, and the one with a consequence outside the app: a coach whose public
-- liability has lapsed is working uninsured, and a coach whose certification
-- has lapsed is listed in the directory making a claim that is no longer true.
--
-- Two crossings and not one, on the same argument part 163 makes about a
-- session pack: a notification at expiry is late. Sixty days is
-- `EXPIRING_SOON_DAYS` in src/lib/coachCredentials.ts, which is enough time to
-- book a course or renew a policy; the second message on the day it lapses is
-- the fact.

create table if not exists public.coach_credential_notices (
  credential_id uuid not null references public.coach_credentials(id) on delete cascade,
  -- Which of the two messages this row records. A credential gets one of each
  -- and never two of either.
  stage         text not null check (stage in ('expiring', 'expired')),
  notified_at   timestamptz not null default now(),
  primary key (credential_id, stage)
);

comment on table public.coach_credential_notices is
  'One row per credential per stage, so a nightly pass tells a coach once at sixty days and once on the day it lapses rather than every night in between.';

alter table public.coach_credential_notices enable row level security;
-- No policy, deliberately, for the same reason as coach_overdue_notices above:
-- RLS with no policy denies every row to every non-superuser role, and this is
-- bookkeeping for a job running as the table owner that no app reads.

create or replace function public.run_credential_expiry_notices()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  -- EXPIRING_SOON_DAYS in src/lib/coachCredentials.ts.
  c_soon_days constant int := 60;
  v_sent integer := 0;
  r      record;
begin
  for r in
    select cr.id, cr.coach_id, cr.kind, cr.title, cr.expires_on,
           (cr.expires_on - current_date) as days_left,
           case when cr.expires_on < current_date then 'expired' else 'expiring' end as stage
      from public.coach_credentials cr
     where cr.expires_on is not null
       -- A row with no expiry is 'no-expiry' and never 'current' — the coach
       -- has told us nothing about when it runs out, and that absence is the
       -- credentials screen's business rather than this job's.
       and cr.expires_on <= current_date + c_soon_days
       -- Nothing about a policy that lapsed before this feature existed. A
       -- coach opening the app to eleven notifications about certificates from
       -- 2019 learns to clear the inbox without reading it.
       and cr.expires_on >= current_date - 30
  loop
    if exists (
      select 1 from public.coach_credential_notices n
       where n.credential_id = r.id and n.stage = r.stage
    ) then
      continue;
    end if;

    insert into public.coach_credential_notices (credential_id, stage, notified_at)
    values (r.id, r.stage, now())
    on conflict (credential_id, stage) do nothing;

    insert into public.notifications (user_id, title, body, icon, route)
    values (
      r.coach_id,
      case when r.stage = 'expired'
        then (case when r.kind = 'insurance' then 'Your insurance has expired' else 'A qualification has expired' end)
        else (case when r.kind = 'insurance' then 'Your insurance runs out soon' else 'A qualification runs out soon' end)
      end,
      left(
        r.title || case when r.stage = 'expired'
          then ' expired on ' || to_char(r.expires_on, 'DD Mon YYYY') || '.'
               || case when r.kind = 'insurance'
                    then ' If that is your public liability cover, you are working without it until you renew.'
                    else ' It is still shown on your profile as your own statement, and it is no longer true.' end
          else ' runs out on ' || to_char(r.expires_on, 'DD Mon YYYY') || ' — ' || r.days_left
               || ' day' || case when r.days_left = 1 then '' else 's' end || ' from today.'
               || ' Renewing takes longer than you think.'
        end
        || ' Update the date on Credentials once it is renewed.',
        500),
      'trophy',
      '/(trainer)/credentials'
    );
    v_sent := v_sent + 1;
  end loop;

  return jsonb_build_object('sent', v_sent);
end $fn$;

revoke all on function public.run_credential_expiry_notices() from public, anon, authenticated;

comment on function public.run_credential_expiry_notices() is
  'Nightly. Tells a coach once at sixty days (EXPIRING_SOON_DAYS) and once on the day a credential or insurance policy lapses. Ignores anything that expired more than thirty days ago, so switching this on does not produce an inbox of history.';


-- ═════════════════════════════════════════════════════════════════════════
-- 4 · The schedule
-- ═════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;

-- Unschedule first so re-running this file does not accumulate duplicate jobs
-- each firing the same run, exactly as parts 48 and 135 do.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'overdue-client-notices') then
    perform cron.unschedule('overdue-client-notices');
  end if;
  if exists (select 1 from cron.job where jobname = 'credential-expiry-notices') then
    perform cron.unschedule('credential-expiry-notices');
  end if;
end $$;

-- 07:12 and 07:19 UTC. Morning rather than the small hours on purpose: both of
-- these wake a phone, and a coach whose insurance notification arrives at 03:17
-- is a coach who turns notifications off. Seven minutes apart so the two passes
-- do not contend, and off the top of the hour where everything else in a
-- Postgres runs. Both jobs run as the table owner, so neither widens what a
-- signed-in person can reach.
select cron.schedule(
  'overdue-client-notices',
  '12 7 * * *',
  $cron$ select public.run_overdue_client_notices(); $cron$
);

select cron.schedule(
  'credential-expiry-notices',
  '19 7 * * *',
  $cron$ select public.run_credential_expiry_notices(); $cron$
);
