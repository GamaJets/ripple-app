-- ═══════════════════════════════════════════════════════════════════════════
-- A cohort, and a credit.
--
-- Two client screens shipped as shells, and both were shells for the same
-- reason: the fact each one needed had nowhere to live in the database.
--
--   · Challenges had no other athletes. `src/ui/challenges.tsx` was a
--     three-entry constant with `field: []` on every one of them, because the
--     six invented athletes that used to be in there ("Maya R.", "Devin K.")
--     shipped to real clients with invented scores and a rank measured against
--     people who do not exist. Emptying the array was the right emergency fix
--     and it left a leaderboard with one person on it.
--   · Referrals had no referrer. `referrals` records (referred_user, code) and
--     nothing anywhere maps a code back to the person whose code it is — the
--     code is derived in JavaScript on the phone, from a name and a uuid, and
--     the server has never seen the derivation. `referral_count(p_code)`
--     therefore counts rows carrying a STRING, for whoever asks, about
--     whatever code they type. Nothing could be credited to anybody because
--     nothing knew who anybody was.
--
-- This part gives both of them the missing fact, and nothing more than that.
-- In particular it does not decide what a referral is worth: see the last
-- section.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · challenges — who a client is measured against
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── The cohort is a gym or a coach's roster, and never the platform ────────
--
-- The obvious shape is one global board per challenge. It is wrong here three
-- times over.
--
--   * Repple is white-label. A client of one gym has no relationship with a
--     client of another, has never met them, and cannot be shown their name —
--     38-tenant-isolation.sql exists to keep those two populations apart, and
--     a leaderboard is precisely a list of other people's names and activity.
--     A global board would be the one screen in the product that walks through
--     that wall.
--   * A global board is not a competition, it is a distribution. Ranking a
--     member who trains three times a week 4,000th out of 9,000 tells them
--     nothing they can act on and takes something away from them.
--   * The people a client will actually keep pace with are the ones they see
--     on a Tuesday evening: the rest of the gym, or the handful of athletes
--     their coach is training. That is the group a "challenge" already means
--     when a coach says the word out loud.
--
-- So the cohort is exactly one of two things, and which one is a COLUMN rather
-- than a convention, for the reason 109-wellness-and-announcements gives about
-- `announcements.coach_id`: a rule that has to ask what role the author had is
-- a rule that changes meaning when somebody's role changes.
--
--     tenant_id not null, coach_id null   every member of that gym
--     coach_id not null, tenant_id null   that coach's current roster
--
-- Exactly one, enforced by a check. `coach_id` rows carry no tenant on purpose
-- and by precedent — a solo coach with no gym must be able to run a challenge,
-- and filling in a tenant for them would mean choosing one, which is inventing
-- one. See the note in src/ui/announcements.tsx that says the same thing.
--
-- ── The score is computed here, from `workouts`, and never submitted ───────
--
-- The provider used to compute the client's score on the phone from their own
-- log. That was fine while the only reader was the person themselves. The
-- moment it becomes a rank against other people it is a number one athlete can
-- type — a POST of `{score: 900}` is all it would take — and the first person
-- to notice would quietly own every board in their gym. Nobody would be able
-- to tell, because a fabricated score looks exactly like a real one.
--
-- So every figure on every board is derived here from rows the athlete cannot
-- forge either: `workouts`, written under `workouts_own` (their own user_id) or
-- by their coach under `logged_by`. There is no score column anywhere in this
-- part, and no way to write one.
--
-- ── Days belong to the challenge, not to the phone ────────────────────────
--
-- Two of the three metrics count CALENDAR DAYS, and a calendar day is a
-- question about a time zone. src/lib/streaks.ts deliberately uses the phone's
-- local day, which is right for a personal streak — an evening session must
-- count as tonight even after its ISO timestamp has rolled into tomorrow in
-- UTC. It is wrong for a shared board: two athletes in the same gym on
-- different sides of midnight would be counting different days, and their ranks
-- would not be comparable.
--
-- `challenges.time_zone` is therefore the board's own zone, applied to
-- everybody on it. The gym picks it once. A trigger checks that it is a zone
-- this database actually knows, because the symptom of a typo is not a bad
-- value in a column — it is every read of that board raising, forever.

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  coach_id uuid references public.profiles(id) on delete cascade,
  title text not null,
  blurb text,
  -- 'days'   distinct training days inside the window
  -- 'streak' longest run of consecutive training days inside the window
  -- 'volume' tonnes lifted inside the window (Σ reps × kg ÷ 1000)
  metric text not null,
  unit text not null default 'days',
  goal numeric not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  time_zone text not null default 'UTC',
  icon text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Constraints added separately and idempotently so this part re-runs against a
