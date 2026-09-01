// Wearables context — the single place the app asks "what did the watch record
// today?" and "is a device connected?". Holds per-provider connection state and
// today's metrics, persists which providers were connected (AsyncStorage), and
// re-syncs available ones on launch.
import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { PROVIDERS, providerById } from '../lib/wearables/registry';
import type { ConnectionState, DailyMetrics, ProviderId } from '../lib/wearables/types';
import { WearableNotConnectedError } from '../lib/wearables/oauth';
import { reportError } from '../lib/reportError';

const STORE_KEY = 'repple.wearables.connected';

/** Drop a provider from the remembered-connections list in AsyncStorage. */
async function forgetRemembered(id: string): Promise<void> {
  try {
    const remembered = await AsyncStorage.getItem(STORE_KEY);
    const set = new Set<string>(remembered ? JSON.parse(remembered) : []);
    set.delete(id);
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify([...set]));
  } catch { /* best effort */ }
}

interface Value {
  states: Record<string, ConnectionState>;
  metrics: Record<string, DailyMetrics | null>;
  busy: Record<string, boolean>;
  lastSync: Record<string, number>;
  connect: (id: ProviderId) => Promise<void>;
  disconnect: (id: ProviderId) => Promise<void>;
  sync: (id: ProviderId) => Promise<void>;
  /** Turn on fast (5s) polling of local sources while a workout is running. */
  liveMode: boolean;
  setLiveMode: (on: boolean) => void;
  /** Re-sync every connected+available provider now (used by the live workout view). */
  syncAll: () => void;
  /** Combined "today" roll-up across every connected device (for the dashboard). */
  today: { activeKcal: number | null; totalKcal: number | null; steps: number | null; heartRateAvg: number | null; heartRateLatest: number | null };
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
    } catch (e) {
      if (e instanceof WearableNotConnectedError) {
        // The server has no usable token. Stop showing this as connected —
        // otherwise the UI reads "connected" forever while nothing works.
        setState(id, 'disconnected');
        setMetrics((prev) => ({ ...prev, [id]: null }));
        forgetRemembered(id).catch(() => {});
      }
      /* otherwise leave last metrics in place */
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
    if (p) { try { await p.disconnect(); } catch (e) { reportError('wearables.disconnect', e, { provider: id }); } }
    setState(id, 'disconnected');
    setMetrics((prev) => ({ ...prev, [id]: null }));
    await forgetRemembered(id);
    // The sleep this device measured goes with it.
    //
    // `device_sleep_nights` (part 153) keeps measured nights so readiness
    // survives a failed read, and the price of keeping them is that
    // disconnecting a watch has to actually remove what it told us — otherwise
    // "disconnect" means the readings keep feeding the home screen from a
    // device the client believes they have unplugged.
    //
    // Deliberately only on an EXPLICIT disconnect. `sync()` above also sets
    // 'disconnected' when the server has no usable token, and a WHOOP whose
    // token expired overnight is the single case this table was built to
    // protect; deleting there would throw away the week for the exact failure
    // the storage exists to survive.
    if (USE_SUPABASE) {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const uid = sess?.session?.user?.id;
        if (uid) {
          // Zero rows is success here, not silence: a member who connected a
          // watch this morning and disconnected it before any night was stored
          // has nothing to delete. That is the one case where the rule in
          // src/lib/wroteRows.ts does not apply, so it is said rather than
          // left looking like an oversight.
          const { error } = await supabase.from('device_sleep_nights')
            .delete().eq('user_id', uid).eq('provider', id);
          if (error) reportError('wearables.forgetSleep', error, { provider: id });
        }
      } catch (e) { reportError('wearables.forgetSleep', e, { provider: id }); }
    }
  }, []);

  // On launch: restore connections and sync the ones that can run here.
  //
  // ── The server is asked FIRST, and it is the one that knows ───────────────
  //
  // A connection is a row in wearable_tokens keyed by user_id: it belongs to
  // the ACCOUNT. AsyncStorage belongs to the HANDSET. Restoring from the
  // handset alone meant a client who connected WHOOP on their phone and then
  // reinstalled, changed device or took a new build opened Recovery to "No
  // device connected" — while the server held a live, unexpired token. Every
  // sleep read was then skipped, because the reader deliberately never asks a
  // provider it believes is disconnected. That is the whole bug: the token was
  // fine and the app had forgotten it was there.
  //
  // my_wearable_providers() returns names and expiry only, never token
  // material — the client has no business reading its own OAuth tokens, and
  // this is a question about which devices exist, not about their secrets.
  //
  // The two sources are UNIONED rather than the server replacing local. A
  // provider that runs on the handset itself (HealthKit) has no server row at
  // all, so taking the server as the whole truth would disconnect it.
  useEffect(() => {
    (async () => {
      const ids = new Set<string>();
      try {
        const remembered = await AsyncStorage.getItem(STORE_KEY);
        for (const id of (remembered ? JSON.parse(remembered) : []) as string[]) ids.add(id);
      } catch {
        // no-error-ok: an unreadable cache is not a reason to ignore the
        // server, which is the better answer anyway.
      }
      try {
        const { data, error } = await supabase.rpc('my_wearable_providers');
        if (error) {
          // Not a reason to forget what the handset remembers. Reported rather
          // than swallowed, because silently falling back to local is how this
          // bug looked from the outside for weeks.
          reportError('wearables.restore.rpc', error);
        } else if (Array.isArray(data)) {
          for (const row of data) {
            const id = String((row as any)?.provider || '');
            if (id) ids.add(id);
          }
          // Write the server's answer back, so the next launch is right even
          // offline.
          try { await AsyncStorage.setItem(STORE_KEY, JSON.stringify([...ids])); } catch { /* cache only */ }
        }
      } catch (e) {
        reportError('wearables.restore.rpc', e);
      }
      for (const id of ids) {
        const p = providerById(id as ProviderId);
        if (!p) continue;
        setState(id, 'connected');
        if (p.isAvailable()) sync(id as ProviderId);
      }
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
  // Refresh cadence. This used to be a flat 60s for everything, which is both too
  // slow to watch your heart rate move during a session and pointlessly fast when
  // the app is just sitting open.
  //
  // The right interval depends on the SOURCE, not on us:
  //   Apple Watch / HealthKit  local reads, no quota — poll fast while training
  //   WHOOP / Oura / Fitbit    cloud APIs with rate limits, and they only return
  //                            day-level aggregates anyway, so a fast poll would
  //                            burn quota to fetch the identical number. WHOOP's
  //                            limit is 100 req/min; 60s keeps us nowhere near it.
  const [liveMode, setLiveMode] = useState(false);
  useEffect(() => {
    const localOnly = () => {
      for (const p of PROVIDERS) {
        if (statesRef.current[p.meta.id] !== 'connected' || !p.isAvailable()) continue;
        if (p.meta.kind === 'healthkit' || p.meta.kind === 'health-connect') sync(p.meta.id as ProviderId);
      }
    };
    if (liveMode) {
      // During a workout: local sources every 5s, cloud sources still every 60s.
      const fast = setInterval(localOnly, 5000);
      const slow = setInterval(() => { syncAll(); }, 60000);
      return () => { clearInterval(fast); clearInterval(slow); };
    }
    const timer = setInterval(() => { syncAll(); }, 60000);
    return () => clearInterval(timer);
  }, [syncAll, sync, liveMode]);

  const connectedMetrics = PROVIDERS
    .filter((p) => states[p.meta.id] === 'connected')
    .map((p) => metrics[p.meta.id])
    .filter(Boolean) as DailyMetrics[];

  const pick = (key: keyof DailyMetrics) => {
    const vals = connectedMetrics.map((m) => m[key]).filter((v) => typeof v === 'number') as number[];
    return vals.length ? vals : null;
  };
  const kcals = pick('activeKcal');
  const totals = pick('totalKcal');
  const steps = pick('steps');
  const hrs = pick('heartRateAvg');
  const hrl = pick('heartRateLatest');
  const today = {
    activeKcal: kcals ? Math.max(...kcals) : null,
    // Kept apart from activeKcal rather than folded into it. WHOOP publishes
    // only this one, and storing it as "active" is what put 1,309 kcal of
    // mostly-resting energy on a screen that meant exercise.
    totalKcal: totals ? Math.max(...totals) : null,
    steps: steps ? Math.max(...steps) : null,
    heartRateAvg: hrs ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
    heartRateLatest: hrl && hrl.length ? Math.round(hrl[hrl.length - 1]) : null,
  };

  return <Ctx.Provider value={{ states, metrics, busy, lastSync, connect, disconnect, sync, syncAll, today, liveMode, setLiveMode }}>{children}</Ctx.Provider>;
}

export function useWearables(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWearables must be used inside <WearablesProvider>');
  return v;
}
