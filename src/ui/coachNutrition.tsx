// Coach nutrition adjustments — a trainer's tweak to a client's macro targets
// (calorie + protein deltas + note). Persists to Supabase `coach_nutrition`
// (coach writes; client reads own) with a defensive in-memory fallback.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { CoachAdjust } from '../lib/nutrition';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';

export interface NutritionAdjust extends CoachAdjust { note?: string }

interface CoachNutritionValue {
  get: (clientId: string) => NutritionAdjust | null;
  setAdjust: (clientId: string, patch: Partial<NutritionAdjust>) => void;
  clear: (clientId: string) => void;
}

const Ctx = createContext<CoachNutritionValue | null>(null);

export function CoachNutritionProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Record<string, NutritionAdjust>>({});
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const id = auth?.user?.id; if (!id || cancelled) return; setUid(id);
        const { data } = await supabase.from('coach_nutrition').select('*').or('client_id.eq.' + id + ',coach_id.eq.' + id);
        if (cancelled || !data) return;
        const m: Record<string, NutritionAdjust> = {};
        for (const r of data as any[]) m[r.client_id] = { kcalDelta: r.kcal_delta ?? 0, proteinDelta: r.protein_delta ?? 0, carbDelta: r.carb_delta ?? 0, fatDelta: r.fat_delta ?? 0, note: r.note ?? undefined };
        if (Object.keys(m).length) setMap((prev) => ({ ...prev, ...m }));
      } catch { /* stay in-memory */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const get = (clientId: string) => map[clientId] ?? null;
  const setAdjust = (clientId: string, patch: Partial<NutritionAdjust>) => {
    const merged: NutritionAdjust = { kcalDelta: 0, proteinDelta: 0, carbDelta: 0, fatDelta: 0, ...(map[clientId] ?? {}), ...patch };
    setMap((m) => ({ ...m, [clientId]: merged }));
    if (USE_SUPABASE && uid) {
      try { supabase.from('coach_nutrition').upsert({ client_id: clientId, coach_id: uid, kcal_delta: merged.kcalDelta, protein_delta: merged.proteinDelta, note: merged.note ?? null }, { onConflict: 'client_id' }).then(() => { supabase.from('coach_nutrition').update({ carb_delta: merged.carbDelta ?? 0, fat_delta: merged.fatDelta ?? 0 }).eq('client_id', clientId).then(() => {}, () => {}); }, () => {}); } catch { /* ignore */ }
    }
  };
  const clear = (clientId: string) => {
    setMap((m) => { const n = { ...m }; delete n[clientId]; return n; });
    if (USE_SUPABASE && uid) { try { supabase.from('coach_nutrition').delete().eq('client_id', clientId).then(() => {}, () => {}); } catch { /* ignore */ } }
  };

  return <Ctx.Provider value={{ get, setAdjust, clear }}>{children}</Ctx.Provider>;
}

export function useCoachNutrition(): CoachNutritionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCoachNutrition must be used inside <CoachNutritionProvider>');
  return v;
}
