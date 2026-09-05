// One movement, every time it has been done, and what it is worth saying about it.
//
// ── The hole this closes ───────────────────────────────────────────────────
//
// Both apps could show a training log and neither could answer the question a
// coach and a lifter actually ask, which is not "what did she do in March" but
// "where is she on bench press". src/lib/clientTraining.ts groups a log into
// days and sessions — the right shape for reading a week back — and there was
// no shape at all for reading ONE exercise forward through a year. The client
// side had `personalRecords` in src/lib/streaks.ts, which is a single best per
// movement with no history behind it, and `prTimeline` in src/lib/longView.ts,
// which is every record across every movement with no way to follow one.
//
// ── Why it is one module and not two screens ───────────────────────────────
//
// The arithmetic behind "every time I have done bench press, and where it has
// gone" is identical whoever is reading it. This codebase has been bitten by
// the alternative more than once: three write paths that each converted pounds
// their own way and one of them didn't, two definitions of unread, a tips
// engine a client could see and a coach could not. So the coach's
// app/(trainer)/client-training.tsx and the member's app/(client)/history.tsx
// are two thin renderings of this file, and a disagreement between them is a
// bug in one file rather than a divergence nobody notices.
//
// ── Kilograms all the way through ──────────────────────────────────────────
//
// Every figure here — loads, volumes, estimated maxes, and every DIFFERENCE
// between two of them — is in kilograms, because that is what the `workouts`
// table stores. Nothing in this file knows what unit anybody reads in, and
// that is deliberate. Conversion happens once, at the render boundary, through
// `liftLabel` / `liftDeltaIn` / `est1RMIn` / `volumeIn` in ./units. Converting
// inside the comparisons would mean the two ends of a movement were rounded
// separately before being subtracted, which is the bug `liftDeltaIn` exists to
// prevent: a genuine 2.5 kg progression reading "+5 lb" one week and "+6 lb"
// the next off nothing the lifter did.
//
// ── And it does not decide which way is good ───────────────────────────────
//
// A movement comes back as a signed number of kilograms or as null. This file
// never returns a word for it, never returns a colour, and never returns a
// flag saying whether it is progress. That judgement is src/lib/deltaLabel.ts's
// — `deltaLabel` gives a movement of nothing no sign at all, and `goalWants`
// refuses to have an opinion about a direction when the goal does not settle
// one. A member on a fat-loss block whose bench has held is not failing, and a
// screen that draws every flat line as a disappointment is worse than one that
// says nothing.

import type { WorkoutEntry } from './mockData';
import { dayKeyOf } from './entryEdit';
import { exerciseSlug } from './exerciseId';
import { est1RM } from './streaks';
// The two flags that change what a stored pair MEANS. This file was left
// unconverted when `bw` landed, which showed as a pull-up trail with no load on
// any day of it beside a Records board that had priced the same sets — one
// movement, two answers, both drawn from the same rows. `setLoadKg` is the only
// thing in the app that prices a set, and `isTimedSet` is the only thing that
// knows the first number is sometimes seconds.
import { setLoadKg, isBodyweightSet, type BodyweightHistory } from './bodyweightSets';
import { isTimedSet } from './timedSets';
import { type LoadStatus } from '../ui/loadStatus';

export type { BodyweightHistory } from './bodyweightSets';

/** A finite number, or null. `Number.isFinite` rather than a truthiness test,
 *  because a load of 0 is a bodyweight set and must survive as a 0 to be
 *  counted as one rather than being read as an absent measurement. */
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/* ── one outing ───────────────────────────────────────────────────────────── */

/**
 * One movement on one day, and everything that was done to it.
 *
 * The day is the unit, not the timestamp, for the reason `TrainingDay` in
 * src/lib/clientTraining.ts gives at length: one real client's record holds the
 * same squat written as four rows 01:34:16.643, :17.677, :18.110 and :18.427,
 * and by timestamp that is four sessions of squats a second apart. Read as an
 * exercise trail that is four points on a chart and three movements of nothing
 * between them, which is a picture of a plateau drawn out of a double tap.
 *
 * A day also survives the commoner and quieter version: a lifter who logs
 * three sets of bench, walks away, comes back and logs two more.
 */
