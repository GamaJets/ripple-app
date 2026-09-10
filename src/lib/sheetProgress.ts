// The coach's sheet, against the last time their client did this movement.
//
// "Show the progress from the last time this exercise was done and show the
// difference / improvement between the 2 sessions so this way coach and client
// can see what progress is being made in that exercise."
//
// ── Not to be confused with src/lib/lastTime.ts ───────────────────────────
//
// That module answers the same English question from the other chair, and the
// two are deliberately separate. `lastTime` speaks to a MEMBER mid-session in
// the runner: it phrases one outing as chips they read one-handed between sets,
// and compares the number in the load box to the top set above it. It is
// wording.
//
// This is arithmetic, for a COACH writing up a whole session for somebody else.
// It folds a sheet of typed sets into figures and diffs them against an outing.
// There is no overlap in what they compute and none in what they return, and
// merging them would produce a module with two audiences and two shapes.
//
// ── The trail is not rebuilt here ─────────────────────────────────────────
//
// src/lib/exerciseHistory.ts folds a person's log into `ExerciseOuting`s, one
// per day, and every figure compared against is a field on the newest of them.
// What was missing is the OTHER side — the sets the coach is typing right now,
// which are not in the log yet and by definition cannot be.
//
// `SheetTally` is therefore a structural subset of `ExerciseOuting`: same field
// names, same units, same rules about when a figure is null. That is why
// `compareToLast` takes an outing straight from the history with no adapter and
// no second definition of what "top set" means. Two definitions is how one
// movement comes to read two ways on two screens drawn from the same rows, and
// this repo has the scar.
//
// Every figure here is KILOGRAMS, because that is what `workouts` stores. This
// file converts nothing. src/ui/ExerciseHistory.tsx states the rule and the
// reason: the render boundary converts, once, with `liftLabel` / `liftDeltaIn`
// / `est1RMIn` / `volumeIn`, which is what stops a genuine 2.5 kg progression
// reading "+5 lb" one week and "+6 lb" the next off nothing the lifter did.
//
// ── The trap this file exists to encode ───────────────────────────────────
//
// A coach's obvious question is "are they lifting more than last time", and the
// obvious answer is to subtract last week's top set from this week's. Do that
// and 8 × 60 kg followed by 5 × 70 kg reports MINUS THREE REPS, in a row headed
// progress, about a session that went up ten kilograms.
//
// Reps at the top load are only comparable when the top load is the same. When
// it is not, `topReps` is null and `sameTopLoad` says why — and the figure that
// answers the question honestly across a changed load is the estimated 1RM,
// which is why it is carried.
//
// ── And nothing here decides whether a change is good ─────────────────────
//
// The word in the request was "improvement". A screen that assumes it is what
// greeted a member on a fat-loss block whose bench has held steady with a
// disappointment they had not earned. So every movement is a signed figure and
// nothing more; `deltaLabel` gives a movement of nothing no sign at all, and
// the meaning is the conversation the two of them have next. That is the same
// decision src/ui/ExerciseHistory.tsx made for the panel this sits beside.
import { est1RM } from './streaks';

/**
 * What a set list amounts to, in kilograms.
 *
 * Field for field the same as the matching part of `ExerciseOuting`, including
 * every rule about when something is null rather than nought:
 *
 *   · `volumeKg` is null, never 0, when no set has a knowable load. A session
 *     of eight bodyweight sets is not a session of no work.
 *   · `topLoadKg` is null on a day with no knowable load, and `topReps` is null
 *     exactly when it is.
 *   · `best1RMKg` is null when nothing carried a load. Epley, through the app's
 *     only 1RM formula, asked rather than rewritten.
 */
export interface SheetTally {
  /** Sets with a rep count above zero. A blank row is not a set of none. */
  setCount: number;
  /** Σ reps across those sets. */
  reps: number;
  /** Σ reps × load over the sets whose load is known; null when none is. */
  volumeKg: number | null;
  /** The heaviest load touched; null when no load is known. */
  topLoadKg: number | null;
  /** The most reps achieved at that heaviest load. Null exactly when
   *  `topLoadKg` is. */
  topReps: number | null;
  /** The best estimated 1RM across the sets; null when nothing carried a load. */
  best1RMKg: number | null;
}

