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
-- ── where "03:17" came from, which is the tell ───────────────────────────
--
-- All four headers name the same hypothetical time, 03:17, and it is not
-- hypothetical: `materialise-session-series` (part 135) is scheduled
-- '17 3 * * *'. Part 202 took the shape of a REAL small-hours job as its
-- example of what not to do, moved the hour to 7 and kept the odd minute, and
-- the three parts after it copied the reasoning across.
--
-- The example was the wrong one to reason from. Part 135's job writes no
-- notification at all — `grep 'insert into public.notifications'` over that
-- file returns nothing — so 03:17 UTC has never woken anybody, and the
-- comparison that felt like it settled the question could not have.
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
-- ── HOW MANY COACHES THIS ACTUALLY REACHES TODAY, MEASURED ───────────────
--
-- Probed read-only against production, with the exact expression
-- `notice_local_tz` uses:
--
--   coaches 8 · with a zone 1 (Asia/Dubai) · without 7
--
-- So on the day this is applied, seven of eight coaches keep 07:00 UTC and one
-- moves to their own morning. That is not an argument against the part; it is
-- the shape of the thing. `notify_quiet_hours.tz` is NOT NULL, so every coach
-- who ever sets quiet hours acquires a zone, and part 650 already made
-- src/ui/availability.ts stamp the device zone on every availability write. The
-- population with a zone only grows, and this part is what turns having one
-- into a notification that arrives in the morning rather than at three.
--
-- It also means the blast radius on the first night is one coach, which is the
-- right size for a change to when six nightly jobs fire.
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
--
-- And it does not undo part 1870. That part, written the same night and also
-- unapplied, re-points the same five notice jobs at
-- `run_notices_with_digest()` so that nine invoices ageing on one night are one
-- banner rather than nine. Both parts schedule the same job names, and a job
-- has one command; section 6 is where they are reconciled, and the short of it
-- is that 1870 owns the COMMAND and this part owns the SCHEDULE.
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
--
-- That claim was checked by a machine rather than by eye. Each body below was
-- extracted from this file, the marked additions removed, all whitespace
-- stripped and md5'd, and the same md5 taken of `pg_proc.prosrc` on the live
-- database. All six matched:
--
--   run_overdue_client_notices     57085b56f3d9726bc7851b30a5064912
--   run_credential_expiry_notices  a8611475d313398119827e86e7a9f4d1
--   run_block_ended_notices        b5ec1af17be708d778de1d18a297a41f
--   run_pack_expiry                91957d05b60a8b62086a82c442f1af88
--   run_invoice_ageing_notices     702ae931d656f0a93677e93c6afde891
--   run_open_slot_extension        17c9191eea4e4bc2c19320ee6ef9113a
--
-- Anybody re-checking this can reproduce it with
--   select proname, md5(regexp_replace(prosrc, '\s', '', 'g')) from pg_proc …
-- BEFORE this part is applied.
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


-- ── 4.4 · A session pack whose validity ran out (part 612) ───────────────
--
-- The one pass that writes data as well as sentences. See section 4 of the
-- header for why the closure moving by up to half a day is safe, and why a
-- purchase with no `trainer_id` is deliberately not gated.

create or replace function public.run_pack_expiry()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_closed integer := 0;
  v_told   integer := 0;
  v_lost   integer;
  r        record;
  v_due    uuid[];   -- part 1890
