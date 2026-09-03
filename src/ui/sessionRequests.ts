// The reads and writes behind a member asking for an hour their coach never
// opened. What one MEANS is src/lib/sessionRequests.ts, which is pure and
// tested; nothing here decides that.
//
// ── Every write is an RPC, and that is not a style choice ─────────────────
//
// `session_requests` (supabase/parts/740) has two SELECT policies and no INSERT,
// UPDATE or DELETE policy for anybody. Part 09 gives the reason for booking and
// cancelling and it holds here: "books/cancels via RPCs (SECURITY DEFINER, so
// no broad client UPDATE grant is needed)". A member with an UPDATE grant on
// their own request row could mark it accepted; a coach with one could move the
// hour it asks for. Neither is a thing this product should be able to do, so
// neither grant exists and there is nothing here that could use one.
//
// ── supabase-js RESOLVES ON AN ERROR ──────────────────────────────────────
//
// `await supabase.from(...)` gives back `{ data, error }` rather than throwing,
// so a try/catch alone catches only the network dying. Every read below looks
// at `.error`, and on this feature it matters in a specific way: an empty list
// rendered confidently tells a member their coach has answered nothing when in
// fact nothing was read — and the difference between those two is whether they
// turn up.
//
// ── The RPCs answer with a REPORT, not a boolean ──────────────────────────
//
// The same shape `cancel_my_session` uses and for the same reason
// (src/ui/sessions.tsx): a screen that has to re-read a row to find out what
// happened can be told a different story than the one that was written. Every
// refusal below carries the server's own reason string through untouched, and
// `askRefusalNote` / `answerRefusalNote` in the lib are the only place it is
// turned into a sentence.
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { capLimit, capped } from '../lib/rowCap';
import { readByIds } from '../lib/idLookup';
import type { LoadStatus } from './loadStatus';
import { shapeRequests, type RawSessionRequest, type SessionRequest } from '../lib/sessionRequests';

const COLS = 'id, client_id, trainer_id, starts_at, duration_min, note, state, session_id, decline_note, answered_at, created_at';

/** What every one of these calls answers with. `reason` is the server's own
 *  string and is never interpreted here. */
export interface RequestWrite {
  ok: boolean;
  reason: string | null;
  /** The request that was created, for `ask`. */
  id?: string | null;
  /** The session acceptance created, for `answer`. */
  sessionId?: string | null;
  /** The class the server named on a 'clash-class' refusal, where it named one. */
  className?: string | null;
  /**
   * Who was actually asked, for `ask`.
   *
   * It comes back from the server rather than being worked out on the phone,
   * and that is the point: `request_session` resolves `clients.trainer_id`
   * itself, so this is the coach the request WAS addressed to. A screen that
   * guessed — from a session on the calendar, say — could notify somebody who
   * was never asked.
   */
  trainerId?: string | null;
}

/** A jsonb answer, defensively. A build talking to a database that has not
 *  taken part 740 gets `null` back, and null is a refusal with no reason —
 *  which is exactly what the default branch of `askRefusalNote` is for. */
const asWrite = (d: unknown): RequestWrite => {
  const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
  return {
    ok: o.ok === true,
    reason: typeof o.reason === 'string' ? o.reason : null,
    id: typeof o.id === 'string' ? o.id : null,
    sessionId: typeof o.session === 'string' ? o.session : null,
    className: typeof o.class === 'string' ? o.class : null,
    trainerId: typeof o.trainer === 'string' ? o.trainer : null,
  };
};

/**
 * Every request this member has made, whatever became of it.
 *
 * No `.eq('client_id', uid)`. `session_requests_client_r` is `client_id =
 * auth.uid()` and the coach policy is `trainer_id = auth.uid()`, so on a client
 * account the policy already returns exactly this set — and a filter here would
 * be a second copy of a rule that already holds, which is the copy that drifts.
 *
 * Ordered on `created_at` AND `id`: two requests made in the same second tie
 * otherwise, and a tie is not an order a page boundary can be drawn on.
 */
export async function fetchMyRequests(): Promise<{ rows: SessionRequest[]; status: LoadStatus }> {
  if (!USE_SUPABASE) return { rows: [], status: 'ready' };
  try {
    const { data, error } = await supabase
      .from('session_requests')
      .select(COLS)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(capLimit());
    if (error) { reportError('sessionRequests.mine', error); return { rows: [], status: 'error' }; }
    const page = capped((data ?? []) as RawSessionRequest[]);
    return { rows: shapeRequests(page.rows), status: page.truncated ? 'partial' : 'ready' };
  } catch (e) {
    reportError('sessionRequests.mine', e);
    return { rows: [], status: 'error' };
  }
}

/** A request with the name of whoever asked, for the coach's queue. */
export interface CoachRequest extends SessionRequest {
  /** From `profiles`, not from `clients` — that table has no name column. Null
   *  when the name could not be read, which is a real state and never a dash
   *  dropped into a sentence. */
  clientName: string | null;
}

/**
 * What this coach has been asked.
 *
 * The names come from a second query rather than a PostgREST embed, exactly as
 * `fetchPtSlots` does in src/lib/gymPtSchedule.ts and for the same reason:
 * `clients` is keyed on profiles.id and carries no `full_name`, so there is no
 * name to embed. A coach may read their own clients' profiles
 * (`profiles_trainer_r_clients`, supabase/parts/28).
 *
 * A failed NAME read does not fail the queue. The requests are the point of the
 * screen and a coach can answer one without the name — but it is reported, so
 * the caller can say the names are missing rather than drawing rows that look
 * like requests from nobody.
 */
