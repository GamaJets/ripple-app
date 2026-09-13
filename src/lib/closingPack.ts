// Which of a member's packs the deadline sentence is about, when they hold
// more than one.
//
// ── The silence this fills ────────────────────────────────────────────────
//
// src/lib/packDeadline.ts answers "am I going to lose sessions off this pack",
// and both client screens that ask it — app/(client)/bookings.tsx and
// app/(client)/session-credits.tsx — guarded the call with the same three
// lines:
//
//     const windowed = lines.filter((l) => l.expiresOn);
//     const soleWindow = windowed.length === 1 ? windowed[0] : null;
//     if (!soleWindow) return null;
//
// The first two are right and this module keeps them: an upcoming session is
// not attributed to a pack until it actually draws, so with two windows in
// play there is no honest way to say which one a Thursday booking is going to
// spend. The THIRD line is the defect. It turns "we cannot say what covers it"
// into "we will not mention the deadline at all" — and the member holding two
// closing packs is the one with the most at stake and the least chance of
// working it out unaided.
//
// `packDeadline` was built for exactly this. Its header says so in as many
// words: "The caller passes null there, and this says the deadline without
// claiming anything about coverage." Nothing was passing null, because nothing
// was calling it. So the module's `unknown` branch — the one sentence written
// for somebody with two packs — had no caller in the app.
//
// ── What this module decides, and what it refuses to ──────────────────────
//
//   · WHICH pack the sentence is about: the one that closes first, because it
//     is the one with the nearest deadline and the least time to act on it.
//   · WHETHER the diary may be counted against it. One window, and it may:
//     every upcoming booking that still has to draw can only come off that
//     pack. More than one, and it may not, whatever the dates are.
//
// It decides nothing about the window itself. `packWindow` in packExpiry.ts is
// the one opinion on what 'closing soon' means, and re-deriving it here is how
// two screens start disagreeing about one pack — the same argument
// `packDeadline` makes at its own call to it.
import { packWindow } from './packExpiry';

/** The shape of an entitlement this has to see. `Entitlement` in
 *  sessionCredits.ts satisfies it, and so does anything else holding a window
 *  and a balance. */
export interface WindowedPack {
  /** The pack's last day, bare `YYYY-MM-DD`, or null for one with no window. */
  expiresOn: string | null;
  /** Sessions still on it. */
  left: number;
  /** The nightly pass has already closed this window and taken what was left
   *  (part 612). Optional, because only coach packs are ever handed to a screen
   *  in this state. */
  expired?: boolean;
}

export interface ClosingChoice<T> {
  /** The pack the sentence is about: the first one to close. */
  pack: T;
  /**
   * Whether the diary may be counted as covering it.
   *
   * False is not a failure — it is the honest answer for a member holding two
   * windows, and `packDeadline` has a sentence for it. Pass `bookedByThen: null`
   * when this is false; NEVER a count, and never zero.
   */
  attributable: boolean;
  /** How many OTHER packs of theirs carry a window. Zero in the ordinary case. */
  otherWindows: number;
}

/** A bare `YYYY-MM-DD`, compared as a string and never parsed as UTC — the
 *  trap src/lib/localDate.ts exists for. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The pack a deadline sentence should be about, or null when there is none.
 *
 * Null for a read that did not land (`lines` null) and null for a member
 * holding nothing — two different facts, and neither of them is "nothing is
 * closing". A caller that cannot tell them apart must not print either.
 *
 * `today` is passed in for the reason every date function here takes one: a
 * clock read in a pure module is UTC-shaped and untestable, and the caller
 * already knows which day the device is on.
 */
export function closingPack<T extends WindowedPack>(
  lines: readonly T[] | null | undefined,
  today: string,
): ClosingChoice<T> | null {
  if (lines == null) return null;

  // Attribution is judged against EVERY window the member holds, not only the
  // ones closing soon. A pack that runs out in three months is still a pack a
  // Thursday booking might be spent on, so it is still a reason not to claim
  // that booking covers anything.
  const windowed = lines.filter((l) => typeof l.expiresOn === 'string' && DAY.test(l.expiresOn));

  const closing = windowed.filter((l) => {
    // Already closed by the nightly pass: `sessions_total` has been reduced and
    // nothing can be drawn off it, so it is not a deadline anybody can act on.
    // It still counted as a window above, because a screen listing it is a
    // screen that has to explain the nought beside it.
    if (l.expired) return false;
    // One opinion about the window, and it is packExpiry's. This is also what
    // drops a pack that has already lapsed, so a date that has gone cannot win
    // the "closes first" contest and silence a sibling that is genuinely about
    // to close.
    return packWindow({ expiresOn: l.expiresOn, expiredAt: null, sessionsExpired: 0 }, today) === 'soon';
  });
  if (!closing.length) return null;

  let pick = closing[0];
  for (const l of closing.slice(1)) {
    // String comparison on a bare day, deliberately. Both sides are
    // `YYYY-MM-DD`, which sorts correctly as text and moves nobody's date
    // across a zone boundary on the way.
    if ((l.expiresOn as string) < (pick.expiresOn as string)) { pick = l; continue; }
    // Two packs closing on the same day. The bigger balance wins, because the
    // sentence names one pack and the honest one to name is the one with more
    // at stake on it. The alternative considered was to say nothing, which is
    // the mistake this module exists to undo: a true sentence about one of the
    // two still tells the member there is a deadline and that it is worth
    // checking, which is the whole of the action either way.
    if (l.expiresOn === pick.expiresOn && l.left > pick.left) pick = l;
  }

  return { pack: pick, attributable: windowed.length === 1, otherWindows: windowed.length - 1 };
}

/**
 * The line that says the sentence above it is about one pack of several.
 *
 * Without it "3 sessions left on this pack" reads, to somebody holding two, as
 * everything they have. Null in the ordinary case — a member with one pack does
 * not need to be told there are no others.
 */
export function otherWindowsNote(otherWindows: number): string | null {
  if (!Number.isFinite(otherWindows) || otherWindows <= 0) return null;
  return otherWindows === 1
    ? 'You hold one other pack with an end date on it. This is the one that runs out first.'
    : `You hold ${otherWindows} other packs with an end date on them. This is the one that runs out first.`;
}
