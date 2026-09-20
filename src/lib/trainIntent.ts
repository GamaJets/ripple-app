// Carrying "I want to start a workout" through a tab switch.
//
// ── What this exists to stop ──────────────────────────────────────────────
//
// Reported from a phone: "When I press start workout - nothing is coming out!
// It's stuck on the same screen." Home was showing "Ready to Train · Full Body
// A" over a live Start Workout, and pressing it looked like nothing at all.
//
// Train is a TAB. A tab screen stays mounted once visited, and the Train
// screen's `mode` (Program / Cardio / HIIT / Mobility / Recovery / Stretch) and
// `dayIdx` are both plain `useState` seeded once at mount. So a bare
// `router.push('/(client)/workouts')` hands somebody back the screen exactly as
// they left it — the Cardio log, or a day they had read ahead to — and neither
// of those has a Start button on it. `startGate` returns `note: null` for
// 'not-strength' deliberately, so nothing on screen explains the absence
// either: the tab changed, the content did not, and the intent was gone.
//
// Nothing throws on that path, which is why it left no trace in `app_errors`
// and could not be found by looking for a crash.
//
// ── Why a nonce and not a flag ────────────────────────────────────────────
//
// `?start=1` would carry the intent exactly once. A member who presses Start
// Workout, taps Cardio to look at something, goes Home and presses Start
// Workout again arrives with the same params as last time — nothing changes,
// so the receiving effect does not re-run, and the second press genuinely does
// nothing. That is the reported bug again, one step further along.
//
// So the value is a fresh one per press. It is never read as a number or shown
// to anybody; the only thing asked of it is that this press differs from the
// last one.

/** How many distinct values a single millisecond can produce. Two presses
 *  inside one millisecond is not a thing a thumb can do, but a test can, and a
 *  counter costs nothing. */
let seq = 0;

/**
 * The route to push for "start a workout", with the intent attached.
 *
 * Anything that is NOT the Train route is returned untouched. The Home card is
 * adaptive — the same control sends people to Recovery or to Meals depending on
 * the day — and a `start` param on those means nothing and would only be a
 * query string in somebody's deep link.
 *
 * @param route the route the caller would have pushed anyway.
 * @param mode  optionally the log to open, for callers with a more specific
 *   intent than "the program" — the Recovery screen sending somebody to log a
 *   sauna, say. Left off, the receiving screen resets to the program.
 */
export function trainIntent(route: string, mode?: string): string {
  if (!isTrainRoute(route)) return route;
  seq += 1;
  const token = `${Date.now().toString(36)}${seq.toString(36)}`;
  const sep = route.indexOf('?') >= 0 ? '&' : '?';
  return `${route}${sep}start=${token}${mode ? `&mode=${encodeURIComponent(mode)}` : ''}`;
}

/**
 * Whether a route is the Train tab.
 *
 * Compared against the path only. A route that already carries params is still
 * the Train route, and `'/(client)/workouts-something'` is not — which is why
 * this is a boundary check and not `includes('workouts')`.
 */
export function isTrainRoute(route: string): boolean {
  const path = route.split('?')[0].replace(/\/+$/, '');
  return path === '/(client)/workouts';
}
