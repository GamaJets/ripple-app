-- ═══════════════════════════════════════════════════════════════════════════
-- The files an erasure left behind.
--
-- ── WHAT IS WRONG ─────────────────────────────────────────────────────────
--
-- There is exactly one thing in this database that chases bytes out of object
-- storage when a person is deleted, and it is
-- `on_progress_photo_delete` — the AFTER DELETE trigger part 45 puts on
-- `progress_photos`. Counted live rather than assumed, on 3 Sep 2026:
--
--     select c.relname, t.tgname from pg_trigger t
--       join pg_class c on c.oid = t.tgrelid
--      where not t.tgisinternal;
--
-- returns one storage-chasing trigger, on that one table, for that one bucket.
--
-- Three buckets hold a member's files and have no delete path at all:
--
--     injury-docs     part 91   a physiotherapy report, a scan result, a
--                               doctor's note. Diagnosis, clinician's name,
--                               hospital number, date of birth.
--     message-media   part 124  everything ever sent as an attachment in a
--                               coach conversation.
--     avatars         part 961  the member's face.
--
-- Part 91 says so itself, in its own operator note, and describes the fix it
-- deliberately did not write: "Closing it wants a follow-up part that mirrors
-- 45 for this bucket … It is not in this file because this file is the bucket
-- and its policies." This is that part, for all three at once.
--
-- ── WHAT IT DOES TO A REAL PERSON ────────────────────────────────────────
--
-- A member photographs an oncology letter so the app can read an injury off
-- it. Months later they leave the gym and delete their account. Every row goes
-- — 26 tables directly, 39 down the chain (part 41). The letter does not. It
-- sits in `injury-docs` under the uid of an account that no longer exists,
-- with no row anywhere pointing at it, indefinitely, and the only person who
-- could ever have deleted it is the one whose credentials were destroyed by
-- the deletion.
--
-- The public deletion page is currently honest about this and that is the
-- problem: web/delete-account.html says injury documents, message attachments
-- and the profile photo "are removed by us rather than by the scheduled job
-- that clears photographs", and invites the member to email and ask. A manual
-- step behind an email address is not an erasure mechanism. It is the same
-- class of fault as `request_account_deletion()` writing a timestamp nothing
-- read, which part 41 had to fix, and as the queue part 48 had to schedule
-- because nothing was draining it.
--
-- ── SHAPED THE SAME WAY AS PART 45, FOR THE SAME REASONS ─────────────────
--
-- Nothing here is invented. `storage.objects` carries Supabase's
-- `protect_objects_delete` (verified live: BEFORE DELETE, FOR EACH STATEMENT),
-- which refuses direct deletion and says to use the Storage API — and its own
-- hint spells out why, because deleting the metadata row leaves the bytes.
-- The only thing that removes bytes is a DELETE against the Storage HTTP API,
-- which needs a credential the erased person is not holding. So, exactly as in
-- part 45:
--
--   1. REMEMBER, before the row is gone. Here the paths are not in a row at
--      all — that is part 91's deliberate decision and it still stands — so
--      they are read out of `storage.objects` itself at the last moment the
--      subject is still identifiable, and copied into a queue.
--   2. PURGE asynchronously over pg_net, authenticating with the service_role
--      key read from Vault at call time, and stamp `purged_at` ONLY from a
--      reply that actually says the object is gone.
--
-- ── ONE QUEUE, THREE BUCKETS, AND NOT `photos` ───────────────────────────
--
-- Part 91 sketched an `injury_doc_purge`. This is one `object_purge` keyed on
-- (bucket_id, path) instead, because three copies of the same machine is three
-- places for the confirm logic to drift, and part 45's confirm logic is the
-- part that was already wrong once and had to be repaired in place (the
-- HTTP 400 / NoSuchKey case — a missing object was never confirmed, so the
-- queue could not empty and retried forever).
--
-- `photos` is deliberately NOT in this queue. It has a working machine, a
-- schedule (part 48) and one live row of history; two drains issuing DELETEs
-- for the same path would race and each would read the other's 404 as its own
-- confirmation. The check constraint below refuses 'photos' outright rather
-- than leaving that to a convention.
--
-- ── WHERE THE HOOK GOES, AND WHY NOT IN `action_account_deletion` ────────
--
-- A BEFORE DELETE trigger on `public.profiles`, which is where part 184
-- already hangs `profiles_retain_financial_record` for exactly this reason: a
-- cascading delete fires row triggers on the child table, so a profile going
-- because `auth.users` went fires this whether the erasure came from
-- `action_account_deletion()`, from the dashboard, or from the admin API.
-- Putting it inside `action_account_deletion()` would cover only the first of
-- those three, and the other two are the routes an operator actually uses when
-- something has gone wrong.
--
-- ── WHAT HAPPENS WHEN THE STORAGE DELETE FAILS ──────────────────────────
--
-- This is the whole point, so it is stated as four separate guarantees:
--
--   · The queue INSERT is NOT inside an exception block. A plpgsql EXCEPTION
--     block is a savepoint, so catching an error there would roll back the
--     record of the file as well — silently discarding the one piece of
--     information that cannot be recovered afterwards. If the enqueue cannot
--     happen, the erasure fails loudly and is retried, which is the correct
--     end of that trade.
--   · No HTTP call happens inside the erasure transaction AT ALL. Part 45's
--     trigger sends inline and swallows the failure; this one only enqueues,
--     and the cron drain sends. Part 48's own header gives the argument: "an
--     HTTP call inside the transaction that deletes a member's account would
--     make erasure depend on the storage service answering. It must not."
--   · `purged_at` is set only from a reply that confirms the object is gone.
--     200/204 = deleted. 404, or a 400 whose body carries NoSuchKey /
--     "statusCode":"404" / not_found = already absent, which is the same end
--     state. Everything else records the status AND the body and stays
--     pending.
--   · A failure is VISIBLE, never silent. A missing Vault secret writes
--     'no storage_service_key in Vault — file NOT deleted' and leaves the row
--     pending; a path that is not in the expected shape is refused rather than
--     sent half-encoded at some other object; and `file_purge_backlog` below
--     is the one query an operator runs to see everything outstanding and how
--     many times it has been tried.
--
-- ── OPERATOR STEP ────────────────────────────────────────────────────────
--
-- The same Vault secret part 45 needs, and it is ALREADY PRESENT on this
-- project (verified: one row named `storage_service_key` in vault.secrets; the
-- value was not read):
--
--     name:  storage_service_key
--     value: the project's service_role key
--
-- To see what is outstanding (SQL editor / service role — `object_purge` has
-- RLS on and no policies, so no end user can read it):
--
--     select * from public.file_purge_backlog;
--
-- To drain by hand at any time:
--
--     select public.purge_account_files();
--
-- ── MEASURED BEFORE WRITING, SO NOBODY READS MORE INTO THIS THAN IS THERE ─
--
-- Live object counts on 3 Sep 2026: `exercise-demos` 1640, EVERY OTHER BUCKET
-- ZERO. There is no member file in `injury-docs`, `message-media` or `avatars`
-- today, and no orphan for the backfill below to find. So applying this
-- changes nothing about any object that exists; it closes the hole before the
-- first real document lands in it, which is the only cheap moment to do so —
-- after that, every unqueued path is one nothing can enumerate a subject for.
--
-- Idempotent and safe to re-run: every create is `if not exists` or `or
-- replace`, the trigger is dropped by name first, the cron job is unscheduled
-- before it is scheduled, and the backfill inserts `on conflict do nothing`.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · The queue
-- ═════════════════════════════════════════════════════════════════════════
--
-- Deliberately NOT a foreign key to anything, for the reason part 45 gives
-- about `photo_purge`: the point of this table is that it outlives the row,
-- the profile and the auth user. A reference would either block the erasure or
-- null itself and lose the subject, and `subject_id` is how an operator
-- answers "whose files are these" once the account is gone.

