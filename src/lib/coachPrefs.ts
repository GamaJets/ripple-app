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
 * What became of a target the coach just set.
 *
 * Three outcomes, and only one of them is "saved". Setting a goal used to be
 * `onPress={() => { setGoals({…}); setGoalOpen(false); }}` — a void call, a
 * sheet that closed, and a progress bar that redrew against the new number
 * whichever of these actually happened.
 *
 *   · 'saved'        the account row was written and the row count says so.
 *   · 'device-only'  the account write was deliberately SKIPPED, because the
 *                    prefs read had failed and writing this handset's cache
 *                    over targets that may exist elsewhere is exactly what that
 *                    guard is for. The target is real on this phone and nowhere
 *                    else, and a coach who reinstalls or picks up a second phone
 *                    will find it gone.
 *   · 'failed'       the write was attempted and did not land.
 *
 * A goal is the one figure on that screen the coach authored rather than the
 * app computing, which makes it the one most worth telling them about.
 */
export type GoalSaveOutcome = 'saved' | 'device-only' | 'failed';

export function goalSaveLine(outcome: GoalSaveOutcome): string | null {
  if (outcome === 'saved') return null;
  if (outcome === 'device-only') {
    return 'Your targets are set on this phone only. They could not be read from your account earlier in this session, so nothing has been written there — '
      + 'saving over targets we could not read would be a guess. Open this screen again once you have signal and set them once more.';
  }
  return 'Your targets are set on this phone, and they did NOT reach your account. The bars below are measured against them either way, '
    + 'but they will not be here on another phone or after a reinstall. Try again in a moment.';
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


/* ── how often the app may raise the same client ───────────────────────────── */

/**
 * The shortest gap a coach will accept between two approaches to one person.
 *
 * ── Why this is a setting at all ──────────────────────────────────────────
 *
 * `MIN_COOLDOWN_DAYS = 7`, `MAX_COOLDOWN_DAYS = 28` and `DISMISS_FLOOR_DAYS =
 * 30` in src/lib/interventions.ts and src/lib/nudge.ts are one set of numbers
 * for every coach, and there is no one set. A coach whose clients come to a room
 * every Tuesday knows within a week that somebody has stopped. A coach with an
 * online-only book, where a client can be entirely fine and entirely invisible
 * for a fortnight, needs longer. Given the same seven-day floor, the first calls
 * the list slow and the second calls it nagging — the same complaint about the
 * same number from opposite ends.
 *
 * ── Why one number and not three ──────────────────────────────────────────
 *
 * Because the per-client pacing is the part that works and must survive: paced
 * off a client's own rhythm, a fortnightly client is not chased mid-gap and a
 * daily one is not left for a month. What a coach is actually asking for is
 * "never inside N days", which is a FLOOR, and a floor composes with the pacing
 * rather than replacing it. `cooldownFloor` in interventions.ts is where it is
 * applied.
 *
 * ── And why it is bounded ─────────────────────────────────────────────────
 *
 * A stored 0 would prompt daily, which is the behaviour this whole feature
 * exists to prevent, and a stored 100000 would silence somebody for three
 * centuries. Both are refused here rather than clamped: clamping invents a
 * number the coach did not choose and then acts on it.
 */
export const MIN_NUDGE_COOLDOWN = 1;
export const MAX_NUDGE_COOLDOWN = 365;

/** The same three-way answer `parseRate` gives, and for the same reason: an
 *  empty box is an instruction (use the app's own pacing) and a half-typed one
 *  is not. Collapsing them would let a keystroke silence a coach's whole list
 *  for a year. */
export type CooldownInput =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'value'; value: number };

export function parseCooldown(text: string): CooldownInput {
  const raw = String(text ?? '').trim();
  if (!raw) return { kind: 'empty' };
  // Whole days only. There is no such thing as 2.5 days between two phone
  // calls, and a decimal here would be stored, rounded somewhere downstream,
  // and disagree with the number the coach can see in the box.
  if (!/^\d+$/.test(raw)) return { kind: 'invalid' };
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) return { kind: 'invalid' };
  if (n < MIN_NUDGE_COOLDOWN || n > MAX_NUDGE_COOLDOWN) return { kind: 'invalid' };
  return { kind: 'value', value: n };
}

/** A stored window back into its box. Null is an empty box and never "0" — a
 *  coach with no preference has not chosen zero days. */
export function cooldownText(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  return String(Math.round(value));
}

/**
 * What the box is doing, in the coach's words.
 *
 * Two different sentences, because "not set" and "set to seven" are genuinely
 * different states even though the app behaves the same way in both: the first
 * is the app's judgement and the second is the coach's, and a coach who cannot
 * tell which one is in force cannot decide whether to change it.
 */
export function cooldownNote(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return 'Not set, so the app paces each client off how often they used to train — never closer than a week, never further than four.';
  }
  const n = Math.round(value);
  return `Never inside ${n} day${n === 1 ? '' : 's'}. Each client is still paced off their own rhythm above that, so somebody who trained fortnightly is left longer than somebody who trained daily.`;
}
