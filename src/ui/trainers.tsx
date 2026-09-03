// The gym's trainers — read from Supabase, scoped to the owner's tenant.
//
// This used to seed from a constant, compute MRR into React state and forget
// everything on close. Add a trainer, change their plan, suspend them, relaunch:
// gone. The doc called it "a calculator with amnesia" and it was the reason
// eleven of twelve owner screens touched the database zero times.
//
// `role = 'owner'` means a GYM owner, so the figures here are the gym's, not
// Repple's: who coaches here, how many clients each has, how many sessions they
// actually delivered. Plan and MRR are gone — those are what a trainer pays
// Repple, which is not a number a gym owner has any business seeing on their own
// dashboard.
//
// Every field traces to a row. Where there is nothing to count, the value is 0
// because the query returned nothing — and `loading` is exposed so a screen can
// tell "no trainers" apart from "not asked yet".
//
// "Not asked yet" was only two thirds of it. The catch below set `trainers` to
// `[]` and `loading` to false, which is the same pair of values as a gym that
// genuinely has no trainers on the books — so an owner whose read was refused
// saw an empty roster, a payroll of nothing and zero sessions delivered, all
// presented as this month's figures. `status` is the third state.
import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { fetchGymTrainers, payroll30For, type GymTrainer } from '../lib/gymTrainers';
export type { GymTrainer };
import { reportError } from '../lib/reportError';
import { useTenant } from './tenant';
import { useAuthRevision } from './authRevision';
import type { LoadStatus } from './loadStatus';


interface TrainersValue {
  trainers: GymTrainer[];
  loading: boolean;
  /** Whether `trainers` (and therefore sessions30 and payroll30) is what the
   *  database holds. Under 'error' those figures are zeroes we could not
   *  confirm and must not be shown as the gym's numbers. */
  status: LoadStatus;
  /** Sessions delivered across the gym in the last 30 days. */
  sessions30: number | null;
  /**
   * What those sessions are worth at the tenant's session fee, or null when no
   * fee is set — an unpriced session has no value we can honestly state.
   */
  payroll30: number | null;
  refresh: () => void;
}

const Ctx = createContext<TrainersValue | null>(null);

export function PlatformTrainersProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  const { tenant, status: tenantStatus } = useTenant();
  const [trainers, setTrainers] = useState<GymTrainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!USE_SUPABASE) { setLoading(false); setStatus('ready'); return; }
    // ── "there is no gym" and "we could not read the gym" ────────────────
    //
    // This branch used to look at `tenant` alone and answer 'ready' with an
    // empty list for both. They are not the same fact, and the second one is
    // the failure this whole status exists to prevent: a refused tenant read
    // reached here as "no gym", published an empty roster as WHOLE, and every
    // `trainersUnread` guard downstream passed cleanly.
    //
    // Eight sentences on four owner screens were stated over it — "No trainers
    // yet. Invite one by email", "Sessions Delivered · 30 Days — 0" — each one
    // a claim about a gym nobody could read. The consumers now compute
    // `worstStatus(tenantStatus, trainersStatus)` for themselves; this is the
    // same correction at the source, so a consumer that forgets is no longer
    // told a comfortable lie.
    if (!tenant) {
      setTrainers([]);
      setLoading(false);
      // A gym that could not be read is not a gym with no trainers. Loading
      // stays loading; anything else that produced no tenant is an error here,
      // because with no gym id there is no read to attempt and no way to
      // improve the answer.
      setStatus(tenantStatus === 'loading' ? 'loading' : tenantStatus === 'ready' ? 'ready' : 'error');
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setStatus('loading');
      try {
        const rows = await fetchGymTrainers(supabase, tenant.id);
        if (cancelled) return;
        setTrainers(rows);
        setStatus('ready');
      } catch (e) {
        reportError('gymTrainers.load', e);
        if (!cancelled) { setTrainers([]); setStatus('error'); }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tenant?.id, tenantStatus, tick, authRev]);

  // Both are sums over `trainers`, and on a failed read `trainers` is empty —
  // so both summed to 0 and the owner's screens reported a real number: nought
  // sessions delivered, nought pounds owed. A sum over a list we could not read
  // is not zero, it is unknown, and neither figure may be computed from it.
  const unread = status === 'error';
  const sessions30 = unread ? null : trainers.reduce((a, t) => a + t.sessions30, 0);
  const payroll30 = unread ? null : payroll30For(trainers, tenant?.sessionFee ?? null);

  return (
    <Ctx.Provider value={{ trainers, loading, status, sessions30, payroll30, refresh }}>{children}</Ctx.Provider>
  );
}

export function usePlatformTrainers(): TrainersValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePlatformTrainers must be used inside <PlatformTrainersProvider>');
  return v;
}
