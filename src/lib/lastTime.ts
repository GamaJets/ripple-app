// What you did the last time you did this movement, said in the runner.
//
// ── The fact the app holds and does not say ────────────────────────────────
//
// app/(client)/workouts.tsx seeds the load box for every exercise it opens:
//
//     const sug = suggestForExercise(log, nameOf(cur), cur.reps, 2.5, unit);
//     setLoad(sug ? showLoad(sug.weight) : '');
//
// `Suggestion` carries three fields and the runner uses one of them. `weight`
// goes into the box. `up` and `reason` — "You hit 8 reps at 60 kg — add
// 2.5 kg" — are dropped on the floor. So a member standing at the rack sees a
// number appear in a text field with no provenance whatsoever: they cannot tell
// it from something they typed, they do not know it came from their own last
// session, and they cannot tell whether it is a step up or a repeat.
//
// The same sentence is printed for everybody else who touches that lift.
// app/(client)/progression.tsx renders `tip.rationale` under the target load.
// src/lib/builderProgression.ts was written so the COACH gets `reason` under
// the weight box in the programme builder, and its header states the case in
// one line: "the one number that changes week to week was the one the person
// deciding it had no help with, while the arithmetic sat finished in the
// repository." That is now true of exactly one screen — the one where the
// person deciding is holding the bar.
//
// ── And the silences are worse than the silence ───────────────────────────
//
// Three of the runner's states look identical from the gym floor, because all
// three are an empty load box:
//
//   · the log came back and this member has genuinely never logged this
//     movement;
//   · the log came back CAPPED at PostgREST's ceiling (src/lib/rowCap.ts) and
//     this movement's last outing is older than what came back;
//   · the log read FAILED, on a gym's wifi, and nothing is known at all.
//
// `logStatus` is passed into `SessionRunner` and is read in exactly one place —
// gating the personal-record confetti. Nothing else in the runner consults it,
// so a member whose history could not be read is shown the same blank box as a
// member on their first ever session. src/ui/loadStatus.ts's own header names
// this as the most repeated defect in the codebase, and the runner is one more
// site of it.
//
// A bodyweight movement is the fourth silence and the most common: pull-ups,
// dips, press-ups and planks produce no suggestion at all, because
// `suggestNextWeight` returns null when the top set carried no bar load. The
// member gets an empty box on a movement they did three sessions ago, and no
// way to remember whether it was eight or five.
//
// ── The boundary with progression.ts ──────────────────────────────────────
//
// This module states a FACT — what was done, when, and how the number in the
// box compares to it as arithmetic. It does not have an opinion about what to
// lift next, and it must not grow one: `suggestNextWeight` is the app's single
// progression rule, it is tested, and a second one living here would be two
// rules disagreeing in front of the same person.
//
// `boxNote` therefore never says "add 2.5 kg" and never says "you should".
// It says what the two numbers already on screen are, relative to each other.
// That claim is true whatever put the number in the box — the member's own
// typing included — which is the only reason it is safe to print beside a
// field they can edit.
//
// ── Why the recap is matched by slug and the note is not causal ───────────
//
// `lastSetsFor` in progression.ts matches `e.exercise === exerciseName`
// exactly. This matches on `exerciseSlug`, which is the app's identity for a
// movement and forgives the case and punctuation drift between the builder's
// vocabulary, the catalogue's and the log's. The two can therefore, in
// principle, land on different rows.
//
// Nothing here depends on them agreeing, and that is deliberate. `boxNote`
// compares the number in the box to the top load in the recap ABOVE it — two
// figures a member can see at once — and asserts nothing about where either
// came from. Had it been written as "the suggestion is a step up from your last
// session" it would have been a claim about provenance, and wrong in exactly
// the case the two readers disagree.
//
// ── Why 'partial' still produces a recap ──────────────────────────────────
//
// The same argument builderProgression.ts sets out, and it holds here for the
// same reason. src/ui/workoutLog.tsx reads `.order('performed_at', desc)
// .order('id', desc).limit(capLimit())`, so the rows that come back are the
// NEWEST. Truncation can remove a movement from the read entirely; it cannot
// substitute an older outing for a newer one. A movement that appears at all
// appears with its most recent session intact.
//
// So 'partial' with the movement present is a recap, and 'partial' with the
// movement absent is `unknown` — not `never`. The distinction is the whole
// point: "you have never done this" is a sentence about the member, and saying
// it to somebody whose history was simply cut short is the accusation of
// absence builderProgression.ts had to take back once already.
import type { LoadStatus } from '../ui/loadStatus';
import type { WorkoutEntry } from './mockData';
import { bestSetLabel } from './bestSet';
import { isBodyweightSet } from './bodyweightSets';
import { daysBetweenIso, whenLabel } from './coachWeek';
import { dayKeyOf } from './entryEdit';
import { exerciseSlug } from './exerciseId';
import { isTimedSet, timedSetLabel } from './timedSets';
import { liftDeltaIn, liftLabel, plain, type WeightUnit } from './units';

