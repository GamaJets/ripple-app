// Who recorded what happened to a session.
//
// ── the gap ────────────────────────────────────────────────────────────────
//
// `sessions.outcome` is the column payroll is computed from. src/lib/gymSessions.ts
// says it in as many words — `isPayable` returns false on a null outcome, and a
// gym cannot settle a period while any session in it is unmarked. So the four
// words a coach taps on app/(trainer)/sessions.tsx decide whether an hour is
// paid for, and until now the record said WHEN somebody decided and never WHO.
//
// That matters in exactly one situation, and it is the situation the column was
// added for: a coach and a gym disagreeing about a line on a payroll run. An
// outcome can be written by the coach who delivered the hour (`sessions_trainer`),
// by the gym owner correcting it (`sessions_gym_owner_u`, added by
// supabase/parts/33), or by a back-office job running as the service role. Three
// different authors, one column, and a screen that showed "marked 14 March"
// against all three.
//
// ── NO NEW COLUMN IS NEEDED, AND NONE IS ADDED ────────────────────────────
//
// supabase/parts/33-session-outcomes.sql already added `outcome_by uuid
// references auth.users(id) on delete set null`, and the trigger
// `sessions_stamp_outcome` already fills it from `auth.uid()` on the transition
// into an outcome — and NULLS IT AGAIN when the outcome is cleared, so a
// retracted mark leaves no stale author behind. What was missing is entirely on
// this side: no read in the app ever selected the column, no model carried it,
// and no screen said it. `select('id, trainer_id, …')` in both
// src/lib/gymSessions.ts and src/lib/trainerSessions.ts names its columns one by
// one, and `outcome_by` was never one of them.
//
// ── three things this must never say ──────────────────────────────────────
//
//   1. NOTHING HERE MAY IMPLY AN UNMARKED SESSION WAS MARKED. `markedByLine`
//      returns null for a session the SERVER does not hold an outcome for, and
//      `markedOnServer` is read off the row rather than off the screen. The
//      distinction is not pedantry: app/(trainer)/sessions.tsx patches its own
//      copy optimistically the moment a coach taps, and src/ui/floorQueue.ts may
//      hold that statement on the phone for hours before it reaches the server.
//      A row showing "No-show" off a queued write must not also carry a sentence
//      about who is on record as having said so, because nobody is yet.
//
//   2. A FAILED READ IS NOT AN UNSIGNED SESSION. An empty map is what a refused
//      read produces, and "Nobody is recorded as having marked this" over the
//      whole list is a specific, false and alarming claim about a gym's records.
//      The status is carried beside the map for the reason src/ui/loadStatus.ts
//      gives at length, and 'error' gets its own sentence.
//
//   3. AN UNREADABLE NAME IS NOT AN ABSENT AUTHOR. A coach may read their own
//      profile, their clients' and their fellow trainers' in the same gym
//      (`profiles_trainer_r_peers`, `profiles_trainer_r_clients`) — and NOT the
//      OWNER's, whose policy arm requires `role = 'trainer'`. So the commonest
//      author a coach cannot name is the very person most likely to have
//      corrected the line they are disputing. That case says an id was recorded
//      and this app cannot resolve it, which is true, rather than falling
//      through to the sentence that means nobody signed it.
import type { LoadStatus } from '../ui/loadStatus';
import { readCappedByIds } from './cappedByIds';
import { capLimit } from './rowCap';
import { chunkIds, uniqueIds } from './idLookup';

type Queryable = { from: (table: string) => any };

/** What the server holds about one session's outcome, as opposed to what the
 *  screen is currently drawing for it. */
export interface OutcomeAuthor {
  /** True when the SERVER's own row carries an outcome. False for a session
   *  marked on this phone and not yet sent — see rule 1 in the header. */
  markedOnServer: boolean;
  /** `sessions.outcome_by`. Null on a marked session means nobody is recorded:
   *  a row written before part 33's trigger existed, or one written by the
   *  service role, which has no `auth.uid()` to stamp. */
  by: string | null;
}

/** What came back, and whether it is the whole of it. Never a bare Map: a Map
 *  built from a refused read is an empty Map, and an empty Map would say
 *  "nobody marked this" about every session in it. */
export interface OutcomeAuthors {
  status: LoadStatus;
  /** Session id → what the server holds. A session absent from this map was not
   *  in the answer, which is not the same as a session with no author. */
  bySession: Map<string, OutcomeAuthor>;
  /** Author id → the name this coach is allowed to read for them. An id absent
   *  from this map is an author whose profile RLS refused, not a missing one. */
  names: Map<string, string>;
}

