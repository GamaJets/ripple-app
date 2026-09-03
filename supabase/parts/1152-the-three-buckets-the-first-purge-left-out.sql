-- ═══════════════════════════════════════════════════════════════════════════
-- The three buckets the first purge left out.
--
-- ── WHAT IS WRONG ─────────────────────────────────────────────────────────
--
-- Part 1120 built one queue, one sender, one confirm and one drain, and pointed
-- them at three buckets: `injury-docs`, `message-media`, `avatars`. It stopped
-- there on purpose. Its own check constraint names the three and refuses
-- everything else, so the remaining member-file buckets are not merely
-- unhandled — they are structurally rejected if anybody tries.
--
-- Live on 3 Sep 2026, `storage.buckets` holds eleven. Setting aside the three
-- 1120 covers, `photos` (which has its own machine, parts 45 and 48),
-- `exercise-demos` (1640 stock animation files belonging to nobody),
-- `share-cards` (one object at a time, for seconds) and `scans` (empty and
-- unused, part 1122), what is left is four, and each needs a DIFFERENT answer
-- rather than one more name in a check constraint:
--
--     coach-logos      the coach's own mark
--     coach-docs       the coach's own paperwork
--     exercise-videos  a clip the coach recorded
--     gym-docs         the gym's filing cabinet
--
-- Three of them join the queue. One does not, and the argument for that is
-- section 6 and is the longest in the file.
--
-- ── WHAT IT DOES TO A REAL PERSON ────────────────────────────────────────
--
-- A personal trainer runs their business through this app for two years. Their
-- logo is in `coach-logos`, their studio waiver and par-form in `coach-docs`,
-- forty technique clips with their face and voice in them in `exercise-videos`.
-- They leave, and ask to be deleted. Every row goes. Every file stays: a
-- photograph of the mark they trade under, PDFs carrying their business name
-- and address, and forty videos of a named person demonstrating exercises,
-- sitting in three private buckets under the uid of an account that no longer
-- exists, with nothing pointing at them and nobody who could ever delete them —
-- the one person entitled to is the one whose credentials the erasure
-- destroyed.
--
-- ── ORDER OF APPLICATION ─────────────────────────────────────────────────
--
-- THIS PART REQUIRES 1120 AND 1151, IN THAT ORDER, BEFORE IT.
--
--   1120  creates `object_purge`, `queue_account_object_purges()`,
--         `purge_stored_object()`, `confirm_object_purges()`,
--         `purge_account_files()` and the cron drain. This file WIDENS them;
--         it does not restate them, because two copies of the confirm logic is
--         two places for it to drift and 1120 says so at length.
--   1151  makes a coach's erasure possible at all. Without it, a coach one of
--         whose documents has been accepted cannot be deleted, so the hook this
--         file hangs on `profiles` never fires for exactly the person whose
--         `coach-docs` folder it exists to clear.
--
-- Neither 1120 nor 1151 is applied to this project as this is written
-- (verified: `public.object_purge` does not exist). setup.sql concatenates by
-- number, so a paste of the bundle applies all three in the right order without
-- anybody thinking about it. An operator running files one at a time gets a
-- named sentence from section 0 rather than a half-built second queue.
--
-- ── HOW EACH BUCKET WAS DECIDED ──────────────────────────────────────────
--
-- `coach-logos` — SIMPLEST, AND THE QUESTION WAS "PER-COACH OR PER-TENANT".
-- Per-coach, established rather than assumed. `trainers.logo_path` is the
-- column (`trainers_logo_path_own_folder` constrains it to `<trainer id>/%`),
-- `coachlogoPath()` in src/lib/coachLogo.ts builds `<coach uid>/<millis>-
-- <token>.<ext>`, and all three storage policies in part 330 key on
-- `(storage.foldername(name))[1] = auth.uid()::text`. Part 330 is explicit that
-- a gym owner is NOT entitled to it: "A gym owner is not entitled to the mark a
-- coach who works there trades under." So the subject is the coach, the folder
-- is the coach's uid, and it goes into 1120's account hook unchanged — one more
-- bucket in the single-segment arm. Live: 0 objects, 0 trainers with a
-- logo_path set.
--
-- `coach-docs` — THE RETENTION QUESTION, ANSWERED IN TWO HALVES.
-- Part 135 blocks the storage DELETE once a document has been accepted, via
-- `coach_doc_unaccepted(name)` in `coachdoc_obj_delete`. That is retention and
-- it is right. The question the sweep asked is what should happen when the
-- person who accepted it erases their account, and it has two halves that pull
-- in opposite directions:
--
--   · A CLIENT erases. Nothing in this bucket is theirs. The file is the
--     coach's paperwork, the coach still exists, other clients may still hold
--     it, and the client's own record — their acceptance — is a row, not a
--     file, and it already goes: `coach_document_acceptances.client_id`
--     references `clients(id) on delete cascade` and `clients.id` references
--     `profiles(id) on delete cascade`. So this part queues NOTHING on a
--     client's erasure, and that is a decision rather than an omission. What
--     changes for the coach is a side effect worth naming: with the last
--     acceptance gone, `coach_doc_unaccepted()` answers true again and the
--     coach can delete a file that no longer anchors anybody's evidence.
--
--   · The COACH erases. Everything in their folder is theirs, `coach_documents`
--     cascades away with `trainers`, and part 1151 has just removed the last
--     thing that was refusing the cascade. The retention argument does not
--     survive that: it exists to stop a coach quietly replacing paperwork
--     somebody signed, not to keep a coach's own business documents after the
--     coach has been erased. Keeping the file would mean keeping their uid in
--     the object key indefinitely, which is not retention.
--
-- So `coach-docs` joins the account hook, on the FOLDER — which is the coach.
-- The hook cannot fire for a client, because a client's uid is never the first
-- segment of a key in this bucket (`coach_documents_path_chk` enforces
-- `path like coach_id || '/%'`).
--
-- `exercise-videos` — HAS A ROW CARRYING THE PATH, SO IT WANTS PART 45's SHAPE.
-- `exercise_videos.video_path` is the column, so this is the case 1120 says it
-- did not have: "A progress photo has a row carrying its path, so the trigger
-- reads OLD.image_path. None of these three buckets has a row anywhere." This
-- one does. An AFTER DELETE trigger on the table is strictly better than the
-- account hook here, and covers a second hole the account hook never could:
--
--     src/ui/exerciseVideos.ts:379
--     try { await supabase.storage.from('exercise-videos').remove([target.path]); }
--     catch { /* the row is gone; a stray file is not worth failing the delete */ }
--
-- A coach deleting ONE clip today loses the row and keeps the file whenever
-- that call fails, and the comment says so out loud. The trigger catches that,
-- the account cascade, and an operator deleting the row by hand, with one
-- mechanism — because all three end in the same `delete from exercise_videos`.
--
-- `gym-docs` — DOES NOT JOIN, AND SECTION 6 IS WHY.
--
-- ── WHAT HAPPENS WHEN THE TWO HOOKS MEET ─────────────────────────────────
--
-- Erasing a coach fires both. `trg_profiles_queue_file_purge` (1120, BEFORE
-- DELETE on `profiles`) enumerates `coach-logos` and `coach-docs` out of
-- `storage.objects`; the row is then deleted, the cascade reaches `trainers`
-- and then `exercise_videos`, and the AFTER DELETE trigger below queues each
-- `video_path`. They cannot collide: it is ONE queue with a primary key on
-- (bucket_id, path), both inserts are `on conflict do nothing`, and the two
-- hooks name disjoint buckets anyway. There is still exactly one drain issuing
-- exactly one DELETE per path, which is 1120's whole reason for refusing
-- `photos` a place in this queue and is extended here rather than restated.
--
-- ── MEASURED BEFORE WRITING ──────────────────────────────────────────────
--
-- Live object counts on 3 Sep 2026: `exercise-demos` 1640, EVERY OTHER BUCKET
-- ZERO. `exercise_videos` 0 rows, `exercise_video_grants` 0, `coach_documents`
-- 0, `gym_documents` 0, `trainers` 8 of which 0 have a logo. So applying this
-- changes nothing about any object that exists and the backfill in section 7
-- finds nothing. It closes the hole before the first file lands in it.
--
-- Idempotent and safe to re-run: the constraint is dropped by name before it is
-- added, every function is `or replace`, the trigger is dropped by name first,
-- the view is `or replace`, and the backfill is `on conflict do nothing`.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═════════════════════════════════════════════════════════════════════════
-- 0 · Refuse to run without the machine this widens
-- ═════════════════════════════════════════════════════════════════════════
--
-- A named sentence rather than a cascade of "relation does not exist". The
-- alternative — creating the queue here if it is missing — is the one thing
-- this file must not do: it would be the second copy of the confirm logic that
-- 1120 § "ONE QUEUE, THREE BUCKETS" refuses on the grounds that part 45's
-- confirm logic was already wrong once and had to be repaired in place.

