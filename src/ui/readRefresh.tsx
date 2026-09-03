// The two moments a failed READ is tried again, wired up.
//
// The registry, the "only the ones that failed" rule, the give-up ceiling and
// the single-flight latch are all in src/lib/readRefresh.ts, with a test. What
// is here is the part that needs React Native: AppState, and a subscription to
// the reconnect edge src/lib/reachability.ts raises.
//
// This is the read-side twin of src/ui/offlineFlush.tsx, which has done exactly
// this for queued writes since it was written. The asymmetry it left behind is
// the whole reason this file exists: a phone that finds signal again sends last
// night's session up and goes on showing the member the screen that says their
// plan could not be read.
//
// ── Why a hook and not a component at the root ────────────────────────────
//
// `<OfflineFlush />` is mounted once in the tree and works because a flusher's
// registration is all it needs. This one needs each provider's CURRENT status,
// which only that provider holds, so the registration has to happen inside it.
// Having the same hook install the triggers means a provider opts into
// recovery in one line and cannot half-adopt it — there is no second thing to
// remember to mount, and no root layout that has to be edited for a provider to
// start recovering.
//
// The triggers themselves are installed ONCE however many providers ask for
// them, and removed when the last one goes. Every trigger funnels into
// `refreshStale`, which is single-flight, so a burst of them is one pass.
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { onReconnect } from '../lib/reachability';
import { refreshStale, registerRefresh } from '../lib/readRefresh';
import type { LoadStatus } from './loadStatus';

let installed = 0;
let offReconnect: (() => void) | null = null;
let appStateSub: { remove: () => void } | null = null;

function installTriggers(): void {
  installed += 1;
  if (installed > 1) return;

  // The signal coming back. The strongest reason there is to re-run a read
  // that failed, and the one trigger that gives a provider its attempts back —
  // see MAX_ATTEMPTS in src/lib/readRefresh.ts.
  offReconnect = onReconnect(() => { void refreshStale('reconnect'); });

  // Returning to the foreground. Not news about the network, but it is the
  // moment somebody is looking at the screen, and a phone that was in a pocket
  // on the walk home has made no requests and so raised no edge to hear.
  // Floored at FOREGROUND_GAP_MS so flicking between apps does not re-read.
  const onAppState = (next: AppStateStatus) => {
    if (next === 'active') void refreshStale('foreground');
  };
  appStateSub = AppState.addEventListener('change', onAppState);
}

function removeTriggers(): void {
  installed = Math.max(0, installed - 1);
  if (installed > 0) return;
  try { offReconnect?.(); } catch { /* ignore */ }
  offReconnect = null;
  try { appStateSub?.remove(); } catch { /* ignore */ }
  appStateSub = null;
}

/**
 * Recover this provider's read when the app can read again.
 *
 * `key` names the provider and must be stable — it is the registry key, and
 * registering by key REPLACES, which is what stops an effect that re-runs on a
 * new auth revision leaving the previous account's reload behind.
 *
 * `status` is passed as a value and read through a ref, so the registration
 * made on mount always sees the current one. A registration that closed over
 * the status would see 'loading' for ever and either refetch everything or
 * nothing.
 *
 * `refetch` is the `reload` or `refresh` the provider already exposes. It is
 * only ever called while the status is 'error' — never over a read in flight,
 * never over one that worked. See `needsRefetch`.
 */
export function useRecoverRead(key: string, status: LoadStatus, refetch: () => void): void {
  const statusRef = useRef<LoadStatus>(status);
  statusRef.current = status;
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    const off = registerRefresh(key, {
      status: () => statusRef.current,
      refetch: () => refetchRef.current(),
    });
    installTriggers();
    return () => { off(); removeTriggers(); };
    // Deliberately keyed on `key` alone. Both moving parts are refs, so a
    // re-registration on every render would churn the map for no gain and
    // would race the unregister's identity check.
  }, [key]);
}