create table if not exists public.object_purge (
  bucket_id       text not null,
  path            text not null,
  subject_id      uuid not null,
  queued_at       timestamptz not null default now(),
  attempts        int not null default 0,
  last_attempt_at timestamptz,
  request_id      bigint,            -- pg_net request; reply in net._http_response
  purged_at       timestamptz,       -- set only from a response that confirms it
  note            text,
  primary key (bucket_id, path)
);

-- The three buckets this queue is responsible for, named rather than implied.
-- 'photos' is refused: it has its own queue, its own sender and its own
-- schedule in parts 45 and 48, and two drains chasing one path would each read
-- the other's 404 as confirmation of its own request.
alter table public.object_purge drop constraint if exists object_purge_bucket_is_ours;
alter table public.object_purge add constraint object_purge_bucket_is_ours
  check (bucket_id in ('injury-docs', 'message-media', 'avatars'));

create index if not exists idx_object_purge_pending
  on public.object_purge (queued_at) where purged_at is null;

-- RLS on, and no policies — the same restriction `photo_purge` carries. These
-- rows name which member held which medical document; nothing an end user does
-- should read or write this. The functions below are security definer and
-- reach it as their owner, and an operator reads it in the SQL editor.
alter table public.object_purge enable row level security;

comment on table public.object_purge is
  'Files whose owner has been erased but whose bytes are still in object storage. '
  'Written by trg_profiles_queue_file_purge before a profile goes; drained by the '
  'purge-account-files cron job. purged_at is set ONLY from a Storage API reply that '
  'confirms the object is absent. See supabase/parts/1120.';


