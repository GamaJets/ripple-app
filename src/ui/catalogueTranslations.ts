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
  catalogueLocale, indexTranslations, type TranslationLocale, type Translated,
} from '../lib/catalogueLocale';
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
    try {
      const { data, error } = await supabase
        .from('exercise_translations')
        .select('exercise_id, locale, name, description')
        .eq('locale', locale)
        .limit(capLimit());
      // eslint-disable-next-line -- no-error-ok: the table may not exist yet (part 790 is unapplied), and a failure here must not
      // take the library down. Every name falls back to English AND IS MARKED as
      // English, which is what the reader saw before this read existed. Silently
      // dropped rather than reported precisely because it is not a wrong answer:
      // nothing on screen claims to be translated.
      if (error) { setById(EMPTY); setSettled(true); return; }
      const page = capped(data);
      setById(indexTranslations(
        page.rows.map((r: any) => ({
          exerciseId: r.exercise_id, locale: r.locale, name: r.name, description: r.description,
        })),
        locale,
      ));
      setSettled(true);
    } catch {
      setById(EMPTY);
      setSettled(true);
    }
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
