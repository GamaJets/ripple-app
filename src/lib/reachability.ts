// Whether this phone can reach the backend right now.
//
// ── Why there is no NetInfo in here ────────────────────────────────────────
//
// The obvious build of this file is `@react-native-community/netinfo`. It is
// not in package.json, and adding it would have been the wrong call twice
// over:
//
//   1. Its entry point calls `requireNativeModule()`. Any bare import of a
//      module that does that throws at module evaluation and takes the whole
//      screen with it — src/ui/nativeModules.ts exists because this app has
//      been bitten by exactly that, and scripts/check-native.mjs now enforces
//      it. A connectivity library that kills a screen when it is missing is a
//      reliability regression sold as a reliability feature.
//
//   2. A native dependency cannot ship over the air. Every install would have
//      to wait for a store release before the app could tell a basement from a
//      rejection, and the whole point of knowing is to fix the wrong sentence
//      that is in front of people TODAY.
//
// And the third reason is the one that matters even where NetInfo is already
// installed: it answers the wrong question. NetInfo says whether the radio has
// an association. It says yes on gym wifi with a captive portal, yes on a
// hotel network that has stopped forwarding, yes on a 5G bar in a lift shaft
// with no throughput. The question every caller in this app actually has is
// "did my request reach OUR server", and the only instrument that answers it
// is a request to our server.
//
// So this file learns from traffic. `src/lib/supabase.ts` hands every single
// HTTP call the client makes through `observedFetch` below, so one read on one
// screen updates the answer for the whole app; a probe (src/ui/reachability.tsx)
// asks on its own when there is no traffic to learn from. No native code, ships
// over the air, and 'online' means the thing the callers mean by it.
//
// ── The distinction this exists to protect ────────────────────────────────
//
// src/lib/offlineQueue.ts already draws the line between a write the server
// REFUSED and a write nobody answered, because those get opposite treatment.
// This file is the same line drawn one level up, for the sentence a person
// reads. "Check your connection and try again" is printed on four client
// screens today for both halves of it, and on the refusal half it is a lie
// that sends somebody to their router when the server has just told them no.

/**
 * What we currently believe about reaching the backend.
 *
 * 'unknown' is a real and common state, not a placeholder: a cold launch that
 * has not made a request yet knows nothing, and saying "you are offline" then
 * would be an invention. Every copy helper here treats it as "do not claim
 * either way".
 */
export type Reach = 'unknown' | 'online' | 'offline';

/** One request's verdict. 'reached' means bytes came back from our server —
 *  INCLUDING an error response, which is the server talking. 'unreachable'
 *  means the request never produced an answer at all. */
export type ReachEvidence = 'reached' | 'unreachable';

export interface ReachState {
  reach: Reach;
  /** ms since epoch of the last CHANGE, so a screen can say how long. 0 while
   *  nothing has ever been observed. */
  since: number;
  /** Consecutive unreachable verdicts. Drives the probe's backoff, and is not
   *  the same as "is offline" — the first failure flips `reach` and this keeps
   *  counting so the probe stops hammering a radio that is switched off. */
  failures: number;
}

export const initialReach = (): ReachState => ({ reach: 'unknown', since: 0, failures: 0 });

/**
 * Is this thrown value a transport failure, or something we caused?
 *
 * An AbortError is US: the probe's own timeout, or a screen unmounting mid
 * read. Counting it as evidence of no signal would put the app into 'offline'
 * every time somebody navigated away from a slow screen, and 'offline' is the
 * state that changes what people are told.
 *
 * Everything else that throws out of fetch is a transport failure — RN says
 * "Network request failed", browsers say "Failed to fetch", and neither is
 * worth pattern-matching when the absence of a response is the whole signal.
 */
