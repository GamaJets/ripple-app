// Who is actually queued for a session, in the order the server will hand it
// over in.
//
// ── what was already there, and what was missing ──────────────────────────
//
// supabase/parts/126 built the whole queue: `session_waitlist` gained a `seq`,
// `join_session_waitlist` and `leave_session_waitlist` became the only way in
// and out, `my_waitlist()` tells a member their own position, and
// `_promote_session_waitlist` hands a freed slot to the head of the queue inside
// the same transaction that frees it. supabase/parts/142 gave the coach
// `session_waitlist_trainer_r` — select on every queue row for a session they
// own. Every column, not just the count.
//
// The app used one of them. `useSessionWaitlistCounts` in src/ui/sessions.tsx
// selects `session_id` alone and tallies it, so the coach's diary says "2
// waiting" and the coach cannot find out who. The two people it will not name
// are the two people whose evening changes when the coach cancels that hour, and
// the coach is the one who has to ring them if the push fails — which is the
// case app/(trainer)/calendar.tsx already writes a sentence for.
//
// NO SQL. The policy, the table, the order column and the grant all exist.
//
// ── the order is the server's, and it is not "joined_at" alone ────────────
//
// `_promote_session_waitlist` reads `order by w.joined_at, w.seq`. `joined_at`
// is `timestamptz default now()` and `now()` is the TRANSACTION start, so two
// members joining inside the same statement batch can tie on it exactly; `seq`
// is the bigserial that breaks the tie, and the index
// `session_waitlist_order_idx (session_id, joined_at, seq)` exists for this
// pair. Ordering here by `joined_at` alone would name a first-in-line the server
// would then pass over — a worse answer than no name, because it is a specific
// person told they are next.
//
// ── the one thing this list cannot promise ────────────────────────────────
//
// Promotion joins `clients c on c.id = w.client_id and c.trainer_id =
// v_sess.trainer_id`, so a queue row whose client has since left the coach's
// book is skipped at promotion time while still being readable here. The coach
// is not misled by that on screen, because the name for such a row comes back
// from `slotWhoName` as "a client who is no longer on your book" — which is the
// same fact, said in the place the coach is looking.
import type { LoadStatus } from '../ui/loadStatus';
import { readCappedByIds } from './cappedByIds';
import { capLimit } from './rowCap';

type Queryable = { from: (table: string) => any };

/** One person's place in one queue. */
export interface WaitlistEntry {
  sessionId: string;
  clientId: string;
  /** `session_waitlist.joined_at`. Carried but never formatted here — every
   *  date in this repo is worded by the caller through `appLocale()`. */
  joinedAt: string | null;
}

/** The queues, and whether they are the whole of them. Never a bare Map: a Map
 *  from a refused read is empty, and an empty queue is a specific claim — it is
 *  the claim that cancelling this hour throws it open rather than handing it to
 *  somebody who is already waiting for it. */
export interface SessionWaitlists {
  status: LoadStatus;
  /** Session id → the queue, head first. */
  bySession: Map<string, WaitlistEntry[]>;
}

/**
 * The queues for these sessions, in promotion order.
 *
 * Deliberately a FOLLOW-UP read rather than a second sweep. `useSessionWaitlistCounts`
 * already asks, for every booked hour the calendar is drawing, whether anybody
 * is behind it; the only sessions worth naming people for are the handful that
 * came back with somebody in them, which on most coaches' diaries is none at
 * all. Passing the whole diary in here would double the table's read cost to
 * answer a question the sweep has already answered for all but a few rows.
 *
 * Chunked, for the reason spelled out in src/lib/sessionFinish.ts: a uuid is
 * about 39 bytes inside a PostgREST `in.("…","…")` list, and a long enough id
 * list is refused by the proxy with a 414 that supabase-js reports as
 * `data: null` — indistinguishable from an empty queue, which is the one answer
 * this must never fabricate.
 */
export async function fetchSessionWaitlists(
  sb: Queryable,
  sessionIds: readonly string[],
  cap = 400,
): Promise<SessionWaitlists> {
  const { rows, truncated, error } = await readCappedByIds<{
    session_id?: string | null; client_id?: string | null; joined_at?: string | null;
  }>(
    sessionIds,
    (chunk) => sb
      .from('session_waitlist')
      .select('session_id, client_id, joined_at, seq')
      .in('session_id', chunk)
      // The server's own promotion order, both columns of it. See the header:
      // `joined_at` ties, and `seq` is what `_promote_session_waitlist` breaks
      // the tie with.
      .order('joined_at', { ascending: true })
      .order('seq', { ascending: true })
      .limit(capLimit(cap)),
    { cap },
  );
  if (error) return { status: 'error', bySession: new Map() };

  const bySession = new Map<string, WaitlistEntry[]>();
  for (const r of rows) {
    const sessionId = r.session_id ? String(r.session_id) : null;
    const clientId = r.client_id ? String(r.client_id) : null;
    if (!sessionId || !clientId) continue;
    const queue = bySession.get(sessionId);
    const entry: WaitlistEntry = { sessionId, clientId, joinedAt: r.joined_at ?? null };
    if (queue) queue.push(entry);
    else bySession.set(sessionId, [entry]);
  }
  return { status: truncated ? 'partial' : 'ready', bySession };
}

/**
 * How many of them are named before the rest become a number.
 *
 * Three, because the sentence sits under a row in a day sheet and the decision
 * it supports is "do I cancel this hour" — for which the head of the queue and
 * the shape of what is behind them is the whole of what a coach needs.
 */
export const WAITLIST_NAMED_MAX = 3;

/**
 * Who is waiting, in words — or null when there is nothing this read is
 * entitled to say.
 *
 * `names` are already resolved by the caller, through `slotWhoName`, so that a
 * member the roster cannot name is described the same way here as everywhere
 * else on the screen rather than dropped.
 *
 * 'partial' names NOBODY, and that is the whole of this function's care. The
 * read is one `in.(…)` across many sessions with a single row cap over the lot,
 * so a truncated answer can lose an entire queue or the HEAD of one — and the
 * head is the only name that carries a promise. "First in line: Priya" to a
 * coach whose actual first in line fell off the end of the read is worse than
 * the count they already had, because they will act on it.
 */
export function waitlistWhoLine(
  names: readonly string[],
  status: LoadStatus,
  max: number = WAITLIST_NAMED_MAX,
): string | null {
  if (status === 'loading') return null;
  if (status === 'error') return 'Who is waiting couldn’t be read, so they aren’t named here.';
  if (status === 'partial') {
    return 'Only part of this waitlist loaded, so who is first in line isn’t known.';
  }
  if (!names.length) return null;
  const shown = names.slice(0, Math.max(1, max));
  const rest = names.length - shown.length;
  const listed = shown.join(', then ');
  if (rest <= 0) return `First in line: ${listed}.`;
  return `First in line: ${listed}, and ${rest} more.`;
}
