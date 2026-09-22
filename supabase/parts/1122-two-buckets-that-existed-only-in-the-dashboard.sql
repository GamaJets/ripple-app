-- ═══════════════════════════════════════════════════════════════════════════
-- Two buckets that existed only in the dashboard.
--
-- ── WHAT IS WRONG ─────────────────────────────────────────────────────────
--
-- Nine of the eleven buckets on this project are created by a part — 49, 73,
-- 91, 124, 135, 185, 330, 400 and 961 — and eight of those nine re-assert the
-- bucket's `public` flag on the conflict branch as well as on the insert. The
-- reason is written out in most of them and it is the same reason every time:
-- a bucket somebody flipped in the dashboard is flipped back by re-running
-- setup.sql, rather than silently kept that way. Part 124 names the incident it
-- comes from: "`exercise-videos` was public for months for exactly that reason
-- — created by hand, written down nowhere (part 49)."
--
-- (The ninth is part 73, `exercise-demos`, which ends `on conflict (id) do
-- nothing` and so asserts nothing on a re-run. It is private live and is not
-- this part's subject; section 3 below catches it anyway, along with every
-- other bucket, which is the point of doing it as a set rather than one file
-- at a time.)
--
-- Two buckets are not in that list:
--
--     photos   created 2026-07-11 04:46:03Z
--     scans    created 2026-07-11 04:45:53Z
--
-- Both were made by hand, ninety seconds apart, before any part created a
-- bucket at all. Neither appears in `supabase/parts/` anywhere. `photos` is
-- the progress-photo bucket the whole of parts 45, 47 and 48 is about — the
-- one holding pictures people take of themselves in a bathroom in their
-- underwear — and its private flag is a checkbox in a web console that nothing
-- in this repository asserts, checks or could restore.
--
-- Part 400's header lists the private buckets as "exercise-videos,
-- exercise-demos, injury-docs, message-media, gym-docs, coach-docs,
-- coach-logos. Seven for seven, and that is a decision rather than a habit."
-- The count is off by two, and it is off by two in the direction of the bucket
-- that matters most, because the file could only count the ones it could see.
--
-- ── WHAT IT WOULD DO TO A REAL PERSON ────────────────────────────────────
--
-- Somebody opens Storage in the dashboard, ticks "Public bucket" on `photos`
-- to debug why an image will not render, and does not tick it back. Nothing
-- fails. The app keeps working — a signed URL for an object in a public bucket
-- resolves perfectly well — so there is no symptom at all, and every progress
-- photograph in the product becomes fetchable by anyone who has the key,
-- forever, with no session. Part 45 built two layers to stop a member's coach
-- seeing those photographs without being given them one at a time. A public
-- bucket is underneath both of them.
--
-- The only thing that would ever put it back is a paste of setup.sql, and
-- setup.sql does not know these buckets exist.
--
-- ── CONFIRMED LIVE BEFORE ASSERTING ANYTHING ─────────────────────────────
--
-- Read-only on 3 Sep 2026, from `storage.buckets`:
--
--     photos   public = false   file_size_limit = null   allowed_mime_types = null
--     scans    public = false   file_size_limit = null   allowed_mime_types = null
--
-- So this part asserts the state they are already in. Applying it changes no
-- flag on either bucket today; what it changes is that from now on a re-run
-- puts them back if somebody has moved them.
--
-- ── WHY THE SIZE AND MIME LIMITS ARE LEFT NULL ───────────────────────────
--
-- Every other bucket part writes `file_size_limit` and `allowed_mime_types`
-- into the conflict branch too. This one deliberately does not, and the
-- distinction is worth stating because the omission looks like an oversight.
--
-- Those parts are asserting a figure they CHOSE, with the reasoning beside it
-- and a matching constant in the app — 2 MB for an avatar because
-- src/lib/avatarImage.ts refuses at the same number, 64 MiB for message media
-- because src/lib/messageAttachments.ts checks the same figure before
-- uploading. Nothing has ever chosen one for `photos`. Inventing one here
-- would be a NEW restriction wearing the clothes of a version-control fix: the
-- first member whose phone produces a photograph over whatever number I picked
-- would get an opaque 413 from a limit nobody decided on, and the app has no
-- sentence prepared for it.
--
-- The flag that was actually at risk is `public`, and that is the flag this
-- asserts. A size and MIME limit for `photos` is a real piece of work — it
-- wants a figure, a matching constant in src/lib/progressPhotos.ts and a
-- refusal message — and it belongs in its own part.
--
-- ── `scans` IS EMPTY AND UNUSED, AND IS STILL BROUGHT UNDER CONTROL ──────
--
-- `scans` holds zero objects, has zero policies on `storage.objects`, and
-- nothing in `src/` or `studio-web/` references it as a bucket — the many
-- `from('scans')` calls in the app are the `public.scans` TABLE, which is a
-- different thing that happens to share a name. With RLS on and no policy,
-- nobody but the service role can put anything in it or read anything out.
--
-- It is asserted anyway rather than ignored, for the same reason part 400
-- drops policies it never created: a bucket that is not in the repo is a
-- bucket whose flags nobody is watching, and an empty private bucket that
-- somebody makes public later is a ready-made place for something to leak out
-- of. If it turns out to have no purpose, deleting it is a separate decision
-- and a separate part — `protect_buckets_delete` on `storage.buckets` refuses
-- a plain DELETE anyway, so it cannot be done casually.
--
-- ── ORDERING ─────────────────────────────────────────────────────────────
--
-- This part sits after parts 45 and 47, which create policies naming the
-- `photos` bucket. That is fine and is not an accident: a policy is an
-- expression, not a reference, so it can be created before the bucket row
-- exists and both are present by the end of the bundle. Putting the bucket at
-- 45 instead would mean editing a part whose subject is the purge machine, in
-- a file already carrying the longest header in the repository.
--
-- Idempotent and safe to re-run: `on conflict (id) do update` on both, setting
-- only the flag being asserted.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · photos
-- ═════════════════════════════════════════════════════════════════════════
--
-- Progress photographs (part 45), and the one bucket in this product whose
-- objects are read through a per-photo grant the member makes and can withdraw
-- (part 47). PRIVATE, on the insert and on the conflict update, so a re-run
-- restores it.
--
-- The insert branch is what a fresh project gets. The nulls are explicit
-- rather than omitted so that a reader of this file sees that no limit is
-- being set, instead of wondering whether two columns were forgotten.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, null, null)
on conflict (id) do update
  set public = false;


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · scans
-- ═════════════════════════════════════════════════════════════════════════
--
-- Empty, unreferenced, and private. See the header: asserted rather than
-- ignored, and not given policies here — with RLS on and no policy the only
-- role that can reach it is the service role, and that is the correct state
-- for a bucket no feature uses. If a feature ever does use it, the part that
-- adds the feature adds the policies, and this line is already here waiting
-- for it.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scans', 'scans', false, null, null)
on conflict (id) do update
  set public = false;


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · Say out loud that there are exactly two public buckets
-- ═════════════════════════════════════════════════════════════════════════
--
-- The assertion part 400 could not make, because at the time it was written it
-- could not see `photos` or `scans` and `avatars` did not exist yet. Now that
-- every bucket is created by a part, the set is knowable and this fails the
-- paste if it ever changes.
--
--   avatars      part 961 — public because a profile photo is fetched by URL
--                by the coach app, the console and the web pages, and a signed
--                URL would have to be minted per viewer per render.
--   share-cards  part 400 — public because Instagram FETCHES the image from
--                its own servers with no Authorization header. It holds one
--                object at a time, for a few seconds, and no role that can
--                sign in has the privilege to write to it.
--
-- Everything else in this product is somebody's body, somebody's paperwork or
-- somebody's private message. If this raises, the fix is not to widen the
-- list; it is to find out who flipped the bucket and why.

do $$
declare
  v_public text[];
begin
  select coalesce(array_agg(id order by id), '{}'::text[])
    into v_public
    from storage.buckets where public;

  if v_public <> array['avatars', 'share-cards']::text[] then
    raise exception
      'The set of PUBLIC storage buckets is % — expected exactly {avatars, share-cards}. Everything else this product stores is somebody''s body, paperwork or private message. See parts 400, 961, 1122.',
      v_public;
  end if;
end $$;
