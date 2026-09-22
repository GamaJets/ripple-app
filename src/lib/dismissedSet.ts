// The ids a person has already dealt with, and the rule that stops re-reading
// them costing a render.
//
// ── The bug this was extracted from ────────────────────────────────────────
//
// `src/ui/invites.tsx` keeps the invitations a member has accepted or declined
// in AsyncStorage so a handled invitation never comes back. Every run of its
// read began by loading that list and calling `setDismissed(new Set(...))` —
// unconditionally, with a freshly allocated Set, whether or not a single id had
// changed.
//
// A Set is compared by identity, so that is a state change every time, so the
// provider re-rendered every time, so its context value — an object literal
// carrying `reload: () => runRef.current()` — was a new object with a new
// `reload` function every time.
//
// That was survivable until something depended on `reload`'s identity.
// `app/(trainer)/dashboard.tsx` collects fourteen of these into one
// `reloadEverything` (a `useCallback` listing them all as dependencies) and
// hands it to `useRefreshOnFocus`, whose own doc comment says the callback must
// be stable because "an unstable callback re-runs the effect on every render,
// and on a screen whose refresh changes the state the callback closes over that
// is an unbounded read loop".
//
// It was exactly that loop, one layer further out than the note anticipated:
//
//   focus effect → reloadEverything → invites reload → run() → setDismissed(new
//   Set) → provider renders → new reload identity → new reloadEverything →
//   focus effect re-runs → …
//
// Measured on a booted simulator on 2026-09-04: React's "Maximum update depth
// exceeded" (the passive-effect variant, whose wording names a dependency that
// "changes on every render") fired every 1.5–3.5 seconds, continuously, from
// app launch. Ten consecutive stacks were captured and every one of them named
// the same line — the `setDismissed` above.
//
// It also explains why the loop made so few requests, which had been the
// puzzling part: each iteration starts a new run, each new run bumps the
// generation counter, and every earlier run therefore aborts at its first
// cancellation check — which sits between `getSession` (local) and `getUser`
// (network). The app was spinning at roughly seventeen renders a second while
// issuing about six requests a minute.
//
// ── Why this is a module and not two inline lines ─────────────────────────
//
// Because the rule is a judgement, not an optimisation: A READ THAT LEARNT
// NOTHING NEW MUST NOT LOOK LIKE A CHANGE. It is the same rule the rest of this
// folder keeps for what it SAYS — an empty list under 'error' is not an empty
// list — applied to what it DOES. Anywhere a provider reloads a set of ids from
// storage on every run, the reload has to be able to be a no-op, and that is
// worth a test rather than a comment.

/**
 * The ids in stored bytes, tolerantly.
 *
 * Anything that is not a JSON array of strings is an empty set, because there
 * is no honest partial answer here and the cost of being wrong is small in one
 * direction only: a set read as empty shows an invitation the member has
 * already handled once more, which they can handle again. A set read as
 * containing an id that was never there hides an invitation for ever.
 *
 * Non-string members are dropped rather than coerced. `String(null)` is
 * `"null"`, and an id of `"null"` would silently match nothing while looking
 * like it matched something.
 */
export function parseDismissed(raw: string | null | undefined): Set<string> {
  if (raw == null) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const out = new Set<string>();
    for (const v of parsed) if (typeof v === 'string' && v) out.add(v);
    return out;
  } catch {
    return new Set();
  }
}

/** Whether two sets hold the same ids. Size first, because that settles most
 *  comparisons without walking either one. */
export function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/**
 * The set to hold after learning `next`, given `prev`.
 *
 * Returns `prev` ITSELF — the same object — when nothing has changed, which is
 * the whole point: handed to a React setter, an identical object is not a state
 * change and nothing re-renders. Returns `next` when it differs.
 *
 * This is not "skip the write if it looks the same". It is the honest answer to
 * "what does this device now believe", which happens to be the object it
 * already had.
 */
export function nextDismissed(prev: Set<string>, next: Set<string>): Set<string> {
  return sameIds(prev, next) ? prev : next;
}

/**
 * The set after one more id is handled.
 *
 * Also returns `prev` unchanged when the id is already in it. A member who taps
 * Decline twice on the same invitation — which the screen allows, because the
 * row is removed optimistically and a failed write puts it back — must not
 * produce a second render carrying an identical set.
 */
export function withDismissed(prev: Set<string>, id: string): Set<string> {
  if (!id || prev.has(id)) return prev;
  const out = new Set(prev);
  out.add(id);
  return out;
}

/** The bytes to store. Sorted, so an unchanged set writes identical bytes and a
 *  diff of what is on the device is readable by a person. */
export function packDismissed(ids: ReadonlySet<string>): string {
  return JSON.stringify([...ids].sort());
}
