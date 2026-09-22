-- ═══════════════════════════════════════════════════════════════════════════
-- The clip a client was given could be swapped underneath them.
--
-- ── WHAT IS WRONG ─────────────────────────────────────────────────────────
--
-- There is exactly one UPDATE policy on `storage.objects` in this project.
-- Counted live rather than assumed, on 3 Sep 2026:
--
--     select p.polname, p.polcmd from pg_policy p
--       join pg_class c on c.oid = p.polrelid
--       join pg_namespace n on n.oid = c.relnamespace
--      where n.nspname = 'storage' and c.relname = 'objects' and p.polcmd = 'w';
--
-- returns one row: `exvid_object_u`, on the `exercise-videos` bucket, created
-- by part 49 § 5 with no comment beside it. Twenty-six other policies on that
-- table are SELECT, INSERT or DELETE.
--
-- Five parts refuse to write one of these, and each states the same argument
-- in the same words:
--
--   91  injury-docs    "An UPDATE policy would allow overwriting the bytes
--                       behind a key that has already been read and signed,
--                       which is a change nobody could see afterwards."
--   124 message-media  "…for the reason 91 gives".
--   135 coach-docs     "…here it is not a general principle but the literal
--                       failure mode."
--   330 coach-logos    "…the bytes behind a key that has already been drawn".
--   961 avatars        "…for the reason parts 91, 124 and 330 give", and it
--                       goes further and `drop policy if exists
--                       avatars_obj_update`, so one added by hand does not
--                       survive a re-run.
--
-- `exercise-videos` is the one bucket that argument was never applied to. It
-- is also the only bucket in this product whose objects are handed to NAMED
-- OTHER PEOPLE by an explicit act: `exercise_video_grants` (part 49 § 3), one
-- row per person per clip, reachable even for a clip whose visibility is
-- 'private'. So the bucket with the sharing mechanism is the bucket with the
-- overwrite hole, which is exactly the wrong way round.
--
-- ── WHAT IT DOES TO A REAL PERSON ────────────────────────────────────────
--
-- A coach records a technique demo, sets it to 'private', and grants it by
-- name to one client — a rehab progression, say, filmed for one person's
-- shoulder. The client opens it. `playbackUrl()` mints a signed URL good for
-- an hour (src/ui/exerciseVideos.ts). The coach then writes different bytes to
-- the same key.
--
-- Nothing downstream can tell. The row in `exercise_videos` is untouched, so
-- the title, the exercise and the grant all still say what they said. The
-- signed URL is still valid and still resolves — it signs the KEY, not the
-- content. The client's app has no version, no checksum and no modified-at to
-- compare, because nothing was ever built to expect the content behind a key
-- to change. A clip a named person was given, and may have been told to follow,
-- becomes a different clip with the same name and the same permission.
--
-- That is the whole of the argument parts 91, 124, 135, 330 and 961 make. It
-- is stronger here than in any of them, because in the other five buckets the
-- object has one reader and here it has an audience the coach chose.
--
-- ── WHAT ACTUALLY BREAKS IF IT GOES — MEASURED, NOT GUESSED ──────────────
--
-- One thing in the app uploads to this bucket, and it is the one thing in the
-- product that asks for an overwrite:
--
--     src/ui/exerciseVideos.ts:92   const path = `${uid}/${Date.now()}.mp4`;
--     src/ui/exerciseVideos.ts:95   .upload(path, ab, { contentType: 'video/mp4', upsert: true });
--
-- `upsert: true` sends `x-upsert: true`, which makes storage-api authorise the
-- write as an upsert rather than an insert — an `insert … on conflict do
-- update` against `storage.objects`. Two separate things decide whether that
-- still works with no UPDATE policy, and they are not the same thing:
--
--   · The table-level GRANT. `insert … on conflict do update` requires the
--     UPDATE privilege on the target table unconditionally, whether or not a
--     row conflicts. Verified live: `authenticated` holds
--     DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE on
--     `storage.objects`. This part does not touch that grant, and must not —
--     revoking it is what would break the upload.
--   · The row-level POLICY. Postgres applies an UPDATE policy's USING
--     expression only to a row that actually conflicts. With a fresh key there
--     is no conflicting row, so no UPDATE policy is consulted and the insert
--     proceeds under `exvid_object_w`.
--
-- The key is `<uid>/<epoch-millis>.mp4`. A conflict therefore needs the same
-- coach to complete two uploads inside the same millisecond. Live: 0 rows in
-- `exercise_videos`, 0 objects in `exercise-videos`, so there is not one
-- object in this bucket for the removal to affect.
--
-- Nothing else in the repository writes here. `grep -rn 'exercise-videos' src
-- app studio-web web scripts` returns four lines: the upload above, the
-- signed-URL read, the `remove()` in `removeVideo`, and a comment. There is no
-- `.move()` or `.copy()` anywhere in the codebase — both of which do need
-- UPDATE — so no rename path is being taken away either.
--
-- ── SO THE POLICY GOES, AND THE APP GETS ONE LINE OF FOLLOW-UP ───────────
--
-- Removing it blind is what this part refuses to do, so the shape that makes
-- the app correct rather than merely lucky is written down here and belongs to
-- whoever owns src/ui/exerciseVideos.ts:
--
--     `upsert: true`  →  `upsert: false`, and a random token in the key beside
--     the millisecond, exactly as coachLogoPath() and coachDocPath() already
--     build them:  `${uid}/${Date.now()}-${token}.mp4`.
--
-- That is the convention all five refusing parts name — "the app uploads with
-- upsert:false and a fresh key every time" — and this bucket is the only one
-- that never adopted it. Until it lands, the failure mode is a refused upload
-- in a millisecond collision, which the caller already handles: `if (error)
-- return null`, and the clip stays local. That is a visible failure. The thing
-- being removed is an invisible one.
--
-- ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────
--
--   · It does not revoke the table-level UPDATE grant on `storage.objects`.
--     That grant is Supabase's, `x-upsert` needs it whether or not the object
--     exists, and taking it away would break the upload this part is at pains
--     to keep working.
--   · It does not touch `exvid_object_w`, `exvid_object_r` or `exvid_object_d`.
--     A coach still uploads into their own folder, still reads whatever
--     `exvid_read` says they may, and still deletes their own clip.
--   · It does not add a version column, a checksum or a modified-at to
--     `exercise_videos`. Those would be a way to SEE an overwrite. Not being
--     able to perform one is better than being able to notice it afterwards,
--     and adding a column the app does not read would be a fix nobody checks.
--   · It does not change `exercise_video_grants` or the read rule. The clip a
--     client was given is the clip the coach uploaded; that was always the
--     intent, and this is the line that makes it true.
--
-- Idempotent and safe to re-run: every statement is `drop policy if exists`,
-- and the guard at the foot reads the catalogue rather than writing to it.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · The policy
-- ═════════════════════════════════════════════════════════════════════════
--
-- Dropped, and not replaced. Part 49 § 5 is amended in place by this file
-- rather than edited, for the reason 1122 gives about part 45: the argument
-- for the removal is longer than the part that created it, and it belongs
-- beside the four other buckets' versions of the same argument rather than
-- buried in a file whose subject is a video library.

