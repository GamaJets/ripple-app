// Which language a movement's name is shown in, and how a reader can tell.
//
// ── The thing this file exists to prevent ─────────────────────────────────
//
// The catalogue is English. A member in Berlin opens their programme and reads
// "Bent-Over Barbell Row". Once the catalogue carries German names, most rows
// will answer in German and some will not — and the ones that do not must not
// look like the ones that do. An English name sitting silently among German
// ones reads as a translation somebody made, so a reader who does not
// recognise it assumes it is a term they have not met rather than a gap, and
// a coach reviewing the German catalogue has no way to see what is still
// missing without knowing the whole thing by heart.
//
// So every name that comes out of here says which language it is in and
// whether it is a fallback. The screen renders the difference. Nothing in this
// file ever returns a blank, a key, or a bare English string that has lost the
// fact that it is English.
//
// ── One identity, several names ───────────────────────────────────────────
//
// The identity of a movement in this app is `exercises.id`, which is
// exerciseSlug() of its ENGLISH name — see src/lib/exerciseId.ts and
// supabase/parts/76-catalogue-dedupe-rekey.sql, where 68 rows keyed by anything
// else were in the catalogue and unreachable from it. A programme stores an
// exercise NAME, a workout log stores an exercise NAME, and both resolve
// through that slug.
//
// Translating therefore never touches the id and never touches
// `exercises.name`. It adds a row to `exercise_translations` keyed
// (exercise_id, locale). Everything here is display-only, and the English name
// stays the identity it always was — including in what gets written back when
// a coach picks a movement out of a translated list.
//
// Nothing in here imports react-native or supabase: it is arithmetic on
// strings and maps, and it is tested as such.

/**
 * The languages the catalogue may be translated into.
 *
 * English is deliberately NOT in this set. English is not a translation of the
 * catalogue, it IS the catalogue — it lives in `exercises.name`, it is what the
 * id is the slug of, and a second English string in a translations table would
 * be a second answer to "what is this movement called" with nothing to say
 * which one wins. supabase/parts/790 refuses `locale = 'en'` in a check
 * constraint for the same reason, and scripts/check-translations.mjs fails the
 * build on one.
 *
 * Adding a language is this array, the check constraint in part 790, and a
 * seed part. The gate fails if the first two disagree.
 */
export const TRANSLATION_LOCALES = ['de', 'es'] as const;

export type TranslationLocale = (typeof TRANSLATION_LOCALES)[number];

/** The language `exercises.name` and `exercises.description` are written in. */
export const CATALOGUE_BASE_LOCALE = 'en';

export function isTranslationLocale(x: unknown): x is TranslationLocale {
  return typeof x === 'string' && (TRANSLATION_LOCALES as readonly string[]).includes(x);
}

/**
 * The catalogue language for a BCP-47 tag, or null when we have no catalogue
 * in the reader's language and English is simply what they get.
 *
 *   'de'          → 'de'
 *   'de-AT'       → 'de'      an Austrian reads the German catalogue
 *   'es-419'      → 'es'      so does a Latin American reader
 *   'de_DE'       → 'de'      a simulator handing back the POSIX form
 *   'en-GB'       → null      English is the catalogue, not a translation
 *   'fr-FR', ''   → null
 *
 * Matched on the LANGUAGE subtag only. Regional Spanish gym vocabulary really
 * does differ — a Mexican gym says "desplante" where a Spanish one says
 * "zancada" — but shipping one Spanish and calling it Spanish is honest, where
 * shipping es-ES to an es-MX reader while claiming a regional match would not
 * be. If that distinction is ever worth making it is a new locale in
 * TRANSLATION_LOCALES ('es-MX'), not a silent widening of this one.
 *
 * The tag is not read off the device here — `appLocale()` in src/lib/locale.ts
 * is the one place that does that, and this takes its answer. Passing it in
 * keeps the rules testable against a string instead of against whichever
 * machine the test runs on.
 */
export function catalogueLocale(tag: string | null | undefined): TranslationLocale | null {
  if (tag == null) return null;
  // Underscores for the same reason normaliseLocale() in locale.ts accepts
  // them: a vendor skin or an emulator can report `de_DE`.
  const lang = String(tag).trim().replace(/_/g, '-').split('-')[0].toLowerCase();
  return isTranslationLocale(lang) ? lang : null;
}

