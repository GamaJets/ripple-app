// Coach nutrition adjustments — a trainer's tweak to a client's macro targets
// (calorie + protein deltas + note). Persists to Supabase `coach_nutrition`
// (coach writes; client reads own) with a defensive in-memory fallback.
//
// `get()` returning null means "no coach adjustment", and the client's macro
// targets are then computed from the generic formula. When the read below failed
// it returned null for the same reason it returns null for an unadjusted client,
// so a client whose coach had cut them 400 kcal was quietly handed the
// uncorrected targets and ate to them. `status` is how a screen tells the two
// apart before presenting a number as their coach's instruction.
//
// The write was worse than fire-and-forget: it was a nested pair of writes where
// the SECOND (carbs, fat, meal override) only ran inside the first's success
// handler, and neither read `error`. A coach could adjust a client's macros,
// watch the screen confirm it, and have nothing reach the client at all.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { CoachAdjust } from '../lib/nutrition';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { LoadStatus } from './loadStatus';
import { useAuthRevision } from './authRevision';

export interface NutritionAdjust extends CoachAdjust { note?: string; mealOverride?: Record<number, number> }

interface CoachNutritionValue {
  get: (clientId: string) => NutritionAdjust | null;
  /** Whether the adjustments were read from the server. Under 'error' a null
   *  from get() means unknown, and the generic targets must not be presented
   *  as the coach's plan. */
  status: LoadStatus;
  /** Resolves true only when the adjustment reached the server, where the
   *  client's app will read it. False means the coach changed nothing for them. */
  setAdjust: (clientId: string, patch: Partial<NutritionAdjust>) => Promise<boolean>;
  /** Resolves true only when the adjustment was actually removed server-side. */
  clear: (clientId: string) => Promise<boolean>;
}

const Ctx = createContext<CoachNutritionValue | null>(null);

export function CoachNutritionProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  const [map, setMap] = useState<Record<string, NutritionAdjust>>({});
  const [uid, setUid] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        // No session is a true answer, not a failed check. getUser() REJECTS
        // when nobody is signed in, and treating that as an error latched this
        // provider into 'error' on the first tick — before anybody had signed
        // in — where it stayed, because the effect never ran a second time.
        const { data: sess } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!sess?.session) { setStatus('ready'); return; }
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (cancelled) return;
        if (authErr) { setStatus('error'); return; }
        const id = auth?.user?.id;
        if (!id) { setStatus('ready'); return; }
        setUid(id);
        // `const { data } = …` — `error` was not even named, so a refused read
        // was indistinguishable from a client with no adjustment.
        const { data, error } = await supabase.from('coach_nutrition').select('*').or('client_id.eq.' + id + ',coach_id.eq.' + id);
        if (cancelled) return;
        if (error) { setStatus('error'); return; }
        const m: Record<string, NutritionAdjust> = {};
        for (const r of (data ?? []) as any[]) m[r.client_id] = { kcalDelta: r.kcal_delta ?? 0, proteinDelta: r.protein_delta ?? 0, carbDelta: r.carb_delta ?? 0, fatDelta: r.fat_delta ?? 0, note: r.note ?? undefined, mealOverride: r.meal_override ?? undefined };
        if (Object.keys(m).length) setMap((prev) => ({ ...prev, ...m }));
        setStatus('ready');
      } catch { if (!cancelled) setStatus('error'); /* stay in-memory, but say so */ }
    })();
    return () => { cancelled = true; };
  }, [authRev]);

  const get = (clientId: string) => map[clientId] ?? null;
  const setAdjust = async (clientId: string, patch: Partial<NutritionAdjust>): Promise<boolean> => {
    const merged: NutritionAdjust = { kcalDelta: 0, proteinDelta: 0, carbDelta: 0, fatDelta: 0, ...(map[clientId] ?? {}), ...patch };
    setMap((m) => ({ ...m, [clientId]: merged }));
    if (!USE_SUPABASE || !uid) return false;
    try {
      const { error } = await supabase.from('coach_nutrition').upsert({ client_id: clientId, coach_id: uid, kcal_delta: merged.kcalDelta, protein_delta: merged.proteinDelta, note: merged.note ?? null }, { onConflict: 'client_id' });
      if (error) return false;
      // The second write is still separate (these columns were added out of
      // band), but it is now awaited and checked rather than fired from inside
      // the first one's success callback. A half-applied adjustment — calories
      // cut but the carb split unchanged — is not something to report as done.
      const { error: mErr } = await supabase.from('coach_nutrition').update({ carb_delta: merged.carbDelta ?? 0, fat_delta: merged.fatDelta ?? 0, meal_override: merged.mealOverride ?? null }).eq('client_id', clientId);
      return !mErr;
    } catch { return false; }
  };
  const clear = async (clientId: string): Promise<boolean> => {
    setMap((m) => { const n = { ...m }; delete n[clientId]; return n; });
    if (!USE_SUPABASE || !uid) return false;
    try {
      const { error } = await supabase.from('coach_nutrition').delete().eq('client_id', clientId);
      return !error;
    } catch { return false; }
  };

  return <Ctx.Provider value={{ get, status, setAdjust, clear }}>{children}</Ctx.Provider>;
}

export function useCoachNutrition(): CoachNutritionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCoachNutrition must be used inside <CoachNutritionProvider>');
  return v;
}