/**
 * How many set chips are drawn before the rest are counted instead.
 *
 * Eight, because this is read one-handed between sets and a member scanning a
 * strip of pills is looking for a shape, not an inventory. A twelve-set drop
 * ladder that wraps onto three lines is worse than "and 4 more" — and the
 * count is stated rather than the strip silently ending, which is the same
 * rule src/lib/sliceTruncated.ts exists for.
 */
export const MAX_CHIPS = 8;

export interface LastTimeInput {
  /** The member's own logged sessions. Newest first is what the provider
   *  returns, but nothing here depends on the order — the outing is chosen by
   *  comparing timestamps. */
  log: readonly WorkoutEntry[];
  /** The status of THAT read. Never defaulted: the whole point of this module
   *  is that an empty answer means four different things. */
  status: LoadStatus;
  /** The movement, as the runner will log it. */
  exercise: string;
  /** Today, local, bare `YYYY-MM-DD`. From `useToday()`, never `new Date()` —
   *  a session runner is mounted for an hour and the day can turn under it. */
  today: string;
  /** The unit this member reads in. No default, for the reason stated at
   *  length in `suggestForExercise`: an invented unit is how one lift ends up
   *  printed in two metrics on one line. */
  unit: WeightUnit;
  /**
   * The kilograms currently in the load box, or null when it is empty.
   *
   * Kilograms because the box's TEXT is in the member's own unit and the
   * comparison must not be made on a rounded reading — `liftDeltaIn` converts
   * the difference once, at the end, for the same reason `exerciseHistory.ts`
   * subtracts before it converts.
   */
  boxKg?: number | null;
}

/** One set of the last outing, already phrased. */
export interface LastSet {
  /** The phrase, e.g. "60 kg × 8", "8 reps at bodyweight +20 kg", "45 s hold". */
  label: string;
  /** True for a hold. The runner draws these differently from repped sets and
   *  should not have to parse the label to find out which it has. */
  held: boolean;
}

export type LastTime =
  /** The read is still in flight. Nothing is known and nothing is claimed. */
  | { kind: 'loading'; note: string }
  /** The read failed. An empty box means UNKNOWN, not "new to this". */
  | { kind: 'error'; note: string }
  /** The read came back whole and holds no session with this movement in it.
   *  This is the only branch entitled to say "first time". */
  | { kind: 'never'; note: string }
  /** The read came back truncated and holds no session with this movement.
   *  Looks exactly like `never` and is not it. */
  | { kind: 'unknown'; note: string }
  /** What they did. */
  | {
      kind: 'outing';
      /** "Yesterday", "6 days ago", "Today" — or null when the row's timestamp
       *  will not parse, in which case there is no honest way to date it and
       *  the sets are shown without one. */
      when: string | null;
      /** Whole days from that day to `today`; null when either will not parse.
       *  Exposed so a caller can decide how loudly to draw a stale outing
       *  without re-deriving the date. */
      daysAgo: number | null;
      /** The movement as it was written on that day, which may differ in case
       *  or punctuation from what the plan calls it. */
      name: string;
      sets: LastSet[];
      /** Sets beyond `MAX_CHIPS`. Zero in the ordinary case. */
      more: number;
      /** How the number in the load box compares to the heaviest bar load of
       *  that outing. Null when there is nothing in the box, when the outing
       *  put nothing on a bar, or when its top set was a bodyweight set — see
       *  the header. */
      boxNote: string | null;
    };