begin
  -- part 1890
  select public.claim_notice_pass(
    'pack-expiry',
    (select coalesce(array_agg(distinct cp.trainer_id), '{}'::uuid[])
       from public.client_purchases cp
      where cp.trainer_id is not null
        and cp.expires_on is not null
        and cp.expired_at is null),
    7) into v_due;
  for r in
    select cp.id, cp.client_id, cp.trainer_id, cp.expires_on
      from public.client_purchases cp
     where cp.expires_on is not null
       and cp.expired_at is null
       and cp.sessions_total is not null
       -- The day AFTER the last day. `expires_on` is the last day the credits
       -- can be used, so a pack is still live all of the day it names.
       and cp.expires_on < current_date
       and cp.status = 'paid'
       -- part 1890. A pack with no coach on it has nobody to be told and
       -- nobody to be timed against; gating it would leave its window open
       -- forever, so it closes on the first tick of the day as it always did.
       and (cp.trainer_id is null or cp.trainer_id = any(v_due))
  loop
    -- The count that goes in the message comes back out of the WRITE, not out
    -- of the select above. A booking between the two would draw a credit the
    -- select had already counted as lost, and the coach would be told a number
    -- one too high about somebody's money.
    v_lost := null;
    update public.client_purchases cp
       set sessions_total    = coalesce(cp.sessions_used, 0),
           sessions_expired  = greatest(0, cp.sessions_total - coalesce(cp.sessions_used, 0)),
           expired_at        = now()
     where cp.id = r.id
       and cp.expired_at is null
    returning cp.sessions_expired into v_lost;
    if v_lost is null then
      continue;
    end if;
    v_closed := v_closed + 1;
    -- Only when credits were actually lost. A pack that ran out of time with
    -- nothing on it is not news: part 163 already told the coach on the day the
    -- last session was used.
    if v_lost > 0 and r.trainer_id is not null then
      insert into public.notifications (user_id, title, body, icon, route)
      values (
        r.trainer_id,
        'A session pack has run out of time',
        left(
          coalesce(
            (select nullif(btrim(coalesce(p.full_name, '')), '') from public.profiles p where p.id = r.client_id),
            'A client'
          )
          || ' had ' || v_lost || ' session' || case when v_lost = 1 then '' else 's' end
          || ' left on a pack whose validity ran out on ' || to_char(r.expires_on, 'DD Mon YYYY') || '.'
          || ' Those credits can no longer be booked against, and they paid for them.'
          || ' Whether you extend it, sell them something else or leave it is yours to decide — but they will notice, and it is better that you raise it.'
          || ' Payments & Packages has the pack and what it was worth.',
          500),
        'grid',
        '/(trainer)/payments'
      );
      v_told := v_told + 1;
    end if;
  end loop;
  return jsonb_build_object('closed', v_closed, 'told', v_told);
end $fn$;


-- ── 4.5 · An invoice ageing into a new band (part 613) ───────────────────

create or replace function public.run_invoice_ageing_notices()
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
    'invoice-ageing-notices',
    (select coalesce(array_agg(distinct i.coach_id), '{}'::uuid[])
       from public.coach_invoices i
      where i.coach_id is not null
        and i.kind = 'requested'
        and i.voided_at is null
        and i.due_on is not null),
    7) into v_due;
  for r in
    select i.id, i.coach_id, i.seq, i.bill_to, i.due_on, i.reminder_count,
           (current_date - i.due_on) as days_late,
           case
             when (current_date - i.due_on) <= 7  then '1-7'
             when (current_date - i.due_on) <= 30 then '8-30'
             when (current_date - i.due_on) <= 60 then '31-60'
             else '61+'
           end as bucket
      from public.coach_invoices i
     where
       -- Only what the coach is ASKING for. A 'received' invoice is their own
       -- statement that the money came in, and `invoiceAge()` calls it settled.
       i.kind = 'requested'
       -- A voided invoice is on no list at all.
       and i.voided_at is null
       -- No due date is not "not due" — it is the coach never having stated one.
       and i.due_on is not null
       -- Past the day itself; the due date is 'due-today', not overdue.
       and i.due_on < current_date
       -- Nothing that fell due before this feature existed, so switching it on
       -- does not produce an inbox of history. Ninety days, because the last
       -- band opens at sixty-one and a shorter window could never reach it.
       and i.due_on >= current_date - 90
       and i.coach_id = any(v_due)   -- part 1890
  loop
    if exists (
      select 1 from public.coach_invoice_ageing_notices n
       where n.invoice_id = r.id and n.bucket = r.bucket
    ) then
      continue;
    end if;
    -- Written BEFORE the notification, per part 202: if the notification fails
    -- the whole iteration rolls back and the coach is told tomorrow; the other
    -- order would tell them again every night forever.
    insert into public.coach_invoice_ageing_notices (invoice_id, bucket, notified_at)
    values (r.id, r.bucket, now())
    on conflict (invoice_id, bucket) do nothing;
    insert into public.notifications (user_id, title, body, icon, route)
    values (
      r.coach_id,
      case when r.bucket = '1-7' then 'An invoice has gone past its date'
           else 'An invoice is still unpaid' end,
      left(
        'Invoice ' || r.seq || ' to ' || coalesce(nullif(btrim(coalesce(r.bill_to, '')), ''), 'a client')
        || ' was due on ' || to_char(r.due_on, 'DD Mon YYYY') || ', which is '
        || r.days_late || ' day' || case when r.days_late = 1 then '' else 's' end || ' ago.'
        || case
             when coalesce(r.reminder_count, 0) = 0 then ' You have not chased it yet.'
             when r.reminder_count = 1 then ' You have chased it once.'
             else ' You have chased it ' || r.reminder_count || ' times.'
           end
        || ' Nothing tells this app when a client pays you, so if they already have,'
        || ' void this one or record what you were paid — otherwise it goes on ageing.'
        || ' Invoices has the amount and the chase.',
        500),
      'grid',
      '/(trainer)/invoices'
    );
    v_sent := v_sent + 1;
  end loop;
  delete from public.coach_invoice_ageing_notices n
   where n.notified_at < now() - interval '400 days';
  return jsonb_build_object('sent', v_sent);
