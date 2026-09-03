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
// ── What this is now that the transport has a ceiling of its own ──────────
//
// src/lib/requestTimeout.ts closed the deeper half of this: every request now
// goes out with an AbortController and a ceiling, so a socket nobody answers
// becomes a labelled throw instead of an eternal wait, and the providers' own
// `catch` blocks — which were correct all along and simply unreachable — run.
// That is the better fix and it covers every read that goes through
// `observedFetch`.
//
// This is the backstop for the residue, and the residue is real:
//
//   · a provider's status is moved by CODE, not by a socket. A read that throws
//     into a path with no `setStatus('error')` on it, or an `await` on
//     something that is not a fetch at all — AsyncStorage, a native module, a
//     permission prompt — leaves the status exactly where the hung socket used
//     to leave it;
//   · `withDeadline` below gives a screen that owns its own `Promise.all` a
//     value to branch on rather than an exception to remember to catch.
//
// It is deliberately the SLOWEST of the three ceilings in this app, and the
// ordering is load-bearing. pullRefresh's MAX_SPIN_MS (20s) ends the wheel and
// hands the gesture back. requestTimeout's CALL_CEILING_MS (30s, retried once
// for a GET) ends the request and draws the offline banner. Only after all of
// that has been tried does a screen stop calling itself busy. Any other order
// puts a failure sentence on screen over a request that is still going.

import type { LoadStatus } from '../ui/loadStatus';
import { CALL_CEILING_MS, maxAttempts } from './requestTimeout';

/**
 * How long a screen's status may sit at 'loading' before the screen stops
 * calling itself busy and starts calling it a failure, in milliseconds.
 *
 * ── Why it is derived and not typed ───────────────────────────────────────
 *
 * Because the one way to get this number wrong is to put it BELOW the transport
 * ceiling, and a literal cannot notice when somebody moves the other one.
 *
 * src/lib/requestTimeout.ts cuts a hung request off at CALL_CEILING_MS and
 * retries a GET once, so the longest a read that is going to SUCCEED may
 * legitimately take is one timed-out attempt plus a slow second one. A display
 * deadline shorter than that prints "we could not read this" over a retry that
 * is in flight and about to come back — which is the flash
 * src/ui/clientData.tsx already forbids in its own words: "an attempt with
 * another one behind it is still a read in flight, and saying 'error' in
 * between would flash 'we couldn't read your profile' across every screen that
 * reads this status and then take it back."
 *
 * requestTimeout.ts anticipated this file by name and said which number should
 * move: "If the cascade is worth tidying, the number to move is the display
 * deadline, not this one." This is that number, and it is written as the
 * arithmetic so it moves on its own.
 *
 * ── Why a minute of silence is affordable ─────────────────────────────────
 *
 * Because it is not silence. The transport files its verdict per ATTEMPT, so
 * the first timeout at thirty seconds already marks the app unreachable —
 * `offlineBanner` appears, `canAssertEmpty` goes false, and every screen
 * switches to the sentences it has for a phone that cannot reach us. This
 * deadline is not how long before the member is told something is wrong. It is
 * how long before a screen stops describing itself as busy, which must not
 * happen while the app is still genuinely trying.
 */
export const READ_DEADLINE_MS = CALL_CEILING_MS * maxAttempts('GET') + 5_000;

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

/** The two timer functions, injected so a test does not have to wait
 *  twenty-five seconds to find out what happens at twenty-five seconds. */
export interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/**
 * A read that always comes back, for the call sites that own their own promise.
 *
 * ── Why a value and not an exception ──────────────────────────────────────
 *
 * Because of what the callers hold. A client screen keeps `T | null |
 * undefined` — still reading, could not read, an answer — and branches on it in
 * the render. `{ answered: false }` slots straight into that beside the answer
 * it already had, which is what lets a stalled PULL leave a balance on screen
 * while a stalled FIRST read says so. A throw would put that decision inside a
 * catch at every call site, which is the version that gets written wrong once
 * and blanks somebody's purchases.
 *
 * A REJECTION passes straight through and is rethrown, deliberately: every
 * caller already knows what a refused read means on its screen, and folding the
 * error into `{ answered: false }` would flatten "the server said no" into "the
 * server said nothing" — the distinction src/lib/reachability.ts exists to
 * keep, and the one that decides whether a person is sent to their router.
 *
 * A late answer is not an unhandled rejection: both handlers are attached to
 * `work` unconditionally and simply return once the ceiling has already won.
 *
 * Nothing here CANCELS the work. It cannot — it does not own the request, and
 * there is no AbortController in this app to hand it. A read that answers at
 * forty seconds still answers; nobody is waiting on it by then.
 */
export function withDeadline<T>(
  work: Promise<T>,
  opts: { ms?: number; timers?: Timers } = {},
): Promise<Deadlined<T>> {
  const ms = opts.ms ?? READ_DEADLINE_MS;
  const timers = opts.timers ?? realTimers;
  // No usable ceiling means NO ceiling. Resolving as unanswered on the first
  // tick would be far worse than the bug this file is about: every read in the
  // app would report a failure that had not happened.
  if (!Number.isFinite(ms) || ms <= 0) return work.then((value) => ({ answered: true as const, value }));
  return new Promise<Deadlined<T>>((resolve, reject) => {
    let done = false;
    // Cleared whichever way the promise settles. Not tidiness: these tests run
    // under plain node, and a timer left armed keeps the process alive past the
    // last assertion, so a suite that passed would hang instead of exiting.
    const id = timers.setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ answered: false });
    }, ms);
    work.then(
      (value) => {
        if (done) return;
        done = true;
        timers.clearTimeout(id);
        resolve({ answered: true, value });
      },
      (err) => {
        if (done) return;
        done = true;
        timers.clearTimeout(id);
        reject(err);
      },
    );
  });
}
