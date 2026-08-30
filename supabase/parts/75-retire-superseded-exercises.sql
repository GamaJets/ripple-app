-- ─────────────────────────────────────────────────────────────────────────
-- One catalogue, not two.
--
-- Importing free-exercise-db and then RepDB left 1403 rows describing the same
-- movements under different names — "Alternate Incline Dumbbell Curl" beside
-- "Incline Dumbbell Curl", 128 of the older rows variant-prefixed duplicates of
-- each other. A client searching "crunch" got "Ab Crunch" (a photograph) and
-- "Crunches" (an illustration) as two entries, which reads as an unfinished
-- app rather than as a rich library.
--
-- Mixing photographs with illustrations is also the exact seam RepDB was
-- adopted to remove, and it could never have converged: bought animations
-- attach to RepDB ids, so the older rows would have become a permanent second
-- tier with no route to catching up.
--
-- 1403 → 620. Of those, 617 carry a description and 480 an illustration.
--
-- ── What is kept ──────────────────────────────────────────────────────────
--
--   · all 601 RepDB rows;
--   · the 56 this app shipped originally — NOT because a database row points
--     at them, but because the CODE names them. EXERCISES_BY_GROUP in
--     src/lib/focus.ts and buildProgram() emit "Bench Press" and "Back Squat"
--     as strings. Delete those rows and generated programs point at movements
--     the catalogue has never heard of, with nothing in the database to warn
--     us. 37 of the 56 share an id with a RepDB row; the other 19 are mapped
--     by hand below.
--
-- ── Why the guard is a guard and not a comment ────────────────────────────
--
-- exercise_videos and workout_logs both hold a foreign key to exercises, and
-- both were empty when this was written. "Were empty when written" is not a
-- property a migration can rely on — this file may run against a database that
-- has been live for a year. A delete that silently takes a client's training
-- history with it is not something to discover afterwards.
-- ─────────────────────────────────────────────────────────────────────────

do $$
declare refs integer;
begin
  select (select count(*) from public.exercise_videos)
       + (select count(*) from public.workout_logs) into refs;
  if refs > 0 then
    raise exception
      'Refusing to retire exercises: % rows reference the catalogue. Work out which ids are in use before deleting anything.', refs;
  end if;
end $$;

with protected(id) as (values ('ab-crunch'),('air-bike'),('assisted-pull-up'),('back-extension'),('back-squat'),('barbell-curl'),('bench-press'),('bent-over-row'),('bicep-curl'),('bulgarian-split-squat'),('cable-crossover'),('cable-crunch'),('cable-kickback'),('cable-machine'),('calf-raise'),('chest-press'),('deadlift'),('elliptical'),('face-pull'),('front-squat'),('glute-bridge'),('good-morning'),('hack-squat'),('hammer-curl'),('hanging-leg-raise'),('hip-abduction'),('hip-thrust'),('incline-dumbbell-press'),('lat-pulldown'),('lateral-raise'),('leg-curl'),('leg-extension'),('leg-press'),('nordic-curl'),('overhead-press'),('overhead-tricep-extension'),('pec-deck'),('plank'),('pull-up'),('push-up'),('rear-delt-fly'),('romanian-deadlift'),('rowing-machine'),('russian-twist'),('seated-calf-raise'),('seated-row'),('shoulder-press'),('ski-erg'),('smith-machine'),('stair-climber'),('standing-calf-raise'),('treadmill'),('tricep-pushdown'),('triceps-pushdown'),('upright-bike'),('walking-lunge'))
delete from public.exercises e
where e.source is distinct from 'repdb'
  and e.id not in (select id from protected);

-- ── The 19 of ours RepDB does not share an id with ────────────────────────
--
-- Each pairing was read as a MOVEMENT, not as a string. Similarity would have
-- got several wrong: it offers Hack Squat for Back Squat, because RepDB files
-- Barbell Back Squat under the id 'squat' and no score finds that; and Reverse
-- Nordic Curl for Nordic Curl, which trains the quadriceps rather than the
-- hamstrings. Our name and group survive; only content crosses.
--
-- Three are deliberately left bare, and NOT because they are mistakes. Cable
-- Machine, Smith Machine and Ski Erg are all entries in src/lib/machines.ts,
-- the list the "Scan machine" feature resolves a photographed machine against.
-- Deleting them would leave scanning a Smith Machine naming a movement the app
-- cannot open — the feature failing silently rather than loudly. RepDB
-- describes movements and not machines, so they carry no description, which is
-- the honest answer rather than a gap to fill.
with m(ours, theirs) as (values
    ('ab-crunch','crunches'),
    ('assisted-pull-up','assisted-pull-ups'),
    ('back-squat','squat'),
    ('bent-over-row','barbell-row'),
    ('cable-crossover','cable-fly'),
    ('calf-raise','machine-calf-raise'),
    ('chest-press','chest-press-machine'),
    ('incline-dumbbell-press','incline-db-press'),
    ('nordic-curl','nordic-hamstring-curl'),
    ('overhead-press','ohp'),
    ('seated-row','seated-cable-row'),
    ('shoulder-press','dumbbell-shoulder-press'),
    ('triceps-pushdown','tricep-pushdown'),
    ('elliptical','elliptical-trainer'),
    ('treadmill','treadmill-running'),
    ('upright-bike','stationary-bike')
)
update public.exercises tgt
set description       = src.description,
    category          = src.category,
    equipment         = src.equipment,
    level             = src.level,
    mechanic          = src.mechanic,
    force             = src.force,
    primary_muscles   = src.primary_muscles,
    secondary_muscles = src.secondary_muscles,
    instructions      = src.instructions,
    image_paths       = src.image_paths,
    met               = src.met,
    goals             = src.goals,
    tags              = src.tags,
    -- Stamped 'repdb' so frameUrls() resolves these illustrations against the
    -- RepDB host rather than the retired one, and so the attribution covers them.
    source            = 'repdb'
from m
join public.exercises src on src.id = m.theirs
where tgt.id = m.ours;