do $$
begin
  if to_regclass('public.object_purge') is null then
    raise exception
      'public.object_purge does not exist. Apply supabase/parts/1120 first — this part widens its queue rather than building a second one. setup.sql already orders them correctly; you are seeing this because parts are being applied one at a time.';
  end if;
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.profiles'::regclass
       and t.tgname = 'trg_profiles_release_coach_documents'
       and not t.tgisinternal
  ) then
    raise exception
      'trg_profiles_release_coach_documents is missing. Apply supabase/parts/1151 first — without it a coach whose document has been accepted cannot be erased at all, so the coach-docs half of this file could never fire.';
  end if;
end $$;


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · Widen what the queue is allowed to hold
-- ═════════════════════════════════════════════════════════════════════════
--
-- Six buckets now, and the same two exclusions as before, for the same reason
-- and stated again because a check constraint is where somebody will look:
--
--   'photos' is REFUSED. It has its own queue, sender and schedule in parts 45
--   and 48. Two drains issuing DELETEs for one path would each read the other's
--   404 as confirmation of its own request, and the row would be marked purged
--   by whichever ran second regardless of what actually happened.
--
--   'gym-docs' is REFUSED, and that is section 6's argument rather than an
--   oversight. Naming it in the constraint is what makes the refusal
--   deliberate: a future hook that tries to queue a gym document fails at the
--   insert instead of quietly working.
--
-- 'exercise-demos', 'share-cards' and 'scans' are absent because nothing in
-- them belongs to a person: 1640 stock animations, one share card at a time,
-- and an empty bucket no feature uses (part 1122).

