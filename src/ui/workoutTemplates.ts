// Reading the platform's fifteen programmes, and the names of the movements
// they name.
//
// The rules — how a row is parsed, which language a string is shown in, what
// may be counted and what must never be computed — are all in
// src/lib/workoutTemplates.ts and are tested there. This file is the two reads,
// and the three decisions that are genuinely about the wire.
//
// ── 1 · why the whole table, days and all ─────────────────────────────────
//
// src/ui/exerciseDetail.ts refuses to hold the exercise catalogue and argues
// the case at length: 608 rows carrying `instructions` is roughly a megabyte,
// spent to render twelve lines about one lift. The opposite is true here.
// `workout_templates` is FIFTEEN rows and the whole of `days` across all of
// them is 126 exercise references — a few tens of kilobytes, checked against
// the live table. Splitting that into a list read and a detail read would cost
// a round trip on every tap to save nothing, and would put the browse list and
// the opened programme on two different reads that can disagree.
//
// ── 2 · why the movement NAMES are a second read ──────────────────────────
//
// `days` carries `exercise_id` and nothing else — 'back-squat' — because that
// is the identity and a name frozen into the jsonb would be a second answer to
// what a movement is called, drifting from `exercises.name` the moment either
// changed. So the names come out of `exercises`, and they have to: an id
// cannot be turned back into a name by hand. 'incline-push-up' un-slugs to
// "Incline Push Up" and the row is called "Incline Push-Up", so a screen that
// guessed would send a member to an exercise page that resolves to nothing.
//
// It is ONE read of 57 distinct ids across all fifteen programmes — read once
// for the whole screen rather than per opened programme, so opening a second
// one costs nothing. `readByIds` chunks it and finishes it, so this read is
// never a prefix: it is whole or it failed. See src/lib/idLookup.ts.
//
// ── 3 · why the signed-out case is asked about ────────────────────────────
//
// `wt_read` is `for select to authenticated using (true)`. A signed-out session
// is therefore handed ZERO ROWS AND NO ERROR — PostgREST filters them away and
// reports success — which is indistinguishable at the call site from a table
// that is genuinely empty. The screens above this would then say "there are no
// programmes" about fifteen that exist. Same guard, same reasoning and very
// nearly the same code as useExerciseCatalogue; the duplication is deliberate,
// because the alternative is one screen quietly inheriting the other's idea of
// what an empty answer means.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { reportError } from '../lib/reportError';
import { capLimit, capped } from '../lib/rowCap';
import { readByIds } from '../lib/idLookup';
import { useAuthRevision } from './authRevision';
import { useCatalogueLocale } from './catalogueTranslations';
import { parseTemplateRow, exerciseIdsIn, type WorkoutTemplate } from '../lib/workoutTemplates';
import type { TranslationLocale } from '../lib/catalogueLocale';
import type { LoadStatus } from './loadStatus';

/** The columns the screens need. Every one of them, and no `days` twice. */
const COLUMNS =
  'id, source, goal, difficulty, frequency_per_week, tags, days, '
  + 'name_en, name_de, name_es, description_en, description_de, description_es';

/**
 * Whether anybody is signed in.
 *
 * Lifted, deliberately verbatim, from src/ui/exerciseDetail.ts — the read
 * policy is the same shape and so is the trap. A storage hiccup answers "yes",
 * so the empty result is worded as an ordinary empty rather than as an
 * accusation that the reader is signed out.
 *
 * Cheap: the session comes from local storage, not the network.
 */
async function signedIn(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return !!data.session;
  } catch {
    return true;
  }
}

export interface WorkoutTemplatesRead {
  templates: WorkoutTemplate[];
  status: LoadStatus;
  /** True when an empty list is a permissions answer rather than a real one. */
  signedOut: boolean;
  /**
   * Rows that came back and could not be turned into a programme at all — no
   * id, or no English name. Zero on every read of the live table, and carried
   * because a list quietly one programme short is a list nobody can audit.
   */
  unreadableRows: number;
  /** The reader's catalogue language, or null when they read English. */
  locale: TranslationLocale | null;
  reload: () => void;
}

/**
 * Every platform programme, in the order a member should meet them.
 *
 * Ordered by `goal` then `id`, and the second half is the part that matters:
 * `.order('goal')` alone is not a total order — five goals over fifteen rows
 * ties four times — and a capped read under a tie-breaking-free order is a
 * non-deterministic prefix (src/lib/rowCap.ts). `id` is the primary key, so
 * the pair cannot tie.
 *
 * Capped at `capLimit()` like every other list read here. Fifteen rows against
 * a cap of a thousand will not truncate today; it is asked for honestly anyway,
 * because the alternative is a read that starts lying on the day somebody
 * imports a second catalogue and nothing anywhere has cause to doubt it.
 */
