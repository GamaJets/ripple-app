// Pull down to try again — the gesture the app kept telling people to use.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// Two of the sixty-five client screens had a RefreshControl. Meanwhile
// app/(client)/calendar.tsx told the member "pull down to refresh" in two
// separate places and app/(client)/recovery.tsx said "pull down to try again",
// on screens where pulling down did nothing at all.
//
// That is worse than the missing gesture on its own, because the member does
// what they are told, nothing happens, and the conclusion available to them is
// that the data really is gone. Every one of these screens reads from a server
// that can refuse, drop or time out, and without this a single failed read
// strands the screen for the entire session — the only way back is to kill the
// app, and most people simply stop using the feature instead.
//
// ── Why a hook returning an element ────────────────────────────────────────
//
// Because the alternative is fifteen copies of the same four lines of state,
// and the two screens that already had it had already written those four lines
// twice with different spinner colours. `refreshControl` takes an element, so
// the hook can hand back the finished element and there is nothing left at the
// call site to get subtly different.
//
// ── Why the state machine is not in here ───────────────────────────────────
//
// It is in src/lib/pullRefresh.ts, and that file's header is the reason: the
// spinner used to be cleared only when the screen's reload SETTLED, and no
// request this app makes has a timeout, so a read that never answered spun the
// wheel until the app was killed and left the re-entry guard set for the life
// of the screen. Fixing that needs a floor, a ceiling and a generation counter
// running against a clock — which is testable when it is a plain function and
// is not testable at all inside a hook, and one hundred and thirty-four screens
// hang off it.
import { useRef, useState } from 'react';
import { RefreshControl } from 'react-native';
import { useTheme } from './components';
import { makeRefresher, type Refresher } from '../lib/pullRefresh';

/**
 * A ready-made `refreshControl` for a ScrollView, driven by the screen's own
 * reload.
 *
 * `reload` may return a promise or nothing. When it returns a promise the
 * spinner tracks the actual read, which is the honest thing and is what the two
 * screens that already had this did; when it returns nothing the floor in
 * pullRefresh.ts takes over, because the alternative is pretending to know
 * something about a read this hook cannot see.
 *
 * A rejected reload does NOT rethrow. The screen already has a status and
 * already says what went wrong; a pull-to-refresh that throws out of a gesture
 * handler would take the screen down over a failure it is designed to survive.
 */
export function usePullToRefresh(reload: () => void | Promise<unknown>) {
  const t = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  // The latest `reload`, read at the moment of the pull. Most call sites build
  // theirs in a `useCallback` over provider values, so its identity changes
  // whenever any of those providers answers — including part-way through the
  // very refresh it is running. Holding it in a ref keeps the machine below,
  // and the handler the native view is holding, stable across all of that.
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const machine = useRef<Refresher | null>(null);
  if (!machine.current) {
    machine.current = makeRefresher({
      reload: () => reloadRef.current(),
      setRefreshing,
    });
  }

  return <RefreshControl refreshing={refreshing} onRefresh={machine.current.onRefresh} tintColor={t.ink3} />;
}
