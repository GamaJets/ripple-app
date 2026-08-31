// The coach's own numbers: the class pay rate they type, and the targets they
// set themselves. Pure — the reads and writes are next door in
// src/lib/coachPrefsStore.ts, so this half runs under `npm test`.
//
// ── Why a rate needs a three-way answer ────────────────────────────────────
//
// app/(trainer)/class-checkin.tsx held the rate in `useState('')` and nothing
// else, so it was retyped on every visit to the screen. Persisting it means the
// box now has to distinguish three things a plain `parseFloat` cannot:
//
//   · empty   — the coach cleared the box. That is an instruction: unset my
//               rate. It must be saved, as NULL, not ignored.
//   · invalid — half-typed ("12."), or a stray character. NOT an instruction.
//               Writing it as 0 would silently replace a real rate with a rate
//               of nothing, mid-keystroke, and the coach would find out at
//               payroll.
//   · value   — a number to store.
//
// `parseFloat` collapses the first two onto 0 (via `|| 0`) and takes the
// leading digits of anything else — parseFloat('12abc') is 12 — which is how a
// typo becomes a stored rate.
//
// ── No currency, anywhere in this file ─────────────────────────────────────
//
// The rate is a bare number and stays one. Repple is not the payer, is not told
// which currency the coach is paid in, and the version of the check-in screen
// before this one printed "You'll be paid AED {rate × present}" — a payout with
// no payer behind it, in a currency inherited from a deleted branch list. The
// screen's own sentence is the honest one and it survives this change intact:
// the coach's own arithmetic, on a number they typed. Persisting the number
// stops the retyping and grants it no more meaning than it had.

import type { LoadStatus } from '../ui/loadStatus';

/** What the coach's typing means. See the header for why "invalid" is not 0. */
export type RateInput =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'value'; value: number };

/**
 * Read a typed rate.
 *
 * A single comma is taken as a decimal point: `keyboardType="numeric"` gives a
 * comma key on a French or German keyboard, and `Number('12,5')` is NaN, so
 * without this a coach in Berlin can type a rate the app calls invalid forever.
 * Two commas are still invalid — that is a thousands separator or a slip, and
 * guessing which would be inventing a figure.
 */
export function parseRate(text: string): RateInput {
  const raw = String(text ?? '').trim();
  if (!raw) return { kind: 'empty' };
  const commas = (raw.match(/,/g) || []).length;
  if (commas > 1) return { kind: 'invalid' };
  const norm = commas === 1 ? raw.replace(',', '.') : raw;
  // Whole digits with at most one decimal part. Rejects '12abc', '1e3', '- 5',
  // '12.' and '.': every one of them is something Number() would happily turn
  // into a figure that is not what was typed.
  if (!/^\d+(\.\d+)?$/.test(norm)) return { kind: 'invalid' };
  const n = Number(norm);
  // Finiteness is the only thing left to check: the regex has already ruled out
  // a sign, so `n < 0` could never be true and a condition that cannot be true
  // is a line no test can ever be watching. A four-hundred-digit rate, though,
  // is Infinity — and it matches the regex.
  if (!Number.isFinite(n)) return { kind: 'invalid' };
  return { kind: 'value', value: n };
}

/** A stored rate back into the text box. Null is an empty box, never "0" and
 *  never "null" — a coach with no rate set has an empty field, not a rate of
 *  nothing. Trailing zeros are dropped so 37.50 comes back as "37.5" rather
 *  than growing a decimal place every round trip. */
export function rateText(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  return String(Number(value));
}

/**
 * The pay estimate: rate times heads through the door, rounded.
 *
 * Null when either half is unknown, and that is the whole reason this is a
 * function. The screen printed "25 × 0 checked in = 0" when the roster had not
 * been read — a payout figure for a class it never managed to look at, in the
 * one place on the coach's phone that talks about money. A null renders as no
 * line at all, next to a sentence explaining which half is missing.
 */
export function payEstimate(rate: number | null, present: number | null): number | null {
  if (rate == null || present == null) return null;
  if (!Number.isFinite(rate) || !Number.isFinite(present)) return null;
  return Math.round(rate * present);
}

/** A typed goal. Anything that is not a whole non-negative number is 0, and 0
 *  means "no target" everywhere in the app — the same meaning the previous
 *  `parseInt(x, 10) || 0` had, with the negative case closed. */
export function parseGoal(text: string): number {
  const raw = String(text ?? '').trim();
  if (!/^\d+$/.test(raw)) return 0;
  const n = Number(raw);
  // The regex has already ruled out a sign and a decimal point, so the only
  // thing left to check is size: twenty digits parse to a float that has lost
  // its last digits, and storing a target nobody typed is worse than refusing
  // one. (There is no `n >= 0` here — it cannot be false after the regex, and a
  // condition that cannot be false is a line no test can ever be watching.)
  return Number.isSafeInteger(n) ? n : 0;
}

/** A goal back into its text box. 0 is "not set", so it shows as an empty box
 *  rather than as the digit zero — which would read as a target of nothing and
 *  save straight back as one. */
export const goalText = (value: number): string => (value > 0 ? String(value) : '');

/** Clamp a progress fraction to 0..1. A goal of 0 has no progress to draw. */
export const goalPct = (current: number, goal: number): number =>
  goal > 0 ? Math.max(0, Math.min(1, current / goal)) : 0;

/**
 * What to say under a "Your Goals" heading with no targets in it.
 *
 * Two very different facts arrive here as the same empty object, and the screen
 * used to state the first one unconditionally: "No targets set. Tap Edit to
 * give yourself a monthly revenue or client number to work towards." Said to a
 * coach whose targets simply could not be read, that is the app telling them
 * something false about themselves — and it is the sentence a coach would
 * answer by typing their targets in again, over the top of the ones already
 * stored.
 *
 * Returns null when there IS a target, because then the bars speak for
 * themselves.
 */
export function goalsEmptyLine(status: LoadStatus, revenue: number, clients: number): string | null {
  if (revenue > 0 || clients > 0) return null;
  if (status === 'loading') return 'Reading your targets…';
  if (status === 'error') {
    return 'Your targets could not be read, so this is not "none set" — leave the screen and open it again once you have signal. Typing new ones now would save over whatever is already there.';
  }
  return 'No targets set. Tap Edit to give yourself a monthly revenue or client number to work towards.';
}

/**
 * What to say under the rate box on the check-in screen.
 *
 * Same shape, same reason. An empty box under 'error' is a read that failed,
 * not a coach who has never set a rate, and the difference decides whether the
 * empty box is worth trusting.
 */
export function rateFieldNote(status: LoadStatus): string | null {
  if (status === 'loading') return 'Reading the rate you saved…';
  if (status === 'error') {
    return 'Your saved rate could not be read, so this box is empty for that reason rather than because you have not set one. Anything you type here will still be saved.';
  }
  return null;
}
