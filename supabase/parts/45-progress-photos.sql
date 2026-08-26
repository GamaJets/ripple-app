-- ─────────────────────────────────────────────────────────────────────────
-- Progress photos — make them real, and make deleting them real too.
--
-- WHAT WAS THERE. `progress_photos` has existed since 01-schema.sql with RLS
-- enabled and, in this repo, zero policies — so a fresh project got a table
-- nobody could write to. Live, two policies had been added by hand and never
-- written down (the same drift that produced parts 23–25). The `photos` bucket
-- existed, private, with NO policies on storage.objects at all: the only
-- bucket-scoped policies live were `exvid_obj_insert/read/delete` for
-- `exercise-videos`. Nothing could put a byte in `photos` or read one out.
-- Meanwhile app/(client)/scans.tsx held photos in useState and told the member
-- how many were "on screen", because saying "saved" would have been a lie.
--
-- This file is the storage side of making that label true.
--
-- ── THE THING THAT MAKES THIS HARD ───────────────────────────────────────
--
-- `progress_photos.client_id` cascades from `clients`, so account deletion
-- removes the ROWS. It does not remove the FILES. There is no cascade from a
-- database table into object storage, and Supabase now blocks the obvious
-- workaround outright: `storage.objects` carries a BEFORE DELETE trigger,
-- `protect_objects_delete`, whose function raises
--
--   'Direct deletion from storage tables is not allowed. Use the Storage API
--    instead.'  HINT: 'This prevents accidental data loss from orphaned objects.'
--
-- unless `storage.allow_delete_query` is set. Read that hint carefully: it is
-- Supabase confirming that deleting the metadata row leaves the bytes behind.
-- So a trigger that deletes from storage.objects would either fail outright or,
-- if forced, produce exactly the orphan it looks like it is preventing.
--
-- The only thing that removes the bytes is a DELETE against the Storage HTTP
-- API. That needs a credential, and at the moment of account deletion the
-- person is not the one holding it — an owner actions the deletion, possibly
-- 30 days after the member last opened the app.
--
-- ── THE SOLUTION, IN TWO HALVES ──────────────────────────────────────────
--
-- 1. REMEMBER. An AFTER DELETE trigger on `progress_photos` copies the storage
--    path into `photo_purge` before the row is gone for good. This fires for a
--    single-photo delete AND for the account-deletion cascade. Without it the
--    paths are simply unknowable afterwards — the row that held the path is
--    the thing that was deleted. Everything else depends on this step.
--
-- 2. PURGE. `purge_photo_file()` issues a DELETE to the Storage API over
--    pg_net, authenticating with the project's service_role key read from
--    Vault at call time — the pattern already used by `notify_on_message()` in
--    26-message-notifications.sql, for the same reason (a key in a function
--    body is readable by anything that can read pg_proc).
--
--    pg_net is asynchronous: the call queues the request and a background
--    worker sends it, so nothing blocks the delete or the cascade. The reply
--    lands in `net._http_response`, and `confirm_photo_purges()` reads it back
--    and stamps `purged_at` ONLY on a response that actually says the object
--    is gone. Nothing in here marks a file deleted because it asked nicely.
--
-- OPERATOR STEP, AND WHAT HAPPENS WITHOUT IT.  This needs one Vault secret:
--
--     name:  storage_service_key
--     value: the project's service_role key
--            (Dashboard ▸ Project Settings ▸ API ▸ service_role)
--     put it in: Dashboard ▸ Project Settings ▸ Vault
--
-- Until that exists, every delete still lands in `photo_purge`, `purged_at`
-- stays null and `note` reads 'no storage_service_key in Vault'. That is the
-- honest failure: the work is recorded and visibly outstanding, rather than
-- silently skipped. After creating the secret, run
--
--     select public.purge_progress_photo_files();
--
-- once and the backlog drains. It is safe to run at any time; it only ever
-- touches paths whose database row is already deleted.
--
-- To see what is outstanding (SQL editor / service role — photo_purge has RLS
-- on and no policies, so no end user can read it):
--
--     select path, subject_id, queued_at, attempts, note
--       from public.photo_purge where purged_at is null order by queued_at;
--
-- ── WHY THE TRIGGER FUNCTION IS NOT `SECURITY DEFINER`-WITH-A-`current_user`-
--    GUARD.  It is security definer (it must write photo_purge past RLS and
--    call pg_net), but it tests nothing about who the caller is. Inside a
--    definer function `current_user` is the function's OWNER, not the caller,
--    so a `current_user` guard in here would never fire and would read like
--    protection while providing none. The authorisation that matters is on the
--    DELETE that fires this trigger, and it is RLS, above.
-- ─────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · Storage policies for the `photos` bucket
-- ═════════════════════════════════════════════════════════════════════════
--
-- Own-folder access, keyed on the first path segment, exactly as the
-- exercise-videos policies do. The difference is READ: `exercise-videos` is a
-- public bucket and `exvid_obj_read` is bucket-wide. `photos` is PRIVATE, and
-- read here is own-folder too — a progress photo is read through a signed URL
-- minted by its owner, never a public URL.
--
-- RLS on storage.objects is enabled by Supabase itself. Asserting it rather
-- than assuming it, because a policy on a table with RLS off is inert and
-- would look like a working restriction.

