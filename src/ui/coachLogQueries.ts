// Whether the member has queried what their coach wrote into their log — read,
// raised and withdrawn.
//
// ── why this is its own read and not a column on the log ──────────────────
//
// `useWorkoutLog` hydrates `workouts` with `select('*')` and hands the rows to
// `rowToEntry` (src/lib/workoutRow.ts), which maps a fixed list of fields onto
// `WorkoutEntry`. Adding `queried_at` there would mean the query state travels
// with every entry everywhere — the coach's screens, the exports, the offline
// queue, Apple Health — for the sake of one strip on one screen, and
// `PERSISTED_FIELDS` would then have to argue about whether a member's objection
// is something the queue may re-send. It is not: like `amended_at`, it is the
// server's to stamp and the app's only to read.
//
// So this is a second, narrow read over the same table, scoped to the rows that
// can carry a query at all — the ones somebody else logged.
//
// ── what a failed read is NOT ─────────────────────────────────────────────
//
// It is not "you have queried nothing". That collapse is the defect the whole
// item exists to undo, one layer down: src/lib/upcomingWindow.ts records what
// comes of a member's silence being read as their approval, and an unreadable
// column is silence this app would have manufactured itself. `status` is
// therefore reported honestly and src/lib/coachLogReview.ts decides what may be
// said under each value of it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { capLimit, capped } from '../lib/rowCap';
import { type LoadStatus } from './loadStatus';
import {
  indexQueries, queryPatch, withdrawPatch,
  type KnownCoach, type QueryRow, type WorkoutQuery,
} from '../lib/coachLogReview';


export interface CoachLogQueries {
  /** Query state by workout id. A row that is ABSENT was not read; a row that is
   *  present with `queriedAt: null` was read and carries no query. The two are
   *  different answers and `reviewFor` needs both. */
  byId: ReadonlyMap<string, WorkoutQuery>;
  status: LoadStatus;
  /** Raise a query. Resolves true only when the server changed a row. */
  query: (workoutId: string, note: string | null) => Promise<boolean>;
  /** Take one back. Resolves true only when the server changed a row. */
  withdraw: (workoutId: string) => Promise<boolean>;
  reload: () => void;
}

const EMPTY: ReadonlyMap<string, WorkoutQuery> = new Map();