export interface ExerciseOuting {
  /** The movement's identity, from `exerciseSlug`. */
  slug: string;
  /** The movement as it was actually written on this day. The record's own
   *  wording is kept rather than a canonical one — a coach searching for what
   *  their client typed should see what their client typed. */
  name: string;
  /** `YYYY-MM-DD` in the reader's own timezone, or null when the timestamp
   *  cannot be parsed. Never faked to today: inventing a training day out of a
   *  parsing failure is the defect src/lib/ownTraining.ts documents. */
  day: string | null;
  /** The newest `performed_at` of the day, for ordering and for a time. */
  at: string;
  /** Every REPPED set with a rep count above zero, in the order it was done,
   *  as `[reps, kg]`.
   *
   *  The load is what the set actually moved: the plates on an ordinary set,
   *  and on a bodyweight set the person's own weight on that day plus anything
   *  added (see src/lib/bodyweightSets.ts). It is null for a set whose load
   *  cannot be known — a blank, not a nought, because a chin-up is not a lift
   *  of 0 kg and a chin-up done before anybody weighed this person is not a
   *  lift of their weight today.
   *
   *  Holds are NOT in here. Their first number is seconds and a screen reading
   *  this array as reps would print "45 × 10 kg" over a plank. */
  sets: [number, number | null][];
  /** Every HELD set, as `[seconds, kg]`, in the order it was done. The load is
   *  what was held or added; null when a hold carried none, and null on a
   *  bodyweight hold nobody has a weight for. */
  holds: [number, number | null][];
  /** How many sets were done in total — repped and held together, because that
   *  is what "sets" means to the person who did them. */
  setCount: number;
  /** Of those, the ones performed against the person's own body: flagged as
   *  bodyweight, or — on rows written before the flag existed — carrying no
   *  load at all. */
  bodyweightSets: number;
  /** Of those, the ones that are NOT in `volumeKg`, because their load is not
   *  knowable: a bodyweight set with no weigh-in on or before that day, or a
   *  loadless set from before the flag existed. Zero when the day's tonnage
   *  covers every repped set of it. */
  unpricedSets: number;
  /** How many of the day's sets were holds. */
  timedSets: number;
  /** Σ seconds held across them. Zero when nothing was held, which is not a
   *  measurement of anything. */
  holdSeconds: number;
  /** Σ reps across every repped set. Holds contribute nothing: seconds are not
   *  repetitions, and adding them here is exactly the mistake that made a
   *  45-second plank read as forty-five of something. */
  reps: number;
  /** Σ reps × load in kilograms, over the repped sets whose load is known;
   *  null, never 0, when none is. `unpricedSets` says what is missing from it. */
  volumeKg: number | null;
  /** The heaviest load touched, in kilograms; null on a day with no knowable
   *  load. On a bodyweight day that IS a figure — the body plus the belt — and
   *  it is null only when nobody has recorded what the person weighs. */
  topLoadKg: number | null;
  /** The most reps achieved AT that heaviest load. Null exactly when
   *  `topLoadKg` is. */
  topReps: number | null;
  /** The best estimated 1RM across the day's sets, in kilograms, by Epley
   *  through `est1RM` in src/lib/streaks.ts — the app's only 1RM formula, and
   *  not reimplemented here. Null on a bodyweight day. */
  best1RMKg: number | null;
  /** The reps and load of the set that produced `best1RMKg`, so a screen can
   *  print "100 kg × 5" rather than an estimate with nothing behind it. */
  bestSet: { reps: number; loadKg: number } | null;
  /**
   * How many separate logging events the day was folded from. One for almost
   * everybody, and four for the live record that made the folding necessary.
   *
   * Carried rather than discarded because folding is not the same as
   * deduplicating: the four rows above are the same three sets written four
   * times, and this outing therefore holds twelve sets and 172 reps, which is a
   * true count of the record and an overstatement of the afternoon. A screen
   * showing more than one says so instead of leaving a coach to work out why a
   * set of squats appears four times.
   */
  entryCount: number;
}

/** Entries that are this movement, whatever spelling was typed. Resolution is
 *  `exerciseSlug` and nothing else: a second matcher is a second definition of
 *  what counts as the same lift, and the two would disagree the week somebody
 *  logged "Bench-Press". */
