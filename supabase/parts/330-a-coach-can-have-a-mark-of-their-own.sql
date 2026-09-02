-- ─────────────────────────────────────────────────────────────────────────
-- A coach's own logo: the column, the bucket, and the boundary it stops at.
--
-- ── Why this column was refused once, and what changed ───────────────────
--
-- app/(trainer)/brand.tsx says, in its own header, that it offers "no logo
-- upload", because "a second image column with no uploader behind it is
-- precisely the promise that had to be walked back". That was correct when it
-- was written and it is still the rule: a column here without a picker, a
-- bucket and a renderer would be the same broken promise with a later date on
-- it.
--
-- So this part is one third of one change. The other two thirds are
-- src/ui/coachLogo.ts (the picker and the upload) and the three artefacts that
-- draw it — src/lib/coachInvoice.ts, src/lib/coachClientReport.ts and
-- src/lib/shareAsset.ts. None of them ships without the others.
--
-- ── What is a coach's, and what is not ───────────────────────────────────
--
-- brand.tsx refuses four things and this part re-refuses three of them. The
-- app's NAME, its ICON and its DOMAIN are the build-time brand axis in
-- src/lib/brands.ts; a bundle id is permanent and belongs to whoever publishes
-- the app. Nothing here touches any of that, and `parseCoachBrandName` still
-- refuses this build's own names outright.
--
-- The COACH's mark on the COACH's own paperwork is a different object. It goes
-- on an invoice they issue, a report they prepare and a card they post — three
-- artefacts a coach makes and hands over themselves. It costs the platform
-- nothing and it is the thing an independent coach is actually asking for.
--
-- ── Who can read the bytes, and why the answer is "the coach" ────────────
--
-- Own-folder read, exactly as `photos` does it, and NOT the coach-plus-clients
-- rule `coach-docs` uses. That is deliberate and it is the narrow answer:
--
--   · every place this logo is drawn is an artefact BUILT ON THE COACH'S OWN
--     DEVICE — an invoice PDF, a report PDF, a share card PNG. The coach's app
--     reads the object, embeds it, and hands over the finished file. The
--     client's app never fetches it, so a client read policy would grant an
--     access nothing uses.
--   · `my_coach_brand()` is therefore NOT extended. Returning a path a client
--     cannot open would be a name for a picture they get a 403 on, which is
--     the shape part 47 calls "worse than either answer".
--
-- If a coach's mark is ever wanted inside the client's app chrome, that is a
-- read policy and an RPC field added deliberately, with the sentence on the
-- coach's screen changed to match. It is not a thing to leave open in advance.
-- ─────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · The column
-- ═════════════════════════════════════════════════════════════════════════
--
-- A PATH, not a URL and not bytes. The bucket is private, so a URL would be a
-- signed one and would expire in the column; bytes in a row would be a base64
-- blob in every `select *` this table already serves.

alter table public.trainers add column if not exists logo_path text;

comment on column public.trainers.logo_path is
  'Key of this coach''s logo in the private coach-logos bucket, or null when they have set none. '
  'Always <coach uuid>/<file>, enforced by trainers_logo_path_own_folder. See part 330.';

-- The path must lie in the coach's OWN folder.
--
-- The storage policies below already stop a coach WRITING into somebody else's
-- folder, but they say nothing about what a coach may put in this column — and
-- a row is not an object. Without this a coach could store another coach's key
-- here, and their own app would then sign it and draw it. It would fail, today,
-- because the read policy is own-folder too; the constraint is what stops that
-- becoming true again the day the read policy widens.
--
-- Checked against `id`, which is the coach's own uuid (trainers.id = auth.uid()
-- — part 153). `like` with the id interpolated as text needs no escaping: a
-- uuid contains no % and no _.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trainers'::regclass
       and conname = 'trainers_logo_path_own_folder'
  ) then
    alter table public.trainers add constraint trainers_logo_path_own_folder
      check (
        logo_path is null
        or (logo_path like id::text || '/%' and length(logo_path) <= 200)
      );
  end if;
end $$;

-- `trainers` grants SELECT/UPDATE per COLUMN rather than at table level (part
-- 153 measured this live, and part 151 is what happened the last time a column
-- was added here and the grant was not). Without these two lines every write
-- from src/ui/coachLogo.ts would be refused, and refused in the countless,
-- errorless way PostgREST refuses a write that matches no rows.
grant select (logo_path), update (logo_path) on public.trainers to authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · The bucket
-- ═════════════════════════════════════════════════════════════════════════
--
-- Private, and re-asserted private on every run: `public = false` sits in the
-- DO UPDATE rather than being left to the insert, so a bucket somebody flipped
-- public in the dashboard is flipped back by re-running setup.sql (parts 49,
-- 91, 124, 135).
--
-- 2 MB. A logo is a mark, not a photograph: src/ui/coachLogo.ts downscales to
-- LOGO_MAX_PX before it uploads, and `MAX_LOGO_BYTES` in src/lib/coachLogo.ts
-- is the same number said in advance so the app can refuse a file with a
-- sentence rather than render a 413 as an unexplained failure.
--
-- PNG and JPEG only. PNG because a logo with a transparent ground is the
-- normal case and is the only one of the two that can carry one; JPEG because
-- a coach photographing a printed mark gets one. No SVG: it is a document
-- format that can carry script, it would be drawn by a renderer inside this
-- app, and no part of this feature needs it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('coach-logos', 'coach-logos', false, 2097152,
        array['image/png', 'image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · Storage policies — the coach's own folder, and nobody else's
-- ═════════════════════════════════════════════════════════════════════════
--
-- RLS on storage.objects is enabled by Supabase itself. Asserted rather than
-- assumed, because a policy on a table with RLS off is inert and would look
-- exactly like a working restriction — the guard parts 45, 91, 124 and 135 all
-- open with.
do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity
  ) then
    raise exception 'storage.objects does not have RLS enabled — the coach-logos policies would be inert.';
  end if;
end $$;

drop policy if exists coachlogo_obj_insert on storage.objects;
create policy coachlogo_obj_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'coach-logos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Read is the policy a signed URL is checked against, so it is the whole of
-- who can open the file. The owner, and that is all — see the header.
drop policy if exists coachlogo_obj_read on storage.objects;
create policy coachlogo_obj_read on storage.objects for select to authenticated
  using (
    bucket_id = 'coach-logos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Delete, so replacing a logo does not leave the old one in the bucket for
-- ever. Unlike coach-docs there is nothing to protect here: a logo is not a
-- thing anybody has agreed to, and the coach who put it there is the only
-- person it was ever readable by.
drop policy if exists coachlogo_obj_delete on storage.objects;
create policy coachlogo_obj_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'coach-logos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- No UPDATE policy, for the reason parts 91, 124 and 135 give: an UPDATE policy
-- allows the bytes behind a key that has already been drawn to be replaced. The
-- app uploads with upsert:false to a fresh key every time and then deletes the
-- old object, so replacing a logo is two visible operations rather than one
-- invisible one.

-- ── DELIBERATELY ABSENT ──────────────────────────────────────────────────
-- A client read branch, a tenant branch and an owner branch. A gym owner is not
-- entitled to the mark a coach who works there trades under, and a client's app
-- does not fetch this file at all. Dropped rather than merely not created, so
-- applying this part removes one if a later hand added it.
drop policy if exists coachlogo_obj_client_read on storage.objects;
drop policy if exists coachlogo_obj_tenant_read on storage.objects;
