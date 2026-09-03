-- ─────────────────────────────────────────────────────────────────────────
-- A movement has ONE identity and several names.
--
-- The catalogue is 619 movements and it is English. A member whose phone is in
-- German reads "Bent-Over Barbell Row" in a programme their coach wrote for
-- them, and a member whose phone is in Spanish reads the same. This part is
-- where the other two names live.
--
-- ── A table, not a column, and the reason is the id ───────────────────────
--
-- The obvious shape is `name_de` and `name_es` on `public.exercises`. It was
-- rejected, and not on taste:
--
--   · The id IS the English name. `exercises.id` is exerciseSlug(name) and
--     nothing else — supabase/parts/76 exists because 68 rows were keyed by a
--     vendor id instead, and those rows listed in the picker, showed an
--     illustration, and answered "not in our catalogue" when tapped. Programs
--     store an exercise NAME; workout_logs store an exercise NAME; machines.ts
--     resolves a photographed machine to a NAME. Every one of those resolves
--     through the English string. A language must therefore be a thing that
--     hangs OFF the identity, and the shape that says so is a child table
--     keyed (exercise_id, locale). A column beside `name` invites exactly the
--     mistake part 76 spent a migration undoing: somebody re-keying a row on
--     the German name because the German name is right there.
--
--   · A missing translation must be visibly missing. With a column, "not
--     translated" is a NULL sitting next to 618 other NULLs and nothing
--     distinguishes it from "translated to the empty string" or from a column
--     that was never filled. With a row, absence is the absence of a row —
--     countable, joinable, and reportable ("412 of 619 in German") without
--     scanning a wide table for nulls. src/lib/catalogueLocale.ts turns that
--     absence into a FLAG on the string it returns, and the screens mark it.
--     See its header.
--
--   · A third language is a seed part, not a schema migration. `name_fr`,
--     `desc_fr`, and every select in the app that lists its columns — that is
--     an ALTER TABLE and a code change per language. Here it is one row per
--     movement and one entry in TRANSLATION_LOCALES.
--
--   · Re-running is free. The primary key is (exercise_id, locale), so the
--     importer upserts: load a language, correct twelve names, load it again,
--     and there is still one row per movement per language. A column-shaped
--     version has the same property but only for the whole row at once, so a
--     partial German re-run would have to read-modify-write `exercises` and
--     could clobber `description`, `tips` or `image_paths` on the way past.
--
-- ── English is not in this table ──────────────────────────────────────────
--
-- There is no 'en' row and the check constraint refuses one. English is not a
-- translation of the catalogue, it IS the catalogue: it lives in
-- `exercises.name`, the id is the slug of it, and everything the app stores
-- points at it. A second English string here would be a second answer to "what
-- is this movement called" with nothing in the schema to say which wins — and
-- the one that wins on screen would not be the one the id was built from.
-- scripts/check-translations.mjs fails the build on an 'en' row for the same
-- reason, so the rule is stated in three places and enforced in two.
--
-- ── Nothing here is writable through the API ──────────────────────────────
--
-- `exercises` grants INSERT to trainers and owners, because a coach's custom
-- movement mints a catalogue row. Translations have no such path: they are
-- seeded by these parts and by scripts/import-repdb.mjs, both of which run
-- with the service key. So SELECT to authenticated and nothing else. A coach
-- typing their own German name for Back Squat into a shared catalogue is not a
-- feature anybody asked for, and it is one that would reach every gym on the
-- platform.
--
-- ── APPLYING THIS IS NOT REQUIRED FOR THE APP TO KEEP WORKING ─────────────
--
-- The read path (src/ui/exerciseDetail.ts) asks for translations in a SECOND
-- query rather than as a PostgREST embed. An embed is one round trip and would
-- have been the tidier code, but `exercises?select=...,exercise_translations(...)`
-- against a database where this part has not been applied is a 400 on the whole
-- request — so the exercise screen would go blank for everyone, in English,
-- until somebody ran the SQL. A separate query that is allowed to fail degrades
-- to exactly what the app does today.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.exercise_translations (
  -- The English identity. ON DELETE CASCADE because a translation of a
  -- movement that no longer exists is not a thing to keep: parts 75 and 76 both
  -- retire rows, and a widowed translation would be invisible to every screen
  -- and would still make the "how much is translated" count wrong.
  exercise_id text not null references public.exercises(id) on delete cascade,

  -- The language subtag alone — 'de', not 'de-DE'. src/lib/catalogueLocale.ts
  -- resolves the reader's tag down to this, so an Austrian handset ('de-AT')
  -- and a German one land on the same row. Regional variants are a real thing
  -- in Spanish gym vocabulary, and if one is ever worth shipping it arrives as
  -- its own locale here and in TRANSLATION_LOCALES — never as a silent widening
  -- of 'es'.
  locale text not null,

  -- The name as lifters in that language actually say it. Nullable, because a
  -- row may carry a translated description while its name is still being
  -- decided — but never blank: see the constraint below.
  name text,

  -- One sentence saying what the movement IS, matching `exercises.description`.
  -- Null on the great many rows where only the name is translated.
  description text,

  -- Where this string came from, stamped for the same reason `exercises.source`
  -- is: a name somebody hand-wrote and a name a vendor pack supplied are not
  -- equally trustworthy, and six months from now nothing else in the row will
  -- say which this was.
  source text not null default 'repple',

  updated_at timestamptz not null default now(),

  primary key (exercise_id, locale)
);