/** One row of `public.exercise_translations`, as PostgREST hands it back. */
export interface TranslationRow {
  exerciseId: string;
  locale: string;
  name?: string | null;
  description?: string | null;
}

/** The translated strings for one movement. Either may be absent on its own:
 *  a name without a description is the common case, and a description without
 *  a name happens while a language is being filled in. */
export interface Translated {
  name: string | null;
  description: string | null;
}

const clean = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
};

/**
 * Translations for one language, keyed by exercise id.
 *
 * Rows in another locale are dropped rather than merged, because the caller
 * asked for one language and a map that quietly mixed two would show a Spanish
 * name to a German reader on whichever row happened to come back last.
 *
 * A blank or whitespace-only string is treated as ABSENT, not as a name. A
 * translation row that got saved with an empty name is a mistake in the data,
 * and the failure mode of honouring it is a movement with no name on screen —
 * the one outcome worse than showing English. The database refuses to store
 * one (part 790's check constraint); this refuses to trust it anyway.
 */
export function indexTranslations(
  rows: readonly TranslationRow[] | null | undefined,
  locale: TranslationLocale,
): Map<string, Translated> {
  const out = new Map<string, Translated>();
  for (const r of rows || []) {
    if (!r || r.locale !== locale) continue;
    const id = clean(r.exerciseId);
    if (!id) continue;
    const name = clean(r.name);
    const description = clean(r.description);
    if (name == null && description == null) continue;
    out.set(id, { name, description });
  }
  return out;
}

/** A string to put on screen, and the truth about what language it is in. */
export interface DisplayString {
  /** What to render. Never empty when the English source was not empty. */
  text: string;
  /** The language `text` is actually written in. */
  locale: string;
  /**
   * True when the reader asked for a language we do not have this string in,
   * so `text` is the English original. The screen MUST show this — see the
   * header. False when the reader's language is English, because English shown
   * to an English reader is not a fallback, it is the answer.
   */
  isFallback: boolean;
}

/**
 * The name to show for a catalogue row.
 *
 * `english` is `exercises.name` — the identity. `want` is what the reader
 * reads, or null when they read English. Falls back through exactly one step
 * and no further: there is no chain of related languages, because "close
 * enough to German" is not a thing a movement name can be.
 */
export function displayName(
  english: string,
  exerciseId: string,
  translations: ReadonlyMap<string, Translated> | null | undefined,
  want: TranslationLocale | null,
): DisplayString {
  const base = clean(english) ?? '';
  if (!want) return { text: base, locale: CATALOGUE_BASE_LOCALE, isFallback: false };
  const hit = clean(translations?.get(exerciseId)?.name ?? null);
  if (hit) return { text: hit, locale: want, isFallback: false };
  return { text: base, locale: CATALOGUE_BASE_LOCALE, isFallback: true };
}

/**
 * The description to show, or null.
 *
 * Null is a real answer here and is not the same failure as a missing name:
 * roughly a fifth of the catalogue has never had a description in any
 * language, and a screen shows nothing rather than inventing one — the rule
 * `ExerciseDetail.description` already states. So this returns null for "there
 * is no description at all" and a fallback-flagged English string for "there
 * is one, but not in your language".
 */
export function displayDescription(
  english: string | null | undefined,
  exerciseId: string,
  translations: ReadonlyMap<string, Translated> | null | undefined,
  want: TranslationLocale | null,
): DisplayString | null {
  const base = clean(english);
  if (!want) return base == null ? null : { text: base, locale: CATALOGUE_BASE_LOCALE, isFallback: false };
  const hit = clean(translations?.get(exerciseId)?.description ?? null);
  if (hit) return { text: hit, locale: want, isFallback: false };
  return base == null ? null : { text: base, locale: CATALOGUE_BASE_LOCALE, isFallback: true };
}

/**
 * The two-letter marker a list row carries beside a name that did not
 * translate. Uppercase, because it is a label and not a word — and it is the
 * whole of the mechanism that stops an English name reading as a German one in
 * a list of six hundred.
 */
export function fallbackTag(d: DisplayString): string | null {
  return d.isFallback ? d.locale.toUpperCase() : null;
}

