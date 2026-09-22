-- ─────────────────────────────────────────────────────────────────────────
-- The catalogue a fresh database builds, and the catalogue that exists.
--
-- ═══ UNAPPLIED ═══════════════════════════════════════════════════════════
--
-- Not run against production, and it must not be run there as a fix, because
-- against production it changes NOTHING. That is the point of it. It is a
-- repair to what `supabase/setup.sql` BUILDS, and the whole of its effect
-- lands on a database that has never been seeded. Measured against production
-- on 4 Sep 2026, before it was written:
--
--     select count(*) from public.exercises
--       where source in ('free-exercise-db','repple+free-exercise-db');   → 0
--     select count(*) from public.exercises
--       where id in (…the fifteen ids deleted below…);                    → 0
--
-- Zero rows match either statement below. Applying it to production is safe
-- and pointless; NOT applying it leaves production correct.
--
-- ── What was wrong ────────────────────────────────────────────────────────
--
-- Applying parts 49, 71, 74, 75 and 76 in order to an empty database yields
-- 619 exercises. Production holds 604 seeded rows (plus 4 a coach typed, which
-- are `source = 'coach'` and are nobody's seed). The ledger was therefore wrong
-- about the largest table in the product, and wrong in a way that no count of
-- the seeds could show, because 71 and 74 were REGENERATED on 1 Sep after 75
-- and 76 were written against the generation before them.
--
-- Production ran the earlier generation of part 74, in which RepDB's own ids
-- were used verbatim: RepDB's `bench-press` is the movement it calls "Barbell
-- Bench Press", and that insert landed ON our existing `bench-press` row —
-- `on conflict (id) do update`, name deliberately not updated — so one row came
-- out of it, keyed `bench-press`, named "Bench Press", carrying RepDB's
-- description, illustration and animation. Fifteen movements went that way.
--
-- The regenerated part 74 keys every row on the slug of the name it displays,
-- so on an empty database the same fifteen movements arrive as SEPARATE rows —
-- `barbell-bench-press` beside `bench-press` — and the older row is not
-- replaced, it is merely enriched by part 71 with a free-exercise-db
-- PHOTOGRAPH. Part 75's mapping table, which exists to collapse exactly this
-- pair, names RepDB's old ids ('squat', 'ohp', 'barbell-row', …) and so matches
-- nothing any more. Five of its sixteen pairs are dead statements, and five of
-- part 76's sixteen deletes are dead with them.
--
-- The result on a fresh database is the thing part 75 was written to abolish:
-- two entries for one movement, one photographed and one illustrated, with the
-- photographed one holding the id every screen actually resolves to. A client
-- searching "bench" gets two. And the eighteen surviving free-exercise-db rows
-- are stamped 'repple+free-exercise-db' rather than 'repdb', so frameUrls()
-- resolves their images against a host this app retired.
--
-- ── What this does ────────────────────────────────────────────────────────
--
-- The same thing part 75 did, with the ids the regenerated part 74 now writes.
-- Content crosses from the RepDB row onto ours; ours keeps its NAME and its
-- muscle group; the RepDB row goes.
--
-- Ours survives and RepDB's goes for the reason it has always been: the name is
-- the identity. src/lib/machines.ts resolves a photographed gym machine to a
-- name, src/lib/focus.ts and buildProgram() in src/lib/programs.ts EMIT these
-- strings, and eleven of the fifteen appear in one of those three files. The
-- catalogue can be renamed to RepDB's more precise names later; it cannot be
-- renamed by deleting the row the code points at.
--
-- ── Row counts, exactly ───────────────────────────────────────────────────
--
--   · on production:               0 rows inserted, updated or deleted.
--   · on an empty database seeded from setup.sql:
--       15 rows updated (content copied across, stamped 'repdb'),
--        3 rows updated (source corrected to 'repple'),
--       15 rows deleted.
--       619 → 604, which is what production holds.
--
-- ── The one row this deliberately does NOT reconcile ──────────────────────
--
-- Production has `ball-leg-curl` ("Ball Leg Curl"); a fresh database gets
-- `stability-ball-leg-curl` ("Stability Ball Leg Curl"). That is one movement
-- under two vendor names, not a duplicate — RepDB renamed it between the two
-- generations. Nothing in src/lib names it, so production could take the newer
-- name safely, but that is a one-row rename of live data and it is not
-- something to write blind at night. It is the whole of the remaining
-- difference: after this part, a fresh database and production hold the same
-- 604 movements, 603 of them under the same id.
-- ─────────────────────────────────────────────────────────────────────────

-- The guard is narrow on purpose. Part 75 refused to run if ANY row referenced
-- the catalogue, which is right for a delete of 783 rows and wrong here: this
-- part must stay runnable on a database that has been live for a year, because
-- on such a database it does nothing at all. So it asks only about the fifteen
-- ids it is actually going to remove. If one of them is in a client's training
-- history, that history is the thing to preserve and this is the wrong file.
do $$
declare refs integer;
  doomed text[] := array[
    'barbell-back-squat','barbell-bench-press','bent-over-barbell-row',
    'dumbbell-bicep-curl','cable-glute-kickback','machine-chest-press',
    'barbell-deadlift','cable-face-pull','dumbbell-hammer-curl',
    'machine-hip-abduction','barbell-hip-thrust','dumbbell-lateral-raise',
    'lying-leg-curl','barbell-overhead-press','cable-tricep-pushdown'
  ];
begin
  select (select count(*) from public.exercise_videos where exercise_id = any(doomed))
       + (select count(*) from public.workout_logs   where exercise_id = any(doomed))
    into refs;
  if refs > 0 then
    raise exception
      'Refusing to collapse the duplicated movements: % rows reference one of the ids being removed. Work out which before deleting anything.', refs;
  end if;
end $$;

-- ── Content crosses; the name and the muscle group do not ─────────────────
--
-- Each pairing was read as a MOVEMENT. They are not a similarity match and
-- must not be regenerated as one: part 75 records that similarity offered Hack
-- Squat for Back Squat and Cable Hip Adduction for Hip Abduction, the opposite
-- movement. Fifteen pairs, one per row that the regenerated part 74 splits in
-- two.
with m(ours, theirs) as (values
    ('back-squat',      'barbell-back-squat'),
    ('bench-press',     'barbell-bench-press'),
    ('bent-over-row',   'bent-over-barbell-row'),
    ('bicep-curl',      'dumbbell-bicep-curl'),
    ('cable-kickback',  'cable-glute-kickback'),
    ('chest-press',     'machine-chest-press'),
    ('deadlift',        'barbell-deadlift'),
    ('face-pull',       'cable-face-pull'),
    ('hammer-curl',     'dumbbell-hammer-curl'),
    ('hip-abduction',   'machine-hip-abduction'),
    ('hip-thrust',      'barbell-hip-thrust'),
    ('lateral-raise',   'dumbbell-lateral-raise'),
    ('leg-curl',        'lying-leg-curl'),
    ('overhead-press',  'barbell-overhead-press'),
    ('tricep-pushdown', 'cable-tricep-pushdown')
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
    tips              = src.tips,
    image_paths       = src.image_paths,
    -- coalesce, not a plain copy: the demo clips are attached by
    -- scripts/sync-exercise-demos.mjs and not by any part, so on a database
    -- that already has them `src.animation_path` is null and a plain copy
    -- would take a working clip off the row it is enriching.
    animation_path    = coalesce(src.animation_path, tgt.animation_path),
    met               = src.met,
    goals             = src.goals,
    tags              = src.tags,
    -- Stamped 'repdb' so frameUrls() resolves these illustrations against the
    -- RepDB host rather than the retired one, and so the attribution covers
    -- them. This is the same stamp part 75 applied for the same reason.
    source            = 'repdb'
from m
join public.exercises src on src.id = m.theirs
where tgt.id = m.ours;

-- ── The three that are deliberately bare ──────────────────────────────────
--
-- Cable Machine, Smith Machine and Ski Erg are entries in src/lib/machines.ts,
-- the list "Scan machine" resolves a photographed machine against. RepDB
-- describes movements and not machines, so it has nothing for them, and an
-- empty description is the honest answer rather than a gap to fill. Part 71
-- stamped them 'repple+free-exercise-db' on its way past; production has them
-- as 'repple', and 'repple' is what part 71's own column comment says a
-- hand-written row untouched by any import should read.
update public.exercises
set source = 'repple'
where id in ('cable-machine','smith-machine','ski-erg')
  and source = 'repple+free-exercise-db';

-- The deletes run LAST here, unlike part 76, because the update above reads
-- these rows. Part 76 had to delete first because one of its rekey targets was
-- occupied by a row it was removing; nothing here is rekeyed, so there is no
-- such collision and the safe order is the obvious one.
delete from public.exercises
where id in (
  'barbell-back-squat','barbell-bench-press','bent-over-barbell-row',
  'dumbbell-bicep-curl','cable-glute-kickback','machine-chest-press',
  'barbell-deadlift','cable-face-pull','dumbbell-hammer-curl',
  'machine-hip-abduction','barbell-hip-thrust','dumbbell-lateral-raise',
  'lying-leg-curl','barbell-overhead-press','cable-tricep-pushdown'
);
