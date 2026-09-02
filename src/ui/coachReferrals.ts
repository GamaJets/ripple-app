// Which of a coach's own clients have brought people in.
//
// One RPC — `coach_referrals()`, supabase/parts/630 — and the shaping rules in
// src/lib/referralCredit.ts, which is where the coach half of that module lives
// for the same reason the member half does: referrals.ts imports the Supabase
// client, and a rule that cannot be loaded under node is a rule with no test.
//
// ── Null is not empty, and this hook never lets it become empty ────────────
//
// `supabase.rpc` resolves with `{ data, error }` and does not reject, so the
// shape that keeps producing this codebase's worst sentences is one line long:
// `return data ?? []`. Here that empty array would render as "none of your
// clients has brought anybody in", to a coach whose best referrer is on the
// list that failed to load — and a coach who reads that stops asking, which is
// the one growth channel that costs them nothing. `rows` stays NULL under
// 'error' and `coachSummaryLine` has a different sentence for it.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import type { LoadStatus } from './loadStatus';
import { useAuthRevision } from './authRevision';
import { shapeCoachReferrers, type CoachReferrer, type RawCoachReferrer } from '../lib/referralCredit';

/** The ceiling `coach_referrals()` takes, mirrored here so a read that came
 *  back at it can be reported as a prefix rather than as a total. It is the
 *  same limit `my_referrals()` uses and it is stated in part 630. */
const ROW_CAP = 200;

export interface CoachReferrals {
  status: LoadStatus;
  /** Null means we could not find out. NEVER an empty array for that — the two
   *  render as different sentences and only one of them is about the clients. */
  rows: CoachReferrer[] | null;
  reload: () => Promise<void>;
}

export function useCoachReferrals(): CoachReferrals {
  const authRev = useAuthRevision();
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [rows, setRows] = useState<CoachReferrer[] | null>(null);

  const load = useCallback(async () => {
    if (!USE_SUPABASE) { setRows([]); setStatus('ready'); return; }
    setStatus('loading');
    try {
      const { data, error } = await supabase.rpc('coach_referrals');
      if (error) {
        // Includes the case where part 630 has not been applied to this
        // database yet: PostgREST answers 404/PGRST202 for a function it cannot
        // find, which is an error and not an empty result. Treating a missing
        // function as "nobody has referred anybody" is the same lie by a
        // different route, so it takes the same branch.
        reportError('coachReferrals.read', error);
        setRows(null); setStatus('error'); return;
      }
      const shaped = shapeCoachReferrers(Array.isArray(data) ? (data as RawCoachReferrer[]) : []);
      setRows(shaped);
      // A read that came back at the server's own limit is a prefix of the real
      // list. The rows may be shown; a total over them may not be stated as a
      // total — src/lib/rowCap.ts, and `coachSummaryLine` refuses under
      // 'partial' for exactly that.
      setStatus(Array.isArray(data) && data.length >= ROW_CAP ? 'partial' : 'ready');
    } catch (e) {
      reportError('coachReferrals.read', e);
      setRows(null); setStatus('error');
    }
  }, []);

  useEffect(() => { void load(); }, [load, authRev]);

  return { status, rows, reload: load };
}
