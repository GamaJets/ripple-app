// Member churn on the handset — the gym's memberships, read for the owner.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// The owner's Growth tab counted TRAINERS. New trainers this month, idle
// trainers, trainers grouped by signup month, a funnel that starts at a trainer
// signup — five tabs, and the one called Growth answered a question a gym owner
// did not ask. The screen was honest about it and said so in as many words:
// member churn "is not derived anywhere on this handset". Which was true, and
// was the defect: the number the business actually runs on could only be got at
// from a laptop.
//
// So the memberships are read here, and the arithmetic is
// src/lib/memberChurn.ts — the same module the console's Analytics page calls,
// over the same table, so the two surfaces cannot report different churn for
// the same gym on the same day. Nothing about the derivation is phone-specific;
// only the read is.
//
// ── A hook rather than a provider ──────────────────────────────────────────
//
// Every other gym read in this folder is a context with a provider mounted in
// `app/(owner)/_layout.tsx`, because several screens share it. One screen wants
// this one, and a context nobody else consumes is a provider registration that
// can be forgotten — and a forgotten provider is a thrown error on a tab, not a
// missing figure. This is a plain hook: mount it, it reads, unmount it and the
// in-flight read is dropped on the floor rather than setting state on a screen
// that has gone.
//
// ── What a failed read may NOT become ──────────────────────────────────────
//
// Zero. `fetchMemberships` refusing leaves no rows, and no rows through this
// module is a gym with nobody on the books, no joiners, no leavers and — worst
// — a churn rate of nothing at all, which is the best figure on the scale. So
// `status` is carried and every figure below is null under 'error'. The screen
// renders a dash and says the roster could not be read, which is a different
// sentence from "nobody left".
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { fetchMemberships } from '../lib/gymRecord';
import {
  memberSpans, churnMonths, undatedExitCount, undatedJoinCount, onBooksCount,
  lastClosedMonth, churnHeadline,
  type MemberSpan, type ChurnMonth, type ChurnHeadline,
} from '../lib/memberChurn';
import { reportError } from '../lib/reportError';
import { useTenant } from './tenant';
import { useAuthRevision } from './authRevision';
import { isWhole, type LoadStatus } from './loadStatus';

/**
 * How many months the handset draws.
 *
 * Six, not the console's thirteen. The console has a table and the year-ago
 * month in it on purpose — a gym with a January is not churning in January.
 * A phone has one column, and thirteen rows of it is a scroll nobody reads;
 * `churnMonths` takes the count as an argument precisely so the two surfaces
 * can differ in how much they SHOW without differing in what they compute.
 */
export const PHONE_MONTHS = 6;

export interface MemberChurnValue {
  /** Whether what is held is the whole set. Every figure is null unless it is. */
  status: LoadStatus;
  /** True while the first read is in flight — distinct from a read that failed. */
  loading: boolean;
  /** Newest month first, or null when the roster is not known. */
  months: ChurnMonth[] | null;
  /** The last month that actually finished — the one every headline figure on
   *  a handset describes. Null while the roster is unknown, and also when no
   *  month on offer has finished yet. */
  lastClosed: ChurnMonth | null;
  /** That same month as a hero figure and its reason. */
  headline: ChurnHeadline;
  /** One row per member, or null when the roster is not known. */
  spans: MemberSpan[] | null;
  /** Members on the books today, or null. */
  onBooks: number | null;
  /** Ended memberships with no end date — every month's rate is withheld while
   *  there is one, because a leaver could belong to any of them. */
  undatedExits: number | null;
  /** Members with no usable start date — in no opening roster and no cohort. */
  undatedJoins: number | null;
  refresh: () => void;
}

/** Nothing known. Not zeroes: see the header. */
const unknown = (status: LoadStatus, loading: boolean): MemberChurnValue => ({
  status,
  loading,
  months: null,
  lastClosed: null,
  headline: {
    pct: null,
    label: null,
    note: status === 'error'
      ? 'your memberships could not be read — this is not a gym nobody left'
      : 'reading your memberships…',
  },
  spans: null,
  onBooks: null,
  undatedExits: null,
  undatedJoins: null,
  refresh: () => {},
});

export function useMemberChurn(): MemberChurnValue {
  const authRev = useAuthRevision();
  const { tenant, status: tenantStatus } = useTenant();
  const [rows, setRows] = useState<MemberSpan[] | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  /**
   * Frozen per read, not read in the render body.
   *
   * `Date.now()` in the body moves on every re-render, so which month counts as
   * "running" could change underneath somebody who is looking at it — and the
   * headline month would silently roll over at midnight while the tab is open,
   * relabelling a figure without recomputing it.
   */
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // The local build has no server to misreport. An owner with the backend off
    // has no memberships rather than unreadable ones.
    if (!USE_SUPABASE) { setRows([]); setStatus('ready'); setLoading(false); return; }
    // The tenant read has its own three states and this one inherits them. A
    // null tenant under 'error' means we could not find out WHICH GYM this is,
    // not that there is no gym — reading it as the second would put "nobody
    // left this month" in front of an owner whose account simply could not be
    // resolved. And a null tenant that is still loading is not an answer yet.
    if (tenantStatus === 'error') { setRows(null); setStatus('error'); setLoading(false); return; }
    if (!tenant) {
      if (tenantStatus === 'loading') { setRows(null); setStatus('loading'); setLoading(true); return; }
      // Settled, and there genuinely is no gym on this account. A real,
      // knowable state — there is no roster we are failing to read.
      setRows([]); setStatus('ready'); setLoading(false); return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setStatus('loading');
      try {
        // `fetchMemberships` pages with `readAll`, so what comes back is the
        // whole set or it throws. There is no 'partial' to represent here: a
        // truncated roster would understate both halves of every rate on the
        // screen and the read refuses rather than handing one back.
        const ms = await fetchMemberships(supabase, tenant.id);
        if (cancelled) return;
        setRows(memberSpans(ms));
        setNow(Date.now());
        setStatus('ready');
      } catch (e) {
        reportError('memberChurn.load', e);
        // Null, not []. An empty array under 'error' is the exact pair of
        // values a gym with no members has, and this screen would then report a
        // roster of nobody as a finding.
        if (!cancelled) { setRows(null); setStatus('error'); }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tenant?.id, tenantStatus, tick, authRev]);

  if (!isWhole(status) || !rows) return { ...unknown(status, loading), refresh };

  const undatedExits = undatedExitCount(rows);
  const months = churnMonths(rows, undatedExits, now, PHONE_MONTHS);
  // One month, computed once. The hero, the joiner count and the leaver count
  // beside it have to be about the SAME month — three figures under one heading
  // that quietly described different months would be worse than any one of them
  // missing.
  const lastClosed = lastClosedMonth(months);
  return {
    status,
    loading,
    months,
    lastClosed,
    headline: churnHeadline(lastClosed),
    spans: rows,
    onBooks: onBooksCount(rows),
    undatedExits,
    undatedJoins: undatedJoinCount(rows),
    refresh,
  };
}