-- table an earlier run already created.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'challenges_one_cohort') then
    alter table public.challenges add constraint challenges_one_cohort
      check (num_nonnulls(tenant_id, coach_id) = 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'challenges_metric_known') then
    alter table public.challenges add constraint challenges_metric_known
      check (metric in ('days', 'streak', 'volume'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'challenges_window') then
    alter table public.challenges add constraint challenges_window
      check (ends_at > starts_at);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'challenges_goal_positive') then
    -- A goal of zero is completed by standing still, and a negative one can
    -- never be completed at all. Both render a progress meter that lies.
    alter table public.challenges add constraint challenges_goal_positive
      check (goal > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'challenges_title_nonblank') then
    alter table public.challenges add constraint challenges_title_nonblank
      check (btrim(title) <> '' and length(title) <= 80);
  end if;
end $$;

comment on column public.challenges.tenant_id is
  'Not null = the cohort is every member of this gym. Mutually exclusive with coach_id.';
comment on column public.challenges.coach_id is
  'Not null = the cohort is this coach''s current roster. Mutually exclusive with tenant_id.';
comment on column public.challenges.time_zone is
  'The zone whose calendar days the day-counting metrics use, for everyone on the board.';

create index if not exists idx_challenges_tenant_ends
  on public.challenges (tenant_id, ends_at desc) where tenant_id is not null;
create index if not exists idx_challenges_coach_ends
  on public.challenges (coach_id, ends_at desc) where coach_id is not null;

-- A zone Postgres does not know is not a bad column value, it is an outage:
-- `performed_at at time zone 'Europe/Lodnon'` raises, so one typo at creation
-- time makes every read of that board fail for every athlete on it. Caught on
-- the way in, where exactly one person is looking at an error message.
create or replace function public.challenges_zone_is_real()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $fn$
begin
  begin
    perform now() at time zone new.time_zone;
  exception when others then
    raise exception 'Not a time zone this database knows: %', new.time_zone
      using errcode = '22023';
  end;
  return new;
end $fn$;

-- Trigger functions are reachable by nobody; see 51-advisor-tidy.sql. Named
-- rather than left at the default because PUBLIC carries both API roles, and
-- revoking only `anon` (or only `public`) is what left a hole here before.
revoke execute on function public.challenges_zone_is_real() from public;
revoke execute on function public.challenges_zone_is_real() from anon;
revoke execute on function public.challenges_zone_is_real() from authenticated;

drop trigger if exists challenges_zone_guard on public.challenges;
create trigger challenges_zone_guard
  before insert or update on public.challenges
  for each row execute function public.challenges_zone_is_real();


