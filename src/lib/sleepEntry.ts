// Whether a night can be filed, and what to say when it cannot.
//
// ── Why this is a module and not two lines in the provider ────────────────
//
// `sleep_logs.hours` is `check (hours > 0 and hours <= 24)` and `quality` is
// `check (quality between 1 and 5)`; part 109 says why those are the bounds —
// they are the range in which the number can be a number of hours at all, not
// a judgement about how much anybody should sleep.
//
// The column was doing the whole job on its own, and that was the defect. A
// fat-fingered 75 was filed optimistically on the phone — which is what makes a
// night logged in a basement survive — then refused by the CHECK, and nothing
// read the refusal. Then the bound was added to the provider, and the SCREEN
// did not read that either: both boxes cleared, no night appeared, and nothing
// was said. Two mutators on one screen, one reporting what happened and one
// reporting nothing.
//
// So the rule and the SENTENCE live together, in a pure module that runs under
// `npm test`. A refusal a member is not told about is the same as a silent
// failure, whichever layer is doing the refusing.

import { plain } from './units';

export const MAX_SLEEP_HOURS = 24;
export const MAX_QUALITY = 5;

/** Is this a night that can be filed at all? The same question the column
 *  asks, so a refusal here and a refusal there cannot disagree. */
export function isFilableNight(hours: number, quality: number): boolean {
  return Number.isFinite(hours) && hours > 0 && hours <= MAX_SLEEP_HOURS
    && Number.isInteger(quality) && quality >= 1 && quality <= MAX_QUALITY;
}

/**
 * Why a night was refused, in the words the member reads. Null when there is
 * nothing wrong with it.
 *
 * Each reason is its own sentence, because a member acts on them differently:
 * an out-of-range figure is retyped, a missing quality mark is tapped in. The
 * hours case offers the reading the mistake almost always is — 75 for 7.5 —
 * because "between 0 and 24" is a rule and "did you mean 7.5" is help.
 */
export function sleepRefusal(hours: number, quality: number): string | null {
  if (isFilableNight(hours, quality)) return null;
  if (!Number.isFinite(hours) || hours <= 0) return 'How many hours did you sleep? Type the hours.';
  if (hours > MAX_SLEEP_HOURS) {
    // `plain` on both figures. `hours / 10` is the whole point of the sentence
    // — it is the reading the member almost certainly meant, 7.5 for a typed
    // 75 — and it is a fraction in every case that reaches here, so a bare
    // interpolation offered "7.5" to somebody whose decimal pad has a comma on
    // it and whose next keystroke would therefore be "7,5". `readNumber` takes
    // that comma; the sentence telling them what to type has to write it.
    return `A night is at most ${plain(MAX_SLEEP_HOURS)} hours, so ${plain(hours)} could not be stored and nothing has been logged. If you meant ${plain(hours / 10)}, type that.`;
  }
  return `Mark how well you slept, from 1 to ${MAX_QUALITY}, and it will be logged.`;
}
