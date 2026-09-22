-- ═══════════════════════════════════════════════════════════════════════════
-- A leaderboard that scored a loaded plank and did not score a pull-up
-- ═══════════════════════════════════════════════════════════════════════════
-- APPLIED. Verified after: both functions read `bw` and `timed` through
-- WITH ORDINALITY, both skip a held set outright, anon cannot execute either
-- and authenticated can. Live at the time of applying: 0 challenges, 0
-- workout rows carrying `bw` or `timed` — so nobody had been scored wrongly
-- yet, which is the argument for doing it now.
--
--
-- NOT APPLIED. Written by the motivation lane; apply and then run the advisors.
--
-- `my_challenges()` and `challenge_board(uuid)` (supabase/parts/128-a-cohort-
-- and-a-credit.sql) both price a 'volume' challenge with one expression:
--
--     sum(((s->>0)::numeric) * ((s->>1)::numeric)) / 1000.0
--
-- — the first number of every set times the second, over every set in the
-- window. That is Σ reps × load, and it is the right arithmetic for exactly the
-- rows this app wrote before `workouts.bw` and `workouts.timed` existed. Both
-- columns exist now (verified on production: `bw jsonb`, `timed jsonb`), both
-- are arrays aligned index-for-index with `sets`, and each of them CHANGES WHAT
-- A NUMBER IN THE PAIR MEANS. The two functions have never been told.
--
-- ── 1 · a hold is seconds, and seconds times kilograms is not a mass ───────
--
-- `timed[i] = true` says `sets[i][0]` is SECONDS HELD, not repetitions
-- (src/lib/timedSets.ts). So a 45-second plank under a 20 kg plate — one entry,
-- logged exactly as the app asks for it — is scored 45 × 20 = 900 kg, and
-- almost a tonne lands on the board under somebody's first name.
--
-- The app itself refuses that figure in as many words. `entryTonnage` in
-- src/lib/bodyweightSets.ts skips a timed set outright, and its comment is the
-- whole argument: "45 seconds under a 10 kg plate is not 450 kg". The badge
-- module carries the scar of getting it wrong once — src/lib/badges.ts records
-- a single 45-second hold by an 80 kg member scoring 3,600 kg and unlocking One
-- Tonne on its own. The board is the same arithmetic in front of other people,
-- where the member who lifted honestly is the one moved down a place.
--
-- ── 2 · a pull-up carries a body, and the board priced it at nothing ───────
--
-- `bw[i] = true` says `sets[i][1]` is what was ADDED to the member's own
-- bodyweight, not the whole load. A plain pull-up is `[8, 0]`, so the board
-- scores eight reps of nothing. A member whose training is calisthenics reads
-- 0.0 t on a gym-wide volume challenge and sits last on it, while their own
-- Consistency screen — reading the same rows through `setLoadKg`, which prices
-- the set at what they weighed on the day — shows them the tonnes they moved.
-- Two screens, one member, one week of training, two answers, and the one shown
-- to forty other people is the wrong one.
--
-- ── what this changes, and what it deliberately does not ──────────────────
--
-- The `vol` CTE in both functions, and nothing else. Every other line of both
-- functions is reproduced verbatim from part 128 so that a reader can diff them
-- and see one changed block: the day/streak metrics, the visibility rules, the
-- three refusals in `challenge_board`, the `limit 200`, the select lists, the
-- ordering and every grant are untouched.
--
-- The new expression is `setLoadKg`/`entryTonnage` translated into SQL, and
-- nothing more:
--
--   · a set whose `timed` flag is true is skipped entirely — not counted as
--     zero, because it is work this total is not about;
--   · a set whose `bw` flag is true is priced at the member's own weight on
--     that day plus anything added, from the NEAREST reading at or before that
--     day, and is skipped when there is no such reading. That is
--     `bodyweightAtKg`'s rule exactly: at or before, never after, nearest wins;
--   · every other set is priced at the second number, as before.
--
-- The weight history is the union of `scans` and the member's own typed figure
-- on `clients` (`manual_weight_kg` / `manual_at`), which is what
-- `src/ui/clientData.tsx` assembles into `weightSeries` and hands to
-- `setLoadKg`. Reading only `scans` would leave every member who has typed a
-- weight and never been scanned unpriced, which is most of them.
--
-- The day boundary for "what did they weigh that day" is the CHALLENGE's time
-- zone, the same one the day and streak metrics already count on. A single
-- board must not measure two members' days on two different clocks, and that
-- rule does not stop applying because the metric changed.
--
-- WHAT IS STILL NOT SAID: a bodyweight set nobody can price contributes
-- nothing, and the board has nowhere to say so. The phone app carries that fact
-- as `unpricedSets` and prints `tonnageNote` under the figure; a leaderboard row
-- is a name, a place and a number, with no room for a caveat and no reader who
-- would know whose caveat it was. So the score understates for a member with no
-- weight on record at all — which is the same direction the old expression
-- failed in, for the same member, and is now the only case left rather than
-- every calisthenics set they have ever logged. The honest fix for that one is
-- the member recording a weight, which the app already asks for.
--
-- ── on `challenge_board` reading other participants' weight ───────────────
--
-- It does, and it must, and nothing about them leaves the function. To price
-- one participant's pull-up the definer has to know what that participant
-- weighed; the query returns a place, a first name and a tonnage, which is the
-- same select list part 128 fixed and argued for. No weight, no scan, no date
-- and no user id is returned, and the aggregate is the same figure that
-- participant's own app already computes and shows them. The alternative —
-- scoring everybody's bodyweight work at zero so that nobody's weight is read —
-- is the defect this file exists to remove.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · the client's own list
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.my_challenges()
returns table (
  id uuid, title text, blurb text, metric text, unit text, goal numeric,
  starts_at timestamptz, ends_at timestamptz, time_zone text, icon text,
  coach_id uuid, joined boolean, participants int, my_score numeric
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  with vis as (
    select c.*
      from challenges c
     where (
             (c.coach_id is null and c.tenant_id = my_tenant())
             or (c.coach_id is not null and is_my_coach(c.coach_id))
           )
       -- A board nobody can still reach falls off the screen a month after it
       -- ends. It is not deleted: the rows are the record of what was run.
       and c.ends_at > now() - interval '30 days'
  ),
  day_rows as (
    select vis.id as cid,
           (w.performed_at at time zone vis.time_zone)::date as d
      from vis
      join workouts w
        on w.user_id = (select auth.uid())
       and w.performed_at >= vis.starts_at
       and w.performed_at <  vis.ends_at
     where vis.metric in ('days', 'streak')
     group by 1, 2
  ),
  -- Gaps and islands: consecutive days share (day − their position), so the
  -- longest run is the largest group.
  runs as (
    select day_rows.cid, day_rows.d,
           day_rows.d - (row_number() over (partition by day_rows.cid order by day_rows.d))::int as grp
      from day_rows
  ),
  streaks as (
    select x.cid, max(x.n) as best
      from (select runs.cid, runs.grp, count(*) as n from runs group by 1, 2) x
     group by 1
  ),
  day_counts as (
    select day_rows.cid, count(*)::numeric as n from day_rows group by 1
  ),
  vol as (
    select vis.id as cid,
           sum(v.reps * v.load) / 1000.0 as tonnes
      from vis
      join workouts w
        on w.user_id = (select auth.uid())
       and w.performed_at >= vis.starts_at
       and w.performed_at <  vis.ends_at
      -- `sets` is nullable and is jsonb, so it can hold anything a past build
      -- ever wrote. Anything that is not an array of two numbers contributes
      -- nothing rather than raising: a board that 500s because one row from
      -- 2025 holds a string is a board nobody can see.
      --
      -- WITH ORDINALITY, because `bw` and `timed` are aligned to `sets` BY
      -- INDEX and there is no other way to ask which flag belongs to which
      -- pair. `i` is 1-based, the jsonb arrays are 0-based, hence `i - 1`.
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(w.sets) = 'array' then w.sets else '[]'::jsonb end)
        with ordinality as e(s, i)
      cross join lateral (
        select ((e.s->>0)::numeric) as reps,
               case
                 when coalesce(w.bw -> (e.i::int - 1), 'false'::jsonb) = 'true'::jsonb
                   -- The body, plus whatever was hung on it. Null when nobody
                   -- ever recorded a weight for this member on or before that
                   -- day, which drops the set rather than pricing it at the
                   -- added kilograms alone.
                   then (select h.kg
                           from (
                             select sc.taken_at as d, sc.weight_kg as kg
                               from scans sc
                              where sc.client_id = w.user_id
                                and sc.weight_kg is not null
                                and sc.weight_kg > 0
                             union all
                             select (cl.manual_at at time zone vis.time_zone)::date,
                                    cl.manual_weight_kg
                               from clients cl
                              where cl.id = w.user_id
                                and cl.manual_at is not null
                                and cl.manual_weight_kg is not null
                                and cl.manual_weight_kg > 0
                           ) h
                          where h.d <= (w.performed_at at time zone vis.time_zone)::date
                          order by h.d desc
                          limit 1)
                        + greatest(((e.s->>1)::numeric), 0)
                 else nullif(greatest(((e.s->>1)::numeric), 0), 0)
               end as load
      ) v
     where vis.metric = 'volume'
       and jsonb_typeof(e.s->0) = 'number'
       and jsonb_typeof(e.s->1) = 'number'
       -- A hold is seconds. Skipped outright, never counted as zero and never
       -- multiplied by a plate. src/lib/timedSets.ts is the rule.
       and coalesce(w.timed -> (e.i::int - 1), 'false'::jsonb) <> 'true'::jsonb
       and v.reps > 0
       and v.load is not null
       and v.load > 0
     group by 1
  ),
  head_count as (
    select cp.challenge_id as cid, count(*)::int as n
      from challenge_participants cp
     where cp.challenge_id in (select vis.id from vis)
     group by 1
  )
  select vis.id, vis.title, vis.blurb, vis.metric, vis.unit, vis.goal,
         vis.starts_at, vis.ends_at, vis.time_zone, vis.icon, vis.coach_id,
         exists (select 1 from challenge_participants cp
                  where cp.challenge_id = vis.id and cp.user_id = (select auth.uid())),
         coalesce(head_count.n, 0),
         case vis.metric
           when 'days'   then coalesce(day_counts.n, 0)
           when 'streak' then coalesce(streaks.best, 0)::numeric
           when 'volume' then round(coalesce(vol.tonnes, 0), 1)
           else 0
         end
    from vis
    left join day_counts on day_counts.cid = vis.id
    left join streaks    on streaks.cid    = vis.id
    left join vol        on vol.cid        = vis.id
    left join head_count on head_count.cid = vis.id
   order by vis.ends_at asc, vis.title asc;
