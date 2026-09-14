// The rep count that feeds the 1RM estimator, and where Epley stops being one.
//
// ── The number the screen would print ─────────────────────────────────────
//
// app/(client)/tools.tsx reads its weight box through `readLift`, which refuses
// anything over 600 kg because it is "heavier than anyone has lifted". The rep
// box beside it was `parseInt(r, 10) || 0` and nothing else. So the screen
// refused an INPUT of 700 kg and then happily printed an estimated one-rep max
// of 3,430 kg from 100 kg × 999 reps — as its one hero figure, in the member's
// own unit, under the words "Estimated 1RM · Epley", with a note saying exactly
// which set it came from. A wrong number presented as a right one, which that
// file's own header calls the failure this codebase cares most about.
//
// Negatives got through too. `parseInt('-5')` is -5, and Epley of a negative
// rep count is a smaller positive number: 100 kg × -5 reps printed 83 kg.
//
// ── Why 30 is a refusal and 12 is a caveat ────────────────────────────────
//
// Epley is `w × (1 + reps/30)`. It is a straight line, and a straight line
// through a curve is close near the point it was fitted to and wrong far from
// it. Strength references quote it over roughly the first ten to twelve reps
// and stop; past that it runs high, and by thirty reps it has doubled the load,
// which is arithmetic rather than an estimate of anything.
//
// So there are two different statements to make and they must not be collapsed:
//
//   1–12    the formula is inside the range it is quoted over. Say nothing.
//   13–30   it still answers, and it runs high. The figure is a CEILING, and
//           the screen says so beside it rather than withholding a number
//           somebody doing a set of fifteen can legitimately want.
//   31+     refused. There is no reading of "a one-rep max estimated from
//           thirty-one reps" that is worth printing, and printing it with a
//           caveat underneath would still put the figure on the screen.
//
// A refusal a member can act on — do a heavier set for fewer reps — is worth
// more than a caveat under a figure they will remember and not the words.
//
// Pure: strings and arithmetic, no react and no storage, so both rules are
// asserted under `npm test` without a device.
import { readNumber } from './units';

/** The last rep count Epley is conventionally quoted over. */
export const EPLEY_CLEAN_REPS = 12;
/** The last rep count this screen will answer at all. */
export const EPLEY_MAX_REPS = 30;

export type RepRead =
  | { ok: true; reps: number | null }
  | { ok: false; reason: string };

/**
 * Read the rep box, or the sentence to show whoever typed it.
 *
 * An empty box is `reps: null` — nothing typed is not a refusal, it is the
 * state the screen opens in and it already has its own sentence for it.
 */
export function readReps(text: string | number | null | undefined): RepRead {
  if (text == null || String(text).trim() === '') return { ok: true, reps: null };
  // `readNumber` rather than parseInt, so "abc" is null instead of NaN-then-0,
  // and so a stray decimal is seen rather than silently truncated below.
  const n = readNumber(text);
  if (n == null) return { ok: false, reason: 'That rep count is not a number.' };
  if (!Number.isInteger(n)) return { ok: false, reason: 'Reps are whole numbers. Round to the reps you actually completed.' };
  // Zero and negatives, which both used to produce a figure. Zero is the one
  // that mattered least on screen and most in principle: `kg && reps` treated
  // it as "nothing typed", so a deliberate 0 and an empty box said the same
  // thing, and neither said it was wrong.
  if (n < 1) return { ok: false, reason: 'A set is at least one rep.' };
  if (n > EPLEY_MAX_REPS) {
    return {
      ok: false,
      reason: `Past ${EPLEY_MAX_REPS} reps this is no longer an estimate of a one-rep max — the formula simply keeps adding. Use a heavier set of ${EPLEY_CLEAN_REPS} reps or fewer.`,
    };
  }
  return { ok: true, reps: n };
}

/**
 * What to say beside an estimate made from `reps`, or null when the formula is
 * inside the range it is quoted over and there is nothing to add.
 *
 * Null for an absent rep count too: a screen with nothing typed in it has its
 * own sentence and does not need a caveat about a figure it is not showing.
 */
export function epleyCaveat(reps: number | null | undefined): string | null {
  if (reps == null || reps <= EPLEY_CLEAN_REPS) return null;
  return `Epley is quoted over about ${EPLEY_CLEAN_REPS} reps. At ${reps} it runs high, so treat this as a ceiling rather than a number to load.`;
}
