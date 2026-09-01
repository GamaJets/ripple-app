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
import { type LoadStatus } from '../ui/loadStatus';

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
  /** Every set with a rep count above zero, in the order it was done, as
   *  `[reps, kg]`. The load is null for a set that carried none — a blank, not
   *  a nought, because a chin-up is not a lift of 0 kg. */
  sets: [number, number | null][];
  /** How many of those there are. */
  setCount: number;
  /** Of those, the ones that carried no load. */
  bodyweightSets: number;
  /** Σ reps across every counted set. */
  reps: number;
  /** Σ reps × load in kilograms, over the sets that carried a load; null, never
   *  0, when none did. */
  volumeKg: number | null;
  /** The heaviest load touched, in kilograms; null on a bodyweight day. */
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
function foldOuting(slug: string, day: string | null, entries: readonly WorkoutEntry[]): ExerciseOuting | null {
  const sets: [number, number | null][] = [];
  let reps = 0, bodyweightSets = 0;
  let volume = 0, anyVolume = false;
  let topLoad: number | null = null, topReps: number | null = null;
  let best1RM: number | null = null;
  let bestSet: { reps: number; loadKg: number } | null = null;

  for (const e of entries) {
    for (const s of e.sets ?? []) {
      const r = num(s?.[0]);
      if (r == null || r <= 0) continue;          // a blank row somebody tabbed past
      const w = num(s?.[1]);
      const load = w != null && w > 0 ? w : null;
      sets.push([r, load]);
      reps += r;
      if (load == null) { bodyweightSets++; continue; }
      volume += r * load; anyVolume = true;
      if (topLoad == null || load > topLoad) { topLoad = load; topReps = r; }
      else if (load === topLoad && (topReps == null || r > topReps)) topReps = r;
      const e1 = est1RM(load, r);
      if (best1RM == null || e1 > best1RM) { best1RM = e1; bestSet = { reps: r, loadKg: load }; }
    }
  }

  if (!sets.length) return null;                  // logged, but nothing was done to it

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
    setCount: sets.length,
    bodyweightSets,
    reps,
    volumeKg: anyVolume ? Math.round(volume) : null,
    topLoadKg: topLoad,
    topReps,
    best1RMKg: best1RM,
    bestSet,
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
export function exerciseOutings(log: readonly WorkoutEntry[], name: string): ExerciseOuting[] {
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
    const o = foldOuting(slug, day, group);
    if (o) dated.push(o);
  }
  dated.sort((a, b) => (b.day ?? '').localeCompare(a.day ?? ''));

  const loose: ExerciseOuting[] = [];
  for (const group of undated) {
    const o = foldOuting(slug, null, group);
    if (o) loose.push(o);
  }
  return [...dated, ...loose];
}

/* ── finding a movement ───────────────────────────────────────────────────── */

/** One movement in somebody's record, as a search result reads it. */
export interface ExerciseSummary {
  slug: string;
  /** The most recent spelling on record. */
  name: string;
  /** Days it was done on, within whatever was read. */
  days: number;
  /** The newest day it was done, or null when no outing of it carries a
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
 */
export function exerciseIndex(log: readonly WorkoutEntry[]): ExerciseSummary[] {
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
    const outings = exerciseOutings(entries, entries[0].exercise);
    if (!outings.length) continue;               // logged with no sets, every time
    let best1RM: number | null = null, topLoad: number | null = null;
    let lastDay: string | null = null, lastAt: string | null = null;
    for (const o of outings) {
      if (o.best1RMKg != null && (best1RM == null || o.best1RMKg > best1RM)) best1RM = o.best1RMKg;
      if (o.topLoadKg != null && (topLoad == null || o.topLoadKg > topLoad)) topLoad = o.topLoadKg;
      if (o.day != null && (lastDay == null || o.day > lastDay)) lastDay = o.day;
      if (lastAt == null || o.at.localeCompare(lastAt) > 0) lastAt = o.at;
    }
    out.push({ slug, name: outings[0].name, days: outings.length, lastDay, lastAt, best1RMKg: best1RM, topLoadKg: topLoad });
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
 *   'none'        the read landed and this movement is not in the record.
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
  /** True only when the read was whole. Screens word `best` and `sinceFirst`
   *  off this: under a truncated read they are the best and the earliest ON
   *  THIS PAGE, which is a different and much smaller claim. */
  whole: boolean;
  /** How many days this movement was done, or null when the read cannot
   *  support a count. */
  outingCount: number | null;
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
  state: 'unreadable', outings: [], whole: false, outingCount: null,
  latest: null, best: null, sinceLast: NO_MOVEMENT, sinceFirst: NO_MOVEMENT,
};

export function exerciseTrend(outings: ExerciseOuting[] | null, status: LoadStatus): ExerciseTrend {
  if (outings == null || status === 'error') return UNREADABLE_TREND;
  const whole = status === 'ready';
  if (!outings.length) {
    // A read still in flight has not established anything, and 'nothing on
    // record' is a statement about a person that must never be made from a
    // question nobody has finished asking.
    if (status === 'loading') return UNREADABLE_TREND;
    return { ...UNREADABLE_TREND, state: 'none', whole, outingCount: whole ? 0 : null };
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
    outingCount: whole ? outings.length : null,
    latest,
    best,
    sinceLast: movementBetween(previous, latest),
    sinceFirst: movementBetween(earliest, latest),
  };
}
