// Wearables context — the single place the app asks "what did the watch record
// today?" and "is a device connected?". Holds per-provider connection state and
// today's metrics, persists which providers were connected (AsyncStorage), and
// re-syncs available ones on launch.
import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PROVIDERS, providerById } from '../lib/wearables/registry';
import type { ConnectionState, DailyMetrics, ProviderId } from '../lib/wearables/types';

const STORE_KEY = 'repple.wearables.connected';

interface Value {
  states: Record<string, ConnectionState>;
  metrics: Record<string, DailyMetrics | null>;
  busy: Record<string, boolean>;
  lastSync: Record<string, number>;
  connect: (id: ProviderId) => Promise<void>;
  disconnect: (id: ProviderId) => Promise<void>;
  sync: (id: ProviderId) => Promise<void>;
  /** Re-sync every connected+available provider now (used by the live workout view). */
  syncAll: () => void;
  /** Combined "today" roll-up across every connected device (for the dashboard). */
  today: { activeKcal: number | null; steps: number | null; heartRateAvg: number | null; heartRateLatest: number | null };
}

const Ctx = createContext<Value | null>(null);

export function WearablesProvider({ children }: { children: ReactNode }) {
  const [states, setStates] = useState<Record<string, ConnectionState>>({});
  const [metrics, setMetrics] = useState<Record<string, DailyMetrics | null>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [lastSync, setLastSync] = useState<Record<string, number>>({});

  const setState = (id: string, s: ConnectionState) => setStates((p) => ({ ...p, [id]: s }));
  const setBusyFor = (id: string, b: boolean) => setBusy((p) => ({ ...p, [id]: b }));

  const sync = useCallback(async (id: ProviderId) => {
    const p = providerById(id);
    if (!p || !p.isAvailable()) return;
    setBusyFor(id, true);
    try {
      const m = await p.fetchToday();
      setMetrics((prev) => ({ ...prev, [id]: m }));
      setLastSync((prev) => ({ ...prev, [id]: Date.now() }));
    } catch {
      /* leave last metrics in place */
    } finally {
      setBusyFor(id, false);
    }
  }, []);

  const connect = useCallback(async (id: ProviderId) => {
    const p = providerById(id);
    if (!p) return;
    setState(id, 'connecting');
    setBusyFor(id, true);
    try {
      await p.connect();
      setState(id, 'connected');
      const remembered = await AsyncStorage.getItem(STORE_KEY);
      const set = new Set<string>(remembered ? JSON.parse(remembered) : []);
      set.add(id);
      await AsyncStorage.setItem(STORE_KEY, JSON.stringify([...set]));
      await sync(id);
    } catch (e: any) {
      setState(id, 'error');
      throw e; // let the screen surface the message
    } finally {
      setBusyFor(id, false);
    }
  }, [sync]);

  const disconnect = useCallback(async (id: ProviderId) => {
    const p = providerById(id);
    if (p) { try { await p.disconnect(); } catch {} }
    setState(id, 'disconnected');
    setMetrics((prev) => ({ ...prev, [id]: null }));
    const remembered = await AsyncStorage.getItem(STORE_KEY);
    const set = new Set<string>(remembered ? JSON.parse(remembered) : []);
    set.delete(id);
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify([...set]));
  }, []);

  // On launch: restore remembered connections and sync the ones that can run here.
  useEffect(() => {
    (async () => {
      try {
        const remembered = await AsyncStorage.getItem(STORE_KEY);
        const ids: string[] = remembered ? JSON.parse(remembered) : [];
        for (const id of ids) {
          const p = providerById(id as ProviderId);
          if (!p) continue;
          setState(id, 'connected');
          if (p.isAvailable()) sync(id as ProviderId);
        }
      } catch {}
    })();
  }, [sync]);

  // Auto-refresh connected devices so Live Today updates on its own.
  const statesRef = useRef(states);
  useEffect(() => { statesRef.current = states; }, [states]);
  const syncAll = useCallback(() => {
    for (const p of PROVIDERS) {
      if (statesRef.current[p.meta.id] === 'connected' && p.isAvailable()) sync(p.meta.id as ProviderId);
    }
  }, [sync]);
  useEffect(() => {
    const timer = setInterval(() => { syncAll(); }, 60000);
    return () => clearInterval(timer);
  }, [syncAll]);

  const connectedMetrics = PROVIDERS
    .filter((p) => states[p.meta.id] === 'connected')
    .map((p) => metrics[p.meta.id])
    .filter(Boolean) as DailyMetrics[];

  const pick = (key: keyof DailyMetrics) => {
    const vals = connectedMetrics.map((m) => m[key]).filter((v) => typeof v === 'number') as number[];
    return vals.length ? vals : null;
  };
  const kcals = pick('activeKcal');
  const steps = pick('steps');
  const hrs = pick('heartRateAvg');
  const hrl = pick('heartRateLatest');
  const today = {
    activeKcal: kcals ? kcals.reduce((a, b) => a + b, 0) : null,
    steps: steps ? Math.max(...steps) : null,
    heartRateAvg: hrs ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
    heartRateLatest: hrl && hrl.length ? Math.round(hrl[hrl.length - 1]) : null,
  };

  return <Ctx.Provider value={{ states, metrics, busy, lastSync, connect, disconnect, sync, syncAll, today }}>{children}</Ctx.Provider>;
}

export function useWearables(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWearables must be used inside <WearablesProvider>');
  return v;
}
