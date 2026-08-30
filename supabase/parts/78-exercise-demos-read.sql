-- ─────────────────────────────────────────────────────────────────────────
-- Let a signed-in person read the licensed exercise media.
--
-- The exercise-demos bucket had no storage policy at all. Uploading worked,
-- because the service key bypasses RLS — the APP signs as the logged-in user,
-- got nothing back, and every exercise screen in all three apps said "No
-- demonstration yet" while 483 animations and 595 stills sat in the bucket.
--
-- Nothing errored, which is the part worth remembering: an unsigned path and a
-- movement nobody has illustrated are indistinguishable to the screen. The
-- catalogue was right, the upload was right, the code was right, and the
-- product was empty.
--
-- ── Why `authenticated` and not anonymous ─────────────────────────────────
--
-- The licence forbids leaving the raw images in "an open storage bucket".
-- Signed URLs handed to a signed-in client are in-app use; anonymous read would
-- be the open archive it prohibits. A person with an account sees the pictures
-- inside the app, and nobody else does — the same shape as the licence's own
-- wording.
--
-- ── Why no per-object check ──────────────────────────────────────────────
--
-- Unlike exercise-videos next door, which asks can_watch_exercise_video(name)
-- because a coach's clip belongs to a coach and is shared with named clients.
-- This is stock content shown identically to every client on the platform, so
-- "is this yours" is a question with no meaning here — and it would cost a join
-- on every thumbnail in a list of six hundred.
-- ─────────────────────────────────────────────────────────────────────────

drop policy if exists exercise_demos_read on storage.objects;
create policy exercise_demos_read on storage.objects
  for select
  to authenticated
  using (bucket_id = 'exercise-demos');
