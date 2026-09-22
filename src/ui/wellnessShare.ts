// The one switch in front of the sleep and water a member types in — read by
// the member who owns it and by the coach it lets in.
//
// Two callers, one hook, deliberately, and it is the same shape
// src/ui/glucoseData.ts uses for exactly the same question. The member's app
// passes no `personId` and gets the flag plus the control to change it; the
// coach's app passes a client's id and gets a READ-ONLY view of the flag and of
// the logs it governs. This hook cannot grant itself access it does not have —
// the gate is `sleep_logs_coach_read` and `hydration_logs_coach_read` in
// supabase/parts/2670, enforced by Postgres. At most this can fail to ask.
//
// ── Why the coach's read still asks for the flag ──────────────────────────
//
// Row-level security answers a coach reading a member who has NOT shared with
// zero rows and no error — which is indistinguishable, at the wire, from a
// member who has shared and logged nothing. Those are opposite facts about a
// person and a coach acts differently on each. So the flag is read as well, and
// `wellnessPanel` (src/lib/coachWellness.ts) decides which sentence is honest.
// Without it, the screen's only available sentence would be the false one.
//
// ── Why the member's side does not read the logs ──────────────────────────
//
// Because the member already has them, on two screens built for them —
// Recovery for the nights and Habits for the water — and a third reader here
// would be a third answer to "how much did I sleep", which is the class of bug
// src/ui/deviceSleep.tsx was extracted to end. The member's side of this hook
// is the flag and nothing else.
//
// ── Failure is never silence ──────────────────────────────────────────────
//
// Every read below sets a status, and `null` is the value for "we do not know"
// on the flag. A false flag we did not actually read would tell a coach their
// client declined, which is a claim about somebody's decision made out of our
// own connection problem.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { capLimit, capped } from '../lib/rowCap';
import { recentNights } from '../lib/sleepMerge';
import { localDate } from '../lib/localDate';
import type { LoadStatus } from './loadStatus';
import type { SleepLogRow, WaterLogRow } from '../lib/coachWellness';

/** How far back the coach's panel looks. Fourteen days, matching Blood Sugar,
 *  so the two health panels on a client's screen cover the same fortnight. */
export const WELLNESS_WINDOW_DAYS = 14;

/** The columns, named once. check:row-shapes compares these against the types
 *  the rows are read as, and a select that drifts from its cast is the defect
 *  that put "0 sessions" on a statement of record for a year. */
const SLEEP_COLS = 'at, hours, quality';
const WATER_COLS = 'logged_on, glasses';

/** `hydration_logs` rows arrive with Postgres' own column names. */
interface WaterRowRaw { logged_on: string; glasses: number | string }
/** `sleep_logs.hours` is numeric, which supabase-js hands back as a string on
 *  some paths and a number on others — the bug that turned a sum of nights into
 *  "07.56.5". Both are read through Number() below. */
interface SleepRowRaw { at: string; hours: number | string; quality: number | string }

export interface WellnessShare {
  /** Whether this member's coach may read their typed sleep and water. `null`
   *  is UNKNOWN — a read that did not answer — and never "off". */
  shared: boolean | null;
  flagStatus: LoadStatus;
  /** Empty for the member's own use of this hook; see the header. */
  sleep: SleepLogRow[];
  water: WaterLogRow[];
  sleepStatus: LoadStatus;
  waterStatus: LoadStatus;
  /** True when this is a coach's view. The switch is not theirs to move, and
   *  the database says so too (clients_wellness_consent_guard). */
  readOnly: boolean;
  refresh: () => Promise<void>;
  /** Turn sharing on or off. Resolves false when the server does not hold the
   *  new value — a switch that flipped on screen and nowhere else is worse than
   *  one that refused. */
  setShared: (on: boolean) => Promise<boolean>;
}

/**
 * @param personId  A client's id, for the coach's read-only view. Omit for the
 *                  signed-in member's own flag.
 * @param askable   False for a client a coach typed in by hand: they have no
 *                  account, so nothing server-backed is asked for them. See
 *                  src/lib/clientRecord.ts for why the id alone cannot tell.
 */