-- ── Joining is the consent, and it is the only consent there is ────────────
--
-- A leaderboard shows one person's activity to another. Nothing in this schema
-- puts anybody on a board: `challenge_participants` has exactly one writer per
-- row, the person themselves, and a client who never taps Join never appears
-- to anyone. Leaving deletes the row and takes them off it.
--
-- The row is readable by its owner and by nobody else — deliberately not by
-- the other participants. Everything a co-participant is shown comes out of
-- `challenge_board()` below, which returns a first name and a number and does
-- not return user ids, so there is nothing on the board to join back to a
-- profile, a tenant, or another table. That is the same argument
-- 115-the-face-that-goes-with-the-name makes and it is worth restating: RLS
-- chooses ROWS, never columns, so "they may see the name and the score" is not
-- a sentence a policy can say. Only a select list can say it.
create table if not exists public.challenge_participants (
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

create index if not exists idx_challenge_participants_user
  on public.challenge_participants (user_id);

alter table public.challenges enable row level security;
alter table public.challenge_participants enable row level security;

-- RLS narrows a GRANT, it does not confer one. Both tables are new, so the
-- grants below are the whole of what either API role may attempt, and `anon`
-- is given nothing at all rather than being left to a policy that happens to
-- evaluate false.
grant select, insert, update, delete on public.challenges to authenticated;
grant select, insert, delete on public.challenge_participants to authenticated;
revoke all on public.challenges from anon;
revoke all on public.challenge_participants from anon;

-- Who can see that a challenge exists. The two cohort arms are the client's;
-- the two after them are so the coach and the owner apps can list what they
-- themselves are running.
drop policy if exists challenges_read on public.challenges;
create policy challenges_read on public.challenges for select
  using (
    (coach_id is null and tenant_id = public.my_tenant())
    or (coach_id is not null and public.is_my_coach(coach_id))
    or (coach_id is not null and coach_id = (select auth.uid()))
    or (tenant_id is not null and public.is_owner_of(tenant_id))
  );

-- The gym's own board is the owner's to run. `created_by` must be the writer:
-- an account cannot put somebody else's name on a challenge.
drop policy if exists challenges_owner_rw on public.challenges;
create policy challenges_owner_rw on public.challenges for all
  using      (coach_id is null and public.is_owner_of(tenant_id))
  with check (coach_id is null and public.is_owner_of(tenant_id)
              and created_by = (select auth.uid()));

-- And a coach's board is the coach's, including the ability to delete one they
-- set up wrong — the same reasoning `ann_coach_rw` gives: a wrong challenge
-- left on forty dashboards permanently is worse than the write being possible.
--
-- Note what is NOT required: that `profiles.role` says 'trainer'. A row whose
-- `coach_id` is the writer is readable only by accounts whose
-- `clients.trainer_id` points at that writer, so an account nobody has as their
-- coach can write these all day and no other person can read one.
drop policy if exists challenges_coach_rw on public.challenges;
create policy challenges_coach_rw on public.challenges for all
  using      (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()) and tenant_id is null
              and created_by = (select auth.uid()));

-- One row, one owner, one reader.
drop policy if exists cp_self_read on public.challenge_participants;
create policy cp_self_read on public.challenge_participants for select
  using (user_id = (select auth.uid()));

-- You may put yourself on a board you can see, while it is still running.
-- `exists (… from challenges …)` is evaluated with RLS applied, so
-- `challenges_read` above is the eligibility rule and there is not a second
-- copy of it here to drift out of step with the first.
drop policy if exists cp_self_join on public.challenge_participants;
create policy cp_self_join on public.challenge_participants for insert
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.challenges c
                 where c.id = challenge_id and now() < c.ends_at)
  );

-- And take yourself off one at any time, running or finished.
drop policy if exists cp_self_leave on public.challenge_participants;
create policy cp_self_leave on public.challenge_participants for delete
  using (user_id = (select auth.uid()));


-- ── The two reads the client app makes ─────────────────────────────────────
--
-- Both are SECURITY DEFINER and both restate the visibility rule from
-- `challenges_read` in their own bodies, because a definer function does not
-- consult policies. That duplication is deliberate and is the only duplication
-- in this file that is: the alternative is a function that reads every gym's
-- challenges and trusts its arguments.
--
-- The scoring CTEs are also written out twice, once in each function, and that
-- is deliberate for a different and less obvious reason. The natural shape is a
-- shared helper returning (user_id, score) — and a helper is a function, and
-- 40-function-grants.sql loops over the catalogue granting EXECUTE on every
-- non-trigger function to `authenticated`, by design, because a hand-kept list
-- of names is what let thirty-two definer functions sit on the API surface. A
-- helper here would be re-granted by that loop the next time anybody runs it,
-- and it would hand out participant user ids to any caller who asked. Fifteen
-- duplicated lines are cheaper than a function that is one re-run away from
-- being a leak.

