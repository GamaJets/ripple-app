// One exercise's full catalogue entry, read on demand.
//
// Deliberately not a provider holding all 608 rows. The catalogue carries
// instructions for nearly every movement, so loading it whole to show one
// screen would pull roughly a megabyte to render a page about a single lift —
// on a phone, on mobile data, to display twelve lines of text.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { exerciseSlug } from '../lib/exerciseId';
import { reportError } from '../lib/reportError';
import { sessionUid } from '../lib/sessionUid';
import { capLimit, capped } from '../lib/rowCap';
import { catalogueMet } from '../lib/exerciseMet';
import { useAuthRevision } from './authRevision';
import { useCatalogueTranslations, useExerciseTranslation } from './catalogueTranslations';
import { displayName, displayDescription, fallbackNote, type DisplayString } from '../lib/catalogueLocale';
import type { LoadStatus } from './loadStatus';

export interface ExerciseDetail {
  id: string;
  name: string;
  group: string | null;
  isCardio: boolean;
  /** One sentence saying what the movement IS — not how to do it, which is
   *  `instructions`. Null on every row that predates the RepDB catalogue, and a
   *  screen must then say nothing rather than fill the space. */
  description: string | null;
  category: string | null;
  equipment: string | null;
  level: string | null;
  mechanic: string | null;
  force: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  /** Coaching cues — what to watch while doing it, not the ordered steps. */
  tips: string[];
  goals: string[];
  tags: string[];
  imagePaths: string[];
  /** Storage key in the exercise-demos bucket, or null. A path, never a URL. */
  animationPath: string | null;
  /** A picture of the KIT, for the few rows that name a machine rather than a
   *  movement and so have no illustration of one. Never rendered as a
   *  demonstration — see supabase/parts/80-equipment-icon.sql. */
  equipmentIconPath: string | null;
  /** 'commercial' once bought, 'evaluation' for a CC BY-NC preview, null when
   *  there is no animation. An evaluation asset must never reach a release. */
  demoLicence: string | null;
  source: string | null;
  /**
   * How hard the catalogue rates the movement in multiples of rest — the input
   * a calorie estimate for THIS movement needs, rather than for the session
   * kind it happens to resemble.
   *
   * Populated on 601 of 608 rows and read by nothing until now: the select
   * below did not name the column. Null on the rest, and null is a GAP —
   * `src/lib/exerciseMet.ts` turns it into no figure at all rather than into
   * the nearest literal from Train's picker, which is a MET about a different
   * question. Read through `catalogueMet` rather than cast, because the column
   * is `numeric(4,1)` and a Postgres numeric can arrive as a string.
   */
  met: number | null;
}

const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];

/**
 * The catalogue row for an exercise NAME.
 *
 * Keyed by slug rather than by the name itself, because the name reaching this
 * hook comes from a program a coach typed — 'Bent-Over Row' and 'Bent-over Row'
 * are the same movement and must not be two different answers.
 *
 * Four outcomes, kept apart: loading, an error (we could not ask), ready with a
 * row, and ready with NOTHING — which is a real answer meaning the movement is
 * not in the catalogue. A coach can type any exercise they like, and one they
 * invented this morning has no row. That must read as "we have no guide for
 * this" and never as a failure.
 */

/**
 * Whether anybody is signed in.
 *
 * The catalogue's read policy is `to authenticated`, so a signed-out session
 * gets an EMPTY RESULT rather than an error — PostgREST filters the rows away
 * and reports success. That is indistinguishable, at the call site, from a
 * movement genuinely not being in the catalogue, and the difference matters.
 * The demo entry point that first exposed this is gone — it signed nobody in,
 * so the app told people "this movement has no catalogue entry" about Back
 * Squat, which has one. The guard stays because the condition outlived the
 * demo: a session that expired mid-use, or a screen reached before sign-in,
 * produces the same empty result. A false statement about our own data is
 * worse than an admission that we could not look.
 *
 * Cheap: the session is read from local storage, not the network.
 *
 * ── and the one case `!data.session` got wrong ────────────────────────────
 *
 * This was `const { data } = await supabase.auth.getSession(); return
 * !!data.session`, with the `error` beside it discarded — and `getSession()`
 * does go to the network, for the one thing it cannot answer from storage:
 * refreshing an access token that has actually expired. When that refresh
 * cannot reach the server it RESOLVES with `session: null` and a retryable
 * error, which is the identical shape as somebody who has never signed in. So
 * a member on a train, holding a perfectly good account, was told to sign in
 * to see a movement the catalogue has had all along — and the `catch` below,
 * which had already decided that "could not tell" must not blame the person,
 * never ran, because the library does not throw on that path.
 *
 * Now told apart by `fate` and never by the absent session. Only a credential
 * that was looked at and refused — or that was never there — is a sign-out;
 * anything unreadable takes the gentler answer the `catch` already chose, so
 * an empty result is worded as an ordinary empty. src/lib/authReadFate.ts
 * carries the discrimination and the argument for its direction.
 */
