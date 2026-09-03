// Come back to a screen, and it goes and looks again.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// Every screen in these three apps is a tab. `app/(trainer)/_layout.tsx`
// registers its detail screens with `href: null`, which keeps them out of the
// bar and MOUNTS THEM ONCE — so a screen that reads on mount reads exactly
// once, for the life of the app, however many times the coach navigates back to
// it.
//
// That defect has shipped repeatedly in this codebase and it always reads the
// same way to the person holding the phone: THE APP DID NOT NOTICE WHAT I JUST
// DID.
//
//   · `src/ui/CoachRequests.tsx` read its pending requests on mount. A coach
//     accepted a request, the row went, they came back, and the request was
//     still there — so they accepted it again. That is the worked example the
//     rest of this file follows, and it is why `useFocusEffect` is the fix
//     rather than a longer cache.
//   · `app/(trainer)/dashboard.tsx` bumped its read nonce from pull-to-refresh
//     and from nothing else. Mark four sessions, come back, and the card still
//     says four are waiting on an outcome. Log a session from the client
//     screen, come back, and What They've Actually Done has not heard of it.
//
// A pull-to-refresh is not the answer to this on its own. It is a gesture for
// "I think this is stale"; coming back from the screen that CHANGED the thing
// is a moment where the app already knows.
//
// ── Why the first focus is skipped ─────────────────────────────────────────
//
// A screen's first focus arrives with its mount, and its mount effects are
// already reading. Firing on it would double every read on every screen that
// adopts this — the same queries, twice, milliseconds apart, on the slow
// connections these screens are used on. So the first focus is counted and not
// acted on, and every focus after it re-reads.
//
// This deliberately does NOT debounce or rate-limit beyond that. A coach
// flicking between two tabs is a coach comparing two screens, and a stale one
// is the thing they would be comparing wrongly.
import { useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';

/**
 * Run `refresh` every time the screen is focused EXCEPT the first.
 *
 * `refresh` must be stable — wrap it in `useCallback` at the call site, exactly
 * as `useFocusEffect` itself requires. An unstable callback re-runs the effect
 * on every render, and on a screen whose refresh changes the state the callback
 * closes over that is an unbounded read loop; `app/(trainer)/client.tsx` has
 * the note about the nine-round-trip version of that bug.
 *
 * Nothing is awaited and nothing is returned. A screen that needs to know
 * whether the re-read landed already has a `LoadStatus` for it, and this hook
 * has no business having an opinion about one.
 */
export function useRefreshOnFocus(refresh: () => void): void {
  // A ref rather than state: this must not itself cause a render, and its value
  // is only ever read inside the effect.
  const seen = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!seen.current) { seen.current = true; return; }
      refresh();
    }, [refresh]),
  );
}
