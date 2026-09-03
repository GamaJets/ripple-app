// The member's own half of the comparison their coach has been reading.
//
// ── What exists, and who it was written for ────────────────────────────────
//
// src/lib/planVsActual.ts reconciles the programme against the log. It is
// careful, tested, and states four things it refuses to say — no completed
// sessions, no named weekdays, no percentage, and never "not done" over a read
// that was not whole. Its only importer is app/(trainer)/client-training.tsx.
//
// So a coach can open a screen and read "9 of 12 prescribed movements logged in
// the last 28 days, and 3 movements logged that this programme does not name",
// and the person who did or did not do those movements has no way to see it.
// app/(client)/week.tsx draws the seven rows of the plan and marks a day
// "Logged" when ANYTHING was logged on it — which is a different claim
// altogether, and one that says nothing about whether what was logged is what
// was written. A member can be marked "Logged" on all three of their training
// days for a month and still not have touched a single prescribed leg movement.
//
// ── Why this module rather than calling `coverageLine` ────────────────────
//
// Because that sentence is in the third person and is addressed to somebody
// making a decision about another person: "Their logged training could not be
// read", "they are on no coach-assigned programme". Turning it round with a
// pronoun swap would produce prose, and the wrong prose: a coach is being told
// what to write next week, and a member is being told where their week actually
// went. Those are different sentences even where they are the same arithmetic.
//
// The arithmetic is NOT duplicated. Every fact below comes out of
// `planVsActual`, and the moment a rule about coverage lives in two files the
// coach's screen and the member's screen start disagreeing about the same
// month — which is exactly the class of bug that module's own header sets out
// to avoid.
//
// ── What it does not do ───────────────────────────────────────────────────
//
// It does not produce a score, a percentage, a streak or a grade. It does not
// say a session was missed, because src/lib/coachWeek.ts's `coachPlanLine`
// already establishes that an unlogged session and a session that did not
// happen look identical from here, and telling somebody they skipped a workout
// they did is the fastest way to make them stop reading.
//
// It does not treat off-plan work as a failure. A member who swapped a barbell
// row for a machine because the rack was busy has trained; the programme simply
// does not name what they did. `offPlan` is stated as information, in a
// sentence that says what it is for — so their coach can be told — rather than
// as a correction.
//
// ── The window is a window ────────────────────────────────────────────────
//
// `WINDOW_IS_NOT_A_WEEKDAY` is `planVsActual`'s own disclaimer and it is
// carried through unchanged rather than reworded. Its reason holds identically
// on this side: a logged set is an instant, and "you missed Tuesday" is not a
// sentence this data supports.
import type { MovementCheck, PlanVsActual } from './planVsActual';

/**
 * How many movements are named before the rest are counted instead.
 *
 * Five. This is a line on a plan screen, not an inventory, and a member reading
 * eleven movement names in a row is reading a telling-off. The remainder is
 * COUNTED rather than dropped — a list that simply stops is a list the reader
 * takes for the whole of it.
 */
export const MAX_NAMED = 5;

/** A list of movements, with what did not fit counted rather than lost. */
export interface NamedList {
  names: string[];
  more: number;
}

function named(ms: readonly MovementCheck[]): NamedList {
  return { names: ms.slice(0, MAX_NAMED).map((m) => m.name), more: Math.max(0, ms.length - MAX_NAMED) };
}

/** Movements and the sentence for them, joined the way a reader reads them. */
function phrase(list: NamedList): string {
  const n = list.names.join(', ');
  return list.more > 0 ? `${n} and ${list.more} more` : n;
}

export type MyPlanWeek =
  /**
   * Nothing below is a fact about this member: a read failed or is still in
   * flight. Its own sentence, because an empty comparison drawn silently is
   * read as "you have done none of it".
   */
  | { kind: 'unreadable'; note: string }
  /** No coach has assigned a programme. Not a failure and not an empty state
   *  to apologise for — the app generates one, and this says so. */
  | { kind: 'no-programme'; note: string }
  /** A programme with nothing in it. */
  | { kind: 'empty'; note: string }
  /** The read did not reach back far enough to answer for anything. */
  | { kind: 'unanswerable'; note: string }
  /** The comparison. */
  | {
      kind: 'ready';
      /** The headline, counting movements and never sessions. */
      note: string;
      logged: number;
      total: number;
      /** Movements the read can state have not appeared. Named, capped. */
      missing: NamedList;
      /** The sentence for them, or null when there are none — which is the
       *  good state and gets a sentence of its own on `note`. */
      missingNote: string | null;
      /** Movements the read cannot answer for. Never folded into `missing`. */
      unanswered: NamedList;
      unansweredNote: string | null;
      /** What they logged that the programme does not name. Information, not a
       *  correction — see the header. */
      offPlanNote: string | null;
      /** `planVsActual`'s own disclaimer, carried through unchanged. */
      caveat: string;
    };