export function isTransportFailure(err: unknown): boolean {
  if (err == null) return false;
  const name = String((err as any)?.name ?? '');
  if (name === 'AbortError' || name === 'CanceledError') return false;
  const msg = String((err as any)?.message ?? '');
  // A DOMException for an aborted request does not always carry the name on
  // every runtime this app runs on, so the message is checked too.
  if (/abort/i.test(msg)) return false;
  return true;
}

/**
 * Fold one verdict into the state.
 *
 * Asymmetric on purpose, and the asymmetry is the design:
 *
 *   · ONE success is enough to say online. If a request came back, the path
 *     works, and continuing to tell somebody they have no signal while their
 *     screen is filling with data is the worse error.
 *
 *   · ONE failure is enough to say offline. Not three, not a rolling window.
 *     Every request this app makes goes to one host, so a transport failure is
 *     not a flaky peer among many — it is the only thing we talk to, refusing
 *     to answer. The cost of being wrong for a few seconds is a banner; the
 *     cost of waiting for a quorum is the member typing a message into a dead
 *     screen and being told it "could not be sent" with no reason.
 *
 * `since` only moves when `reach` actually changes, so "offline for 4 minutes"
 * stays true across the fifteen further failures inside it.
 */
export function reachAfter(prev: ReachState, ev: ReachEvidence, now: number): ReachState {
  if (ev === 'reached') {
    return { reach: 'online', since: prev.reach === 'online' ? prev.since : now, failures: 0 };
  }
  return {
    reach: 'offline',
    since: prev.reach === 'offline' ? prev.since : now,
    // Capped so a phone left in a drawer overnight does not overflow the
    // schedule into a number the probe can never come back from.
    failures: Math.min(prev.failures + 1, 32),
  };
}

/**
 * How long to wait before probing again, after `failures` consecutive misses.
 *
 * Backoff, because the probe runs while the app is in the foreground and a
 * tight loop on a phone with no signal is a battery complaint and a support
 * ticket. Capped at a minute: past that the delay stops buying anything and
 * starts making the app feel dead for a whole minute after the signal returns.
 *
 * Zero failures is the steady-state poll and is deliberately long — 30s. When
 * things are working, traffic is doing this job for free and the probe is only
 * there to notice a silent drop on an idle screen.
 */
export function probeDelayMs(failures: number): number {
  if (failures <= 0) return 30_000;
  const ladder = [2_000, 4_000, 8_000, 15_000, 30_000];
  return failures - 1 < ladder.length ? ladder[failures - 1] : 60_000;
}

/**
 * The sentence to put in front of somebody whose write did not land.
 *
 * This is the whole point of the file. Today four client screens say "Check
 * your connection and try again" whatever happened, and one of the two things
 * that happened is the server having read the request and declined it — a full
 * class, a lapsed membership, a policy. Sending that person to their wifi
 * settings wastes their time and hides the actual answer.
 *
 * Returns a sentence and never null, because every caller here is already
 * committed to saying something. Sentence case, no value interpolated, so it
 * is safe to append to any specific first half the caller has written.
 */
export function retryLine(reach: Reach): string {
  if (reach === 'offline') return 'Your phone is not reaching us at the moment, so nothing was sent. Try again once you have signal.';
  if (reach === 'online') return 'We reached the server and it did not accept that, so nothing has changed. Try again, and let us know if it keeps happening.';
  return 'Check your connection and try again.';
}

/**
 * The standing banner, or null when there is nothing to say.
 *
 * Null for 'unknown' as well as for 'online': a launch that has not made a
 * request yet must not draw an offline warning, and the app is unusable-looking
 * enough offline without also being wrong about it.
 *
 * Deliberately does NOT promise that anything will be sent later. Whether a
 * particular write is queued is a fact about that write, and src/lib/outbox.ts
 * owns saying so. This sentence only states what is true of everything: the app
 * is running on what it already had.
 */
export function offlineBanner(reach: Reach): string | null {
  if (reach !== 'offline') return null;
  return 'No connection. You are seeing what was on this phone the last time it could reach us.';
}

