-- ─────────────────────────────────────────────────────────────────────────
-- Injury documents — the private bucket a client's physio report lives in.
--
-- WHAT THIS IS FOR. A client can now photograph a physiotherapy report, a scan
-- result or a doctor's note; the app reads it through the `ocr-scan` edge
-- function, proposes injuries from the text (src/lib/injuryExtract.ts), and the
-- client confirms, edits or rejects each one. What is confirmed goes into
-- `clients.injuries` — the same jsonb array the manual disclosure screen writes
-- — so the plan, the coach's roster and the acknowledgement gate pick it up
-- with nothing else to change.
--
-- The DOCUMENT is a separate matter, and this file is only about the document.
--
-- ── THE COACH DOES NOT GET THE FILE ──────────────────────────────────────
--
-- The coach sees the extracted injury. They do not see the report.
--
-- That distinction is the whole design and it has to be enforced here, because
-- a policy is the only place it is true. "Left knee, moderate, sharp on deep
-- squats" is a training instruction. The document it was read off is a medical
-- record: it carries a diagnosis, a clinician's name, a hospital number, a
-- date of birth, often findings about things that have nothing to do with
-- training. A client disclosing an injury has agreed to the first sentence.
-- Nobody has agreed to the second.
--
-- So the policies below are own-folder only, at every verb, with no trainer,
-- owner or tenant branch anywhere in them. This is the same stance part 45
-- takes for progress photos and the reasoning there applies word for word: a
-- read policy would mean people upload believing it is private and are wrong.
--
-- SHARING IS A FUTURE FEATURE, AND NOTHING HERE BLOCKS IT. When a client wants
-- their coach to read the report itself, that wants the shape 47-share-
-- progress-photo.sql already uses: a grant table naming (document path, coach)
-- with the client as the only party who can write it, plus a storage SELECT
-- policy that consults it. Adding that later needs no change to anything below
-- — a second `using` branch is additive, and the object key shape does not
-- move. What must NOT happen is a trainer-wide read policy added here by
-- pattern-matching on 19-trainer-read-access.sql. Access to a medical document
-- is something a person DOES, once, per document.
--
-- ── OBJECT KEY SHAPE ─────────────────────────────────────────────────────
--
--   injury-docs/<auth.uid()>/<millis>-<token>-<slug>.jpg
--
-- The first path segment is the owner's uid because that is the only thing the
-- policies read: `(storage.foldername(name))[1] = auth.uid()::text`, exactly as
-- in 45-progress-photos.sql. src/ui/injuryDocs.ts builds and validates the same
-- shape client-side so a mismatch fails somewhere with a readable message
-- rather than as a bare 403.
--
-- The bucket is PRIVATE, so a document is read back through a signed URL minted
-- by its owner — never getPublicUrl(), which hands back a working-looking
-- string for a private object that then 400s.
--
-- ── OPERATOR NOTE: FILE LIFECYCLE IS NOT CLOSED BY THIS FILE ─────────────
--
-- Read this before deciding this part is complete.
--
-- Unlike progress photos, an injury document has NO database row. That is
-- deliberate — the coach-visible surface is `clients.injuries` and nothing
-- else, and a table holding document paths is one join away from being read by
-- something that should not read it. The client lists their own documents by
-- listing their own folder, which the SELECT policy below already scopes.
--
-- The cost of having no row is that nothing CASCADES. When an account is
-- deleted, 41-account-deletion.sql removes the member's rows; these files are
-- not rows and are not removed. A client deleting a document from inside the
-- app deletes the object properly (that is the delete policy below, called
-- through the Storage API, which is the only thing that removes bytes — see
-- the long account of `protect_objects_delete` in 45-progress-photos.sql).
-- Account deletion is the gap.
--
-- Closing it wants a follow-up part that mirrors 45 for this bucket: a
-- `injury_doc_purge` queue, a `purge_injury_doc_file(path)` that DELETEs
-- against /storage/v1/object/injury-docs/<path> over pg_net with the Vault
-- secret `storage_service_key`, and a hook from account deletion that
-- enumerates `storage.objects where bucket_id = 'injury-docs' and
-- (storage.foldername(name))[1] = <uid>` into it before the auth user goes.
-- It is not in this file because this file is the bucket and its policies, and
-- because a second copy of that machine deserves its own review rather than
-- riding along at the bottom of another part.
--
-- Until it exists, an operator can see what is outstanding with:
--
--     select (storage.foldername(name))[1] as owner_uid, name, created_at
--       from storage.objects
--      where bucket_id = 'injury-docs'
--        and (storage.foldername(name))[1]::uuid not in (select id from auth.users)
--      order by created_at;
--
-- Those are documents belonging to accounts that no longer exist.
-- ─────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · The bucket
-- ═════════════════════════════════════════════════════════════════════════
--
-- Private, and re-asserted private on every run: `public = false` is in the DO
-- UPDATE rather than left to the insert, so a bucket someone flipped public in
-- the dashboard is flipped back by re-running setup.sql rather than silently
-- kept that way.
--
-- 12 MB is generous for a phone photo of a sheet of A4 after the client-side
-- downscale (src/ui/injuryDocs.ts resizes to 1512px wide before upload) and
-- small enough that it is not a file store.
--
-- MIME types are images only, and that is a real limit rather than an
-- oversight: the reading path is the `ocr-scan` edge function, which posts a
-- base64 IMAGE to OCR.space. A PDF would upload happily and then be a document
-- the client can see and the app cannot read, which is a worse outcome than
-- being told up front to photograph the page. Adding 'application/pdf' here is
-- half of that feature; the other half is the edge function.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('injury-docs', 'injury-docs', false, 12582912,
        array['image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · Storage policies — own folder, every verb, nobody else
-- ═════════════════════════════════════════════════════════════════════════
--
-- RLS on storage.objects is enabled by Supabase itself. Asserted rather than
-- assumed, because a policy on a table with RLS off is inert and would look
-- like a working restriction — the same guard part 45 opens with.

do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity
  ) then
    raise exception 'storage.objects does not have RLS enabled — the policies below would be inert.';
  end if;
end $$;

drop policy if exists injurydoc_obj_insert on storage.objects;
create policy injurydoc_obj_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'injury-docs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- SELECT is what signing a URL is checked against, so this is the policy that
-- decides who can read a client's physio report. Own folder. Nothing else.
drop policy if exists injurydoc_obj_read on storage.objects;
create policy injurydoc_obj_read on storage.objects for select to authenticated
  using (
    bucket_id = 'injury-docs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists injurydoc_obj_delete on storage.objects;
create policy injurydoc_obj_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'injury-docs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- No UPDATE policy, on purpose. There is no edit of a medical document: the
-- app uploads with upsert:false and a fresh key every time, so replacing a
-- report is a new object plus a delete of the old one, both of which are
-- covered above. An UPDATE policy would allow overwriting the bytes behind a
-- key that has already been read and signed, which is a change nobody could
-- see afterwards.

-- ── DELIBERATELY ABSENT: a trainer or owner branch. ──────────────────────
-- If you are here because a coach asked to see a client's report, the answer
-- is the grant table described in the header, not another `or` in the policies
-- above. Dropped by name as well, so a policy added live by hand and never
-- written down (the drift that produced parts 23–25 and the trainer-read
-- policy part 45 had to remove) does not survive a re-run of setup.sql.
drop policy if exists injurydoc_obj_trainer_read on storage.objects;