const s = (n: number) => (n === 1 ? '' : 's');

/**
 * What to say to the member about their own programme and their own log.
 *
 * `windowDays` is the window the caller asked `planVsActual` for and is printed
 * rather than assumed — the constant in that module is 28 and a client screen
 * comparing this week's plan will pass 7, so restating either here would
 * eventually print a window nobody used.
 */
export function myPlanWeek(pva: PlanVsActual, windowDays: number): MyPlanWeek {
  if (pva.state === 'unreadable') {
    return {
      kind: 'unreadable',
      note: 'Your programme or your training log could not be read, so nothing here compares them. That is a read that did not land — it is not a week with nothing in it.',
    };
  }
  if (pva.state === 'no-programme') {
    return {
      kind: 'no-programme',
      note: 'No coach has written you a programme yet, so there is nothing here to measure your training against. The plan above is the one this app builds from your goal.',
    };
  }

  const all = pva.movements;
  if (!all.length) {
    return { kind: 'empty', note: 'This programme names no movements, so there is nothing to compare.' };
  }

  const loggedM = all.filter((m) => m.coverage === 'logged');
  const missingM = all.filter((m) => m.coverage === 'not-logged');
  const unknownM = all.filter((m) => m.coverage === 'unknown');

  if (unknownM.length === all.length) {
    // The log read failed, or it came back at the row cap before reaching the
    // start of the window. Both arrive here as a list of unknowns, and the
    // sentence names the READ rather than the member — because the one thing
    // they must not take from an empty comparison is that they did none of it.
    return {
      kind: 'unanswerable',
      note: `Your training could not be read back over the last ${windowDays} days, so none of these ${all.length} movement${s(all.length)} can be answered for. That is about the read, not about your week.`,
    };
  }

  const missing = named(missingM);
  const unanswered = named(unknownM);

  return {
    kind: 'ready',
    note: `You have logged ${loggedM.length} of the ${all.length} movement${s(all.length)} your programme names, in the last ${windowDays} days.`,
    logged: loggedM.length,
    total: all.length,
    missing,
    missingNote: missingM.length
      ? `Not logged in that window: ${phrase(missing)}.`
      // Said out loud, because it is the whole point of the comparison and the
      // one state a member deserves to be told about rather than left to infer
      // from an absent list.
      : null,
    unanswered,
    unansweredNote: unknownM.length
      ? `${unknownM.length} more cannot be answered for — your history did not come back far enough to cover the window: ${phrase(unanswered)}.`
      : null,
    offPlanNote: pva.offPlan.length
      ? `You also logged ${pva.offPlan.length} movement${s(pva.offPlan.length)} this programme does not name: ${pva.offPlan.slice(0, MAX_NAMED).join(', ')}${pva.offPlan.length > MAX_NAMED ? ` and ${pva.offPlan.length - MAX_NAMED} more` : ''}. That is worth telling your coach — it is the half of your week their screen cannot explain.`
      : null,
    caveat: CAVEAT,
  };
}

/**
 * The disclaimer, in the member's own voice.
 *
 * Same claim as `WINDOW_IS_NOT_A_WEEKDAY` and the same reason: a logged set is
 * an instant, this app holds no timezone for a member's history, and nothing
 * here can say a Tuesday session happened on their Tuesday. Reworded only
 * because the coach's version explains the schema to somebody who is not being
 * accused by it, and the member's needs to say what it means for them —
 * which is that nothing on this line is calling any particular day a miss.
 */
export const CAVEAT =
  'This counts movements over a window of days, never against a named weekday, and it never says a session was missed — an unlogged session and a session that did not happen look the same from here.';

/**
 * The one line the good state gets.
 *
 * Separate from `note` because a member who has logged everything should be
 * told so in a sentence rather than left to notice the absence of a list. It is
 * not congratulation and not a streak; it is the answer to the question they
 * opened the screen with.
 */
export function allLoggedNote(r: MyPlanWeek, windowDays: number): string | null {
  if (r.kind !== 'ready') return null;
  if (r.missing.names.length || r.missing.more) return null;
  if (r.unanswered.names.length || r.unanswered.more) return null;
  return `Every movement your programme names has been logged in the last ${windowDays} days.`;
}
