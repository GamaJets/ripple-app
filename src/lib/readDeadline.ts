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

/**
 * How long a first read may stay unanswered before a screen stops calling
 * itself busy and starts calling it a failure, in milliseconds.
 */
export const READ_DEADLINE_MS = 25_000;

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

export interface DeadlineOpts {
  /** Defaults to READ_DEADLINE_MS. */
  ms?: number;
  /** Defaults to `setTimeout`. */
  schedule?: (fn: () => void, ms: number) => unknown;
  /** Defaults to `clearTimeout`. */
  cancel?: (handle: unknown) => void;
}

/**
 * A promise that always settles, for the call sites that own their own read.
 *
 * A REJECTION passes straight through and is rethrown, deliberately: every
 * caller of this already has a catch that knows what a refused read means on
 * its screen, and swallowing the error into `{ answered: false }` would flatten
 * "the server said no" back into "the server said nothing" — the very
 * distinction src/lib/reachability.ts exists to keep.
 *
 * A late answer is not an unhandled rejection: both handlers are attached to
 * `work` unconditionally and simply return once the ceiling has already won.
 */
export function withDeadline<T>(work: Promise<T>, opts: DeadlineOpts = {}): Promise<Deadlined<T>> {
  const ms = opts.ms ?? READ_DEADLINE_MS;
  const schedule = opts.schedule ?? ((fn: () => void, d: number) => setTimeout(fn, d));
  const cancel = opts.cancel ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  // No usable ceiling means no ceiling. Returning a promise that resolves
  // immediately as unanswered would be far worse than the bug: every read in
  // the app would report failure on the first tick.
  if (!Number.isFinite(ms) || ms <= 0) return work.then((value) => ({ answered: true as const, value }));
  return new Promise<Deadlined<T>>((resolve, reject) => {
    let done = false;
    const handle = schedule(() => {
      if (done) return;
      done = true;
      resolve({ answered: false });
    }, ms);
    work.then(
      (value) => {
        if (done) return;
        done = true;
        cancel(handle);
        resolve({ answered: true, value });
      },
      (err) => {
        if (done) return;
        done = true;
        cancel(handle);
        reject(err);
      },
    );
  });
}
