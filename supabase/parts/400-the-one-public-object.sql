-- ─────────────────────────────────────────────────────────────────────────
-- The eighth bucket, and the only public one.
--
-- ── Why this exists at all ───────────────────────────────────────────────
--
-- Every other bucket in this product is `public = false`: exercise-videos,
-- exercise-demos, injury-docs, message-media, gym-docs, coach-docs,
-- coach-logos. Seven for seven, and that is a decision rather than a habit —
-- everything this app stores is somebody's body, somebody's paperwork or
-- somebody's private message, and none of it has any business being fetchable
-- without a signature.
--
-- Instagram will not accept an image. It FETCHES one. Publishing a feed post
-- through the Content Publishing API means creating a container that carries an
-- `image_url`, which Meta then pulls from its own servers with no Authorization
-- header and no cookie. A signed URL would work for as long as the signature
-- lasts and is still an unauthenticated URL; a private object simply 404s and
-- the container never leaves 'IN_PROGRESS'.
--
-- So there is one public bucket, it holds one kind of thing, and the whole of
-- the argument about what may go in it is here and in
-- src/lib/instagramPublish.ts.
--
-- ── What may be in it, enforced by there being no way to write to it ─────
--
-- No policy on storage.objects for this bucket. None for `authenticated`, none
-- for `anon`, and the ones a previous hand might have added are dropped rather
-- than merely not created. RLS on storage.objects is on by default in Supabase,
-- so with no policy the only writer left is the service role, which bypasses
-- RLS — and the only service-role code that touches this bucket is
-- supabase/functions/instagram-publish, which uploads exactly one object per
-- publish and deletes it again.
--
-- That is the requirement stated as a mechanism: it is impossible to put
-- anything in here except a card the publish path just built, because no
-- signed-in role has the privilege to put anything anywhere in it.
--
-- The absence of a SELECT policy matters too and is easy to misread. A PUBLIC
-- bucket serves an object by key without consulting RLS, so the read path does
-- not need one — but LISTING goes through storage.objects like any other query,
-- so with no select policy nobody can enumerate what is in here. An
-- unguessable key that also cannot be listed is not merely hard to find; there
-- is no question anybody can ask that answers it.
--
-- `allowed_mime_types` is JPEG alone. Instagram's feed endpoint does not accept
-- PNG, and a bucket that would take one is a bucket where the failure surfaces
-- as a container that fails ingestion several seconds later, after a public
-- object already exists.
--
-- ── The ledger, and why deletion is not left to a request ────────────────
--
-- The object is created at the moment of publishing and removed as soon as Meta
-- is known to be finished with it. `share_card_objects` is what makes "removed"
-- a fact rather than an assumption: a row is written BEFORE the upload, so an
-- upload that succeeds while the response is lost still leaves a record of the
-- key, and a sweep can find it. Removal sets `removed_at`, and it is only set
-- when the delete was CONFIRMED — see removeDocumentObject in
-- src/lib/gymDocs.ts, whose shape this follows: `remove()` returning an empty
-- list looks identical whether the delete was refused or unnecessary, so the
-- ambiguous case is resolved by listing the folder.
--
-- `expires_at` is the ceiling rather than the expected lifetime. The normal
-- life of one of these objects is a few seconds.
--
-- Idempotent; safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · The bucket
-- ═════════════════════════════════════════════════════════════════════════
--
-- `public = true` is written on the insert AND on the conflict update, so
-- re-running this part cannot leave a bucket that was flipped by hand in some
-- other state. Every other bucket in this repo does the same in the opposite
-- direction, and for the same reason.
--
-- 8 MiB is Meta's own limit for a feed image. A card exported at 1080×1350 and
-- compressed to JPEG is a few hundred kilobytes, so this is the ceiling rather
-- than the target.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('share-cards', 'share-cards', true, 8388608, array['image/jpeg'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · No policy, said out loud
-- ═════════════════════════════════════════════════════════════════════════
--
-- Dropped rather than absent. A policy on storage.objects is global to the
-- table and scoped by a `bucket_id` clause inside it, so a policy somebody adds
-- for another bucket cannot reach this one, but a policy added FOR this one by
-- a well-meaning hand could — and applying this part removes it.
--
-- If you are here because an upload from the app is failing with a row-level
-- security error: that is this part working. The card is uploaded by the
-- instagram-publish edge function under the service role and by nothing else.
drop policy if exists share_cards_insert on storage.objects;
drop policy if exists share_cards_select on storage.objects;
drop policy if exists share_cards_update on storage.objects;
drop policy if exists share_cards_delete on storage.objects;
drop policy if exists share_cards_coach_write on storage.objects;


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · The ledger
-- ═════════════════════════════════════════════════════════════════════════
--
-- One row per object ever created in that bucket, whether or not the request
-- that created it survived.
--
-- `object_key` is 32 random hex characters and a .jpg, with nothing enumerable
-- in it: not the coach's id, not the card's id, not a date. cardObjectKey() in
-- src/lib/instagramPublish.ts is the only thing that builds one and it throws
-- rather than falling back to something derived.
--
-- `trainer_id` is here for the sweep's accounting and for a human reading the
-- table after an incident. It is NOT in the key, deliberately — a key carrying
-- a coach id would make every card that coach ever published guessable from any
-- one of them.
create table if not exists public.share_card_objects (
  id          uuid        primary key default gen_random_uuid(),
  object_key  text        not null unique,
  trainer_id  uuid        not null references public.trainers(id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- The ceiling. A sweep removes anything past it whose removal was never
  -- confirmed, whatever happened to the request that made it.
  expires_at  timestamptz not null,
  -- Set only when a delete was CONFIRMED. Null means either "still live" or
  -- "we tried and could not prove it went", and the sweep treats both the same
  -- way: try again.
  removed_at  timestamptz,
  -- What the last removal attempt said, when it did not succeed. Kept so that
  -- an object that will not go can be diagnosed rather than merely retried.
  remove_failure text
);

comment on table public.share_card_objects is
  'Every object ever written to the public share-cards bucket. Written and read only by the instagram-publish edge function under the service role; no policy or grant for authenticated exists, and none may be added.';
comment on column public.share_card_objects.expires_at is
  'The ceiling on a public card object''s life, not its expected life. Normal lifetime is seconds; this is what a sweep uses when a request died mid-publish.';

-- The sweep's only query: what is past its ceiling and not confirmed gone.
create index if not exists idx_share_card_objects_sweep
  on public.share_card_objects (expires_at)
  where removed_at is null;

-- RLS on before anything else, so the halfway state is closed.
alter table public.share_card_objects enable row level security;

-- Belt and braces, exactly as coach_ad_accounts does it in part 100: RLS with
-- no policy already refuses `authenticated`, and the revoke means a future part
-- that adds a policy by accident still reads nothing, because the privilege is
-- not there to be policed.
revoke all on public.share_card_objects from authenticated, anon;

-- Deliberately absent: any policy at all. Dropped rather than merely not
-- created, for the reason above.
drop policy if exists share_card_objects_own on public.share_card_objects;
drop policy if exists share_card_objects_read on public.share_card_objects;
