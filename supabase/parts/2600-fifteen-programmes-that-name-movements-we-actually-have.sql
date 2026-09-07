-- RepDB's 15 workout templates, with every movement resolved to a real row.
--
-- ── Why a new table and not program_templates ──────────────────────────────
--
-- `program_templates.coach_id` is NOT NULL: that table is a coach's own saved
-- programmes, private to them. These fifteen belong to nobody and are read by
-- everybody, so filing them there would have meant inventing an owner and
-- handing one coach the platform's catalogue.
--
-- ── The defect in the source data, and what was done about it ──────────────
--
-- RepDB's templates reference nine exercise ids that RepDB's own catalogue does
-- not contain. Checked, not assumed: 56 distinct ids referenced, 47 resolved,
-- nine did not — barbell-row, bent-over-db-row, db-bench-press,
-- dumbbell-shoulder-press, incline-bench-press, incline-db-press,
-- incline-push-ups, ohp, squat.
--
-- Eight are plain abbreviations and are resolved by name:
--
--     barbell-row              -> bent-over-row
--     bent-over-db-row         -> bent-over-dumbbell-row
--     db-bench-press           -> dumbbell-bench-press
--     dumbbell-shoulder-press  -> seated-dumbbell-shoulder-press
--     incline-bench-press      -> incline-barbell-bench-press
--     incline-db-press         -> incline-dumbbell-press
--     incline-push-ups         -> incline-push-up
--     ohp                      -> overhead-press
--
-- `squat` is not an abbreviation, it is ambiguous: back-squat, front-squat and
-- bodyweight-squat all exist. It was resolved by READING each template rather
-- than by picking a favourite. In powerlifting-peaking-4-day it appears in the
-- same day as `front-squat`, which settles that it is not that; in stronglifts
-- and the two beginner strength programmes it sits beside bench-press,
-- barbell-row and deadlift at 5x5. Those seven are back-squat. The eighth is in
-- home-bodyweight-beginner, at 3x15-20, in a day whose every other movement is
-- bodyweight — that one is bodyweight-squat.
--
-- After resolution: 126 references, 57 distinct ids, all 57 present in
-- `exercises`. Asserted below rather than asserted here.

create table if not exists public.workout_templates (
  id                 text primary key,
  source             text not null default 'repdb',
  goal               text not null,
  difficulty         text not null,
  frequency_per_week smallint,
  tags               text[] not null default '{}',
  -- The programme itself: [{name_en, exercises:[{exercise_id, sets, reps, ...}]}]
  days               jsonb not null,
  name_en            text not null,
  description_en     text,
  name_de            text,
  description_de     text,
  name_es            text,
  description_es     text,
  created_at         timestamptz not null default now()
);

alter table public.workout_templates enable row level security;

drop policy if exists wt_read on public.workout_templates;
-- Read by every signed-in member and coach; written by nobody through the API.
-- The catalogue is ours to import, not theirs to edit.
create policy wt_read on public.workout_templates
  for select to authenticated using (true);

revoke all on public.workout_templates from anon, public;
grant select on public.workout_templates to authenticated;

-- ── The guard ──────────────────────────────────────────────────────────────
--
-- A template naming a movement we do not have renders as a blank row in
-- somebody's programme, and the nine ids above prove that is not hypothetical:
-- it is what the vendor shipped. A CHECK constraint cannot ask another table,
-- so this is a trigger. It fires on every insert and update, names the first
-- id it cannot find, and refuses the write.
create or replace function public.assert_template_exercises_exist()
returns trigger language plpgsql
-- Fixed search_path, not the default. get_advisors raised
-- `function_search_path_mutable` on the first version of this: a function that
-- resolves `public.exercises` through a mutable path can be pointed at a
-- shadowing object by whoever controls the caller's search_path, and this one's
-- whole job is to be the thing that says no.
set search_path = public, pg_temp
as $$
declare missing text;
begin
  select string_agg(distinct x.eid, ', ')
    into missing
  from jsonb_array_elements(new.days) d,
       jsonb_array_elements(d->'exercises') e,
       lateral (select e->>'exercise_id' as eid) x
  where not exists (select 1 from public.exercises ex where ex.id = x.eid);

  if missing is not null then
    raise exception
      'workout_template %: names % that no row in public.exercises matches',
      new.id, missing
      using hint = 'Resolve the id against the catalogue before importing; see supabase/parts/2600.';
  end if;
  return new;
end;
$$;

-- SECURITY INVOKER (the default) is right here: the trigger only reads
-- `exercises`, which every writer of this table can already read, and a definer
-- would be a privilege this needs no part of.
revoke all on function public.assert_template_exercises_exist() from public, anon;

drop trigger if exists trg_workout_template_exercises on public.workout_templates;
create trigger trg_workout_template_exercises
  before insert or update on public.workout_templates
  for each row execute function public.assert_template_exercises_exist();

-- ── Verified live, 7 Sep 2026 ──────────────────────────────────────────────
--
--   15 templates, all trilingual (en/de/es), 26 days, 126 exercise references,
--   0 unresolved.
--
--   The guard was proved to fire rather than assumed to: inserting a template
--   naming 'squat' and 'ohp' is refused with
--
--     workout_template __guard_probe__: names ohp, squat that no row in
--     public.exercises matches
--
--   The first probe of it was worthless and is worth recording as a warning.
--   It wrapped the insert in a block that raised on success and caught on
--   failure — but a plpgsql exception rolls back to the start of its own block,
--   so BOTH outcomes left zero rows and the probe could not tell them apart. A
--   test whose branches converge is not a test. The second probe records the
--   error text in a temp table, which survives the rollback, and asserts on it.
