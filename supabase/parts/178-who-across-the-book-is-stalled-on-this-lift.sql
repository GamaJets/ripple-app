-- ═══════════════════════════════════════════════════════════════════════════
-- "Who is stalled on bench across my roster" — the one coaching insight that
-- gets BETTER as a coach gets busier, and the only one the app could not answer
-- at all.
--
-- src/lib/exerciseHistory.ts can read one client's history of one movement, and
-- app/(trainer)/exercise.tsx draws it. To ask it of a book of forty people a
-- coach opens forty screens.
--
-- ── The two things that made a roster-wide read impossible ────────────────
--
-- 1. THE ROW CAP. `capLimit()` is a flat ceiling of 1000 rows on every read in
--    this app, and src/lib/rowCap.ts explains why: a page of a client's
--    workouts is bounded and a subtotal wearing a total's label is worse than
--    no total. A roster-wide read of `workouts` is not bounded by anything —
--    forty clients times several years of sets is hundreds of thousands of
--    rows — so it would come back truncated EVERY time, and every figure over
--    it would be null. The screen would exist and say nothing.
--
--    Aggregating in the database fixes that completely: the answer is one row
--    per client, so the result is bounded by the size of the roster and is
--    never truncated. That is the whole reason this is a function and not a
--    select.
--
-- 2. `exercise` IS FREE TEXT. It is whatever the client typed into their own
--    phone, and the app matches movements by SLUG — lowercase, every run of
--    non-alphanumerics collapsed to a single hyphen — in src/lib/exerciseId.ts.
--    Nothing in the database knew that rule, so 'Bench Press', 'bench press'
--    and 'Bench  Press' are three different strings to Postgres and a WHERE on
--    the raw column would answer for one of them.
--
-- ── Why the slug is a GENERATED column and not a trigger ──────────────────
--
-- A trigger has to be right on INSERT and on UPDATE, and a row written by a
-- path that disables triggers, or by a restore, carries whatever it carries. A
-- generated column cannot drift: Postgres computes it, there is no writer to
-- forget, and a row inserted by anything at all has a correct slug.
--
-- The expression is `exerciseSlug` transcribed exactly, and the two MUST agree
-- or a coach's roster search silently misses the movement they searched for.
-- That risk is real and is the same one supabase/parts/49-exercise-video-library.sql
-- carries for its seed — which is why both are asserted from the JavaScript
-- side, in src/lib/rosterExercise.test.ts, against the same worked examples.
--
--   lower()                        'Bent-Over Row' → 'bent-over row'
--   regexp_replace non-alnum → ' ' → 'bent over row'
--   btrim()                        → 'bent over row'
--   replace(' ', '-')              → 'bent-over-row'
--
-- Every function in it is IMMUTABLE, which a generated column requires.
--
-- ── Why the aggregate is SECURITY INVOKER ─────────────────────────────────
--
-- Deliberately NOT a definer function. `workouts_coach_read` is already
-- `for select using (is_my_client(user_id))` — part 53 shipped the read half of
-- that policy and nothing ever called it — so a coach reading their own
-- clients' workouts is ALREADY permitted, one row at a time, by a policy that
-- has been reviewed. An invoker function inherits exactly that and adds no new
-- privilege to audit. A definer function here would have to re-implement the
-- policy in its body and would be a standing grant to read any row in
-- `workouts` if it were ever got wrong, which is the hole part 105 opened.
--
-- The `clients` join is not access control — RLS is — it is what keeps the
-- COACH'S OWN logged training out of a list of their clients. A coach who
-- trains at their own gym has `workouts` rows of their own, readable under the
-- owner-row policy, and they would otherwise appear on this screen as a client
-- with no name.
--
-- auth.uid(), never current_user: under PostgREST every signed-in request runs
-- as the shared `authenticated` role.
-- ─────────────────────────────────────────────────────────────────────────

-- ── The slug ──────────────────────────────────────────────────────────────

alter table public.workouts
  add column if not exists exercise_slug text
  generated always as (
    replace(btrim(regexp_replace(lower(exercise), '[^a-z0-9]+', ' ', 'g')), ' ', '-')
  ) stored;

comment on column public.workouts.exercise_slug is
  'exerciseSlug(exercise), computed by Postgres. The join key for every movement comparison; `exercise` remains the spelling the person typed and is what screens print. Must stay identical to src/lib/exerciseId.ts.';

-- The roster query is "this movement, these people, newest first". Slug leads
-- because it is the equality, and `performed_at desc` is inside the index so
-- the max and the ordering come off it without a sort.
create index if not exists workouts_slug_idx
  on public.workouts (exercise_slug, user_id, performed_at desc);

-- ── The aggregate ─────────────────────────────────────────────────────────
--
-- Dropped before it is recreated: `create or replace` with a different argument
-- list makes an OVERLOAD, and PostgREST resolving one name against two
-- candidates with compatible defaults is a 300 at the moment a coach searches.
drop function if exists public.coach_exercise_roster(text, timestamptz, timestamptz);

