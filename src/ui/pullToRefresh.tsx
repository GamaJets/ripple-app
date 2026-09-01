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
import { useCallback, useRef, useState } from 'react';
import { RefreshControl } from 'react-native';
import { useTheme } from './components';

/**
 * How long the spinner stays up at minimum, in milliseconds.
 *
 * Most `reload` functions in this app return void: they bump a revision, or set
 * a state that an effect watches, and the read happens somewhere the caller
 * cannot await. Resolving instantly would snap the spinner away before the
 * finger has left the glass, which reads as "the gesture did not register" —
 * exactly the conclusion this whole file exists to stop somebody reaching.
 *
 * Short enough not to be a delay anybody waits on, long enough to be seen.
 */
const MIN_SPIN_MS = 450;

/**
 * A ready-made `refreshControl` for a ScrollView, driven by the screen's own
 * reload.
 *
 * `reload` may return a promise or nothing. When it returns a promise the
 * spinner tracks the actual read, which is the honest thing and is what the two
 * screens that already had this did; when it returns nothing the floor above
 * takes over, because the alternative is pretending to know something about a
 * read this hook cannot see.
 *
 * A rejected reload does NOT rethrow. The screen already has a status and
 * already says what went wrong; a pull-to-refresh that throws out of a gesture
 * handler would take the screen down over a failure it is designed to survive.
 */
export function usePullToRefresh(reload: () => void | Promise<unknown>) {
  const t = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  // Ref, not the state above. A second pull that arrives while the first read
  // is in flight would otherwise fire the read again — and on a slow connection
  // that is exactly when somebody pulls twice.
  const busy = useRef(false);

  const onRefresh = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    const started = Date.now();
    void Promise.resolve()
      .then(() => reload())
      .catch(() => { /* the screen's own status says what happened */ })
      .then(() => new Promise<void>((r) => setTimeout(r, Math.max(0, MIN_SPIN_MS - (Date.now() - started)))))
      .then(() => { busy.current = false; setRefreshing(false); });
  }, [reload]);

  return <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.ink3} />;
}
