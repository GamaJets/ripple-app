// Whether "Start Workout" may be offered, and what to say when it may not.
//
// ── The crash this exists to stop ─────────────────────────────────────────
//
// The Train screen kept two different lists of today's exercises and let a
// button on one of them open a runner built from the other. The gate asked the
// RAW day — `workout.exercises`, straight off the programme — while the runner
// was handed that list minus the rows the member had removed and minus the
// rows held back for a severe injury. Nothing kept the two in step, so a day
// whose every movement had fallen out of the second list still showed a live
// Start Workout.
//
// Tapping it mounted the runner with `exercises: []`. Its mount effect reads
// `exercises[idx]` and asks `nameOf` for `e.key`, so it threw a TypeError, and
// an effect throws AFTER the render that returns null has already committed —
// which is why the runner's own `if (exercises.length === 0) return null` could
// not save it. The throw came out of the component tree and took the whole tab
// bar with it: every screen in the app replaced by the error boundary, mid
// session, with whatever was logged in that runner gone.
//
// Two ways in, and neither is exotic. Remove every exercise on the day one by
// one with the per-row Remove — the "Put back N removed" control appears, which
// is the app confirming they are gone, and Start stays lit next to it. Or
// disclose a severe injury that every movement on today's plan works around
// with no safe alternative in the plan: the rows are held back on their own,
// nothing is tapped, and the same empty list is behind the same live button.
//
// ── Why it also writes the sentence ───────────────────────────────────────
//
// Because a button that quietly is not there is its own bug. The injury case in
// particular is a decision the app made on somebody's behalf about what is safe
// for them to do today, and an app that silently withholds a workout has told
// them nothing — they are left looking at a plan they cannot start with no idea
// why. Same shape as src/lib/injuryGate.ts on the coach's side: the control is
// withheld, and the withholding comes with a reason and a way forward.

/** Why Start is not on screen. 'none' means it is. */
export type StartBlock = 'none' | 'not-strength' | 'rest-day' | 'injury' | 'removed' | 'empty';

export interface StartGate {
  /** True only when the runner would receive at least one exercise. */
  canStart: boolean;
  reason: StartBlock;
  /**
   * What to tell the member, sentence case, or null when there is nothing to
   * explain — a rest day says so in the hero already, and a member reading the
   * Cardio tab is not missing a strength button.
   */
  note: string | null;
  /**
   * True when the block is a safety decision rather than a plain absence, so
   * the screen can give it a heading instead of a footnote. Only the injury
   * case is one.
   */
  safety: boolean;
}

const OPEN: StartGate = { canStart: true, reason: 'none', note: null, safety: false };

/**
 * @param isStrength whether the strength log is the one on screen. The runner
 *   is a barbell runner; the cardio and recovery tabs have their own.
 * @param planned how many exercises the programme wrote for today, before
 *   anything was taken out of it.
 * @param runnable how many the runner would actually be handed — THE list, the
 *   same expression that is passed to it, which is the whole point of this
 *   function taking two counts instead of one.
 * @param removed how many of today's rows the member took off themselves.
 * @param injuryHidden how many are held back for a severe injury with no safe
 *   alternative, counting only the ones they have not chosen to show anyway.
 */
export function startGate(input: {
  isStrength: boolean;
  planned: number;
  runnable: number;
  removed: number;
  injuryHidden: number;
}): StartGate {
  const { isStrength, planned, runnable, removed, injuryHidden } = input;
  // The chip decides this one, and it is not an absence of anything: a member
  // on Cardio has not lost a workout, they are looking at a different log.
  if (!isStrength) return { canStart: false, reason: 'not-strength', note: null, safety: false };
  // Nothing was ever scheduled. The hero already reads "Rest day — nothing
  // scheduled" and the list below it says the same thing again in full, so a
  // third sentence here would only be the app repeating itself.
  if (planned === 0) return { canStart: false, reason: 'rest-day', note: null, safety: false };
  if (runnable > 0) return OPEN;

  // Everything that was scheduled has gone somewhere, and which somewhere is
  // the only thing the member cannot work out for themselves.
  if (injuryHidden > 0) {
    return {
      canStart: false,
      reason: 'injury',
      safety: true,
      note: removed > 0
        ? 'There is nothing left to start today. Some of these movements are held back to protect an area you have flagged as a severe injury, because your plan has no safe alternative for them, and the rest you took off yourself. Put those back below, or show a held-back one anyway if you and your coach have agreed to it.'
        : 'There is nothing to start today. Every movement on your plan works an area you have flagged as a severe injury, and none of them has a safe alternative in your plan, so they are all held back. Show one anyway below if you and your coach have agreed to it, or ask your coach for a session that works around it.',
    };
  }
  if (removed > 0) {
    return {
      canStart: false,
      reason: 'removed',
      safety: false,
      note: 'You have taken every exercise off today, so there is nothing to start. Put them back below if you want the session again.',
    };
  }
  // Neither cause, and still nothing to run. Not reachable from the two paths
  // above, and said plainly rather than left as a missing button, because a
  // sentence that turns out to be wrong is still better than a screen that
  // silently drops a control and explains nothing.
  return {
    canStart: false,
    reason: 'empty',
    safety: false,
    note: 'There is nothing left on today’s plan to start.',
  };
}
