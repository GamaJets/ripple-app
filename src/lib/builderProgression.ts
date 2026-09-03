// The load this client's own history supports, offered where the coach writes
// the programme.
//
// ── What was already built, and where it was not ───────────────────────────
//
// src/lib/progression.ts is written and tested: `suggestProgression`,
// `suggestNextWeight`, `suggestForExercise`, a double-progression rule, an RPE
// input, and a long note about why it takes a unit and refuses to default one.
// Its importers are app/(client)/coach.tsx, app/(client)/workouts.tsx and
// app/(client)/progression.tsx — all three in the CLIENT app. Nothing under
// app/(trainer)/ imported a line of it.
//
// So the client's phone would tell them "you hit 12 reps at 60 kg, add 2.5 kg",
// and the coach writing next week's programme for that same person had the
// weight box and nothing else. The one number that changes week to week was the
// one the person deciding it had no help with, while the arithmetic sat
// finished in the repository.
//
// ── The read this needs already exists ─────────────────────────────────────
//
// app/(trainer)/builder.tsx has held `reviewLog` — the client's own `workouts`
// rows, same columns and same cap as app/(trainer)/client-training.tsx — since
// the programme checks were added. Nothing new is read here and nothing new is
// asked of the database.
//
// ── The three answers a coach must be able to tell apart ───────────────────
//
// "There is no suggestion" arrives from four different places and only one of
// them is a fact about the client:
//
//   · no client is picked. The screen already says so; this says nothing.
//   · the read has not come back, or failed. NOT a client with no history.
//   · the read came back WHOLE and holds no sets for this movement. That IS a
//     fact about the client: they have never logged it.
//   · the read came back TRUNCATED and holds no sets for this movement. This is
//     the one that looks like the line above it and is not: their last press
//     may simply be older than the sessions that came back.
//
// ── Why 'partial' is allowed to produce a suggestion at all ────────────────
//
// It is worth being explicit, because the same screen's volume check declines
// on 'partial' and a reader will reasonably ask why this one does not.
//
// The volume check compares a written programme against the client's HEAVIEST
// ever session, and the cap drops the OLDEST rows — so a prefix can be missing
// exactly the sessions that would have refuted "more than she has ever done".
// A finding from half a record is a finding about the read.
//
// This one asks a different question: what did they do LAST TIME. The read is
// ordered `performed_at desc`, so the newest session for any movement that
// appears at all is present and complete. Truncation can only remove the
// question, never change the answer: a movement whose last outing fell off the
// end produces no suggestion, and no suggestion is the safe direction. What it
// must not do is let that silence be reported as "they have never done this",
// which is the branch above.
import type { LoadStatus } from '../ui/loadStatus';
import type { WorkoutEntry } from './mockData';
import { lastSetsFor, suggestForExercise } from './progression';
import type { WeightUnit } from './units';

export interface ProgressionInput {
  /** Whether a client is selected at all. With none there is nobody to have a
   *  history, and the screen says so elsewhere. */
  clientPicked: boolean;
  /** The client's logged sessions, newest first, or null when no read was
   *  issued or the read failed. Never [] for a failure — that is a client who
   *  has logged nothing. */
  log: WorkoutEntry[] | null;
  status: LoadStatus;
  /** The movement as written in the programme. Matched against the log by name,
   *  which is how `lastSetsFor` matches and is the same string the client's own
   *  Train tab logs under. */
  exercise: string;
  /** The rep target as the coach typed it — "8-12", "10", "45 sec". A target
   *  the parser cannot read is not an error: `parseRepRange` returns null and
   *  the suggestion becomes "match last", which is still useful. */
  reps: string;
  /** The COACH's reading unit, because this sentence is read by the coach on
   *  their own screen. Optional and never defaulted: progression.ts refuses a
   *  default unit and returns wording with the load left out instead. */
  unit?: WeightUnit;
}

/**
 * What to offer under the weight box.
 *
 * 'suggestion'  a load, in KILOGRAMS, and the sentence that justifies it.
 *               Kilograms because `BEx.loadKg` is kilograms and the whole log
 *               is metric — the unit is a reading convention and the caller
 *               renders it with `liftLabel`.
 * 'silent'      there is nothing to say and nothing to draw. A client who is
 *               not picked, and a read nobody issued.
 * 'gap'         there is no suggestion and the coach should be told WHY,
 *               because the reason changes what they do next.
 */