-- What is outstanding, and how hard it has been tried. The one query an
-- operator runs. security_invoker so it inherits object_purge's RLS — which is
-- "no policies", so this is readable by the owner and the service role and by
-- nobody else. Not granted to authenticated, on purpose.
create or replace view public.file_purge_backlog
with (security_invoker = true) as
  select bucket_id,
         path,
         subject_id,
         queued_at,
         attempts,
         last_attempt_at,
         note,
         (now() - queued_at) as outstanding_for
    from public.object_purge
   where purged_at is null
   order by queued_at;


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · Enumerating one person's files
-- ═════════════════════════════════════════════════════════════════════════
--
-- The step part 45 does not need and this cannot do without. A progress photo
-- has a row carrying its path, so the trigger reads OLD.image_path. None of
-- these three buckets has a row anywhere — part 91 refused one on purpose, and
-- that decision is not being reversed here — so the paths are read out of
-- `storage.objects` itself while the subject is still identifiable.
--
-- SECURITY DEFINER because `storage.objects` is owned by
-- supabase_storage_admin and has RLS on. The owner of this function is the
-- role that applies setup.sql (`postgres`), which has SELECT on the table and
-- BYPASSRLS — verified live rather than assumed. The function reads; it never
-- deletes from `storage.objects`, which `protect_objects_delete` would refuse
-- anyway.
--
-- ── THE TWO-SEGMENT CASE ─────────────────────────────────────────────────
--
-- `injury-docs` and `avatars` are `<uid>/<file>`: one owner, first segment.
--
-- `message-media` is `<thread_id>/<sender_uid>/<file>` (part 124), and BOTH
-- segments matter:
--
--   · segment 1 is the thread, which for a client is their own id. When a
--     member is erased the thread ceases to exist — the messages cascade, and
--     `can_use_message_thread()` stops answering true for anybody — so every
--     object under it goes, including the clips their coach recorded for them.
--     Leaving the coach's uploads behind would leave photographs OF the erased
--     member in a conversation that no longer exists.
--   · segment 2 is who uploaded it. When a COACH is erased their own uploads
--     sit under other people's thread folders, and those are the coach's data.
--
-- So: first segment OR second segment. `storage.foldername()` returns NULL
-- past the end of the array, which is not equal to anything, so a one-segment
-- key in this bucket simply does not match rather than erroring.
--
-- NOT granted to authenticated or anon. This is the one function here that
-- takes an arbitrary uuid and queues somebody's files for destruction; a grant
-- would let any signed-in person aim it at anybody. Its only callers are the
-- trigger below (which runs as this function's owner) and an operator.

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
     where (o.bucket_id in ('injury-docs', 'avatars')
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
-- 3 · The hook — BEFORE DELETE on profiles
-- ═════════════════════════════════════════════════════════════════════════
--
-- BEFORE, because afterwards there is no subject to enumerate by: the uid is
-- the only thing that connects a person to an object key, and after the delete
-- nothing in the database holds it.
--
-- On `profiles` rather than inside `action_account_deletion()`, because a
-- cascading delete fires row triggers on the child table — `profiles.id`
-- references `auth.users(id) on delete cascade` — so this covers the owner
-- actioning a request, an operator deleting the user in the dashboard, and the
-- admin API. Part 184's `trg_profiles_retain_financial_record` is the same
-- trigger point for the same reason, and the two are independent of each
-- other's ordering.
--
-- No exception block, and no pg_net call. Both deliberate, and stated at
-- length in the header: the enqueue must not be silently rolled back, and the
-- erasure must not depend on the storage service answering.

create or replace function public.profiles_queue_file_purge()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.queue_account_object_purges(old.id);
  return old;
end $$;

drop trigger if exists trg_profiles_queue_file_purge on public.profiles;
create trigger trg_profiles_queue_file_purge
  before delete on public.profiles
  for each row execute function public.profiles_queue_file_purge();


-- ═════════════════════════════════════════════════════════════════════════
-- 4 · Sending one DELETE
-- ═════════════════════════════════════════════════════════════════════════
--
-- Modelled line for line on `purge_photo_file()`. It acts ONLY on a
-- (bucket, path) already sitting in the queue with `purged_at` null — that is,
-- a file whose owner is already erased and which is already destined for
-- removal. There is no argument shape that makes it touch anything else.
--
-- The path goes into a URL, so it is checked against the shape the app builds
-- and the storage policies enforce, per bucket, and refused rather than sent
-- half-encoded where it could address a different object. The three
-- expressions are the SQL of `INJURY_DOC_PATH_RE` (src/ui/injuryDocs.ts),
-- `avatarObjectKey` (src/lib/avatarImage.ts) and
-- `MESSAGE_ATTACHMENT_PATH_RE` (src/lib/messageAttachments.ts).
--
-- Not granted to anon or authenticated: unlike part 45's, nothing in the app
-- calls this. The drain is the cron job, which runs as the table owner.

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
    when 'injury-docs'   then p_path ~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,120}$'
    when 'avatars'       then p_path ~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,120}$'
    when 'message-media' then p_path ~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,120}$'
    else false
  end;

  if not v_shape_ok then
    update public.object_purge
       set note = 'path is not the expected shape for ' || p_bucket || ' — NOT sent',
           last_attempt_at = now()
     where bucket_id = p_bucket and path = p_path;
    return;
  end if;

  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'storage_service_key' limit 1;

  if v_key is null or v_key = '' then
    update public.object_purge
       set note = 'no storage_service_key in Vault — file NOT deleted',
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
-- 5 · Reading the answer back
-- ═════════════════════════════════════════════════════════════════════════
--
-- Taken from `confirm_photo_purges()` including the repair part 45 had to make
-- in place, because getting this wrong is the difference between a queue that
-- empties and one that retries forever while reporting nothing:
--
--   Supabase Storage answers a DELETE for a MISSING object with HTTP 400 whose
--   BODY carries the real story —
--
--     status_code 400
--     {"statusCode":"404","error":"not_found","message":"Object not found",
--      "code":"NoSuchKey"}
--
--   so a status-only check never confirms an already-absent file.
--
-- `net._http_response` is pruned by pg_net after a few hours. A request whose
-- reply has aged out stays pending and is re-sent; a DELETE of an absent
-- object is idempotent, so re-sending costs nothing.
--
-- Nothing in here marks a file deleted because it asked nicely. The failure
-- branches keep the response BODY as well as the status, for the reason part
-- 45 records: "storage returned 400" alone covers both a missing file and a
-- genuine refusal, and those need different actions from an operator.

