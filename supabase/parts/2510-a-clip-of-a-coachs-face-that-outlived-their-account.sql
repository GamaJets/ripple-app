-- ═══════════════════════════════════════════════════════════════════════════
-- A clip of a coach's face that outlived their account.
-- APPLIED. Verified after: `queue_account_object_purges` enumerates
-- 'exercise-videos', anon cannot execute it, and the backfill queued 0 rows
-- because the bucket is empty — which is the point of applying it now.
--
--
-- ── WHAT IS WRONG ─────────────────────────────────────────────────────────
--
-- Part 1152 gave `exercise-videos` an AFTER DELETE trigger on the table rather
-- than a place in the account hook, and argued the point at length:
--
--   "`exercise_videos.video_path` is the column, so this is the case 1120 says
--    it did not have … An AFTER DELETE trigger on the table is strictly better
--    than the account hook here"
--
-- That is true of every object a row has ever pointed at. It is not true of an
-- object no row ever pointed at, and this bucket is the only one of the six
-- where such an object can be created by a coach doing an ordinary thing.
--
-- src/ui/exerciseVideos.ts uploads the file FIRST and inserts the row second —
-- two calls that cannot be one transaction. When the second one does not
-- happen the bytes are already in the bucket, and from that moment:
--
--   · nobody can SEE the object. `exvid_object_r` is
--     `bucket_id = 'exercise-videos' and can_watch_exercise_video(name)`, and
--     that function is `exists (select 1 from public.exercise_videos where
--     video_path = p_path)`. With no row it is false for everybody — including
--     the coach who uploaded it. It cannot be listed, cannot be signed, and
--     cannot be found in order to be deleted by hand. `exvid_object_d` would
--     happily let that coach delete it; they have no way to learn it is there;
--   · `trg_exercise_video_deleted` needs a row to fire. There is none;
--   · `queue_account_object_purges()` enumerates FIVE buckets — `injury-docs`,
--     `avatars`, `coach-logos`, `coach-docs` and `message-media` — read live on
--     this project on 6 Sep 2026. `exercise-videos` is not among them, on 1152's
--     reasoning above.
--
-- So the object survives the erasure of the account that made it, under the uid
-- of somebody who no longer exists, with nothing on the platform able to name
-- it. That is word for word the harm 1152's own header was written to close:
--
--   "forty videos of a named person demonstrating exercises, sitting in three
--    private buckets under the uid of an account that no longer exists, with
--    nothing pointing at them and nobody who could ever delete them"
--
-- ── WHAT IT DOES TO A REAL PERSON ────────────────────────────────────────
--
-- A coach films a technique clip in a gym with poor signal. The upload gets
-- through; the insert does not. The app tells them it did not reach the server
-- and to try again, which they do, and the second attempt works. They now have
-- one clip in their library and TWO files in the bucket, and no screen in the
-- product can show them the second one. Two years later they leave and ask to
-- be erased. Every row goes; the queue clears their logo, their paperwork, the
-- clip they can see and everything they ever sent in a message. The file with
-- their face in it that nobody could see is still there, and now nobody ever
-- can be — the one person entitled to delete it is the one whose credentials
-- the erasure destroyed.
--
-- ── THE APP-SIDE HALF, WHICH IS NOT A SUBSTITUTE FOR THIS ────────────────
--
-- src/ui/exerciseVideos.ts now discards the object when the insert is REFUSED —
-- the same clean-up src/ui/coachLogo.ts, src/ui/avatarUpload.ts and
-- src/lib/progressPhotos.ts already make their rule. It deliberately does NOT
-- discard when the write got no reply at all, because supabase-js rejects after
-- the request has gone and the row may well exist; deleting then would leave a
-- live row pointing at nothing, which src/ui/exerciseVideos.ts names as the
-- worst outcome its delete path can produce.
--
-- That leaves exactly one case uncovered — an unanswered insert that really did
-- fail — plus every object already in the bucket from before the fix ships, and
-- every future caller that forgets. This file is what covers those, and it is
-- the layer that has to: an app-side clean-up runs on a handset that may be put
-- down, run out of battery, or be reinstalled between the upload and the tidy.
--
-- ── WHY THIS IS SAFE BESIDE THE TRIGGER ──────────────────────────────────
--
-- Erasing a coach now fires both hooks at `exercise-videos`, exactly as it
-- already does at `coach-logos` and `coach-docs`, and 1152 § "WHAT HAPPENS WHEN
-- THE TWO HOOKS MEET" is the argument, unchanged:
--
--   `trg_profiles_queue_file_purge` is BEFORE DELETE on `profiles`, so it
--   enumerates `storage.objects` while the coach's uid still means something.
--   The cascade then reaches `trainers` and `exercise_videos`, and the AFTER
--   DELETE trigger queues each `video_path`. They cannot collide: it is ONE
--   queue with a primary key on (bucket_id, path), both inserts are
--   `on conflict do nothing`, and there is still exactly one drain issuing
--   exactly one DELETE per path.
--
-- `object_purge`'s check constraint ALREADY permits 'exercise-videos' (1152 § 1)
-- and `purge_stored_object()` ALREADY carries its path shape, so nothing else
-- has to change: this file widens one enumeration and adds a backfill.
--
-- ── MEASURED BEFORE WRITING ──────────────────────────────────────────────
--
-- Live on 6 Sep 2026: `exercise-videos` holds 0 objects, `exercise_videos` holds
-- 0 rows, `object_purge` holds 0 rows. The only bucket with anything in it is
-- `exercise-demos` (1,640 stock files belonging to nobody, and deliberately not
-- in this queue). So applying this changes nothing about any object that exists
-- and the backfill in section 2 finds nothing. It closes the hole before the
-- first file falls into it.
--
-- Idempotent and safe to re-run: the function is `or replace` and the backfill
-- is `on conflict do nothing`.
--
-- ── ORDER OF APPLICATION ─────────────────────────────────────────────────
--
-- THIS PART REQUIRES 1120 AND 1152 BEFORE IT. 1120 creates `object_purge` and
-- `queue_account_object_purges()`; 1152 widens the check constraint to admit
-- 'exercise-videos' and teaches `purge_stored_object()` its path shape. setup.sql
-- concatenates by number, so a paste of the bundle gets this right without
-- anybody thinking about it; section 0 is for an operator running files one at
-- a time.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═════════════════════════════════════════════════════════════════════════
-- 0 · Refuse to run without the machine this widens
-- ═════════════════════════════════════════════════════════════════════════
--
-- A named sentence rather than a cascade of "function does not exist", and one
-- check per thing this file actually depends on.

