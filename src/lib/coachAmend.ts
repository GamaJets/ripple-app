// A coach correcting or withdrawing a set THEY logged, after it was saved.
//
// TestFlight #13: "Can't untick a log if accidentally press." Before Save the
// same tap undoes it (app/(trainer)/log-session.tsx). After Save the database
// has allowed the coach to amend or delete their own row since
// supabase/parts/3200-a-coach-can-take-back-a-set-they-logged.sql, and nothing
// on screen used it. This is the part of that path worth testing; the sheet is
// src/ui/CoachAmendSheet.tsx and the screen is app/(trainer)/client-training.tsx.
//
// Three rules, all of them the database's first:
//
//   Only a row `logged_by` this coach carries a control. A row the member
//   logged is the member's record; the policy would refuse the write anyway,
//   and a button that can only fail implies the coach may change it.
//
//   A correction stamps `amended_at`. The trigger in part 53 stamps it only
//   when the MEMBER edits, so on the coach's write the stamp has to travel in
//   the body, or the member's record changes with no mark on it. It is the
//   handset's clock, not the server's; ponytail: a server-side stamp for coach
//   edits needs the trigger widened, which is a migration.
//
//   A write that was refused, matched nothing, or never answered is not done.
//   PostgREST answers an UPDATE or DELETE that RLS filtered out with zero rows
//   and no error, so the row count is the proof, as it is in src/ui/workoutLog.tsx.
import { readWorkoutEdit, type Edit, type WorkoutDraft } from './entryEdit';
import { patchToRow } from './workoutRow';
import type { WorkoutEntry } from './mockData';

/** Whether this coach may be offered a correction on this row. The row must be
 *  stored (have an id) and be one they logged. `is_my_client` is not asked here:
 *  a coach can only READ a client's rows while that holds (workouts_coach_read),
 *  and if it lapses between the read and the write the database refuses it and
 *  `writeOutcome` says so. */
export function coachMayAmend(e: Pick<WorkoutEntry, 'id' | 'loggedBy'>, coachId: string | null | undefined): boolean {
  return !!coachId && !!e.id && e.loggedBy === coachId;
}

/**
 * The UPDATE body for a coach's correction, or null when it changes nothing.
 *
 * The figures are read by `readWorkoutEdit`, the member's own reader, so a
 * coach and a member cannot disagree about what a valid correction is. Null for
 * an untouched sheet so that opening and saving does not stamp `amended_at` on
 * a record nobody changed: the mark would tell the member something happened.
 */
export function coachAmendment(
  entry: WorkoutEntry, draft: WorkoutDraft, now: Date = new Date(),
): Edit<Record<string, unknown> | null> {
  const read = readWorkoutEdit(entry, draft);
  if (!read.ok) return read;
  const after = patchToRow(read.value);
  const before = patchToRow(Object.fromEntries(Object.keys(read.value).map((k) => [k, entry[k as keyof WorkoutEntry]])));
  const changed = Object.keys(after).some((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
  return { ok: true, value: changed ? { ...after, amended_at: now.toISOString() } : null };
}

/** What came back from a coach's write: the rows it touched, or an error, or
 *  'threw' when no answer arrived at all. */
export type CoachWrite = { rows: number; error?: { message?: string } | null } | 'threw';

/** Null when the write is done. Otherwise the sentence saying it is not, and why. */
export function writeOutcome(kind: 'amend' | 'withdraw', res: CoachWrite): string | null {
  const still = kind === 'amend' ? 'The set still reads as it did.' : 'The set is still on the record.';
  if (res === 'threw') {
    return 'No answer came back, so this may or may not have gone through. Pull down to read the record again before trying twice.';
  }
  if (res.error) {
    const why = res.error.message?.trim();
    return `The server refused it${why ? `: ${why.replace(/\.$/, '')}` : ''}. ${still}`;
  }
  if (res.rows < 1) {
    return `The server changed nothing. A set can only be changed by the coach who logged it, while that person is still their client, and one of those is no longer true here or the set is already gone. ${still}`;
  }
  return null;
}