function entriesFor(log: readonly WorkoutEntry[], slug: string): WorkoutEntry[] {
  return log.filter((e) => e && typeof e.exercise === 'string' && exerciseSlug(e.exercise) === slug);
}

/** Fold a day's worth of entries into one outing. `entries` must already be
 *  this movement and this day, oldest first. */
function foldOuting(
  slug: string,
  day: string | null,
  entries: readonly WorkoutEntry[],
  history: BodyweightHistory,
): ExerciseOuting | null {
  const sets: [number, number | null][] = [];
  const holds: [number, number | null][] = [];
  let reps = 0, bodyweightSets = 0, unpricedSets = 0, holdSeconds = 0;
  let volume = 0, anyVolume = false;
  let topLoad: number | null = null, topReps: number | null = null;
  let best1RM: number | null = null;
  let bestSet: { reps: number; loadKg: number } | null = null;

  for (const e of entries) {
    const list = e.sets ?? [];
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const first = num(s?.[0]);
      if (first == null || first <= 0) continue;          // a blank row somebody tabbed past
      const own = isBodyweightSet(e, i);
      // `setLoadKg` and nothing else. It is what the Records board prices a set
      // with, and a second opinion here is how one movement comes to read two
      // ways on two screens drawn from the same rows.
      const load = setLoadKg(e, i, s as [number, number], history, e.t);
      if (own) bodyweightSets++;
      else if (load == null) bodyweightSets++;            // a loadless row from before the flag
      if (isTimedSet(e, i)) {
        // A hold. Counted as a set that happened, kept out of every figure
        // that reads the first number as repetitions, and out of the tonnage
        // for the reason src/lib/timedSets.ts gives: seconds times kilograms
        // is not a mass moved.
        holds.push([first, load]);
        holdSeconds += first;
        continue;
      }
      sets.push([first, load]);
      reps += first;
      if (load == null) { unpricedSets++; continue; }
      volume += first * load; anyVolume = true;
      if (topLoad == null || load > topLoad) { topLoad = load; topReps = first; }
      else if (load === topLoad && (topReps == null || first > topReps)) topReps = first;
      const e1 = est1RM(load, first);
      if (best1RM == null || e1 > best1RM) { best1RM = e1; bestSet = { reps: first, loadKg: load }; }
    }
  }

  if (!sets.length && !holds.length) return null;         // logged, but nothing was done to it

  // The newest timestamp of the day speaks for it, and the newest spelling with
  // it — a lifter who has since renamed the movement in their own log should
  // see the name they use now.
  const newest = entries[entries.length - 1];
  return {
    slug,
    name: newest.exercise,
    day,
    at: newest.t,
    sets,
    holds,
    setCount: sets.length + holds.length,
    bodyweightSets,
    unpricedSets,
    timedSets: holds.length,
    holdSeconds,
    reps,
    volumeKg: anyVolume ? Math.round(volume) : null,
    topLoadKg: topLoad,
    topReps,
    best1RMKg: best1RM,
    bestSet,
    entryCount: entries.length,
  };
}

/**
 * Every day this movement was done, newest first.
 *
 * An entry whose timestamp will not parse keeps its outing — the sets in it are
 * real — with `day: null`, and those come last rather than being filed under a
 * day nobody trained on.
 *
 * The order is stated here rather than inherited from whatever query fed it.
 * The reads that call this already ask for `performed_at` descending, but a
 * screen headed "newest first" must not depend on an ORDER BY in a file it does
 * not own; `sessionsOf` and `trainingDays` make the same point for the same
 * reason.
 */
