-- ── Two things the app could not record, and one it recorded nowhere ────────
--
-- 1. `workouts.timed`   which sets were HELD rather than repeated
-- 2. `client_plan_edits` the changes a member makes to their own programme
--
-- Additive only. No existing column, constraint or policy is altered.
--
--
-- ═══ 1 · workouts.timed ═══════════════════════════════════════════════════
--
-- ── What was wrong ─────────────────────────────────────────────────────────
--
-- `buildProgram` in src/lib/programs.ts hands every fat-loss and tone client a
-- plank written as '45 sec' and a side plank written as '30 sec/side'. The set
-- method catalogue carries an `isometric` entry whose blurb says, in as many
-- words, "The reps column is seconds". And both logging paths in the client app
-- refused anything that was not a positive whole number of REPS.
--
-- So the app prescribed a hold, told the member the reps column was seconds,
-- and then would not accept a hold. What people typed instead was 45 into a
-- reps box — a claim that they performed forty-five plank repetitions, counted
-- into the rep totals on History and eligible to be read as a rep record. The
-- alternative was not logging the movement at all, which is what most people
-- did: the one exercise in a beginner's programme they could reliably complete
-- was the one their log never mentioned.
--
-- ── Why a column and not a third number in the pair ────────────────────────
--
-- `sets` is jsonb holding `[reps, kg]` pairs and three apps read it. Widening
-- the pair to a triple changes what every existing row means to every existing
-- reader, and there is no migration that reaches the on-device drafts in
-- AsyncStorage that hold the same shape.
--
-- `timed` is the same alignment `bw` (part 162) and `feel` already use, and it
-- changes what the FIRST number means: reps on an ordinary set, SECONDS on a
-- held one. The second number goes on meaning what it meant — the load, or with
-- `bw` the load added to the body — so a 45-second plank with a 10 kg plate is
-- `[45, 10]` with both flags true, and every part of that is recoverable.
--
-- ── Why nullable, with no default ──────────────────────────────────────────
--
-- NULL is the honest state for every row written before today. It does not mean
-- "none of these sets were held" — it means nobody was ever asked. The app
-- reads a missing flag as not-timed, which is exactly the answer it gave before
-- this column existed, so no historical row changes meaning.
--
-- And a DEFAULT would be worse here than anywhere. A 45 sitting in the reps
-- slot of a row logged last month is a figure nobody can now interpret;
-- back-filling it as a hold would invent a plank that may never have happened,
-- and back-filling it as reps asserts the forty-five repetitions this column
-- exists to stop being asserted.
--
-- ── What a held set is worth, so nothing downstream has to guess ───────────
--
-- No tonnage and no estimated 1RM. Tonnage is Σ reps × load, and seconds ×
-- kilograms is not a mass moved — a member holding 10 kg for 45 seconds has not
-- lifted 450 kg and no total in this product may say so. Epley over seconds
-- returns a strength figure computed from a stopwatch. The hold is worth the
-- hold, and src/lib/timedSets.ts keeps the board it belongs on.

alter table workouts add column if not exists timed jsonb;

comment on column workouts.timed is
  'Per-set timed flags, aligned to sets: timed[i] true means set i was HELD '
  'rather than repeated, and sets[i][0] is then SECONDS rather than reps. '
  'NULL = nobody was asked; it is not a claim that no set was held. A held set '
  'contributes no tonnage and no estimated 1RM — see src/lib/timedSets.ts.';


-- ═══ 2 · client_plan_edits ════════════════════════════════════════════════
--
-- ── What was wrong ─────────────────────────────────────────────────────────
--
-- Four pieces of React state on app/(client)/workouts.tsx held every change a
-- member can make to the programme they were given: a movement swapped for one
-- their gym actually has, a load corrected at the rack, an exercise taken off
-- because a shoulder will not do it, an exercise added because they did it
-- anyway. All four were plain `useState`. The screen persisted exactly two
-- things and neither was any of them.
--
-- So a swap made on Tuesday was gone on Wednesday, and none of it ever reached
-- the coach. A coach writing Bench Press for somebody whose gym has no bench
-- sees a programme being followed; the member sees a lift they substitute every
-- session. The one fact that would settle it — "they have swapped this four
-- weeks running" — was being typed into a React state and thrown away.
--
-- ── One row per member, not one per change ─────────────────────────────────
--
-- The four are ONE answer to one question: what does this member's plan
-- actually look like when they train. They are read together, written together
-- and shown together, and a schema that spread them over four tables would
-- invite three of them to arrive and one not to, which is the partial state
-- this table exists to remove. The client upserts the whole set; there is
-- nothing to merge and therefore nothing to merge wrongly.
--
-- `edits` is TEXT, not jsonb, and that is deliberate: the app writes it through
-- one serialiser (`writePlanEdits`) and reads it through one parser
-- (`readPlanEdits`) which distinguishes "no edits" from "bytes nobody could
-- read". Storing it as jsonb would put a second parser — Postgres's — in front
-- of the first, and a shape it rejected would fail the whole upsert rather than
-- reaching the reader that knows what to do with it.
--
-- ── Who may read it ────────────────────────────────────────────────────────
--
-- The member, and the coach who trains them. `is_my_client` is the same test
-- every other coach read in this database uses, so a coach who is dropped
-- stops seeing this the moment `clients.trainer_id` changes, with nothing to
-- clean up.
--
-- The coach may READ and may not WRITE. This table is the member's account of
-- their own plan; the coach already owns the programme itself, in
-- `program_templates` and on the assignment, and a coach who could edit this
-- could silently withdraw a change their client made and told them about.

create table if not exists client_plan_edits (
  client_id  uuid primary key references profiles(id) on delete cascade,
  edits      text not null,
  updated_at timestamptz not null default now()
);

alter table client_plan_edits enable row level security;

drop policy if exists client_plan_edits_own on client_plan_edits;
create policy client_plan_edits_own on client_plan_edits
  for all
  using (client_id = (select auth.uid()))
  with check (client_id = (select auth.uid()));

drop policy if exists client_plan_edits_coach_r on client_plan_edits;
create policy client_plan_edits_coach_r on client_plan_edits
  for select
  using (is_my_client(client_id));

comment on table client_plan_edits is
  'What a member has changed about the programme they were given: swapped '
  'movements, corrected sets/reps/loads, removals, and movements they added. '
  'One row per member holding all four together, because they are one answer '
  'to one question. The member writes it; their coach may read it and may not '
  'write it.';
