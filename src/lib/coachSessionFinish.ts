// A coach's Finish on a booked session, the pure half.
//
// The write is `finish_coach_session` (supabase/parts/3460): the session's rows
// into the client's own record as `logged_by = coach`, the session marked
// completed (part 370 draws the credit), and a notification row the table
// trigger pushes (part 900). One call, atomic, idempotent on `workout_uid`.
//
// This file is what the phone decides around that call, so it can be tested
// without a phone: what an answer MEANS, and how many records to announce.
import type { WriteOutcome } from './offlineQueue';
import type { WorkoutEntry } from './mockData';
import { isNewPR } from './streaks';

/** One row of the function's answer. */
export interface FinishRow {
  outcome: 'finished' | 'already';
  rowsWritten: number;
  /** Credits left on the pack the session drew from; null when it drew from
   *  none (a pass, a one-off, a coach with no packs). */
  sessionsLeft: number | null;
  packTotal: number | null;
}

/**
 * The function's answer, read strictly.
 *
 * PostgREST returns a `returns table` function as an array of rows. Anything
 * else — null, an empty array, a row without a recognised `outcome` — is NOT
 * read as success: the function raises on every refusal, so a body that names
 * no outcome is an answer this build does not understand, and an
 * unrecognised answer is never reported as saved.
 */
export function readFinishRow(data: unknown): FinishRow | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (r.outcome !== 'finished' && r.outcome !== 'already') return null;
  const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const written = n(r.rows_written);
  if (written == null || written < 1) return null;
  return { outcome: r.outcome, rowsWritten: written, sessionsLeft: n(r.sessions_left), packTotal: n(r.pack_total) };
}

/**
 * What the floor queue does with an answer that came back without an error.
 *
 * 'finished' and 'already' are both 'stored': the second is a replay of a
 * Finish whose first answer was lost, and the rows it is about ARE in the
 * client's record. A body this build cannot read is kept ('unsent') rather
 * than dropped or claimed — re-sending is safe because the call is idempotent.
 */
export function finishAnswer(data: unknown): WriteOutcome {
  return readFinishRow(data) ? 'stored' : 'unsent';
}

/**
 * How many of the entries are new personal records for this client, by the
 * app's own definition (`isNewPR`, src/lib/streaks.ts).
 *
 * Null — "do not say" — unless the coach's screen holds the client's WHOLE
 * history. Counting against a partial read would announce a record the
 * client's own Records screen does not show, which is the exact disagreement
 * src/lib/prNotify.ts exists to prevent.
 */
export function finishPrCount(
  entries: readonly WorkoutEntry[],
  history: readonly WorkoutEntry[] | null,
  historyComplete: boolean,
): number | null {
  if (!history || !historyComplete) return null;
  let n = 0;
  const seen: WorkoutEntry[] = [...history];
  for (const e of entries) {
    if (isNewPR(seen, e)) n += 1;
    seen.push(e);
  }
  return n;
}

/** The pack line for the coach's finish sheet. Null when nothing was drawn. */
export function packLeftLine(r: Pick<FinishRow, 'sessionsLeft' | 'packTotal'>): string | null {
  if (r.sessionsLeft == null || r.packTotal == null) return null;
  return `1 PT session used · ${r.sessionsLeft} of ${r.packTotal} left`;
}