-- The supported set, in the database as well as in TypeScript.
--
-- A 'de-DE' or 'en' row breaks nothing at read time — it is simply never read,
-- which is precisely the problem: the table grows rows that look, to a count,
-- like the language is finished. The constraint makes the write fail instead.
-- Dropped and re-added rather than `add constraint if not exists` so that
-- adding a language actually changes an existing database.
alter table public.exercise_translations drop constraint if exists exercise_translations_locale_chk;
alter table public.exercise_translations add constraint exercise_translations_locale_chk
  check (locale in ('de', 'es'));

-- A blank is worse than English.
--
-- If `name` is the empty string the reader gets a row with no name at all, on a
-- screen they are about to train from. Absence is expressed by a NULL or by no
-- row; it is never expressed by ''. indexTranslations() in
-- src/lib/catalogueLocale.ts refuses a whitespace-only name too, because a
-- constraint protects what is written here and not what arrives from anywhere
-- else.
alter table public.exercise_translations drop constraint if exists exercise_translations_blank_chk;
alter table public.exercise_translations add constraint exercise_translations_blank_chk
  check (
    (name is null or btrim(name) <> '')
    and (description is null or btrim(description) <> '')
    and (name is not null or description is not null)
  );

-- The catalogue read is "every translation in ONE language" — 619 short rows
-- for the library list. Locale-leading, because that is the filter; the primary
-- key already serves the detail screen's (exercise_id, locale) lookup.
create index if not exists idx_exercise_translations_locale
  on public.exercise_translations(locale);

comment on table public.exercise_translations is
  'Display names and descriptions for public.exercises in a language other than English. Never the identity: exercises.id is exerciseSlug(exercises.name) and stays so. A movement with no row here is shown in English AND MARKED AS ENGLISH — see src/lib/catalogueLocale.ts.';
comment on column public.exercise_translations.locale is
  'Language subtag only: de, es. English is not a translation and is refused — it is exercises.name.';
comment on column public.exercise_translations.name is
  'The movement as lifters in that language say it, not a literal rendering. Null where nobody was sure; the screen then shows English and says it is English, which is safe. A wrong movement name in a programme is a person doing the wrong exercise.';

alter table public.exercise_translations enable row level security;

-- Same reasoning as exercises_read in part 49: a catalogue is only useful if
-- everybody resolves the same movement to the same name, and there is nothing
-- private in a translation of "Back Squat".
drop policy if exists exercise_translations_read on public.exercise_translations;
create policy exercise_translations_read on public.exercise_translations for select
  to authenticated using (true);

-- No write policy at all, deliberately — see the header. The seed parts and
-- scripts/import-repdb.mjs write with the service key, which bypasses RLS.
revoke all on public.exercise_translations from anon, authenticated, public;
grant select on public.exercise_translations to authenticated;
grant all on public.exercise_translations to service_role;