end $fn$;


-- ── 4.6 · Topping the open-slot window back up (part 650) ────────────────
--
-- The one pass that wakes nobody. Moved with the other five for the reason in
-- section 4 of the header: it already does its date arithmetic in the coach's
-- own zone, so the coach's own morning is where it belongs, and six passes on
-- one mechanism is a thing somebody can hold in their head.
--
-- `v_nozone` and `v_coaches` are deliberately still counted across the WHOLE
-- table and not across `v_due`. They answer "how many coaches cannot be
-- extended", which is a number that should be falling — an hourly figure of
-- "how many were in this tick" would be a different and useless one.

create or replace function public.run_open_slot_extension(p_horizon_days integer DEFAULT 28)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_created  int := 0;
  v_skipped  int := 0;
  v_nozone   int := 0;
  v_coaches  int := 0;
  a          record;
  v_today    date;
  v_horizon  date;
  v_date     date;
  v_ts       timestamptz;
  v_tenant   uuid;
  v_due      uuid[];   -- part 1890
begin
  -- part 1890
  select public.claim_notice_pass(
    'open-slot-extension',
    (select coalesce(array_agg(distinct ta.trainer_id), '{}'::uuid[])
       from public.trainer_availability ta where ta.tz is not null),
    7) into v_due;
  -- Counted before the loop so the figure is "how many coaches cannot be
  -- extended", which is the number that should be falling, rather than "how
  -- many rows were skipped tonight".
  select count(distinct trainer_id) into v_nozone
    from public.trainer_availability where tz is null;
  for a in
    select ta.id, ta.trainer_id, ta.dow, ta.hour, coalesce(ta.minute, 0) as minute,
           coalesce(ta.dur, 60) as dur, ta.tz
      from public.trainer_availability ta
     where ta.tz is not null
       and ta.trainer_id = any(v_due)   -- part 1890
     order by ta.trainer_id, ta.dow, ta.hour
  loop
    select t.tenant_id into v_tenant from public.trainers t where t.id = a.trainer_id;
    -- The coach's own today, not the server's. A job running at 02:00 UTC is
    -- still yesterday in Los Angeles, and generating from the server's date
    -- would miss a day at one end of the world and duplicate one at the other.
    v_today   := (now() at time zone a.tz)::date;
    v_horizon := v_today + greatest(p_horizon_days, 0);
    -- Forward to the first matching weekday. `extract(dow …)` is 0 = Sunday,
    -- which is exactly what `trainer_availability.dow` has meant since part 24.
    v_date := v_today + ((a.dow - extract(dow from v_today)::int + 7) % 7);
    while v_date <= v_horizon loop
      v_ts := (v_date + make_time(a.hour, a.minute, 0)) at time zone a.tz;
      if v_ts > now()
         and not exists (
           select 1 from public.sessions s
            where s.trainer_id = a.trainer_id
              and s.starts_at = v_ts
         )
      then
        begin
          insert into public.sessions (trainer_id, client_id, starts_at, duration_min, status, tenant_id)
          values (a.trainer_id, null, v_ts, a.dur, 'available', v_tenant);
          v_created := v_created + 1;
        exception when exclusion_violation then
          -- The coach is already busy across this hour with something that does
          -- not start exactly on it. Their diary, not ours to rearrange.
          v_skipped := v_skipped + 1;
        end;
      else
        v_skipped := v_skipped + 1;
      end if;
      v_date := v_date + 7;
    end loop;
  end loop;
  select count(distinct trainer_id) into v_coaches
    from public.trainer_availability where tz is not null;
  return jsonb_build_object(
    'created', v_created,
    'skipped', v_skipped,
    'coaches', v_coaches,
    'coaches_without_a_zone', v_nozone);
