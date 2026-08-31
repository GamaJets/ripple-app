-- ─────────────────────────────────────────────────────────────────────────
-- Message attachments — a photo of the machine, and a clip of the third rep.
--
-- The coach↔client thread has been text since part 10. Everything the two of
-- them actually need to say to each other is visual: "is this the right
-- machine", "is my back rounding here", "this is what I ate". Until now the
-- answer was a screenshot sent through some other app, which is the one place
-- a coaching conversation goes where neither the plan nor the injury record
-- nor anything else in this product can see it.
--
-- This part is the storage half. It adds one reference to `messages` and one
-- PRIVATE bucket whose policies name the two people on the thread and nobody
-- else.
--
-- ── WHO CAN SEE AN ATTACHMENT ────────────────────────────────────────────
--
-- The client, and the coach who coaches them. That is the whole list, and it
-- is deliberately the SAME list `messages` itself already uses — part 10's
-- msg_client (`client_id = auth.uid()`) and msg_coach (`is_my_client(...)`).
-- One rule for the row and the file it points at, asked in one place
-- (`can_use_message_thread` below), because two copies of a permission drift
-- and the copy that drifts wider is the one nobody notices.
--
-- This is a different stance from 91-injury-documents.sql, and the difference
-- is consent, not squeamishness. A physio report is a medical record the
-- client uploaded for the app to read; nobody agreed to hand it to their coach,
-- so those policies are own-folder at every verb. An attachment on a message
-- is a thing one person deliberately SENT to the other. Withholding it from
-- the recipient would not be privacy, it would be a broken feature.
--
-- What is NOT on the list, and must never be added by pattern-matching on
-- 19-trainer-read-access.sql or 38-tenant-isolation.sql: the gym owner, other
-- trainers at the same tenant, a previous coach, or `role = 'owner'` in any
-- form. Part 120's lesson stands — `role = 'owner'` is never an authorisation.
-- A gym owner reading the photographs two people sent each other in a private
-- conversation is the single worst outcome this file can have, and there is no
-- product reason that reaches it.
--
-- ── OBJECT KEY SHAPE ─────────────────────────────────────────────────────
--
--   message-media/<client_id>/<sender_uid>/<millis>-<token>.<ext>
--
-- Two segments carry meaning and both are checked by the policies:
--
--   [1] client_id  — the THREAD. It is what the read policy asks about, so an
--                    object's folder is what decides who may sign a URL for it.
--   [2] sender_uid — WHO PUT IT THERE. Only its owner may write into it.
--
-- The second segment exists because of part 83. There, a missing DROP left a
-- policy standing that let a client insert a row with `sender = 'coach'` — a
-- message their own coach appeared to have written. The same forgery is
-- available on a bucket keyed only by thread: both participants can write to
-- the thread folder, so either could upload a file and then point a row at it.
-- The row's `sender` is pinned by the table policies; segment [2] pins the
-- object's provenance the same way, at the same moment, in the same statement.
--
-- src/lib/messageAttachments.ts builds and validates this exact shape client
-- side, so a mismatch fails somewhere with a readable sentence rather than as
-- a bare 403 the app renders as "sent".
--
-- The bucket is PRIVATE. A file is read through a short-lived signed URL minted
-- by a participant — never getPublicUrl(), which hands back a working-looking
-- string for a private object that then 400s. Signing is itself checked against
-- the SELECT policy below, which is what makes the policy the only way in.
--
-- ── OPERATOR NOTE: THE FILE DOES NOT FOLLOW THE ROW ──────────────────────
--
-- `messages.client_id` cascades from `clients`, so deleting a client deletes
-- their thread. It does not delete the objects: storage rows are not deleted by
-- a foreign key on a different table, and bytes only go when something calls
-- the Storage API (the account of `protect_objects_delete` in
-- 45-progress-photos.sql is the long version).
--
-- That gap is the same one 91 leaves open and it wants the same follow-up — a
-- purge queue plus a `purge_message_media(path)` over pg_net with the Vault
-- secret `storage_service_key`. It is not in this file for the reason 91 gives:
-- a second copy of that machine deserves its own review rather than riding
-- along at the bottom of another part.
--
-- Until it exists, what is outstanding is visible with:
--
--     select (storage.foldername(name))[1] as thread, name, created_at
--       from storage.objects
--      where bucket_id = 'message-media'
--        and (storage.foldername(name))[1]::uuid not in (select id from public.clients)
--      order by created_at;
--
-- Those are attachments whose thread no longer exists.
-- ─────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · The reference on the message
-- ═════════════════════════════════════════════════════════════════════════
--
-- Two columns and nothing else. `attachment_path` is the storage key;
-- `attachment_kind` is what to draw with it, because an app cannot tell an
-- image from a video by looking at a path it has not fetched, and guessing
-- from the extension is how a video ends up in an <Image> as a grey box.
--
-- No width, no height, no duration, no caption, no thumbnail column. Each of
-- those is a number the app would have to measure and could get wrong, and a
-- figure this product states without having read it is the fault
-- check-numbers.mjs exists for.
alter table public.messages add column if not exists attachment_path text;
alter table public.messages add column if not exists attachment_kind text;

