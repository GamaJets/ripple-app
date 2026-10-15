-- ═══════════════════════════════════════════════════════════════════════════
-- A third of the catalogue was filed as "Full body", and a curl is not.
--
-- `exercises.muscle_group` reads 'Full body' on 196 of 615 rows. 143 of those
-- are `category = 'strength'` — a Barbell Preacher Curl, a Barbell Calf Raise,
-- a Dumbbell Hip Thrust — and a group target cannot reach any of them. Asking
-- for Arms returns 26 movements while 52 arm movements sit outside it.
--
-- Found on 3 Oct 2026 by a different route: Build a Workout offered "Or
-- instead: Barbell Overhead Extension" under a calf raise, because on a
-- full-body session the pool is the whole catalogue. That was fixed in
-- src/lib/builtWorkout.ts by matching on `primary_muscles`, which is accurate
-- throughout. This part fixes the column that was wrong underneath it.
--
-- ── How each row was placed, and why not by the catalogue's own filing ────
--
-- The obvious approach — take the group the catalogue already uses for each
-- muscle — reproduces its own contradictions. It files gluteus medius under
-- 'Core', and its 32 correctly-filed gluteus maximus rows split so evenly that
-- the winner holds 44%. Learning the mapping from that data would have
-- laundered the inconsistency into something that looked authoritative.
--
-- So the placement is by muscle, and the SECOND muscle is what separates the
-- biggest group. 64 rows name gluteus maximus first, and they are three
-- different things:
--
--   · with `quadriceps`  — squats, lunges, leg presses        → Legs
--   · with `hamstrings`  — Romanian deadlifts, good mornings  → Hamstrings
--   · with neither       — hip thrusts, glute bridges         → Glutes
--
-- The rest follow their primary muscle: triceps, biceps, brachialis and the
-- forearms to Arms; gastrocnemius and soleus to Calves; the deltoids to
-- Shoulders; pectoralis major to Chest; latissimus dorsi and trapezius to
-- Back; erector spinae to Lower back; rectus abdominis and obliques to Core;
-- hip flexors to Core, which is the one place the catalogue's own filing was
-- followed over anatomy, because it is consistent about it (93%).
--
-- ── Seven rows that KEEP "Full body", because it was right ───────────────
--
-- The rule is wrong for movements that genuinely are whole-body, and reading
-- the output is what caught them. A Turkish Get Up is not a shoulder exercise
-- because its first named muscle is a deltoid, and a Back Lever is not a lower
-- back exercise:
--
--   Kettlebell Turkish Get Ups · Bear Crawl · Back Lever · Crow Pose
--   Dumbbell Farmer's Walk · Kettlebell Farmer's Walk · Heel-to-Toe Walk
--
-- ── What is NOT touched ──────────────────────────────────────────────────
--
-- The other 53 'Full body' rows: 25 stretches, 14 cardio, 8 olympic lifts, 3
-- plyometric and 3 with no primary muscles at all (they are equipment entries
-- — 'Cable Machine'). A clean and jerk IS full body. A rowing machine is a
-- defensible 'Full body'. Nothing here improves them.
--
-- ── Reversible ───────────────────────────────────────────────────────────
--
-- Every row is named below with the group it moves to, so the whole part can
-- be undone with:
--
--   update public.exercises set muscle_group = 'Full body'
--    where name in (<the 136 names below>);
--
-- 136 rows. After this, 'Full body' holds 60.
-- ═══════════════════════════════════════════════════════════════════════════

