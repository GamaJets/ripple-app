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
import { reportError } from '../lib/reportError';
import { useTenant } from './tenant';

export interface GymTrainer {
  id: string;
  name: string;
  /** Clients assigned to this trainer, counted from `clients`. */
  clients: number;
  /** Sessions actually delivered in the last 30 days. */
  sessions30: number;
  /** ISO date they joined, or null if the profile has no created_at. */
  since: string | null;
}

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
const DAY = 86400000;

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
        // Trainers in this tenant. RLS (trainers_owner_r) already scopes this to
        // the caller's tenant; the filter makes the intent explicit.
        const { data: trs, error } = await supabase
          .from('trainers').select('id').eq('tenant_id', tenant.id);
        if (error || cancelled) { if (!cancelled) { setTrainers([]); setLoading(false); } return; }
        const ids = (trs ?? []).map((r: any) => r.id);
        if (!ids.length) { setTrainers([]); setLoading(false); return; }

        // Names come from profiles, which the owner may read for their own
        // tenant (profiles_owner_tenant_r).
        const { data: profs } = await supabase
          .from('profiles').select('id, full_name, created_at').in('id', ids);
        const meta = new Map<string, { name: string; since: string | null }>(
          (profs ?? []).map((p: any) => [p.id, { name: (p.full_name || '').trim(), since: p.created_at ?? null }]),
        );

        // Client counts, one query for the whole tenant rather than N queries.
        const { data: cls } = await supabase
          .from('clients').select('trainer_id').in('trainer_id', ids);
        const clientCount = new Map<string, number>();
        (cls ?? []).forEach((c: any) => {
          if (c.trainer_id) clientCount.set(c.trainer_id, (clientCount.get(c.trainer_id) ?? 0) + 1);
        });

        // Sessions delivered: booked and already started. Needs the
        // sessions_owner_r policy — without it this returns nothing and the
        // zero would be a permissions artefact, not a fact about the gym.
        const since = new Date(Date.now() - 30 * DAY).toISOString();
        const { data: sess } = await supabase
          .from('sessions').select('trainer_id')
          .in('trainer_id', ids).eq('status', 'booked').gte('starts_at', since).lte('starts_at', new Date().toISOString());
        const sessionCount = new Map<string, number>();
        (sess ?? []).forEach((s: any) => {
          if (s.trainer_id) sessionCount.set(s.trainer_id, (sessionCount.get(s.trainer_id) ?? 0) + 1);
        });

        if (cancelled) return;
        setTrainers(ids.map((id) => ({
          id,
          name: meta.get(id)?.name || 'Trainer',
          clients: clientCount.get(id) ?? 0,
          sessions30: sessionCount.get(id) ?? 0,
          since: meta.get(id)?.since ?? null,
        })).sort((a, b) => b.clients - a.clients || a.name.localeCompare(b.name)));
      } catch (e) {
        reportError('gymTrainers.load', e);
        if (!cancelled) setTrainers([]);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tenant?.id, tick]);

  const sessions30 = trainers.reduce((a, t) => a + t.sessions30, 0);
  const fee = tenant?.sessionFee ?? null;
  const payroll30 = fee == null ? null : Math.round(sessions30 * fee);

  return (
    <Ctx.Provider value={{ trainers, loading, sessions30, payroll30, refresh }}>{children}</Ctx.Provider>
  );
}

export function usePlatformTrainers(): TrainersValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePlatformTrainers must be used inside <PlatformTrainersProvider>');
  return v;
}