/** A tally of nothing. Every figure null or zero for a reason it can defend:
 *  no sets were done, so no reps were done, and every load-derived figure is
 *  unknown rather than nought. */
const NOTHING: SheetTally = {
  setCount: 0, reps: 0, volumeKg: null, topLoadKg: null, topReps: null, best1RMKg: null,
};

/**
 * Fold the sets on the sheet into the same shape the history is in.
 *
 * `sets` are `[reps, kg]` with a null load for a set whose load is not known —
 * an empty weight box, or a bodyweight movement. Null and NOT nought: a stored
 * 0 and a load nobody entered cannot be told apart afterwards, which is the
 * argument src/lib/bodyweightSets.ts makes at length.
 *
 * Rows with no rep count are skipped, exactly as `entriesToWrite` skips them
 * when it saves. What is compared is what will be written; a sheet half typed
 * compares as far as it has been typed, and the figures move as the coach fills
 * boxes in, which is the point.
 */
export function sheetTally(sets: readonly (readonly [number, number | null])[] | null | undefined): SheetTally {
  if (!sets || !sets.length) return NOTHING;
  let setCount = 0, reps = 0;
  let volume = 0, anyVolume = false;
  let topLoad: number | null = null, topReps: number | null = null;
  let best: number | null = null;

  for (const s of sets) {
    const r = s?.[0];
    if (typeof r !== 'number' || !Number.isFinite(r) || r <= 0) continue;
    setCount++;
    reps += r;
    const load = s[1];
    if (typeof load !== 'number' || !Number.isFinite(load)) continue;
    volume += r * load; anyVolume = true;
    // The heaviest load, and the most reps AT it — the second clause is what
    // makes 8 × 100 beat 5 × 100 without letting 12 × 60 beat either.
    if (topLoad == null || load > topLoad) { topLoad = load; topReps = r; }
    else if (load === topLoad && (topReps == null || r > topReps)) topReps = r;
    const e1 = est1RM(load, r);
    if (best == null || e1 > best) best = e1;
  }

  return {
    setCount, reps,
    volumeKg: anyVolume ? volume : null,
    topLoadKg: topLoad, topReps,
    best1RMKg: best,
  };
}

/**
 * The difference between what is on the sheet and what they did last time.
 *
 * Every figure is null unless BOTH sides have a real one. A missing side is not
 * a zero and a change against nothing is not a change: this app's rule is that
 * a figure which cannot be derived from something somebody recorded renders as
 * a dash with a reason, and `deltaLabel` prints exactly that for a null.
 */
export interface SheetDelta {
  /** Kilograms on the heaviest set. */
  topLoadKg: number | null;
  /**
   * Reps at the heaviest set — ONLY when the heaviest load was the same on
   * both days. See the header: across a changed load this figure answers a
   * different question from the one it appears to answer.
   */
  topReps: number | null;
  /** Whether the two days' top loads were the same, which is what decides
   *  `topReps`. False when either side has no knowable load at all. */
  sameTopLoad: boolean;
  /** Kilograms of tonnage. */
  volumeKg: number | null;
  /** Repetitions across the movement. */
  reps: number | null;
  /** Sets done. */
  setCount: number | null;
  /** Estimated 1RM, in kilograms — the figure that stays comparable when the
   *  load changed, which is the ordinary case for a progressing lifter. */
  best1RMKg: number | null;
}

const NO_DELTA: SheetDelta = {
  topLoadKg: null, topReps: null, sameTopLoad: false,
  volumeKg: null, reps: null, setCount: null, best1RMKg: null,
};

/** Subtract, but only where both ends are real. */
const diff = (now: number | null, then: number | null): number | null =>
  (typeof now === 'number' && Number.isFinite(now) && typeof then === 'number' && Number.isFinite(then))
    ? now - then
    : null;

/**
 * `now` against `last`.
 *
 * `last` is an `ExerciseOuting` from src/lib/exerciseHistory.ts, passed
 * straight in — the field names and units are the same by construction. Null
 * when this movement has not been done before, or when the read that would
 * have found it did not land, and the whole comparison is then withheld rather
 * than shown against zero.
 */
