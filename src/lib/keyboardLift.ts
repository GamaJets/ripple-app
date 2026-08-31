// ── How far to raise a docked bar so the keyboard does not cover it ──────────
//
// Pure, and in `lib` rather than `ui`, for one reason: the test runner compiles
// to plain Node, and anything importing `react-native` cannot be run there. The
// arithmetic is the part worth testing, so the arithmetic is the part kept
// free of the platform.
//
// `src/ui/keyboardLift.ts` holds the hook that feeds this real measurements,
// and its header explains why RN's own KeyboardAvoidingView gets this wrong.

export interface LiftInput {
  /** The bar's top edge in WINDOW coordinates, as measureInWindow reports it. */
  barY: number;
  /** The bar's height. */
  barHeight: number;
  /** The lift already applied when the measurement was taken. */
  applied: number;
  /** The keyboard's top edge in window coordinates, from the event. */
  keyboardScreenY: number;
}

/**
 * How far to raise the bar. Pure, so it can be argued with in a test rather
 * than inferred from a screenshot.
 *
 * `applied` is added back because the measurement is taken while a previous
 * lift may already be in effect: without it the calculation is fed its own
 * output and the bar walks up the screen a frame at a time. With it the
 * function is idempotent — feeding the result back in returns the same number,
 * which is the property that makes it safe to call on every keyboard event.
 *
 * A bar already above the keyboard yields zero rather than a negative number:
 * a negative padding would pull it DOWN behind the keyboard, turning "nothing
 * to do" into the very bug this exists to fix.
 */
export function liftFor({ barY, barHeight, applied, keyboardScreenY }: LiftInput): number | null {
  // Not measurements. A view that has not been laid out reports zeros or NaN
  // depending on the platform, and treating either as a position slams the bar
  // to the top of the screen. `null` means "do not act on this", which is not
  // the same answer as zero.
  if (![barY, barHeight, applied, keyboardScreenY].every((n) => typeof n === 'number' && isFinite(n))) return null;
  if (barHeight <= 0) return null;
  const restingBottom = barY + barHeight + applied;
  return Math.max(0, Math.round(restingBottom - keyboardScreenY));
}
