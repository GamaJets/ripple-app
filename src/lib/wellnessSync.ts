// Reconciling a local copy with the server's, for the three stores that had no
// server copy at all until part 109.
//
// ── Why this is a module and not three copies of the same twelve lines ─────
//
// `src/ui/availability.ts` established the shape these stores have to take: put
// the device's saved copy on screen first, then refresh from the server, and
// say which of the two the user is looking at. That order is not a compromise —
// the app is used in basement gyms with no signal, and a client who logs a
// night of sleep on a treadmill with two bars has to see it. What that hook got
// wrong first time round, and what its header now documents at length, is that
// a stale local copy rendered identically to a confirmed one, so a coach read
// their own out-of-date schedule and told a client an hour was free.
//
// The sleep log, the water counter and the coach's announcements now all do the
// same dance, and each of them had a subtly different way of getting it wrong
// available to it. So the merging is here, tested, once.
//
// ── The two shapes ─────────────────────────────────────────────────────────
//
// A LOG is append-only and has many rows: sleep entries, announcements. Merging
// is a set union keyed on id, and the interesting case is the entry that was
// written offline and never reached the server.
//
// A COUNTER is one value per person per day: the water count. Merging is a
// choice between two numbers, and the interesting case is two of the client's
// devices each holding one.
//
// ── What none of this may do ───────────────────────────────────────────────
//
// Invent. A failed read hands back what was already known and a flag saying it
// is unconfirmed; it never substitutes a number, and it never reports an empty
// local cache as "you have not logged anything". That distinction is the whole
// subject of src/ui/loadStatus.ts and the reason this file returns `pending`
// counts rather than swallowing them.

/**
 * The prefix on an id that exists only on this device.
 *
 * An entry written offline needs an id immediately — React keys it, the screen
 * lists it, and the client may log a second one before the first has been sent.
 * The server assigns uuids, so a local id has to be distinguishable from one:
 * `pushPending` uses this to decide what still has to go up, and `mergeLog`
 * uses it to decide which local rows survive a server answer.
 *
 * `src/ui/availability.ts` makes the same distinction by asking whether the id
 * `includes('-')` — a uuid does, its local ids do not. That works, but it is a
 * fact about the shape of two id formats rather than a statement of intent, and
 * it silently becomes wrong the day a local id contains a hyphen. This is the
 * same idea written down.
 */
export const LOCAL_PREFIX = 'local:';

/** True for an entry that has never been accepted by the server. */
export const isPending = (id: string): boolean => id.startsWith(LOCAL_PREFIX);

let SEQ = 0;
/** A new local id. Unique within a session; never collides with a uuid. */
export const localId = (): string => `${LOCAL_PREFIX}${Date.now().toString(36)}.${SEQ++}`;

/** The minimum an entry needs for this module to merge and order it. */
export interface Logged { id: string; at: string }

/**
 * Newest first, with a deterministic tie-break.
 *
 * Two entries can share a timestamp — a client logging twice inside the same
 * second, or two rows a server wrote in one statement — and a comparator that
 * returned 0 there would leave their order up to whichever sort the runtime
 * happens to use, so the list could reorder itself between renders for no
 * visible reason. The id breaks the tie because it is the one field guaranteed
 * to differ.
 */
