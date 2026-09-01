// ── Deleting something you can take back ─────────────────────────────────────
//
// ── The defect this exists to end ─────────────────────────────────────────
//
// 227 `Alert.alert` calls in the client app alone. Every confirmation, every
// success and every error stopped the person, dimmed the screen and demanded a
// tap before anything else could happen — including the ones that only said
// "Saved". And the destructive ones were worse than interrupting: a modal that
// asks "Remove this meal?" is not a safety net, it is a speed bump. The tap
// that removes the meal is the same tap on the same side of the same dialog
// every time, so people learn it and stop reading it. The moment it goes
// through, the food entry, the set, the injury or the photo is gone, and the
// app has nothing to offer but sympathy.
//
// The shape that actually protects somebody is the opposite one: do the thing
// immediately, say so quietly, and hold the door open for a few seconds. That
// is what this file is the arithmetic of.
//
// ── Why the delete is DELAYED rather than reversed ────────────────────────
//
// Two ways to build an undo. Delete now and re-insert on undo; or hold the
// delete for a few seconds and drop it if undone. This is the second, and the
// reason is that the first cannot be honest about failure. A re-insert is a
// second write that can be refused — by RLS, by a connection that has gone, by
// a row the server has already cascaded — and an "Undo" button that sometimes
// cannot undo is worse than no button, because the person has already looked
// away. Holding the write means undo is a local cancellation that cannot fail.
//
// The cost is that the write happens a few seconds after the tap, so the
// window has to survive the screen being left. `ToastProvider` in
// src/ui/toast.tsx flushes every pending action when it unmounts and when a
// second one is staged, so nothing is silently dropped: the delete either
// happens or is undone, and there is no third outcome.
//
// Nothing in here imports react-native or holds a timer. The timer belongs to
// the provider; the rules about what is pending, what is due and what may
// still be taken back are arithmetic, and are tested as such.

/**
 * How long the door stays open.
 *
 * Six seconds. Long enough to notice a row vanish, read four words and reach
 * the button one-handed mid-set, which is the posture this app is used in.
 * Material's snackbar default is four and iOS has no house number; four is
 * comfortably short of what somebody looking away from their phone to rack a
 * dumbbell needs.
 */
export const UNDO_WINDOW_MS = 6000;

export interface Undoable<T = unknown> {
  /** Identifies the thing being removed, so a screen can hide it while the
   *  window is open and put it back if the window is closed by an undo. */
  id: string;
  /** When it was staged, in epoch milliseconds. */
  atMs: number;
  /** Whatever the caller needs to actually perform the write. Opaque here. */
  payload: T;
}

/**
 * Stage an action, committing anything already due in the same breath.
 *
 * Returns the new queue AND the actions that must be written now. A second
 * delete arriving before the first one's window has closed does NOT extend the
 * first — the person has moved on, and the honest thing is to let the first go
 * through rather than keep it hanging on a screen that no longer shows it.
 *
 * A repeat of an id already pending REPLACES it and is not committed twice.
 * Two staged deletes of the same row are one delete with a restarted window;
 * writing both would be one delete and one error about a row already gone.
 */
export function stage<T>(queue: Undoable<T>[], next: Undoable<T>, _nowMs?: number): {
  queue: Undoable<T>[]; commit: Undoable<T>[];
} {
  // Everything else goes through, whether or not its own window has run out.
  // Only one action can be offered back at a time — there is one bar at the
  // bottom of the screen and one Undo on it — so a second delete means the
  // first one stands. `_nowMs` is accepted so callers do not have to know
  // that, and so this can start distinguishing the two cases without a change
  // at every call site if a future design ever shows more than one.
  const commit = queue.filter((q) => q.id !== next.id);
  return { queue: [next], commit };
}

/** Has this one's window closed? */
export function isDue<T>(u: Undoable<T>, nowMs: number, windowMs = UNDO_WINDOW_MS): boolean {
  if (!Number.isFinite(u.atMs) || !Number.isFinite(nowMs)) return true;
  return nowMs - u.atMs >= windowMs;
}

/** How much of the window is left, in whole milliseconds. Never negative. */
export function remainingMs<T>(u: Undoable<T>, nowMs: number, windowMs = UNDO_WINDOW_MS): number {
  if (!Number.isFinite(u.atMs) || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, u.atMs + windowMs - nowMs);
}

/** Split a queue into what must be written now and what is still takeable back. */
export function due<T>(queue: Undoable<T>[], nowMs: number, windowMs = UNDO_WINDOW_MS): {
  commit: Undoable<T>[]; queue: Undoable<T>[];
} {
  const commit: Undoable<T>[] = [];
  const kept: Undoable<T>[] = [];
  for (const q of queue) (isDue(q, nowMs, windowMs) ? commit : kept).push(q);
  return { commit, queue: kept };
}

/**
 * Take one back.
 *
 * Returns the action that was undone, or null when there was nothing to undo —
 * an id that was never staged, or one whose window has already closed and
 * whose write has therefore already gone. Null is the important half: a caller
 * that treated "nothing to undo" as "undone" would put a row back on the
 * screen that no longer exists on the server, which is the same lie as the
 * delete that silently failed.
 */
export function undo<T>(queue: Undoable<T>[], id: string, nowMs: number, windowMs = UNDO_WINDOW_MS): {
  undone: Undoable<T> | null; queue: Undoable<T>[];
} {
  const found = queue.find((q) => q.id === id && !isDue(q, nowMs, windowMs)) ?? null;
  if (!found) return { undone: null, queue };
  return { undone: found, queue: queue.filter((q) => q !== found) };
}

/** The ids a screen should be hiding right now: staged and not yet written. */
export function hiddenIds<T>(queue: Undoable<T>[]): string[] {
  return queue.map((q) => q.id);
}
