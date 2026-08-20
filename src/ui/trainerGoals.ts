// Trainer goals — a monthly revenue target and a client-count target the coach
// sets and tracks toward. Persists to AsyncStorage (per device). Self-contained
// hook, no provider needed.
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface TrainerGoals { revenue: number; clients: number }
const KEY = 'repple.trainer.goals';
// Zero means "not set". These used to default to $4,000 and 12 clients and
// render under the heading "Your goals", with a progress arc on the hero, as
// though the trainer had chosen them.
const DEFAULT: TrainerGoals = { revenue: 0, clients: 0 };

export function useTrainerGoals() {
  const [goals, setGoals] = useState<TrainerGoals>(DEFAULT);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try { const raw = await AsyncStorage.getItem(KEY); if (raw) setGoals({ ...DEFAULT, ...JSON.parse(raw) }); } catch { /* ignore */ }
      setLoaded(true);
    })();
  }, []);

  const save = (next: Partial<TrainerGoals>) => {
    const merged = { ...goals, ...next };
    setGoals(merged);
    try { AsyncStorage.setItem(KEY, JSON.stringify(merged)); } catch { /* ignore */ }
  };

  return { goals, setGoals: save, loaded };
}

/** Clamp a progress fraction 0..1. */
export const goalPct = (current: number, goal: number) => (goal > 0 ? Math.max(0, Math.min(1, current / goal)) : 0);