create or replace function public.confirm_object_purges()
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_status int;
  v_err text;
  v_body text;
  v_absent boolean;
  n int := 0;
begin
  for r in
    select bucket_id, path, request_id from public.object_purge
     where purged_at is null and request_id is not null
     limit 500
  loop
    select status_code, error_msg, content
      into v_status, v_err, v_body
      from net._http_response where id = r.request_id;

    v_absent := v_body is not null
                and (v_body like '%NoSuchKey%' or v_body like '%"statusCode":"404"%'
                     or v_body like '%not_found%');

    if v_status in (200, 204, 404) or (v_status = 400 and v_absent) then
      update public.object_purge
         set purged_at = now(),
             note = case when v_status in (200, 204) then 'deleted' else 'already absent' end
       where bucket_id = r.bucket_id and path = r.path;
      n := n + 1;
    elsif v_status is not null then
      update public.object_purge
         set note = 'storage returned ' || v_status
                    || coalesce(' — ' || left(coalesce(v_body, v_err), 200), '')
       where bucket_id = r.bucket_id and path = r.path;
    elsif v_err is not null then
      update public.object_purge set note = v_err
       where bucket_id = r.bucket_id and path = r.path;
    end if;
    -- v_status and v_err both null: the reply has not arrived or has aged out.
    -- Leave it pending; the next drain re-sends.
  end loop;
  return n;
