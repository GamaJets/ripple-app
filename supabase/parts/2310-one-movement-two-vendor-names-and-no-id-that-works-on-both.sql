-- ─────────────────────────────────────────────────────────────────────────
-- The one movement whose German and Spanish names cannot be written down.
--
-- ═══ UNAPPLIED ═══════════════════════════════════════════════════════════
--
-- Not run against production. It writes two rows there when it is.
--
-- ── The problem ───────────────────────────────────────────────────────────
--
-- Parts 791 and 792 carried a translation for 'stability-ball-leg-curl'. That
-- id does not exist in production, which holds the same movement as
-- 'ball-leg-curl' ("Ball Leg Curl"). It is not a duplicate and not a typo:
-- RepDB renamed the movement between the generation of part 74 that production
-- seeded and the generation on disk now, and part 2260 says at length why that
-- one row was deliberately left unreconciled — renaming live catalogue data is
-- not a thing to do blind at night.
--
-- The consequence is narrow and awkward. `exercise_translations.exercise_id` is
-- a foreign key, and the two databases disagree about which id this movement
-- has:
--
--   · production seeds 'ball-leg-curl'            — 'stability-ball-leg-curl' FKs.
--   · a fresh setup.sql seeds 'stability-ball-leg-curl' — 'ball-leg-curl' FKs.
--
-- So there is no literal id that parts 791 and 792 could carry which applies on
-- both, and a row that names either one breaks the other. Both files therefore
-- dropped it, and it is written here instead — by LOOKING THE MOVEMENT UP
-- rather than by naming it. Whichever of the two ids the database actually
-- holds is the one that gets the row; the other matches nothing and writes
-- nothing.
--
-- ── Why it is numbered here and not beside 791 ────────────────────────────
--
-- Because part 2260 has to have run first. On a fresh database the catalogue is
-- not settled until 2260 collapses the fifteen split movements, and this part
-- reads the catalogue to decide what to write. Anything that reads
-- public.exercises to make a decision belongs after the last part that changes
-- it. 2310 > 2260 in the numeric sort scripts/build-supabase-setup.mjs applies.
--
-- ── Row counts, exactly ───────────────────────────────────────────────────
--
--   · on production:                     2 rows inserted, against 'ball-leg-curl'.
--   · on an empty database from setup.sql: 2 rows, against 'stability-ball-leg-curl'.
--   · on a database that somehow holds both: 4 rows, all of them the same two
--     names against the same movement under both of its vendor ids. Harmless,
--     and it is not a state any part produces.
--
-- Re-running is free, as in parts 791 and 792: the primary key is
-- (exercise_id, locale) and the conflict clause updates.
--
-- ── The names ─────────────────────────────────────────────────────────────
--
-- Unchanged from the rows parts 791 and 792 carried on 2 Sep. A leg curl
-- performed with the heels on a gym ball: "Beinbeuger am Gymnastikball" is what
-- part 791 uses for Beinbeuger throughout ('leg-curl' is Beinbeuger, 'seated-
-- leg-curl' is Sitzender Beinbeuger), and Gymnastikball is the German gym word
-- for the ball. Spanish takes "Curl femoral con fitball" — curl femoral is what
-- part 792 uses for every leg curl, and fitball is what Spanish gyms call the
-- ball; "pelota de estabilidad" is a translation of the English and is not said.
--
-- If production is ever renamed onto the newer RepDB name, this part keeps
-- working untouched — that is the point of writing it as a lookup. What would
-- then be worth doing is folding the row back into 791 and 792 where the rest
-- of the language lives, and deleting this file.
-- ─────────────────────────────────────────────────────────────────────────

with target as (
  -- Exactly one of these exists on any database this runs against.
  select id
    from public.exercises
   where id in ('ball-leg-curl', 'stability-ball-leg-curl')
),
translated as (
  select id as exercise_id, 'de'::text as locale, 'Beinbeuger am Gymnastikball'::text as name
    from target
  union all
  select id, 'es'::text, 'Curl femoral con fitball'::text
    from target
)
insert into public.exercise_translations (exercise_id, locale, name)
select exercise_id, locale, name
  from translated
on conflict (exercise_id, locale) do update
  set name       = excluded.name,
      source     = excluded.source,
      updated_at = now();
