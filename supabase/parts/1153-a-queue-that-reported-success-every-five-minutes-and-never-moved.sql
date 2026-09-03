-- ═══════════════════════════════════════════════════════════════════════════
-- A queue that reported success every five minutes and never moved.
--
-- ── WHAT IS WRONG ─────────────────────────────────────────────────────────
--
-- This one is not hypothetical. It is happening on this project right now, and
-- the numbers below were read out of the live database on 3 Sep 2026 rather
-- than reasoned about:
--
--     select * from public.photo_purge;
--
--       path             tf/verify/a.jpg
--       queued_at        2026-08-31 20:34:05Z
--       attempts         0
--       last_attempt_at  null
--       request_id       null
--       purged_at        null
--       note             'path is not in the expected <uid>/<name> shape — not sent'
--
--     select jobid, status, count(*), max(start_time) from cron.job_run_details
--      where jobid = 1 group by 1, 2;
--
--       1   succeeded   2335   2026-09-03 10:25:00Z
--
-- One row has been pending for three days. The drain that is supposed to clear
-- it has run two thousand three hundred and thirty-five times in that window,
-- and every single run is recorded as `succeeded`. There is no failed run
-- anywhere in `cron.job_run_details` for any job on this project.
--
-- Three separate things make that possible, and each has to be fixed or the
-- next stuck row is invisible in the same way:
--
--   1 · `purge_photo_file()` (part 45) refuses a badly shaped path by writing a
--       note — and it writes NOTHING ELSE. `attempts` stays at 0 and
--       `last_attempt_at` stays null. So a row that has been refused 864 times
--       is indistinguishable, in every column an operator would sort or filter
--       on, from a row queued one second ago that has never been looked at.
--
--   2 · `purge_progress_photo_files()` (part 45) selects `order by queued_at
--       limit 200`. A permanently refused row is the oldest thing in the queue
--       by definition — it never leaves — so it sits at the head of the window
--       for ever, and once there are 200 of them no new file is ever sent. Part
--       1120 already spotted the ordering half of this and wrote `order by
--       attempts, queued_at`, but that fix depends on `attempts` being
--       incremented, which is fault 1, so on its own it would have moved the
--       stuck rows to the front instead of the back.
--
--   3 · NOTHING LOOKS. `grep -rn 'job_run_details\|photo_purge' src studio-web
--       app web scripts supabase/functions` returns nothing at all. There is no
--       screen, no export, no check script and no alert. The only signal a
--       stalled purge produces is a row sitting still in a table that nobody
--       queries, and pg_cron's own record — which says `succeeded`, because the
--       function returned without raising, which it does whether it moved two
--       hundred files or none.
--
-- ── WHAT IT DOES TO A REAL PERSON ────────────────────────────────────────
--
-- A member deletes their account. Their progress photographs — the ones part 45
-- describes as pictures people take of themselves in a bathroom in their
-- underwear — are queued for destruction, and one of them has a key the sender
-- will not accept. It is refused every five minutes for ever. The account is
-- gone, the row is gone, the app tells the member their photographs are removed
-- by a scheduled job, and the photograph is still there. Nobody finds out,
-- because the job that is failing to remove it is reporting success on a
-- schedule.
--
-- This is the same defect as `request_account_deletion()` writing a timestamp
-- nothing read (part 41), and as the queue part 48 had to schedule because
-- nothing was draining it. Both of those were found by somebody reading the
-- code. This one has been running for three days.
--
-- ── THE THREE FIXES, AND WHY THE THIRD IS SHAPED LIKE THAT ───────────────
--
-- 1 and 2 are one line each and are taken from `pg_get_functiondef` verbatim
-- with only the wrong lines changed. Part 1152 § 4 makes the identical
-- correction to `purge_stored_object()`, which inherited the same refusal
-- branch from part 45; the two are deliberately the same shape.
--
-- 3 is the interesting one, because a view nobody opens is not visibility.
-- Part 1120 added `file_purge_backlog` and it is the right thing to have, but
-- its own operator note is honest about what it is: "the one query an operator
-- runs". Somebody has to run it.
--
-- So the alarm is a SECOND cron job whose only job is to fail. It reads the two
-- queues, and if anything has been outstanding for more than a day it raises an
-- exception. It writes nothing, so there is nothing for the exception to roll
-- back, and pg_cron records a raised exception as `status = 'failed'` with the
-- message in `return_message` — which is the row the Supabase dashboard's cron
-- view shows in red and which
--
--     select jobname, start_time, return_message from cron.job_run_details d
--       join cron.job j using (jobid) where d.status <> 'succeeded'
--      order by start_time desc;
--
-- returns. That is a real signal in a place somebody already looks, produced by
-- the scheduler this product already depends on, with no new table, no new
-- service and no email.
--
-- It is deliberately NOT part of the drain. Raising inside
-- `purge_account_files()` or `purge_progress_photo_files()` would roll back the
-- confirmations and the sends that run had just made — the alarm would destroy
-- the progress it was complaining about the absence of. Separate job, separate
-- transaction, once a day.
--
-- ── THE ONE ROW THAT IS STUCK TODAY, AND WHY IT IS DELETED RATHER THAN
--    MARKED PURGED ───────────────────────────────────────────────────────
--
-- `tf/verify/a.jpg` is not a member's photograph. The `photos` bucket holds
-- zero objects (verified live, and part 1122 records the same count), the key
-- has three segments where a progress photo has two, and the first segment is
-- `tf` rather than a uuid — no code path in this product can produce it. It is
-- what its name says it is: a row left behind by somebody verifying that part
-- 45's refusal branch works. It does work. That is the only thing it proves.
--
-- It is DELETED from the queue, and specifically NOT stamped `purged_at`.
-- Stamping it would be the one thing part 1120 says must never happen —
-- "Nothing in here marks a file deleted because it asked nicely" — and would
-- put a permanent lie in the record: a row claiming storage confirmed the
-- removal of a file that no request was ever sent for. Removing the row says
-- something different and true: this was never a member's file and does not
-- belong in a queue of member files.
--
-- The delete is guarded four ways and fires only on that exact row, in that
-- exact state, with no object behind it. If any of that has changed by the time
-- this is applied, it matches nothing and the alarm in section 3 tells you
-- about the row instead. That is the correct failure.
--
-- ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────
--
--   · It does not widen `purge_photo_file()` to accept the path it refused.
--     The shape check is what stops a malformed key being pasted into a URL
--     where it could address a different object, and part 45 is right to have
--     it. A refused path should be loud, not accepted.
--   · It does not give up on a row after N attempts. A file whose deletion
--     keeps failing must stay queued: the alternative is a queue that
--     eventually forgets a member's photograph, which is the whole fault this
--     product keeps finding, one level of abstraction up.
--   · It does not send anybody an email, add a table, or introduce a service.
--     The signal rides on `cron.job_run_details`, which already exists, is
--     already retained, and is already the first place anybody looks when a
--     scheduled thing has stopped.
--   · It does not touch `purge_stored_object()` or `confirm_object_purges()`.
--     Those are 1120's and 1152's; the equivalent correction is made there.
--
-- ── ORDER OF APPLICATION ─────────────────────────────────────────────────
--
-- Sections 1, 2 and 4 need only parts 45 and 48, which are applied. Section 3's
-- alarm reads `public.object_purge` if it exists and skips it if it does not,
-- so this file is correct whether 1120 has been applied before it or not —
-- though in setup.sql it always has, because 1120 sorts first.
--
-- Idempotent and safe to re-run: `or replace` on both functions, the cron job
-- unscheduled before it is scheduled, the view `or replace`, and the delete in
-- section 4 matches nothing on a second run.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · A refusal that counts as an attempt
-- ═════════════════════════════════════════════════════════════════════════
--
-- `purge_photo_file()` exactly as it stands live, with `attempts` and
-- `last_attempt_at` added to the two branches that give up. Nothing else in the
-- function is touched: not the guard, not the regex, not the Vault read, not
-- the URL, not the success update.
--
-- `attempts` is what tells an operator this has been happening for three days
-- rather than three minutes, and it is what makes section 2's ordering work.
-- `last_attempt_at` is what tells them when it last happened. Both were being
-- written on the branch that succeeds and on neither of the two that do not,
-- which is the wrong way round: a branch that gives up is the one an operator
-- needs a count from.
--
-- The Vault branch is included even though it fails for every row at once
-- rather than for one row for ever. A missing secret is still an attempt, and a
-- run that touched two hundred rows and sent nothing should say so in the
-- rows.