do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity
  ) then
    raise exception 'storage.objects does not have RLS enabled — the policies below would be inert.';
  end if;
end $$;

drop policy if exists photos_obj_insert on storage.objects;
create policy photos_obj_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists photos_obj_read on storage.objects;
create policy photos_obj_read on storage.objects for select to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists photos_obj_delete on storage.objects;
create policy photos_obj_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · Row policies on progress_photos
-- ═════════════════════════════════════════════════════════════════════════
--
-- RLS was enabled in 01-schema.sql, which runs first. Re-declaring the owner
-- policy here puts it in the repo, where it was missing.
--
-- `for all` with no `with check` means the USING expression is also the check,
-- so a member cannot insert a row naming somebody else as its subject.

drop policy if exists progress_photos_owner on public.progress_photos;
create policy progress_photos_owner on public.progress_photos for all
  using (client_id = (select auth.uid()))
  with check (client_id = (select auth.uid()));

-- ── COACH ACCESS: deliberately none. ─────────────────────────────────────
--
-- Live carried a `progress_photos_trainer_read` policy — a SELECT for the
-- linked trainer, mirroring scans_trainer_read from 19-trainer-read-access.sql.
-- It is dropped here on purpose, and this is the reasoning, so that nobody
-- re-adds it by pattern-matching on the other tables:
--
--   · A progress photo is not a weight number. It is typically taken in
--     underwear, alone, in a bathroom. A coach seeing a client's body-fat
--     percentage is the product working; a coach seeing that photo without the
--     client choosing it is a different act entirely.
--   · There is no consent step. The app has no per-photo sharing control, no
--     indicator that anyone else can see them, and no way to take it back. A
--     read policy would mean people upload believing it is private and are
--     wrong. Sharing has to be something you DO, not something that is true by
--     default because of who your coach is.
--   · It buys nothing today. Nothing in the coach app renders client progress
--     photos, so the policy granted access no screen used — a standing
--     exposure with no feature behind it.
--   · It was latent, which is worse than open. The row also carries
--     `image_path`. The day somebody adds a coach-side signed-URL helper, the
--     photos become visible with no review of consent, because the "hard part"
--     already looked done.
--
-- When per-photo sharing ships, it wants a `shared_with_coach boolean not null
-- default false` on this table, a SELECT policy gated on it, AND a matching
-- storage.objects policy — the row and the file have to be granted separately,
-- which is the whole shape of this file. Until then: no coach access at either
-- layer, stated rather than inherited.

drop policy if exists progress_photos_trainer_read on public.progress_photos;

create index if not exists idx_progress_photos_client
  on public.progress_photos (client_id, taken_at);


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · The purge queue
-- ═════════════════════════════════════════════════════════════════════════
--
-- Deliberately NOT a foreign key to anything. The point of this table is that
-- it outlives the row, the client, the profile and the auth user — a reference
-- would either block the cascade or null itself and lose the path, which is
-- the one column that matters.

