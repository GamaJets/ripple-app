-- ═══════════════════════════════════════════════════════════════════════════
-- Five notice passes that have failed on every single run since part 1870.
-- APPLIED, in three parts, each verified. §1: all five passes now RUN —
-- run_pack_expiry returned {told:0, closed:0, digest_rows:0, digest_posts:0}
-- and the other four returned their own shapes, where every one of them had
-- raised 42883 on every run for 121 runs. §2: cron.job is now 12 jobs and
-- `cron-job-failure-alarm` is scheduled at 9 9 * * *; anon cannot execute it.
-- §3: the materialiser returns {failed: 0, series: 0, created: 0, skipped: 0}
-- — a `failed` count where there was none.
--
--
-- ── THE DEFECT, STATED EXACTLY ────────────────────────────────────────────
--
-- `run_notices_with_digest` (part 1870) groups a pass's held pushes and, when a
-- recipient has more than one, folds them into one worded digest:
--
--     with decided as (
--       select …, count(*) as n, … from repple_push_hold group by …
--     ),
--     worded as (
--       select …,
--              case when d.n = 1 then d.body
--                   else public.notification_digest_body(d.body, d.n - 1) end
--         from decided d
--     )
--
-- `count(*)` is `bigint`. `d.n - 1` is therefore `bigint`. The function is
-- declared `notification_digest_body(p_body text, p_more integer)`, and
-- bigint → integer is an ASSIGNMENT cast in Postgres, not an implicit one, so
-- it is not considered during function resolution. The call does not resolve:
--
--     ERROR: function public.notification_digest_body(text, bigint) does not exist
--
-- Reproduced on the live database, both directions:
--
--     select public.notification_digest_body('x', count(*) - 1)   from …  -- 42883
--     select public.notification_digest_body('x', (count(*) - 1)::integer) from … -- ok
--
-- ── WHY IT FAILS EVEN WHEN THERE IS NOTHING TO SEND ──────────────────────
--
-- This is not a bug that waits for a coach with two aged invoices. The `for r
-- in <query> loop` is PLANNED before its first row is fetched, and an
-- unresolvable function is a PLAN-time error. So the statement raises whether
-- `repple_push_hold` holds nine rows, one row, or none — which is why the
-- failure is total rather than occasional.
--
-- ── WHAT IT COST ─────────────────────────────────────────────────────────
--
-- Read off cron.job_run_details on the live database:
--
--     120 failed runs, 0 successful runs, 5 jobs,
--     from 2026-09-05 04:12 UTC to 2026-09-06 03:40 UTC — every run since 1870.
--
--     overdue-client-notices     12 * * * *   run_overdue_client_notices     (202)
--     credential-expiry-notices  19 * * * *   run_credential_expiry_notices  (202)
--     block-ended-notices        26 * * * *   run_block_ended_notices        (471)
--     pack-expiry                33 * * * *   run_pack_expiry                (612)
--     invoice-ageing-notices     40 * * * *   run_invoice_ageing_notices     (613)
--
-- A cron statement is one transaction, so the raise rolled back everything the
-- inner pass had just done. That is the one mercy in this: no coach was stamped
-- as told about something they were never told about, `notice_pass_runs` was
-- not falsely claimed, and `coach_invoice_ageing_notices` /
-- `coach_credential_notices` / `coach_overdue_notices` hold no phantom rows. The
-- bookkeeping is honest. It is simply that for a day and a night:
--
--   · no coach was told a client had gone quiet;
--   · no coach was told their insurance or a qualification had expired;
--   · no coach was told a training block had run out;
--   · no coach was told an invoice had crossed an ageing band;
--   · AND — the one that is not merely a missed message — `run_pack_expiry`
--     never ran, so no expired pack was closed. `client_purchases.expired_at`
--     stays null, `sessions_total` is never trimmed to `sessions_used`, and the
--     credits on a pack whose validity ran out remain bookable. That is a
--     WRITE the product depends on, not a notification.
--
-- `notifications` has 0 rows in the last 48 hours, which is the same fact from
-- the other end.
--
-- ── THE FIX ──────────────────────────────────────────────────────────────
--
-- One explicit cast, at the call site rather than on the function. Changing
-- `notification_digest_body`'s signature to bigint would leave an
-- `(text, integer)` overload behind for the next caller to resolve to by
-- accident, and part 1870 revokes execute on the `(text, integer)` identity by
-- name in three places. The call site is the thing that is wrong, so the call
-- site is what changes. `greatest(0, …)` inside the function already handles
-- the value; this is purely about which function the parser can find.
--
-- Everything else in this body is byte-for-byte part 1870's. It is restated in
-- full because `create or replace function` has no other form.
--
-- ── SECTION 2: WHY NOBODY NOTICED FOR A DAY ──────────────────────────────
--
-- The failure was loud in exactly one place — cron.job_run_details — and
-- nothing reads it. Part 1153 built precisely this alarm for the storage purge
-- queue (`check_storage_purge_backlog`, raising so that the failure lands in
-- the same table an operator is already looking at) and the notice lane never
-- got the equivalent. Section 2 is that alarm, in part 1153's shape.
--
-- It excludes ITSELF from what it checks. An alarm that raises makes its own
-- last run a failure, and one that then read that back would go on raising
-- after the real cause was fixed — a false alarm that can never be cleared.
--
-- Additive and idempotent; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · The cast
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public.run_notices_with_digest(p_fn text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_key    text;
  v_result jsonb;
  v_posts  integer := 0;
  v_rows   integer := 0;
  r        record;
begin
  if p_fn not in (
    'run_overdue_client_notices',
    'run_credential_expiry_notices',
    'run_block_ended_notices',
    'run_pack_expiry',
    'run_invoice_ageing_notices'
  ) then
    raise exception 'run_notices_with_digest: % is not one of the notice passes', p_fn;
  end if;

  -- `seq` is what makes "the first row's own words" a fact rather than
  -- whichever row the planner happened to return. It is the order the pass
  -- wrote them in, which is the order of its own select — deterministic, and
  -- not claimed to be a ranking of urgency.
  create temp table if not exists repple_push_hold (
    seq     bigint generated always as identity,
    user_id uuid not null,
    channel text not null,
    title   text not null,
    body    text not null,
    route   text not null
  ) on commit drop;
  delete from repple_push_hold;

  perform set_config('repple.push_hold', 'on', true);
  begin
    execute format('select public.%I()', p_fn) into v_result;
  exception when others then
    -- The hold must come off even when the pass fails, or a later statement in
    -- this transaction would buffer a push nobody ever sends.
    perform set_config('repple.push_hold', 'off', true);
    raise;
  end;
  perform set_config('repple.push_hold', 'off', true);

  select count(*) into v_rows from repple_push_hold;

  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name = 'storage_service_key'
   limit 1;
  if v_key is null or v_key = '' then
    -- Nothing to post with. The rows are written and claimed, exactly as they
    -- are when part 900's dispatcher finds no key.
    return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('digest_rows', v_rows, 'digest_posts', 0);
  end if;

  for r in
    -- Stage one: per recipient per (channel, route), decide the ONE message.
    with decided as (
      select h.user_id,
             h.channel,
             h.route,
             count(*)                                          as n,
             (array_agg(h.title order by h.seq))[1]            as title,
             (array_agg(h.body  order by h.seq))[1]            as body
        from repple_push_hold h
       group by h.user_id, h.channel, h.route
    ),
    worded as (
      select d.user_id, d.channel, d.route, d.title,
             case when d.n = 1 then d.body
                  -- ── THE LINE THIS PART EXISTS FOR ────────────────────────
                  -- `d.n` is count(*), which is bigint. Without this cast the
                  -- parser looks for notification_digest_body(text, bigint),
                  -- finds only (text, integer), and refuses — at PLAN time, so
                  -- the whole pass raises even with nothing to send. See the
                  -- header: 120 consecutive failed runs across five jobs.
                  else public.notification_digest_body(d.body, (d.n - 1)::integer) end as body
        from decided d
    )
    -- Stage two: identical messages share a post, which is what part 900's
    -- dispatcher does for forty members of a cancelled class. Two coaches with
    -- one aged invoice each get one post with two ids; two coaches with nine
    -- each get two, because their bodies name different invoices.
    select w.channel, w.title, w.body, w.route,
           array_agg(distinct w.user_id) as user_ids
      from worded w
     group by w.channel, w.title, w.body, w.route
  loop
    perform net.http_post(
      url     := 'https://phgfwzpkkwdysftlgkoq.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_key,
        'apikey',        v_key
      ),
      body    := jsonb_build_object(
        'user_ids', to_jsonb(r.user_ids),
        'title',    r.title,
        'body',     r.body,
        'channel',  r.channel,
        'data',     case when r.route = '' then '{}'::jsonb
                         else jsonb_build_object('route', r.route) end
      )
    );
    v_posts := v_posts + 1;
  end loop;

  -- Counted, and the two figures are the point: `digest_rows` is what was
  -- written and `digest_posts` is what buzzed. They were equal before this
  -- part, and cron.job_run_details keeps the answer, so the saving is
  -- measurable rather than asserted.
  return coalesce(v_result, '{}'::jsonb)
         || jsonb_build_object('digest_rows', v_rows, 'digest_posts', v_posts);