export function useWorkoutTemplates(): WorkoutTemplatesRead {
  const authRev = useAuthRevision();
  const locale = useCatalogueLocale();
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [signedOut, setSignedOut] = useState(false);
  const [unreadableRows, setUnreadable] = useState(0);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const { data, error } = await supabase
        .from('workout_templates')
        .select(COLUMNS)
        .order('goal', { ascending: true })
        .order('id', { ascending: true })
        .limit(capLimit());
      if (error) {
        reportError('workoutTemplates.read', error);
        setStatus('error');
        return;
      }
      const page = capped(data);
      // Cleared as well as set. A flag left standing from the read that
      // happened before sign-in would keep telling a signed-in member to sign
      // in, over fifteen programmes that are on the screen.
      setSignedOut(page.rows.length ? false : !(await signedIn()));
      const parsed: WorkoutTemplate[] = [];
      let dropped = 0;
      for (const raw of page.rows) {
        const t = parseTemplateRow(raw);
        if (t) parsed.push(t); else dropped++;
      }
      setTemplates(parsed);
      setUnreadable(dropped);
      setStatus(page.truncated ? 'partial' : 'ready');
    } catch (e) {
      reportError('workoutTemplates.read', e);
      setStatus('error');
    }
    // Re-armed on sign-in, for the reason in this file's header: the providers
    // mount BEFORE the session is restored, so the one run an empty dependency
    // array allows happens while signed out, comes back with nought rows and no
    // error, and `load` never changes identity again. The list would then stay
    // empty for the life of the app however long the member was signed in.
  }, [authRev]);

  useEffect(() => { void load(); }, [load]);

  return { templates, status, signedOut, unreadableRows, locale, reload: load };
}

export interface MovementNames {
  /** English catalogue name by exercise id. The identity, not the display
   *  string — `useMovementName()` turns it into the reader's language, and it
   *  is what the exercise screen must be opened with. */
  byId: ReadonlyMap<string, string>;
  status: LoadStatus;
  /**
   * Ids that were asked for and did not come back.
   *
   * Only meaningful under 'ready'. A trigger on `workout_templates` refuses a
   * programme naming a movement the catalogue does not have, so under a whole
   * read this is empty in practice — and it is carried rather than assumed,
   * because "the database guarantees it" is a statement about the database and
   * not about the read.
   */
  missing: string[];
  /** Ask again. A pull-to-refresh has to be able to retry THIS read: the ids
   *  do not change when the programmes are re-read, so an effect keyed on them
   *  would never re-run and a failed name read would stay failed for the life
   *  of the screen. */
  reload: () => void;
}

const NO_NAMES: ReadonlyMap<string, string> = new Map();

/**
 * The catalogue name for each of a set of exercise ids.
 *
 * Never 'partial': `readByIds` pages every chunk to the end, so the answer is
 * the whole set or a thrown error. That is the right trade here — the set is
 * bounded by the programmes on screen and a prefix would render half the rows
 * of a workout with no name, which looks like a programme with holes in it
 * rather than like a read that came back short.
 *
 * `.order('id')` is total on a primary key, which is the contract `readByIds`
 * requires. `.limit()` is deliberately absent: `readAll` supplies the window.
 */
export function useMovementNames(ids: readonly string[]): MovementNames {
  const authRev = useAuthRevision();
  const [byId, setById] = useState<ReadonlyMap<string, string>>(NO_NAMES);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [rev, setRev] = useState(0);
  const reload = useCallback(() => setRev((r) => r + 1), []);
  // The ids as one string, so the effect below re-runs when the SET changes and
  // not when the array identity does. Every caller builds this list inside a
  // memo over a read that lands asynchronously, so the array is new on the
  // render the templates arrive and new again on every render after it.
  const key = ids.join(',');

  useEffect(() => {
    let cancelled = false;
    if (!ids.length) {
      // No ids is not a failed read and not an unfinished one. There is nothing
      // to ask for, and 'ready' with an empty map is the honest answer — a
      // screen left on 'loading' here would sit under a spinner for ever.
      setById(NO_NAMES);
      setStatus('ready');
      return () => { cancelled = true; };
    }
    setStatus('loading');
    void (async () => {
      try {
        const rows = await readByIds<{ id: string; name: string }>(
          ids,
          (chunk, from, to) => supabase
            .from('exercises')
            .select('id, name')
            .in('id', chunk)
            .order('id', { ascending: true })
            .range(from, to),
          'the movements in these programmes',
        );
        if (cancelled) return;
        const map = new Map<string, string>();
        for (const r of rows) {
          if (r && typeof r.id === 'string' && typeof r.name === 'string' && r.name.trim()) {
            map.set(r.id, r.name);
          }
        }
        setById(map);
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        reportError('workoutTemplates.movements', e);
        // The map is NOT cleared. Whatever landed before the failure is real,
        // and 'error' is what tells the screen that it is not confirmed to be
        // all of it. Blanking it would turn a partial answer into a blank one.
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
    // `key`, not `ids` — see above. `authRev` because `exercises` is read under
    // a `to authenticated` policy too, and a run that happened before the
    // session was restored comes back empty with no error.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, authRev, rev]);

  const missing = useMemo(
    () => (status === 'ready' ? ids.filter((id) => !byId.has(id)) : []),
    [status, ids, byId],
  );

  return { byId, status, missing, reload };
}

/**
 * The two reads a programme screen needs, taken together.
 *
 * One hook rather than two at every call site, because the second read's
 * argument is derived from the first one's answer and getting that wrong — a
 * fresh array every render — is a request loop rather than a bug you can see.
 * The ids are memoised on the templates that produced them.
 */
export function useProgrammeLibrary(): WorkoutTemplatesRead & { movements: MovementNames } {
  const read = useWorkoutTemplates();
  const ids = useMemo(() => exerciseIdsIn(read.templates), [read.templates]);
  const movements = useMovementNames(ids);
  return { ...read, movements };
}