create table if not exists public.photo_purge (
  path            text primary key,
  subject_id      uuid not null,
  queued_at       timestamptz not null default now(),
  attempts        int not null default 0,
  last_attempt_at timestamptz,
  request_id      bigint,            -- pg_net request; reply in net._http_response
  purged_at       timestamptz,       -- set only from a response that confirms it
  note            text
);

create index if not exists idx_photo_purge_pending
  on public.photo_purge (queued_at) where purged_at is null;

-- RLS on, and no policies. Nothing an end user does should read or write this
-- directly; the functions below are security definer and reach it as their
-- owner, and an operator reads it in the SQL editor. RLS is enabled BEFORE any
-- policy exists, per the house rule — here there simply are none, which is the
-- restriction.
alter table public.photo_purge enable row level security;


-- ═════════════════════════════════════════════════════════════════════════
-- 4 · Purging
-- ═════════════════════════════════════════════════════════════════════════

-- Read back what pg_net actually got, and stamp purged_at only on an answer
-- that means the object is no longer there. 200 = deleted. 404 = it was
-- already gone, which is the same end state and is the normal case when the
-- app deleted the file itself before deleting the row. Anything else is
-- recorded and left pending for a retry.
--
-- net._http_response is pruned by pg_net after a few hours. A request whose
-- reply has aged out simply stays pending and gets re-sent; a DELETE of an
-- absent object is idempotent, so re-sending costs nothing.
create or replace function public.confirm_photo_purges()
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
    select path, request_id from public.photo_purge
     where purged_at is null and request_id is not null
     limit 500
  loop
    select status_code, error_msg, content
      into v_status, v_err, v_body
      from net._http_response where id = r.request_id;

    -- Supabase Storage answers a DELETE for a MISSING object with HTTP 400
    -- whose BODY carries the real story:
    --
    --   status_code 400
    --   {"statusCode":"404","error":"not_found","message":"Object not found",
    --    "code":"NoSuchKey"}
    --
    -- The check was `v_status in (200, 204, 404)`, so an already-absent file
    -- was NEVER confirmed: it stayed pending, was re-sent on every drain, and
    -- the queue could not empty. An infinite retry for a file already in the
    -- state we wanted.
    --
    -- Found by queueing a correctly-shaped path for a file that does not
    -- exist and reading net._http_response, rather than accepting that a
    -- dispatched request meant a working one.
    v_absent := v_body is not null
                and (v_body like '%NoSuchKey%' or v_body like '%"statusCode":"404"%'
                     or v_body like '%not_found%');

    if v_status in (200, 204, 404) or (v_status = 400 and v_absent) then
      update public.photo_purge
         set purged_at = now(),
             note = case when v_status in (200, 204) then 'deleted' else 'already absent' end
       where path = r.path;
      n := n + 1;
    elsif v_status is not null then
      update public.photo_purge
      -- Keep the body. "storage returned 400" alone is what made this hard to
      -- read: 400 covers both a missing file and a genuine refusal.
         set note = 'storage returned ' || v_status
                    || coalesce(' — ' || left(coalesce(v_body, v_err), 200), '')
       where path = r.path;
    elsif v_err is not null then
      update public.photo_purge set note = v_err where path = r.path;
    end if;
    -- v_status and v_err both null: the reply has not arrived or has aged out.
    -- Leave it pending; the next drain re-sends.
  end loop;
  return n;
end $$;

revoke execute on function public.confirm_photo_purges() from public, anon;
grant execute on function public.confirm_photo_purges() to authenticated;