end
$function$;

revoke all on function public.run_notices_with_digest(text) from public;
revoke all on function public.run_notices_with_digest(text) from anon;
revoke all on function public.run_notices_with_digest(text) from authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · The alarm the notice lane never had
-- ═════════════════════════════════════════════════════════════════════════
--
-- Part 1153's shape: raise, so that a scheduled job's failure appears in the
-- one table an operator already reads, rather than in a channel nobody has.
--
-- What it checks is the LATEST run of each job, not the history. A job that
-- failed at 03:12 and succeeded at 04:12 has recovered and is not news; a job
-- whose most recent run failed is currently broken. `where d.end_time is not
-- null` skips a run still in flight, whose status is 'running'.
--
-- The 26-hour cutoff is so that a job which has been UNSCHEDULED — its history
-- still in the table, its last run days old — does not raise forever. It is
-- deliberately longer than the slowest job's interval (daily) so that a daily
-- job's single failure is still caught on the next morning's check.

create or replace function public.check_cron_job_failures()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n     int;
  v_list  text;
begin
  with latest as (
    select distinct on (d.jobid)
           d.jobid, d.status, d.end_time, d.return_message
      from cron.job_run_details d
     where d.end_time is not null
     order by d.jobid, d.end_time desc
  )
  select count(*),
         string_agg(
           j.jobname || ' (last ran ' || to_char(l.end_time, 'YYYY-MM-DD HH24:MI')
             || ' UTC) — ' || left(coalesce(l.return_message, '(no message)'), 300),
           E'\n  · ' order by j.jobname)
    into v_n, v_list
    from latest l
    join cron.job j on j.jobid = l.jobid
   where l.status = 'failed'
     and l.end_time > now() - interval '26 hours'
     -- Never itself. This function raises as its alarm, which makes its own
     -- last run a failure; reading that back would mean it could never stop
     -- raising once it had raised even once.
     and j.jobname <> 'cron-job-failure-alarm';

  if coalesce(v_n, 0) = 0 then
    return;
  end if;

  raise exception
    'SCHEDULED JOB FAILING: % job(s) whose most recent run failed:%',
    v_n, E'\n  · ' || v_list;
