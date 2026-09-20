-- ═══════════════════════════════════════════════════════════════════════════
-- A coach's cue for a movement had nowhere to live except inside one client's
-- week, so it was retyped on every assignment and drifted between people.
--
-- ── The defect ─────────────────────────────────────────────────────────────
--
-- `ProgramExercise.note` (src/lib/programs.ts) is the only place in Repple a
-- coach can write anything against a movement, and its own header says what it
-- is for: "machine by the window, seat on 4" — a fact about THIS client on
-- THIS day, in THIS program. It is stored inside the `exercises` JSONB of a
-- single `assigned_programs` row.
--
-- But most of what a coach writes there is not about that client at all. It is
-- the sentence they say to everybody about that lift — "brace before you
-- unrack, chin tucked" — and the only way to get it in front of a second
-- client was to type it again. Forty clients, forty copies, no link between
-- them. Change your mind about how you cue a squat and there is no edit that
-- reaches the thirty-nine weeks already assigned; fix it in three of them and
-- the same coach's front squat now carries three different cues with nothing
-- anywhere able to say which one they meant.
--
-- TrueCoach and Everfit both attach the cue to the EXERCISE, once, and it
-- rides into every program from there. Repple had no table it could go in.
--
-- ── A cue and a note are two different facts ──────────────────────────────
--
-- Stated first because collapsing them is the failure that destroys work
-- rather than merely missing some.
--
--   the CUE     belongs to (coach, movement). It is the coach's default and it
--               is the same for everybody they train. One row here.
--   the NOTE    belongs to (program, day, exercise). It is about one person
--               on one day — "go easy, right shoulder still sore" — and it
--               stays exactly where it is, in the program JSONB, untouched
--               by this part.
--
-- Nothing in this file reads, writes or references `assigned_programs`,
-- `program_templates` or any note in either. The app fills an EMPTY note from
-- the cue and NEVER a written one: `prefillNote` in src/lib/coachCues.ts is
-- the single implementation of that rule and every call site goes through it.
-- A cue arriving over a note somebody typed about a particular client would be
-- an erasure performed silently, with no undo and no record that the note ever
-- said anything else — and this codebase's standing rule, applied to a
-- mistyped cost in part 700 and to a withdrawn consent in part 3030, is that a
-- correction is a second recorded fact and never an erasure. A cue eating a
-- note is not even a correction.
--
-- The same rule is why removing a cue leaves every note already prefilled from
-- it exactly as it is. Those notes are in programs; they are what the coach
-- actually told those people; and a delete that reached into them would be
-- rewriting coaching that has already happened.
--
-- ── The key, and why it is (coach_id, exercise_id) ───────────────────────
--
-- One cue per coach per movement, as the PRIMARY KEY rather than as a
-- convention, because the alternative is a coach with four cues for the bench
-- press and an app that has to pick one. Re-saving is an upsert: the coach
-- changing their own default, which is theirs to change.
--
-- Deliberately NOT a history table, unlike `gym_agreement_revocations` in part
-- 3030. The distinction is what the row is a record OF. A revocation is a
-- dated act by a person and the sequence is the point. A cue is a current
-- preference — the sentence you say today — and the record of what you told a
-- particular client on a particular day already exists, in that client's
-- program, written at the moment it was said. The history is in the notes.
--
-- `exercise_id` is `text` and references `public.exercises(id)`, verified
-- against the live schema rather than assumed: `exercises.id` is `text primary
-- key` and holds the slug `exerciseSlug()` produces ('back-squat', 'push-up').
-- `cueKey()` in src/lib/coachCues.ts is that same rule and its test asserts the
-- two agree character for character. `on delete cascade` because a cue for a
-- movement that no longer exists is not a cue.
--
-- `coach_id` references `public.profiles(id)`, which is also what
-- `public.trainers(id)` references, so a trainer's profile id IS their
-- auth.uid() — the same identity `is_my_client()` compares against.
--
-- ── Who may read it, and the half that is easy to get wrong ──────────────
--
-- The coach, obviously. And the CLIENT, or the feature does not exist: the
-- whole point is that the cue reaches the person standing at the machine, on
-- app/(client)/exercise.tsx.
--
-- The client policy is an EXISTS against `public.clients`, and `clients` is
-- the right table and `coach_clients` is not. Two tables in this schema carry
-- something called a coach link:
--
--   public.clients         `id` references profiles(id) — an app account — and
--                          `trainer_id` references trainers(id). This is the
--                          link `is_my_client()` (part 361 of setup.sql) tests,
--                          and the only one where the client has an auth.uid()
--                          to be matched against.
--   public.coach_clients   `trainer_id` references auth.users, and `id` is a
--                          fresh gen_random_uuid() naming NOBODY. It is the
--                          coach's own private roster of people typed in by
--                          hand, most of whom have never installed the app.
--                          There is no account behind those rows, so there is
--                          no session for a policy to match — a lane found on
--                          13 September 2026 that 2 of 4 production
--                          `coach_clients` rows have no `clients` row at all.
--
-- A policy written against `coach_clients` would therefore admit nobody and
-- the cue would silently never appear on any client's screen. This one is
-- written against `clients`, which is the table that knows about accounts.
--
-- ── Applying this ─────────────────────────────────────────────────────────
--
-- Additive. One new table, its policies, its grants, one index. Nothing
-- existing is altered, no trigger is added or widened anywhere, no program
-- or note is touched, and there is no backfill: mining the notes already
-- written for sentences that look repeated and promoting them to cues would be
-- Repple deciding which of a coach's words were meant generally.
--
-- The reading library tolerates this part NOT having been applied, and this is
-- load-bearing because it is not applied anywhere as it ships. Measured
-- against this project's live REST endpoint on 13 September 2026, PostgREST
-- answers a select naming a table absent from its schema cache with PGRST205
-- and never reaches Postgres at all, so the 42P01 an undefined relation would
-- raise is never produced. `isMissingCueTable` in src/lib/coachCues.ts accepts
-- BOTH — PGRST205 for the ordinary case, 42P01 for a warm cache over a dropped
-- table — and turns them into a 'read' status of 'absent', which is kept
-- strictly distinct from a read that failed on the wire. Every other error
-- throws. See `CueRead` in that file.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. the cue ──────────────────────────────────────────────────────────────

