-- ═══════════════════════════════════════════════════════════════════════════
-- The notification that arrived at three in the morning.
--
-- Six nightly passes in this database each fire at a fixed UTC minute:
--
--   run_overdue_client_notices      07:12 UTC   (part 202)
--   run_credential_expiry_notices   07:19 UTC   (part 202)
--   run_block_ended_notices         07:26 UTC   (part 471)
--   run_pack_expiry                 07:33 UTC   (part 612)
--   run_invoice_ageing_notices      07:40 UTC   (part 613)
--   run_open_slot_extension         07:48 UTC   (part 650)
--
-- Read against `cron.job` on the live database, all six confirmed.
--
-- ── Four separate parts each say, in their own words, that this hour was ──
-- ── chosen to AVOID waking somebody at three in the morning ──────────────
--
-- Part 202, above `cron.schedule('overdue-client-notices', '12 7 * * *')`:
--
--     "07:12 and 07:19 UTC. Morning rather than the small hours on purpose:
--      both of these wake a phone, and a coach whose insurance notification
--      arrives at 03:17 is a coach who turns notifications off."
--
-- Part 471, above `'26 7 * * *'`:
--
--     "07:26 UTC, seven minutes after part 202's second pass and on the same
--      morning reasoning: this wakes a phone, and a coach whose notification
--      arrives at 03:17 is a coach who turns notifications off."
--
-- Part 612, above `'33 7 * * *'`:
--
--     "07:33 UTC. Morning rather than the small hours for part 202's reason —
--      this wakes a phone, and a coach whose notifications arrive at 03:17 is
--      a coach who turns notifications off."
--
-- Part 613, above `'40 7 * * *'`:
--
--     "07:40 UTC, seven minutes after part 612's pass and on the same morning
--      reasoning parts 202 and 471 set out: this wakes a phone, and a coach
--      whose notification arrives at 03:17 is a coach who turns notifications
--      off."
--
-- Every one of those sentences is true about the number and false about the
-- world. 07:12 UTC is 03:12 in New York and 00:12 in Los Angeles. The hour that
-- four separate parts chose in order not to arrive at 03:17 arrives, for every
-- coach in the Americas, at 03:12. The reasoning was done in UTC and read as
-- though it were local, four times, each part citing the one before it.
--
-- ── Quiet hours do not rescue it in either direction ─────────────────────
--
-- `notify_quiet_hours` (part 530) carries `from_hour`, `to_hour` and a `tz`
-- that is NOT NULL. A coach who has never set them is woken at 03:12. A coach
-- who HAS set them fares worse: the push is suppressed, not deferred, so they
-- are never told at all that their public liability insurance lapsed. Silence
-- and a 3am buzz are the only two outcomes this schedule can produce for an
-- American coach, and the second is the one that looks like it is working.
--
-- ── The shape of the fix ─────────────────────────────────────────────────
--
-- Each pass runs HOURLY, on the minute it already used so the six still do not
-- contend, and each one does its work only for the coaches for whom it is
-- currently the intended local hour. Nothing about what a pass SAYS, or WHO it
-- is about, changes: every function body below was taken verbatim out of the
-- live database with `pg_get_functiondef` and carries exactly two additions —
-- one `select ... into v_due` before the loop, and one `= any(v_due)` in the
-- driving query. No sentence, no threshold, no date arithmetic and no
-- bookkeeping table was touched.
--
-- ══ 1 · WHERE THE COACH IS ═══════════════════════════════════════════════
--
-- The zone already exists and is already stored, in two places:
--
--   `notify_quiet_hours.tz`      not null, written when a coach sets quiet
--                                hours. An explicit statement by the coach
--                                about which clock their day runs on.
--   `trainer_availability.tz`    added by part 650 for this same wall, stamped
--                                by src/ui/availability.ts on every write.
--
-- `notice_local_tz` prefers the first, because it is the one the coach typed
-- about their own waking hours, and falls back to the most common zone on
-- their availability rows. Both are validated against `pg_timezone_names`
-- before use — part 650's rule, and the reason a typo cannot make an hourly
-- job raise every hour instead of once a night.
--
-- ── A coach with no zone keeps 07:00 UTC, unchanged, and that is a choice ──
--
-- Not a guess at UTC and not a guess at anything else. Part 650 already refused
-- to guess a zone for a coach who has not stated one — "UTC would put a London
-- coach's 07:00 at 08:00 for half the year and a Dubai coach's four hours out
-- all of it" — and that refusal holds here. What is left is the question of
-- which hour to use for somebody we cannot place, and the honest answer is the
-- hour they are already getting: 07:00 UTC, exactly as today. That way this
-- part cannot make anybody's notification arrive at a worse time than it does
-- now. It can only make it arrive at a better one.
--
-- ══ 2 · A THREE-HOUR WINDOW, NOT AN HOUR ═════════════════════════════════
--
-- The gate is `local hour between 7 and 9`, not `= 7`, for two reasons.
--
-- ── The day 07:00 local does not exist ───────────────────────────────────
--
-- Most zones move the clocks at 02:00, which leaves 07:00 alone. Some do not:
-- there are jurisdictions that shift at midnight, and Lord Howe Island shifts
-- by thirty minutes. A zone that springs forward across 07:00 has no 07:00 at
-- all on that date, and a gate testing `= 7` would silently skip that coach for
-- that day — the block that ended would be announced to nobody, because part
-- 471's condition is true on exactly one day and there is no bookkeeping table
-- to catch it tomorrow. With `between 7 and 9` the pass lands at 08:00 local
-- instead, one hour late and said once.
--
-- The complementary case, a zone that falls back across 07:00, has 07:00 TWICE.
-- The window does not help there; the claim table in section 3 does.
--
-- ── A missed tick is not a missed day ────────────────────────────────────
--
-- Three chances instead of one, so a pass that fails or a database that is
-- briefly unreachable costs an hour rather than a day.
--
-- The window stops at 9 rather than running to the end of the day on purpose.
-- If all three ticks are missed the coach hears nothing until tomorrow, which
-- is the same failure the current single nightly run already has, and strictly
-- better than the alternative: a catch-up pass firing at 22:00 local is this
-- part's own defect wearing a different hat.
--
-- ══ 3 · EXACTLY ONCE, UNDER EVERY MOVEMENT OF A CLOCK ════════════════════
--
-- `notice_pass_runs` is keyed `(pass, coach_id, utc_day)`, and a coach is
-- processed by a pass only on the tick that successfully INSERTS that row.
-- `on conflict do nothing` plus `returning` makes the claim and the decision
-- the same statement, so two ticks racing cannot both win.
--
-- ── Why the key is the UTC day and not the coach's local day ─────────────
--
-- This is the part that is easy to get wrong, and getting it wrong sends two.
--
-- The passes themselves are written against `current_date`, which is the UTC
-- date, and not one character of that arithmetic is being changed here. So the
-- unit of work is "this coach, this UTC date" and the claim has to be keyed on
-- exactly that, or the same UTC date's rows can be evaluated twice.
--
-- Consider a coach at UTC+7 whose zone springs forward to UTC+8. On the day
-- before, their 07:00 local is 00:00 UTC. On the transition day it is 23:00 UTC
-- the PREVIOUS day. Both instants fall inside the same UTC date, they are
-- different LOCAL days, and a claim keyed on the local day would let both
-- through — two passes over one UTC date's rows.
--
-- Keyed on the UTC day, the second is refused. What the coach loses is one
-- notification-day out of a spring-forward transition, and what they gain is
-- that a duplicate is arithmetically impossible.
--
-- Nothing is ever dropped the other way. Every UTC date is 24 hours long and
-- every fixed zone passes through local hours 7, 8 and 9 within any 24 hours,
-- so every UTC date contains at least one tick where the gate is open. There is
-- no UTC date a coach can be skipped on.
--
-- ── A coach who changes zone ─────────────────────────────────────────────
--
-- Same key, same answer. Moving from Berlin to Los Angeles mid-morning cannot
-- produce a second notification, because the claim for that UTC date is already
-- taken. Moving the other way cannot produce one either. The worst case a zone
-- change can cause is one day at the old zone's hour, which is what a person
-- who has just changed continent would expect anyway.
--
-- ── And the guards that were already there still hold ────────────────────
--
-- `coach_credential_notices (credential_id, stage)`, `coach_overdue_notices
-- (coach_id, client_id, last_active_on)` and `coach_invoice_ageing_notices
-- (invoice_id, bucket)` are untouched and still refuse a second message about
-- the same fact. The claim table is a second, coarser floor underneath them,
-- and it is the ONLY floor `run_block_ended_notices` has ever had — part 471
-- explicitly decided it did not need one because "the condition is true on
-- exactly ONE day", which was true of a job that ran once a day and stops being
-- true the moment it runs hourly.
--
-- ══ 4 · THE ONE PASS THAT WRITES DATA AS WELL AS SENTENCES ═══════════════
--
-- `run_pack_expiry` closes a validity window: it reduces `sessions_total` to
-- `sessions_used` and stamps `expired_at`. Moving it to the coach's local
-- morning moves that closure by up to about half a day in either direction.
--
-- That is safe and it is already named. `packWindow` in src/lib/packExpiry.ts
-- returns 'lapsed' for exactly this gap — "the window between midnight and the
-- nightly pass" — and its comment says why: in that gap the credits are STILL
-- SPENDABLE, because nothing in the database stops a draw until the pass has
-- run. Both apps already render 'lapsed' as its own sentence. The gap gets
-- wider by hours; it does not get newer.
--
-- One row type is deliberately NOT gated: a purchase with a null `trainer_id`
-- has no coach to be told and no coach to be timed against, and gating it would
-- leave its window open forever. Those close at the first tick of the UTC day,
-- exactly once, and tell nobody — which is what they did before.
--
-- `run_open_slot_extension` writes rows too and notifies nobody at all, so the
-- hour is of no consequence to a sleeping coach. It is moved with the other
-- five rather than left behind, because six passes on one mechanism is a thing
-- somebody can hold in their head and five-plus-one is not, and because it
-- already does its date arithmetic in the coach's own zone (part 650) so the
-- local morning is where it belongs.
--
-- ══ 5 · WHAT THIS DOES NOT DO ════════════════════════════════════════════
--
-- It does not touch quiet hours. It does not need to: 07:00–09:00 local is
-- outside any quiet-hours range a person would set, so the suppression that
-- currently swallows these messages whole simply stops being reached. Whether
-- a suppressed push should be deferred rather than dropped is a real question
-- and it is a different one, in supabase/functions, which this part does not
-- own.
--
-- It does not change a single word any pass says, a single threshold, or a
-- single date comparison. Every body below is `pg_get_functiondef` output with
-- two lines added.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · Where a coach is
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public.notice_local_tz(p_user uuid)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select z.tz
    from (
      select (
        select q.tz from public.notify_quiet_hours q where q.user_id = p_user
      ) as tz
      union all
      select (
        select mode() within group (order by ta.tz)
          from public.trainer_availability ta
         where ta.trainer_id = p_user and ta.tz is not null
      )
    ) z
   where z.tz is not null
     and exists (select 1 from pg_timezone_names n where n.name = z.tz)
   limit 1;