-- Send one DELETE to the Storage API for one queued path.
--
-- Callable by any signed-in user, and that is safe on purpose: it acts ONLY on
-- a path already sitting in photo_purge with purged_at null — that is, a file
-- whose database row is already deleted and which is already destined for
-- removal. There is no argument shape that makes it touch anything else. It
-- takes no caller identity into account because it is not making an
-- authorisation decision; the decision was made when the row was deleted.
create or replace function public.purge_photo_file(p_path text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_key text;
  v_req bigint;
begin
  if p_path is null or not exists (
    select 1 from public.photo_purge where path = p_path and purged_at is null
  ) then
    return;
  end if;

  -- The path goes into a URL. Ours are '<uuid>/<millis>-<token>.jpg' and need
  -- no escaping; anything else is refused rather than sent half-encoded, where
  -- it could address a different object.
  if p_path !~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,120}$' then
    update public.photo_purge
       set note = 'path is not in the expected <uid>/<name> shape — not sent'
     where path = p_path;
    return;
  end if;

  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'storage_service_key' limit 1;

  if v_key is null or v_key = '' then
    update public.photo_purge
       set note = 'no storage_service_key in Vault — file NOT deleted'
     where path = p_path;
    return;
  end if;

  select net.http_delete(
    url     := 'https://phgfwzpkkwdysftlgkoq.supabase.co/storage/v1/object/photos/' || p_path,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'apikey',        v_key)
  ) into v_req;

  update public.photo_purge
     set request_id = v_req,
         attempts = attempts + 1,
         last_attempt_at = now(),
         note = 'sent'
   where path = p_path;
end $$;

revoke execute on function public.purge_photo_file(text) from public, anon;
grant execute on function public.purge_photo_file(text) to authenticated;


-- Confirm what is outstanding, then re-send everything still pending. The
-- operator's entry point, and the retry. Bounded so it cannot become a
-- thundering herd against our own storage.
create or replace function public.purge_progress_photo_files()
returns table (confirmed int, sent int)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  n int := 0;
begin
  confirmed := public.confirm_photo_purges();
  for r in
    select path from public.photo_purge
     where purged_at is null order by queued_at limit 200
  loop
    perform public.purge_photo_file(r.path);
    n := n + 1;
  end loop;
  sent := n;
  return next;
end $$;

revoke execute on function public.purge_progress_photo_files() from public, anon;
grant execute on function public.purge_progress_photo_files() to authenticated;


-- The app's way to hand back a file it uploaded but could not attach to a row,
-- or could not delete itself. Own-folder only: the first path segment must be
-- the caller's own uid, which is the same rule the storage policies enforce.
-- Without this, a failed row insert after a successful upload would leave a
-- file that nothing in the system knows the name of.
create or replace function public.queue_photo_file_purge(p_path text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_path is null or split_part(p_path, '/', 1) <> v_uid::text then
    raise exception 'that is not your file' using errcode = '42501';
  end if;

  insert into public.photo_purge (path, subject_id, note)
  values (p_path, v_uid, 'orphan handed back by the app')
  on conflict (path) do nothing;

  perform public.purge_photo_file(p_path);
end $$;

revoke execute on function public.queue_photo_file_purge(text) from public, anon;
grant execute on function public.queue_photo_file_purge(text) to authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 5 · The trigger — the half that cannot be added later
-- ═════════════════════════════════════════════════════════════════════════
--
-- The queue INSERT is outside the exception block on purpose. A plpgsql
-- EXCEPTION block is a savepoint: catching an error rolls back everything done
-- inside it. Putting the insert in there would mean a failing pg_net call
-- silently discarded the record of the file as well, which is precisely the
-- outcome this whole file exists to prevent.
--
-- The send IS inside one, because nothing about object storage may block a
-- person's deletion — least of all an account deletion cascade.

create or replace function public.on_progress_photo_deleted()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if OLD.image_path is not null and OLD.image_path <> '' then
    insert into public.photo_purge (path, subject_id)
    values (OLD.image_path, OLD.client_id)
    on conflict (path) do update set purged_at = null, note = 'requeued';

    begin
      perform public.purge_photo_file(OLD.image_path);
    exception when others then
      -- Recorded above; a later purge_progress_photo_files() re-sends it.
      null;
    end;
  end if;
  return OLD;
end $$;

drop trigger if exists on_progress_photo_delete on public.progress_photos;
create trigger on_progress_photo_delete
  after delete on public.progress_photos
  for each row execute function public.on_progress_photo_deleted();