create table if not exists public.coach_exercise_cues (
  -- The coach whose cue this is. Defaulted to auth.uid() and never sent by the
  -- app, for the same reason part 3030 defaults `revoked_at`: a caller able to
  -- name the owner is a caller able to write into somebody else's book. The
  -- WITH CHECK below refuses it anyway; the default means there is no field to
  -- get wrong.
  coach_id    uuid        not null default auth.uid()
              references public.profiles(id) on delete cascade,

  -- The movement, as the catalogue ids it. Not the display name: 'Back Squat'
  -- and 'back squat' are one movement and must be one cue, which is what the
  -- slug rule is for.
  exercise_id text        not null
              references public.exercises(id) on delete cascade,

  -- What the coach says, every time, to everybody.
  --
  -- The length bound is mirrored by CUE_MAX in src/lib/coachCues.ts, so a coach
  -- who types past it is refused by a sentence in the app rather than by a
  -- 23514 from the database. The non-blank check is the same discipline as
  -- `gym_agreement_revocations.reason`: a row storing '' would prefill nothing
  -- and would make every reader answer with a string meaning "no cue".
  -- Clearing a cue is a DELETE, which is a different act with a different
  -- button.
  cue         text        not null
              check (btrim(cue) <> '' and length(cue) <= 500),

  -- When it was last written. Not a history — see the header — but a coach
  -- looking at a cue they wrote eighteen months ago is entitled to know that.
  updated_at  timestamptz not null default now(),

  primary key (coach_id, exercise_id)
);

comment on table public.coach_exercise_cues is
  'A coach''s own standing cue for one movement: the sentence they say to everybody they train, written once and carried into every program. One row per (coach, movement) by primary key. This is NOT the per-exercise note inside a program day — that note is about one client on one day, lives in assigned_programs.exercises, and is never touched by anything here. The app PREFILLS an empty note from a cue and never overwrites a written one (prefillNote in src/lib/coachCues.ts is the only implementation of that rule), and deleting a cue leaves every note already written exactly as it is. See supabase/parts/3150.';

comment on column public.coach_exercise_cues.coach_id is
  'Whose cue. Defaults to auth.uid() and is never sent by the app: a caller able to name the owner is a caller able to write into another coach''s book. References profiles(id), which is the same identity trainers(id) references and the same one is_my_client() compares against.';

comment on column public.coach_exercise_cues.exercise_id is
  'The movement, as exercises.id spells it — the slug from exerciseSlug()/cueKey(), e.g. back-squat. Never a display name: "Back Squat" and "back squat" are one movement and must be one cue. Cascades, because a cue for a movement that no longer exists is not a cue.';

comment on column public.coach_exercise_cues.cue is
  'The coach''s words. Never NULL and never blank — a row storing an empty string would prefill nothing while making every reader answer with a string that means "no cue", so clearing a cue is a DELETE and not an empty save. Bounded at 500 characters, mirrored by CUE_MAX in src/lib/coachCues.ts so the refusal is a sentence in the app rather than a 23514.';