alter table public.object_purge drop constraint if exists object_purge_bucket_is_ours;
alter table public.object_purge add constraint object_purge_bucket_is_ours
  check (bucket_id in (
    'injury-docs',      -- part 91,  via the account hook
    'message-media',    -- part 124, via the account hook
    'avatars',          -- part 961, via the account hook
    'coach-logos',      -- part 330, via the account hook   (added here)
    'coach-docs',       -- part 135, via the account hook   (added here)
    'exercise-videos'   -- part 49,  via the table trigger  (added here)
  ));

comment on constraint object_purge_bucket_is_ours on public.object_purge is
  'The buckets this queue is responsible for. `photos` is refused because parts 45 and 48 '
  'already drain it and two drains would race one path; `gym-docs` is refused because a gym''s '
  'filing cabinet is not erased by a member leaving. See supabase/parts/1120 and 1152.';


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · Two more buckets in the account hook
-- ═════════════════════════════════════════════════════════════════════════
--
-- Part 1120's `queue_account_object_purges`, re-emitted with `coach-logos` and
-- `coach-docs` added to the single-segment arm and NOTHING ELSE CHANGED. The
-- security posture, the `on conflict do nothing`, the null guard, the comment
-- about `storage.foldername()` returning NULL past the end of the array and the
-- revoke below are all 1120's and are reproduced rather than rewritten.
--
-- Both new buckets are `<uid>/<file>`:
--   coach-logos  coachLogoPath()  src/lib/coachLogo.ts
--   coach-docs   coachDocPath()   src/lib/coachDocs.ts
-- and in both the uid is the COACH. There is no second-segment case here — that
-- is `message-media` only, where segment 2 is the sender.
--
-- `exercise-videos` is deliberately NOT added to this function. It has a row
-- carrying its path and gets part 45's shape in section 3; putting it in both
-- would be two mechanisms queueing one path, which works only because the
-- primary key catches it, and "works because a constraint catches it" is not a
-- design.
--
-- Still NOT granted to authenticated or anon, for 1120's reason: it takes an
-- arbitrary uuid and queues somebody's files for destruction.

