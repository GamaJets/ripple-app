// Client goal target — a target weight + target date the client works toward.
// Reactive + persisted. The Goal screen reads this plus the weight series to show
// progress and a trend-based projection. Swap for Supabase later.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface GoalTarget { targetWeightKg: number; targetDateISO: string }

interface GoalValue {
  target: GoalTarget;
  setTarget: (patch: Partial<GoalTarget>) => void;
}

const Ctx = createContext<GoalValue | null>(null);

function defaultTarget(): GoalTarget {
  return { targetWeightKg: 64, targetDateISO: new Date(Date.now() + 90 * 86400000).toISOString() };
}

export function GoalTrackerProvider({ children }: { children: ReactNode }) {
  const [target, setTargetState] = useState<GoalTarget>(defaultTarget);
  useEffect(() => { (async () => {
    try { const raw = await AsyncStorage.getItem('repple.goalTarget'); if (raw) setTargetState({ ...defaultTarget(), ...JSON.parse(raw) }); } catch {}
  })(); }, []);
  const setTarget = (patch: Partial<GoalTarget>) => {
    setTargetState((prev) => {
      const next = { ...prev, ...patch };
      AsyncStorage.setItem('repple.goalTarget', JSON.stringify(next)).catch(() => {});
      return next;
    });
  };
  return <Ctx.Provider value={{ target, setTarget }}>{children}</Ctx.Provider>;
}

export function useGoalTracker(): GoalValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useGoalTracker must be used inside <GoalTrackerProvider>');
  return v;
}
