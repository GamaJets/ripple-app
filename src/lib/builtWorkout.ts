// What a member may do to a workout this app built for them: check a movement
// against their disclosed injuries, and swap one movement for another out of
// the same target's pool.
//
// Both live here rather than in app/(client)/build-workout.tsx because both are
// decisions with a wrong answer, and the wrong answer to the first one is the
// expensive kind.
//
// ── An empty injury list is not a clean sheet ─────────────────────────────
//
// `injuryFlag(name, group, injs)` in src/lib/injuries.ts takes `injs = []` and
// returns null for an empty list. Null renders as nothing, and nothing reads as
// "checked, and clear". So a member whose disclosure FAILED TO LOAD is drawn
// exactly like a member who has disclosed nothing — and the failed read is the
// case with the least basis for silence, because it is the gym with no signal.
//
// The same shape in its allergen form put a meal in front of somebody over an
// exclusion list nobody had read, and that picker was deleted for it.
//
// So nothing here takes a bare list. `checkInjury` takes the LoadStatus the
// list arrived under and has four outcomes, not two: the read has not finished,
// the read failed, the read succeeded and something loads an injured area, the
// read succeeded and nothing did. A caller cannot get at the fourth without
// having passed a status that earns it.
//
// ── What a flag claims, and what it does not ─────────────────────────────
//
// 'flagged' says a movement loads an area the member has told us is injured.
// That is a fact about the movement's muscle group and their own disclosure.
// 'unflagged' is the absence of that fact and NOTHING else: not safe, not
// approved, not cleared, not fine. This file never produces a sentence that
// endorses a movement, and `injuryFlag`'s own wording ("May stress your knee")
// is passed through unsoftened.
import { injuryFlag, type Injury, type InjurySeverity } from './injuries';
import { isWhole, type LoadStatus } from '../ui/loadStatus';

export type InjuryCheck =
  /** The disclosure is still being read. Nothing has been checked yet. */
  | { state: 'reading' }
  /** The disclosure could not be read. Nothing has been checked, and this is
   *  not the same answer as nothing being found. */
  | { state: 'unread' }
  /** Read, and this movement loads an area the member reported. */
  | { state: 'flagged'; reason: string; severity: InjurySeverity; area: string }
  /** Read, and nothing the member reported is loaded by this movement. Which
   *  is not a claim that the movement is safe for them. */
  | { state: 'unflagged' };

/**
 * Check one movement against the member's disclosed injuries.
 *
 * `status` is how the read that produced `injuries` went, and it is required —
 * 'partial' counts as unread, because half a disclosure is not a basis for
 * drawing the other half as clear.
 */
export function checkInjury(
  exName: string,
  group: string,
  injuries: Injury[] | null | undefined,
  status: LoadStatus,
): InjuryCheck {
  if (status === 'loading') return { state: 'reading' };
  if (!isWhole(status)) return { state: 'unread' };
  const f = injuryFlag(exName, group, injuries || []);
  if (!f) return { state: 'unflagged' };
  return { state: 'flagged', reason: f.reason, severity: f.injury.severity, area: f.injury.area };
}

/**
 * The movement to put in this row's place, or null when there is none.
 *
 * `alternatives` is what `targetedProgram` attached: the SAME target's whole
 * pool, real rows, the ones past the end of the day first. `used` is every
 * movement the day currently holds, including the swaps made before this one;
 * without it, two rows could become the same movement. Null means every
 * movement in the pool is on the day, which is the only time it is true that
 * none is left.
 *
 * `current` is the movement on the row now. The search starts just after it
 * in `alternatives` and wraps, so pressing Replace on one row walks forward
 * through the pool. Without it, the movement a swap just freed is the first
 * free one again, and two presses flip a row between the same two movements.
 *
 * An alternative that does not flag is preferred over one that does, which is
 * the rule app/(client)/workouts.tsx already applies to a coach's plan. It is a
 * preference and not a filter: when every alternative flags, the flagging one
 * is still offered and the row still carries its own flag. Hiding it would
 * leave a member with a control that does nothing and no sentence saying why.
 *
 * Under an unread disclosure there is no preference to apply — the first
 * unused alternative is taken, and the screen says the check could not run.
 */
export function nextAlternative(
  alternatives: readonly string[] | null | undefined,
  used: readonly string[],
  group: string,
  injuries: Injury[] | null | undefined,
  status: LoadStatus,
  current?: string,
): string | null {
  const key = (x: string) => x.trim().toLowerCase();
  const taken = new Set((used || []).map(key));
  const all = alternatives || [];
  const at = current ? all.findIndex((a) => a && key(a) === key(current)) + 1 : 0;
  const free = [...all.slice(at), ...all.slice(0, at)].filter((a) => a && !taken.has(key(a)));
  if (!free.length) return null;
  const clear = free.find((a) => checkInjury(a, group, injuries, status).state === 'unflagged');
  return clear ?? free[0];
}