async function signedIn(): Promise<boolean> {
  // Never throws, so there is no catch to write: `sessionUid` answers
  // 'unreadable' for a rejection, which is what a rejection is.
  const who = await sessionUid('exerciseDetail.signedIn');
  return who.fate !== 'signed-out';
}

export function useExerciseDetail(name: string | null | undefined) {
  const [detail, setDetail] = useState<ExerciseDetail | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  /** True when the empty result is because nobody is signed in, not because
   *  the movement is absent. */
  const [signedOut, setSignedOut] = useState(false);
  const id = exerciseSlug(name || '');

  const load = useCallback(async () => {
    if (!id) { setDetail(null); setStatus('ready'); return; }
    setStatus('loading');
    try {
      const { data, error } = await supabase
        .from('exercises')
        .select('id, name, muscle_group, is_cardio, description, category, equipment, level, mechanic, force, met, primary_muscles, secondary_muscles, instructions, tips, goals, tags, image_paths, animation_path, equipment_icon_path, demo_licence, source')
        .eq('id', id)
        .maybeSingle();
      if (error) { reportError('exerciseDetail.read', error, { id }); setDetail(null); setStatus('error'); return; }
      if (!data) {
        // No row. Before calling that a real answer, check we were allowed to
        // look — see signedIn() above.
        setDetail(null);
        setSignedOut(!(await signedIn()));
        setStatus('ready');
        return;
      }
      setDetail({
        id: data.id,
        name: data.name,
        group: data.muscle_group ?? null,
        isCardio: !!data.is_cardio,
        description: data.description ?? null,
        category: data.category ?? null,
        equipment: data.equipment ?? null,
        level: data.level ?? null,
        mechanic: data.mechanic ?? null,
        force: data.force ?? null,
        primaryMuscles: strs(data.primary_muscles),
        secondaryMuscles: strs(data.secondary_muscles),
        instructions: strs(data.instructions),
        tips: strs(data.tips),
        goals: strs(data.goals),
        tags: strs(data.tags),
        imagePaths: strs(data.image_paths),
        animationPath: typeof data.animation_path === 'string' && data.animation_path ? data.animation_path : null,
        equipmentIconPath: typeof data.equipment_icon_path === 'string' && data.equipment_icon_path ? data.equipment_icon_path : null,
        demoLicence: typeof data.demo_licence === 'string' && data.demo_licence ? data.demo_licence : null,
        source: data.source ?? null,
        // Validated, not cast. `numeric(4,1)` reaches some deployments as a
        // string, holds 0.0 quite happily, and an import that lost a decimal
        // point would put 75 in it — all three of which `catalogueMet` turns
        // into null rather than into a calorie figure.
        met: catalogueMet(data.met),
      });
      setStatus('ready');
    } catch (e) {
      reportError('exerciseDetail.read', e, { id });
      setDetail(null);
      setStatus('error');
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // ── the name and description the SCREEN shows ───────────────────────────
  //
  // `detail.name` stays the English identity — it is what the id is the slug
  // of, what a program stores, and what gets written back when this screen
  // logs a set. `display` is the reader's own language, and it says which
  // language each string is actually in so the screen can mark an English one
  // instead of passing it off as a translation. See src/lib/catalogueLocale.ts.
  const { byId, locale } = useExerciseTranslation(detail?.id ?? id);
  const display = useMemo(() => {
    if (!detail) return null;
    const name = displayName(detail.name, detail.id, byId, locale);
    const description = displayDescription(detail.description, detail.id, byId, locale);
    return { name, description, note: fallbackNote(name, description) };
  }, [detail, byId, locale]);

  return { detail, display, status, signedOut, reload: load };
}

type RawCatalogueRow = Omit<CatalogueRow, 'display'>;

export interface CatalogueRow {
  id: string;
  name: string;
  group: string | null;
  /** What the movement is performed on — 'barbell', 'cable', 'body only'. Null
   *  on rows where the catalogue does not record it, which is a gap and not the
   *  claim that the exercise needs no kit. */
  equipment: string | null;
  /**
   * `exercises.is_bodyweight` — 183 of 615 rows, never null (the column is
   * `not null default false`).
   *
   * It means "needs no kit", NOT "the load is the person": chin-ups and dips
   * are false because a bar and a dip station are equipment, and 58 of the 183
   * are stretches. src/lib/bodyweightSets.ts explains at length why that makes
   * it useless for pricing a set, and it is not read for that here either.
   *
   * It is here because it is the other half of the one question `equipment`
   * cannot answer on its own — can this be done with nothing at all — and a
   * coach building for somebody in a hotel room needs exactly that. Paired
   * with `equipment` by `needsNoKit` in src/lib/equipmentFacet.ts; neither
   * column means it alone.
   */
  isBodyweight: boolean;
  /** `exercises.category` — 'strength', 'stretching', 'plyometrics'. Read so a
   *  generated program can prescribe a stretch as a hold rather than as twelve
   *  repetitions; null where the catalogue does not classify the row. */
  category: string | null;
  hasDemo: boolean;
  /** The first still, for the row's thumbnail. One path per row, not the whole
   *  array — a list of 608 needs one picture each and never the second. */
  thumbPath: string | null;
  /** Which catalogue the thumbnail belongs to, so it resolves against the
   *  right host. Same reason frameUrls takes it. */
  source: string | null;
  /**
   * The muscles the catalogue names, in ITS vocabulary — 'gluteus maximus',
   * not the artwork's `gluteus_maximus`. src/lib/muscleMap.ts does that
   * translation; nothing here should.
   *
   * Empty arrays where the row names none. That is a gap in the catalogue and
   * not the claim that the movement trains nothing, which is why every count
   * built on these carries the number of rows it could not place.
   */
  primaryMuscles: string[];
  secondaryMuscles: string[];
  /**
   * How hard the catalogue rates the movement — 'beginner', 'intermediate',
   * 'advanced'. Three values across the whole table.
   *
   * Null on 7 of 615 rows (checked live, 8 Sep 2026), and null is a GAP: it
   * means the catalogue does not rate this movement, never that it is
   * unrated because it is easy. A filter built on it therefore has to say how
   * many rows it could not judge, the same way every count in this app that
   * cannot place a row says so.
   */
  level: string | null;
  /** 'compound' or 'isolation' — whether the movement crosses more than one
   *  joint. Two values, null on the same 7 rows as `level`. */
  mechanic: string | null;
  /** 'push', 'pull', 'static' or 'dynamic'. The direction the working muscles
   *  produce force in, not the direction of travel. Null on the same 7 rows. */
  force: string | null;
  /**
   * What the movement is FOR, in the catalogue's own words — 'hypertrophy',
   * 'strength', 'endurance', 'mobility', 'power', 'rehabilitation', 'core'.
   *
   * `not null default '{}'` like `synonyms`, so an empty array is the ordinary
   * answer for a row nobody has classified, and never the claim that the read
   * failed. 'rehabilitation' is the catalogue's label for a movement commonly
   * PRESCRIBED in rehab; it is not clearance to train on an injury, and no
   * screen may word it as one.
   */
  goals: string[];
  /**
   * The catalogue's free-form labels — 'leg_day', 'requires_bench',
   * 'calisthenics', 'knee_safe'. Stored lower snake case; `catalogueValue` in
   * src/lib/format.ts is what turns one into words.
   *
   * Empty on 32 of 615 rows. Read the note on TAG_FILTERS in
   * app/(client)/library.tsx before putting any of these in front of a member:
   * four of them end in the word "safe" and mean something much narrower than
   * a member will read them as.
   */
  tags: string[];
  /**
   * The other things this movement is called — 'butt kicks' on heel-flicks.
   *
   * Searched, never shown as a title. `display` below is the name a row wears;
   * a synonym only ever appears as the EXPLANATION for why a row is in a result
   * list whose title contains nothing the member typed. See matchedSynonym() in
   * src/lib/catalogueLocale.ts.
   *
   * Empty on most rows, and that is the ordinary answer: the column is `not
   * null default '{}'` and a movement with one well-known name genuinely has no
   * second one. An empty array is never the claim that we failed to read it.
   */
  synonyms: string[];
  /**
   * The catalogue's own MET for this movement — see the note on
   * `ExerciseDetail.met` above, and src/lib/exerciseMet.ts for what may and may
   * not be done with it.
   *
   * On the LIST read and not only on the detail read, for the reason
   * `primaryMuscles` is: a screen that has to answer "what did that movement
   * cost" for every movement in somebody's history can either hold the column
   * or make one detail read per distinct movement, and a member with forty
   * movements in their log would make forty round trips to price one week.
   *
   * The cheapest column on the row by a distance, and the arithmetic is worth
   * writing down because every other addition here had to justify itself the
   * same way: `numeric(4,1)` is at most five characters, so with its key it is
   * about eleven bytes a row and under seven kilobytes across the catalogue —
   * against the 23 kB `tags` costs and the 199 kB `instructions` would.
   *
   * Null on 7 of 608 rows (the figure in the header of src/lib/exerciseMet.ts),
   * and null is a gap rather than a movement that costs nothing.
   */
  met: number | null;
  /**
   * The name to PUT ON SCREEN, in the reader's language where we have it.
   *
   * `name` above is untouched and stays the identity: it is what the id is the
   * slug of, what the builder writes into a program, and what the exercise
   * screen is opened with. A list that navigated by `display.text` would send a
   * German reader to a movement called "Kniebeuge", which resolves to nothing.
   */
  display: DisplayString;
}

/**
 * Every movement in the catalogue, names and the muscles they name.
 *
 * Name, group, equipment, the two muscle lists, and whether a demonstration
 * exists — nothing else. The full rows carry instructions and descriptions for
 * the whole catalogue and come to roughly a megabyte; pulling that to draw a
 * scrollable list of names would spend it on text no one is reading yet. The
 * detail screen fetches the one row it needs.
 *
 * `primary_muscles` and `secondary_muscles` are here for the same reason
 * `equipment` is, and they pay for themselves the same way. The heatmap, the
 * recovery map and the muscle rankings all have to answer "which muscles did
 * that set touch" for EVERY exercise a member has ever logged, and the only
 * other way to learn it is one detail read per distinct movement — a member
 * with forty movements in their history would make forty round trips to draw
 * one diagram. Two short text arrays across the catalogue are tens of
 * kilobytes; `instructions` is the megabyte.
 *
 * `equipment` is here because the gym owner's library filters on it — a short
 * text column against 900 rows is a few kilobytes, where `instructions` is the
 * megabyte. Adding a whole extra read to answer "what kit does this assume"
 * would have been the expensive way to get the cheap field.
 *
 * `synonyms` is here on exactly the same accounting, and it is the cheapest of
 * the lot: a text array of at most a handful of short names, empty on most
 * rows, measured at about 25 kB across the whole catalogue. It is the SEARCH
 * that needs it, so it has to be on every row before the member types — a
 * per-row lookup to answer "is this also called what they typed" would be one
 * round trip per row of a list of six hundred, which is not a search.
 *
 * `level`, `mechanic`, `force`, `goals` and `tags` are here on the same
 * accounting, and it was measured rather than assumed before they were added.
 * Against the live table on 8 Sep 2026, 615 rows:
 *
 *   whole rows, as JSON            891 kB   ← the megabyte the header names
 *   this select before these five  241 kB
 *   these five, keys included       94 kB
 *   `instructions` alone           199 kB
 *
 * So the list read goes from about 241 kB to about 335 kB — still nowhere near
 * the whole-row figure, and `instructions` and `description` (73 kB) stay out,
 * which is what keeps it there. Three of the five are single short words from
 * a fixed vocabulary of two to four values; `goals` averages under two words a
 * row. `tags` is the largest of them at 23 kB and is still a tenth of
 * `instructions`.
 *
 * They pay for themselves the way `equipment` does. A member browsing 615
 * movements could filter by muscle group and equipment and by nothing else,
 * and the alternative to having these on every row is a detail read per row to
 * answer "is this one a beginner movement" — six hundred round trips to draw
 * one filtered list, which is the same arithmetic that put `synonyms` here.
 *
 * What is NOT claimed: that these columns are complete. 7 rows carry no
 * `level`, `mechanic` or `force`, and 32 carry no `tags`. Every screen
 * filtering on them has to say how many rows it could not judge — see
 * app/(client)/library.tsx.
 *
 * `hasDemo` is computed here rather than on the screen so the list can say
 * which entries are illustrated WITHOUT reading image_paths into every row —
 * `image_paths is not null` is a cheap thing for Postgres to answer and an
 * expensive thing to ship.
 */
export function useExerciseCatalogue() {
  const authRev = useAuthRevision();
  // One request for the whole language, not one per row — see
  // src/ui/catalogueTranslations.ts. An English reader asks for nothing.
  const { byId: translations, locale } = useCatalogueTranslations();
  const [rows, setRows] = useState<RawCatalogueRow[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  /** True when an empty catalogue is a permissions answer rather than a real
   *  one — the read policy is `to authenticated`, and a signed-out session is
   *  handed zero rows with no error. */
  const [signedOut, setSignedOut] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const { data, error } = await supabase
        .from('exercises')
        .select('id, name, muscle_group, equipment, is_bodyweight, category, level, mechanic, force, goals, tags, met, primary_muscles, secondary_muscles, synonyms, image_paths, equipment_icon_path, source')
        .order('name', { ascending: true })
        .limit(capLimit());
      if (error) { reportError('exerciseCatalogue.read', error); setStatus('error'); return; }
      const page = capped(data);
      // An empty catalogue is either a real answer or a signed-out one, and
      // only one of those is worth telling somebody about. Cleared as well as
      // set: the re-read that follows a sign-in returns the whole catalogue,
      // and a flag left standing from the read before it would keep the
      // library telling a signed-in member to sign in.
      setSignedOut(page.rows.length ? false : !(await signedIn()));
      setRows(page.rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        group: r.muscle_group ?? null,
        equipment: r.equipment ?? null,
        // `=== true` and not `!!`. The column is `not null default false`, so
        // a null here is PostgREST having omitted the field rather than the
        // catalogue saying no — and the one caller that matters treats a
        // missing answer as "do not assume", which false already is.
        isBodyweight: r.is_bodyweight === true,
        category: r.category ?? null,
        // hasDemo stays about the MOVEMENT. An equipment icon fills the tile
        // so the row is not blank, but it is not a demonstration and a filter
        // for "has a demo" must not start returning these three.
        hasDemo: Array.isArray(r.image_paths) && r.image_paths.length > 0,
        thumbPath: Array.isArray(r.image_paths) && r.image_paths.length
          ? String(r.image_paths[0])
          : (typeof r.equipment_icon_path === 'string' && r.equipment_icon_path ? r.equipment_icon_path : null),
        source: r.source ?? null,
        // `?? null` and never `?? ''`. An empty string would sort and compare
        // as a value, so a row the catalogue has not rated would join whatever
        // chip an empty string happened to match rather than sitting outside
        // every one of them, which is where a row we cannot judge belongs.
        level: r.level ?? null,
        mechanic: r.mechanic ?? null,
        force: r.force ?? null,
        primaryMuscles: strs(r.primary_muscles),
        secondaryMuscles: strs(r.secondary_muscles),
        // Through `strs` like every other array on this row, so a stray empty
        // string in the column cannot become a chip with no name on it that
        // silently matches nothing.
        goals: strs(r.goals),
        tags: strs(r.tags),
        // `strs` drops blanks, so a row whose array holds an empty string does
        // not acquire a synonym that matches every search term ever typed.
        synonyms: strs(r.synonyms),
        // Through `catalogueMet` for the same reason the detail read is: 0.0,
        // an out-of-range import and the string form of a numeric all have to
        // become null here, or they become a calorie figure downstream.
        met: catalogueMet(r.met),
      })));
      // 'partial' rather than 'ready': the catalogue is 608 rows against a cap
      // of 1000 (checked live, 6 Sep 2026), so this is quiet today and will not
      // be forever — RepDB's last drop alone took it from 519. A list that
      // silently stops at the cap is how a client concludes we have never heard
      // of an exercise that is sitting just past row 1000.
      setStatus(page.truncated ? 'partial' : 'ready');
    } catch (e) {
      reportError('exerciseCatalogue.read', e);
      setStatus('error');
    }
    // Re-armed on sign-in, exactly as useExerciseVideos is. This read is
    // policy-scoped (`to authenticated`), and the providers mount BEFORE the
    // session is restored — so the one run an empty dependency array allowed
    // happened while signed out, came back with nought rows and no error, and
    // `load` never changed identity again. The catalogue then stayed empty for
    // the life of the app however long the member was signed in, and the
    // library said so in words. See src/ui/authRevision.tsx.
  }, [authRev]);

  useEffect(() => { void load(); }, [load]);

  // Merged here rather than in each screen: five screens read this hook, and a
  // list that fell back to English on its own would be a fifth place for the
  // "is this actually translated" question to be answered differently.
  const shown = useMemo(
    () => rows.map((r) => ({ ...r, display: displayName(r.name, r.id, translations, locale) })),
    [rows, translations, locale],
  );

  return { rows: shown, status, signedOut, reload: load };
}
