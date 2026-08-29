-- ─────────────────────────────────────────────────────────────────────────
-- A client can learn their own coach's name.
--
-- TF-32 was a display bug: the client's Messages, Calendar and Bookings
-- screens headed a thread with `useCoachProfile()`, which loads the SIGNED-IN
-- user's own profile — so under "Your coach" sat the reader's own name, and
-- under it their own face. That is fixed in the app.
--
-- Fixing it exposed the real gap underneath. There is no policy on `profiles`
-- that runs client → coach: `profiles_self` is `id = auth.uid()`, and
-- `profiles_trainer_read` and both policies in 28-fix-profiles-recursion.sql
-- all run trainer → client. So the honest rendering became a labelled dash on
-- every one of those screens — correct, and a poor experience for a product
-- whose premise is that somebody is coaching you.
--
-- ── Why a function and not a policy ────────────────────────────────────────
--
-- A policy on `profiles` wide enough to let clients read their coach's row
-- would expose the whole row, and `profiles` carries more than a name. It
-- would also have to be written as a subquery over `clients` and
-- `coaching_relationships`, which is exactly the recursion that
-- 28-fix-profiles-recursion.sql exists to undo.
--
-- This returns one column, for one person, and takes no arguments. Without a
-- parameter there is nothing to probe: it can only ever answer about the
-- coach of whoever is calling it. That is the same property the `auth.uid() in
-- (…)` line gives `coaching_link_active` in 47-share-progress-photo.sql, got
-- here by construction rather than by a check.
--
-- ── Why both links are required ────────────────────────────────────────────
--
-- A coach↔client link is recorded in two places — `clients.trainer_id` and a
-- row in `coaching_relationships` — and 47's header documents that nothing in
-- the repo un-links today, so the two can drift. `fetchMyCoach` in
-- src/lib/photoShare.ts already requires both before it will name a coach as
-- somebody who can see your photographs. This uses the same test, so "who is
-- my coach" has one answer across the app rather than a stricter one for
-- photos and a looser one for names.
--
-- ── Null is a real answer ──────────────────────────────────────────────────
--
-- No rows means no active coach. One row with a null `coach_name` means there
-- is a coach who has not set a name. The app renders those differently, so the
-- function must not collapse them — hence the left join and the nullif rather
-- than a coalesce to some placeholder.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.my_coach()
returns table(coach_id uuid, coach_name text)
language sql
security definer
stable
set search_path to 'public'
as $function$
  select c.trainer_id,
         nullif(btrim(p.full_name), '')
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

-- Signed-in callers only. `anon` must not reach a definer function that reads
-- profiles, even one that answers only about auth.uid() — with no session
-- auth.uid() is null, the where clause matches nothing, and the honest place
-- to stop that is the grant rather than the query.
revoke execute on function public.my_coach() from public, anon;
grant execute on function public.my_coach() to authenticated;
