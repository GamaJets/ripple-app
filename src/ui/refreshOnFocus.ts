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
 * ── Why the callback's identity cannot be allowed to matter ────────────────
 *
 * This used to pass `refresh` straight into `useFocusEffect`'s dependency
 * array, with a note telling the caller to keep it stable. That note was
 * correct and it was not enough. A dependency array is a request; on 2026-09-04
 * the coach app was found spinning continuously on a booted simulator —
 * React's "Maximum update depth exceeded", every one and a half to three
 * seconds, from launch — because it was not being honoured.
 *
 * The route it took is worth writing down, because no single file looked wrong:
 *
 *   · `app/(trainer)/dashboard.tsx` collects FOURTEEN provider reloads into one
 *     `reloadEverything` and lists every one of them as a dependency. That is
 *     the right thing for it to do; the screen genuinely refreshes fourteen
 *     reads and must not close over a stale one.
 *   · Several of those providers published their context value as an object
 *     literal, so a new `reload` function on every render of the provider.
 *   · At least one of those providers changed its own state on every reload —
 *     `src/ui/invites.tsx` re-read a Set of handled ids and called its setter
 *     with a fresh Set whether or not an id had changed.
 *
 * Put together: focus → reloadEverything → a provider re-renders → a new
 * `reload` → a new `reloadEverything` → this effect re-runs → focus handler
 * again. Fourteen dependencies is fourteen chances for one link in that chain,
 * across four apps' worth of providers, on a screen nobody was editing.
 *
 * So the identity is no longer part of the contract. `refresh` is held in a ref
 * and the callback handed to `useFocusEffect` never changes, which means this
 * hook runs on FOCUS and on nothing else — which is the only thing its name
 * ever promised. A caller may still memoise, and should for its own reasons;
 * it can no longer cause an unbounded read loop by failing to.
 *
 * The ref is written on every render, so the run that happens on the next focus
 * calls the LATEST `refresh` rather than the one from mount. That is the half
 * the old dependency array was actually buying, and it is kept.
 *
 * Nothing is awaited and nothing is returned. A screen that needs to know
 * whether the re-read landed already has a `LoadStatus` for it, and this hook
 * has no business having an opinion about one.
 */
export function useRefreshOnFocus(refresh: () => void): void {
  // A ref rather than state: this must not itself cause a render, and its value
  // is only ever read inside the effect.
  const seen = useRef(false);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useFocusEffect(
    // Empty dependencies, deliberately and permanently. See above.
    useCallback(() => {
      if (!seen.current) { seen.current = true; return; }
      refreshRef.current();
    }, []),
  );
}