create or replace function public.queue_account_object_purges(p_uid uuid)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
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
     where (o.bucket_id in ('injury-docs', 'avatars', 'coach-logos', 'coach-docs')
            and (storage.foldername(o.name))[1] = p_uid::text)
        or (o.bucket_id = 'message-media'
            and (   (storage.foldername(o.name))[1] = p_uid::text
                 or (storage.foldername(o.name))[2] = p_uid::text))
    -- do NOTHING, not do UPDATE. Part 45 requeues on conflict because a single
    -- photo delete can be repeated; here a conflict means the path is either
    -- already pending (leave it, with its attempt count intact) or already
    -- confirmed gone (resurrecting it would send a DELETE for an object we
    -- have a reply about). Object keys carry a random token and are never
    -- reused, so there is no third case.
    on conflict (bucket_id, path) do nothing
    returning 1)
  select count(*) into n from queued;

  return n;
end $$;

revoke execute on function public.queue_account_object_purges(uuid) from public, anon, authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · exercise-videos: the row is the hook
-- ═════════════════════════════════════════════════════════════════════════
--
-- Part 45's shape, minus the one thing 1120 argues part 45 got wrong.
--
-- Part 45's trigger enqueues AND sends, with the send wrapped in an exception
-- block. 1120's header gives the argument against that and quotes part 48's own
-- words back at it: "an HTTP call inside the transaction that deletes a
-- member's account would make erasure depend on the storage service answering.
-- It must not." So this one only enqueues. The cron drain sends, two minutes
-- past every fifth minute, and the queue holds the path until storage confirms.
--
-- AFTER DELETE rather than BEFORE, which is the opposite of 1120's hook and is
-- correct for the opposite reason: 1120 needs BEFORE because the uid is the
-- only thing connecting a person to an object key and it disappears with the
-- row. Here the path is IN the row, `OLD` carries it either way, and AFTER
-- means a delete that is going to be rolled back for some other reason does not
-- leave a queue entry behind claiming a live file is destined for destruction.
--
-- `on conflict do nothing`, following 1120. The condition that makes it safe is
-- worth writing down because it is a property of the key rather than of this
-- file: `uploadExerciseVideo()` builds `<uid>/<epoch-millis>-<token>.mp4`, and
-- epoch millis do not go backwards, so a path already in this queue cannot be
-- the path of a different object later. This said `<uid>/<epoch-millis>.mp4`
-- when it was written; part 1150's follow-up — a random token beside the
-- millisecond, which is what every other bucket already does — has since
-- landed, and it strengthened the property rather than changing it.
--
-- No exception block, for 1120's reason: a caught error here is a savepoint
-- rollback that would discard the record of the file along with the failure,
-- and the record of the file is the one thing that cannot be recovered
-- afterwards.

