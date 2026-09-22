-- ─────────────────────────────────────────────────────────────────────────
-- A record about a member, that the member could not answer.
--
-- Part 53 gave a coach the pen: `workouts.logged_by`, a policy that lets them
-- write a session into the client's OWN training record, and an `amended_at`
-- stamp for when the client corrects it. Its header argued the case for the
-- amendment properly — "a client who cannot correct 'he wrote 8 reps, it was
-- 10' simply deletes the entry and logs their own" — and then the client app
-- never built the surface. `app/(client)/workouts.tsx` rendered
-- `attributionLine(l, null, true)` with the coach's name hard-coded to null,
-- so every coach-written row said the same six words, "Logged by your coach",
-- with nothing beside it to press.
--
-- `src/lib/upcomingWindow.ts` states what that costs, about a different list
-- and in the same sentence this part is for:
--
--     the member cannot see what their coach recorded and cannot dispute it.
--     Their silence is then read as approval.
--
-- That is the defect. Not that the record is wrong — most of them are right —
-- but that there is no difference, anywhere in the data, between a member who
-- has read what was written about them and agrees with it and a member who has
-- never been shown it. Absence of objection was the only evidence either way,
-- and absence of objection was guaranteed by the UI.
--
-- ── Why a query and not a delete, and not a correction either ──────────────
--
-- Both already exist and neither is this.
--
-- DELETE removes the coach's account of the session altogether. Part 53 permits
-- it deliberately and gives the reason (it is the member's personal data, and
-- payroll lives in `sessions`, untouched) — but an erasure tells the coach
-- nothing about WHY, and a member who only wants to say "that is not what we
-- did" should not have to destroy the record to say it.
--
-- AMEND rewrites the figures and stamps `amended_at`. That is the right tool
-- when the member knows what the right figures are. It is the wrong one when
-- they do not — "I was never in the gym on Tuesday" is not a set count.
--
-- A QUERY is the third thing, and it is the one that makes silence mean
-- something again: a dated mark, by the person the record is about, saying
-- they do not accept it, carried on the row the coach already reads. It changes
-- no figure. It erases nothing. It is a second recorded fact beside the first,
-- which is the only shape a correction is allowed to take here.
--
-- ── Who may write it ───────────────────────────────────────────────────────
--
-- Only the subject, and the trigger says so rather than leaving it to the
-- policies. `workouts_own` (ALL, `user_id = auth.uid()`) is what permits the
-- write at all and is already live — this part adds no policy and widens
-- nothing. The coach has SELECT and INSERT on these rows and no UPDATE, so
-- today they could not clear a query even if they tried; the check below is
-- there because "today they could not" is a fact about a policy somebody may
-- one day widen for an unrelated reason, and a mark whose whole value is that
-- the subject made it must not be erasable by the party it is about.
--
-- The clock is the server's, for the same reason `amended_at` is. A stamp the
-- client hands in is a stamp the client chooses, and "you queried this three
-- weeks ago" is a claim about a date somebody may later have to stand behind.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.workouts
  add column if not exists queried_at timestamptz,
  add column if not exists query_note text;

comment on column public.workouts.queried_at is
  'When the member said they do not accept what their coach recorded here. Null means they have not said so — NOT that they agree; see the part header.';
comment on column public.workouts.query_note is
  'What the member said was wrong, in their own words. Null when they queried the row without explaining, which is allowed: the mark is the point.';

-- Extended, not replaced: every rule part 53 wrote is still here and still
-- first. The two new ones are the query's, and the INSERT branch is new
-- machinery — the trigger was UPDATE-only, so `old` is unassigned on an insert
-- and every line below the branch would raise "record old is not assigned yet"
-- if it were reached.
create or replace function public.guard_workout_attribution()
returns trigger language plpgsql
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    -- A row cannot arrive already queried. The only writer of a row with
    -- `logged_by` set is the coach (policy workouts_coach_insert), so an
    -- insert carrying a query would be the coach recording the member's
    -- opinion of the coach's own record, on the member's behalf.
    if new.queried_at is not null or new.query_note is not null then
      raise exception 'A workout cannot be logged already queried.' using errcode = '42501';
    end if;
    return new;
  end if;

  -- Attribution is not editable by anyone through this path.
  if new.logged_by is distinct from old.logged_by then
    raise exception 'Who logged a workout cannot be changed.' using errcode = '42501';
  end if;

  -- auth.uid(), not current_user. This function is SECURITY INVOKER so
  -- current_user would be the connected role ("authenticated") for every
  -- caller alike, which is the trap guard_profile_identity documents.
  if old.logged_by is not null
     and auth.uid() = old.user_id
     and (new.exercise     is distinct from old.exercise
       or new.sets         is distinct from old.sets
       or new.cardio       is distinct from old.cardio
       or new.kcal         is distinct from old.kcal
       or new.performed_at is distinct from old.performed_at)
  then
    new.amended_at := now();
  end if;

  -- ── the query is the subject's, in both directions ──────────────────────
  --
  -- Setting it and clearing it are the same permission. A mark that anybody
  -- else can remove is not a record of what the member said, it is a record of
  -- what somebody else has not yet removed.
  if (new.queried_at is distinct from old.queried_at
      or new.query_note is distinct from old.query_note)
     and auth.uid() is distinct from old.user_id
  then
    raise exception 'Only the person a workout is about may query it.' using errcode = '42501';
  end if;

  -- Nothing to query on a row the member wrote themselves. Their own log is
  -- not a claim made about them, and a query on one would put a dispute in
  -- front of a coach over a session they never touched.
  if new.queried_at is not null and old.logged_by is null then
    raise exception 'Only a workout somebody else logged can be queried.' using errcode = '22023';
  end if;

  -- The date is the server's. The client sends any non-null value to mean "now";
  -- what lands is `now()`, so a handset with a wrong clock — or a curious one —
  -- cannot date its own objection.
  if new.queried_at is not null and new.queried_at is distinct from old.queried_at then
    new.queried_at := now();
  end if;

  -- Withdrawing the query withdraws what it said. The note has no meaning on
  -- its own: a sentence about a dispute that is no longer standing would sit on
  -- the coach's screen forever with nothing to explain why it is there.
  if new.queried_at is null then
    new.query_note := null;
  end if;

  return new;
end $$;

-- Recreated because the EVENT changed: `before insert or update`, not `before
-- update`. Dropping and recreating is how that is edited — `create trigger` has
-- no clause for it — and the drop is idempotent, as part 53's was.
drop trigger if exists guard_workout_attribution_t on public.workouts;
create trigger guard_workout_attribution_t
  before insert or update on public.workouts
  for each row execute function public.guard_workout_attribution();

-- Trigger functions are reachable by nobody; see 51-advisor-tidy.sql. Revoked
-- from `anon` BY NAME, because Supabase's ALTER DEFAULT PRIVILEGES grants
-- EXECUTE to anon separately from PUBLIC and revoking PUBLIC does not touch it
-- (part 141).
revoke execute on function public.guard_workout_attribution() from public, anon, authenticated;
