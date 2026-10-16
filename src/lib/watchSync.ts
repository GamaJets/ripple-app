/**
 * The message contract between the phone and the Apple Watch companion.
 *
 * Pure and versioned, so the Swift side (watch/RepleWatch/WatchSession.swift)
 * and the phone side agree on one shape. The phone is the only writer of the
 * log: the watch sends `set-done` intents, the phone logs through the same
 * path as a tap on the phone (offline queue included), then answers with the
 * next `state`. A watch that is out of range just shows the last state it got.
 */
export const WATCH_PROTOCOL = 1;

export interface WatchState {
  v: typeof WATCH_PROTOCOL;
  kind: 'state';
  /** Null when no session is running: the watch shows "Start on your phone". */
  session: null | {
    exercise: string;
    exerciseIndex: number;   // 0-based
    exerciseCount: number;
    setIndex: number;        // 0-based, the set being done next
    setCount: number;
    targetReps: string;      // as written by the coach: "8", "8-10", "30s"
    targetLoad: string | null; // already formatted in the member's unit, or null
    restEndsAt: number | null; // epoch ms, so the watch can count down alone
  };
}

export interface WatchSetDone {
  v: typeof WATCH_PROTOCOL;
  kind: 'set-done';
  /** Idempotency key generated on the watch; a resend must not log twice. */
  id: string;
  exerciseIndex: number;
  setIndex: number;
  reps: number | null;     // null = "as prescribed"
}

export type WatchMessage = WatchState | WatchSetDone;

export function parseWatchMessage(raw: unknown): WatchMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (m.v !== WATCH_PROTOCOL) return null;
  if (m.kind === 'set-done') {
    if (typeof m.id !== 'string' || !m.id) return null;
    if (!Number.isInteger(m.exerciseIndex) || !Number.isInteger(m.setIndex)) return null;
    if (m.reps != null && !(Number.isInteger(m.reps) && (m.reps as number) >= 0)) return null;
    return { v: 1, kind: 'set-done', id: m.id, exerciseIndex: m.exerciseIndex as number, setIndex: m.setIndex as number, reps: (m.reps as number | null) ?? null };
  }
  if (m.kind === 'state') return m as unknown as WatchState;
  return null;
}

/**
 * Whether a set-done from the watch still applies to what the phone is
 * showing. A stale tap (the member already moved on, on the phone) is dropped
 * rather than logged against the wrong set.
 */
export function setDoneApplies(done: WatchSetDone, state: WatchState, seen: ReadonlySet<string>): boolean {
  if (seen.has(done.id)) return false;
  const s = state.session;
  return !!s && s.exerciseIndex === done.exerciseIndex && s.setIndex === done.setIndex;
}