end
$function$;

revoke all on function public.check_cron_job_failures() from public;
revoke all on function public.check_cron_job_failures() from anon;
revoke all on function public.check_cron_job_failures() from authenticated;

comment on function public.check_cron_job_failures() is
  'Raises when any pg_cron job''s most recent run failed within the last 26 hours, so that a silently-failing scheduled pass lands in cron.job_run_details where an operator is already looking. Part 1153 does the same for the storage purge queue. Excludes itself, because it signals by raising.';

do $$
begin
  if exists (select 1 from cron.job where jobname = 'cron-job-failure-alarm') then
    perform cron.unschedule('cron-job-failure-alarm');
  end if;
end $$;

select cron.schedule(
  'cron-job-failure-alarm',
  '9 9 * * *',
  $cron$ select public.check_cron_job_failures(); $cron$
);


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · The standing appointment that stops materialising and says nothing
-- ═════════════════════════════════════════════════════════════════════════
--
-- `run_session_series_materialiser` (part 135, cron `materialise-session-
-- series`, 17 3 * * *) loops over every active series and calls
-- `_materialise_session_series` for each, wrapped in:
--
--     exception when others then
--       continue;
--
-- The per-series isolation is RIGHT and is kept below: one series with a bad
-- timezone, a deleted trainer or a clash the inner function cannot resolve must
-- not stop the other coaches' standing appointments being written. That was a
-- deliberate decision and this part does not reverse it.
--
-- What is wrong is that `continue` is the WHOLE of the handling. The failure is
-- not counted, not logged, and not in the returned jsonb — and `v_series` is
-- incremented AFTER the call, so a series that raises is not even counted as
-- attempted. The job then returns normally and cron.job_run_details records
-- `succeeded`. A client whose Tuesday 07:00 with their coach simply stops
-- appearing four weeks out is indistinguishable, from every surface an operator
-- has, from a night on which there was nothing to do. That is the exact shape
-- this file's section 1 was written about, sitting one job away from it.
--
-- The change is the smallest one that removes the silence:
--
--   · `v_failed` counts them, and goes into the returned jsonb alongside the
--     rest, so a caller running this by hand sees it;
--   · a `raise warning` names the series id and SQLERRM. A warning does not
--     abort the transaction and does not fail the cron run — the good series
--     still commit, which is the point of the isolation — but it lands in the
--     Postgres log, which is a place somebody can actually look. `continue`
--     writes to nowhere at all.
--
-- Deliberately NOT an exception: raising at the end of the loop would roll back
-- every series that succeeded, which would turn one broken series into a night
-- on which nobody's standing appointment was written.

