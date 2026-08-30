// Where Back goes from a detail screen.
//
// ── Why router.back() is not enough ───────────────────────────────────────
//
// Every screen in these three apps is a tab. The exercise detail, the library,
// the workout program and forty others are all <Tabs.Screen> entries with
// `href: null` — reachable only by navigation, but tabs all the same. So
// router.back() never pops a stack; it asks the tab navigator's history.
//
// That history is a list of UNIQUE routes: visiting one you have already been
// to MOVES its entry rather than adding a second. Open the library, read an
// exercise, come back, glance at Train, open another exercise — and the entry
// behind you is no longer the screen you came from. Back lands on Train while
// the person is looking at a movement they opened from the library. It is
// right on a short path, which is why it survived, and wrong on a real one.
//
// So the origin is CARRIED rather than inferred: a screen that opens a detail
// says where Back should return to, and that stays true however the tab
// history has been reordered since.
//
// ── Why a key and not a path ──────────────────────────────────────────────
//
// The origin arrives as a route param, and a deep link can put anything in a
// route param. Sending a key that is looked up here means an unknown value
// resolves to null — the caller falls back to the navigator's own idea of
// back — rather than navigating somewhere nobody chose.

/** The screens a detail view can be opened from, by the key they pass. */
export const BACK_TO = {
  clientLibrary: '/(client)/library',
  clientWorkouts: '/(client)/workouts',
  ownerLibrary: '/(owner)/library',
  trainerBuilder: '/(trainer)/builder',
  trainerLibrary: '/(trainer)/library',
} as const;

export type BackToKey = keyof typeof BACK_TO;

/** The route a `from` param names, or null if it names nothing we send. */
export function backDestination(from: string | undefined | null): string | null {
  if (!from) return null;
  // hasOwnProperty, not `from in BACK_TO`: `in` walks the prototype, so
  // ?from=toString would resolve to a function and be navigated to.
  return Object.prototype.hasOwnProperty.call(BACK_TO, from) ? BACK_TO[from as BackToKey] : null;
}

/** 'library', from '/(client)/library'. */
export function routeNameOf(dest: string): string {
  return dest.slice(dest.lastIndexOf('/') + 1);
}

/**
 * Detail screens — a screen that exists to explain a row of some other screen.
 *
 * These are the one direction Back must never travel. Reaching the library by
 * navigating to it (rather than popping to it) leaves the exercise detail
 * BEHIND it in the tab history, so the library's own Back would return to the
 * movement the person just finished reading. That is forward, not back, and it
 * is a loop the two screens can never leave.
 */
const DETAIL_ROUTES = new Set(['exercise']);

export type NavRoute = { key: string; name: string };
export type NavState = { routes?: NavRoute[]; history?: { type?: string; key?: string }[] } | null | undefined;

/**
 * The route a tab navigator's GO_BACK would land on, by name.
 *
 * The tab history's LAST entry is the screen you are looking at, so the one
 * before it is where back goes. Null when the state cannot be read — a caller
 * that cannot tell should defer to the navigator rather than guess.
 */
export function previousRouteName(state: NavState): string | null {
  const hist = (state?.history ?? []).filter((h) => !h.type || h.type === 'route');
  const prev = hist[hist.length - 2];
  if (!prev?.key) return null;
  return state?.routes?.find((r) => r.key === prev.key)?.name ?? null;
}

/**
 * The nearest entry behind this screen that is not one of its own details, by
 * name — what a hub screen like the library should treat as "back".
 */
export function previousNonDetailRouteName(state: NavState): string | null {
  const hist = (state?.history ?? []).filter((h) => !h.type || h.type === 'route');
  for (let i = hist.length - 2; i >= 0; i--) {
    const name = state?.routes?.find((r) => r.key === hist[i]?.key)?.name;
    if (name && !DETAIL_ROUTES.has(name)) return name;
  }
  return null;
}