create or replace function public.exercise_video_deleted()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if old.video_path is not null and btrim(old.video_path) <> '' then
    insert into public.object_purge (bucket_id, path, subject_id, note)
    values ('exercise-videos', old.video_path,
            -- The subject is the coach who recorded it. A platform clip has
            -- `trainer_id` null (part 49 § 4 calls it "a platform clip
            -- belonging to no trainer"); those are not somebody's data and
            -- their row is not deleted by any erasure, but if one is ever
            -- deleted by hand the file should still go, so the row is queued
            -- with the all-zero uuid rather than skipped. `subject_id` is
            -- `not null` and it is how an operator answers "whose file is
            -- this"; all-zeroes answers "nobody's", which is true.
            coalesce(old.trainer_id, '00000000-0000-0000-0000-000000000000'::uuid),
            'exercise_videos row deleted')
    on conflict (bucket_id, path) do nothing;
  end if;
  return old;
end $$;

revoke execute on function public.exercise_video_deleted() from public, anon, authenticated;

drop trigger if exists trg_exercise_video_deleted on public.exercise_videos;
create trigger trg_exercise_video_deleted
  after delete on public.exercise_videos
  for each row execute function public.exercise_video_deleted();

comment on function public.exercise_video_deleted() is
  'Queues the stored clip when its row goes — whether that is a coach deleting one video, an '
  'account erasure cascading through trainers, or an operator deleting the row by hand. Part 45''s '
  'shape without part 45''s inline HTTP call. See supabase/parts/1152.';


-- ═════════════════════════════════════════════════════════════════════════
-- 4 · Three more path shapes for the sender
-- ═════════════════════════════════════════════════════════════════════════
--
-- Part 1120's `purge_stored_object`, re-emitted with three arms added to the
-- shape CASE and nothing else changed. The path goes into a URL, so it is
-- checked against the shape the app builds and the storage policies enforce,
-- per bucket, and refused rather than sent half-encoded where it could address
-- a different object.
--
-- The three new expressions are the SQL of:
--   coachLogoPath()        src/lib/coachLogo.ts   `<uid>/<millis>-<token>.<ext>`
--   coachDocPath()         src/lib/coachDocs.ts   `<uid>/<millis>-<token>-<slug>.<ext>`
--   uploadExerciseVideo()  src/ui/exerciseVideos.ts  `<uid>/<millis>-<token>.mp4`
--
-- That third line said `<uid>/<millis>.mp4` when this part was written, which
-- was true for about an hour. Part 1150's follow-up landed the same day:
-- `exerciseVideoPath()` in src/lib/exerciseVideoUpload.ts now builds
-- `${uid}/${millis}-${token}.mp4` with the token lowercased, stripped to
-- [a-z0-9] and capped at 12. The regex below did not need changing and was not
-- changed — `-` and `.` are already in its character class, and 13 + 1 + 12 + 4
-- is well inside the 120 — but the line is corrected because a reader checking
-- whether a real key passes this CASE must be comparing it against the key the
-- app actually writes.
--
-- All three are one folder deep with the uid as the folder, so all three are
-- the same regex as `injury-docs` and `avatars`. They are written out
-- separately anyway, following 1120's own layout: a reader checking whether a
-- bucket is covered should find its name, not have to work out which arm of a
-- collapsed expression it falls into. The 120-character allowance is measured,
-- not picked — `coach-docs` builds the longest key of the three and
-- `slugify()` caps its slug at 48 characters, on top of 13 for the millis, 12
-- for the token, two separators and an extension.
--
-- Two lines differ from 1120 beyond the CASE, and they are a fix rather than a
-- widening. The two branches that give up — a refused path shape and a missing
-- Vault secret — set `last_attempt_at` but never touched `attempts`, so a
-- permanently refused row stayed at zero attempts for ever and sorted to the
-- HEAD of every drain window under 1120's own `order by attempts, queued_at`.
-- The counter is incremented on both so the drain's ordering tells the truth.
-- Part 1153 makes the identical correction to part 45's `purge_photo_file()`,
-- which this function was modelled on and which has one row stuck behind it on
-- this project today. Nothing else in this function moves.

create or replace function public.purge_stored_object(p_bucket text, p_path text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_key text;
  v_req bigint;
  v_shape_ok boolean;
begin
  if p_bucket is null or p_path is null or not exists (
    select 1 from public.object_purge
     where bucket_id = p_bucket and path = p_path and purged_at is null
  ) then
    return;
  end if;

  v_shape_ok := case p_bucket
    when 'injury-docs'     then p_path ~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,120}$'
    when 'avatars'         then p_path ~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,120}$'
    when 'coach-logos'     then p_path ~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,120}$'
    when 'coach-docs'      then p_path ~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,120}$'
    when 'exercise-videos' then p_path ~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,120}$'
    when 'message-media'   then p_path ~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,120}$'
    else false
  end;

  if not v_shape_ok then
    update public.object_purge
       set note = 'path is not the expected shape for ' || p_bucket || ' — NOT sent',
           attempts = attempts + 1,
           last_attempt_at = now()
     where bucket_id = p_bucket and path = p_path;
    return;
  end if;

  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'storage_service_key' limit 1;

  if v_key is null or v_key = '' then
    update public.object_purge
       set note = 'no storage_service_key in Vault — file NOT deleted',
           attempts = attempts + 1,
           last_attempt_at = now()
     where bucket_id = p_bucket and path = p_path;
    return;
  end if;

  select net.http_delete(
    url     := 'https://phgfwzpkkwdysftlgkoq.supabase.co/storage/v1/object/'
               || p_bucket || '/' || p_path,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'apikey',        v_key)
  ) into v_req;

  update public.object_purge
     set request_id = v_req,
         attempts = attempts + 1,
         last_attempt_at = now(),
         note = 'sent'
   where bucket_id = p_bucket and path = p_path;
