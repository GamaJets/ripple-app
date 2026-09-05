// The React half of src/lib/reachability.ts: a hook screens can read, and the
// one component that asks when nothing else is asking.
//
// Everything with an opinion lives in the lib file, which is plain TypeScript
// and has a test. What is here is the two things that cannot be tested under
// node — React state and a timer — kept as thin as they will go.
//
// ── Why there is a probe at all ────────────────────────────────────────────
//
// src/lib/supabase.ts routes every HTTP call through `observedFetch`, so on a
// busy screen the answer is free and always current. Two cases are not covered
// by that and both of them are the ones that matter:
//
//   · A screen that has finished loading and is making no requests. The member
//     walks into the basement. Nothing fails, because nothing is being tried,
//     and the app goes on believing it is online until they type something.
//
//   · Coming back FROM offline. By definition nothing is succeeding, so there
//     is no traffic to learn from and no reason for any to start. Without a
//     probe the app finds out it has signal again the next time the member
//     does something, which is the exact wait this whole item is about.
//
// The probe is a bare `fetch` to the Supabase host with a short abort timeout.
// It is not a supabase-js call: it needs no session, must not refresh a token,
// and must not be affected by whether one is valid. Any answer at all counts,
// including a 401 — the question is whether bytes come back from our host.
import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  currentReach, noteReached, noteThrown, probeDelayMs, reachState, subscribeReach,
  type Reach,
} from '../lib/reachability';

/** Whether this phone can reach us, as React state. Re-renders on every change,
 *  which is at most one per request outcome that actually changes the answer —
 *  `subscribeReach` only fires on a real change. */
export function useReachability(): Reach {
  const [reach, setReach] = useState<Reach>(currentReach());
  useEffect(() => {
    // Read once on mount as well as subscribing: the answer may have changed
    // between the initial state and the subscription being installed.
    setReach(currentReach());
    return subscribeReach((s) => setReach(s.reach));
  }, []);
  return reach;
}

/** Where the probe knocks. The Supabase host's own health endpoint.
 *
 *  It answers on a bare GET, and it answers 401 — the gateway naming itself and
 *  saying no key was sent. That is an answer, which is the entire question this
 *  probe asks; `knock` below sets out why it is left that way rather than
 *  quietened with a key. It does NOT need a key to be a useful instrument, which
 *  is not the same as needing no key to return 200, and this comment used to say
 *  the second while meaning the first.
 *
 *  Empty when the app is built without a backend, and the probe then does
 *  nothing at all rather than fetching a malformed URL every thirty seconds. */
function probeUrl(): string | null {
  const base = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  return base ? `${base}/auth/v1/health` : null;
}

/** How long the probe waits before giving up and calling it unreachable.
 *  Short: a request that has not answered in six seconds is not going to save
 *  anybody's session, and the cost of being wrong is one extra probe. */
const PROBE_TIMEOUT_MS = 6_000;

