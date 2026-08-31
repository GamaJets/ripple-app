-- ── The one coach a client actually has ────────────────────────────────────
--
-- `app/(client)/trainers.tsx` is a DIRECTORY — the coaches who have opted in
-- to being found. There is no screen anywhere for the coach a client is
-- already working with, and there is no way to build one, because a client
-- cannot read that coach's row: `trainers_peer_r` is trainer-to-trainer, and
-- `profiles_public_directory_r` only covers `trainers.listed = true`, which
-- defaults to false. So a client whose coach found THEM — by join code, which
-- is the normal case — cannot see their coach's bio, their specialties, or
-- what they offer, while a stranger browsing the directory can see all three
-- for a listed coach.
--
-- ── Why a function and not a policy ────────────────────────────────────────
--
-- RLS chooses ROWS, never columns. A policy wide enough to show a bio also
-- hands over `session_fee`, `join_code` and every column added to `trainers`
-- later — a join code being the exact thing that lets somebody else attach
-- themselves to that coach. Part 115 made this argument for `profiles` and it
-- holds here for the same reason.
--
-- Taking no argument is the other half: there is nothing to probe. It can only
-- ever answer about the caller's own coach, so it cannot be walked over the
-- roster of a gym.
--
-- The relationship test is `my_coach()`'s, character for character: BOTH
-- `clients.trainer_id` and an ACTIVE `coaching_relationships` row. When
-- coaching ends, `end_coaching()` clears the first and this returns nothing —
-- the profile goes when the relationship goes, which is what a client would
-- expect and what a coach is entitled to.
create or replace function public.my_coach_profile()
returns table (
  coach_id uuid,
  coach_name text,
  coach_avatar text,
  tagline text,
  bio text,
  specialties text[],
  offers text[]
)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select c.trainer_id,
         nullif(btrim(p.full_name), ''),
         nullif(btrim(p.avatar), ''),
         nullif(btrim(t.tagline), ''),
         nullif(btrim(t.bio), ''),
         t.specialties,
         t.offers
    from public.clients c
    left join public.profiles p on p.id = c.trainer_id
    left join public.trainers t on t.id = c.trainer_id
   where c.id = (select auth.uid())
     and c.trainer_id is not null
     and exists (
       select 1 from public.coaching_relationships r
        where r.client_id = c.id
          and r.coach_id = c.trainer_id
          and r.status = 'active'
     );
$fn$;

-- Deliberately NOT returned: `session_fee` (a coach's price is set with the
-- client, not published to them), `join_code` (it would let the holder hand
-- out an attachment to somebody else's coach), `listed`, `tenant_id`.
--
-- Revoked from `public` AND from `anon` by name. Supabase grants EXECUTE to
-- the two API roles separately, so revoking from `public` alone leaves both
-- standing — which is exactly how `log_gym_event` became an unauthenticated
-- cross-tenant write earlier tonight.
revoke all on function public.my_coach_profile() from public, anon;
grant execute on function public.my_coach_profile() to authenticated;