export type ProgressionOffer =
  | { kind: 'suggestion'; weightKg: number; reason: string; up: boolean }
  | { kind: 'silent' }
  | { kind: 'gap'; note: string };

export function progressionOffer(i: ProgressionInput): ProgressionOffer {
  if (!i.clientPicked) return { kind: 'silent' };
  if (i.status === 'loading') return { kind: 'gap', note: 'Reading what they have lifted…' };
  if (i.status === 'error') {
    // The sentence this branch exists to refuse is "they have never logged
    // this". A coach who believes that writes a beginner's load for somebody
    // who has been pressing 80 for a year.
    return {
      kind: 'gap',
      note: 'Their training could not be read, so there is nothing here to base a load on. That is a read that failed rather than a client with no history — reopen the screen once you have signal.',
    };
  }
  // No read was issued at all — a hand-added client with no account, or a build
  // with no backend. Not a gap to explain on every exercise row of the week.
  if (i.log == null) return { kind: 'silent' };

  const s = suggestForExercise(i.log, i.exercise, i.reps, 2.5, i.unit);
  if (s) return { kind: 'suggestion', weightKg: s.weight, reason: s.reason, up: s.up };

  // ── logged, with nothing on the bar ───────────────────────────────────
  //
  // `suggestNextWeight` returns null in exactly two situations: the movement
  // has no logged sets at all, and its last session's heaviest set carried no
  // load. The second is every bodyweight movement in the catalogue — press-ups,
  // pull-ups, dips, a plank — and both fell through to the sentence at the
  // bottom of this function, which told the coach the client had not logged the
  // movement. They had. A coach writing next week's programme was reading an
  // accusation of absence about somebody who did the work on Tuesday.
  //
  // `lastSetsFor` is the same reader `suggestNextWeight` is given its sets by,
  // so the two cannot come to disagree about whether anything was logged.
  const last = lastSetsFor(i.log, i.exercise);
  if (last && last.length) {
    return {
      kind: 'gap',
      note: 'They have logged this movement with no weight on it, so there is no load of theirs to build from. That is bodyweight work they did, not a movement they have never done.',
    };
  }

  if (i.status === 'partial') {
    // THE distinction. The cap drops the oldest sessions, so a movement whose
    // last outing is older than what came back is silent here — and reporting
    // that silence as "they have never done this" is a claim about a person
    // made from a prefix of their record.
    return {
      kind: 'gap',
      note: 'Nothing logged for this movement in the sessions that came back. Their history was longer than one read returns, so this is not a statement that they have never done it.',
    };
  }
  return {
    kind: 'gap',
    note: 'They have not logged this movement, so there is no weight of their own to build from.',
  };
}

/**
 * The tap's own label — what pressing it will put in the box.
 *
 * Takes the already-rendered load rather than formatting one, because
 * `liftLabel` is the caller's and a second formatter here is a second rounding.
 * Null when the load could not be rendered, which is the caller's cue to offer
 * no tap at all: a button reading "Use —" is worse than no button.
 *
 * Deliberately NOT called `useLoadLabel`. It is a plain function called from
 * inside a render callback, and a `use` prefix on something that is not a hook
 * is how somebody later moves it, or the linter's rules-of-hooks check fires on
 * a call site that is perfectly correct.
 */
export function loadTapLabel(rendered: string | null): string | null {
  return rendered ? `Use ${rendered}` : null;
}

/** True when the suggestion is already what is in the box, in kilograms.
 *  Compared at one decimal place, which is the resolution the increment ladder
 *  works in (2.5 kg steps, rounded to the nearest half). Offering "Use 62.5"
 *  beside a box already reading 62.5 is a control that does nothing, and a
 *  coach who presses it once learns to distrust the row. */
export function alreadyAt(suggestedKg: number, currentKg: number | null | undefined): boolean {
  if (currentKg == null || !Number.isFinite(currentKg)) return false;
  return Math.round(suggestedKg * 10) === Math.round(currentKg * 10);
}