$fn$;

revoke execute on function public.my_challenges() from public;
revoke execute on function public.my_challenges() from anon;
grant execute on function public.my_challenges() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · the board
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.challenge_board(p_challenge uuid)
returns table (place int, display_name text, score numeric, is_me boolean)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  uid uuid := (select auth.uid());
  c_row public.challenges%rowtype;
begin
  if uid is null then
    raise exception 'Sign in to see a challenge board' using errcode = '42501';
  end if;

  select * into c_row from public.challenges c where c.id = p_challenge;
  -- Same message for "no such challenge" and "not yours": the difference
  -- between them is itself an answer about another gym's data.
  if not found
     or not ((c_row.coach_id is null and c_row.tenant_id = my_tenant())
             or (c_row.coach_id is not null and is_my_coach(c_row.coach_id))) then
    raise exception 'No such challenge' using errcode = '42501';
  end if;

  if not exists (select 1 from challenge_participants cp
                  where cp.challenge_id = c_row.id and cp.user_id = uid) then
    raise exception 'Join the challenge to see who else is on the board'
      using errcode = '42501';
  end if;

  return query
  with p as (
    select cp.user_id as u from challenge_participants cp where cp.challenge_id = c_row.id
  ),
  day_rows as (
    select w.user_id as u, (w.performed_at at time zone c_row.time_zone)::date as d
      from workouts w
     where c_row.metric in ('days', 'streak')
       and w.user_id in (select p.u from p)
       and w.performed_at >= c_row.starts_at
       and w.performed_at <  c_row.ends_at
     group by 1, 2
  ),
  runs as (
    select day_rows.u, day_rows.d,
           day_rows.d - (row_number() over (partition by day_rows.u order by day_rows.d))::int as grp
      from day_rows
  ),
  streaks as (
    select x.u, max(x.n) as best
      from (select runs.u, runs.grp, count(*) as n from runs group by 1, 2) x
     group by 1
  ),
  day_counts as (
    select day_rows.u, count(*)::numeric as n from day_rows group by 1
  ),
  vol as (
    -- The same arithmetic as `my_challenges()` above, for every participant
    -- rather than for the caller. It has to be the same or a member's own score
    -- and their place on the board would be computed two different ways, which
    -- is the disagreement part 128's header set out to end.
    select w.user_id as u,
           sum(v.reps * v.load) / 1000.0 as tonnes
      from workouts w
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(w.sets) = 'array' then w.sets else '[]'::jsonb end)
        with ordinality as e(s, i)
      cross join lateral (
        select ((e.s->>0)::numeric) as reps,
               case
                 when coalesce(w.bw -> (e.i::int - 1), 'false'::jsonb) = 'true'::jsonb
                   then (select h.kg
                           from (
                             select sc.taken_at as d, sc.weight_kg as kg
                               from scans sc
                              where sc.client_id = w.user_id
                                and sc.weight_kg is not null
                                and sc.weight_kg > 0
                             union all
                             select (cl.manual_at at time zone c_row.time_zone)::date,
                                    cl.manual_weight_kg
                               from clients cl
                              where cl.id = w.user_id
                                and cl.manual_at is not null
                                and cl.manual_weight_kg is not null
                                and cl.manual_weight_kg > 0
                           ) h
                          where h.d <= (w.performed_at at time zone c_row.time_zone)::date
                          order by h.d desc
                          limit 1)
                        + greatest(((e.s->>1)::numeric), 0)
                 else nullif(greatest(((e.s->>1)::numeric), 0), 0)
               end as load
      ) v
     where c_row.metric = 'volume'
       and w.user_id in (select p.u from p)
       and w.performed_at >= c_row.starts_at
       and w.performed_at <  c_row.ends_at
       and jsonb_typeof(e.s->0) = 'number'
       and jsonb_typeof(e.s->1) = 'number'
       and coalesce(w.timed -> (e.i::int - 1), 'false'::jsonb) <> 'true'::jsonb
       and v.reps > 0
       and v.load is not null
       and v.load > 0
     group by 1
  ),
  scored as (
    select p.u,
           case c_row.metric
             when 'days'   then coalesce(day_counts.n, 0)
             when 'streak' then coalesce(streaks.best, 0)::numeric
             when 'volume' then round(coalesce(vol.tonnes, 0), 1)
             else 0
           end as sc
      from p
      left join day_counts on day_counts.u = p.u
      left join streaks    on streaks.u    = p.u
      left join vol        on vol.u        = p.u
  )
  select rank() over (order by scored.sc desc)::int,
         coalesce(nullif(btrim(split_part(btrim(pr.full_name), ' ', 1)), ''), 'Athlete'),
         scored.sc,
         scored.u = uid
    from scored
    left join profiles pr on pr.id = scored.u
   -- Ties are ordered by name, not by id or join time: a stable order that
   -- carries no information about who anybody is.
   order by scored.sc desc,
            coalesce(nullif(btrim(split_part(btrim(pr.full_name), ' ', 1)), ''), 'Athlete') asc
   limit 200;
end $fn$;

revoke execute on function public.challenge_board(uuid) from public;
revoke execute on function public.challenge_board(uuid) from anon;
grant execute on function public.challenge_board(uuid) to authenticated;