create or replace function public.purge_photo_file(p_path text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_key text; v_req bigint;
begin
  if p_path is null or not exists (select 1 from public.photo_purge where path = p_path and purged_at is null) then
    return;
  end if;
  if p_path !~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,120}$' then
    update public.photo_purge
       set note = 'path is not in the expected <uid>/<name> shape — not sent',
           attempts = attempts + 1,
           last_attempt_at = now()
     where path = p_path;
    return;
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'storage_service_key' limit 1;
  if v_key is null or v_key = '' then
    update public.photo_purge
       set note = 'no storage_service_key in Vault — file NOT deleted',
           attempts = attempts + 1,
           last_attempt_at = now()
     where path = p_path;
    return;
  end if;
  select net.http_delete(
    url := 'https://phgfwzpkkwdysftlgkoq.supabase.co/storage/v1/object/photos/' || p_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'apikey', v_key)
  ) into v_req;
  update public.photo_purge set request_id = v_req, attempts = attempts + 1,
         last_attempt_at = now(), note = 'sent' where path = p_path;
end $$;


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · A new file is never stuck behind an old failure
-- ═════════════════════════════════════════════════════════════════════════
--
-- `purge_progress_photo_files()` exactly as it stands live, with `order by
-- queued_at` becoming `order by attempts, queued_at`. Part 1120 gives the
-- argument and it applies here word for word: "a single permanently-refused
-- object at the head of a 200-row window would otherwise be re-sent ahead of
-- new work on every single run."
--
-- The two changes are one fix. Ordering by attempts is only meaningful because
-- section 1 now increments it; incrementing it is only useful because something
-- sorts on it. Applied on their own, either would look like an improvement and
-- neither would move a photograph.

