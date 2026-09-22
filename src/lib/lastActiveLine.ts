// The sentence under a client's Training heading that says when they were last
// active — written from the value rather than glued to the front of it.
//
// ── the defect ─────────────────────────────────────────────────────────────
//
// `RosterClient.lastActive` is a DISPLAY phrase, not a timestamp, and it has
// five shapes (src/ui/roster.tsx): "3d ago" from `ago()`, "no activity yet",
// "added by you", "just added", and an em dash when the stats read came back
// truncated. app/(trainer)/dashboard.tsx printed
//
//     Last active {sel.lastActive}.
//
// which is English for exactly one of the five. Seen on an iPhone 17 Pro at the
// default text size, on a client added today:
//
//     Last active no activity yet.
//
// The other three broken readings are "Last active —.", "Last active added by
// you." and "Last active just added." — and the dash one is the expensive one,
// because a dash means A READ FAILED, and "Last active —." reads as a client
// who has been quiet rather than as a figure the app did not get.
//
// ── why a function and not a ternary at the call site ──────────────────────
//
// Because the five cases are not five formats, they are four different FACTS:
// somebody who has trained, somebody who has not, somebody there is no record
// to have (added by hand, no account behind them), and somebody whose record
// could not be read. Only the first is about the client's behaviour. A ternary
// on the screen would have collapsed the last two again the next time somebody
// tidied it.
//
// Pure, and takes no clock: `ago()` has already resolved the elapsed time into
// words by the time the value reaches here, so there is nothing left to freeze.

/** The phrases `src/ui/roster.tsx` writes when there is nothing to age. */
const NO_RECORD_YET = 'no activity yet';
const HAND_ADDED = ['added by you', 'just added'];
const NOT_READ = '—';

/**
 * A complete sentence about when this client was last active.
 *
 * Never returns a fragment, and never presents a failed read as inactivity.
 * The caller appends its own following sentence; every return here ends in a
 * full stop so the two do not run together.
 */
export function lastActiveLine(lastActive: string | null | undefined): string {
  const v = (lastActive ?? '').trim();

  // A read that did not come back. Said as its own fact, because a dash in
  // place of a date is the one value here that is not about the client at all —
  // see src/ui/loadStatus.ts for why the two may never share a sentence.
  if (v === '' || v === NOT_READ) {
    return 'When they were last active could not be read, so this is not a statement that they have been quiet.';
  }

  // Somebody the coach typed in. There is no account behind them, so there is
  // no activity to be missing — offering "no activity yet" about them reads as
  // a client who has stopped, which is a different conversation.
  if (HAND_ADDED.includes(v)) {
    return 'You added them by hand, so nothing has been recorded against them yet.';
  }

  // On the book, with an account, and nothing on it.
  if (v === NO_RECORD_YET) {
    return 'Nothing has been recorded for them yet.';
  }

  // "3d ago", "2h ago", "45m ago" — the only shape the original sentence fitted.
  return `Last active ${v}.`;
}