export function exerciseOutings(
  log: readonly WorkoutEntry[],
  name: string,
  /** The member's own weight over time, which is what lets a bodyweight set
   *  carry a load at all. Optional and defaulting to none, because plenty of
   *  members have never been weighed and every caller that has no history must
   *  still get the trail — their bodyweight sets simply land in
   *  `unpricedSets` rather than being given an invented body. */
  history: BodyweightHistory = [],
): ExerciseOuting[] {
  const slug = exerciseSlug(name);
  if (!slug) return [];
  const mine = entriesFor(log, slug)
    .filter((e) => typeof e.t === 'string' && e.t)
    .sort((a, b) => {
      const d = Date.parse(a.t) - Date.parse(b.t);
      return Number.isFinite(d) && d !== 0 ? d : a.t.localeCompare(b.t);
    });

  const byDay = new Map<string, WorkoutEntry[]>();
  const undated: WorkoutEntry[][] = [];
  for (const e of mine) {
    const day = dayKeyOf(e.t);
    if (day == null) { undated.push([e]); continue; }
    const bucket = byDay.get(day);
    if (bucket) bucket.push(e); else byDay.set(day, [e]);
  }

  const dated: ExerciseOuting[] = [];
  for (const [day, group] of byDay) {
    const o = foldOuting(slug, day, group, history);
    if (o) dated.push(o);
  }
  dated.sort((a, b) => (b.day ?? '').localeCompare(a.day ?? ''));

  const loose: ExerciseOuting[] = [];
  for (const group of undated) {
    const o = foldOuting(slug, null, group, history);
    if (o) loose.push(o);
  }
  return [...dated, ...loose];
}

/* ── what a read ASKED for, which is not what came back ───────────────────
 *
 * `LoadStatus` answers one question about a read — did it come back CUT — and
 * it answers it well. It cannot answer the other one, and for as long as this
 * file had only `whole` the two were being read as the same question.
 *
 * app/(trainer)/client-training.tsx is the worked example, and it is the screen
 * that makes the confusion inevitable rather than unlucky. Its range control
 * exists PRECISELY to bring a long record under PostgREST's ceiling: tapping
 * 12 Weeks re-asks the query with a `.gte('performed_at', …)` bound, the answer
 * comes back short of the cap, and the screen sets 'ready'. That is the truth
 * about the read — nothing was truncated, so there is nothing to flag. It is
 * not the truth about the person. Over a three-year history the panel then
 * printed "Best Est. 1RM 150 kg", "Since the First Day on Record" and "20 of
 * the 34 movements on record", with no truncation warning anywhere, to a coach
 * whose client had benched 165 kg in March. The read was complete. It simply
 * was not the record.
 *
 * So a read has two independent properties:
 *
 *   WHOLE   nothing fell off the end of it. `LoadStatus 'ready'`, and what it
 *           licenses is counting the rows that came back.
 *   COVERS  the query was asked over the whole record rather than a window.
 *           This is what licenses the words "on record", "the first day" and
 *           any figure offered as a lifetime best.
 *
 * A windowed read is whole AND does not cover, simultaneously, which is why
 * neither flag can be derived from the other.
 */

/** How a log was read: what came back, and what was asked for. */
export interface ExerciseRead {
  status: LoadStatus;
  /**
   * How many days back the query asked for, or null when it asked for the
   * whole record.
   *
   * Omitting it means the caller has not said, and that is read as NOT
   * covering the record. Silence fails closed on purpose: defaulting to
   * "everything" is exactly the assumption that put a twelve-week window under
   * the words "on record", and a coverage claim nobody made is not a coverage
   * claim. A caller that genuinely reads the lot says so, with `null`.
   */
  windowDays?: number | null;
}

/**
 * May a screen speak of this read as the person's RECORD?
 *
 * Only when both halves hold: the read came back uncut, and it was asked over
 * everything. A bare `LoadStatus` — a caller that has said nothing about its
 * window — is never enough, however healthy that status is.
 */
export function readCoversRecord(read: ExerciseRead | LoadStatus | undefined): boolean {
  if (read == null || typeof read === 'string') return false;
  return read.status === 'ready' && read.windowDays === null;
}

/** The `LoadStatus` half of either shape. */
function readStatus(read: ExerciseRead | LoadStatus): LoadStatus {
  return typeof read === 'string' ? read : read.status;
}

/* ── finding a movement ───────────────────────────────────────────────────── */

