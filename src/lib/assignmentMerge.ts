// What happens to a programme the server no longer returns.
//
// ── The defect ─────────────────────────────────────────────────────────────
//
// src/ui/assignedPrograms.tsx folded every read into what it already held:
//
//   if (Object.keys(m).length) setPrograms((prev) => ({ ...prev, ...m }));
//
// which is a merge with no way to say "and this one is gone". A coach who takes
// a client off a block writes a DELETE that the client's next read answers with
// zero rows — and zero rows is exactly the case the guard above skips. The
// removal has no effect on a running app at all: the member goes on being shown
// the block, under `status: 'ready'`, until the process is killed.
//
// It was a small bug while a re-read only happened when somebody pulled down on
// a screen. src/lib/readRefresh.ts makes the app re-read on every reconnect and
// every return to the foreground, so the same session now survives days — and
// a member can train an ended block for all of them.
//
// ── Why the merge cannot simply be deleted ─────────────────────────────────
//
// It is load-bearing twice over, and both are ways of erasing something real:
//
//   1. A PREFIX PROVES NOTHING. The read is capped (src/lib/rowCap.ts) and
//      arrives as 'partial' when it hits the cap. A client whose row sat past
//      the cap is ABSENT from a truncated page for a reason that has nothing to
//      do with their programme, and replacing the map with that page would take
//      a live block off a screen because a coach's book got long.
//
//   2. A WRITE IN FLIGHT IS NOT YET IN A READ. `assignProgramTo` writes the map
//      optimistically so the screen answers the tap, and the upsert follows. A
//      read that STARTED before that write and lands after it returns the world
//      without it. Replacing then deletes the coach's own action out from under
//      them, and the write that is about to succeed does not put it back — the
//      optimistic entry was the only place it lived.
//
// So there are three outcomes and the old code had one. This file is the
// decision, kept out of the provider because it is the kind of thing that gets
// re-simplified by somebody who can see only one of the two hazards above.

/** What was known about the read that just landed. */
export interface ReadFacts {
  /**
   * The whole set came back — 'ready', not 'partial'. Only a whole read can
   * prove an absence, which is the entire question here.
   */
  whole: boolean;
  /**
   * How many writes this device had in flight while the read was running.
   *
   * A count and not a boolean: a bulk assign is twelve of these at once
   * (src/lib/bulkActions.ts), they settle one at a time, and a boolean flipped
   * off by the first to finish would let a read land on top of the other
   * eleven.
   *
   * The count is the HIGH-WATER mark across the read's own window — snapshotted
   * before the request goes out and taken again when the answer is processed,
   * whichever is larger. Reading it only at the end is not enough: a write that
   * started before the select and finished before the answer arrived may still
   * be missing from that answer, and by then the counter is back at zero.
   */
  writesInFlight: number;
}

/**
 * May this read remove rows that are not in it?
 *
 * The whole file in one line, exported so a caller can ask the question without
 * running the merge — and so the test can hold the two hazards separately from
 * the mechanics.
 */
export const mayDrop = (f: ReadFacts): boolean => f.whole && f.writesInFlight === 0;

/**
 * The map after a read.
 *
 * When the read may drop, the server's answer IS the answer, including when it
 * is empty. When it may not, the read still updates and adds — it just cannot
 * take anything away.
 *
 * Returns a new object either way rather than `server` itself, so a caller
 * cannot end up holding a reference to a map the read loop is still filling in.
 */
export function mergeAssignments<T>(
  previous: Record<string, T>,
  server: Record<string, T>,
  facts: ReadFacts,
): Record<string, T> {
  return mayDrop(facts) ? { ...server } : { ...previous, ...server };
}

/**
 * The start dates after the same read, kept in step with the programmes.
 *
 * Keyed off the assignments that survived rather than merged on their own,
 * because a start date is a fact about an assignment and there is nothing for
 * one to be the first week of once the assignment is gone. Leaving an orphan
 * behind is how "week 3 of 8" ends up printed over a generic programme.
 *
 * A client who is still assigned but whose row now carries no date loses theirs
 * too, on a read that may drop: the coach clearing a start date is a real edit,
 * and absence from the map is how this app spells "they did not say".
 */
export function mergeStartsOn(
  previous: Record<string, string>,
  server: Record<string, string>,
  kept: Record<string, unknown>,
  facts: ReadFacts,
): Record<string, string> {
  const base = mayDrop(facts) ? { ...server } : { ...previous, ...server };
  const out: Record<string, string> = {};
  for (const id of Object.keys(base)) {
    if (Object.prototype.hasOwnProperty.call(kept, id)) out[id] = base[id] as string;
  }
  return out;
}
