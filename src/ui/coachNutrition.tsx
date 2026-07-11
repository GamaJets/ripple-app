// Coach nutrition adjustments — a trainer's tweak to a client's macro targets
// (calorie + protein deltas, layered on the client's computed target) plus an
// optional note. Reactive so the client's Meals tab + dashboard update live.
// Keyed by clientId. Swap for a Supabase column/table in the data migration.
import { createContext, useContext, useState, type ReactNode } from 'react';
import type { CoachAdjust } from '../lib/nutrition';

export interface NutritionAdjust extends CoachAdjust { note?: string }

interface CoachNutritionValue {
  get: (clientId: string) => NutritionAdjust | null;
  setAdjust: (clientId: string, patch: Partial<NutritionAdjust>) => void;
  clear: (clientId: string) => void;
}

const Ctx = createContext<CoachNutritionValue | null>(null);

export function CoachNutritionProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Record<string, NutritionAdjust>>({});

  const get = (clientId: string) => map[clientId] ?? null;
  const setAdjust = (clientId: string, patch: Partial<NutritionAdjust>) =>
    setMap((m) => ({ ...m, [clientId]: { kcalDelta: 0, proteinDelta: 0, ...(m[clientId] ?? {}), ...patch } }));
  const clear = (clientId: string) =>
    setMap((m) => { const n = { ...m }; delete n[clientId]; return n; });

  return <Ctx.Provider value={{ get, setAdjust, clear }}>{children}</Ctx.Provider>;
}

export function useCoachNutrition(): CoachNutritionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCoachNutrition must be used inside <CoachNutritionProvider>');
  return v;
}