export function compareToLast(now: SheetTally, last: SheetTally | null | undefined): SheetDelta {
  if (!last) return NO_DELTA;
  // Nothing typed yet is not a session of nothing. A sheet the coach has only
  // just opened would otherwise report the whole of last week as a loss.
  if (now.setCount <= 0) return NO_DELTA;

  const sameTopLoad =
    typeof now.topLoadKg === 'number' && typeof last.topLoadKg === 'number' &&
    now.topLoadKg === last.topLoadKg;

  return {
    topLoadKg: diff(now.topLoadKg, last.topLoadKg),
    topReps: sameTopLoad ? diff(now.topReps, last.topReps) : null,
    sameTopLoad,
    volumeKg: diff(now.volumeKg, last.volumeKg),
    reps: diff(now.reps, last.reps),
    setCount: diff(now.setCount, last.setCount),
    best1RMKg: diff(now.best1RMKg, last.best1RMKg),
  };
}

/**
 * Why the reps figure is missing, or null when it is not missing.
 *
 * Said rather than left as a dash, because a blank where a number was a moment
 * ago reads as a bug — and the actual reason is interesting: they changed the
 * weight, which is usually the thing the coach wanted to know.
 */
export function topRepsNote(d: SheetDelta): string | null {
  if (d.topReps != null || d.sameTopLoad) return null;
  if (d.topLoadKg == null) return null;
  return d.topLoadKg === 0
    ? null
    : 'The top set was at a different weight, so reps are not compared — the estimated 1RM is the figure that carries across a change of load.';
}

/**
 * Whether there is anything at all to draw.
 *
 * A comparison in which every figure is null is not a comparison, and a row of
 * six dashes under a movement is worse than no row: it reads as six things that
 * failed rather than as a first session.
 */
export function hasComparison(d: SheetDelta): boolean {
  return d.topLoadKg != null || d.topReps != null || d.volumeKg != null
    || d.reps != null || d.setCount != null || d.best1RMKg != null;
}

/**
 * What each set of this movement was LAST time, aligned to the sheet's rows.
 *
 * The shape a coach asked for after seeing it elsewhere: a PREVIOUS column
 * beside the boxes, so set 3's target sits on set 3's line rather than in a
 * sentence above the table that has to be held in the head while typing.
 *
 * Returns one entry per row of the CURRENT sheet, in order, each either the
 * matching set from the last outing or null. Null is drawn as a dash and means
 * exactly one thing: there was no set in that position last time. It does NOT
 * mean the history could not be read — that is a different fact, it is about
 * the read rather than about the person, and the screen says it in words
 * instead of leaving a column of dashes to be interpreted.
 *
 * Position, not best-effort matching. Set 3 last time is what set 3 is compared
 * against, even when last time was a ramp and today is not; anything cleverer
 * would be this file guessing which set a coach means, and being wrong on a drop
 * set is worse than being literal.
 *
 * KILOGRAMS, and no formatting. `loadKg` is null for a set whose load is not
 * knowable — a bodyweight set, or one logged before the flag existed — and the
 * screen decides how to say that in the reader's own unit. Converting here
 * would put the render boundary in two places, which src/ui/ExerciseHistory.tsx
 * argues at length against.
 *
 * Holds are not in `ExerciseOuting.sets` and so cannot appear: their first
 * number is seconds, and a coach's sheet that printed "45 × 10 kg" over a plank
 * would be inviting somebody to type forty-five reps.
 */
export interface PreviousSet {
  reps: number;
  loadKg: number | null;
}

export function previousSets(
  last: { sets?: readonly (readonly [number, number | null])[] } | null | undefined,
  count: number,
): (PreviousSet | null)[] {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  const src = last?.sets ?? [];
  const out: (PreviousSet | null)[] = [];
  for (let i = 0; i < n; i++) {
    const s = src[i];
    const reps = s?.[0];
    if (typeof reps !== 'number' || !Number.isFinite(reps) || reps <= 0) { out.push(null); continue; }
    const load = s?.[1];
    out.push({ reps, loadKg: typeof load === 'number' && Number.isFinite(load) ? load : null });
  }
  return out;
}