-- What the Challenges screen lists: the challenges this client can see, whether
-- they have joined, how many people are on each board, and their OWN score.
--
-- Own score, for a challenge they have not joined, is their own data and is
-- shown to them before they commit to anything — which is the point: "here is
-- what your last thirty days would look like on this board" is the honest
-- invitation, and it exposes nobody.
drop function if exists public.my_challenges();
create function public.my_challenges()
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
           sum(((s->>0)::numeric) * ((s->>1)::numeric)) / 1000.0 as tonnes
      from vis
      join workouts w
        on w.user_id = (select auth.uid())
       and w.performed_at >= vis.starts_at
       and w.performed_at <  vis.ends_at
      -- `sets` is nullable and is jsonb, so it can hold anything a past build
      -- ever wrote. Anything that is not an array of two numbers contributes
      -- nothing rather than raising: a board that 500s because one row from
      -- 2025 holds a string is a board nobody can see.
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(w.sets) = 'array' then w.sets else '[]'::jsonb end) s
     where vis.metric = 'volume'
       and jsonb_typeof(s->0) = 'number'
       and jsonb_typeof(s->1) = 'number'
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


-- The board itself. A place, a first name, a score, and whether the row is
-- yours. That list is the entire exposure of this feature and it is stated in
-- a select list rather than left to a policy, for the reason above.
--
-- Three refusals before a single row is computed, each raising 42501 rather
-- than returning nothing — an empty answer would be indistinguishable from a
-- board with nobody on it, which is the exact confusion src/ui/loadStatus.ts
-- exists to end:
--
--   1. not signed in;
--   2. signed in, but this challenge is not in your gym and not your coach's;
--   3. eligible, but not on the board. You see the people you are standing
--      beside; you do not get to read a roster you are not part of.
--
-- `first name only`: no surname, no avatar, no id. Two athletes called Sam
-- appear as two Sams, and that ambiguity is the price and is worth paying —
-- the alternative is a screen that tells forty people which Sam.
drop function if exists public.challenge_board(uuid);
create function public.challenge_board(p_challenge uuid)
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
    select w.user_id as u,
           sum(((s->>0)::numeric) * ((s->>1)::numeric)) / 1000.0 as tonnes
      from workouts w
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(w.sets) = 'array' then w.sets else '[]'::jsonb end) s
     where c_row.metric = 'volume'
       and w.user_id in (select p.u from p)
       and w.performed_at >= c_row.starts_at
       and w.performed_at <  c_row.ends_at
       and jsonb_typeof(s->0) = 'number'
       and jsonb_typeof(s->1) = 'number'
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


-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · referrals — the map from a code to the person whose code it is
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── What was missing ───────────────────────────────────────────────────────
--
-- `app/(client)/referral.tsx` builds a code on the phone: the first name, a
-- dash, and four base-36 characters of a hash of the user's id. It shares that
-- string through the OS sheet, a friend types it at sign-up, and
-- `record_referral` stores (referred_user, code). At no point does anything
-- record whose code it was. `referral_count(p_code)` closes the loop by
-- counting rows carrying that string — which means two things, both bad:
--
--   * nothing is attributed. A row saying "somebody arrived with the string
--     SAM-4F2A" cannot pay anybody, because the string is not a person.
--   * anybody can count anybody. The function takes a code as an argument and
--     answers for any code any signed-in caller types, including one they
--     watched somebody else share.
--
-- ── The server derives the code, so a code cannot be claimed ──────────────
--
-- The obvious fix is to let the phone register whatever code it derived. That
-- creates a land grab: codes are short, deterministic and shared publicly, so
-- the first account to register a string it did not derive inherits the
-- referrals that string earns.
--
-- Instead `referral_code_for()` below is the phone's derivation, transcribed
-- into SQL, over `profiles.full_name` and the user's own id. A caller cannot
-- ask for a code — they can only be given theirs. That also keeps continuity
-- with every code already shared before this shipped, because it produces the
-- same string the phone did for the same person.
--
-- It is stored once, on first claim, and never re-derived. A person who
-- changes their display name keeps the code they have already printed on
-- something.

