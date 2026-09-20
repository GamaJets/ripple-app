// A movement's own written instructions, and the several different reasons
// there might be none.
//
// ── what was actually there ───────────────────────────────────────────────
//
// `exercises.instructions` is a `text[]` of ordered steps and `exercises.tips`
// is the coaching cues beside them (supabase/parts/71-exercise-catalogue.sql,
// 74-repdb-catalogue.sql). Between them they are the single largest thing in the
// catalogue — the note on `CatalogueRow.met` in src/ui/exerciseDetail.ts prices
// `instructions` alone at 199 kB across the table, which is the reason the list
// read deliberately leaves it out.
//
// One screen reads it: app/(client)/exercise.tsx, the standalone movement page.
// The SESSION RUNNER does not. A member standing at the rack, mid-set, unsure
// whether the bar path is right, could open a demonstration — `SessionDemo` in
// app/(client)/workouts.tsx resolves clip → animation → reference frames — and
// could not read a single word of how the movement is performed, on a screen
// whose entire job is performing it. The steps were three taps and one abandoned
// session away, on a screen they would have to leave the runner to reach.
//
// This is the same shape as the `met` column another lane found: 601 of 608 rows
// populated, no reader. The catalogue has form for carrying data nothing shows.
//
// ── why this is a rule and not four lines of JSX ──────────────────────────
//
// Because "there are no steps" has four different causes and only one of them is
// a fact about the movement:
//
//   the read is still in flight        — nothing is known yet
//   the read failed                    — we could not look
//   nobody is signed in                — the catalogue's policy is `to
//                                        authenticated`, so PostgREST returns
//                                        an EMPTY RESULT and calls it success
//   the row exists and carries none    — 41 rows predate the RepDB import
//   there is no row                    — a coach typed their own movement
//
// Collapsing those into one "No steps for this one" is the defect this codebase
// keeps re-finding: a member told their movement has no guide, when the truth is
// that their session expired, concludes their coach left them to guess. Every
// arm below is a different sentence for that reason, and the decision is here —
// assertable under plain node — rather than in a chain of ternaries inside a
// 5,800-line screen.
//
// ── what this does NOT do ─────────────────────────────────────────────────
//
// It does not shorten, summarise, re-order or cap the steps. A rack-side reader
// wants them short, and the honest way to get there is a disclosure the member
// opens — not step four of six with "lower it under control" removed. A
// truncated instruction is worse than a long one for exactly the reason a
// rounded progression step is worse than an awkward one: it changes the advice.
//
// It also does not merge `tips` into `instructions`. They are separate columns
// because they answer different questions, and app/(client)/exercise.tsx already
// wrote down why: "a client following the sequence needs it in order; a client
// who already knows the movement wants the cue, and a cue buried at step six is
// a cue they have stopped reading before they reach".
import type { LoadStatus } from '../ui/loadStatus';

/** What a screen should draw for one movement's instructions. */
export type StepsView =
  /** Ordered steps, and any cues to keep beside (not inside) them. */
  | { kind: 'steps'; steps: string[]; tips: string[] }
  /** Cues but no ordered steps — a real state: the two columns are filled
   *  independently and a row can carry one without the other. Shown rather than
   *  suppressed, because a cue is still the answer to "am I doing this right". */
  | { kind: 'tips'; tips: string[] }
  /** Nothing to show, and the sentence saying which nothing it is. */
  | { kind: 'none'; note: string };

export interface StepsInput {
  /** `exercises.instructions`, already filtered to non-blank strings by
   *  `useExerciseDetail`. Undefined or null where the row has not been read. */
  instructions?: string[] | null;
  /** `exercises.tips` — the coaching cues. */
  tips?: string[] | null;
  /** How the catalogue read went. */
  status: LoadStatus;
  /** True when the empty result is because nobody is signed in rather than
   *  because the movement is absent. `useExerciseDetail` works this out. */
  signedOut?: boolean;
  /** Whether a catalogue row came back at all. False with status 'ready' is a
   *  real answer — a movement a coach invented has no row. */
  hasRow: boolean;
}

/** Non-blank strings only, and never the same array back — a screen must not be
 *  able to mutate the catalogue's own copy through what it was handed. */
const lines = (v: string[] | null | undefined): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim() !== '').map((s) => s.trim()) : [];

/**
 * What to draw for a movement's instructions, mid-session.
 *
 * The order of the tests is the point. Steps that HAVE arrived are shown
 * whatever the status says, because text in hand is text in hand — it is only
 * the ABSENCE that needs a status to interpret it, and that is the direction the
 * bug always runs in.
 */
export function movementSteps(input: StepsInput): StepsView {
  const steps = lines(input.instructions);
  const tips = lines(input.tips);
  if (steps.length) return { kind: 'steps', steps, tips };
  if (tips.length) return { kind: 'tips', tips };
  return { kind: 'none', note: noSteps(input) };
}

/**
 * Which "no steps" this is, in the member's own words.
 *
 * Every sentence here is about what WE can or cannot see. None of them says or
 * implies that the member has done anything wrong, and none of them states a
 * fact about the catalogue that this read is not entitled to state.
 */
function noSteps({ status, signedOut, hasRow }: StepsInput): string {
  if (status === 'loading') return 'Looking up how this one is done…';
  if (status === 'error') {
    return 'We could not reach the exercise catalogue, so we cannot show you the steps for this one.';
  }
  // 'partial' cannot currently arrive from `useExerciseDetail` — it reads one
  // row by id and never pages. It is answered anyway, because the union permits
  // it and the alternative is a silent fallthrough to "no written steps yet",
  // which is precisely the class of wrong statement this whole module exists to
  // prevent. A read that admits it was incomplete must not be read as complete.
  if (status === 'partial') {
    return 'Only part of the exercise catalogue could be read, so we cannot tell you whether there are written steps for this one.';
  }
  if (signedOut) {
    return 'The exercise library is only available once you are signed in, so the steps could not be looked up.';
  }
  if (!hasRow) {
    return 'This movement is not in our catalogue, so we have no written steps for it. If your coach wrote it into your program, ask them how they want it done.';
  }
  // The row is there and genuinely carries nothing. Said plainly, and said as a
  // gap in OUR catalogue rather than as a peculiarity of their program.
  return 'No written steps for this one yet.';
}

/**
 * The count beside the heading — "6 steps", "3 cues".
 *
 * Here rather than in the screen because the singular is the sort of thing that
 * gets written once correctly and then copied wrongly, and because a count is a
 * figure: it is drawn off the array that is actually being rendered, so it
 * cannot claim six steps over five.
 */
export function stepsCountLabel(n: number, noun: 'step' | 'cue'): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
