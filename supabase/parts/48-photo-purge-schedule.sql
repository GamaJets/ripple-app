-- ─────────────────────────────────────────────────────────────────────────
-- Actually drain the photo purge queue.
--
-- 45-progress-photos.sql built the queue and the sender; 47 made photos
-- shareable. What neither did is RUN it. Until now the only thing that called
-- purge_progress_photo_files() was a person typing it into the SQL editor.
--
-- That gap is not cosmetic. Deleting a progress photo removes the row
-- immediately and records the file's path; the FILE goes only when the queue is
-- drained. So without a schedule, a member deletes a photo of themselves, the
-- app truthfully says it is gone from their account, and the image sits in
-- storage indefinitely. web/delete-account.html promises the file is chased and
-- confirmed. A promise nobody executes is the same class of fault as
-- request_account_deletion() writing a timestamp that nothing ever read.
--
-- WHY A CRON JOB RATHER THAN DOING IT INLINE. The delete cannot remove the file
-- itself: storage.objects carries Supabase's protect_objects_delete trigger,
-- which refuses direct deletion and says to use the Storage API. That means an
-- HTTP call, and an HTTP call inside the transaction that deletes a member's
-- account would make erasure depend on the storage service answering. It must
-- not: the row deletion has to succeed even when storage is down, with the file
-- chased afterwards. pg_net posts asynchronously and the queue remembers.
--
-- EVERY FIVE MINUTES, not every minute. A purge is a DELETE against a file
-- nobody can reach any more — the row is already gone and both the row policy
-- and the storage policy read from it. Minutes of latency cost nothing, and the
-- queue holds each path until storage confirms, so a missed run is picked up by
-- the next one rather than losing the file forever.
--
-- The drain is idempotent by construction: purge_photo_file() returns
-- immediately for any path already marked purged, and DELETE of an absent
-- object is itself idempotent, which is why an already-absent file is a
-- success rather than an error.
-- ─────────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron;

-- Unschedule first so re-running this file does not accumulate duplicate jobs
-- each firing the same drain.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-progress-photo-files') then
    perform cron.unschedule('purge-progress-photo-files');
  end if;
end $$;

select cron.schedule(
  'purge-progress-photo-files',
  '*/5 * * * *',
  $cron$ select public.purge_progress_photo_files(); $cron$
);

-- The job runs as the table owner, so nothing here widens what a signed-in
-- person can reach. purge_progress_photo_files is already revoked from public
-- and anon by 45-progress-photos.sql.