do $$
begin
  if to_regclass('public.object_purge') is null then
    raise exception
      'public.object_purge does not exist. Apply supabase/parts/1120 first — this part widens its account hook rather than building a second one.';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'queue_account_object_purges'
  ) then
    raise exception
      'public.queue_account_object_purges() does not exist. Apply supabase/parts/1120 first.';
  end if;

  -- 1152 is what makes 'exercise-videos' a legal value in this queue. Without
  -- it the widened enumeration below would insert rows the check constraint
  -- rejects, and the coach's erasure would abort rather than proceed — which is
  -- a far worse failure than the one this file fixes.
  begin
    perform 1 from public.object_purge where bucket_id = 'exercise-videos' limit 1;
  exception when others then
    raise exception
      'public.object_purge does not accept bucket_id = ''exercise-videos''. Apply supabase/parts/1152 first — it widens the check constraint and teaches purge_stored_object() this bucket''s path shape.';
  end;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.object_purge'::regclass
       and conname = 'object_purge_bucket_is_ours'
       and pg_get_constraintdef(oid) like '%exercise-videos%'
  ) then
    raise exception
      'object_purge_bucket_is_ours does not name ''exercise-videos''. Apply supabase/parts/1152 first.';
  end if;
end $$;


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · The account hook enumerates one more bucket
-- ═════════════════════════════════════════════════════════════════════════
--
-- Restated in full rather than patched, because it is one function and half a
-- definition is not a thing Postgres has. The ONLY change from 1120/1152's
-- version is the addition of 'exercise-videos' to the single-segment arm.
--
-- The single-segment arm is right for it: `exvid_object_w` is
-- `(storage.foldername(name))[1] = auth.uid()::text`, `exerciseVideoPath()` in
-- src/lib/exerciseVideoUpload.ts builds `<coach uid>/<millis>-<token>.mp4`, and
-- `purge_stored_object()` already refuses to SEND anything from this bucket
-- that is not `^[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,120}$`. So an object shaped
-- any other way is queued and then held with a note rather than turned into a
-- URL nobody checked — which is the behaviour 1120 chose deliberately and this
-- file inherits rather than re-argues.
--
-- SECURITY DEFINER and a pinned search_path, unchanged: it reads
-- `storage.objects`, which the caller cannot.