export function useWellnessShare(personId?: string | null, askable = true): WellnessShare {
  // Coach mode is decided by whether the caller PASSED a subject at all, not by
  // whether that subject is currently non-null. A coach screen with nobody
  // picked yet passes `null`, and reading that as "no personId, so read the
  // signed-in member's own flag" would have the coach's app quietly reading the
  // coach's own consent row — a different person's answer, on a screen about
  // somebody else.
  const coachMode = personId !== undefined;
  const [uid, setUid] = useState<string | null>(null);
  const [shared, setSharedState] = useState<boolean | null>(null);
  const [flagStatus, setFlagStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [sleep, setSleep] = useState<SleepLogRow[]>([]);
  const [water, setWater] = useState<WaterLogRow[]>([]);
  const [sleepStatus, setSleepStatus] = useState<LoadStatus>(USE_SUPABASE && coachMode ? 'loading' : 'ready');
  const [waterStatus, setWaterStatus] = useState<LoadStatus>(USE_SUPABASE && coachMode ? 'loading' : 'ready');

  // The person whose answer is allowed to reach the state. A coach tapping
  // through a book of clients starts a read per tap and they do not come back
  // in order, so without this a slow answer for the person tapped first lands
  // under the name of the person tapped second — one member's sleep attributed
  // to another, which is worse than showing nothing.
  const wanted = useRef<string | null>(null);

  // getSession(), not getUser(). getUser() goes to the network to revalidate
  // and, with no signal, resolves with `user: null` rather than throwing — so
  // the id stayed null, every read returned at its guard, and the status sat on
  // 'loading' for the session. That is written up at length in glucoseData.ts;
  // it is the same failure and the same fix.
  useEffect(() => {
    if (coachMode) return;
    let alive = true;
    (async () => {
      let session: { user?: { id?: string } } | null = null;
      try {
        const { data } = await supabase.auth.getSession();
        session = (data?.session as { user?: { id?: string } } | null) ?? null;
      } catch { /* no session stored on this device; handled as signed out */ }
      if (!alive) return;
      const id = session?.user?.id ?? null;
      setUid(id);
      // Nobody signed in, or no backend. There is no account whose flag could
      // have been withheld, so this is a whole answer rather than a failed read
      // — and a status left on 'loading' is a screen that spins for ever.
      if (!id || !USE_SUPABASE) { setFlagStatus('ready'); setSharedState(null); }
    })();
    return () => { alive = false; };
  }, [coachMode]);

  const target = coachMode ? (personId ?? null) : uid;
  const readOnly = coachMode;

  const refresh = useCallback(async () => {
    if (!USE_SUPABASE || !target) return;
    if (!askable) {
      // Nothing was asked, so nothing failed and nothing is empty. The screen
      // distinguishes this from a refusal; see `wellnessPanel`.
      setFlagStatus('error'); setSleepStatus('error'); setWaterStatus('error');
      setSharedState(null);
      return;
    }
    wanted.current = target;
    setFlagStatus('loading');
    if (readOnly) { setSleepStatus('loading'); setWaterStatus('loading'); }

    // The window, in the member's own calendar days. `recentNights` builds each
    // day at noon rather than at midnight, because in the zones whose DST
    // change happens at midnight local midnight does not exist and the Date
    // lands on the day before. The earliest day is the last of the list.
    const nights = recentNights(WELLNESS_WINDOW_DAYS);
    const sinceDay = nights[nights.length - 1];
    // `sleep_logs.at` is a timestamptz, so the bound has to be an instant:
    // local midnight of that day, built through `localDate` rather than by
    // parsing the bare date — which would resolve to UTC midnight and cut the
    // window on the wrong day for everybody west of Greenwich.
    const sinceAt = (localDate(sinceDay) ?? new Date(0)).toISOString();

    const flagRead = supabase
      .from('clients').select('wellness_shared').eq('id', target).maybeSingle();
    // maybeSingle, not single: a coach reading their OWN id has no `clients`
    // row, and PGRST116 on a missing row is what put a whole coach app into
    // 'error' once already.

    const [flagRes, sleepRes, waterRes] = await Promise.all([
      flagRead,
      readOnly
        ? supabase.from('sleep_logs').select(SLEEP_COLS)
            .eq('user_id', target).gte('at', sinceAt)
            .order('at', { ascending: false })
            .limit(capLimit())
        : Promise.resolve({ data: null, error: null } as { data: SleepRowRaw[] | null; error: unknown }),
      readOnly
        ? supabase.from('hydration_logs').select(WATER_COLS)
            .eq('user_id', target).gte('logged_on', sinceDay)
            .order('logged_on', { ascending: false })
            .limit(capLimit())
        : Promise.resolve({ data: null, error: null } as { data: WaterRowRaw[] | null; error: unknown }),
    ]);
    if (wanted.current !== target) return;

    if (flagRes.error) {
      reportError('wellnessShare.flag', flagRes.error);
      // Null and 'error' together. Not `false`: a coach told "they have not
      // shared" on the strength of a failed read is being told somebody's
      // decision that nobody read.
      setSharedState(null); setFlagStatus('error');
    } else {
      setSharedState(flagRes.data ? !!(flagRes.data as { wellness_shared?: boolean }).wellness_shared : null);
      setFlagStatus('ready');
    }

    if (!readOnly) return;

    if (sleepRes.error) {
      reportError('wellnessShare.sleep', sleepRes.error);
      // The list is NOT emptied. Whatever was on screen was real; the status is
      // what says it is no longer confirmed current.
      setSleepStatus('error');
    } else {
      const cap = capped((sleepRes.data ?? []) as SleepRowRaw[]);
      setSleep(cap.rows.map((r) => ({
        at: String(r.at),
        hours: Number(r.hours),
        quality: Number(r.quality),
      })));
      // A full page is indistinguishable from a truncated one, so it is
      // reported as partial: the nights may be listed, an average may not.
      setSleepStatus(cap.truncated ? 'partial' : 'ready');
    }

    if (waterRes.error) {
      reportError('wellnessShare.water', waterRes.error);
      setWaterStatus('error');
    } else {
      const cap = capped((waterRes.data ?? []) as WaterRowRaw[]);
      setWater(cap.rows.map((r) => ({ loggedOn: String(r.logged_on), glasses: Number(r.glasses) })));
      setWaterStatus(cap.truncated ? 'partial' : 'ready');
    }
  }, [target, readOnly, askable]);

  useEffect(() => { void refresh(); }, [refresh]);

  const setShared = useCallback(async (on: boolean): Promise<boolean> => {
    if (readOnly || !target) return false;
    // The COUNT is checked, not merely `error`. PostgREST does not fail an
    // update that RLS narrows to zero rows, so "no error" on its own is not
    // evidence that anything was written — and this is the one write in the app
    // whose silent failure would leave a member believing they had stopped
    // sharing something they are still sharing.
    const { error, count } = await supabase
      .from('clients').update({ wellness_shared: on }, { count: 'exact' })
      .eq('id', target);
    if (error || !count) {
      reportError('wellnessShare.setShared', error ?? new Error('no row updated'));
      return false;
    }
    setSharedState(on);
    return true;
  }, [readOnly, target]);

  return { shared, flagStatus, sleep, water, sleepStatus, waterStatus, readOnly, refresh, setShared };
}