/** One movement in somebody's record, as a search result reads it. */
export interface ExerciseSummary {
  slug: string;
  /** The most recent spelling on record. */
  name: string;
  /** Days it was logged at all, within whatever was read — sets or no sets.
   *
   *  A count over the READ and never over the record. It is a true figure for
   *  every read that landed, including a windowed one and a truncated one, and
   *  that is exactly why it may not be printed on its own: a screen that reads
   *  84 days out of a 12-week window and writes "34 days" beside a movement
   *  somebody has done for three years has stated a number about a person that
   *  is not about them. `recordDays` is the same figure with the claim
   *  attached. */
  days: number;
  /**
   * `days` as a statement about the RECORD: the same number when the read was
   * neither cut nor windowed, and null otherwise.
   *
   * Carried rather than left to each screen's own comparison for the reason
   * `outingCount` is: the check that has to be right is "may I say this about
   * this person", the two ways it fails are different, and a null cannot be
   * printed by accident where a number can.
   */
  recordDays: number | null;
  /**
   * Of those, the days that carried at least one set, and therefore the length
   * of the trail `exerciseOutings` returns.
   *
   * Zero is the ordinary case for cardio, and it is why this figure is carried
   * separately rather than folded into `days`. A screen must be able to say
   * "logged on 15 days, with no sets recorded against it" without either
   * pretending there are reps to follow or claiming the movement was never
   * done. The second of those is what the live record forced: one real client's
   * 31 workouts are 15 cycles, 6 walks, 5 unnamed activities and one squat
   * session, and a search for "cycling" that answered "nothing logged matches
   * that" would have been a flat lie about somebody's month.
   */
  daysWithSets: number;
  /** The newest day it was logged, or null when no entry of it carries a
   *  readable date. */
  lastDay: string | null;
  /** The newest timestamp, for ordering. */
  lastAt: string | null;
  /** The best estimated 1RM in kilograms across everything read; null where
   *  nothing carried a load. */
  best1RMKg: number | null;
  /** The heaviest load touched, in kilograms; null as above. */
  topLoadKg: number | null;
}

/**
 * Every distinct movement in a log, most recently trained first.
 *
 * Most-recent first rather than alphabetical because the question this list
 * answers is "what has she been doing", and an A–Z puts Ab Wheel above a squat
 * somebody did last night. A search box narrows it when the answer is further
 * down.
 *
 * Everything logged is in here, including movements that never carried a set.
 * The trail behind such a movement is empty and `daysWithSets` says so; leaving
 * it out of the index altogether would make the search box deny that a client
 * who has cycled fifteen times has ever cycled.
 */
export function exerciseIndex(
  log: readonly WorkoutEntry[],
  history: BodyweightHistory = [],
  /** How this log was read. Omitted means the caller has not said, and every
   *  record-shaped figure below is withheld — see `ExerciseRead`. */
  read?: ExerciseRead | LoadStatus,
): ExerciseSummary[] {
  const covers = readCoversRecord(read);
  const bySlug = new Map<string, WorkoutEntry[]>();
  for (const e of log) {
    if (!e || typeof e.exercise !== 'string' || typeof e.t !== 'string' || !e.t) continue;
    const slug = exerciseSlug(e.exercise);
    if (!slug) continue;
    const bucket = bySlug.get(slug);
    if (bucket) bucket.push(e); else bySlug.set(slug, [e]);
  }

  const out: ExerciseSummary[] = [];
  for (const [slug, entries] of bySlug) {
    const outings = exerciseOutings(entries, entries[0].exercise, history);
    let best1RM: number | null = null, topLoad: number | null = null;
    for (const o of outings) {
      if (o.best1RMKg != null && (best1RM == null || o.best1RMKg > best1RM)) best1RM = o.best1RMKg;
      if (o.topLoadKg != null && (topLoad == null || o.topLoadKg > topLoad)) topLoad = o.topLoadKg;
    }

    // Counted over every entry, not over the outings, so a cardio movement has
    // a real number of days behind it. An entry whose timestamp will not parse
    // counts as a day of its own rather than being dropped or merged, which is
    // how `exerciseOutings` treats it too — the two figures must agree.
    const dayKeys = new Set<string>();
    let undated = 0;
    let lastDay: string | null = null, lastAt: string | null = null, name = entries[0].exercise;
    for (const e of entries) {
      const day = dayKeyOf(e.t);
      if (day == null) undated++;
      else {
        dayKeys.add(day);
        if (lastDay == null || day > lastDay) lastDay = day;
      }
      if (lastAt == null || e.t.localeCompare(lastAt) > 0) { lastAt = e.t; name = e.exercise; }
    }

    const days = dayKeys.size + undated;
    out.push({
      slug, name, days, recordDays: covers ? days : null, daysWithSets: outings.length,
      lastDay, lastAt, best1RMKg: best1RM, topLoadKg: topLoad,
    });
  }

  return out.sort((a, b) => {
    // A movement with no readable date on it anywhere sorts last rather than
    // to the top of a list headed "most recent".
    if (a.lastDay == null && b.lastDay != null) return 1;
    if (b.lastDay == null && a.lastDay != null) return -1;
    const d = (b.lastDay ?? '').localeCompare(a.lastDay ?? '');
    return d !== 0 ? d : a.name.localeCompare(b.name);
  });
}