end $fn$;


revoke all on function public.run_overdue_client_notices() from public, anon, authenticated;
revoke all on function public.run_credential_expiry_notices() from public, anon, authenticated;
revoke all on function public.run_block_ended_notices() from public, anon, authenticated;
revoke all on function public.run_pack_expiry() from public, anon, authenticated;
revoke all on function public.run_invoice_ageing_notices() from public, anon, authenticated;
revoke all on function public.run_open_slot_extension(int) from public, anon, authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 5 · Nobody gets one at five in the afternoon on the day this ships
-- ═════════════════════════════════════════════════════════════════════════
--
-- The gate is `local hour between 7 and 9`, so if this part is applied at, say,
-- 16:00 in Sydney, every Australian coach's very first hourly tick finds them
-- past the window and does nothing — correct. But a coach whose local hour is
-- 8 right now would fire within the minute, at a time they had no reason to
-- expect anything.
--
-- So today is claimed in advance for every coach who is ALREADY past the start
-- of their window. Coaches whose 07:00 has not happened yet are left alone and
-- get their first properly-timed notification this morning. Nobody is claimed
-- who would not otherwise have fired today, and nobody fires at an hour they
-- would find strange.

insert into public.notice_pass_runs (pass, coach_id, utc_day)
select p.pass, c.coach_id, current_date
  from (values
        ('overdue-client-notices'),
        ('credential-expiry-notices'),
        ('block-ended-notices'),
        ('pack-expiry'),
        ('invoice-ageing-notices'),
        ('open-slot-extension')) as p(pass)
 cross join (
   select distinct t.id as coach_id from public.trainers t
 ) c
 where case
   when public.notice_local_tz(c.coach_id) is null
     then extract(hour from (now() at time zone 'UTC'))::int > 7
   else extract(hour from (now() at time zone public.notice_local_tz(c.coach_id)))::int > 9
 end
on conflict (pass, coach_id, utc_day) do nothing;


