-- A profile photo that leaves the phone.
--
-- ── What `profiles.avatar` has been holding ───────────────────────────────
--
-- app/(client)/profile.tsx handed the image picker's asset uri to `setPhoto`,
-- and src/ui/clientData.tsx wrote that string into `profiles.avatar`. On a
-- handset that string is
--
--     file:///var/mobile/Containers/Data/Application/<UUID>/tmp/…jpg
--
-- a path inside ONE device's sandbox. The member saw their photo, because their
-- own device could open its own file. Their coach saw a blank circle, in the
-- thread and on the roster, because `profiles.avatar` is read by other accounts
-- as a URL. And the member's own copy vanished the first time iOS cleared the
-- picker cache, with nothing on screen having changed.
--
-- There was no bucket. There was no upload. This part is the missing half.
--
-- ── Why this bucket is PUBLIC when almost every other one is private ──────
--
-- Say it plainly, because the default in this schema is private and every other
-- bucket here re-asserts `public = false` on every run.
--
-- `profiles.avatar` is one text column read by four different readers in three
-- codebases: src/ui/messaging.ts for the thread peer, the coach's roster, the
-- member's own screens, and studio-web. They all put it straight into an image
-- source. A private bucket would mean each of those four resolving a signed URL
-- before it could draw a face, and a signature that expires while a screen is
-- open — which is a redesign of three codebases, not a fix for a member whose
-- coach cannot see them.
--
-- What is actually disclosed: a profile photograph, to anybody holding its
-- exact URL. The key is `<uid>/<16 random hex>.jpg`, so a URL cannot be derived
-- from knowing whose photo it is, and no SELECT policy is granted to `anon`, so
-- the bucket cannot be LISTED by an unauthenticated caller — only fetched by
-- exact key. The photo is one the member chose to show their coach and their
-- gym, and it carries no location, because src/ui/avatarUpload.ts re-encodes
-- every upload through ImageManipulator, which does not carry EXIF forward.
--
-- What is NOT in this bucket, and must not be put in it: progress photographs
-- (`photos`, part 124, private), injury documents (`injury-docs`, part 91,
-- private, no coach branch at all), and message media (`message-media`, part
-- 124, private). Those are private because their content is private. A profile
-- picture is the one image in this product whose entire purpose is that other
-- people see it.
--
-- If that trade is ever judged wrong, the change is: flip `public` to false
-- here, add a signed-URL resolver, and point all four readers at it. The column
-- would then hold the object key rather than a URL, and every reader that
-- rendered the raw column would draw nothing until it was updated.
--
-- Idempotent; safe to re-run.


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · The bucket
-- ═════════════════════════════════════════════════════════════════════════
--
-- 2 MB, the same number src/lib/avatarImage.ts refuses at, so the app can say
-- a sentence before a byte leaves rather than render a 413 as an unexplained
-- failure. JPEG and PNG only: the app re-encodes everything to JPEG, and PNG is
-- accepted so an object stored by an earlier hand is still readable.
--
-- `public = true` is written on the insert AND on the conflict update, for the
-- same reason parts 49, 91, 124, 135 and 330 write `false` in both places: a
-- bucket somebody flipped in the dashboard is put back by re-running setup.sql.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · Storage policies — your own folder, and nobody else's
-- ═════════════════════════════════════════════════════════════════════════
--
-- RLS on storage.objects is enabled by Supabase itself. Asserted rather than
-- assumed, because a policy on a table with RLS off is inert and would look
-- exactly like a working restriction — the same guard parts 45, 91, 124, 135
-- and 330 open with.
do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity
  ) then
    raise exception 'storage.objects does not have RLS enabled — the avatars policies would be inert.';
  end if;
end $$;

-- Writing. The first folder is the uploader's own id, which is what
-- src/lib/avatarImage.ts builds and what its test asserts. Nobody can put a
-- file in somebody else's folder, so nobody can replace another member's face.
drop policy if exists avatars_obj_insert on storage.objects;
create policy avatars_obj_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Listing, which is a different thing from fetching. The bucket being public
-- means an object can be DOWNLOADED by exact key with no session; it does not
-- make the object list readable. This grants the list to the owner of the
-- folder alone, which is what src/lib/gdpr.ts needs to put a member's own photo
-- into their own data export.
drop policy if exists avatars_obj_read on storage.objects;
create policy avatars_obj_read on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Deleting, so a superseded photo can be collected and so a member removing
-- their account takes their face with them.
drop policy if exists avatars_obj_delete on storage.objects;
create policy avatars_obj_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- No UPDATE policy, for the reason parts 91, 124 and 330 give: an UPDATE policy
-- allows the bytes behind a key that has already been drawn to be replaced. The
-- app uploads with upsert:false to a fresh key every time.
drop policy if exists avatars_obj_update on storage.objects;

-- DELIBERATELY ABSENT: a coach branch, a tenant branch and an owner branch.
-- None is needed — the object is fetched by URL, not by policy — and each would
-- hand somebody the ability to list or delete another person's folder. Dropped
-- rather than merely not created, so applying this part removes one if a later
-- hand added it.
drop policy if exists avatars_obj_coach_read on storage.objects;
drop policy if exists avatars_obj_tenant_read on storage.objects;


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · The device paths already stored
-- ═════════════════════════════════════════════════════════════════════════
--
-- Every one of these is a location inside somebody's handset, sitting in a row
-- their coach, their gym and the web console read. None of them has ever drawn
-- for anybody but its owner, so nothing is lost by clearing them — the member's
-- own screen keeps its local copy and app/(client)/profile.tsx tells them what
-- happened and asks for the photo again.
--
-- src/ui/clientData.tsx will not write another one (isDeviceAvatar guards the
-- update), so this runs once and then matches nothing.
update public.profiles
   set avatar = null
 where avatar is not null
   and (
        avatar ilike 'file:%'
     or avatar ilike 'content:%'
     or avatar ilike 'ph:%'
     or avatar ilike 'assets-library:%'
     or avatar like '/var/%'
     or avatar like '/data/%'
     or avatar like '/storage/%'
   );
