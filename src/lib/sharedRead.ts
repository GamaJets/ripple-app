// One row, read once, by everybody who needs it — without any of them being
// told a lie about how their own read went.
//
// ── The measurement this exists for ───────────────────────────────────────
//
// The signed-in user's own `profiles` row was read FIVE times on every cold
// launch, once per provider, each for a different slice of columns:
//
//   src/ui/auth.tsx        full_name
//   src/ui/tenant.tsx      role, tenant_id
//   src/ui/clientData.tsx  full_name, avatar
//   src/ui/settings.tsx    weight_unit, length_unit
//   src/ui/invites.tsx     full_name
//
// and the member's own `clients` row twice more. Five round trips where one
// would do is the cheap half of the complaint. The expensive half is that
// THREE of those five read `full_name`, they landed at different moments, and
// on a bad connection some of them landed and some did not — so for the length
// of a launch the app held up to three different answers to "what is this
// person called", and the greeting, the invite card and the coach's thread list
// could each show a different one.
//
// ── Why a shared read and not a shared PROVIDER ───────────────────────────
//
// The obvious shape is one owner provider holding the row, with the other four
// reading it out of context. It was not chosen, for three reasons:
//
//  · it makes provider ORDER load-bearing. Four providers would have to be
//    mounted inside a fifth, in the root layout, for ever; getting that wrong
//    is a runtime crash on a screen nobody was editing.
//  · it collapses five LoadStatuses into one. Each of these providers reads
//    OTHER things besides this row — tenant reads `tenants`, clientData reads
//    `clients`, invites reads `coach_invites` — and each has to keep saying
//    honestly how ITS read went. A shared provider's 'ready' would leak into
//    all of them.
//  · it does not actually fix the round trips on its own. A provider is a
//    render-time thing; the reads race in effects.
//
// So what is shared is the READ, not the answer's status. Every caller awaits
// the same in-flight request, and every caller is handed the same OUTCOME — a
// success carrying the row, or a failure carrying the error. What each of them
// then does with it, including which LoadStatus they publish, is entirely their
// own business and unchanged.
//
// ── The four rules this file holds ────────────────────────────────────────
//
// 1. A FAILURE REACHES EVERY CALLER THAT JOINED. It is not swallowed by the
//    first one, and it is not turned into a null row that reads as "no such
//    person". `{ ok: false, error }` goes to all of them, which is what lets
//    each provider set its own 'error' and report it under its own name.
//
// 2. A FAILURE IS NEVER CACHED. Only a success is held. The next caller after a
//    failure goes to the server, which is what keeps clientData's retry loop —
//    three attempts, two seconds apart — a real retry rather than three reads
//    of the same cached refusal.
//
// 3. A HELD ANSWER EXPIRES. `freshMs` is small on purpose: it exists to cover
//    the fan-out of providers mounting within the same second of a cold launch,
//    not to be a cache. Past it, a read is a read.
//
// 4. AN INVALIDATED READ IS DROPPED EVEN IF IT IS ALREADY IN FLIGHT. `forget()`
//    is called after a write to the row. A request that left before that write
//    is about to answer with what the row said BEFORE it, so it must not be
//    held and it must not be joined by anybody arriving after. The callers who
//    were already awaiting it still get it — they asked before the write, and
//    handing them a rejection instead would turn a successful write into a
//    failed read on four screens.
//
// Nothing here knows about Supabase, React or a row. It is a promise, a clock
// and a map, so all four rules above are asserted in sharedRead.test.ts rather
// than inspected on a device.

/**
 * How a read went, in a form that survives being handed to several callers.
 *
 * Deliberately not "the value, or null". Null is a real answer for a row that
 * does not exist — a coach has no `clients` row and that is permanent and
 * normal — so the failure has to live somewhere other than in the value.
 */
export type ReadOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