export const byNewest = (a: Logged, b: Logged): number =>
  (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

export interface MergedLog<T extends Logged> {
  /** What the screen shows, newest first. */
  entries: T[];
  /** The subset of `entries` that is not on the server yet. */
  pending: T[];
}

/**
 * The device's copy and the server's, folded into one list.
 *
 * `server` is null when the read failed or has not happened — NOT when it came
 * back empty. That distinction is the whole reason this takes a nullable rather
 * than an array: an empty array from the server means "you genuinely have no
 * entries" and the local copy of a row the server does not have must give way
 * to it, whereas a null means nothing was learnt and the local copy is all
 * there is. Collapsing the two would delete a client's offline sleep log the
 * first time their signal dropped.
 *
 * When the server did answer, a local entry survives only if it is still
 * pending. A local row carrying a server id that the server no longer returns
 * has been deleted, or has fallen outside what was asked for, and either way
 * the server is the authority on it.
 */
export function mergeLog<T extends Logged>(server: T[] | null, local: T[]): MergedLog<T> {
  const out = new Map<string, T>();
  if (server) {
    for (const e of server) out.set(e.id, e);
    for (const e of local) if (isPending(e.id) && !out.has(e.id)) out.set(e.id, e);
  } else {
    for (const e of local) out.set(e.id, e);
  }
  const entries = [...out.values()].sort(byNewest);
  return { entries, pending: entries.filter((e) => isPending(e.id)) };
}

/**
 * Replace a pending entry's local id with the id the server gave it.
 *
 * Returns a new list rather than mutating, and leaves the list untouched when
 * the local id is not in it — the entry can have been dropped by a refresh that
 * landed while the insert was in flight, and re-adding it there would resurrect
 * a row the user had already seen disappear.
 */
export function adoptServerId<T extends Logged>(list: T[], local: string, server: string): T[] {
  return list.map((e) => (e.id === local ? { ...e, id: server } : e));
}

// ── The counter ────────────────────────────────────────────────────────────

/** One device's or the server's idea of today's count, and when it was set. */
export interface CountAt { count: number; at: string }

export interface CountMerge {
  /** The count to show. */
  count: number;
  /** True when the local copy won and the server has not been told. */
  push: boolean;
}

/**
 * Which of two water counts is today's.
 *
 * The naive answer is `Math.max`, and it is wrong in the one case that matters:
 * a client who taps minus because they miscounted would have the correction
 * silently undone, on this device, by the higher number still sitting on the
 * server. The count can go down, so the rule has to be about recency and not
 * magnitude.
 *
 * `at` on the server side is `hydration_logs.updated_at`, which a trigger
 * stamps server-side (part 109) rather than accepting from the writer — because
 * a device with a wrong clock would otherwise win every comparison it entered,
 * permanently, and a phone whose clock is a day fast is not a rare thing.
 *
 * A tie goes to the server. It is the copy both devices can see, so choosing it
 * makes them converge; choosing the local one would leave two phones each
 * quietly convinced of a different number.
 *
 * `push` is deliberately separate from `count`. The caller has to know not just
 * what to display but whether the display is something the server has heard
 * about, because that is the difference between 'ready' and 'error' on a screen
 * that is about to draw six glasses as filled.
 */
export function mergeCount(server: CountAt | null, local: CountAt | null): CountMerge {
  if (!server && !local) return { count: 0, push: false };
  if (!server) return { count: local!.count, push: true };
  if (!local) return { count: server.count, push: false };
  return local.at > server.at
    ? { count: local.count, push: true }
    : { count: server.count, push: false };
}

/**
 * The most glasses the counter will hold in a day.
 *
 * Not a goal, and not a judgement: it is the ceiling that keeps a stuck button
 * from writing an absurd number, and it has to sit at or above the largest goal
 * the database will accept — `clients_water_goal_glasses_check` (part 70) tops
 * out at 30 — or a client who set a 25-glass goal could log 20 and never reach
 * it, leaving the Recovery hero stuck below 100% for the rest of their life.
 * `hydration_logs_glasses_check` (part 109) enforces the same 0..30 server-side,
 * so a client that clamped to something else would simply have its writes
 * refused.
 */
export const WATER_CAP = 30;

/** Bring a count back inside 0..WATER_CAP. Used on both the local cache and
 *  the server's answer, because a value out of range means the same thing from
 *  either — that something wrote a number this app cannot represent — and
 *  neither source is trusted more than the other about it.
 *
 *  A non-finite value becomes 0, not the cap. NaN and Infinity are not large
 *  numbers of glasses, they are the absence of a number — a cache written by
 *  another build, a null that reached arithmetic — and 0 is what already means
 *  "nothing recorded today" everywhere this count is read. Clamping Infinity
 *  upwards would draw a full row of glasses and tick the water habit off a
 *  parse failure. */
export const clampGlasses = (n: number): number =>
  (Number.isFinite(n) ? Math.max(0, Math.min(WATER_CAP, Math.round(n))) : 0);
