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
import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { fetchGymTrainers, payroll30For, type GymTrainer } from '../lib/gymTrainers';
export type { GymTrainer };
import { reportError } from '../lib/reportError';
import { useTenant } from './tenant';


interface TrainersValue {
  trainers: GymTrainer[];
  loading: boolean;
  /** Sessions delivered across the gym in the last 30 days. */
  sessions30: number;
  /**
   * What those sessions are worth at the tenant's session fee, or null when no
   * fee is set — an unpriced session has no value we can honestly state.
   */
  payroll30: number | null;
  refresh: () => void;
}

const Ctx = createContext<TrainersValue | null>(null);

export function PlatformTrainersProvider({ children }: { children: ReactNode }) {
  const { tenant } = useTenant();
  const [trainers, setTrainers] = useState<GymTrainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!USE_SUPABASE) { setLoading(false); return; }
    if (!tenant) { setTrainers([]); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const rows = await fetchGymTrainers(supabase, tenant.id);
        if (cancelled) return;
        setTrainers(rows);
      } catch (e) {
        reportError('gymTrainers.load', e);
        if (!cancelled) setTrainers([]);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tenant?.id, tick]);

  const sessions30 = trainers.reduce((a, t) => a + t.sessions30, 0);
  const payroll30 = payroll30For(trainers, tenant?.sessionFee ?? null);

  return (
    <Ctx.Provider value={{ trainers, loading, sessions30, payroll30, refresh }}>{children}</Ctx.Provider>
  );
}

export function usePlatformTrainers(): TrainersValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePlatformTrainers must be used inside <PlatformTrainersProvider>');
  return v;
}