create or replace function public.purge_progress_photo_files()
returns table(confirmed integer, sent integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare r record; n int := 0;
begin
  confirmed := public.confirm_photo_purges();
  for r in select path from public.photo_purge where purged_at is null
            order by attempts, queued_at limit 200
  loop
    perform public.purge_photo_file(r.path);
    n := n + 1;
  end loop;
  sent := n;
  return next;
end $$;


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · The alarm
-- ═════════════════════════════════════════════════════════════════════════
--
-- One view and one function, and the function's only purpose is to fail.
--
-- `storage_purge_backlog` is for `photo_purge`, which is the queue that had no
-- backlog view at all — part 1120 wrote `file_purge_backlog` for its own queue
-- and part 45 never wrote one for this. The column list is 1120's, deliberately,
-- so an operator reading the two side by side is reading the same shape twice.
-- The bucket is a literal because `photo_purge` has no such column: it predates
-- there being more than one bucket to purge from.
--
-- The two are NOT unioned into a single view. `object_purge` may not exist —
-- part 1120 is not applied to this project — and a view over a missing table
-- cannot be created at all, so a union would make this file refuse to apply on
-- exactly the project that has the older, unwatched queue. The function below
-- reads both, guarded, which is where the two-queues-one-question job belongs.
--
-- security_invoker, following 1120's `file_purge_backlog`, so it inherits the
-- underlying table's RLS. `photo_purge` has RLS on with no policies, which
-- means the owner and the service role and nobody else. These rows name which
-- member held which photograph; they are not for a screen.

create or replace view public.storage_purge_backlog
with (security_invoker = true) as
  select 'photos'::text as bucket_id,
         p.path,
         p.subject_id,
         p.queued_at,
         p.attempts,
         p.last_attempt_at,
         p.note,
         (now() - p.queued_at) as outstanding_for
    from public.photo_purge p
   where p.purged_at is null;

comment on view public.storage_purge_backlog is
  'Progress photographs this product has failed to delete — the photo_purge backlog, which had no '
  'view of its own until now. The same column list as part 1120''s file_purge_backlog. Read by '
  'check_storage_purge_backlog(), which the storage-purge-backlog-alarm cron job runs daily and '
  'which RAISES if anything in EITHER queue has been outstanding for more than a day — so a '
  'stalled queue turns a cron run red instead of sitting still in a table nobody opens. '
  'The object_purge half is public.file_purge_backlog (part 1120). See supabase/parts/1153.';


-- The function that fails. It writes nothing at all, which is what makes it
-- safe to raise from: there is no work for the rollback to undo.
--
-- A day is the threshold because the drain runs every five minutes. Anything
-- still here after 288 attempts is not slow, it is stuck, and the two failure
-- modes that produce it — a refused path shape and a missing Vault secret —
-- both need a person and neither resolves itself.
--
-- The message carries the count, the oldest, and the note the sender left,
-- because `return_message` in `cron.job_run_details` is all an operator gets
-- and "backlog is not empty" would send them looking for the query this
-- function has already run.
--
-- `object_purge` is read through `to_regclass` rather than named directly, so
-- this file is correct on a project where part 1120 has not been applied. A
-- missing table is not an alarm condition; it is a project that does not have
-- that queue yet.

create or replace function public.check_storage_purge_backlog()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_n       int;
  v_oldest  interval;
  v_path    text;
  v_note    text;
  v_bucket  text;
begin
  select count(*), max(now() - queued_at)
    into v_n, v_oldest
    from public.photo_purge where purged_at is null;

  select 'photos', path, note into v_bucket, v_path, v_note
    from public.photo_purge where purged_at is null
   order by queued_at limit 1;

  if to_regclass('public.object_purge') is not null then
    declare
      v_n2 int; v_oldest2 interval; v_b2 text; v_p2 text; v_note2 text;
    begin
      execute 'select count(*), max(now() - queued_at) from public.object_purge where purged_at is null'
         into v_n2, v_oldest2;
      execute 'select bucket_id, path, note from public.object_purge where purged_at is null order by queued_at limit 1'
         into v_b2, v_p2, v_note2;
      v_n := coalesce(v_n, 0) + coalesce(v_n2, 0);
      if v_oldest2 is not null and (v_oldest is null or v_oldest2 > v_oldest) then
        v_oldest := v_oldest2; v_bucket := v_b2; v_path := v_p2; v_note := v_note2;
      end if;
    end;
  end if;

  if coalesce(v_n, 0) = 0 or v_oldest is null or v_oldest <= interval '1 day' then
    return;
  end if;

  raise exception
    'STORAGE PURGE STALLED: % file(s) still queued for deletion; the oldest has been outstanding for % — %/% — last note: %. These are files belonging to people who have been erased. Read public.storage_purge_backlog and public.file_purge_backlog. See supabase/parts/1153.',
    v_n, v_oldest, v_bucket, v_path, coalesce(v_note, '(none)');
end $$;

revoke execute on function public.check_storage_purge_backlog() from public, anon, authenticated;


-- Once a day, at a minute nothing else is on. Every other job in this project
-- sits at :07 past the hour or between 03:17 and 07:48; 09:04 is empty.
--
-- Daily rather than hourly on purpose. The condition it tests is "outstanding
-- for more than a day", which cannot become true and then false again within an
-- hour, and twenty-four red runs a day is how an alarm gets muted.
--
-- Unscheduled first so re-running this file cannot accumulate duplicates.

create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'storage-purge-backlog-alarm') then
    perform cron.unschedule('storage-purge-backlog-alarm');
  end if;