alter table public.messages drop constraint if exists messages_attachment_kind_chk;
alter table public.messages add constraint messages_attachment_kind_chk
  check (attachment_kind is null or attachment_kind in ('image', 'video'));

-- Both or neither. A path with no kind is a file the app will not draw; a kind
-- with no path is a bubble claiming a photo that does not exist — which is
-- precisely the "it says it sent an image and did not" failure this feature was
-- written to make impossible.
alter table public.messages drop constraint if exists messages_attachment_pair_chk;
alter table public.messages add constraint messages_attachment_pair_chk
  check ((attachment_path is null) = (attachment_kind is null));

-- A row may only ever point INTO ITS OWN THREAD'S FOLDER.
--
-- Reading someone else's attachment is already refused by the storage policy,
-- so this is not the thing standing between a stranger and the file. It is what
-- stops a legitimate participant from AIMING a row somewhere else: without it,
-- a client could insert a message in their own thread carrying the path of an
-- object in another thread, and while nothing would render it for them, the
-- database would be storing a reference that means something it does not say.
-- Structural is better than refused-later, and the cast is immutable so this
-- survives a dump and restore.
alter table public.messages drop constraint if exists messages_attachment_thread_chk;
alter table public.messages add constraint messages_attachment_thread_chk
  check (attachment_path is null or attachment_path like client_id::text || '/%');

-- `body` stays NOT NULL and an attachment-only message carries ''. Nothing
-- invents a caption from a filename: "IMG_4821.HEIC" under a photograph is not
-- a thing the sender said.
comment on column public.messages.attachment_path is
  'Storage key in the private `message-media` bucket: <client_id>/<sender_uid>/<file>. '
  'Read through a short-lived signed URL. See supabase/parts/124.';
