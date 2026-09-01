/**
 * Supersets, tri-sets and giant sets — exercises performed BACK TO BACK.
 *
 * Asked for as "add exercise selections multi set, super set, giant set etc",
 * alongside a screenshot of another app where each grouped movement carries a
 * "Superset" badge.
 *
 * ── The one design decision in this file ──────────────────────────────────
 *
 * The coach does NOT pick the words "superset" or "giant set". They say which
 * exercises are performed together, and the NAME IS DERIVED FROM HOW MANY
 * THERE ARE, because that is what those words actually mean:
 *
 *     2 movements  → superset
 *     3 movements  → tri-set
 *     4 or more    → giant set
 *
 * Letting a coach choose the label and separately choose the members is how
 * you get a "superset" containing four exercises. The label would then be
 * wrong on the client's screen, during the session, while they are holding a
 * dumbbell — and nothing in the app could tell it was wrong, because both
 * halves were entered deliberately. Deriving it means the badge cannot
 * disagree with the content it labels.
 *
 * ── Adjacency is the whole model ──────────────────────────────────────────
 *
 * A group is a RUN of neighbouring exercises sharing an id, never a set of
 * members scattered through a day. Two exercises are supersetted because you
 * do the second immediately after the first; an exercise sitting between them
 * that is not part of the group is a contradiction, not a configuration.
 *
 * This also means reordering needs no special handling. Drag an exercise out
 * of the middle of a giant set and the run splits into two smaller runs, each
 * relabelled for its new size — a tri-set that loses a movement becomes a
 * superset, and says so. A membership-set model would have needed code to
 * notice that and would have carried a stale label until somebody wrote it.
 */

export type Grouped = { setGroupId?: string | null };

export type GroupRun = {
  /** Index of the first exercise in the run. */
  start: number;
  /** How many exercises are in it — always 2 or more; see `groupRuns`. */
  size: number;
  id: string;
};

/**
 * The maximal runs of adjacent exercises sharing a group id.
 *
 * A run of ONE is not returned. An id held by a single exercise is not a
 * superset of one, it is a leftover — the state you land in when the coach
 * removes the movement it was paired with. Treating it as a group would put a
 * badge reading "superset" on a lone exercise.
 */
export function groupRuns(items: readonly Grouped[]): GroupRun[] {
  const runs: GroupRun[] = [];
  let i = 0;
  while (i < items.length) {
    const id = items[i]?.setGroupId;
    if (!id) { i += 1; continue; }
    let j = i + 1;
    while (j < items.length && items[j]?.setGroupId === id) j += 1;
    if (j - i >= 2) runs.push({ start: i, size: j - i, id });
    i = j;
  }
  return runs;
}

/**
 * What a run of this size is called. Sentence case rather than shouting, per
 * the house rule the capitalisation gate enforces.
 */
export function groupLabel(size: number): string {
  if (size >= 4) return 'Giant set';
  if (size === 3) return 'Tri-set';
  return 'Superset';
}

export type Badge = {
  label: string;
  /** 1-based position within the run, for "Superset · 2 of 2". */
  position: number;
  size: number;
  id: string;
};

/**
 * One badge per exercise, or null where an exercise stands alone. Returned
 * positionally so a renderer can index straight into it rather than searching
 * the runs for every row.
 */
export function badges(items: readonly Grouped[]): (Badge | null)[] {
  const out: (Badge | null)[] = items.map(() => null);
  for (const run of groupRuns(items)) {
    const label = groupLabel(run.size);
    for (let k = 0; k < run.size; k += 1) {
      out[run.start + k] = { label, position: k + 1, size: run.size, id: run.id };
    }
  }
  return out;
}

/**
 * Whether the exercise at `at` may be joined to the one after it. False at the
 * end of the list, and false when they are ALREADY in the same run — the
 * control that offers this is hidden rather than disabled in both cases.
 */
export function canJoinNext(items: readonly Grouped[], at: number): boolean {
  if (at < 0 || at >= items.length - 1) return false;
  const a = items[at]?.setGroupId;
  const b = items[at + 1]?.setGroupId;
  return !(a && b && a === b);
}

/**
 * Whether this exercise is currently part of a real group, i.e. whether there
 * is anything for an "ungroup" control to do.
 */
export function isGrouped(items: readonly Grouped[], at: number): boolean {
  return badges(items)[at] != null;
}

/**
 * Join the exercise at `at` to the one after it, returning the group id each
 * exercise should now hold. Pure: it returns ids rather than mutating rows, so
 * the caller keeps whatever else its exercise objects carry.
 *
 * `mint` supplies a fresh id only when one is actually needed — joining onto
 * an exercise that is already in a run ADOPTS that run's id, which is what
 * turns a superset into a tri-set rather than creating a second group of two
 * that happen to be neighbours.
 */
export function joinNext(items: readonly Grouped[], at: number, mint: () => string): (string | null)[] {
  const ids = items.map((x) => x.setGroupId ?? null);
  if (!canJoinNext(items, at)) return ids;
  // Prefer an id already in play. Left first, arbitrarily but consistently:
  // when both neighbours are in different runs, joining them merges the two,
  // and the merged run has to be called something.
  const id = ids[at] ?? ids[at + 1] ?? mint();
  // Only the RIGHT-hand run needs relabelling. `id` is `ids[at]` whenever that
  // is set, so every member of the left run already holds it; a branch for
  // them was dead code, and a mutation test proved it by deleting the branch
  // without changing a single result. The right run is different — it keeps
  // its own id, and without this its far half would stay under the old one and
  // split back apart on the next render.
  const after = ids[at + 1];
  return ids.map((cur, i) => {
    if (i === at || i === at + 1) return id;
    if (after && cur === after) return id;
    return cur;
  });
}

/**
 * Take the exercise at `at` out of its group. Only that one exercise leaves;
 * the rest of the run stays together and is relabelled for its new size by
 * `badges`, so removing one movement from a tri-set leaves a superset.
 */
export function leaveGroup(items: readonly Grouped[], at: number): (string | null)[] {
  return items.map((x, i) => (i === at ? null : x.setGroupId ?? null));
}