end $$;

revoke execute on function public.confirm_object_purges() from public, anon, authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 6 · The drain
-- ═════════════════════════════════════════════════════════════════════════
--
-- Confirm what is outstanding, then re-send everything still pending. The
-- operator's entry point and the retry, bounded so it cannot become a
-- thundering herd against our own storage — 200 a run, at twelve runs an hour,
-- which drains a large erasure inside a few minutes and cannot spike.
--
-- Ordered by attempts first so a path that has never been tried is never stuck
-- behind one that is failing repeatedly. Part 45 orders by queued_at alone; a
-- single permanently-refused object at the head of a 200-row window would
-- otherwise be re-sent ahead of new work on every single run.

create or replace function public.purge_account_files()
returns table (confirmed int, sent int)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  n int := 0;
begin
  confirmed := public.confirm_object_purges();
  for r in
    select bucket_id, path from public.object_purge
     where purged_at is null
     order by attempts, queued_at
     limit 200
  loop
    perform public.purge_stored_object(r.bucket_id, r.path);
    n := n + 1;
  end loop;
  sent := n;
  return next;
end $$;

revoke execute on function public.purge_account_files() from public, anon, authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 7 · Running it
-- ═════════════════════════════════════════════════════════════════════════
--
-- Every five minutes, the cadence part 48 argues for: the owner is already
-- erased and nobody can reach these objects, so minutes of latency cost
-- nothing, and the queue holds each path until storage confirms so a missed
-- run is picked up by the next rather than losing the file for good.
--
-- Offset by two minutes from `purge-progress-photo-files`, which is on the
-- same period. Both drains issue DELETEs against the same storage service with
-- the same credential; there is no reason to have them fire in the same second
-- every five minutes.
--
-- Unscheduled first so re-running this file cannot accumulate duplicate jobs
-- each firing the same drain.

create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-account-files') then
    perform cron.unschedule('purge-account-files');
  end if;
end $$;

select cron.schedule(
  'purge-account-files',
  '2-59/5 * * * *',
  $cron$ select public.purge_account_files(); $cron$
);


-- ═════════════════════════════════════════════════════════════════════════
-- 8 · The backlog that already exists
-- ═════════════════════════════════════════════════════════════════════════
--
-- Everything erased before this part was applied. Part 91 wrote the query for
-- finding it — "Those are documents belonging to accounts that no longer
-- exist" — and this is that query, widened to all three buckets and pointed at
-- the queue instead of at a human.
--
-- On this project it finds nothing: all three buckets are empty today
-- (measured, see the header). It is here so that a project which is NOT empty
-- when this lands is caught up rather than starting clean from the date of the
-- fix, which would leave exactly the files this part exists for.
--
-- The uid cast is inside a CASE, not beside a regex test in an AND. Nothing
-- guarantees Postgres evaluates the arms of an AND in the order they are
-- written, so `… ~ '<uuid shape>' and id = folder::uuid` can still attempt the
-- cast on a junk folder name and raise 22P02, taking the whole statement with
-- it. CASE does not evaluate the branches it does not take. This is the guard
-- part 124 spells out for `can_use_message_thread`, for the same hazard.

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
     where o.bucket_id in ('injury-docs', 'avatars', 'message-media')
  ) s
 where s.owner_uid is not null
   and not exists (select 1 from auth.users u where u.id = s.owner_uid)
on conflict (bucket_id, path) do nothing;

-- The other half of the message-media case: an object whose THREAD owner still
-- exists but whose SENDER has been erased. Separate statement rather than an
-- `or`, because the subject recorded has to be the erased person and that is a
-- different segment.
insert into public.object_purge (bucket_id, path, subject_id, note)
select s.bucket_id, s.name, s.sender_uid,
       'orphan found at apply time — sender already erased'
  from (
    select o.bucket_id,
           o.name,
           case when coalesce((storage.foldername(o.name))[2], '')
                     ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then ((storage.foldername(o.name))[2])::uuid
           end as sender_uid
      from storage.objects o
     where o.bucket_id = 'message-media'
  ) s
 where s.sender_uid is not null
   and not exists (select 1 from auth.users u where u.id = s.sender_uid)
on conflict (bucket_id, path) do nothing;