comment on column public.coach_exercise_cues.updated_at is
  'When this cue was last written. Defaulted, and set again by the upsert. It is NOT a history: what a coach told a particular client on a particular day is recorded in that client''s program note, written at the moment it was said, and nothing here supersedes it.';

-- The client's read: "what does MY coach say about this movement". Filtered on
-- the movement, scoped to a coach by the policy. `coach_id` leads because the
-- primary key index does too and this one exists for the other direction —
-- a client's screen knows the exercise and not the coach.
create index if not exists coach_exercise_cues_exercise_idx
  on public.coach_exercise_cues (exercise_id, coach_id);

-- ── 2. nothing about a program changes ────────────────────────────────────
--
-- Said as a comment rather than as code, because the correct implementation of
-- "no note is touched" is the absence of every statement that would touch one.
-- There is deliberately no reference in this file to assigned_programs or
-- program_templates, no trigger that writes into either, no column added to
-- either, and no backfill that reads a note and promotes it to a cue. A cue is
-- a default a coach sets; a note is something they wrote about a person.

-- ── 3. who may read and write it ────────────────────────────────────────────

alter table public.coach_exercise_cues enable row level security;

-- The coach owns their own book outright: read, write, replace, delete.
--
-- `(select auth.uid())` and not a bare `auth.uid()`, which is the form every
-- policy in this schema uses after the provider-value sweep: the scalar
-- sub-select is evaluated once per statement instead of once per row.
drop policy if exists coach_exercise_cues_own on public.coach_exercise_cues;
create policy coach_exercise_cues_own on public.coach_exercise_cues
  for all
  to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));

-- And the CLIENT reads their own coach's cues, which is the whole point: the
-- cue has to reach the person standing at the machine.
--
-- SELECT only, and scoped through `public.clients` — the table that knows
-- about app accounts. `coach_clients` would admit nobody: its `id` is a fresh
-- uuid naming no account at all, so no session could ever match it, and the
-- cue would silently never appear on anybody's screen. See the header.
--
-- Reading their coach's whole cue book is deliberate and is not a widening:
-- a cue is a sentence about a movement, written to be read by exactly these
-- people, and the app asks for one movement at a time anyway.
drop policy if exists coach_exercise_cues_client_read on public.coach_exercise_cues;
create policy coach_exercise_cues_client_read on public.coach_exercise_cues
  for select
  to authenticated
  using (exists (
    select 1 from public.clients c
    where c.trainer_id = public.coach_exercise_cues.coach_id
      and c.id = (select auth.uid())
  ));

-- No client INSERT, UPDATE or DELETE in any direction, and they are named and
-- dropped rather than merely never written, so a policy added by somebody
-- wanting a "clients can suggest a cue" feature does not survive a rebuild of
-- this file. A client editing their coach's standing cue would be changing
-- what forty other people are told.
drop policy if exists coach_exercise_cues_client_write on public.coach_exercise_cues;
drop policy if exists coach_exercise_cues_client_i on public.coach_exercise_cues;
drop policy if exists coach_exercise_cues_client_u on public.coach_exercise_cues;
drop policy if exists coach_exercise_cues_client_d on public.coach_exercise_cues;

-- ── 4. grants ───────────────────────────────────────────────────────────────
--
-- RLS narrows a GRANT; it does not create one. And the revoke names `anon` BY
-- NAME as well as `public`: Postgres's default privileges in a Supabase
-- project grant on a new object to roles that `revoke ... from public` does
-- not reach, which is the exact mechanism part 2180 exists to undo after
-- get_advisors found eighteen objects answering strangers. A cue is a coach's
-- own writing and belongs to nobody who is not signed in.
revoke all on public.coach_exercise_cues from anon, authenticated, public;
grant select, insert, update, delete on public.coach_exercise_cues to authenticated;
grant all on public.coach_exercise_cues to service_role;

-- ── 5. what this part deliberately does NOT do ──────────────────────────────
--
--   · It writes into no program and no note. Not one row of
--     assigned_programs or program_templates is read or altered, and there is
--     no trigger anywhere that reaches one. The prefill is an app-side
--     default applied to an EMPTY note; a written note is never touched.
--   · It backfills nothing. Reading the notes coaches have already written,
--     finding the repeated ones and promoting them to cues would be Repple
--     deciding which of somebody's words were meant generally, and would put
--     a sentence written about one client's shoulder in front of forty more.
--   · It keeps no history. A cue is a current preference. The dated record of
--     what a coach told a particular person is that person's program note,
--     and it already exists.
--   · It adds no unique constraint beyond the primary key, and needs none:
--     (coach_id, exercise_id) IS the key, so a second cue for the same
--     movement is an upsert of the first rather than a duplicate.
--   · It sends no notification. A coach editing their own default is not an
--     event forty clients are told about; they see the cue when they next
--     open the movement.