export function useCoachLogQueries(userId: string | null): CoachLogQueries {
  const [byId, setById] = useState<ReadonlyMap<string, WorkoutQuery>>(EMPTY);
  // 'loading' is the honest start for a read that is about to happen, and the
  // effect below settles it to 'ready' immediately when there is nothing to
  // read — a screen must not spin forever on an account with no backend.
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  // The id the writes below match on, kept in a ref so the two callbacks stay
  // stable across a re-render and do not re-arm every effect that depends on
  // them. `null` is a write that cannot be attempted, not one that silently
  // succeeds.
  const uid = useRef<string | null>(null);
  uid.current = userId;

  useEffect(() => {
    if (!USE_SUPABASE || !userId) {
      // With no backend the local log IS the record (src/ui/loadStatus.ts says
      // so in as many words), and it holds no queries. 'ready' over an empty map
      // is therefore true rather than a swallowed failure.
      setById(EMPTY);
      setStatus('ready');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    (async () => {
      try {
        // Only rows somebody else logged. A member's own entries cannot carry a
        // query — the trigger in supabase/parts/2660 refuses one — so reading
        // them would be a bigger read for rows the screen would discard.
        //
        // The columns are spelled out rather than held in a constant.
        // scripts/check-schema.mjs reads `.select()` strings out of the SOURCE
        // and compares them with what supabase/parts builds; it exists because
        // part 46 added `workouts.session_mins`, was committed, and was never
        // run, and no workout saved for two days for anybody. A constant it
        // cannot follow drops the read out of that comparison (it already lists
        // `.select(WORKOUT_COLS)` as unreadable), and these two columns live in
        // a part that has deliberately NOT been applied. This is the read that
        // most needs that gate able to see it.
        const { data, error } = await supabase
          .from('workouts').select('id, queried_at, query_note')
          .eq('user_id', userId)
          .not('logged_by', 'is', null)
          .order('performed_at', { ascending: false })
          .limit(capLimit());
        if (cancelled) return;
        if (error || !data) {
          // Not an empty map: 'error' with nothing in it means UNKNOWN, and the
          // strip says so rather than telling the member they have objected to
          // nothing.
          reportError('coachLogQueries.read', error);
          setById(EMPTY);
          setStatus('error');
          return;
        }
        const page = capped(data as unknown as QueryRow[]);
        setById(indexQueries(page.rows));
        // The rows that came back are real either way; 'partial' says there are
        // more of them, which is the difference between "this row carries no
        // query" and "we never saw this row".
        setStatus(page.truncated ? 'partial' : 'ready');
      } catch (e) {
        if (cancelled) return;
        reportError('coachLogQueries.read', e);
        setById(EMPTY);
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [userId, nonce]);

  /**
   * One write, both directions.
   *
   * `.select()` of the same three columns and a row COUNT, never the absence of an error.
   * PostgREST answers an UPDATE that matched nothing with a success and an empty
   * array — so a row the member no longer owns, or an id that never came back
   * from the insert, would otherwise report a query raised and show one that
   * does not exist. The same hole src/ui/workoutLog.tsx documents on the
   * correction path.
   *
   * The map is updated from the row the SERVER returned, not from what was sent.
   * `queried_at` is stamped by the trigger, so the date on screen after a query
   * is the date in the column; echoing the handset's own ISO would put a
   * different instant in front of the member from the one the coach will read.
   */
  const write = useCallback(async (
    workoutId: string,
    patch: Record<string, unknown>,
  ): Promise<boolean> => {
    const owner = uid.current;
    if (!USE_SUPABASE || !owner || !workoutId) return false;
    try {
      const { data, error } = await supabase
        .from('workouts').update(patch)
        // `user_id` as well as the id. The policy already restricts this to the
        // member's own rows; naming it means a mistaken id cannot even be
        // attempted against somebody else's record.
        .eq('id', workoutId).eq('user_id', owner)
        .select('id, queried_at, query_note');
      if (error || !data || !data.length) {
        reportError('coachLogQueries.write', error);
        return false;
      }
      const fresh = indexQueries(data as unknown as QueryRow[]);
      setById((prev) => {
        const next = new Map(prev);
        for (const [k, v] of fresh) next.set(k, v);
        return next;
      });
      return true;
    } catch (e) {
      reportError('coachLogQueries.write', e);
      return false;
    }
  }, []);

  const query = useCallback(
    (workoutId: string, note: string | null) =>
      write(workoutId, queryPatch(note, new Date().toISOString())),
    [write],
  );
  const withdraw = useCallback((workoutId: string) => write(workoutId, withdrawPatch()), [write]);

  return { byId, status, query, withdraw, reload };
}

/**
 * The one coach this member can PROVE, for naming the sessions in their log
 * that they did not write themselves.
 *
 * Here beside the query read because it answers the other half of the same
 * question — who wrote this row, and what may be said about it — and because
 * it was written out longhand on app/(client)/workouts.tsx and needed a second
 * caller the moment the Activity feed started attributing sessions. Two copies
 * of a name lookup that decides whose name goes under somebody's training
 * record is the drift src/lib/threadPeer.ts describes the cost of.
 *
 * `my_coach()` (supabase/parts/67, extended by 115) and deliberately NOT
 * `clients.trainer_id`: this name goes under a record made ABOUT somebody, so
 * it uses the function that demands BOTH halves of the coach↔client link and
 * returns the id and the name in one row, with no second read to get out of
 * step with the first.
 *
 * Null covers every way of not knowing, and `coachNameFor`
 * (src/lib/coachLogReview.ts) turns all of them back into "your coach" — which
 * is true of every coach-logged row whoever wrote it.
 */
export function useLoggingCoach(userId: string | null): KnownCoach | null {
  const [coach, setCoach] = useState<KnownCoach | null>(null);
  useEffect(() => {
    if (!USE_SUPABASE || !userId) { setCoach(null); return; }
    let live = true;
    (async () => {
      try {
        // no-error-ok: null and refused are the same answer here — the caption
        // says "your coach", which is true of every coach-logged row.
        const { data } = await supabase.rpc('my_coach');
        if (!live) return;
        // RETURNS TABLE, so supabase-js hands back an array.
        const row: any = Array.isArray(data) ? data[0] : data;
        const id = typeof row?.coach_id === 'string' ? row.coach_id : null;
        setCoach(id ? { id, name: typeof row?.coach_name === 'string' ? row.coach_name : null } : null);
      } catch { /* the generic caption, which is never wrong */ }
    })();
    return () => { live = false; };
  }, [userId]);
  return coach;
}