export interface SharedRead<T> {
  /**
   * The answer for `key`, from an in-flight read, a recently held one, or a
   * new one — in that order.
   *
   * `run` is invoked at most once per read. A caller arriving while one is in
   * flight awaits that one and its own `run` is never called, which is the
   * whole point: it means the four call sites can each pass their own closure
   * without four of them running.
   */
  read(key: string, run: () => Promise<ReadOutcome<T>>): Promise<ReadOutcome<T>>;
  /**
   * Drop what is held for `key` — or, with no key, for everything.
   *
   * Called after a write to the row, and by any provider whose refresh is a
   * person asking for a fresh answer rather than a screen mounting.
   */
  forget(key?: string): void;
}

/** Long enough to cover providers mounting in the same second, short enough
 *  that it is not a cache. A read older than this is re-read. */
export const SAME_LAUNCH_MS = 5_000;

interface Entry<T> {
  /** The request currently out, if any. Shared, not copied. */
  inflight: Promise<ReadOutcome<T>> | null;
  /** Which flight `inflight` is. Compared rather than the promise itself,
   *  because a flight has to recognise ITSELF from inside its own body and a
   *  promise cannot be referred to while it is still being constructed. */
  inflightId: number;
  /** The last SUCCESSFUL answer and when it landed. Failures never get here. */
  held: { at: number; outcome: { ok: true; value: T } } | null;
  /** Bumped by `forget`. A read that started under an older one has been
   *  overtaken by a write and may not be held — see rule 4. */
  generation: number;
}

export function createSharedRead<T>(opts?: {
  freshMs?: number;
  /** Injected so the expiry is asserted by arithmetic rather than by sleeping. */
  now?: () => number;
}): SharedRead<T> {
  const freshMs = opts?.freshMs ?? SAME_LAUNCH_MS;
  const now = opts?.now ?? Date.now;
  const entries = new Map<string, Entry<T>>();
  let nextFlightId = 1;

  const entryFor = (key: string): Entry<T> => {
    let e = entries.get(key);
    if (!e) { e = { inflight: null, inflightId: 0, held: null, generation: 0 }; entries.set(key, e); }
    return e;
  };

  const read = (key: string, run: () => Promise<ReadOutcome<T>>): Promise<ReadOutcome<T>> => {
    const e = entryFor(key);
    // Held and still fresh. `>=` on the age, so a freshMs of 0 holds nothing at
    // all and every read is a read — the setting a caller reaches for when it
    // wants this to dedupe only what genuinely overlaps.
    if (e.held && now() - e.held.at < freshMs) return Promise.resolve(e.held.outcome);
    if (e.inflight) return e.inflight;

    const startedAt = e.generation;
    const flightId = nextFlightId++;
    const p: Promise<ReadOutcome<T>> = (async () => {
      let outcome: ReadOutcome<T>;
      try {
        outcome = await run();
      } catch (error) {
        // A throw out of the fetch is nobody answering. It becomes an outcome
        // rather than a rejection so that every joined caller gets the same
        // thing through the same branch — an unhandled rejection here would
        // take down whichever provider happened to be first.
        outcome = { ok: false, error };
      }
      const cur = entryFor(key);
      if (cur.inflightId === flightId) cur.inflight = null;
      // Rule 2 and rule 4, in one condition.
      if (outcome.ok && cur.generation === startedAt) cur.held = { at: now(), outcome };
      return outcome;
    })();
    e.inflight = p;
    e.inflightId = flightId;
    return p;
  };

  const forget = (key?: string): void => {
    if (key === undefined) {
      for (const e of entries.values()) { e.generation += 1; e.held = null; e.inflight = null; }
      return;
    }
    const e = entryFor(key);
    e.generation += 1;
    e.held = null;
    // Dropped, not cancelled. The request is already out and whoever is
    // awaiting it still gets its answer; what this stops is anybody NEW joining
    // a read that predates the write which caused this call.
    e.inflight = null;
  };

  return { read, forget };
}
