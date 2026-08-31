-- ─────────────────────────────────────────────────────────────────────────
-- The face that goes with the name.
--
-- Part 67 gave a client the NAME of their own coach and stopped there. The
-- avatar was left where it was, which is `profiles.avatar` — a column no
-- client can read for anybody but themselves. So the client's Messages,
-- Calendar and Bookings screens could finally say who the thread was with and
-- still had nothing to draw beside it, and calendar.tsx removed the picture
-- rather than keep showing the reader their own face (the TF-32 note at the
-- top of that file is the full account).
--
-- Confirmed live before this part was written, as the client `authenticated`
-- role with the client's own jwt claims:
--
--     select count(*) from profiles where id = <my own coach>;   -- 0 rows
--     select count(*) from profiles where id = <another coach>;  -- 0 rows
--     select count(*) from profiles;                             -- 2 rows
--
-- Two: the client's own row, and one listed trainer that
-- `profiles_public_directory_r` (part 23) shows to every signed-in user. There
-- is still nothing that runs client → their own coach.
--
-- ── Why this extends the function rather than adding a policy ──────────────
--
-- The obvious fix is a SELECT policy on `profiles` for "the row of the coach I
-- am linked to". It is the wrong one, for the reason part 67 already sets out
-- and one more:
--
--   * RLS chooses ROWS, never columns. A policy that lets a client see their
--     coach's name and picture also hands them `role`, `tenant_id`,
--     `deletion_requested_at` and every column added to `profiles` after this
--     is written. "Name and avatar" cannot be said in a policy; it can only be
--     said in a select list.
--   * The predicate would have to be a subquery over `clients`, and `clients`
--     is itself read through policies that consult `profiles`. That is the
--     recursion 28-fix-profiles-recursion.sql exists to undo.
--
-- So the answer stays a function that names its columns. `my_coach()` already
-- is that function, still takes no arguments — there is no id to probe with,
-- so it cannot be pointed at a coach who is not yours — and still requires
-- BOTH halves of the link (`clients.trainer_id` and an active
-- `coaching_relationships` row) so that "who is my coach" has one answer
-- across the app. This adds one column to what it already answers.
--
-- ── Replacing it means dropping it ─────────────────────────────────────────
--
-- `create or replace function` cannot change a function's OUT parameters, so
-- the drop is required and is not a rewrite of the security posture — the
-- body, the definer-ness, the search_path and the grants below are part 67's,
-- carried over deliberately rather than by omission. The drop and the create
-- are one statement list and therefore one transaction: no window exists in
-- which the function is missing.
--
-- Adding a column is backwards compatible for the JS that is already on
-- phones. PostgREST returns the row as an object and the old code reads
-- `coach_name` off it; an extra key it does not look at costs nothing. That
-- matters here because the schema lands before the OTA does.
--
-- ── Null still means something ─────────────────────────────────────────────
--
-- Same discipline as the name: no rows means no active coach, and a row with a
-- null `coach_avatar` means a coach who has not set a picture. The nullif
-- keeps a stored empty string from arriving as a "picture" the app would try
-- to load, and does not turn it into a placeholder.
-- ─────────────────────────────────────────────────────────────────────────

drop function if exists public.my_coach();

create function public.my_coach()
returns table(coach_id uuid, coach_name text, coach_avatar text)
language sql
security definer
stable
set search_path to 'public'
as $function$
  select c.trainer_id,
         nullif(btrim(p.full_name), ''),
         nullif(btrim(p.avatar), '')
  from public.clients c
  left join public.profiles p on p.id = c.trainer_id
  where c.id = (select auth.uid())
    and c.trainer_id is not null
    and exists (
      select 1 from public.coaching_relationships r
      where r.client_id = c.id
        and r.coach_id = c.trainer_id
        and r.status = 'active'
    );
$function$;

-- Part 67's grants, restated because the drop took them with it. Signed-in
-- callers only: with no session auth.uid() is null and the where clause matches
-- nothing, but the honest place to stop `anon` reaching a definer function that
-- reads `profiles` is the grant rather than the query.
revoke execute on function public.my_coach() from public, anon;
grant execute on function public.my_coach() to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- The same grant, on the three functions part 88 forgot to narrow.
--
-- `mark_thread_read`, `coach_unread_counts` and `client_unread_count` are all
-- SECURITY DEFINER and all reach `messages` and `message_reads`. Part 88
-- granted execute to `authenticated` and left the default PUBLIC grant in
-- place, so `anon` can call all three. Nothing leaks today — every one of them
-- is keyed on `auth.uid()`, which is null without a session, so they answer 0,
-- no rows and false respectively. But "it happens to return nothing" is a
-- property of the bodies, and the bodies are the part most likely to be
-- rewritten by somebody who never reads the grants.
--
-- This changes no authenticated behaviour: the explicit grant to
-- `authenticated` below is the one the app has always used.
-- ─────────────────────────────────────────────────────────────────────────

revoke execute on function public.mark_thread_read(uuid) from public, anon;
grant execute on function public.mark_thread_read(uuid) to authenticated;

revoke execute on function public.coach_unread_counts() from public, anon;
grant execute on function public.coach_unread_counts() to authenticated;

revoke execute on function public.client_unread_count() from public, anon;
grant execute on function public.client_unread_count() to authenticated;