create or replace function public.coach_exercise_roster(
  p_slug  text,
  p_from  timestamptz,
  p_split timestamptz
)
returns table (
  client_id       uuid,
  last_at         timestamptz,
  -- Logging EVENTS, not days. A day boundary needs the client's timezone and
  -- this schema stores none — src/lib/coachWeek.ts and
  -- app/(trainer)/client-week.tsx both refuse to state a day for exactly this
  -- reason, and that refusal is not weakened here. `count(distinct performed_at)`
  -- is what src/lib/clientTraining.ts calls `entryCount` and it is honest: a
  -- client who logs one movement at a time makes several, and the screen says so.
  recent_outings  integer,
  prior_outings   integer,
  -- Heaviest single set in each window, in KILOGRAMS. Null when nothing in the
  -- window carried a load — a bodyweight movement has no tonnage to report, and
  -- that is an absent measurement rather than a measurement of zero.
  recent_top_kg   numeric,
  prior_top_kg    numeric,
  -- Best estimated one-rep max in each window, Epley, in kilograms. An
  -- ESTIMATE, named as one everywhere it is shown: nobody in this app has
  -- tested a maximum, and src/lib/progression.ts's `priorBest1RM` computes the
  -- same figure the same way for one client so the two cannot disagree.
  recent_e1rm_kg  numeric,
  prior_e1rm_kg   numeric
)
language sql
stable
as $$
  with sets as (
    select
      w.user_id,
      w.performed_at,
      case when jsonb_typeof(s->0) = 'number' then (s->>0)::numeric end as reps,
      case when jsonb_typeof(s->1) = 'number' then (s->>1)::numeric end as load_kg
    from public.workouts w
    -- The coach's own clients, and nobody else. RLS is what makes this legal;
    -- this join is what keeps the coach's OWN training out of a list of their
    -- clients' — see the header.
    join public.clients c on c.id = w.user_id and c.trainer_id = auth.uid()
    -- `left join lateral` rather than a comma join: a workout row with a null
    -- or empty `sets` — a cardio entry, or a movement logged with nothing
    -- recorded against it — is still an outing, and an inner join would drop
    -- the client out of the answer entirely rather than showing them with no
    -- load. "They have done it and logged no weight" is a different sentence
    -- from "they have not done it" and this screen must not merge them.
    left join lateral jsonb_array_elements(
      case when jsonb_typeof(w.sets) = 'array' then w.sets else '[]'::jsonb end
    ) s on true
    where w.exercise_slug = p_slug
      and w.performed_at >= p_from
  )
  select
    sets.user_id as client_id,
    max(sets.performed_at) as last_at,
    count(distinct sets.performed_at) filter (where sets.performed_at >= p_split)::integer as recent_outings,
    count(distinct sets.performed_at) filter (where sets.performed_at <  p_split)::integer as prior_outings,
    -- A set counts toward a load only when it has BOTH a rep count and a load.
    -- The same test src/lib/clientTraining.ts applies: a row somebody tabbed
    -- past is not a set of no reps, and a load with no reps behind it is not a
    -- lift that happened.
    max(sets.load_kg) filter (where sets.performed_at >= p_split and sets.reps > 0 and sets.load_kg > 0) as recent_top_kg,
    max(sets.load_kg) filter (where sets.performed_at <  p_split and sets.reps > 0 and sets.load_kg > 0) as prior_top_kg,
    -- Epley: load × (1 + reps ÷ 30). Capped at twelve reps because the formula
    -- is fitted to low-rep work and a set of thirty press-ups would otherwise
    -- estimate a maximum twice anybody's actual one — which is exactly the
    -- shape of made-up number this codebase spends its budget refusing.
    round(max(sets.load_kg * (1 + sets.reps / 30.0))
      filter (where sets.performed_at >= p_split and sets.reps between 1 and 12 and sets.load_kg > 0), 1) as recent_e1rm_kg,
    round(max(sets.load_kg * (1 + sets.reps / 30.0))
      filter (where sets.performed_at <  p_split and sets.reps between 1 and 12 and sets.load_kg > 0), 1) as prior_e1rm_kg
  from sets
  group by sets.user_id;
$$;

-- One row per client, so the result is bounded by the roster and can never come
-- back at a row cap. That is the property the whole screen depends on: a
-- truncated read would make every figure on it a dash.

revoke all on function public.coach_exercise_roster(text, timestamptz, timestamptz) from public, anon;
grant execute on function public.coach_exercise_roster(text, timestamptz, timestamptz) to authenticated;

-- ── What is deliberately NOT here ─────────────────────────────────────────
--
-- No "stalled" flag computed in SQL. Whether a client is stalled is a judgement
-- with a threshold in it, and every threshold in this app lives in TypeScript
-- next to the sentence that explains it and the assertions that pin it —
-- `VOLUME_JUMP` and `HEAVY_REPS` in src/lib/programReview.ts, `AT_RISK_DROP` in
-- src/lib/clientDrift.ts. A number buried in a migration is a number nobody can
-- find, nobody can test, and nobody can change without a deploy of the
-- database. This function returns the two windows; src/lib/rosterExercise.ts
-- decides, and says why on screen.
--
-- No text search over exercise names. The caller passes a SLUG it computed with
-- the same rule the column uses, so there is one matching rule in the system.
-- A `like` or a trigram search here would be a second, fuzzier one — and the
-- whole of src/lib/exerciseId.ts exists because the old bidirectional substring
-- match resolved 'Squat' to whichever of Back Squat, Front Squat and Goblet
-- Squat sorted first.