export async function fetchCoachRequests(): Promise<{
  rows: CoachRequest[]; status: LoadStatus; namesRead: boolean;
}> {
  if (!USE_SUPABASE) return { rows: [], status: 'ready', namesRead: true };
  try {
    const { data, error } = await supabase
      .from('session_requests')
      .select(COLS)
      .order('starts_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(capLimit());
    if (error) { reportError('sessionRequests.coach', error); return { rows: [], status: 'error', namesRead: false }; }
    const page = capped((data ?? []) as RawSessionRequest[]);
    const reqs = shapeRequests(page.rows);
    const status: LoadStatus = page.truncated ? 'partial' : 'ready';
    if (!reqs.length) return { rows: [], status, namesRead: true };

    const ids = [...new Set(reqs.map((r) => r.clientId).filter(Boolean))];
    const names = new Map<string, string>();
    let namesRead = true;
    if (ids.length) {
      // CHUNKED, about the REQUEST LINE rather than the row ceiling. `ids` is
      // bounded by the `capLimit()` read above, so a coach with a long
      // unanswered queue sends hundreds of uuids at ~39 bytes each inside
      // `in.("…","…")` — past the 8KB request line nginx and most CDNs enforce
      // by default. The proxy answers 414 at roughly two hundred ids,
      // supabase-js does not reject on it, and it arrives as `data: null` with
      // `nameErr` null. So `namesRead` stayed TRUE while every row came back
      // unnamed: the screen would have stated, positively, that these requests
      // have no names on them.
      try {
        const profs = await readByIds<{ id?: unknown; full_name?: unknown }>(
          ids,
          (chunk, from, to) => supabase.from('profiles').select('id, full_name')
            .in('id', chunk).order('id', { ascending: true }).range(from, to),
          'the names of the clients asking for these sessions',
        );
        for (const p of profs) {
          const n = typeof p.full_name === 'string' ? p.full_name.trim() : '';
          if (typeof p.id === 'string' && n) names.set(p.id, n);
        }
      } catch (nameErr) {
        // `readByIds` throws a refused chunk rather than returning a short set.
        // Reported as names NOT read, which is the distinction this function
        // already carries: a null name under `namesRead: true` is somebody RLS
        // will not name, and under `false` it is somebody we could not ask
        // about. The screen says different things about the two.
        reportError('sessionRequests.names', nameErr); namesRead = false;
      }
    }
    return {
      rows: reqs.map((r) => ({ ...r, clientName: names.get(r.clientId) ?? null })),
      status,
      namesRead,
    };
  } catch (e) {
    reportError('sessionRequests.coach', e);
    return { rows: [], status: 'error', namesRead: false };
  }
}

/**
 * Ask.
 *
 * The coach is NOT passed. `request_session` reads `clients.trainer_id` for the
 * caller, so a member can only ever ask their own coach and there is no id on
 * the wire to substitute. That is a server decision and this function
 * deliberately has no opinion about it.
 */
export async function askForSession(
  startsAt: string, durationMin: number, note: string | null,
): Promise<RequestWrite> {
  if (!USE_SUPABASE) return { ok: false, reason: null };
  try {
    const { data, error } = await supabase.rpc('request_session', {
      p_starts_at: startsAt, p_duration_min: durationMin, p_note: note,
    });
    if (error) { reportError('sessionRequests.ask', error); return { ok: false, reason: null }; }
    return asWrite(data);
  } catch (e) {
    reportError('sessionRequests.ask', e);
    return { ok: false, reason: null };
  }
}

/** Take one back. Only ever possible while it is unanswered — the server is
 *  what enforces that, and answers 'gone' when it is not. */
export async function withdrawRequest(id: string): Promise<RequestWrite> {
  if (!USE_SUPABASE) return { ok: false, reason: null };
  try {
    const { data, error } = await supabase.rpc('withdraw_session_request', { p_request: id });
    if (error) { reportError('sessionRequests.withdraw', error); return { ok: false, reason: null }; }
    return asWrite(data);
  } catch (e) {
    reportError('sessionRequests.withdraw', e);
    return { ok: false, reason: null };
  }
}

/**
 * Answer one — the only call in this app that turns a request into a session.
 *
 * Nothing here checks for a clash before calling. That is deliberate: the check
 * has to happen inside the same transaction as the write or it is a check
 * against a calendar that can change underneath it, and part 740 does it there
 * — behind `select … for update` on the request row, so one question cannot
 * produce two sessions however many handsets answer it. A second check here
 * would be a copy that disagrees, and the disagreement would show up as a
 * refusal the coach was not warned about or a warning about a clash that is not
 * there.
 */
export async function answerRequest(
  id: string, accept: boolean, note: string | null,
): Promise<RequestWrite> {
  if (!USE_SUPABASE) return { ok: false, reason: null };
  try {
    const { data, error } = await supabase.rpc('answer_session_request', {
      p_request: id, p_accept: accept, p_note: note,
    });
    if (error) { reportError('sessionRequests.answer', error); return { ok: false, reason: null }; }
    return asWrite(data);
  } catch (e) {
    reportError('sessionRequests.answer', e);
    return { ok: false, reason: null };
  }
}