/**
 * The sentence a DETAIL screen shows under a name that did not translate.
 *
 * A whole sentence rather than a badge, because on the screen a member reads
 * before performing a movement there is room to be plain about it, and because
 * "EN" on its own tells somebody the name is English without telling them why
 * or whether anything else on the page is affected.
 *
 * Null when nothing fell back, for the same reason `localeNote()` in
 * src/lib/locale.ts returns null on the happy path: an apology on a screen
 * where nothing is wrong is a nag.
 */
export function fallbackNote(name: DisplayString, description?: DisplayString | null): string | null {
  const both = name.isFallback && !!description?.isFallback;
  if (both) return 'This movement has not been translated yet, so its name and description are shown in English.';
  if (name.isFallback) return 'This movement has not been translated yet, so its name is shown in English.';
  if (description?.isFallback) return 'This movement has a translated name, but its description has not been translated yet and is shown in English.';
  return null;
}

/**
 * Does this row match what somebody typed into the search box?
 *
 * BOTH names, always. A German member types "Kniebeuge" and must find Back
 * Squat; a German coach who learned the movement as "Back Squat" — which is
 * most of them — types that and must find the same row. Matching only the
 * displayed name would hide half the catalogue from whichever of the two the
 * app happened to be showing, and matching only the English one would make the
 * translation cosmetic.
 *
 * Lowercased substring, exactly as every list in this app already searches. No
 * fuzziness: see videoForExercise() in exerciseId.ts for why near-misses on
 * movement names are not a kindness.
 */
export function matchesSearch(term: string, english: string, display?: DisplayString | string | null): boolean {
  const t = (term || '').trim().toLowerCase();
  if (!t) return true;
  const shown = typeof display === 'string' ? display : display?.text;
  return (english || '').toLowerCase().includes(t) || (shown || '').toLowerCase().includes(t);
}

/**
 * What is wrong with a set of translation rows, in sentences.
 *
 * Shared by the importer (scripts/import-repdb.mjs, which must refuse to write
 * a bad set) and by the gate (scripts/check-translations.mjs, which must refuse
 * to ship one). Two rules, and both of them describe a failure that is silent
 * in production:
 *
 *   · a row pointing at an exercise id that does not exist. The foreign key
 *     catches this in the database, but only when somebody applies the SQL —
 *     and a seed part that fails halfway leaves the catalogue half translated
 *     with no record of which half. Catching it in the repo fails on the commit
 *     instead.
 *
 *   · a locale outside TRANSLATION_LOCALES. Nothing reads such a row, so it
 *     does not break a screen: it sits in the table looking like the language
 *     is done. A 'de-DE' row is the shape this takes — plausible, wrong, and
 *     invisible to anyone who does not already know the rule.
 *
 * Empty array means nothing is wrong. Returns every problem rather than the
 * first, because a translation set is fixed in one pass or in three hundred.
 */
export function validateTranslations(
  rows: readonly TranslationRow[],
  knownExerciseIds: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const id = clean(r?.exerciseId) ?? '';
    const loc = clean(r?.locale) ?? '';
    if (!isTranslationLocale(loc)) {
      problems.push(
        `"${id || '(no exercise)'}" is translated into "${loc || '(nothing)'}", which is not a catalogue language. `
        + `The supported set is ${TRANSLATION_LOCALES.join(', ')} — a row in any other locale is stored, read by nothing, `
        + 'and looks from a row count like the language is finished.',
      );
    }
    if (!id) {
      problems.push('A translation row names no exercise at all, so nothing can ever resolve it.');
      continue;
    }
    if (!knownExerciseIds.has(id)) {
      problems.push(
        `"${id}" is translated into "${loc}" and there is no such exercise in the catalogue. `
        + 'The foreign key would reject this when the part is applied, half way through the seed.',
      );
    }
    const key = `${id}\u0000${loc}`;
    if (seen.has(key)) {
      problems.push(
        `"${id}" is translated into "${loc}" twice in the same set. `
        + 'The upsert would apply whichever came last, so which name ships is decided by row order.',
      );
    }
    seen.add(key);
    if (clean(r?.name) == null && clean(r?.description) == null) {
      problems.push(
        `"${id}" has a "${loc}" row that translates neither the name nor the description. `
        + 'An empty translation row is indistinguishable, on screen, from a name we failed to render.',
      );
    }
  }
  return problems;
}
