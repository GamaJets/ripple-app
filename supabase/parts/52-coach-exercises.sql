-- ─────────────────────────────────────────────────────────────────────────
-- A coach's own exercise names, kept.
--
-- Raised by a tester on 27 Aug 2026: "When saving a new exercise does it save
-- it to the app's catalogue of exercises or just specific to the user saving?"
-- The honest answer was neither. Typing a name into the builder's Add exercise
-- sheet put it in that one program and nowhere else — the client receiving the
-- program saw it, and the coach retyped it the next time.
--
-- Why not the existing `exercises` table: it has no tenant_id and no coach_id.
-- It is a global platform catalogue, currently 56 rows, and the exercise-video
-- library writes to it. Letting the builder write there would put one gym's
-- "Dave's Special Carry" in every other gym's picker. That is a decision about
-- the product, not a place to put a convenience.
--
-- So: per coach, exactly as program_templates already is. A coach's vocabulary
-- is their own, it follows them between gyms, and nobody else sees it.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.coach_exercises (
  coach_id     uuid not null references profiles(id) on delete cascade,
  name         text not null,
  muscle_group text not null default '',
  created_at   timestamptz not null default now(),
  -- Case-insensitive, so "back squat" typed twice is one row, not two entries
  -- a coach then has to look at and wonder about.
  primary key (coach_id, name)
);

create unique index if not exists idx_coach_exercises_ci
  on public.coach_exercises (coach_id, lower(name));

alter table public.coach_exercises enable row level security;

-- A coach reads and writes only their own.
drop policy if exists coach_exercises_self on public.coach_exercises;
create policy coach_exercises_self on public.coach_exercises for all
  using (coach_id = auth.uid()) with check (coach_id = auth.uid());

-- Trigger functions in this schema are not callable; see 51-advisor-tidy.sql.
-- Nothing here adds one, but the grant sweep in 40-function-grants.sql should
-- be re-run after any migration that does.