/**
 * The newest entry for this movement, or null.
 *
 * Timestamps are compared with `Date.parse`, and a row whose stamp will not
 * parse loses to one whose will rather than being dropped: a queued row that
 * came back through a JSON round trip with a mangled `t` is still a session
 * that happened, and it is the only candidate when it is the only candidate.
 */
function latestOuting(log: readonly WorkoutEntry[], slug: string): WorkoutEntry | null {
  let best: WorkoutEntry | null = null;
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const e of log) {
    if (!e || exerciseSlug(e.exercise ?? '') !== slug) continue;
    if (!e.sets?.length) continue;
    const at = Date.parse(String(e.t));
    const rank = Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY;
    if (best == null || rank > bestAt) { best = e; bestAt = rank; }
  }
  return best;
}

/**
 * One stored pair, as a phrase.
 *
 * Every branch of this delegates. `bestSetLabel` owns the repped phrasing —
 * including the bodyweight one, which is the whole reason that module was
 * written — and `timedSetLabel` owns the held one. Writing either out by hand
 * here would make this the fourth hand, and the third hand is what put
 * "104 kg × 12" over a weighted pull-up on the Records hero.
 */
function setPhrase(e: WorkoutEntry, i: number, unit: WeightUnit): LastSet | null {
  const pair = e.sets?.[i];
  if (!pair) return null;
  const first = Number(pair[0]);
  const stored = Number(pair[1]);
  const load = Number.isFinite(stored) && stored > 0 ? stored : 0;
  const bw = isBodyweightSet(e, i);
  if (isTimedSet(e, i)) {
    if (!Number.isFinite(first) || first <= 0) return null;
    return { label: timedSetLabel(first, load > 0 ? liftLabel(load, unit) : null, bw), held: true };
  }
  if (!Number.isFinite(first) || first <= 0) return null;
  return {
    label: bestSetLabel(
      { reps: first, bodyweight: bw, addedKg: bw ? load : 0 },
      bw ? null : (load > 0 ? liftLabel(load, unit) : null),
      bw && load > 0 ? liftLabel(load, unit) : null,
    ),
    held: false,
  };
}

/**
 * The heaviest BAR load of an outing, in kilograms — null when there was none.
 *
 * Bodyweight sets are excluded outright, and this is not an oversight to be
 * tidied up later. Their stored second number is what was ADDED, and their real
 * load is a body weight plus that, which is a figure partly derived from a
 * weigh-in. src/lib/streaks.ts states the prohibition and src/lib/bestSet.ts
 * exists to enforce it: that figure is not a thing that was ever on a bar, and
 * subtracting the number in the load box from it would produce a difference
 * between two quantities that are not the same kind of thing.
 *
 * Holds are excluded because their load was held, not lifted, and because a
 * plank under a 10 kg plate is not a comparison for a squat.
 */
function topBarKg(e: WorkoutEntry): number | null {
  let top: number | null = null;
  const sets = e.sets ?? [];
  for (let i = 0; i < sets.length; i++) {
    if (isTimedSet(e, i) || isBodyweightSet(e, i)) continue;
    const w = Number(sets[i]?.[1]);
    const r = Number(sets[i]?.[0]);
    if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(r) || r <= 0) continue;
    if (top == null || w > top) top = w;
  }
  return top;
}