update public.exercises e
   set muscle_group = v.grp
  from (values
    ('Barbell Overhead Extension', 'Arms'),
    ('Barbell Preacher Curl', 'Arms'),
    ('Barbell Wrist Curl', 'Arms'),
    ('Bilateral Dumbbell Wrist Curl', 'Arms'),
    ('Cable Curl', 'Arms'),
    ('Cable Hammer Curl', 'Arms'),
    ('Cable Tricep Kickback', 'Arms'),
    ('Cheat Curl', 'Arms'),
    ('Close-Grip Barbell Curl', 'Arms'),
    ('Close-Grip Bench Press', 'Arms'),
    ('Close-Grip Dumbbell Bench Press', 'Arms'),
    ('Close-Grip EZ-Bar Bench Press', 'Arms'),
    ('Close-Grip Incline Bench Press', 'Arms'),
    ('Concentration Curl', 'Arms'),
    ('Double Kettlebell Bicep Curl', 'Arms'),
    ('Dumbbell Reverse Curl', 'Arms'),
    ('Dumbbell Reverse Wrist Curl', 'Arms'),
    ('Dumbbell Skull Crusher', 'Arms'),
    ('Dumbbell Tricep Extension', 'Arms'),
    ('Dumbbell Tricep Kickback', 'Arms'),
    ('Dumbbell Wrist Curl', 'Arms'),
    ('EZ Bar Spider Curl', 'Arms'),
    ('EZ-Bar Lying Triceps Extension', 'Arms'),
    ('EZ-Bar Overhead Tricep Extension', 'Arms'),
    ('EZ-Bar Reverse Curl', 'Arms'),
    ('EZ-Bar Wrist Curl', 'Arms'),
    ('Incline Dumbbell Curl', 'Arms'),
    ('Incline Hammer Curl', 'Arms'),
    ('Kettlebell Close-Grip Floor Press', 'Arms'),
    ('Kettlebell Concentration Curl', 'Arms'),
    ('Kettlebell Hammer Curl', 'Arms'),
    ('Kettlebell Overhead Tricep Extension', 'Arms'),
    ('Kettlebell Reverse Wrist Curl', 'Arms'),
    ('Kettlebell Skull Crusher', 'Arms'),
    ('Kettlebell Wrist Curl', 'Arms'),
    ('Lying Tricep Extension', 'Arms'),
    ('Machine Preacher Curl', 'Arms'),
    ('One Arm Kettlebell Bicep Curl', 'Arms'),
    ('One-Arm Kettlebell Tricep Kickback', 'Arms'),
    ('Preacher Hammer Curl', 'Arms'),
    ('Reverse Curl', 'Arms'),
    ('Seated Dumbbell Tricep Extension', 'Arms'),
    ('Single Arm Tricep Pushdown', 'Arms'),
    ('Single-Arm Dumbbell Overhead Tricep Extension', 'Arms'),
    ('Single-Arm Hammer Curl', 'Arms'),
    ('Skull Crusher', 'Arms'),
    ('Strict Curl', 'Arms'),
    ('TRX Bicep Curl', 'Arms'),
    ('TRX Triceps Extension', 'Arms'),
    ('V-Bar Tricep Pushdown', 'Arms'),
    ('Chin Tuck Hold', 'Back'),
    ('Barbell Calf Raise', 'Calves'),
    ('Dumbbell Calf Raise', 'Calves'),
    ('Hack Squat Calf Raise', 'Calves'),
    ('Plate-Loaded Donkey Calf Raise', 'Calves'),
    ('Machine Assisted Dips', 'Chest'),
    ('L Sit', 'Core'),
    ('Banded Clamshell', 'Glutes'),
    ('Banded Fire Hydrant', 'Glutes'),
    ('Banded Glute Bridge', 'Glutes'),
    ('Banded Hip Thrust', 'Glutes'),
    ('Banded Kneeling Hip Thrust', 'Glutes'),
    ('Banded Lateral Walk', 'Glutes'),
    ('Banded Seated Hip Abduction', 'Glutes'),
    ('Banded Standing Hip Abduction', 'Glutes'),
    ('Banded Sumo Walk', 'Glutes'),
    ('Dumbbell Hip Thrust', 'Glutes'),
    ('Glute Bridge Hold', 'Glutes'),
    ('Glute Kickback Hold', 'Glutes'),
    ('High-Foot Leg Press', 'Glutes'),
    ('Kettlebell Hip Thrust', 'Glutes'),
    ('Pilates Kneeling Side Kick', 'Glutes'),
    ('Plate-Loaded Glute Drive', 'Glutes'),
    ('Reverse Tabletop Hip Pulses', 'Glutes'),
    ('Single-Leg Glute Bridge Hold', 'Glutes'),
    ('Smith Machine Hip Thrust', 'Glutes'),
    ('Stability Ball Hip Bridge', 'Glutes'),
    ('Banded Good Morning', 'Hamstrings'),
    ('Banded Romanian Deadlift', 'Hamstrings'),
    ('EZ-Bar Romanian Deadlift', 'Hamstrings'),
    ('Kettlebell Swing', 'Hamstrings'),
    ('One Arm Kettlebell Swing', 'Hamstrings'),
    ('One-Arm Dumbbell Swing', 'Hamstrings'),
    ('One-Arm Single-Leg Dumbbell Romanian Deadlift', 'Hamstrings'),
    ('One-Arm Single-Leg Kettlebell Romanian Deadlift', 'Hamstrings'),
    ('Smith Machine Good Morning', 'Hamstrings'),
    ('Warrior III', 'Hamstrings'),
    ('Banded Squat', 'Legs'),
    ('Barbell Reverse Lunge', 'Legs'),
    ('Bodyweight Reverse Lunge', 'Legs'),
    ('Chair Pose', 'Legs'),
    ('Cossack Squat', 'Legs'),
    ('Crescent Lunge', 'Legs'),
    ('Dancer Pose', 'Legs'),
    ('Dumbbell Front Squat', 'Legs'),
    ('Dumbbell Lunge', 'Legs'),
    ('Dumbbell Pistol Squat', 'Legs'),
    ('Dumbbell Somersault Squat', 'Legs'),
    ('Dumbbell Split Squat', 'Legs'),
    ('Dumbbell Squat', 'Legs'),
    ('Dumbbell Sumo Squat', 'Legs'),
    ('Eagle Pose', 'Legs'),
    ('Extended Side Angle Pose', 'Legs'),
    ('Heel-Elevated Squat', 'Legs'),
    ('Horizontal Leg Press', 'Legs'),
    ('Kettlebell Bulgarian Split Squat', 'Legs'),
    ('Kettlebell Goblet Lunge', 'Legs'),
    ('Kettlebell Lunge Press', 'Legs'),
    ('Kettlebell Offset Reverse Lunge and Press', 'Legs'),
    ('Kettlebell Reverse Lunge', 'Legs'),
    ('Kettlebell Rotational Lunge', 'Legs'),
    ('Kettlebell Sumo Deadlift', 'Legs'),
    ('Kettlebell Windmills', 'Legs'),
    ('Lunge', 'Legs'),
    ('One Arm Kettlebell Front Squat', 'Legs'),
    ('Pause Squat', 'Legs'),
    ('Pistol Squat', 'Legs'),
    ('Reverse Lunge', 'Legs'),
    ('Side Lunge', 'Legs'),
    ('Single Leg Press', 'Legs'),
    ('Smith Machine Bulgarian Split Squat', 'Legs'),
    ('Smith Machine Front Squat', 'Legs'),
    ('Smith Machine Reverse Lunge', 'Legs'),
    ('Smith Machine Split Squat', 'Legs'),
    ('Split Squat', 'Legs'),
    ('Stability Ball Wall Squat', 'Legs'),
    ('Step Ups', 'Legs'),
    ('Sumo Squat', 'Legs'),
    ('Tree Pose', 'Legs'),
    ('TRX Lunge', 'Legs'),
    ('TRX Pistol Squat', 'Legs'),
    ('TRX Squat', 'Legs'),
    ('Wall Sit', 'Legs'),
    ('Warrior I', 'Legs'),
    ('Warrior II', 'Legs'),
    ('Dumbbell Windmill', 'Shoulders')
  ) as v(nm, grp)
 where e.name = v.nm
   and e.muscle_group = 'Full body'
   and e.category = 'strength';