drop policy if exists exvid_object_u on storage.objects;


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · Every other name an UPDATE policy could have been added under
-- ═════════════════════════════════════════════════════════════════════════
--
-- Part 961 drops `avatars_obj_update` rather than merely not creating it, and
-- says why: "so applying this part removes one if a later hand added it." The
-- same treatment, for every bucket, by the name each part's own convention
-- would give it. Dropping a policy that does not exist is free; the drift these
-- lines catch — a policy added live in the dashboard and written down nowhere —
-- is the drift that produced parts 121, 23–25, and the public `exercise-videos`
-- bucket part 49 had to close.

drop policy if exists photos_obj_update      on storage.objects;
drop policy if exists injurydoc_obj_update   on storage.objects;
drop policy if exists msgmedia_obj_update    on storage.objects;
drop policy if exists coachdoc_obj_update    on storage.objects;
drop policy if exists coachlogo_obj_update   on storage.objects;
drop policy if exists gymdoc_obj_update      on storage.objects;
drop policy if exists avatars_obj_update     on storage.objects;
drop policy if exists exercise_demos_update  on storage.objects;
drop policy if exists share_cards_update     on storage.objects;
drop policy if exists scans_obj_update       on storage.objects;


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · Say out loud that there are none
-- ═════════════════════════════════════════════════════════════════════════
--
-- Modelled on 1122 § 3. Five parts each state this rule for their own bucket
-- and none of them can see the others, which is exactly how `exercise-videos`
-- was missed for six weeks. A rule that holds across a whole table should be
-- asserted against the whole table once.
--
-- If this raises, the fix is not to add an exception. It is to find out who
-- added the policy and what they were trying to do, because there is a shape
-- that does it without an invisible overwrite — delete the old object and
-- insert a new one under a new key — and every other bucket in this product
-- already uses it.

do $$
declare
  v_update text[];
begin
  select coalesce(array_agg(p.polname order by p.polname), '{}'::text[])
    into v_update
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'storage'
     and c.relname = 'objects'
     and p.polcmd in ('w', '*');   -- UPDATE, and ALL which contains it

  if array_length(v_update, 1) is not null then
    raise exception
      'storage.objects carries % — there must be NO UPDATE policy on any bucket. An UPDATE policy lets the bytes behind a key that has already been signed and drawn be replaced, which is a change nobody downstream can see. Replacing a stored file is a DELETE plus an INSERT under a new key. See parts 91, 124, 135, 330, 961, 1150.',
      v_update;
  end if;
end $$;
