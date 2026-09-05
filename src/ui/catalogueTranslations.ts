// Reading the catalogue in the reader's own language.
//
// The rules — which language, what to show when there is no translation, and
// how a screen says so — are all in src/lib/catalogueLocale.ts and are tested
// there. This file is the two reads that fetch the rows, and one decision that
// is genuinely about the wire rather than about language.
//
// ── Why this is a SECOND query and not a PostgREST embed ──────────────────
//
// The tidy version is one request:
//
//     .select('id, name, …, exercise_translations(locale, name, description)')
//
// It is one round trip, the foreign key is there to support it, and it is what
// this file should eventually be. It is not what it is, because
// supabase/parts/790 is UNAPPLIED on every database this code will first run
// against — and PostgREST answers an embed naming a relationship it cannot find
// with a 400 on the WHOLE request. The exercise screen would go blank, in
// English, for everybody, until somebody ran the SQL. A separate query that is
// allowed to fail degrades instead to exactly the app we have today: English
// names, no marker, nothing broken.
//
// So the translation read is deliberately non-fatal. Its failure is not the
// screen's failure and does not set the screen's status — see the comments on
// each read. The cost is one extra round trip on a screen that is already doing
// one, for readers whose device is not in English.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { appLocale } from '../lib/locale';
import {
  catalogueLocale, displayName, indexTranslations,
  type DisplayString, type TranslationLocale, type Translated,
} from '../lib/catalogueLocale';
import { exerciseSlug } from '../lib/exerciseId';
import { capLimit, capped } from '../lib/rowCap';
import { useAuthRevision } from './authRevision';

/**
 * The catalogue language for this reader, or null when they read English.
 *
 * `appLocale()` is latched once per app run (see src/lib/locale.ts), so this is
 * stable and needs no state. Null is the common case and is not a failure: it
 * means the catalogue is already in the reader's language.
 */
export function useCatalogueLocale(): TranslationLocale | null {
  return useMemo(() => catalogueLocale(appLocale()), []);
}

const EMPTY: ReadonlyMap<string, Translated> = new Map();

/* ── one read per language per app run, however many screens ask ───────────
 *
 * This hook started with two callers — the library list and the catalogue
 * picker — and now has a dozen: every screen that shows a movement name reads
 * it, and app/(client)/workouts.tsx mounts it twice on its own (the plan and
 * the session runner are separate components). For a German or Spanish reader
 * that was a dozen identical requests for the same 583 rows, several of them
 * in flight at the same moment on the screen a member opens mid-set.
 *
 * So the language is cached for the process, keyed by locale AND by the auth
 * revision — the second half matters, because the read is policy-scoped `to
 * authenticated` and a run that happened while signed out came back empty with
 * no error. Caching THAT would keep the whole app in English for the life of
 * the process, which is the exact defect `authRev` was added to end. A new
 * revision is a new key, so a sign-in re-reads.
 *
 * `inFlight` is the other half: without it a screen with three of these mounts
 * fires three requests before the first resolves and caches nothing. A failed
 * read is NOT cached — it resolves to EMPTY for its own callers and the next
 * mount tries again, because "we could not reach the server" is not an answer
 * about what a movement is called.
 */
const cache = new Map<string, ReadonlyMap<string, Translated>>();
const inFlight = new Map<string, Promise<ReadonlyMap<string, Translated> | null>>();

/**
 * Every translation in the reader's language, keyed by exercise id.
 *
 * One request for the whole language rather than one per row: the library
 * lists 619 movements at once and 619 requests is not a page load. The rows are
 * an id, a locale and a short name — a few tens of kilobytes, against the
 * megabyte `instructions` would be — which is why this can be read whole where
 * the catalogue itself cannot.
 *
 * Returns an EMPTY map for an English reader without asking the server
 * anything, and an empty map when the read fails. Both mean "no translations",
 * and every name then comes out of displayName() flagged as English, which is
 * the honest thing to show and is what the app showed before this existed.
 */
export function useCatalogueTranslations(): {
  locale: TranslationLocale | null;
  byId: ReadonlyMap<string, Translated>;
  /** True once the read has either finished or been skipped. A list may render
   *  before this — it will simply show English names, marked as English — but a
   *  screen that wants to avoid the flicker of names changing under the reader
   *  can wait on it. */
  settled: boolean;
} {
  const locale = useCatalogueLocale();
  const authRev = useAuthRevision();
  const [byId, setById] = useState<ReadonlyMap<string, Translated>>(EMPTY);
  const [settled, setSettled] = useState(false);

  const load = useCallback(async () => {
    if (!locale) { setById(EMPTY); setSettled(true); return; }
    const key = `${locale}\u0000${authRev}`;
    const hit = cache.get(key);
    if (hit) { setById(hit); setSettled(true); return; }
    const running = inFlight.get(key);
    if (running) { setById((await running) ?? EMPTY); setSettled(true); return; }
    const fetching = (async (): Promise<ReadonlyMap<string, Translated> | null> => {
      try {
        const { data, error } = await supabase
          .from('exercise_translations')
          .select('exercise_id, locale, name, description')
          .eq('locale', locale)
          .limit(capLimit());
        // eslint-disable-next-line -- no-error-ok: a failure here must not take the library down.
        // Every name falls back to English AND IS MARKED as English, which is what
        // the reader saw before this read existed. Silently dropped rather than
        // reported precisely because it is not a wrong answer: nothing on screen
        // claims to be translated.
        //
        // This used to say "the table may not exist yet (part 790 is unapplied)".
        // Part 790 IS applied — `public.exercise_translations` exists on this
        // project (counted live, 3 Sep 2026). What is still true is the OUTCOME,
        // for a different reason: the table holds zero rows, because parts 791
        // (German) and 792 (Spanish) have not been loaded. So this read succeeds
        // and returns nothing, `byId` is empty, and every name renders as English
        // and says so — the same screen, reached down a healthy path rather than
        // an errored one. The 42P01 branch is kept for a deployment without 790.
        if (error) return null;
        const page = capped(data);
        return indexTranslations(
          page.rows.map((r: any) => ({
            exerciseId: r.exercise_id, locale: r.locale, name: r.name, description: r.description,
          })),
          locale,
        );
      } catch {
        return null;
      }
    })();
    inFlight.set(key, fetching);
    let got: ReadonlyMap<string, Translated> | null = null;
    try { got = await fetching; } finally { inFlight.delete(key); }
    if (got) cache.set(key, got);
    setById(got ?? EMPTY);
    setSettled(true);
    // Re-armed on sign-in for the same reason useExerciseCatalogue is: the read
    // policy is `to authenticated`, providers mount before the session is
    // restored, and a run that happened while signed out comes back empty with
    // no error. Without this the whole app would stay in English for the life of
    // the process however long the member was signed in.
  }, [locale, authRev]);

  useEffect(() => { void load(); }, [load]);
  return { locale, byId, settled };
}

