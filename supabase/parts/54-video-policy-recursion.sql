-- ─────────────────────────────────────────────────────────────────────────
-- The exercise video library could not be read by anybody. At all.
--
--     ERROR 42P17: infinite recursion detected in policy for relation
--                  "exercise_videos"
--
-- Two policies from 49-exercise-video-library.sql referred to each other:
--
--   exercise_videos.exvid_read (SELECT)
--       … or exists (select 1 from exercise_video_grants g
--                    where g.video_id = id and g.client_id = auth.uid())
--
--   exercise_video_grants.exvid_grants_trainer_rw (ALL — so SELECT too)
--       exists (select 1 from exercise_videos v
--               where v.id = video_id and v.trainer_id = auth.uid())
--
-- Reading a video evaluates the grants policy, which reads videos, which
-- evaluates the grants policy. Postgres detects the loop and refuses the
-- statement, so EVERY read of exercise_videos failed for every signed-in user.
--
-- It never showed as a crash because the app handles the error properly —
-- `useExerciseVideos` reports it and the screens say "your library could not be
-- read", which is exactly right and is what made this look like an empty
-- library rather than a broken one. It was found by inserting an Academy clip
-- and trying to read it back as a member.
--
-- The fix is the standard one: the grants policy asks a SECURITY DEFINER
-- function instead of querying the table under RLS. A definer function does not
-- re-enter the policy, so the cycle is cut. It is the narrowest possible
-- question — "do I own this one video" — and answers nothing else.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.owns_exercise_video(p_video uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.exercise_videos v
    where v.id = p_video and v.trainer_id = (select auth.uid())
  );
$$;

comment on function public.owns_exercise_video(uuid) is
  'Whether the caller owns this clip. SECURITY DEFINER on purpose: called from '
  'the exercise_video_grants policy, and a plain query there re-enters the '
  'exercise_videos policy and recurses. See 54-video-policy-recursion.sql.';

drop policy if exists exvid_grants_trainer_rw on public.exercise_video_grants;
create policy exvid_grants_trainer_rw on public.exercise_video_grants for all
  using (public.owns_exercise_video(video_id))
  with check (public.owns_exercise_video(video_id));

-- Callable by signed-in users because a policy is evaluated as the querying
-- role. anon has no business asking.
revoke execute on function public.owns_exercise_video(uuid) from public, anon;
grant execute on function public.owns_exercise_video(uuid) to authenticated;