/**
 * What the box holds, next to what the top set held.
 *
 * Stated as arithmetic between two figures on one screen, never as advice and
 * never as a claim about where the number came from. "Same as" rather than
 * "match it"; "2.5 kg more" rather than "add 2.5 kg".
 *
 * The difference is converted ONCE, through `liftDeltaIn`, rather than by
 * subtracting two separately-rounded readings. That is the defect
 * src/lib/units.ts documents: a genuine 2.5 kg step reading "+5 lb" one week
 * and "+6 lb" the next off nothing the lifter did.
 */
function compareBox(boxKg: number, topKg: number, unit: WeightUnit): string | null {
  const rawDiff = boxKg - topKg;
  const moved = liftDeltaIn(rawDiff, unit);
  if (moved == null) return null;
  // A difference that rounds away in the reader's own unit is not a difference
  // they can act on. 61 kg against 60 kg is 2 lb and worth saying; 60.05 kg is
  // not, and "0.1 lb more" beside a bar nobody can load to it is noise.
  if (Math.abs(moved) < 0.05) return 'The load box is the same as that.';
  const size = `${plain(Math.abs(moved))} ${unit}`;
  return rawDiff > 0
    ? `The load box is ${size} more than that.`
    : `The load box is ${size} less than that.`;
}

/**
 * What to say above the reps and load boxes about the movement on screen.
 *
 * Exactly one of six answers, and five of them are a sentence rather than a
 * recap. A caller may draw them all the same way; what it must not do is
 * collapse `error`, `never` and `unknown` into one blank, which is what the
 * runner does today.
 */
export function lastTime(i: LastTimeInput): LastTime {
  if (i.status === 'loading') {
    return { kind: 'loading', note: 'Looking up what you did last time…' };
  }
  if (i.status === 'error') {
    return {
      kind: 'error',
      note: 'Your training history could not be read, so this cannot show what you last did on this. That is a read that failed rather than a movement you have never done — log the session as normal, it is saved either way.',
    };
  }

  const slug = exerciseSlug(i.exercise ?? '');
  const outing = slug ? latestOuting(i.log, slug) : null;

  if (!outing) {
    if (i.status === 'partial') {
      return {
        kind: 'unknown',
        note: 'Nothing for this movement in the sessions that came back, and your history was cut short at the sessions it could fit — so an older one may exist that is not in it.',
      };
    }
    return {
      kind: 'never',
      note: 'First time logging this one. What you put in below is what the next session gets measured against.',
    };
  }

  const sets: LastSet[] = [];
  for (let n = 0; n < (outing.sets?.length ?? 0); n++) {
    const phrase = setPhrase(outing, n, i.unit);
    if (phrase) sets.push(phrase);
  }

  // Every set of the outing was unreadable — a row of zeroes or NaNs out of a
  // queue. There is a session here and nothing that can be said about it, which
  // is not the same as no session, and is certainly not "first time".
  if (sets.length === 0) {
    return {
      kind: 'unknown',
      note: 'You have logged this movement before, but that session did not record anything readable about the sets.',
    };
  }

  const day = dayKeyOf(outing.t);
  const daysAgo = day ? daysBetweenIso(day, i.today) : null;
  const top = topBarKg(outing);
  const boxKg = i.boxKg;
  const boxNote =
    top != null && typeof boxKg === 'number' && Number.isFinite(boxKg) && boxKg > 0
      ? compareBox(boxKg, top, i.unit)
      : null;

  return {
    kind: 'outing',
    // `whenLabel` is given the outing's day and today's, in that order, and
    // returns "Today" / "Yesterday" / "N days ago". A future day cannot arise
    // from a log, but it returns "In N days" if one ever does rather than an
    // absolute value that would read as the past.
    when: day ? whenLabel(day, i.today) : null,
    daysAgo,
    name: outing.exercise,
    sets: sets.slice(0, MAX_CHIPS),
    more: Math.max(0, sets.length - MAX_CHIPS),
    boxNote,
  };
}