/**
 * The translation for ONE movement, for the detail screen.
 *
 * A row rather than the language: the detail screen already refuses to load the
 * whole catalogue to show one movement, and the same argument applies here.
 * Null id (no movement) skips the read entirely.
 */
export function useExerciseTranslation(exerciseId: string | null | undefined): {
  locale: TranslationLocale | null;
  byId: ReadonlyMap<string, Translated>;
} {
  const locale = useCatalogueLocale();
  const [byId, setById] = useState<ReadonlyMap<string, Translated>>(EMPTY);
  const id = exerciseId || '';

  useEffect(() => {
    let cancelled = false;
    // Cleared before the fetch, not after it: without this, tapping from one
    // movement to another shows the previous movement's German name over the
    // new one's English fallback for as long as the request takes.
    setById(EMPTY);
    if (!locale || !id) return () => { cancelled = true; };
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('exercise_translations')
          .select('exercise_id, locale, name, description')
          .eq('exercise_id', id)
          .eq('locale', locale)
          .maybeSingle();
        // eslint-disable-next-line -- no-error-ok: same as the list read above. An unreachable or absent translations
        // table must leave the exercise screen working in English rather than
        // failing, and the English it then shows is marked as English.
        if (cancelled || error || !data) return;
        setById(indexTranslations(
          [{ exerciseId: (data as any).exercise_id, locale: (data as any).locale, name: (data as any).name, description: (data as any).description }],
          locale,
        ));
      } catch {
        /* same as above: English, marked as English. */
      }
    })();
    return () => { cancelled = true; };
  }, [id, locale]);

  return { locale, byId };
}

/**
 * Translating a movement name that arrived as a NAME rather than as a row.
 *
 * ── the gap this closes ───────────────────────────────────────────────────
 *
 * `useExerciseCatalogue` hands every row a `.display`, and the two library
 * screens use it. Nothing else could: the screens a member actually trains
 * from do not hold catalogue rows at all. A workout log row carries an
 * `exercise` COLUMN — a string — and a programme day carries a
 * `ProgramExercise.name` frozen into the template JSON when the coach built
 * it. Both are the English name, because the English name is the identity
 * (see src/lib/catalogueLocale.ts), and both were rendered raw.
 *
 * The consequence was not subtle. A German member opened Library and read
 * "Kniebeuge mit Langhantel"; they then opened the workout they were about to
 * do, and the same movement said "Barbell Back Squat" — the app translating
 * the catalogue it browses and not the one it trains from. Their history,
 * their records and their trends said the English name too.
 *
 * ── how a name becomes an id ──────────────────────────────────────────────
 *
 * `exerciseSlug()`, which is exactly how every other screen in this app
 * resolves a stored name back to a catalogue row — it is what
 * `exercises.id` IS. So a name that is in the catalogue translates, and a
 * name a coach typed by hand does not resolve to any row and comes back as
 * itself, flagged as a fallback. That flag is honest and the caller decides
 * whether to render it: a list of six hundred catalogue rows marks them (see
 * `fallbackTag`), and a programme of eight movements a coach chose does not
 * need a badge on every line.
 *
 * ── one read, not one per row ─────────────────────────────────────────────
 *
 * Backed by `useCatalogueTranslations`, so a screen showing forty movements
 * asks the server once. An English reader asks nothing and gets a function
 * that hands every name straight back.
 */
export function useMovementName(): {
  /** The name to show, and the truth about which language it is in. */
  nameOf: (english: string | null | undefined) => DisplayString;
  /** Just the text, for the many sites that only render a string. */
  textOf: (english: string | null | undefined) => string;
  locale: TranslationLocale | null;
  settled: boolean;
} {
  const { locale, byId, settled } = useCatalogueTranslations();
  const nameOf = useCallback(
    (english: string | null | undefined): DisplayString => {
      const base = String(english ?? '');
      return displayName(base, exerciseSlug(base), byId, locale);
    },
    [byId, locale],
  );
  const textOf = useCallback((english: string | null | undefined) => nameOf(english).text, [nameOf]);
  return { nameOf, textOf, locale, settled };
}
