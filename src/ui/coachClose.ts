// The three reads behind the coach's own share of a month close.
//
// The impure half of src/lib/coachClose.ts, which holds every decision about
// what an empty answer means.
//
// ── Which month ────────────────────────────────────────────────────────────
//
// The last one that ENDED at the gym, which is the one somebody is trying to
// close. Not the running month: `closeBlockers` refuses a month in progress
// outright (`kind: 'month_running'`), so a queue built on it would be naming
// work against a deadline that does not exist yet.
//
// "At the gym" is load-bearing and is the reason `fetchGymZone` is read at all.
// `gymMonthNow(zone)` is the month running on the gym's clock, and
// `monthsBefore` steps back one key by arithmetic rather than by stepping a
// Date — which would put the answer back on the phone's calendar even when the
// first key came off the gym's. On the first of the month, in the hours either
// side of midnight, the phone and the gym disagree about which month just
// ended, and this screen's whole subject is which month just ended.
//
// A gym with no zone set falls back to the reader's month and SAYS SO through
// `basis`, rather than passing the phone's calendar off as the gym's. That is
// `gymMonthNow`'s own contract and src/lib/gymWindow.ts argues it at length.
//
// ── Why two reads and not one ─────────────────────────────────────────────
//
// One-to-ones and classes are different tables with different policies, and
// they fail independently. `fetchMySessions` scopes on `trainer_id` — which is
// what `sessions_trainer` has enforced since part 1 — and THROWS rather than
// returning [] on a refusal, because every caller turns it into a count.
// `class_attendance_summary` answers null for both a refusal and a truncated
// range. Each half carries its own status into the view, so a coach who can see
// one of the two sees it rather than losing both.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { fetchMySessions } from '../lib/trainerSessions';
import type { PtSession } from '../lib/gymSessions';
import { classSummary } from '../lib/classAttendance';
import type { ClassSummaryRow } from '../lib/classRates';
import { fetchGymZone } from '../lib/gymZone';
import { gymMonthNow, monthAtGym, type MonthBasis } from '../lib/gymMonth';
import { monthsBefore } from '../lib/closeCosts';
import { coachCloseView, type CoachCloseView } from '../lib/coachClose';
import type { GymLink } from '../lib/coachPayTerms';
import { sessionUid } from '../lib/sessionUid';
import { worstStatus, type LoadStatus } from './loadStatus';
import { useTenant } from './tenant';
import { useToday } from './today';
import { useAuthRevision } from './authRevision';

export interface MyCloseQueue {
  /** The worse of every read behind this, for a caller that wants one word. */
  status: LoadStatus;
  /** The whole section, already decided. Never rows a caller has to interpret. */
  view: CoachCloseView;
  /** Whose calendar decided which month just ended. 'reader' means the gym has
   *  set no timezone, and the screen must say so rather than implying the gym's. */
  basis: MonthBasis;
  refresh: () => void;
}

/**
 * The coach's own outstanding work for the month their gym is closing.
 *
 * Costs no reads for the account with no gym — which is every coach live on
 * this product today. There is no gym to be closing a month, and
 * `coachCloseView` answers 'no_gym' from the link before it looks at a row.
 */