/**
 * Whether a screen may state, as a fact, that a read came back empty.
 *
 * The house rule is that an empty list under 'error' means UNKNOWN. This is the
 * same rule reaching one step further back: when the app cannot reach the
 * server at all, even a cached list that looks complete is a list from some
 * earlier moment, and "there are none" is not available as a sentence.
 */
export const canAssertEmpty = (reach: Reach): boolean => reach !== 'offline';

/* ── the store ────────────────────────────────────────────────────────────
 *
 * A module singleton rather than React state, for one reason that decides it:
 * the thing with the best evidence is `src/lib/supabase.ts`'s fetch wrapper,
 * which is not in a component and cannot be. A hook subscribes to this (see
 * src/ui/reachability.tsx); nothing subscribes the other way round.
 */

let state: ReachState = initialReach();
const listeners = new Set<(s: ReachState) => void>();

/** What we believe right now. */
export const reachState = (): ReachState => state;
export const currentReach = (): Reach => state.reach;

/** Called on every change, including a change of `failures` with the same
 *  `reach` — the probe schedules off that number. Returns an unsubscribe. */
export function subscribeReach(fn: (s: ReachState) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function apply(next: ReachState) {
  if (next.reach === state.reach && next.since === state.since && next.failures === state.failures) return;
  const wasOnline = state.reach === 'online';
  state = next;
  listeners.forEach((fn) => { try { fn(next); } catch { /* one bad listener must not stop the rest */ } });
  // The reconnect edge, announced separately so the flush does not have to
  // work it out from a stream of states. Only 'not online' → 'online' counts:
  // 'unknown' → 'online' on a cold launch is a reconnect for our purposes,
  // because a queue written by the previous run has been waiting for exactly
  // this moment.
  if (!wasOnline && next.reach === 'online') {
    onlineListeners.forEach((fn) => { try { fn(); } catch { /* as above */ } });
  }
}

const onlineListeners = new Set<() => void>();

/** Called once each time the app goes from not-reaching to reaching. This is
 *  the hook src/lib/offlineQueue.ts's flush is wired to. */
export function onReconnect(fn: () => void): () => void {
  onlineListeners.add(fn);
  return () => { onlineListeners.delete(fn); };
}

/** A request came back. Cheap enough to call on every response. */
export const noteReached = (now: number = Date.now()): void => { apply(reachAfter(state, 'reached', now)); };

/** A request produced no answer. */
export const noteUnreachable = (now: number = Date.now()): void => { apply(reachAfter(state, 'unreachable', now)); };

/** A thrown value from a request, classified. Anything we aborted ourselves is
 *  ignored rather than reported as no signal. */
export function noteThrown(err: unknown, now: number = Date.now()): void {
  if (isTransportFailure(err)) noteUnreachable(now);
}

/** Back to knowing nothing. For tests, and for a sign-out, where the next
 *  account's first request should decide this again from scratch. */
export function resetReach(): void {
  state = initialReach();
  listeners.forEach((fn) => { try { fn(state); } catch { /* ignore */ } });
}

/**
 * `fetch`, with every call reporting what it learnt.
 *
 * Installed once, on the Supabase client itself, so this is not a thing each
 * provider has to remember to do — and there is no version of the app where
 * some screens update the answer and some do not.
 *
 * The response is returned untouched and errors are re-thrown unchanged: a
 * caller must not be able to tell this wrapper is there. A 4xx or 5xx is
 * `noteReached`, deliberately — the server answered, which is the only thing
 * this file claims to measure. Whether it answered YES is offlineQueue's
 * question and it has better evidence for it.
 */
export function observedFetch(
  base: (input: any, init?: any) => Promise<Response>,
): (input: any, init?: any) => Promise<Response> {
  return async (input: any, init?: any) => {
    try {
      const res = await base(input, init);
      noteReached();
      return res;
    } catch (e) {
      noteThrown(e);
      throw e;
    }
  };
}