end $$;

select cron.schedule(
  'storage-purge-backlog-alarm',
  '4 9 * * *',
  $cron$ select public.check_storage_purge_backlog(); $cron$
);


-- ═════════════════════════════════════════════════════════════════════════
-- 4 · The row that is stuck today
-- ═════════════════════════════════════════════════════════════════════════
--
-- See the header for the argument. In short: `tf/verify/a.jpg` is a test
-- artefact, no code path in this product can produce that key, the `photos`
-- bucket is empty, and it is deleted rather than stamped `purged_at` because
-- stamping it would record a confirmation that was never received.
--
-- Four guards, all of which must hold:
--
--   · the exact path, which is not a shape this product can generate;
--   · still pending, so a row that has since been purged is left alone;
--   · never sent — `request_id is null` — so if a request has gone out since
--     this was written, the reply is the thing that should close the row and
--     not this statement;
--   · and no object behind it in `storage.objects`, so a row that turns out to
--     name a real file is not quietly forgotten.
--
-- If any guard fails this matches nothing, and section 3's alarm reports the
-- row the next morning. That is the intended behaviour, not a fallback.

delete from public.photo_purge p
 where p.path = 'tf/verify/a.jpg'
   and p.purged_at is null
   and p.request_id is null
   and not exists (
     select 1 from storage.objects o
      where o.bucket_id = 'photos' and o.name = p.path
   );
