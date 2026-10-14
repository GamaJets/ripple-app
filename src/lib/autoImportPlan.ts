// What an unprompted import is allowed to write.
//
// Split out of src/ui/autoImportWorkouts.tsx so the one decision that can do
// real damage is a pure function with a test around it, rather than a guard
// inside an effect that nothing can run.
//
// The damage: this import is not a gesture. Nobody is looking at a list and
// pressing a button, so nothing catches it being wrong. If it writes a sample
// that is already in the log, the member gets a duplicate session they did not
// ask for, in a log their coach reads, their streak counts and their weekly
// report totals.
//
// The way that happens is a FAILED read of the training log. A failed read is
// an empty log, every sample then looks new, and a fortnight is imported a
// second time. `isLogged` is only ever as good as the log it is handed, and
// `status` is the only thing that says whether the log is one.
import type { LoadStatus } from '../ui/loadStatus';
import { isWhole } from '../ui/loadStatus';

/** The shape this needs from a workout sample, so the plan can be tested
 *  without the wearables types or a device. */
export interface PlannableSample { id: string; start: string; activity: string }
/** The shape this needs from a log entry. */
export interface PlannedAgainst { t: string; exercise: string }

/**
 * The samples to write, or an empty list when it is not safe to write any.
 *
 * `status` is the TRAINING LOG's, not the devices'. Anything but a whole read
 * returns nothing at all: not an error, not a retry, simply no import on this
 * pass. The next foreground tries again with a log that may have landed.
 */
export function autoImportPlan<T extends PlannableSample>(
  samples: readonly T[],
  status: LoadStatus,
  importedIds: ReadonlySet<string>,
  log: readonly PlannedAgainst[],
): T[] {
  if (!isWhole(status)) return [];
  return samples.filter((sm) =>
    !importedIds.has(sm.id)
    && !log.some((l) => l.t === sm.start && l.exercise === sm.activity));
}

/**
 * Whether a write's outcome may be remembered as imported.
 *
 * Only 'stored'. The mark is permanent and is the only record that a sample
 * was ever brought across, so marking an unsent write would strike it off for
 * good if the queue never drained. An unmarked sample is offered again, and
 * `autoImportPlan` matches the queued entry already in the log, so waiting
 * costs nothing and losing it costs the session.
 */
export const mayMarkImported = (outcome: string): boolean => outcome === 'stored';
