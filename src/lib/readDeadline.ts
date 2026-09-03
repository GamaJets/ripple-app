// A first read that is never going to answer, given an ending.
//
// ── The report this closes ─────────────────────────────────────────────────
//
// "It just says 'Reading your training log…' and never stops."
//
// src/lib/pullRefresh.ts already put a ceiling on the pull-to-refresh SPINNER
// and its header sets out the mechanism in full: `src/lib/supabase.ts` hands
// every request through `observedFetch`, which awaits `fetch` and re-throws;
// there is no AbortController anywhere in this app and no request carries a
// timeout, so React Native's fetch waits for the socket for ever. The
// conditions that produce a socket that never answers are the ones
// src/lib/reachability.ts was written about — a gym wifi behind a captive
// portal, a hotel network that has stopped forwarding, a bar of 5G in a lift
// shaft. The radio is associated, the request goes out, nothing comes back and
// nothing throws.
//
// The spinner was only half of it, and the smaller half. Every provider in
// src/ui publishes a `LoadStatus` and starts it at 'loading'. That status is
// only ever moved by a read that SETTLES — `setServerStatus('ready')` in the
// try, `setServerStatus('error')` in the catch — so a read that does neither
// leaves it at 'loading' for the life of the mount. Nothing in these apps
// unmounts a screen: the client layout registers its detail screens with
// `href: null`, so they mount once and stay mounted, and backgrounding does not
// tear them down. The pull gesture comes back after twenty seconds, the member
// pulls, the reload hits the same dead socket, and the screen never changes.
//
// What the member is left looking at is not a spinner they can dismiss. It is
// Home saying "Reading your training log…" over dashes where their streak, this
// week's sessions and their tonnage should be; Session Credits saying "Reading
// what pays for your sessions…" over no balance at all; Lifting Tools saying
// "Reading your measurements…" instead of the macro targets. Every one of those
// screens ALREADY has the right words written for the case where the server did
// not answer — a notice, a reason and a way to ask again — and none of them can
// reach it, because nothing ever says the read failed.
//
// ── Why 'error' is the honest answer and not a fifth status ────────────────
//
// src/ui/loadStatus.ts defines 'error' as "the server did not answer, or
// refused". A read still in flight after the ceiling is the first of those two
// exactly. It is not 'partial' (nothing came back to be a prefix of anything)
// and it is not a new state: adding one would mean every screen in three apps
// grew a branch for it, and the branch they would grow is the branch they
// already have.
//
// So this does not cancel the read — it cannot, it does not own the request —
// and it does not discard a late answer. It moves the SENTENCE from "still
// reading" to "we could not read this", which is the true one by then, and it
// steps back the moment the read lands: `escalate` is a pure function of the
// live status, so a read that answers at thirty seconds publishes 'ready' and
// the notice goes away on its own.
//
// ── The number ────────────────────────────────────────────────────────────
//
// Deliberately longer than pullRefresh's MAX_SPIN_MS (20s), and in that order
// for a reason. On a pull, the spinner ends first and hands the gesture back;
// five seconds later, if nothing has landed, the screen says why. The reverse
// order would put "we couldn't read your log" on screen underneath a wheel
// still claiming to be reading it.
//
// Nothing that is going to answer is cut off by this: it is far past any honest
// read this app makes on a mobile network, and the only read it changes is one
// that was never going to end.

import type { LoadStatus } from '../ui/loadStatus';
import { READ_DEADLINE_MS, isDeadlineExceeded, withDeadline as raceDeadline, type Timers } from './deadline';

// The ceiling itself is NOT declared here. src/lib/deadline.ts owns it, and its
// header makes the same argument about the same condition for the console — a
// captive portal at a gym's front desk, a socket accepted and then answered
// never. One number, one place: two constants called READ_DEADLINE_MS in one
// folder is how a phone and a console end up disagreeing about how long a
// member's phone should wait, and there is no version of that disagreement
// anybody would have chosen on purpose.
export { READ_DEADLINE_MS } from './deadline';

/**
 * True when a read has been in flight past the ceiling and has neither
 * answered nor failed.
 *
 * Only ever true of 'loading'. A read that came back — whole, truncated or
 * refused — has settled, and how long it took is not a fact about it any more.
 */
export function stalled(status: LoadStatus, elapsedMs: number, ceilingMs: number = READ_DEADLINE_MS): boolean {
  if (status !== 'loading') return false;
  // A ceiling of zero, or one that cannot be read, means NO ceiling. Without
  // this line `elapsed >= 0` is true of every read from its first millisecond,
  // and a caller that passed a bad number would fail every read in the app at
  // once — far worse than the bug this file is about.
  if (!Number.isFinite(ceilingMs) || ceilingMs <= 0) return false;
  // No guard on `elapsedMs` is needed and none is written: a clock that moved
  // backwards under us (a manual change, an NTP correction, a phone carried
  // across a date line) yields a negative elapsed, and a negative is already
  // below any positive ceiling. NaN fails the comparison too. The test pins
  // both, because the day somebody rewrites this as `!(elapsed < ceiling)` the
  // two invert and an unreadable clock starts declaring every read dead.
  return elapsedMs >= ceilingMs;
}

/**
 * The status a screen should publish, given what the provider says and whether
 * the ceiling has passed.
 *
 * `hitCeiling` is a fact the caller establishes however it can — a timer that
 * fired, or a comparison of two clocks. Kept as a boolean rather than a pair of
 * timestamps so that the React hook can be a timer (which does not re-render on
 * its own between ticks) and a test can be arithmetic.
 *
 * Every other status is passed through untouched. In particular a 'partial'
 * read is NOT escalated: it answered, and the rows it returned are real.
 */
export function escalate(status: LoadStatus, hitCeiling: boolean): LoadStatus {
  return status === 'loading' && hitCeiling ? 'error' : status;
}

/** What came back from a promise given a deadline. */
export type Deadlined<T> =
  /** The work settled inside the ceiling. */
  | { answered: true; value: T }
  /** The ceiling passed first. The work may still settle later; nobody is waiting. */
  | { answered: false };

/**
 * A read that always comes back, for the call sites that own their own promise.
 *
 * A thin shape over `withDeadline` in src/lib/deadline.ts, which owns the timer
 * and the DeadlineExceeded class and is tested there. What this adds is the
 * RETURN SHAPE, and it is the difference between the two callers:
 *
 *   · the console throws, because every screen there already has a 'failed' arm
 *     holding the database's own sentence and wants a deadline to land in it;
 *   · a client screen holding `T | null | undefined` does not want an exception
 *     at all. `{ answered: false }` is a value it can branch on beside the
 *     answer it already had, which is what lets a stalled PULL leave a balance
 *     on screen while a stalled FIRST read says so. Wrapping that in try/catch
 *     at each call site is the version that gets written wrong once.
 *
 * A REJECTION that is not a deadline is rethrown untouched, deliberately: a
 * refusal and a silence get opposite treatment everywhere else in this codebase
 * (src/lib/reachability.ts) and must not be flattened into each other here.
 */
export async function withDeadline<T>(
  work: Promise<T>,
  opts: { ms?: number; timers?: Timers } = {},
): Promise<Deadlined<T>> {
  try {
    // `wrote: false` — this is the READ half. Giving up on a write is a
    // different sentence and deadline.ts says why; nothing routes a write
    // through here.
    const value = await raceDeadline(work, opts.ms ?? READ_DEADLINE_MS, false, undefined, opts.timers);
    return { answered: true, value };
  } catch (e) {
    if (isDeadlineExceeded(e)) return { answered: false };
    throw e;
  }
}