create table if not exists public.referral_codes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  code text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_referral_codes_code
  on public.referral_codes (upper(code));

alter table public.referral_codes enable row level security;

-- Nobody reads this table through PostgREST, in either role. It is the map
-- from a public string to a person, so a select on it is a directory of who
-- holds which code; every legitimate read goes through a function below that
-- answers only about the caller. No grant, and therefore no policy is needed —
-- but RLS is enabled anyway so that a grant added later by somebody in a hurry
-- is not immediately a directory.
revoke all on public.referral_codes from anon;
revoke all on public.referral_codes from authenticated;

-- The referrer, resolved at the moment the referral is recorded.
--
-- Kept as a column rather than re-resolved from `code` on every read, because
-- the code is a string a person can be given and attribution is a fact about a
-- person. If a code were ever reassigned, the referrals already earned under it
-- must not move.
alter table public.referrals
  add column if not exists referrer_id uuid references public.profiles(id) on delete set null;

create index if not exists idx_referrals_referrer
  on public.referrals (referrer_id) where referrer_id is not null;

-- ── The phone's derivation, in SQL ─────────────────────────────────────────
--
-- Transcribed from `codeFrom(name, id)` in app/(client)/referral.tsx:
--
--   first = (name.trim().split(' ')[0] || 'REP').toUpperCase()
--             .replace(/[^A-Z]/g, '').slice(0, 6) || 'REP'
--   h     = 0; for each char of id: h = (h * 31 + charCode) >>> 0
--   tag   = h.toString(36).toUpperCase().slice(0, 4).padStart(4, '0')
--   code  = first + '-' + tag
--
-- `>>> 0` is a wrap to 32 bits, which is the modulo below. IMMUTABLE because it
-- is a pure function of its two arguments; it reads no table and calls nothing
-- that does.
--
-- It is revoked from every role, including `authenticated`, so it is not on the
-- API surface. One honest caveat: 40-function-grants.sql loops over the whole
-- catalogue granting EXECUTE to `authenticated`, and running that part ON ITS
-- OWN after this one would put this function back on the surface. In file order
-- 40 runs before 128, so a full build of setup.sql leaves the revoke standing —
-- and if the loop ever did reach it, all a caller could do is compute the code
-- of a user whose id AND display name they already have. That is a gift, not a
-- leak: a code can only ever credit its owner.
create or replace function public.referral_code_for(p_id uuid, p_name text)
returns text
language plpgsql
immutable
set search_path to 'pg_catalog'
as $fn$
declare
  seed text := p_id::text;
  h bigint := 0;
  i int;
  b text := '';
  first text;
begin
  for i in 1 .. length(seed) loop
    h := (h * 31 + ascii(substr(seed, i, 1))) % 4294967296;
  end loop;

  if h = 0 then
    b := '0';
  end if;
  while h > 0 loop
    b := substr('0123456789abcdefghijklmnopqrstuvwxyz', (h % 36)::int + 1, 1) || b;
    h := h / 36;
  end loop;

  first := substr(upper(regexp_replace(split_part(btrim(coalesce(p_name, '')), ' ', 1),
                                       '[^A-Za-z]', '', 'g')), 1, 6);
  if first = '' then
    first := 'REP';
  end if;

  return first || '-' || upper(lpad(substr(b, 1, 4), 4, '0'));
end $fn$;

revoke execute on function public.referral_code_for(uuid, text) from public;
revoke execute on function public.referral_code_for(uuid, text) from anon;
revoke execute on function public.referral_code_for(uuid, text) from authenticated;

-- The caller's own code, created on first ask. Takes no argument, so there is
-- nothing to point at anybody else.
--
-- The collision loop matters more than it looks: two people called Sam whose
-- ids hash to the same four characters would otherwise share a code and share
-- each other's referrals. A suffix is appended until the insert takes.
create or replace function public.my_referral_code()
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  uid uuid := (select auth.uid());
  base text;
  candidate text;
  n int := 0;