/**
 * The movements a typed query is asking for.
 *
 * The query goes through `exerciseSlug` like everything else, so "Bench Press",
 * "bench press" and "bench-press" are one search, and then every word of it has
 * to appear somewhere in the movement's slug. Word-wise rather than as one
 * substring so that "press bench" and "bench press" find the same lift, which
 * is a thing people type; and AND rather than OR so that "bench press" does not
 * return every leg press in the book.
 *
 * This adds no vocabulary of its own. There is exactly one answer in this
 * codebase to "are these the same movement" and it is `exerciseSlug`; a fuzzy
 * matcher here would be a second one, and the two would part company on the
 * first hyphen.
 */
export function matchExercises(index: readonly ExerciseSummary[], query: string): ExerciseSummary[] {
  const words = exerciseSlug(query).split('-').filter(Boolean);
  if (!words.length) return [...index];
  return index.filter((e) => words.every((w) => e.slug.includes(w)));
}

/* ── where it has gone ────────────────────────────────────────────────────── */

/**
 * A movement between two outings, in kilograms, or null where there is nothing
 * to measure.
 *
 * Every field is a raw signed difference and none of them is a word. Null means
 * one of the two ends had no comparable figure — a bodyweight day has no top
 * load, so the movement in top load across it is not zero, it is unmeasurable,
 * and those are different things to tell somebody about their own training.
 */
export interface ExerciseMovement {
  /** The outing being measured FROM. Null when there is no earlier one, which
   *  is what makes every field below null too. Screens name its day in the
   *  "since" of `deltaLabel`, so a movement is never printed without saying
   *  what it is a movement from. */
  from: ExerciseOuting | null;
  topLoadKg: number | null;
  est1RMKg: number | null;
  volumeKg: number | null;
  /** Total reps, which is a count and not a weight — but it is still a
   *  movement, and still goes through `deltaLabel` so that no change carries
   *  no sign. */
  reps: number | null;
}

const NO_MOVEMENT: ExerciseMovement = { from: null, topLoadKg: null, est1RMKg: null, volumeKg: null, reps: null };

function movementBetween(from: ExerciseOuting | null, to: ExerciseOuting | null): ExerciseMovement {
  if (!from || !to) return NO_MOVEMENT;
  const span = (a: number | null, b: number | null) => (a == null || b == null ? null : a - b);
  return {
    from,
    topLoadKg: span(to.topLoadKg, from.topLoadKg),
    est1RMKg: span(to.best1RMKg, from.best1RMKg),
    volumeKg: span(to.volumeKg, from.volumeKg),
    reps: to.reps - from.reps,
  };
}

/**
 * What the record supports about one movement.
 *
 * `state` is what a screen branches on, and the three values are three
 * different things to say out loud:
 *
 *   'unreadable'  the read failed. Nothing here is a fact about this person.
 *                 A null `outings` is what produces it, and callers pass null
 *                 on 'error' precisely so an empty array can never arrive
 *                 meaning two things at once.
 *   'none'        the read landed and this movement is not in it. Not "not in
 *                 the record" unless `coversRecord` — under a twelve-week
 *                 window it means the client has not done this SINCE JUNE, and
 *                 a screen that says "never" about a lift somebody has been
 *                 doing for three years has told their coach something false.
 *   'some'        there are outings.
 *
 * Same discipline as `TrainingBoard`: any figure that is a COUNT or a claim
 * about everything is null unless the read was whole, because a capped read
 * hands back a prefix of an unknown set and counting it produces a smaller
 * number stated with complete confidence. The outings themselves are still
 * listed — the newest twenty of a truncated set are twenty real days.
 */