/**
 * One knock. Reports through the store either way and swallows everything —
 * a probe that throws into a timer is an unhandled rejection and, on some
 * runtimes, a crash.
 *
 * ── The 401, and why it stays ─────────────────────────────────────────────
 *
 * This request carries no `apikey`, so the Supabase gateway answers 401 and
 * never reaches GoTrue. That has been read as a defect — a stream of
 * authentication failures in the project's auth log, produced by us — and it
 * was looked at properly on 4 September 2026. It is not one, and it is being
 * written down here so the next reader does not have to look twice.
 *
 * Verified against the live project rather than assumed. Unauthenticated, the
 * endpoint answers:
 *
 *     401  {"message":"No API key found in request", …}
 *     sb-error-code:   UNAUTHORIZED_MISSING_API_KEY
 *     sb-project-ref:  <this project>
 *
 * Two things follow from that, and they are the whole argument.
 *
 * FIRST: the answer names our own project. It is the edge saying "you have
 * reached me and you did not identify yourself" — which is a positive
 * identification of the host, and it is precisely the fact this probe exists to
 * establish. Nothing about it is a rejection of the app, and nothing about it
 * would be more true at 200.
 *
 * SECOND, and this is the part that decides it: adding the key would change
 * nothing about the verdict and would put a trap in the file. `noteReached()`
 * fires on the fetch RESOLVING; the status is never read, deliberately, and a
 * 200, a 401 and a 503 are one answer here. So the key would buy a tidier auth
 * log and nothing else — while making the probe depend on a credential being
 * present and current. The moment somebody later "tightens" this by checking
 * `res.ok`, that version reports the entire backend UNREACHABLE on a rotated or
 * mistyped key: the app draws `offlineBanner`, `retryLine` starts telling
 * people to go and find signal, and every read that fails behind it shows its
 * own 'error' copy — on a server that is answering perfectly. (Those are what
 * the state reaches today. This sentence used to name a `canAssertEmpty` too;
 * it was exported, tested and called by nothing, and has been deleted — see
 * the note standing in its place in src/lib/reachability.ts.) This version cannot fail that way, because there is no key here to
 * be wrong. That immunity is worth more than a clean log.
 *
 * The volume is also smaller than it looks. The probe runs FOREGROUND ONLY and
 * the steady interval is 30s (`probeDelayMs(0)`), so it is 2 knocks per minute
 * of screen time and nothing at all while the app is away — a few dozen a day
 * for a real member, not four figures. Every ordinary request the app makes
 * already reports for free through `observedFetch`, which is why the interval
 * can be as slow as it is.
 *
 * What this probe genuinely cannot see is a captive portal that answers on the
 * host's behalf: a hotel splash page returning its own 200 makes this fetch
 * resolve, and the app believes it is online. That is a real hole and it is NOT
 * closed by sending a key, because the portal never forwards the request either
 * way. Closing it means inspecting the response and deciding that some answers
 * do not count — and every heuristic for that (a content type, a header, a body
 * shape) risks calling a healthy server unreachable, which is a far worse
 * failure than the one it fixes and would happen to people with working signal.
 * It is left open on purpose: the portal is caught by the next real request,
 * which fails to parse and reports through `observedFetch` with better evidence
 * than a probe has.
 *
 * The abort is deliberately NOT reported as a transport failure by
 * `isTransportFailure`, so the timeout is turned into an explicit
 * `noteThrown(new Error(...))` here: a probe that timed out genuinely did not
 * reach us, and that is different from a screen unmounting mid-read.
 */
async function knock(url: string): Promise<void> {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; try { ctl?.abort(); } catch { /* ignore */ } }, PROBE_TIMEOUT_MS);
  try {
    await fetch(url, { method: 'GET', cache: 'no-store', signal: ctl?.signal } as any);
    noteReached();
  } catch (e) {
    if (timedOut) noteThrown(new Error('probe timed out'));
    else noteThrown(e);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Mount once, near the root. Renders nothing.
 *
 * Runs only while the app is in the foreground. A background timer on iOS is
 * either killed or, worse, coalesced into a wake-up that burns battery for a
 * fact nobody is looking at — and the moment that matters is the return to the
 * foreground, which is handled explicitly by the AppState branch below rather
 * than by a timer that happened to fire.
 *
 * The schedule comes from `probeDelayMs`, so a phone with no signal backs off
 * to a minute and a working one only knocks twice a minute at most. Every
 * ordinary request the app makes counts for free, which is why the healthy
 * interval can be as slow as it is.
 */
export function ReachabilityProbe() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);

  useEffect(() => {
    const url = probeUrl();
    if (!url) return;
    stopped.current = false;

    const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };

    const schedule = (delay: number) => {
      clear();
      if (stopped.current) return;
      timer.current = setTimeout(run, delay);
    };

    const run = async () => {
      if (stopped.current) return;
      await knock(url);
      if (stopped.current) return;
      // Re-read the failure count AFTER the knock, so a miss backs off and a
      // hit returns to the slow interval on the very next tick rather than one
      // cycle later.
      schedule(probeDelayMs(reachState().failures));
    };

    // The first knock is not immediate. A cold launch is already making real
    // requests — auth, the providers' hydrates — and every one of them reports
    // through `observedFetch`, so knocking on top of them would be a duplicate
    // round trip on the slowest moment of the app's life.
    schedule(probeDelayMs(reachState().failures));

    const onAppState = (next: AppStateStatus) => {
      if (next === 'active') {
        // Straight away, not on the schedule. Coming back to the foreground is
        // the moment somebody is about to do something, and it is also the
        // likeliest moment for the answer to have changed while nothing was
        // running — a phone that was in a pocket on a train.
        void run();
      } else {
        clear();
      }
    };
    const sub = AppState.addEventListener('change', onAppState);

    return () => { stopped.current = true; clear(); try { sub.remove(); } catch { /* ignore */ } };
  }, []);

  return null;
}