$fn$;

revoke all on function public.notice_local_tz(uuid) from public, anon, authenticated;

comment on function public.notice_local_tz(uuid) is
  'The timezone a coach''s day runs on: notify_quiet_hours.tz first because the coach typed it about their own waking hours, then the most common trainer_availability.tz (part 650). Null when neither is set or the stored name is not a real zone, so a typo cannot make an hourly job raise.';


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · Whether it is that coach's morning
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public.notice_hour_due(p_user uuid, p_hour int)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select case
    when public.notice_local_tz(p_user) is null
      -- No zone. Exactly the hour they get today, because part 650's refusal to
      -- guess a zone holds and the fallback that cannot make anything worse is
      -- the status quo. One hour, not a window: this is a UTC clock and there
      -- is no transition to step over.
      then extract(hour from (now() at time zone 'UTC'))::int = p_hour
    else
      extract(hour from (now() at time zone public.notice_local_tz(p_user)))::int
        between p_hour and p_hour + 2
  end;
$fn$;

revoke all on function public.notice_hour_due(uuid, int) from public, anon, authenticated;

comment on function public.notice_hour_due(uuid, int) is
  'True when it is currently between p_hour and p_hour+2 in the coach''s own timezone — three hours so a zone that springs forward across p_hour still has a tick, and a missed run costs an hour rather than a day. For a coach with no stored zone, true only on the UTC hour itself, which is the hour they already get.';


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · Once, and once only, per coach per pass per UTC day
-- ═════════════════════════════════════════════════════════════════════════

