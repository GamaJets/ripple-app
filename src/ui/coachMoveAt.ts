// The one call behind "move this session to a time I have not opened".
//
// It lives here rather than beside `rescheduleClientSession` in
// src/ui/sessions.tsx for one reason and it is not tidiness: that provider is
// the SHARED session store, read and written by both apps, and this is a
// coach-only act with a coach-only vocabulary — the same reason
// src/ui/coachReminders.ts and src/ui/coachStatement.ts sit outside the
// providers they read from. Everything it needs is an id, an instant and the
// server's answer.
//
// See src/lib/moveTimes.ts for what a "free" time claims, and
// supabase/parts/1830 for what the server does with it. Nothing is decided
// here: this reads one report and hands it on.
import { USE_SUPABASE } from '../lib/config';
import { MOVE_AT_NOT_MOVED, type MoveAtRefusal, type MoveAtReport } from '../lib/moveTimes';

// ── why the client and the error reporter are REQUIRED and not imported ────
//
// `readMoveAtReport` below is pure — it reads one JSON answer and says what is
// in it — and it is the half of this file that can be wrong in a way a coach
// sees. A top-level `import { supabase }` drags in AsyncStorage, which throws
// "window is not defined" the moment the auth client touches storage, so a
// suite that imports this module would die on the import rather than on a bad
// assertion. `import type` is erased and the require()s only run inside the
// I/O call, which the tests never make. Same argument, same shape, as the
// header of src/lib/progressPhotos.ts.
type Sb = typeof import('../lib/supabase').supabase;

function db(): Sb {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return (require('../lib/supabase') as { supabase: Sb }).supabase;
}

function report(context: string, err: unknown, extra?: Record<string, unknown>): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const m = require('../lib/reportError') as {
      reportError: (c: string, e: unknown, x?: Record<string, unknown>) => void;
    };
    m.reportError(context, err, extra);
  } catch {
    // A reporter that cannot be loaded is not a reason to lose the move.
  }
}

/**
 * What this file can say about the queue for the freed hour, on top of the
 * report the shared type can hold.
 *
 * ── the bug, and the half of it that is fixed here ────────────────────────
 *
 * The line was `waiting: Number(r.waiting) || 0`. Every way of not being told
 * a number — the key absent, `null`, an empty string, a NaN — came out of it
 * as the number 0, and `MoveAtReport.waiting` is a plain `number`, so nothing
 * downstream could tell that 0 apart from a counted, reported zero.
 *
 * A waiting count is the one number that must never settle to zero on its own,
 * for the reason src/ui/classes.tsx:139 states: "nobody is waiting" is exactly
 * the claim that cannot be made from an unknown. And it IS made — `coachMovedLine`
 * (src/lib/reschedule.ts) ends the success alert with
 *
 *     `${from} is open again on your calendar and nobody was waiting for it.`
 *
 * whenever `waiting === 0` and nobody was promoted. A coach who reads that
 * offers the hour to somebody else.
 *
 * ── how live it is ────────────────────────────────────────────────────────
 *
 * Latent today, and only because of where the server puts the key.
 * supabase/parts/1830 builds `'waiting', v_waiting` from a `select count(*)`
 * on the MOVED branch only, so on that branch the number is always present and
 * never null; the refusal branches omit the key entirely, and a refusal is read
 * by `moveAtRefusalLine`, which never looks at it. So the invented zero is real
 * and is not currently on screen. One added early-return on the moved branch,
 * or one RPC that answers with `data` shaped differently, and it is.
 *
 * ── what is fixed and what is not ─────────────────────────────────────────
 *
 * `waitingKnown` is the missing fact, and it is carried out of here beside the
 * report rather than folded into it, because `MoveAtReport.waiting` is typed
 * `number` in src/lib/moveTimes.ts — another lane's file tonight — and a `null`
 * will not fit in it. So this module no longer LOSES the distinction, and an
 * unreported count is reported to app_errors instead of passing silently.
 *
 * The last step is one line in app/(trainer)/calendar.tsx: it must not put a
 * report with `waitingKnown === false` through the arm of `coachMovedLine`
 * that says nobody was waiting. Until then the sentence is unchanged, which is
 * the behaviour that ships today.
 */
export interface MoveAtAnswer extends MoveAtReport {
  /** Whether the server actually reported a queue length. False means nobody
   *  knows — never that the queue was empty. */
  waitingKnown: boolean;
}

/** A count of people, or null when the answer did not contain one.
 *
 *  Deliberately narrow: a number must be finite, a whole number and not
 *  negative to be a queue length, and a string is read only when it is a
 *  string of digits — `Number('')` is 0 and `Number(null)` is 0, and neither
 *  of those is somebody having counted an empty queue. */
function queueLength(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : null;
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

/**
 * The server's JSON answer, read into the report the screens use.
 *
 * Pure and exported so the reading can be asserted on directly: everything
 * that can be wrong about a move the coach is told about is decided here.
 */
export function readMoveAtReport(data: unknown): MoveAtAnswer {
  const r = (data ?? {}) as Record<string, unknown>;
  const waiting = queueLength(r.waiting);
  return {
    moved: r.moved === true,
    reason: (typeof r.reason === 'string' ? r.reason : null) as MoveAtRefusal | null,
    clientId: typeof r.client === 'string' ? r.client : null,
    sessionId: typeof r.session === 'string' ? r.session : null,
    promoted: typeof r.promoted === 'string' && r.promoted.length > 0,
    // The unchanged-behaviour half: the shared type cannot hold "unknown", so
    // the figure stays 0 and `waitingKnown` says whether to believe it.
    waiting: waiting ?? 0,
    waitingKnown: waiting != null,
    className: typeof r.class === 'string' ? r.class : null,
  };
}

/** The refusal sentinel, carrying the same admission: an unreachable move knows
 *  nothing about who is in line, least of all that nobody is. */
export const MOVE_AT_UNREACHABLE: MoveAtAnswer = { ...MOVE_AT_NOT_MOVED, waitingKnown: false };

/**
 * Move a booked session to an instant.
 *
 * `MOVE_AT_NOT_MOVED` carries reason 'unreachable', and that is the honest
 * answer to every path out of here that is not the server's own report — a
 * thrown request, a refused RPC, or `data: null`, which is what a refused
 * PostgREST call resolves to and which would otherwise fall through to a report
 * reading as a plain refusal. A coach must never be told a client's hour did
 * not move when nobody knows whether it did.
 */
export async function moveSessionToTime(fromId: string, startsAtISO: string): Promise<MoveAtAnswer> {
  if (!USE_SUPABASE) return MOVE_AT_UNREACHABLE;
  try {
    const { data, error } = await db().rpc('reschedule_client_session_at', {
      p_from: fromId, p_starts_at: startsAtISO,
    });
    if (error || !data) {
      report('sessions.moveAt', error ?? new Error('reschedule_client_session_at returned nothing'));
      return MOVE_AT_UNREACHABLE;
    }
    const answer = readMoveAtReport(data);
    // A move that happened and no count of who is still in line for the hour it
    // freed. Nothing on screen changes for it — see `MoveAtAnswer` — but it is
    // the condition under which the coach would be told something nobody knows,
    // so it is named here rather than left to be noticed on a support call.
    if (answer.moved && !answer.waitingKnown) {
      report('sessions.moveAt', new Error('reschedule_client_session_at reported a move with no waiting count'),
        { session: fromId });
    }
    return answer;
  } catch (e) {
    report('sessions.moveAt', e);
    return MOVE_AT_UNREACHABLE;
  }
}
