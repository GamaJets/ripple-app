-- ── How long the session ran ────────────────────────────────────────────────
--
-- One column, `workouts.session_mins`, so that a training session can be
-- written back to Apple Health.
--
-- ── Why the app needed a new fact ───────────────────────────────────────────
--
-- HealthKit will not accept a workout without a start AND an end. Repple knew
-- the start of everything and the end of almost nothing: `cardio.mins` covers a
-- run or a row, `zones` covers anything recorded against a live heart-rate
-- source, and neither exists for the case that makes up most of this log — a
-- strength session, which records reps and weight and no clock at all.
--
-- The tempting fix is to assume a length. It is also the one thing that must
-- not happen here: a nominal 45 minutes would land in a person's permanent
-- health record indistinguishable from a measurement, and every figure in this
-- product has to trace to something real. Deriving it from how long the logging
-- screen was open is worse, not better — people log on the walk home, so it
-- would write "4 min" for a 50-minute session and it would look measured.
--
-- So the length is asked for. A number the person types is evidence from
-- whoever was in the room, the same standing as the reps, the load and the RPE
-- already stored beside it, and the same thing Apple's own Health app asks for
-- when you add a workout by hand.
--
-- ── Why nullable, and why no default ────────────────────────────────────────
--
-- NULL is the honest state and has to stay reachable: it means nobody has said
-- how long this session was. A session in that state cannot be written to
-- Health, and the Watch & devices screen says exactly that rather than quietly
-- skipping it. A DEFAULT of any kind would erase the distinction between "50
-- minutes, stated" and "nobody knows", which is the whole point of the column.
--
-- The check refuses 0 and negatives for the same reason. A zero-minute workout
-- is not a short workout; it is an unfinished form, and HealthKit would accept
-- it as a real event with a zero duration.
--
-- ── Why it sits on `workouts` and not a new `sessions` table ────────────────
--
-- A session is already represented here: one session writes all of its
-- exercises as rows sharing `performed_at` (see the comment on
-- `WorkoutEntry.id` in src/lib/mockData.ts). The length is a fact about that
-- group, so every row in the group carries the same value and the app writes
-- them together in a single statement keyed on (user_id, performed_at). A
-- separate table would add a join and a second source of truth for grouping
-- that the timestamp already provides.
--
-- Additive only. Nothing here alters an existing column or policy; existing
-- rows keep NULL, which reads back as "not known" rather than as a duration.

alter table workouts add column if not exists session_mins int;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workouts_session_mins_positive'
  ) then
    alter table workouts
      add constraint workouts_session_mins_positive
      check (session_mins is null or session_mins > 0);
  end if;
end $$;

comment on column workouts.session_mins is
  'Whole-session length in minutes. NULL = nobody has stated it; never defaulted. '
  'Populated only from a measured source or from the person''s own entry.';
