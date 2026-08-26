-- ── Exercise videos: a library that survives the phone it was recorded on ───
--
-- The trainer video library has never once written a row. `exercise_videos`
-- declares `exercise_id text not null references exercises(id)` and `title text
-- not null`; the app inserts `{trainer_id, name, muscle_group, url}` and
-- supplies neither. Postgres refused every insert with 23502, supabase-js
-- returned that as `{ data: null, error }` rather than throwing, and the catch
-- in src/ui/exerciseVideos.ts fell through to an AsyncStorage-only entry. So a
-- trainer recorded a clip, watched it appear in their library, and lost it on
-- the next device — while the screen said "Added". The live table today holds
-- zero rows and the bucket holds zero files, which is the proof: the remote
-- path has never worked, and nothing here can lose data that was never stored.
--
-- Three things had to be true before this could be fixed rather than patched.
--
-- 1 · An exercise had to become a thing, not a spelling. `exercises` has been
--     in the schema since 01 and has never held a single row; the app names an
--     exercise with a free-text display string and joins video to exercise with
--     a bidirectional substring match at render time, so "Squat" matches
--     whichever of Back, Front or Goblet Squat happens to sort first. This
--     seeds the catalogue from the three vocabularies the app already ships
--     (the builder's picker, focus.ts, machines.ts), deduped on a slug, and
--     lets a trainer's custom movement mint its own slug on demand. The
--     NOT NULLs are then satisfiable rather than in the way, so they stay.
--
-- 2 · The bucket had to stop being public. `exercise-videos` was created by
--     hand in the dashboard, written down nowhere, and marked public — so a
--     clip of a named trainer demonstrating an exercise was readable by anyone
--     who ever saw the URL, whatever the table's policies said. It is declared
--     here and flipped to private; `video_path` (the column 01 defined and
--     nothing ever wrote) becomes the durable handle, and the app signs a
--     short-lived URL when someone is actually allowed to watch. `url` stays
--     for the other case: a link to a video hosted somewhere else entirely.
--
-- 3 · Visibility had to be the trainer's decision. 38-tenant-isolation.sql
--     opened SELECT to every authenticated user on the reasoning that "exercise
--     demos are content, not customer data", and 39-owner-policy-scope.sql then
--     declined to narrow it from a later file, saying the change "belongs in 38
--     next to its own reasoning". This file argues with that paragraph directly,
--     so here is the argument: it is true of a stock demo of a barbell row and
--     false of a clip with a named coach in it, and the table cannot tell them
--     apart because nobody ever asked. Now it asks. `visibility` carries the
--     answer per clip — private, this trainer's clients, the whole gym, or
--     genuinely public — plus an explicit grant list for "this person, this
--     clip". A platform clip with no trainer behind it is public by default,
--     which preserves 38's intent for exactly the content 38 was describing.
-- ───────────────────────────────────────────────────────────────────────────

-- ── 1 · The exercise catalogue ─────────────────────────────────────────────
-- Slug rule, mirrored exactly by exerciseSlug() in src/lib/exerciseId.ts:
-- lowercase, every run of non-alphanumerics becomes a single hyphen, trimmed.
-- 'Back Squat' → 'back-squat', 'Push-up' → 'push-up'. It is what collapses
-- 'Bent-over Row' and 'Bent-Over Row' into one row rather than two movements.

insert into public.exercises (id, name, muscle_group, is_cardio) values
  ('ab-crunch', 'Ab Crunch', 'Core', false),
  ('air-bike', 'Air Bike', 'Full body', true),
  ('assisted-pull-up', 'Assisted Pull-up', 'Back', false),
  ('back-extension', 'Back Extension', 'Lower back', false),
  ('back-squat', 'Back Squat', 'Legs', false),
  ('barbell-curl', 'Barbell Curl', 'Arms', false),
  ('bench-press', 'Bench Press', 'Chest', false),
  ('bent-over-row', 'Bent-over Row', 'Back', false),
  ('bicep-curl', 'Bicep Curl', 'Arms', false),
  ('bulgarian-split-squat', 'Bulgarian Split Squat', 'Legs', false),
  ('cable-crossover', 'Cable Crossover', 'Chest', false),
  ('cable-crunch', 'Cable Crunch', 'Core', false),
  ('cable-kickback', 'Cable Kickback', 'Glutes', false),
  ('cable-machine', 'Cable Machine', 'Full body', false),
  ('calf-raise', 'Calf Raise', 'Calves', false),
  ('chest-press', 'Chest Press', 'Chest', false),
  ('deadlift', 'Deadlift', 'Back', false),
  ('elliptical', 'Elliptical', 'Full body', true),
  ('face-pull', 'Face Pull', 'Shoulders', false),
  ('front-squat', 'Front Squat', 'Legs', false),
  ('glute-bridge', 'Glute Bridge', 'Glutes', false),
  ('good-morning', 'Good Morning', 'Hamstrings', false),
  ('hack-squat', 'Hack Squat', 'Legs', false),
  ('hammer-curl', 'Hammer Curl', 'Arms', false),
  ('hanging-leg-raise', 'Hanging Leg Raise', 'Core', false),
  ('hip-abduction', 'Hip Abduction', 'Glutes', false),
  ('hip-thrust', 'Hip Thrust', 'Glutes', false),
  ('incline-dumbbell-press', 'Incline Dumbbell Press', 'Chest', false),
  ('lat-pulldown', 'Lat Pulldown', 'Back', false),
  ('lateral-raise', 'Lateral Raise', 'Shoulders', false),
  ('leg-curl', 'Leg Curl', 'Hamstrings', false),
  ('leg-extension', 'Leg Extension', 'Legs', false),
  ('leg-press', 'Leg Press', 'Legs', false),
  ('nordic-curl', 'Nordic Curl', 'Hamstrings', false),
  ('overhead-press', 'Overhead Press', 'Shoulders', false),
  ('overhead-tricep-extension', 'Overhead Tricep Extension', 'Arms', false),
  ('pec-deck', 'Pec Deck', 'Chest', false),
  ('plank', 'Plank', 'Core', false),
  ('pull-up', 'Pull-up', 'Back', false),
  ('push-up', 'Push-up', 'Chest', false),
  ('rear-delt-fly', 'Rear Delt Fly', 'Shoulders', false),
  ('romanian-deadlift', 'Romanian Deadlift', 'Hamstrings', false),
  ('rowing-machine', 'Rowing Machine', 'Full body', true),
  ('russian-twist', 'Russian Twist', 'Core', false),
  ('seated-calf-raise', 'Seated Calf Raise', 'Calves', false),
  ('seated-row', 'Seated Row', 'Back', false),
  ('shoulder-press', 'Shoulder Press', 'Shoulders', false),
  ('ski-erg', 'Ski Erg', 'Full body', true),
  ('smith-machine', 'Smith Machine', 'Full body', false),
  ('stair-climber', 'Stair Climber', 'Legs', true),
  ('standing-calf-raise', 'Standing Calf Raise', 'Calves', false),
  ('treadmill', 'Treadmill', 'Legs', true),
  ('tricep-pushdown', 'Tricep Pushdown', 'Arms', false),
  ('triceps-pushdown', 'Triceps Pushdown', 'Arms', false),
  ('upright-bike', 'Upright Bike', 'Legs', true),
  ('walking-lunge', 'Walking Lunge', 'Legs', false)
on conflict (id) do nothing;

-- The catalogue had no row-level security at all, which — per 38's own third
-- section — means the policies it never had were not the problem: the anon key
-- is compiled into the shipped app, so the table was world-writable. Reading is
-- open to anyone signed in, because a catalogue is only useful if everyone
-- resolves the same slug to the same movement. Writing is how a trainer's
-- custom exercise gets a durable id, so it is open to staff and closed to
-- clients. Nothing here can be deleted through the API.
alter table public.exercises enable row level security;

drop policy if exists exercises_read on public.exercises;
create policy exercises_read on public.exercises for select
  to authenticated using (true);

drop policy if exists exercises_staff_w on public.exercises;
create policy exercises_staff_w on public.exercises for insert
  to authenticated with check (my_role() in ('trainer', 'owner'));

-- ── 2 · Reconciling exercise_videos with what the app actually writes ──────
-- name, muscle_group and url exist in the live database and in no SQL file in
-- this repo — added by hand at some point and never written down. Declaring
-- them here is what stops the next person reading 01-schema.sql and believing
-- the table is something it is not. `title` and `exercise_id` keep their NOT
-- NULL: section 1 is what makes them answerable.
alter table public.exercise_videos add column if not exists name         text;
alter table public.exercise_videos add column if not exists muscle_group text;
alter table public.exercise_videos add column if not exists url          text;

-- Who may watch this clip. Default 'clients': a coach who records a demo means
-- it for the people they coach, and a default that silently published it to the
-- platform would be the wrong way round to be wrong.
alter table public.exercise_videos add column if not exists visibility text not null default 'clients';

alter table public.exercise_videos drop constraint if exists exercise_videos_visibility_chk;
alter table public.exercise_videos add constraint exercise_videos_visibility_chk
  check (visibility in ('private', 'clients', 'gym', 'public'));

create index if not exists idx_exercise_videos_exercise on public.exercise_videos(exercise_id);
create index if not exists idx_exercise_videos_trainer  on public.exercise_videos(trainer_id);

-- ── 3 · "Whoever the trainer gives permissions to" ─────────────────────────
-- The four visibility levels answer the common cases; this answers the precise
-- one. A row here is a named person the trainer handed one clip to, and it is
-- additive only — it can widen who sees a private clip and can never narrow a
-- public one.
create table if not exists public.exercise_video_grants (
  video_id   uuid not null references public.exercise_videos(id) on delete cascade,
  client_id  uuid not null references public.profiles(id) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (video_id, client_id)
);
create index if not exists idx_exvid_grants_client on public.exercise_video_grants(client_id);

alter table public.exercise_video_grants enable row level security;

-- The trainer who owns the clip manages its grants. The join to exercise_videos
-- is safe to write inline for the same reason 39 gives for its trainers join:
-- exvid_trainer_rw already lets that trainer read the row this asks about.
drop policy if exists exvid_grants_trainer_rw on public.exercise_video_grants;
create policy exvid_grants_trainer_rw on public.exercise_video_grants for all
  using (exists (select 1 from public.exercise_videos v
                  where v.id = exercise_video_grants.video_id and v.trainer_id = (select auth.uid())))
  with check (exists (select 1 from public.exercise_videos v
                  where v.id = exercise_video_grants.video_id and v.trainer_id = (select auth.uid())));

-- A person may see that they were given something.
drop policy if exists exvid_grants_client_r on public.exercise_video_grants;
create policy exvid_grants_client_r on public.exercise_video_grants for select
  using (client_id = (select auth.uid()));

-- ── 4 · The read rule ──────────────────────────────────────────────────────
-- Replaces 38's `using (true)`. Each arm is one sentence of the product rule,
-- in the order a person would say them.
drop policy if exists exvid_read on public.exercise_videos;
create policy exvid_read on public.exercise_videos for select to authenticated using (
  -- the trainer's own clip, whatever it is set to
  trainer_id = (select auth.uid())
  -- a platform clip belonging to no trainer, which is what 38 meant by content
  or (trainer_id is null and visibility in ('public', 'clients', 'gym'))
  -- anything a trainer deliberately published
  or visibility = 'public'
  -- their own coach's clip, the ordinary case
  or (visibility = 'clients' and exists (
        select 1 from public.clients c
         where c.id = (select auth.uid()) and c.trainer_id = exercise_videos.trainer_id))
  -- shared with the whole gym: any member or staff of the tenant that trainer is in
  or (visibility = 'gym' and exists (
        select 1 from public.trainers tr
         where tr.id = exercise_videos.trainer_id and tr.tenant_id = my_tenant()))
  -- handed to this person by name, which can reach even a private clip
  or exists (select 1 from public.exercise_video_grants g
              where g.video_id = exercise_videos.id and g.client_id = (select auth.uid()))
  -- the owner of the gym the trainer belongs to
  or exists (select 1 from public.trainers tr
              where tr.id = exercise_videos.trainer_id and is_owner_of(tr.tenant_id))
);

-- ── 5 · The bucket, and the file behind the row ────────────────────────────
-- Declared here because it was not declared anywhere. Private: a signed URL is
-- what carries permission to the player, so the table's rule above is the only
-- way in rather than a suggestion sitting in front of a public URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exercise-videos', 'exercise-videos', false, 524288000,
        array['video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Whether the caller may watch the file at this storage path.
--
-- Deliberately SECURITY INVOKER — the opposite of the usual advice in this
-- schema, and for a reason worth stating. Running as the caller means the
-- select inside it is filtered by exvid_read above, so the storage rule cannot
-- drift away from the table rule: there is exactly one definition of who may
-- watch a clip, and this asks it rather than restating it. There is no
-- recursion hazard because exercise_videos' policy never reads storage.
create or replace function public.can_watch_exercise_video(p_path text)
returns boolean language sql stable security invoker set search_path to 'public'
as $function$
  select exists (select 1 from public.exercise_videos v where v.video_path = p_path);
$function$;

revoke execute on function public.can_watch_exercise_video(text) from public, anon;
grant execute on function public.can_watch_exercise_video(text) to authenticated;

-- A trainer owns the folder named after them; nobody writes into anyone else's.
-- This is the convention the upload code already follows: `${uid}/${epoch}.mp4`.
drop policy if exists exvid_object_w on storage.objects;
create policy exvid_object_w on storage.objects for insert to authenticated
  with check (bucket_id = 'exercise-videos'
              and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists exvid_object_u on storage.objects;
create policy exvid_object_u on storage.objects for update to authenticated
  using (bucket_id = 'exercise-videos'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists exvid_object_d on storage.objects;
create policy exvid_object_d on storage.objects for delete to authenticated
  using (bucket_id = 'exercise-videos'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Reading is whatever the table said.
drop policy if exists exvid_object_r on storage.objects;
create policy exvid_object_r on storage.objects for select to authenticated
  using (bucket_id = 'exercise-videos' and public.can_watch_exercise_video(name));