end $$;

revoke execute on function public.purge_stored_object(text, text) from public, anon, authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 5 · Assert the two halves agree
-- ═════════════════════════════════════════════════════════════════════════
--
-- A bucket in the check constraint with no arm in the shape CASE is the worst
-- of the failure modes available here: the enqueue succeeds, the send refuses
-- the shape every run, and the file sits in the queue for ever while the drain
-- reports success. That is the defect part 1153 is about, arriving through the
-- door this file just widened, so this file closes it behind itself.

-- The arm is looked for in the function's own source rather than probed with a
-- sample key, because probing means calling a SECURITY DEFINER function that
-- sends HTTP, and a paste of setup.sql must not put a request on the wire.
-- `pg_get_functiondef` is the same text this file wrote four sections up, so a
-- bucket name missing from it is a bucket name missing from the CASE.

do $$
declare
  b   text;
  src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'purge_stored_object'
   limit 1;

  foreach b in array array['injury-docs','message-media','avatars',
                           'coach-logos','coach-docs','exercise-videos']
  loop
    if src is null or position('when ''' || b || '''' in src) = 0 then
      raise exception
        'purge_stored_object() has no path-shape arm for bucket % — a file queued for it would be refused on every run and would never leave the queue, while the drain reported success. See supabase/parts/1152 § 4.', b;
    end if;
  end loop;
end $$;


-- ═════════════════════════════════════════════════════════════════════════
-- 6 · gym-docs, and why it is not in the queue
-- ═════════════════════════════════════════════════════════════════════════
--
-- The sweep's view was that a gym's legal paperwork should probably survive an
-- individual member's erasure. Tested rather than adopted, that view is right
-- about the conclusion and wrong about the reason, and the reason matters
-- because it decides what SHOULD be built instead.
--
-- THE REASON IT IS NOT "GYM PAPERWORK BELONGS TO THE GYM". Some of it is
-- squarely about one person. `gym_documents.kind` is one of contract,
-- insurance, service_report, certificate, incident, photo, other, and part 390
-- exists precisely because four of those can be a member's: a signed contract,
-- an incident report naming them, a photograph. Part 390 adds
-- `member_attached` — "one boolean saying 'this was somebody's'" — and latches
-- it on so that erasing the member cannot widen who may read their file. A
-- blanket "the gym keeps everything" would be a claim about the file that part
-- 390 already refuses to make.
--
-- THE FIRST REAL REASON: THE ERASURE CANNOT FIND THE FILES. Every other bucket
-- in this queue is `<subject uid>/…`, which is what makes
-- `queue_account_object_purges()` possible: the uid is in the key, so the files
-- can be enumerated at the last moment the subject is identifiable. `gym-docs`
-- is `<tenant uid>/<date>-<token>-<name>` — src/lib/gymDocs.ts documentPath()
-- says why in as many words: "A gym's insurance certificate belongs to the
-- building and has to outlive whichever member of staff uploaded it", and the
-- storage policies in part 185 read `(storage.foldername(name))[1] =
-- my_tenant()::text`. A member's uid appears nowhere in the key. The only thing
-- connecting a member to an object here is `gym_documents.member_id`, which is
-- `on delete set null` — so at the moment of erasure the link is severed by the
-- same statement that would have to use it.
--
-- THE SECOND REAL REASON: THE DECISION IS PER-TENANT AND IT IS NOT OURS.
-- Part 390 already wrote this out and it is quoted rather than re-derived,
-- because the sweep is not the first thing to look at it: "deciding which of a
-- gym's documents outlive the person they are about is a retention question
-- with a statutory answer per country, not something to settle at the bottom of
-- a policy file. `tenants.record_retention_years` is where that decision
-- belongs and it is deliberately NULL by default." Part 184 uses that same
-- column to stamp `retain_until` on an invoice when its member is erased. A
-- gym-doc purge is the same shape of work and wants the same column, a
-- `retain_until` of its own, and an owner-facing screen that says what is about
-- to be destroyed. That is a part; it is not three lines in this one.
--
-- SO WHAT THIS FILE DOES INSTEAD IS MAKE THE OUTSTANDING SET VISIBLE. Part 390
-- left the query in a comment. A query in a comment is not a mechanism — that
-- is the same objection 1120 makes to web/delete-account.html inviting people
-- to send an email — so it becomes a view, and the day somebody writes the
-- retention part this is the list they work from.
--
-- security_invoker, so it inherits `gym_documents`' own SELECT policy
-- (`gym_doc_readable(tenant_id, member_attached, kind)`, part 390). A gym owner
-- sees their own building's outstanding paperwork and nobody else's, and a
-- trainer sees none of it, which is exactly what part 390 decided and this must
-- not quietly widen.

create or replace view public.gym_documents_about_erased_members
with (security_invoker = true) as
  select d.id,
         d.tenant_id,
         d.kind,
         d.title,
         d.storage_path,
         d.uploaded_at,
         d.expires_on,
         (now() - d.uploaded_at) as held_for
    from public.gym_documents d
   where d.member_attached
     and d.member_id is null
   order by d.uploaded_at;

comment on view public.gym_documents_about_erased_members is
  'Gym documents that are about a person who no longer has an account — member_attached is latched '
  'on and member_id has been set null by the erasure. NOT a purge queue: whether a gym''s copy of '
  'somebody''s contract outlives them is a per-country retention decision and belongs with '
  'tenants.record_retention_years. This is the list that decision will be made against. '
  'See supabase/parts/390 and 1152.';


-- ═════════════════════════════════════════════════════════════════════════
-- 7 · The backlog that already exists
-- ═════════════════════════════════════════════════════════════════════════
--
-- Everything erased before this part was applied, in the three buckets it adds.
-- 1120's section 8 does this for its three; this is the same statement for
-- `coach-logos`, `coach-docs` and `exercise-videos`, and the uid cast is inside
-- a CASE for the same reason 1120 gives — nothing guarantees Postgres evaluates
-- the arms of an AND left to right, so a regex test beside a cast can still
-- attempt the cast on a junk folder name and raise 22P02, taking the whole
-- statement with it.
--
-- On this project it finds nothing: all three buckets are empty today.
--
-- The rule is the OWNER, not the row: an object whose folder uid no longer
-- exists in `auth.users`. `exercise-videos` deliberately does NOT get the
-- other obvious rule — "an object no `exercise_videos` row points at" — because
-- `uploadExerciseVideo()` returns the path and the caller inserts the row
-- afterwards, so there is a window in which a perfectly live upload has no row,
-- and a backfill that ran inside it would queue a coach's clip for destruction
-- seconds after they recorded it. Objects stranded by the swallowed `remove()`
-- failure are covered going forward by section 3's trigger; the ones already
-- there, if any, are visible with:
--
--     select o.name, o.created_at
--       from storage.objects o
--      where o.bucket_id = 'exercise-videos'
--        and o.created_at < now() - interval '1 day'
--        and not exists (select 1 from public.exercise_videos v
--                         where v.video_path = o.name)
--      order by o.created_at;
--
-- and clearing them is an operator decision with eyes on it, not a statement in
-- a migration.

insert into public.object_purge (bucket_id, path, subject_id, note)
select s.bucket_id, s.name, s.owner_uid,
       'orphan found at apply time — owner already erased'
  from (
    select o.bucket_id,
           o.name,
           case when coalesce((storage.foldername(o.name))[1], '')
                     ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then ((storage.foldername(o.name))[1])::uuid
           end as owner_uid
      from storage.objects o
     where o.bucket_id in ('coach-logos', 'coach-docs', 'exercise-videos')
  ) s
 where s.owner_uid is not null
   and not exists (select 1 from auth.users u where u.id = s.owner_uid)
on conflict (bucket_id, path) do nothing;