begin
  if uid is null then
    return null;
  end if;

  select rc.code into candidate from referral_codes rc where rc.user_id = uid;
  if candidate is not null then
    return candidate;
  end if;

  select referral_code_for(uid, p.full_name) into base from profiles p where p.id = uid;
  if base is null then
    base := referral_code_for(uid, null);
  end if;

  candidate := base;
  loop
    begin
      insert into referral_codes (user_id, code) values (uid, candidate);
      -- Rows recorded before this account had a registered code carry the
      -- string and no referrer. They are adopted here, and only here, and only
      -- by the account the string DERIVES from — which is why the derivation is
      -- server-side. Never overwrites a referrer that is already set, and never
      -- adopts the caller's own row.
      update referrals r
         set referrer_id = uid
       where r.referrer_id is null
         and upper(r.code) = upper(candidate)
         and r.referred_user_id <> uid;
      return candidate;
    exception when unique_violation then
      -- Either another session created this caller's row a moment ago, or the
      -- string is taken by somebody else. The first case is answered by
      -- re-reading; the second by trying the next suffix.
      select rc.code into candidate from referral_codes rc where rc.user_id = uid;
      if candidate is not null then
        return candidate;
      end if;
      n := n + 1;
      if n > 20 then
        raise exception 'Could not allocate a referral code' using errcode = '55000';
      end if;
      candidate := base || n::text;
    end;
  end loop;
end $fn$;

revoke execute on function public.my_referral_code() from public;
revoke execute on function public.my_referral_code() from anon;
grant execute on function public.my_referral_code() to authenticated;