/**
 * Who is on record as having marked each of these sessions.
 *
 * Its own read, deliberately not folded into the one that fetches the sessions:
 * `src/lib/trainerSessions.ts` and `src/lib/gymSessions.ts` are shared by five
 * screens between them and widening their `select` would change what every one
 * of them carries. This is a label under a row on one screen, and it fails the
 * way a label should — 'error' and an empty map, so the queue the coach came
 * for still draws.
 *
 * Chunked, for the reason `fetchSessionLogCounts` in src/lib/sessionFinish.ts
 * spells out: the id list is the history a coach has loaded, a uuid costs about
 * 39 bytes inside a PostgREST `in.("…","…")` list, and past roughly two hundred
 * ids the request line is refused by the proxy with a **414** before the
 * database sees it. supabase-js does not reject on that; it arrives as
 * `data: null`, which is the same shape as "none of these has an author".
 *
 * The names are a second read and a failure in it is NOT a failure of the
 * first. An author whose profile could not be read is still an author, and rule
 * 3 in the header is what keeps those two apart on screen.
 */
export async function fetchOutcomeAuthors(
  sb: Queryable,
  sessionIds: readonly string[],
  cap = 400,
): Promise<OutcomeAuthors> {
  const empty = (status: LoadStatus): OutcomeAuthors =>
    ({ status, bySession: new Map(), names: new Map() });
  const { rows, truncated, error } = await readCappedByIds<{
    id?: string | null; outcome?: string | null; outcome_by?: string | null;
  }>(
    sessionIds,
    (chunk) => sb
      .from('sessions')
      .select('id, outcome, outcome_by')
      .in('id', chunk)
      // `id` is the primary key, so one row comes back per id and the cap can
      // only bite when the caller hands over more ids than it. Ordered anyway,
      // so that WHICH rows a capped chunk keeps is the same on every run — an
      // unordered cut is a label that appears and disappears between refreshes.
      .order('id', { ascending: false })
      .limit(capLimit(cap)),
    { cap },
  );
  if (error) return empty('error');

  const bySession = new Map<string, OutcomeAuthor>();
  const authorIds: string[] = [];
  for (const r of rows) {
    const id = r.id;
    if (!id) continue;
    // An outcome the server does not hold is not an outcome. `!= null` and a
    // non-empty string, because an unrecognised value is still somebody having
    // stated something — src/lib/sessionHistory.ts decides what it MEANS.
    const marked = r.outcome != null && r.outcome !== '';
    const by = marked ? (r.outcome_by ?? null) : null;
    bySession.set(id, { markedOnServer: marked, by });
    if (by) authorIds.push(by);
  }

  const names = new Map<string, string>();
  for (const chunk of chunkIds(uniqueIds(authorIds))) {
    const { data, error: nameErr } = await sb
      .from('profiles').select('id, full_name').in('id', chunk);
    // A name that cannot be read is handled on screen as an author without a
    // name, which is what it is. Abandoning the whole answer over it would take
    // away the part that did come back — including "you marked it", which needs
    // no name at all.
    if (nameErr) break;
    for (const p of (data ?? []) as Array<{ id?: string | null; full_name?: string | null }>) {
      const nm = p.full_name?.trim();
      if (p.id && nm) names.set(String(p.id), nm);
    }
  }

  return { status: truncated ? 'partial' : 'ready', bySession, names };
}

/**
 * The sentence under a past session saying who recorded its outcome, or null
 * when there is nothing honest to say.
 *
 * Null — rather than a placeholder — in three cases, and each is a claim this
 * line is not entitled to make:
 *
 *   · the read has not come back ('loading'). Silence, not a guess.
 *   · the session is not in the answer at all. Under 'partial' that is the cap;
 *     under 'ready' it is a row the server did not return. Either way nothing
 *     is known about it, and "nobody marked this" is not what nothing means.
 *   · the server holds no outcome. The screen may be showing one off a queued
 *     write, and an author for a statement that has not reached the server yet
 *     would be this screen inventing a signature.
 *
 * Sentence case throughout: these are notes under a row, not labels.
 */
export function markedByLine(
  entry: OutcomeAuthor | undefined,
  status: LoadStatus,
  viewerId: string | null,
  names: Map<string, string>,
): string | null {
  if (status === 'loading') return null;
  if (status === 'error') {
    return 'Who recorded this outcome couldn’t be read, so it isn’t shown. The outcome itself still stands.';
  }
  if (!entry || !entry.markedOnServer) return null;
  if (entry.by == null) {
    return 'Nobody is recorded as having marked this — it was recorded before this app started keeping that.';
  }
  if (viewerId && entry.by === viewerId) return 'You marked this.';
  const name = names.get(entry.by);
  if (name) return `Marked by ${name}.`;
  return 'Marked by somebody else — their name isn’t one this app can read for you.';
}
