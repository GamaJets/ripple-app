-- ─────────────────────────────────────────────────────────────────────────
-- Two faults, resolved in one pass because the second is caused by the first.
--
-- ── 1. Duplicates the mapping created ─────────────────────────────────────
--
-- Part 75 mapped the app's own rows onto RepDB content by COPYING the content
-- across, and left the RepDB row standing. So the catalogue grew a pair for
-- each: "Elliptical" beside "Elliptical Trainer", "Treadmill" beside "Treadmill
-- Running", "Back Squat" beside "Barbell Back Squat" — the exact duplication
-- part 75 had just removed.
--
-- Ours survives and RepDB's goes. Not because ours is the better name — several
-- of RepDB's are more precise — but because src/lib/machines.ts resolves a
-- SCANNED gym machine to an exercise by name, and src/lib/focus.ts and
-- buildProgram() emit those same strings. The catalogue can be renamed later;
-- it cannot be renamed by deleting the row the scanner points at.
--
-- 'triceps-pushdown' goes with them: it and 'tricep-pushdown' were always one
-- movement filed twice, and machines.ts names the singular.
--
-- ── 2. Rows keyed by RepDB's id rather than by their own name ─────────────
--
-- 68 rows had an id that was not the slug of the name they display: 'squat' is
-- "Barbell Back Squat", 'childs-pose' is "Child's Pose", 'incline-db-press' is
-- "Incline Dumbbell Press". Every screen resolves a movement through
-- exerciseSlug(name), so those rows listed in the picker, showed an
-- illustration and a description, and answered "not in our catalogue" when
-- opened. In the catalogue and unreachable from it.
--
-- The deletes run FIRST because exactly one target id was occupied — by
-- 'incline-db-press', itself one of the duplicates being removed.
--
-- scripts/check-catalogue.mjs now fails preflight on either fault, checking the
-- generated seed rather than the live database so it catches the commit that
-- introduces it rather than the deploy that ships it.
-- ─────────────────────────────────────────────────────────────────────────

do $$
declare refs integer;
begin
  select (select count(*) from public.exercise_videos)
       + (select count(*) from public.workout_logs) into refs;
  if refs > 0 then
    raise exception 'Refusing to touch the catalogue: % rows now reference it.', refs;
  end if;
end $$;

delete from public.exercises
where id in (
  'crunches','assisted-pull-ups','squat','barbell-row','cable-fly',
  'machine-calf-raise','chest-press-machine','incline-db-press',
  'nordic-hamstring-curl','ohp','seated-cable-row','dumbbell-shoulder-press',
  'elliptical-trainer','treadmill-running','stationary-bike','triceps-pushdown'
);

-- Guarded three ways: RepDB rows only, never onto an id already taken, and the
-- slug computed the way exerciseSlug() computes it — lowercase, every run of
-- non-alphanumeric characters to one hyphen, none leading or trailing.
update public.exercises e
set id = t.want
from (
  select id,
         trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')) as want
  from public.exercises
  where source = 'repdb'
) t
where e.id = t.id
  and e.id <> t.want
  and t.want <> ''
  and not exists (select 1 from public.exercises x where x.id = t.want);