create or replace function public.queue_account_object_purges(p_uid uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0;
begin
  if p_uid is null then
    return 0;
  end if;

  with queued as (
    insert into public.object_purge (bucket_id, path, subject_id, note)
    select o.bucket_id, o.name, p_uid, 'owner erased'
      from storage.objects o
     where (o.bucket_id in ('injury-docs', 'avatars', 'coach-logos', 'coach-docs',
                            -- Added by part 2510. The table trigger covers every
                            -- object a ROW points at; this covers the ones no row
                            -- ever did, which nothing else in the system can see.
                            'exercise-videos')
            and (storage.foldername(o.name))[1] = p_uid::text)
        or (o.bucket_id = 'message-media'
            and (   (storage.foldername(o.name))[1] = p_uid::text
                 or (storage.foldername(o.name))[2] = p_uid::text))
    on conflict (bucket_id, path) do nothing
    returning 1)
  select count(*) into n from queued;

  return n;
end $function$;

-- Not granted to anybody. It is called by `trg_profiles_queue_file_purge`,
-- which is SECURITY DEFINER itself, and a `create or replace` does not reset a
-- grant — but Postgres grants EXECUTE on a NEW function to PUBLIC, which in a
-- Supabase project includes anon, so this is stated rather than assumed. It is a
-- no-op on the existing function and the correct thing on a fresh database.
revoke all on function public.queue_account_object_purges(uuid) from public;
revoke all on function public.queue_account_object_purges(uuid) from anon;
revoke all on function public.queue_account_object_purges(uuid) from authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · The ones already in the bucket
-- ═════════════════════════════════════════════════════════════════════════
--
-- Every object in `exercise-videos` that no `exercise_videos` row points at.
-- These are precisely the files nobody on the platform can see: the read policy
-- asks that table, so an object absent from it is absent from every listing and
-- every signature. They are queued under the uid in their own first path
-- segment, which is the coach who uploaded them and the only person they could
-- ever be said to belong to.
--
-- `subject_id` is that uid when it is a real profile and the nil uuid when it is
-- not — the same fallback `exercise_video_deleted()` uses for a platform clip
-- with no trainer. A row whose subject cannot be resolved is still a file that
-- has to go; refusing to queue it because the account is already gone would
-- keep exactly the files this part exists to remove.
--
-- Live count on 6 Sep 2026: zero. This is here so that a database which has
-- been running longer than this fix does not carry them for ever.

insert into public.object_purge (bucket_id, path, subject_id, note)
select 'exercise-videos',
       o.name,
       coalesce(
         (select pr.id from public.profiles pr
           where pr.id::text = (storage.foldername(o.name))[1]),
         '00000000-0000-0000-0000-000000000000'::uuid),
       'orphan: no exercise_videos row points at this object (part 2510)'
  from storage.objects o
 where o.bucket_id = 'exercise-videos'
   and not exists (
     select 1 from public.exercise_videos v where v.video_path = o.name)
on conflict (bucket_id, path) do nothing;


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · Say what changed
-- ═════════════════════════════════════════════════════════════════════════

do $$
declare
  v_queued int;
begin
  select count(*) into v_queued
    from public.object_purge
   where bucket_id = 'exercise-videos' and purged_at is null;
  raise notice
    'part 2510: queue_account_object_purges() now enumerates exercise-videos; % object(s) from that bucket are queued and unpurged. The drain (purge-account-files, 2-59/5 * * * *) sends them.',
    v_queued;
end $$;
