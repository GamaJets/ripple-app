// The one read behind "what does this gym pay for", on the owner's phone.
//
// The impure half of src/lib/ownerPayPolicy.ts, which holds every decision
// about what an empty answer means.
//
// ── Why this is its own read and not a wider `useTenant` ──────────────────
//
// `useTenant` selects id, name, brand colour, plan, session fee, currency and
// the two class-cancellation columns, and it is the read EVERY owner screen in
// this app depends on. `session_pay_policy` is wanted by one section on one
// screen, and src/ui/coachPayTerms.ts already made this exact call for the
// coach's side and wrote down why: widening the shared provider puts a column
// two screens need on the read every screen waits for.
//
// So the same `fetchGymProfile` is used here, for the same column, and the two
// surfaces cannot disagree about what is stored — which is the failure
// gymPolicy.ts's header is about, four screens each holding their own copy of a
// policy nobody had saved.
//
// ── A failed read is not an unset policy ──────────────────────────────────
//
// `fetchGymProfile` keeps `error` apart from the values precisely because
// supabase-js RESOLVES on a database error: taking `data` alone turns a refused
// read into a row of nulls, which this screen would print as "your gym has not
// said what it pays for" to an owner who set it last week. The status carries
// the difference and `policyView` refuses to describe anything that is not a
// whole read.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { fetchGymProfile } from '../lib/gymPolicy';
import { policyView, type GymLink, type PolicyView } from '../lib/coachPayTerms';
import { worstStatus, type LoadStatus } from './loadStatus';
import { useTenant } from './tenant';
import { useAuthRevision } from './authRevision';

export interface GymPayPolicy {
  /** The worse of the tenant read and this one. */
  status: LoadStatus;
  /** Already decided — 'unread', 'no_gym', 'unset' or the stated policy. */
  view: PolicyView;
  refresh: () => void;
}

/**
 * What this gym pays a coach for, for the owner who decides it.
 *
 * Costs no read for an account with no gym: there is no row that could hold a
 * policy, and `policyView` answers 'no_gym' from the link before it looks at
 * one.
 */
export function useGymPayPolicy(): GymPayPolicy {
  const { tenant, status: tenantStatus } = useTenant();
  const authRev = useAuthRevision();
  const [stored, setStored] = useState<string | null>(null);
  const [readStatus, setReadStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [tick, setTick] = useState(0);

  const tenantId = tenant?.id ?? null;

  // 'none' only once the tenant read has ANSWERED. Under 'loading' and 'error'
  // this is 'unknown', which is what stops "this account is not attached to a
  // gym" being printed to an owner whose profile read timed out — the same
  // separation src/ui/coachPayTerms.ts keeps for the coach.
  const link: GymLink = tenantStatus === 'ready'
    ? (tenantId ? 'gym' : 'none')
    : 'unknown';

  const load = useCallback(async (cancelled: () => boolean) => {
    if (!USE_SUPABASE) { setReadStatus('ready'); return; }
    if (!tenantId) {
      // Nothing to read and nothing unknown — with no gym there is no row that
      // could hold a policy. 'ready' only once the tenant read itself has
      // settled, or this would claim an answer it has not got.
      setStored(null);
      setReadStatus(tenantStatus === 'ready' ? 'ready' : 'loading');
      return;
    }
    setReadStatus('loading');
    try {
      const gym = await fetchGymProfile(supabase, tenantId);
      if (cancelled()) return;
      // `error` first and separately from the values. On a refusal the profile
      // is null and reading it first is exactly how a refusal becomes "your gym
      // has not decided what it pays for".
      if (gym.error) { reportError('gymPayPolicy.read', gym.error); setReadStatus('error'); return; }
      setStored(gym.profile?.payPolicy ?? null);
      setReadStatus('ready');
    } catch (e) {
      // A throw out of the fetch is nobody answering, never a policy of none.
      reportError('gymPayPolicy.load', e);
      if (!cancelled()) setReadStatus('error');
    }
  }, [tenantId, tenantStatus]);

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => { cancelled = true; };
  }, [load, authRev, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  const status = worstStatus(tenantStatus, readStatus);

  return useMemo<GymPayPolicy>(() => ({
    status,
    view: policyView(link, status, stored),
    refresh,
  }), [status, link, stored, refresh]);
}
