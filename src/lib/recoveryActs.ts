// What counts as recovery, in one place.
//
// "Recovery" was briefly two different things in this app: a screen on Me
// (sleep, hydration, mobility routines, heart rate) and a session type on Train
// (sauna, cold plunge, and the rest). Two names, two meanings, no connection —
// which is worse than either alone, because a member reasonably expects the
// sauna they just logged to appear on the screen called Recovery.
//
// It is one idea now. Train still does the logging, because that is where every
// other session type is logged and a second logging surface would be its own
// confusion. The Recovery screen is the hub: it shows what was logged and sends
// you to Train to add more. This list is what keeps the two honest — one array,
// two consumers, so a modality added here appears on both.
export interface RecoveryActivity { name: string }

/**
 * Deliberately without MET values. None of these is exercise expenditure: a
 * sauna raises heart rate, but the cost is thermoregulation rather than work,
 * so a calorie figure derived from time and body weight would be invented.
 * `cardioKcal` returns null for anything absent from the MET table.
 */
export const RECOVERY_ACTIVITIES: string[] = [
  'Breathwork',
  'Cold Plunge',
  'Contrast Therapy',
  'Massage',
  'Sauna',
  'Steam Room',
];

const LOWER = new Set(RECOVERY_ACTIVITIES.map((n) => n.toLowerCase()));

/** Whether a logged exercise name is one of the recovery modalities. */
export function isRecoveryActivity(name: string | null | undefined): boolean {
  return !!name && LOWER.has(name.trim().toLowerCase());
}
