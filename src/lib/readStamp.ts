// When a screen last heard from the server, worked out from what a provider
// already publishes.
//
// ── The gap ────────────────────────────────────────────────────────────────
//
// `src/ui/fetched.tsx` draws the line that says when a figure was read, whether
// the phone can reach us, and a Refresh beside it. All eighteen of its call
// sites are `app/(owner)/**`. Not one CLIENT screen has a read stamp or a
// Refresh affordance, and the argument `src/lib/freshness.ts` opens with — an
// owner reading yesterday's takings in 44pt type with nothing on the page
// saying when it was fetched — is not an argument about owners. A member
// standing in a basement looking at today's class list, their session credits
// or their coach's programme is in exactly the same position, and rather more
// likely to act on it: they walk to a room.
//
// It got MORE useful, not less, when the client providers learnt to recover on
// reconnect (src/lib/readRefresh.ts). Before that, a failed read stayed failed
// and the screen said so. Now it repairs itself silently — which is right, and
// which means the difference between "this landed a second ago" and "this
// landed before you came downstairs" is no longer visible anywhere.
//
// ── What the provider layer had to supply, and why it is nothing ───────────
//
// The obvious move is to add an `at` to every provider's context value. That is
// twenty-odd files, five lanes deep, for a number every one of them already
// implies: a provider that has moved to 'ready' or 'partial' has just been
// answered by the server, and one that has moved to 'error' has not.
//
// So the stamp is DERIVED, and this file is the derivation. A screen passes the
// `status` it already destructures and gets back the two things `<Fetched>`
// wants. Nothing in `src/ui/*` had to change for it.
//
// ── The one rule ───────────────────────────────────────────────────────────
//
// THE STAMP IS THE LAST SUCCESSFUL READ, NEVER THE LAST ATTEMPT. `fetched.tsx`
// says it plainly: "A refresh that failed leaves the stamp where it was,
// because the figures on screen are still the ones from the earlier read and
// saying otherwise would be the same lie one layer up." So 'error' and
// 'loading' both leave it alone, and only a landing moves it.
//
// 'partial' counts as a landing. The server answered; the rows are real; there
// are simply more of them. `src/ui/loadStatus.ts` already stops the screen
// computing a total off it, and the age of what IS there is a true and useful
// thing to say.
import type { LoadStatus } from '../ui/loadStatus';

/** What the deriving needs to remember between renders. */
export interface ReadStamp {
  /** Ms of the last read that LANDED, or null if none has. */
  at: number | null;
  /** The status this was worked out from, so a transition can be spotted. */
  status: LoadStatus;
  /** The payload the provider was publishing at that moment — see below. */
  token: unknown;
}

/** True when the server answered. Written as a function because the two
 *  statuses that pass are not the same claim and a reader should see both. */
export const landed = (s: LoadStatus): boolean => s === 'ready' || s === 'partial';

/** The starting point: nothing read yet. `<Fetched>` renders that as
 *  "Reading…" rather than as an age, which is the honest sentence. */
export const noStamp = (status: LoadStatus, token: unknown = null): ReadStamp =>
  ({ at: null, status, token });

/**
 * The stamp after one render, given the last one.
 *
 * Moves `at` to `now` when a read has just landed, and leaves it exactly where
 * it was otherwise. "Just landed" is any of three things, and the third is why
 * `token` exists:
 *
 *   1. THE STATUS CHANGED INTO A LANDED ONE. The ordinary case: 'loading' →
 *      'ready', or 'error' → 'ready' after a reconnect.
 *   2. NOTHING HAS EVER BEEN STAMPED. A provider that is 'ready' on its first
 *      render — every provider when the backend is switched off, and any read
 *      that resolves before the screen mounts — would otherwise sit at "Reading…"
 *      for ever over figures that are on screen.
 *   3. THE PAYLOAD CHANGED WHILE LANDED. Not every provider announces its
 *      re-read as 'loading' first; some go 'ready' → 'ready'. Without this the
 *      stamp would freeze at the first read and go on ageing, which is the ONE
 *      direction `src/lib/freshness.ts` says this must not err in — claiming a
 *      figure is older than it is sends somebody to refresh something that was
 *      fine. Compared by identity, because that is what a provider changes when
 *      it publishes a new answer.
 *
 * Returns the PREVIOUS OBJECT when nothing about it changed. That is not a
 * micro-optimisation: handed to a React setter, an identical object is not a
 * state change, and a hook that returned an equal-but-new object on every
 * render would be the render loop this codebase spent a night finding. See
 * src/lib/dismissedSet.ts.
 */
export function nextStamp(prev: ReadStamp, status: LoadStatus, token: unknown, now: number): ReadStamp {
  const same = prev.status === status && Object.is(prev.token, token);
  // A failed or in-flight read changes nothing a member can see about WHEN, so
  // the stamp is carried across untouched — the whole rule, in one line.
  if (!landed(status)) return same ? prev : { at: prev.at, status, token };
  if (same && prev.at != null) return prev;
  return { at: now, status, token };
}

/**
 * Whether a refresh is in flight, for the Refresh control's own label.
 *
 * 'loading' and nothing else. 'error' is not busy — it is finished and it
 * failed, and a button stuck on "Refreshing…" over a failed read is a screen
 * that looks like it is still trying when it is not.
 */
export const stampBusy = (status: LoadStatus): boolean => status === 'loading';
