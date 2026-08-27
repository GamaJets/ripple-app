// A coach recording the session they just ran, into their client's own log.
//
// Writes to `workouts` with `logged_by` set to the coach. The insert policy
// added in 53-coach-logged-workouts.sql requires two things at once:
//
//     is_my_client(user_id) and logged_by = auth.uid()
//
// so a coach can only write for somebody on their roster, and only in their own
// name. Neither is checked here as well — the database is the place that cannot
// be bypassed by a different client build.
//
// The result is a discriminated thing rather than a boolean, because "the row
// is on the server" and "we could not write it" have different consequences for
// the coach: one means the client sees the session on their phone tonight, the
// other means it exists nowhere and they should try again. A screen that cannot
// tell those apart will say "logged" either way, which is the failure this
// codebase keeps finding.
import { supabase } from './supabase';
import { USE_SUPABASE } from './config';
import { entryToRow } from './workoutRow';
import type { WorkoutEntry } from './mockData';

export { attributionLine } from './workoutAttribution';

export type CoachLogResult =
  | { ok: true; written: number }
  | { ok: false; reason: string };

/**
 * Log one or more exercises for a client, attributed to the coach.
 *
 * `entries` are the same shape the client's own log uses, so everything
 * downstream — progress, PRs, streaks, calories, the weekly report — counts
 * them without knowing who typed them.
 */
export async function logForClient(
  clientId: string,
  coachId: string,
  entries: WorkoutEntry[],
): Promise<CoachLogResult> {
  if (!entries.length) return { ok: false, reason: 'Nothing to log.' };
  if (!USE_SUPABASE) {
    return { ok: false, reason: 'Not signed in to Repple, so this cannot reach your client.' };
  }
  if (!clientId || !coachId) {
    return { ok: false, reason: 'Missing the client or the coach, so this was not written.' };
  }
  try {
    const rows = entries.map((e) => ({ ...entryToRow(clientId, e), logged_by: coachId }));
    const { data, error } = await supabase.from('workouts').insert(rows).select('id');
    // supabase-js resolves on a database error rather than rejecting, so this
    // has to be read. A refused policy and a successful write are the same
    // shape of promise.
    if (error) {
      // 42501 is the policy refusal. It has one cause worth naming, because the
      // coach can act on it: the person is not on their roster.
      const notMine = error.code === '42501';
      return {
        ok: false,
        reason: notMine
          ? 'They are not on your roster, so this was not written. Add them as a client first.'
          : `${error.message} Nothing was saved.`,
      };
    }
    if (!data || data.length !== rows.length) {
      return { ok: false, reason: 'The log came back short, so some of it may not have saved. Check the client’s history before logging it again.' };
    }
    return { ok: true, written: data.length };
  } catch (e: any) {
    return { ok: false, reason: `${e?.message ?? 'The session could not be saved.'} Nothing was saved.` };
  }
}