export function useMyCloseQueue(): MyCloseQueue {
  const { tenant, status: tenantStatus } = useTenant();
  const authRev = useAuthRevision();
  // Not for a figure — nothing here is per-day — but because this hook decides
  // WHICH MONTH from the clock, and a month boundary crossed with the screen
  // mounted would otherwise leave a coach looking at the month before last.
  // app/(trainer)/my-register.tsx is registered `href: null`, so it mounts once
  // and is never torn down; src/ui/today.ts's header is the whole argument.
  const today = useToday();
  const [zone, setZone] = useState<string | null>(null);
  const [sessions, setSessions] = useState<PtSession[] | null>(null);
  const [sessionStatus, setSessionStatus] = useState<LoadStatus>('loading');
  const [classes, setClasses] = useState<ClassSummaryRow[] | null>(null);
  const [classStatus, setClassStatus] = useState<LoadStatus>('loading');
  const [tick, setTick] = useState(0);

  const tenantId = tenant?.id ?? null;

  // 'none' only once the tenant read has ANSWERED. Under 'loading' and 'error'
  // this is 'unknown' — the separation src/lib/currencySource.ts was written to
  // keep, restated here because the wrong side of it prints "no gym is closing
  // a month around you" to an employed coach over a timeout.
  const link: GymLink = tenantStatus === 'ready'
    ? (tenantId ? 'gym' : 'none')
    : 'unknown';

  // Re-derived whenever the day moves, never memoised on `[]`. `today` is in
  // the dependency list for that and nothing else: it is the value that changes
  // when midnight passes, which is when the answer to "which month just ended"
  // changes.
  const head = useMemo(() => gymMonthNow(zone), [zone, today]); // eslint-disable-line react-hooks/exhaustive-deps -- `today` is the clock this must re-run on; see src/ui/today.ts
  const prevKey = useMemo(() => monthsBefore(head.key, 1)[0] ?? null, [head.key]);
  const at = useMemo(() => (prevKey ? monthAtGym(prevKey, zone) : null), [prevKey, zone]);
  const month = useMemo(() => (at ? {
    key: at.window.key,
    label: at.window.label,
    fromIso: at.window.fromIso,
    toIso: at.window.toIso,
  } : null), [at]);

  const fromIso = month?.fromIso ?? null;
  const toIso = month?.toIso ?? null;

  const load = useCallback(async (cancelled: () => boolean) => {
    if (!USE_SUPABASE) { setSessionStatus('ready'); setClassStatus('ready'); return; }
    if (!tenantId) {
      // Nothing to read and nothing unknown. The view is a sentence about
      // having no gym, and it does not need rows to say it.
      setSessions(null); setClasses(null); setZone(null);
      const settled: LoadStatus = tenantStatus === 'ready' ? 'ready' : 'loading';
      setSessionStatus(settled); setClassStatus(settled);
      return;
    }
    // The zone is read every time rather than cached beside the tenant, because
    // `useTenant` does not carry `timezone` and widening that provider would put
    // a column only two screens need on the one read every screen depends on.
    const z = await fetchGymZone(supabase, tenantId);
    if (cancelled()) return;
    // Reported, not swallowed, and not fatal: with no usable zone the month
    // falls back to the reader's and `basis` says so on the screen.
    if (z.error) reportError('coachClose.zone', z.error);
    setZone(z.zone);
  }, [tenantId, tenantStatus]);

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => { cancelled = true; };
  }, [load, authRev, tick]);

  // The two row reads hang off the window, so they re-run when the month rolls
  // and when the zone finally lands — and not before, which is what stops a
  // queue being built for the wrong month and then silently replaced.
  useEffect(() => {
    if (!USE_SUPABASE || !tenantId || !fromIso || !toIso) return;
    let cancelled = false;
    setSessionStatus('loading');
    setClassStatus('loading');
    // Cleared first. Without this the previous month's rows stay on screen
    // under the new month's heading while the reads are in flight, which is the
    // one thing a screen about a specific month must not do.
    setSessions(null);
    setClasses(null);

    void (async () => {
      // getSession and not getUser, and the reason written down correctly this
      // time. The comment that stood here said "getUser REJECTS with nobody
      // signed in", and that is NOT what it does: `_getUser` catches every
      // AuthError and RESOLVES with `{ data: { user: null }, error }` — see the
      // quoted source in src/lib/authReadFate.ts. The real reason to prefer
      // getSession is the one src/lib/sessionUidRead.ts gives: it answers from
      // device storage and therefore answers in a basement gym, where fronting
      // these reads with a network call would stall them. So the call stays as
      // it is and is NOT converted to getUser().
      //
      // What was actually wrong was the discarded `error`. getSession() has the
      // same defect one layer down — an expired access token whose refresh
      // cannot reach the server resolves `{ session: null, error }` — so an
      // outage reached `!uid` as the same null a signed-out phone gives.
      //
      // Both fates still end at 'error', and that is deliberate rather than
      // lazy: neither a signed-out coach nor an unreadable one has a month's
      // work to show, and 'error' is the status that makes this section say it
      // does not know instead of drawing an empty marking queue over a month
      // that is not empty. What changes is that the outage now leaves a trace —
      // `sessionUid` reports it under this key — where before it left none.
      const who = await sessionUid('coachClose.session');
      if (cancelled) return;
      if (who.fate !== null) { setSessionStatus('error'); setClassStatus('error'); return; }
      const uid = who.uid;

      // Settled rather than all-or-nothing: one refusal must not take the other
      // half down. `Promise.all` here would turn a refused RPC into an unread
      // marking queue, which is the half that actually holds the month up.
      const [mine, rows] = await Promise.all([
        fetchMySessions(supabase, uid, fromIso, toIso).then(
          (r) => ({ ok: true as const, r }),
          (e) => ({ ok: false as const, e }),
        ),
        classSummary(fromIso, toIso).then(
          (r) => ({ ok: true as const, r }),
          (e) => ({ ok: false as const, e }),
        ),
      ]);
      if (cancelled) return;

      if (mine.ok) { setSessions(mine.r); setSessionStatus('ready'); }
      else { reportError('coachClose.sessions', mine.e); setSessions(null); setSessionStatus('error'); }

      // `classSummary` resolves with null for BOTH a refusal and a range too
      // large to read whole — see its header. Null is unknown either way and is
      // never the empty timetable it looks like.
      if (rows.ok && rows.r != null) { setClasses(rows.r); setClassStatus('ready'); }
      else { if (!rows.ok) reportError('coachClose.classes', rows.e); setClasses(null); setClassStatus('error'); }
    })();

    return () => { cancelled = true; };
  }, [tenantId, fromIso, toIso, authRev, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  const status = worstStatus(tenantStatus, sessionStatus, classStatus);

  return useMemo<MyCloseQueue>(() => ({
    status,
    view: coachCloseView(
      link,
      month,
      { status: sessionStatus, rows: sessions },
      { status: classStatus, rows: classes },
      Date.now(),
    ),
    basis: head.basis,
    refresh,
  // `today` is in the list because `Date.now()` above is read inside this memo:
  // without it the "has this session finished yet" test would be pinned to the
  // last server answer, which is exactly the frozen clock scripts/check-frozen-hook.mjs
  // was written for.
  }), [status, link, month, sessionStatus, sessions, classStatus, classes, head.basis, today, refresh]);
}