create or replace function public.run_session_series_materialiser(p_horizon_days integer default 56)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id      uuid;
  v_rep     jsonb;
  v_series  int := 0;
  v_created int := 0;
  v_skipped int := 0;
  v_failed  int := 0;
begin
  for v_id in
    select ss.id from session_series ss
     where ss.status = 'active'
       and (ss.ends_on is null or ss.ends_on >= (now() at time zone ss.tz)::date)
     order by ss.created_at
  loop
    begin
      v_rep := public._materialise_session_series(v_id, p_horizon_days);
      v_series  := v_series + 1;
      v_created := v_created + (v_rep->>'created')::int;
      v_skipped := v_skipped + (v_rep->>'skipped')::int;
    exception when others then
      -- Isolation kept, silence removed. See the header for why this is a
      -- warning and not a raise.
      v_failed := v_failed + 1;
      raise warning
        'run_session_series_materialiser: series % did not materialise — % (%)',
        v_id, sqlerrm, sqlstate;
      continue;
    end;
  end loop;
  return jsonb_build_object('series', v_series, 'created', v_created,
                            'skipped', v_skipped, 'failed', v_failed);
end
$function$;

revoke all on function public.run_session_series_materialiser(integer) from public;
revoke all on function public.run_session_series_materialiser(integer) from anon;
revoke all on function public.run_session_series_materialiser(integer) from authenticated;
