-- ═════════════════════════════════════════════════════════════════════════
-- A full class with six people waiting, and nobody could see the six.
--
-- ── What was measured ───────────────────────────────────────────────────
--
-- `class_counts()` (part 02, re-scoped by part 38) is the only way any of the
-- three apps learns how full a class is:
--
--     select cb.class_id, count(*)::bigint
--       from class_bookings cb
--       join gym_classes gc on gc.id = cb.class_id
--      where gc.tenant_id = my_tenant()
--      group by cb.class_id;
--
-- `class_bookings.status` is `check (status in ('booked','waitlist'))`. There
-- is no filter on it, so a WAITLISTER is counted as a booking. Two separate
-- consequences, both live:
--
--   1 · A class of 12 with 5 waiting reports `booked = 17`. The coach's screen
--       (app/(trainer)/classes.tsx) draws "17/12"; the member's computes
--       `capacity - booked` and gets minus five. Every screen in this product
--       that shows how full a class is has been showing a number that is not
--       how full it is.
--
--   2 · The waitlist is INVISIBLE, and it is the more valuable of the two
--       numbers. A full class is a full class; a full class with six people
--       waiting is a second session on Thursday, and the coach cannot see it.
--
-- The same conflation was found and fixed on the OWNER's read path in the wave
-- before this one — `tallyBookings` in src/lib/gymSchedule.ts had a guard
-- against a status of 'cancelled' that the CHECK constraint has never admitted,
-- so it matched nothing and every waitlister counted as booked, which is what
-- made fill rate read 142%. That fix could not reach this function, because
-- this is a different read: the owner console tallies rows it fetched, and the
-- two member-facing apps ask the database to count for them.
--
-- ── Why the return type changes rather than a second function ───────────
--
-- The two figures are read together on every screen that shows either, and a
-- second RPC would be a second round trip that can fail independently — leaving
-- a caller holding a booked count and an unknown waitlist, with no honest way
-- to draw the row. One answer, two columns.
--
-- `create or replace function` cannot change a return type, so this DROPs and
-- recreates. Nothing depends on it in SQL — it is called over /rest/v1/rpc by
-- the apps and by nothing inside the database — so the drop takes nothing with
-- it. The `booked` column keeps its name and its position, so a caller that has
-- not been updated reads the same field it always did and simply gets a
-- CORRECTED number.
--
-- ── What a caller must do with an absent `waiting` ──────────────────────
--
-- An older build talking to this function gets a column it ignores, which is
-- fine. A NEWER build talking to an older database gets `undefined`, and
-- src/ui/classes.tsx must read that as UNKNOWN rather than as zero — "nobody is
-- waiting" is exactly the claim that would stop a coach adding the second
-- session. The provider's `countsKnown` already draws that distinction for the
-- booked figure and this rides on it.
--
-- Idempotent; safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════

drop function if exists public.class_counts();

create or replace function public.class_counts()
returns table(class_id uuid, booked bigint, waiting bigint)
language sql
security definer
-- Pinned, as part 38 pinned it: a SECURITY DEFINER function resolving
-- `class_bookings`, `gym_classes` and `my_tenant()` against the CALLER's
-- search_path lets a caller who can create a schema choose which tables the
-- tenant check reads.
set search_path to 'public', 'pg_temp'
as $$
  select
    cb.class_id,
    -- `filter` rather than a `where`, so a class whose bookings are ALL
    -- waitlisters still appears in the answer with booked = 0. A `where
    -- cb.status = 'booked'` would drop the row entirely, and a class missing
    -- from this answer falls to `?? 0` in the caller — which is the same zero,
    -- reached by a path where nothing knows it was ever a guess.
    count(*) filter (where cb.status = 'booked')::bigint   as booked,
    count(*) filter (where cb.status = 'waitlist')::bigint as waiting
  from class_bookings cb
  join gym_classes gc on gc.id = cb.class_id
  where gc.tenant_id = my_tenant()
  group by cb.class_id;
$$;

revoke execute on function public.class_counts() from public, anon;
grant  execute on function public.class_counts() to authenticated;

comment on function public.class_counts() is
  'How full each class in the caller''s tenant is. `booked` counts confirmed seats ONLY — it counted waitlisters too until part 210, so a class of 12 with 5 waiting reported 17. `waiting` is the queue, and it is the figure that tells a coach to put on a second session.';
