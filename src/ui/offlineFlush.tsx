// The two moments a queued write is sent, wired up.
//
// The registry and the single-flight rule are in src/lib/offlineQueue.ts, with
// a test. This file is the part that needs React Native: AppState, and a
// subscription to the reconnect edge that src/lib/reachability.ts raises.
//
// Before this existed the answer to "when does a queued write go up" was: the
// next time the member launches the app AND lands on the screen that owns that
// queue, because every provider flushed inside its own hydrate effect. For
// somebody who trains at seven and does not open the app again until the next
// session, that is the following morning, from inside the same basement.
import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { flushAll } from '../lib/offlineQueue';
import { currentReach, onReconnect } from '../lib/reachability';

/**
 * Mount once, near the root, INSIDE every provider that registers a flusher.
 * Renders nothing.
 *
 * Both triggers funnel into `flushAll`, which is single-flight — they fire
 * together constantly, because returning to the foreground is usually also the
 * moment the first request succeeds.
 */
export function OfflineFlush() {
  useEffect(() => {
    /**
     * Nothing is attempted while we know we cannot reach the server.
     *
     * Not an optimisation. Each provider's flusher tries its own writes, fails,
     * and puts them back — which is correct but costs a `tries` increment on
     * every intent and, on the surfaces that bump a counter, makes a phone that
     * has been in a basement for an hour look like a phone whose writes are
     * being refused. Under 'offline' the thing worth waiting for is the
     * reconnect edge, and that is subscribed below.
     *
     * 'unknown' DOES flush: a cold launch has not learnt anything yet and the
     * queue from last night is exactly what needs to go.
     */
    const tryFlush = () => { if (currentReach() !== 'offline') void flushAll(); };

    // On mount, once. This is the launch case the old per-provider flush
    // covered, kept — a member who opens the app on wifi should not have to
    // wait for a probe interval before last night's session goes up.
    tryFlush();

    const offReconnect = onReconnect(() => { void flushAll(); });

    const onAppState = (next: AppStateStatus) => { if (next === 'active') tryFlush(); };
    const sub = AppState.addEventListener('change', onAppState);

    return () => { offReconnect(); try { sub.remove(); } catch { /* ignore */ } };
  }, []);

  return null;
}