create table if not exists public.notice_pass_runs (
  pass     text        not null,
  -- No foreign key. A coach id reaches this table from six different columns
  -- in six different tables, and a row in any of them that does not resolve to
  -- an auth user would turn a missing notification into a nightly raise. This
  -- table is bookkeeping about a run, not a statement about who exists.
  coach_id uuid        not null,
  utc_day  date        not null,
  ran_at   timestamptz not null default now(),
  primary key (pass, coach_id, utc_day)
);

alter table public.notice_pass_runs enable row level security;
-- No policy. This is the scheduler's own bookkeeping; the passes reach it as
-- SECURITY DEFINER and nobody signed in has any business reading it.

comment on table public.notice_pass_runs is
  'One row per (nightly pass, coach, UTC day), inserted by the tick that processes that coach. Keyed on the UTC day and not the coach''s local day because the passes themselves are written against current_date, so the unit of work is a UTC date and a claim on anything else can let one be evaluated twice across a DST transition.';

create or replace function public.claim_notice_pass(p_pass text, p_coaches uuid[], p_hour int)
returns uuid[]
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_claimed uuid[];
begin
  -- A week is more than long enough to answer "did today already run", and it
  -- keeps this table at coaches x six rows rather than growing forever.
  delete from public.notice_pass_runs where utc_day < current_date - 7;

  with ins as (
    insert into public.notice_pass_runs (pass, coach_id, utc_day)
    select p_pass, c, current_date
      from unnest(coalesce(p_coaches, '{}'::uuid[])) as c
     where public.notice_hour_due(c, p_hour)
    on conflict (pass, coach_id, utc_day) do nothing
    returning coach_id
  )
  select coalesce(array_agg(coach_id), '{}'::uuid[]) into v_claimed from ins;

  return coalesce(v_claimed, '{}'::uuid[]);
