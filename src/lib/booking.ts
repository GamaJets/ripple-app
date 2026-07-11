// ── Booking & cancellation rules ─────────────────────────────────────────────
// The 24-hour cancellation-fee logic and slot re-offer, as pure functions.
import type { TrainingSession, CancellationResult } from './types';

export const CANCEL_WINDOW_HOURS = 24;

export function hoursUntil(startsAt: string, now: number = Date.now()): number {
  return (Date.parse(startsAt) - now) / 3_600_000;
}

/** True when cancelling now incurs the late fee (inside the window, still future). */
export function isLateCancellation(startsAt: string, now: number = Date.now()): boolean {
  const h = hoursUntil(startsAt, now);
  return h > 0 && h < CANCEL_WINDOW_HOURS;
}

/**
 * Compute the effect of a client cancelling `session`.
 * Returns whether to charge, the fee, and who to notify.
 * `trainerClientIds` is every client of the trainer (the canceller is excluded
 * from the re-offer list automatically).
 */
export function cancelSession(
  session: TrainingSession,
  sessionFee: number,
  trainerClientIds: string[],
  now: number = Date.now()
): CancellationResult {
  const late = isLateCancellation(session.startsAt, now);
  const others = trainerClientIds.filter((id) => id !== session.clientId);
  return {
    charged: late,
    feeAmount: late ? sessionFee : 0,
    notifyClientIds: others,
    notifyTrainer: true,
  };
}

/** First waitlisted client (FIFO) to auto-assign an opened slot, or null. */
export function nextFromWaitlist(waitlist: string[]): string | null {
  return waitlist.length ? waitlist[0] : null;
}

/** Whether a proposed slot overlaps any existing session for the trainer. */
export function overlaps(
  startsAt: string,
  durationMin: number,
  existing: TrainingSession[]
): boolean {
  const s = Date.parse(startsAt);
  const e = s + durationMin * 60_000;
  return existing.some((x) => {
    const xs = Date.parse(x.startsAt);
    const xe = xs + x.durationMin * 60_000;
    return s < xe && xs < e;
  });
}
