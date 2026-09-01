// The read behind the coach's retention curve: every coaching relationship
// this coach has ever had, ENDED ONES INCLUDED.
//
// The arithmetic is in src/lib/coachCohorts.ts and is under test; this half
// touches supabase and is not.
//
// ── Why it cannot be the roster ───────────────────────────────────────────
//
// `useRoster` is the coach's CURRENT book. Grouping it by join month and
// counting who is still there gives 100% at every milestone forever, because
// the roster is by definition the people who have not left. That is a
// survivorship curve drawn as a retention curve and there is nothing on it to
// give it away. So this reads `coaching_relationships` directly, with no status
// filter, and the endings are the whole point of it.
//
// ── No name comes back, and none is asked for ─────────────────────────────
//
// A cohort is a count. `select('created_at, ended_at')` and nothing else — no
// client_id, no profile join, no name. A retention screen that could name the
// people who left would be a different screen with a different argument to
// make, and the read that fed it would be sitting there for anybody who later
// wanted to put a name on a chart.
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { capLimit, capped } from '../lib/rowCap';
import { useAuthRevision } from './authRevision';
import { useEffect, useState } from 'react';
import type { LoadStatus } from './loadStatus';
import type { CoachingSpan } from '../lib/coachCohorts';

export interface SpansRead {
  spans: CoachingSpan[];
  /** 'partial' is a real answer here and it is a REFUSAL upstream: a history
   *  missing some of its endings draws flat at 100%. `cohortsBlocker` is where
   *  that is enforced. */
  status: LoadStatus;
}

/**
 * Every relationship on this coach's book, oldest first.
 *
 * Signed out, or the backend off, is 'ready' with nothing: there is no absent
 * server being misreported, which is the rule src/ui/loadStatus.ts states.
 *
 * `cr_self` (part 06) grants `for all using (coach_id = auth.uid() or client_id
 * = auth.uid())`, so no policy is needed for this — a coach has always been
 * able to read their own relationship rows. Verified against the policy text
 * rather than assumed.
 */
export async function fetchCoachingSpans(): Promise<SpansRead> {
  if (!USE_SUPABASE) return { spans: [], status: 'ready' };
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return { spans: [], status: 'ready' };
    const { data, error } = await supabase
      .from('coaching_relationships')
      .select('created_at, ended_at')
      .eq('coach_id', uid)
      .order('created_at', { ascending: true })
      .limit(capLimit());
    if (error) {
      reportError('coachCohorts.read', error);
      return { spans: [], status: 'error' };
    }
    const page = capped((data as { created_at: string; ended_at: string | null }[]) ?? []);
    return {
      spans: page.rows.map((r) => ({ startedAt: r.created_at, endedAt: r.ended_at ?? null })),
      status: page.truncated ? 'partial' : 'ready',
    };
  } catch (e) {
    reportError('coachCohorts.read', e);
    return { spans: [], status: 'error' };
  }
}

/** The hook. Re-reads when the signed-in account changes, and nothing else —
 *  a retention curve does not move between renders. */
export function useCoachingSpans(): SpansRead {
  const rev = useAuthRevision();
  const [read, setRead] = useState<SpansRead>({ spans: [], status: 'loading' });
  useEffect(() => {
    let alive = true;
    setRead({ spans: [], status: 'loading' });
    void fetchCoachingSpans().then((r) => { if (alive) setRead(r); });
    return () => { alive = false; };
  }, [rev]);
  return read;
}