end $fn$;

revoke all on function public.claim_notice_pass(text, uuid[], int) from public, anon, authenticated;

comment on function public.claim_notice_pass(text, uuid[], int) is
  'The coaches this tick may process: those for whom it is currently the intended local hour AND for whom no tick has already claimed today. The claim and the decision are one statement, so two ticks racing cannot both win. Returns an empty array rather than null.';


-- ═════════════════════════════════════════════════════════════════════════
-- 4 · The six passes
--
-- Each body below is `pg_get_functiondef` output taken off the live database,
-- with exactly two additions marked `-- part 1890`:
--
--   · a `select public.claim_notice_pass(...) into v_due` before the loop, and
--   · one `= any(v_due)` in the driving query.
--
-- Nothing else is different. No sentence, no threshold, no date comparison and
-- no bookkeeping table. Read the diff and there should be two green lines and a
-- declaration in each.
-- ═════════════════════════════════════════════════════════════════════════

-- ── 4.1 · A client past their usual gap (part 202) ───────────────────────

create or replace function public.run_overdue_client_notices()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $fn$
declare
  c_window_days   constant int  := 56;
  c_min_active    constant int  := 4;
  c_min_span      constant int  := 14;
  c_max_gap       constant numeric := 21;
  c_late_fraction constant numeric := 0.5;
  c_min_late      constant int  := 3;
  v_sent integer := 0;
  r      record;
  v_due  uuid[];   -- part 1890
