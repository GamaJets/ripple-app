-- ── A clip of the set, for the coach to watch ───────────────────────────────
--
-- Phase 9's form-check item, and the last of the three named there. A member
-- films a set, attaches it to the set they actually logged, and their coach
-- watches it and says what to fix. Every competitor selling coaching has this;
-- Repple had video in two places and neither was this one:
--
--   `exercise_videos`   the COACH's library — demonstrations they record once
--                       and assign to a movement. The wrong direction entirely.
--   progress photos     the member's own body, on a schedule, for comparison.
--                       A different thing with a different consent story.
--
-- ── who can see it, which is the part worth arguing about ───────────────────
--
-- A video of somebody training is more revealing than a number and more
-- identifying than a scan: it is their face, their gym, their body, and often
-- other members in the background. The rule here is deliberately the narrowest
-- one that still makes the feature work:
--
--   THE MEMBER        all of it. They recorded it, they can watch it, they can
--                     delete it, and deleting it is final.
--   THEIR COACH       read, through `is_my_client(user_id)` — the same
--                     predicate their workouts, measurements and check-ins
--                     already use. When a member changes coach, or ends
--                     coaching, `clients.trainer_id` moves and the old coach's
--                     access stops the same moment their message thread does.
--   EVERYBODY ELSE    nothing. Not the gym owner, not reception, not another
--                     coach at the same gym, not a former coach. There is no
--                     policy granting any of them and no function that could.
--
-- This is NOT the shape injury documents take, and the difference is worth
-- writing down because the two look similar. There, the document stays with
-- the client and only the EXTRACTED injury reaches the coach — because the
-- coach needs the fact, not the file. Here the file IS the fact: a coach
-- cannot correct a hip shift from a sentence. So the video is shared, and the
-- protection is that it is shared with exactly one person, revocably, and only
-- because the member chose to attach it.
--
-- ── one row per clip, not a column on the set ───────────────────────────────
--
-- `workouts.sets` is jsonb, and putting a path inside it would mean rewriting
-- the whole array to attach or delete one clip — losing every concurrent edit
-- to the other sets, and making the storage object unreachable if the write
-- half-failed. A row also gives the clip its own lifetime: deleting the clip
-- does not touch the logged set, which is the training record and must survive.

create table if not exists form_clips (
  id uuid primary key default gen_random_uuid(),
  -- The MEMBER, always. Not the uploader: a coach filming a client on their
  -- own phone is a different feature with a different consent conversation,
  -- and this table would silently become that if `user_id` ever meant "whoever
  -- pressed record".
  user_id uuid not null references profiles(id) on delete cascade,
  workout_id uuid not null references workouts(id) on delete cascade,
  -- Which set within that workout, zero-based, as the app renders them. Not a
  -- foreign key because a set is not a row — see the header.
  set_index integer not null check (set_index >= 0),
  -- The storage key under the `form-checks` bucket. First path segment is the
  -- member's id, which is what the object policies below match on.
  path text not null,
  -- What the member said when they attached it: "does my knee cave on rep 4".
  -- The question is most of the value and is almost always the thing the coach
  -- answers.
  note text,
  created_at timestamptz not null default now(),
  -- One clip per set. A second attempt replaces the first through the app
  -- rather than stacking, because two clips of one set with no way to tell
  -- which is current is how a coach reviews the wrong one.
  unique (workout_id, set_index)
);

create index if not exists idx_form_clips_user on form_clips (user_id, created_at desc);

alter table form_clips enable row level security;

-- The member owns theirs outright.
drop policy if exists form_clips_own on form_clips;
create policy form_clips_own on form_clips for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Their coach reads. `is_my_client` is the same predicate `workouts` uses, so a
-- clip is exactly as visible as the set it hangs off and stops being visible at
-- the same moment.
drop policy if exists form_clips_coach_read on form_clips;
create policy form_clips_coach_read on form_clips for select
  using (is_my_client(user_id));

-- ── the bucket ──────────────────────────────────────────────────────────────
--
-- Private. A public bucket would make every clip readable by anybody holding
-- the URL for as long as the object exists, which for this content is not a
-- risk worth taking for the convenience of not signing a URL.
insert into storage.buckets (id, name, public)
values ('form-checks', 'form-checks', false)
on conflict (id) do nothing;

-- Upload: the member, into their own folder, and nobody else anywhere.
drop policy if exists formclip_obj_insert on storage.objects;
create policy formclip_obj_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'form-checks'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Read: the member, and the coach who currently coaches them. This is the
-- policy a signed URL is checked against, so it is the whole of who can watch
-- the video.
drop policy if exists formclip_obj_read on storage.objects;
create policy formclip_obj_read on storage.objects for select to authenticated
  using (
    bucket_id = 'form-checks'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.is_my_client(((storage.foldername(name))[1])::uuid)
    )
  );

-- Delete: the member, and only the member. A coach who could delete a clip
-- could delete the evidence of advice they gave, and a member who wants one
-- gone should not have to ask anybody.
drop policy if exists formclip_obj_delete on storage.objects;
create policy formclip_obj_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'form-checks'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- No UPDATE policy, for the reason parts 91, 124 and 135 all give: an UPDATE
-- policy lets the bytes behind an already-signed key be replaced, and nobody
-- downstream can see that it happened. The app uploads with a fresh key every
-- time and deletes the old object when a set's clip is replaced.