-- ═════════════════════════════════════════════════════════════════════════
-- 6 · The schedule
--
-- Hourly, each on the minute it already used. The minutes are kept exactly as
-- parts 202, 471, 612, 613 and 650 set them — seven apart, off the top of the
-- hour — so the six still do not contend, and so that anybody reading
-- `cron.job` sees the same six numbers they saw before with the hour opened up.
--
-- ══ RECONCILED WITH PART 1870, WHICH RE-POINTS THE SAME FIVE JOBS ════════
--
-- `supabase/parts/1870-nine-invoices-and-nine-banners.sql` was written the same
-- night as this part and is also unapplied. It fixes a different defect in the
-- same six jobs: each pass inserts one row at a time in a loop, and part 900's
-- `notifications_dispatch_push` is `for each statement`, so a coach with nine
-- invoices ageing on one night gets nine separate banners inside a minute. Part
-- 1870 adds `run_notices_with_digest(p_fn text)`, which holds the dispatcher for
-- the length of the pass and then posts ONE push per recipient per channel and
-- route, and it re-points the five NOTIFYING jobs at that wrapper.
--
-- Both parts therefore call `cron.schedule` on the same five job names, and a
-- cron job has exactly one command and one schedule. Applied in number order,
-- this part runs second and would have silently undone the digest.
--
-- It does not, because the two changes compose exactly:
--
--   · 1870 decides HOW WHAT A PASS WRITES IS ANNOUNCED. Its wrapper takes the
--     pass name as an argument specifically so it can wrap any of them, and
--     calls the pass unaltered.
--   · this part decides WHICH COACHES A PASS RUNS FOR, and at what hour. That
--     lives inside the pass body, in a claim and an `= any(v_due)`, where the
--     wrapper cannot see it and does not need to.
--
-- So the command below is 1870's, and only the SCHEDULE is this part's. Every
-- notification a coach receives is digested by 1870's rules and timed by this
-- part's, and neither had to know about the other.
--
-- ── the two things that had to be checked rather than assumed ────────────
--
-- The wrapper refuses any name that is not one of the five notice passes, so
-- 'open-slot-extension' cannot be routed through it — which is what part 1870
-- wanted anyway, in its own words: it "extends open slots and writes no
-- notifications, so there is nothing for a digest to coalesce and wrapping it
-- would be a claim that it notifies." It is scheduled bare here, as it is
-- there.
--
-- And the digest is per RUN, not per day. Hourly runs mean each hour's cohort
-- of coaches gets its own digest, which is the correct grain: a coach is
-- processed in exactly one run per UTC day (section 3), so every row that pass
-- writes for them is written inside one transaction and coalesces into one
-- push. Nothing is spread across hours for one person.
--
-- ── the jobs this part ends up owning, for verification ──────────────────
--
--   overdue-client-notices     12 * * * *  run_notices_with_digest('run_overdue_client_notices')
--   credential-expiry-notices  19 * * * *  run_notices_with_digest('run_credential_expiry_notices')
--   block-ended-notices        26 * * * *  run_notices_with_digest('run_block_ended_notices')
--   pack-expiry                33 * * * *  run_notices_with_digest('run_pack_expiry')
--   invoice-ageing-notices     40 * * * *  run_notices_with_digest('run_invoice_ageing_notices')
--   open-slot-extension        48 * * * *  run_open_slot_extension()
--
-- No other cron job is touched by this part. `materialise-session-series`,
-- `purge-account-files`, `purge-progress-photo-files`,
-- `storage-purge-backlog-alarm` and `sweep-stale-visits` are left exactly as
-- they are.
-- ═════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;

do $$
declare
  j record;
begin
  for j in
    select * from (values
      ('overdue-client-notices',    '12 * * * *', 'run_overdue_client_notices'),
      ('credential-expiry-notices', '19 * * * *', 'run_credential_expiry_notices'),
      ('block-ended-notices',       '26 * * * *', 'run_block_ended_notices'),
      ('pack-expiry',               '33 * * * *', 'run_pack_expiry'),
      ('invoice-ageing-notices',    '40 * * * *', 'run_invoice_ageing_notices')
    ) as v(jobname, sched, fn)
  loop
    if exists (select 1 from cron.job where jobname = j.jobname) then
      perform cron.unschedule(j.jobname);
    end if;
    -- Part 1870's command, verbatim. Only `sched` is this part's.
    perform cron.schedule(
      j.jobname,
      j.sched,
      format('select public.run_notices_with_digest(%L);', j.fn)
    );
  end loop;

  -- The one pass that notifies nobody, so there is nothing to digest.
  if exists (select 1 from cron.job where jobname = 'open-slot-extension') then
    perform cron.unschedule('open-slot-extension');
  end if;
  perform cron.schedule(
    'open-slot-extension',
    '48 * * * *',
    $cron$ select public.run_open_slot_extension(); $cron$
  );
end $$;
