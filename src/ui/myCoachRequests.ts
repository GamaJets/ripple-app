// The reads behind "what happened to the coaches I asked".
//
// What one MEANS is src/lib/coachRequestOutcome.ts, which is pure and tested;
// nothing here decides that.
//
// ── Why this file exists ──────────────────────────────────────────────────
//
// `coach_requests` was read in exactly one place on the client side —
// `.select('trainer_id').eq('status','pending')` in app/(client)/trainers.tsx —
// and used to grey out a button. src/lib/notifyCopy.ts records what that cost,
// under the notification written to work around it: "the app has no other
// surface that will ever tell them: `coach_requests` is not rendered on the
// client side once it leaves 'pending'." A declined request vanished, and the
// push about it routed to this very screen, which listed nothing about it.
//
// ── supabase-js RESOLVES ON AN ERROR ──────────────────────────────────────
//
// `await supabase.from(...)` gives back `{ data, error }` rather than throwing,
// so a try/catch alone catches only the network dying. Both reads below look at
// `.error`, and on this feature the difference is load-bearing: an empty list
// rendered confidently tells somebody they have asked nobody, and the member
// who reads that is the one currently waiting on an answer. They go and ask a
// second coach.
//
// ── The filter that is NOT a redundant copy of the policy ─────────────────
//
// src/ui/sessionRequests.ts deliberately omits `.eq('client_id', uid)` because
// the policy already selects exactly that set. Here it does not.
// `coach_requests` has TWO select policies (supabase/parts/23):
// `coach_requests_client_rw` on `client_id` and `coach_requests_trainer_r` on
// `trainer_id`. A coach who also trains themselves through the client app —
// which this product supports, and which every (trainer) screen is built on top
// of — would otherwise see their own INBOUND queue listed among the coaches
// they have asked, each row attributing their own pending decision to somebody
// else. The filter is the thing that makes this list the member's own.
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { capLimit, capped } from '../lib/rowCap';
import { readByIds } from '../lib/idLookup';
// The auth read, with its `error` classified rather than discarded. See
// src/lib/authReadFate.ts: `getUser()` RESOLVES on a dropped connection with
// `{ data: { user: null }, error }`, so `auth?.user?.id` was `undefined` for an
// outage and `undefined` for a member who never signed in.
import { signedInUid } from '../lib/signedInUid';
import type { LoadStatus } from './loadStatus';
import {
  shapeMyCoachRequests, type MyCoachRequest, type RawMyCoachRequest,
} from '../lib/coachRequestOutcome';

/** Every column the row carries that says anything about what became of it.
 *  `status`, `note`, `responded_at` and `source` were all unread until now. */
const COLS = 'id, trainer_id, mode, status, note, source, created_at, responded_at';

/** One request, with the coach's name where the reader is allowed one. */
export interface MyCoachRequestRow extends MyCoachRequest {
  /**
   * From `profiles`, and null is ordinary rather than exceptional.
   * `profiles_public_directory_r` (supabase/parts/142) shows a client the
   * profile of a LISTED trainer, so a coach who has since left the directory —
   * or who was only ever reached by code — cannot be named here at all. Null is
   * never a dash dropped into a sentence; see `coachRequestLine`.
   */
  coachName: string | null;
}

/**
 * Every coaching request this member has made, whatever became of it.
 *
 * A failed NAME read does not fail the list. What became of the request is the
 * point of the screen and every sentence about it reads without a name — but it
 * is reported, so the caller can say the names are missing rather than drawing
 * a column of answers from nobody.
 *
 * Ordered newest first and capped. `myCoachRequestsNewestFirst` sorts again on
 * the way out, which is not redundant: the cap takes a PREFIX of this order, so
 * the order has to be right here for the right rows to come back at all, and
 * right in the lib for the list to be right once anything is filtered.
 */
export async function fetchMyCoachRequests(): Promise<{
  rows: MyCoachRequestRow[]; status: LoadStatus; namesRead: boolean;
}> {
  if (!USE_SUPABASE) return { rows: [], status: 'ready', namesRead: true };
  try {
    const who = await signedInUid('myCoachRequests.list');
    // Not signed in is not an empty history, and neither is an outage. 'error'
    // rather than 'ready' for BOTH, so nothing downstream prints "you haven't
    // asked anybody" over either one — which is the sentence that sends a
    // member who is waiting on an answer off to ask a second coach.
    //
    // The two fates are not separated any further here because this function's
    // return has no room for a third answer, and the honest sentence for both
    // is the same: we cannot show you what became of your requests. They ARE
    // separated where it costs something — `signedInUid` reports the outage to
    // `reportError` under this read's own key and leaves a sign-out unreported,
    // because being signed out is not a fault.
    //
    // Narrowed on `fate`, never on `!who.uid`: `string` includes '', so
    // `!who.uid` does not discriminate UidRead and `uid` below would not be a
    // string.
    if (who.fate !== null) return { rows: [], status: 'error', namesRead: false };
    const uid = who.uid;

    const { data, error } = await supabase
      .from('coach_requests')
      .select(COLS)
      .eq('client_id', uid)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(capLimit());
    if (error) { reportError('myCoachRequests.list', error); return { rows: [], status: 'error', namesRead: false }; }

    const page = capped((data ?? []) as RawMyCoachRequest[]);
    const reqs = shapeMyCoachRequests(page.rows);
    const status: LoadStatus = page.truncated ? 'partial' : 'ready';
    if (!reqs.length) return { rows: [], status, namesRead: true };

    const ids = [...new Set(reqs.map((r) => r.trainerId).filter(Boolean))];
    const names = new Map<string, string>();
    let namesRead = true;
    if (ids.length) {
      // CHUNKED, and the limit this is about is the REQUEST LINE rather than
      // the row ceiling. `ids` is bounded by the `capLimit()` read above, so a
      // long history sends hundreds of uuids at ~39 bytes each inside
      // `in.("…","…")` — past the 8KB request line nginx and most CDNs enforce
      // by default. The proxy answers 414 at roughly two hundred ids,
      // supabase-js does not reject on it, and it arrives as `data: null` with
      // no error: every row would come back unnamed while this function went on
      // reporting that the names had been read.
      try {
        const profs = await readByIds<{ id?: unknown; full_name?: unknown }>(
          ids,
          // `.order('id')` on a primary-key lookup is total, which is the
          // contract every paged read here requires.
          (chunk, from, to) => supabase.from('profiles').select('id, full_name')
            .in('id', chunk).order('id', { ascending: true }).range(from, to),
          'the names of the coaches you have asked',
        );
        for (const p of profs) {
          const n = typeof p.full_name === 'string' ? p.full_name.trim() : '';
          if (typeof p.id === 'string' && n) names.set(p.id, n);
        }
      } catch (nameErr) {
        // `readByIds` throws a refused chunk rather than returning a short set.
        // Reported as names NOT read, which is a real distinction here: a null
        // name under `namesRead: true` is a coach RLS will not name — they left
        // the directory — and under `false` it is one we could not ask about.
        reportError('myCoachRequests.names', nameErr); namesRead = false;
      }
    }
    return {
      rows: reqs.map((r) => ({ ...r, coachName: names.get(r.trainerId) ?? null })),
      status,
      namesRead,
    };
  } catch (e) {
    reportError('myCoachRequests.list', e);
    return { rows: [], status: 'error', namesRead: false };
  }
}