begin
  -- part 1890. The coaches whose morning it is and who have not been run today.
  -- Applied inside `book` rather than at the end so the percentile arithmetic
  -- over fifty-six days of check-ins, workouts, sessions and gym visits is done
  -- for one hour's worth of coaches and not for all of them, twenty-four times.
  select public.claim_notice_pass(
    'overdue-client-notices',
    (select coalesce(array_agg(distinct c.trainer_id), '{}'::uuid[])
       from public.clients c where c.trainer_id is not null),
    7) into v_due;
  for r in
    with book as (
      select c.id as client_id, c.trainer_id as coach_id
        from public.clients c
       where c.trainer_id is not null
         and c.trainer_id = any(v_due)   -- part 1890
    ),
    acts as (
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
           greatest(c_min_late::numeric, s.usual_gap * c_late_fraction) as tolerance
      from stats s
     where s.active_days >= c_min_active
       and (s.last_day - s.first_day) >= c_min_span
       and s.usual_gap is not null
       and s.usual_gap > 0
       and s.usual_gap <= c_max_gap
       and (s.since_last::numeric - s.usual_gap)
             > greatest(c_min_late::numeric, s.usual_gap * c_late_fraction)
  loop
    if exists (
      select 1 from public.coach_overdue_notices n
       where n.coach_id = r.coach_id
         and n.client_id = r.client_id
         and n.last_active_on = r.last_day
    ) then
      continue;
    end if;
    insert into public.coach_overdue_notices (coach_id, client_id, last_active_on, notified_at)
    values (r.coach_id, r.client_id, r.last_day, now())
    on conflict (coach_id, client_id)
      do update set last_active_on = excluded.last_active_on, notified_at = now();
    insert into public.notifications (user_id, title, body, icon, route)
    values (
      r.coach_id,
      'A client is past their usual gap',
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
  delete from public.coach_overdue_notices n
   where n.notified_at < now() - interval '400 days';
  return jsonb_build_object('sent', v_sent);
end $fn$;


-- ── 4.2 · A credential or insurance policy expiring (part 202) ───────────

create or replace function public.run_credential_expiry_notices()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $fn$
declare
  c_soon_days constant int := 60;
  v_sent integer := 0;
  r      record;
  v_due  uuid[];   -- part 1890
begin
  -- part 1890
  select public.claim_notice_pass(
    'credential-expiry-notices',
    (select coalesce(array_agg(distinct cr.coach_id), '{}'::uuid[])
       from public.coach_credentials cr
      where cr.coach_id is not null and cr.expires_on is not null),
    7) into v_due;
  for r in
    select cr.id, cr.coach_id, cr.kind, cr.title, cr.expires_on,
           (cr.expires_on - current_date) as days_left,
           case when cr.expires_on < current_date then 'expired' else 'expiring' end as stage
      from public.coach_credentials cr
     where cr.expires_on is not null
       and cr.expires_on <= current_date + c_soon_days
       and cr.expires_on >= current_date - 30
       and cr.coach_id = any(v_due)   -- part 1890
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


-- ── 4.3 · A block that reached the end of its last week (part 471) ───────
--
-- This is the pass the claim table matters most for. Part 471 decided against a
-- bookkeeping table because "the condition is true on exactly ONE day" — sound
-- for a job that runs once a day, and false the moment it runs twenty-four
-- times. `notice_pass_runs` is now that table.

create or replace function public.run_block_ended_notices()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_sent integer := 0;
  r      record;
  v_due  uuid[];   -- part 1890
begin
  -- part 1890
  select public.claim_notice_pass(
    'block-ended-notices',
    (select coalesce(array_agg(distinct a.coach_id), '{}'::uuid[])
       from public.assigned_programs a
      where a.coach_id is not null and a.starts_on is not null),
    7) into v_due;
  for r in
    select
      a.client_id,
      a.coach_id,
      a.starts_on,
      -- `weekCount` in src/lib/programBlock.ts, written out. No `weeks` array,
      -- or an empty one, is ONE week: the week that `days` describes.
      case
        when jsonb_typeof(a.program -> 'weeks') = 'array'
         and jsonb_array_length(a.program -> 'weeks') > 0
        then jsonb_array_length(a.program -> 'weeks')
        else 1
      end as weeks
      from public.assigned_programs a
     where a.coach_id is not null
       and a.starts_on is not null
       and a.coach_id = any(v_due)   -- part 1890
  loop
    -- The first day of `'after'`. `blockPosition` says 'after' when
    -- `floor(offset / 7) + 1 > weeks`, which is `offset >= weeks * 7`, so the
    -- boundary day is exactly this one. Equality and not `<=`: the condition
    -- being true for one day is what makes a bookkeeping table unnecessary.
    if current_date <> (r.starts_on + (r.weeks * 7)) then
      continue;
    end if;

    insert into public.notifications (user_id, title, body, icon, route)
    values (
      r.coach_id,
      'A block has run out',
      -- The name is theirs to give: the coach can already read it through
      -- `profiles_trainer_r_clients`, so this states nothing the recipient
      -- could not already see. A blank or missing name falls back to
      -- "A client", never to an empty string that would render a sentence
      -- starting with a space.
      left(
        coalesce(
          (select nullif(btrim(coalesce(p.full_name, '')), '') from public.profiles p where p.id = r.client_id),
          'A client'
        )
        || ' has reached the end of the ' || r.weeks || '-week block you gave them, which started on '
        || to_char(r.starts_on, 'DD Mon YYYY') || '.'
        || ' Nothing here says whether they did it — their Train tab is simply still showing them the last week,'
        || ' and it will go on showing it until you write the next one.',
        500),
      'dumbbell',
      '/(trainer)/builder'
    );
    v_sent := v_sent + 1;
  end loop;

  return jsonb_build_object('sent', v_sent);
end $fn$;