-- ── Recording one ──────────────────────────────────────────────────────────
--
-- Same signature and same idempotence as 02-domain-schema's version, because
-- `app/welcome.tsx` on already-installed phones calls it and will keep calling
-- it. What is new: the referrer is resolved and stored, and an account cannot
-- refer itself — a code is deterministic from your own id, so without this
-- check the first thing anybody would do is type their own.
create or replace function public.record_referral(p_code text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  uid uuid := (select auth.uid());
  c text := upper(btrim(coalesce(p_code, '')));
  ref uuid;
begin
  if uid is null or c = '' then
    return;
  end if;

  select rc.user_id into ref from referral_codes rc where upper(rc.code) = c;
  if ref = uid then
    return;
  end if;

  -- First code wins. A second call with a different code changes nothing:
  -- somebody arrived once, and which invitation brought them is not a thing
  -- they get to revise later.
  insert into referrals (referred_user_id, code, referrer_id)
  values (uid, c, ref)
  on conflict (referred_user_id) do nothing;
end $fn$;

revoke execute on function public.record_referral(text) from public;
revoke execute on function public.record_referral(text) from anon;
grant execute on function public.record_referral(text) to authenticated;

-- ── What counts as converted, and why it is not stored ─────────────────────
--
-- A signup, a first session and a first payment are three different promises,
-- and the screen has to make exactly one of them. This picks the middle one:
--
--     A referral has CONVERTED when the person who used the code has logged
--     their first workout.
--
-- A signup is not a conversion. An install that never trains costs the gym
-- money and brings it nothing, and a referral scheme that pays for installs is
-- a scheme that pays for nothing — which is also how it becomes a scheme people
-- game. A first PAYMENT would be the strongest claim and it is not one this
-- database can make honestly today: money arrives through Stripe Connect, which
-- is not live for coaches yet (see 21-connect.sql), and a great many members
-- train under a gym membership that never produces a per-client charge at all.
-- Promising "when they pay" and then reporting on something else is worse than
-- promising less.
--
-- A logged workout is observable, unambiguous, and already in the database for
-- an honest reason. It also happens to be the thing the referrer actually did:
-- they got somebody training.
--
-- It is DERIVED at read time rather than stamped into a column by a trigger,
-- for two reasons. A stored `converted_at` is a second copy of a fact
-- `workouts` already holds, and the only thing a second copy can do is
-- disagree. And the trigger would have to sit on `workouts` — the hottest write
-- path in the product, where an exception means a client's sets do not save.
-- Nothing about a referral is worth putting in front of that.
--
-- The honest edge: a referred member who deletes every workout they logged
-- reverts to unconverted. That is right — the record says what is true now —
-- and it is stated here so that nobody reads it later as a bug.

-- The list: one row per person who arrived with the caller's code.
--
-- A first name and two timestamps. Not a surname, not an email, not an avatar,
-- not a user id: the referrer is being told which of their invitations worked,
-- and that needs a name they can recognise and nothing else. A code shared
-- publicly can be used by a stranger, and this is what a stranger's row shows.
create or replace function public.my_referrals()
returns table (friend_name text, joined_at timestamptz, started_at timestamptz)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select coalesce(nullif(btrim(split_part(btrim(p.full_name), ' ', 1)), ''), 'A friend'),
         r.created_at,
         (select min(w.performed_at) from workouts w where w.user_id = r.referred_user_id)
    from referrals r
    left join profiles p on p.id = r.referred_user_id
   where r.referrer_id = (select auth.uid())
   order by r.created_at desc
   limit 200;
$fn$;

revoke execute on function public.my_referrals() from public;
revoke execute on function public.my_referrals() from anon;
grant execute on function public.my_referrals() to authenticated;

-- The two counts, computed over ALL of the caller's referrals rather than over
-- the page `my_referrals()` returns.
--
-- Separate on purpose. A total computed from a capped list is a subtotal
-- presented as a total — see src/lib/rowCap.ts, which is the same failure
-- arriving through PostgREST's silent 1000-row limit. The list may be cut; the
-- counts never are.
create or replace function public.my_referral_summary()
returns table (joined int, converted int)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select count(*)::int,
         count(*) filter (
           where exists (select 1 from workouts w where w.user_id = r.referred_user_id)
         )::int
    from referrals r
   where r.referrer_id = (select auth.uid());
$fn$;

revoke execute on function public.my_referral_summary() from public;
revoke execute on function public.my_referral_summary() from anon;
grant execute on function public.my_referral_summary() to authenticated;

-- The old function, narrowed rather than dropped.
--
-- Dropping it would break the build that is on phones today: `referralCount`
-- in src/lib/referrals.ts calls it, and a missing RPC there would make the
-- Invite screen stop reporting anything until that phone took the update.
-- Narrowed, an old build keeps working for the caller's OWN code and answers
-- NULL for anybody else's — which src/lib/referrals.ts already maps to "say
-- nothing", because null there has always meant "could not be read" rather
-- than zero.
--
-- It also now counts what the new screen counts: rows ATTRIBUTED to the caller,
-- not rows carrying a string.
create or replace function public.referral_count(p_code text)
returns int
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select case
    when exists (select 1 from referral_codes rc
                  where rc.user_id = (select auth.uid())
                    and upper(rc.code) = upper(btrim(coalesce(p_code, ''))))
    then (select count(*)::int from referrals r where r.referrer_id = (select auth.uid()))
    else null
  end;
$fn$;

revoke execute on function public.referral_count(text) from public;
revoke execute on function public.referral_count(text) from anon;
grant execute on function public.referral_count(text) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · What this part deliberately does not do
-- ═══════════════════════════════════════════════════════════════════════════
--
-- There is no rewards table, no credit balance, no discount, no free session
-- and no column anywhere holding what a referral is worth. That is not an
-- omission to be filled in by whoever reads this next.
--
-- Nobody has agreed a reward. Repple is white-label: what a converted referral
-- is worth is a commercial decision belonging to each gym and each coach, in
-- their own currency (see the standing rule about never assuming one), against
-- their own margins. A schema that shipped "one free session per referral"
-- would be this codebase deciding how somebody else's business spends its
-- money, and the client screen would then be making a promise on their behalf
-- to a member who would hold them to it.
--
-- What is here is the fact, recorded truthfully and durably: this person
-- brought that person, and that person started training on this date. Anyone
-- who later agrees a reward has an attribution to hang it on. The client screen
-- says exactly this and promises nothing else.