comment on column public.messages.attachment_kind is
  'image | video — what to draw with the path. Null exactly when the path is null.';


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · The bucket
-- ═════════════════════════════════════════════════════════════════════════
--
-- Private, and re-asserted private on every run: `public = false` sits in the
-- DO UPDATE rather than being left to the insert, so a bucket somebody flipped
-- public in the dashboard is flipped back by re-running setup.sql rather than
-- quietly kept that way. `exercise-videos` was public for months for exactly
-- that reason — created by hand, written down nowhere (part 49).
--
-- 64 MB. An image is downscaled to 1600px and re-encoded as JPEG before upload,
-- so it lands at a fraction of that; the limit is sized for the video half,
-- where the picker caps recording at 30 seconds. The app checks the byte length
-- against the same figure BEFORE uploading, because a 413 from storage arrives
-- as an opaque failure and "that clip is too long to send" is a sentence
-- somebody can act on.
--
-- MIME types are a real limit rather than a default. JPEG and PNG because that
-- is what the manipulator emits and what <Image> draws; MP4 and QuickTime
-- because that is what the two pickers hand back. No PDF, no HEIC: a HEIC
-- would upload happily under an image/jpeg content type that is a lie, and the
-- re-encode in src/ui/messaging.ts is what stops one ever getting here.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('message-media', 'message-media', false, 67108864,
        array['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · One definition of "you are on this thread"
-- ═════════════════════════════════════════════════════════════════════════
--
-- Takes the FIRST PATH SEGMENT as text and answers whether the caller is one of
-- the two people on that thread. Three things about the shape are deliberate.
--
-- It takes text, not uuid, because that is what `storage.foldername(name)`
-- returns and casting in the policy would raise 22P02 on any object whose
-- folder is not a uuid — including one in another bucket, since nothing
-- guarantees Postgres evaluates the `bucket_id` arm of an AND first. The CASE
-- below is the guard: CASE does not evaluate the branches it does not take, so
-- a junk folder name returns false instead of erroring the whole statement.
--
-- It is SECURITY DEFINER so the storage policy does not depend on the caller's
-- own visibility of `clients`, and so it cannot re-enter a policy and recurse —
-- the fault part 54 had to undo across the whole video library, where every
-- read failed 42P17 for everybody and looked like an empty library.
--
-- And its body is the union of msg_client and msg_coach, spelled out rather
-- than approximated: `is_my_client()` is what msg_coach evaluates, so the
-- storage rule and the table rule cannot answer differently about the same two
-- people.
create or replace function public.can_use_message_thread(p_thread text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select case
    when p_thread is null then false
    when p_thread !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then false
    when p_thread::uuid = (select auth.uid()) then true
    else exists (
      select 1 from public.clients c
       where c.id = p_thread::uuid
         and c.trainer_id = (select auth.uid()))
  end;
$function$;

comment on function public.can_use_message_thread(text) is
  'Is the caller one of the two people on this message thread? Takes the first '
  'path segment of a message-media object key. SECURITY DEFINER so the storage '
  'policies do not depend on the caller''s own read of clients. See parts 124, 54.';

-- `revoke ... from public` alone leaves BOTH API roles standing — Supabase
-- grants execute to anon and authenticated separately, which is exactly how
-- part 105 shipped an unauthenticated cross-tenant write (part 120). anon has
-- no business asking; a policy is evaluated as the querying role, so
-- authenticated needs it.
revoke all on function public.can_use_message_thread(text) from public, anon;
grant execute on function public.can_use_message_thread(text) to authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 4 · Storage policies — the two people on the thread, and nobody else
-- ═════════════════════════════════════════════════════════════════════════
--
-- RLS on storage.objects is enabled by Supabase itself. Asserted rather than
-- assumed, because a policy on a table with RLS off is inert and would look
-- exactly like a working restriction — the same guard parts 45 and 91 open
-- with.
do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity
  ) then
    raise exception 'storage.objects does not have RLS enabled — the policies below would be inert.';
  end if;
end $$;

-- Write: into a thread you are on, and only into your own folder within it.
-- The second condition is the anti-forgery one described in the header. An
-- object key with fewer than two segments indexes past the end of the array,
-- which is NULL, which is not true — so a short key is refused rather than
-- accidentally matching.
drop policy if exists msgmedia_obj_insert on storage.objects;
create policy msgmedia_obj_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'message-media'
    and public.can_use_message_thread((storage.foldername(name))[1])
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

-- Read. This is the policy that decides who may sign a URL, so it is the whole
-- of who can see the photograph. Membership of the thread, and nothing else —
-- no tenant branch, no owner branch, no `or` that would survive the end of the
-- coaching relationship. When a client changes coach, `clients.trainer_id`
-- moves and the old coach stops being able to read the thread, which is the
-- behaviour the messages themselves already have.
drop policy if exists msgmedia_obj_read on storage.objects;
create policy msgmedia_obj_read on storage.objects for select to authenticated
  using (
    bucket_id = 'message-media'
    and public.can_use_message_thread((storage.foldername(name))[1])
  );

-- Delete: your own upload, in a thread you are still on. Not "anything in the
-- thread" — a coach must not be able to remove a photograph their client sent
-- them, and a client must not be able to remove the form-check clip their coach
-- recorded. Membership is required as well as ownership so somebody who is no
-- longer on the thread cannot reach back into it.
drop policy if exists msgmedia_obj_delete on storage.objects;
create policy msgmedia_obj_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'message-media'
    and public.can_use_message_thread((storage.foldername(name))[1])
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

-- No UPDATE policy, on purpose, and for the reason 91 gives: an UPDATE policy
-- allows the bytes behind an already-signed key to be replaced, which is a
-- change nobody could see afterwards. The app uploads with upsert:false and a
-- fresh key every time, so there is nothing legitimate to overwrite.

-- ── DELIBERATELY ABSENT ──────────────────────────────────────────────────
-- A tenant or owner read branch. Dropped by name as well as never created, so
-- one added live by hand and written down nowhere — the drift that produced
-- parts 121 and 23–25 — does not survive a re-run of setup.sql.
drop policy if exists msgmedia_obj_tenant_read on storage.objects;
drop policy if exists msgmedia_obj_owner_read on storage.objects;
