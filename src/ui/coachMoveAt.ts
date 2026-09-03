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
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { MOVE_AT_NOT_MOVED, type MoveAtRefusal, type MoveAtReport } from '../lib/moveTimes';

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
export async function moveSessionToTime(fromId: string, startsAtISO: string): Promise<MoveAtReport> {
  if (!USE_SUPABASE) return MOVE_AT_NOT_MOVED;
  try {
    const { data, error } = await supabase.rpc('reschedule_client_session_at', {
      p_from: fromId, p_starts_at: startsAtISO,
    });
    if (error || !data) {
      reportError('sessions.moveAt', error ?? new Error('reschedule_client_session_at returned nothing'));
      return MOVE_AT_NOT_MOVED;
    }
    const r = data as Record<string, unknown>;
    return {
      moved: r.moved === true,
      reason: (typeof r.reason === 'string' ? r.reason : null) as MoveAtRefusal | null,
      clientId: typeof r.client === 'string' ? r.client : null,
      sessionId: typeof r.session === 'string' ? r.session : null,
      promoted: typeof r.promoted === 'string' && r.promoted.length > 0,
      waiting: Number(r.waiting) || 0,
      className: typeof r.class === 'string' ? r.class : null,
    };
  } catch (e) {
    reportError('sessions.moveAt', e);
    return MOVE_AT_NOT_MOVED;
  }
}