export interface ExerciseTrend {
  state: 'unreadable' | 'none' | 'some';
  /** Newest first. Empty under 'unreadable' and 'none'. */
  outings: ExerciseOuting[];
  /** True when the read was not CUT — nothing fell off the end, so `outings`
   *  is every outing the query returned. NOT a claim that the query asked for
   *  everything: a twelve-week window comes back whole every time. See
   *  `ExerciseRead`. */
  whole: boolean;
  /**
   * True when the read was whole AND was asked over the whole record — the one
   * condition under which "on record", "the first day" and a lifetime best are
   * true sentences.
   *
   * Screens word `best` and `sinceFirst` off THIS and not off `whole`. Under a
   * windowed read they are the best and the earliest IN THE WINDOW, which is a
   * different and much smaller claim, and the one the coach's screen was making
   * in the record's name.
   */
  coversRecord: boolean;
  /** How many days this movement was done WITHIN THE READ, or null when the
   *  read was cut and even that is a fraction of an unknown set. A true figure
   *  about the window, and not a figure about the person — for that, and for
   *  anything a screen prints as "N days" beside a movement's name, see
   *  `recordOutingCount`. */
  outingCount: number | null;
  /** The same count offered as a fact about the person: null unless
   *  `coversRecord`. */
  recordOutingCount: number | null;
  /** The newest outing. Safe under a truncated read: the read is ordered
   *  newest first, so the newest row is the one thing truncation cannot take. */
  latest: ExerciseOuting | null;
  /** The outing holding the best estimated 1RM, or null when nothing read
   *  carried a load. */
  best: ExerciseOuting | null;
  /** Latest against the outing before it. */
  sinceLast: ExerciseMovement;
  /** Latest against the earliest outing read. */
  sinceFirst: ExerciseMovement;
}

const UNREADABLE_TREND: ExerciseTrend = {
  state: 'unreadable', outings: [], whole: false, coversRecord: false,
  outingCount: null, recordOutingCount: null,
  latest: null, best: null, sinceLast: NO_MOVEMENT, sinceFirst: NO_MOVEMENT,
};

export function exerciseTrend(
  outings: ExerciseOuting[] | null,
  /** A bare `LoadStatus` still means what it always meant about truncation,
   *  and says nothing about the window — so `coversRecord` is false under it
   *  and every record-shaped figure is withheld. A caller that reads the whole
   *  record passes `{ status, windowDays: null }` and gets them back. */
  read: ExerciseRead | LoadStatus,
): ExerciseTrend {
  const status = readStatus(read);
  if (outings == null || status === 'error') return UNREADABLE_TREND;
  const whole = status === 'ready';
  const coversRecord = readCoversRecord(read);
  if (!outings.length) {
    // A read still in flight has not established anything, and 'nothing on
    // record' is a statement about a person that must never be made from a
    // question nobody has finished asking.
    if (status === 'loading') return UNREADABLE_TREND;
    return {
      ...UNREADABLE_TREND, state: 'none', whole, coversRecord,
      outingCount: whole ? 0 : null, recordOutingCount: coversRecord ? 0 : null,
    };
  }

  const latest = outings[0];
  const previous = outings.length > 1 ? outings[1] : null;
  const earliest = outings.length > 1 ? outings[outings.length - 1] : null;

  let best: ExerciseOuting | null = null;
  for (const o of outings) {
    if (o.best1RMKg == null) continue;
    if (best == null || best.best1RMKg == null || o.best1RMKg > best.best1RMKg) best = o;
  }

  return {
    state: 'some',
    outings,
    whole,
    coversRecord,
    outingCount: whole ? outings.length : null,
    recordOutingCount: coversRecord ? outings.length : null,
    latest,
    best,
    sinceLast: movementBetween(previous, latest),
    sinceFirst: movementBetween(earliest, latest),
  };
}
