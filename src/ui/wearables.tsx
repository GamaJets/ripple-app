// Wearables context — the single place the app asks "what did the watch record
// today?" and "is a device connected?". Holds per-provider connection state and
// today's metrics, persists which providers were connected (AsyncStorage), and
// re-syncs available ones on launch.
//
// ── Whether the number on screen is today's ───────────────────────────────
//
// This file had no `LoadStatus` at all, and the whole of what it did about a
// failed sync was one line in a catch: `/* otherwise leave last metrics in
// place */`. Keeping the metrics is right — a WHOOP that could not be reached
// at three o'clock did not un-burn the morning's calories — but it was the only
// thing that happened. The figures went on being rendered as "Active Today"
// with nothing anywhere saying they were four hours old and had stopped moving,
// and the member's own evidence for the failure (the burn not going up) is
// indistinguishable from a quiet afternoon.
//
// So each provider now carries the vocabulary src/ui/loadStatus.ts exists for,
// and `todayStatus` is the whole row's answer: 'error' means what is on screen
// is the last thing we had, not a current reading. Nothing is withheld and no
// figure changes — the only thing added is the ability of a screen to say which
// of the two it is looking at, which is the one thing it could not do.
import { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { PROVIDERS, providerById } from '../lib/wearables/registry';
import type { ConnectionState, DailyMetrics, ProviderId } from '../lib/wearables/types';
import { WearableNotConnectedError } from '../lib/wearables/oauth';
import { reportError } from '../lib/reportError';
import { worstStatus, type LoadStatus } from './loadStatus';

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
  /**
   * Per provider: is what is in `metrics` for it a CURRENT reading?
   *
   *   'loading' — connected, and its first read has not come back yet.
   *   'ready'   — the provider answered. Whatever is in `metrics` is today's.
   *   'error'   — the read failed. `metrics` still holds the last figures we
   *               had, which are real and are not current.
   *
   * There is no 'partial' here: a provider returns one day's roll-up or it does
   * not, and there is no row cap to be truncated by.
   */
  syncStatus: Record<string, LoadStatus>;
  /** The same question about the whole `today` row — the least trustworthy of
   *  the connected providers, per `worstStatus`. A screen printing a figure off
   *  `today` should say so when this is not 'ready'. */
  todayStatus: LoadStatus;
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
  /**
   * Which device each figure on `today` actually came from — the provider id,
   * or null where there is no figure.
   *
   * Every field above picks ONE device's number, and the screen that renders
   * them names the device beside each one. It had no way to ask which, so
   * app/(client)/devices.tsx named the first CONNECTED provider that published
   * the field — and `appleHealth` is element zero of the registry, so a member
   * wearing an Apple Watch in the day and a WHOOP overnight saw WHOOP's figure
   * attributed to the Apple Watch. They open Apple Health, find a different
   * number, and stop believing the screen — which is the exact failure the
   * `Math.max` note below was written to end, arriving one line later. The
   * figure was honest and the sentence beside it was not.
   */
  todayFrom: { activeKcal: string | null; totalKcal: string | null; steps: string | null; heartRateAvg: string | null; heartRateLatest: string | null };
}

const Ctx = createContext<Value | null>(null);

export function WearablesProvider({ children }: { children: ReactNode }) {
  const [states, setStates] = useState<Record<string, ConnectionState>>({});
  const [metrics, setMetrics] = useState<Record<string, DailyMetrics | null>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [lastSync, setLastSync] = useState<Record<string, number>>({});
  const [syncStatus, setSyncStatus] = useState<Record<string, LoadStatus>>({});

  const setState = (id: string, s: ConnectionState) => setStates((p) => ({ ...p, [id]: s }));
  const setBusyFor = (id: string, b: boolean) => setBusy((p) => ({ ...p, [id]: b }));
  const setStatusFor = (id: string, s: LoadStatus) => setSyncStatus((p) => ({ ...p, [id]: s }));

  const sync = useCallback(async (id: ProviderId) => {
    const p = providerById(id);
    if (!p || !p.isAvailable()) return;
    setBusyFor(id, true);
    // 'loading' only on the FIRST read. A sixty-second refresh that re-enters
    // this would otherwise flip a screen's whole row back to "still reading"
    // every minute, over figures that are already on it.
    setSyncStatus((prev) => (prev[id] ? prev : { ...prev, [id]: 'loading' }));
    try {
      const m = await p.fetchToday();
      setMetrics((prev) => ({ ...prev, [id]: m }));
      setLastSync((prev) => ({ ...prev, [id]: Date.now() }));
      setStatusFor(id, 'ready');
    } catch (e) {
      if (e instanceof WearableNotConnectedError) {
        // The server has no usable token. Stop showing this as connected —
        // otherwise the UI reads "connected" forever while nothing works.
        //
        // 'ready' rather than 'error', and the difference matters: this is a
        // read that SUCCEEDED in telling us something. The device is not
        // connected, its metrics are cleared, and it drops out of the roll-up
        // below because that only counts connected providers — so there is no
        // stale figure left over for a status to warn about.
        setState(id, 'disconnected');
        setMetrics((prev) => ({ ...prev, [id]: null }));
        setStatusFor(id, 'ready');
        forgetRemembered(id).catch(() => {});
      } else {
        // The metrics stay, and that is deliberate: a watch that could not be
        // reached at three o'clock did not un-burn the morning's calories. What
        // is added is the admission that they are the last ones we had — see
        // the header. Without it "Active Today" reads as a live figure that has
        // simply stopped going up, which is what a quiet afternoon looks like
        // too.
        setStatusFor(id, 'error');
      }
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
    // A failed disconnect is not a disconnect, and everything below this line
    // acts as though it were one: the state goes to 'disconnected', the metrics
    // are cleared and the measured nights are deleted. That was survivable
    // while `disconnectVendor` could not tell anybody it had failed — it could
    // not, because supabase-js resolves on a database error and the delete's
    // `error` was never read — and it stopped being survivable the moment it
    // could. A member refused by the server was shown Disconnected over a token
    // that was still on their account, and since launch asks the SERVER first,
    // the watch came back the next morning.
    //
    // Rethrown rather than reported, so the screen can say so. Nothing here
    // runs on the way out: the sleep this device measured is deleted a few
    // lines down and is not recoverable, and deleting it over a connection that
    // is still live would take the nights AND leave the watch.
    if (p) {
      try {
        await p.disconnect();
      } catch (e) {
        reportError('wearables.disconnect', e, { provider: id });
        throw e;
      }
    }
    setState(id, 'disconnected');
    setMetrics((prev) => ({ ...prev, [id]: null }));
    // Cleared, not left at whatever the last read said. A device that has been
    // unplugged deliberately is not a device whose read failed, and a stale
    // 'error' here would put a warning about missing figures on a row the
    // member has just chosen to empty.
    setSyncStatus((prev) => { const next = { ...prev }; delete next[id]; return next; });
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

  // ── `today` and `todayFrom`, memoised ─────────────────────────────────────
  //
  // Everything in this block is a pure function of `states` and `metrics`, and
  // both objects used to be rebuilt on every render of this provider. That put
  // two fresh objects into the context value every time anything at all
  // changed, which is the defect src/ui/roster.tsx documents at length: a
  // consumer that keys an effect on the whole context value can then never
  // settle. Keyed on their real inputs, the pair changes identity exactly when
  // a device has answered — which is the only moment either figure can move.
  const { today, todayFrom } = useMemo(() => {
    // The connected providers WITH their ids, so a figure can say which device it
    // came from. It used to be the metrics alone, which is why nothing
    // downstream could answer that question and the screen guessed.
    const connectedPairs = PROVIDERS
      .filter((p) => states[p.meta.id] === 'connected')
      .map((p) => ({ id: p.meta.id as string, m: metrics[p.meta.id] }))
      .filter((x): x is { id: string; m: DailyMetrics } => !!x.m);
    const connectedMetrics = connectedPairs.map((x) => x.m);

    const pick = (key: keyof DailyMetrics) => {
      const vals = connectedMetrics.map((m) => m[key]).filter((v) => typeof v === 'number') as number[];
      return vals.length ? vals : null;
    };
    /** The highest value for this field and the device that reported it. Ties go
     *  to the first in registry order, which is stable and arbitrary — but the id
     *  it returns is always a device that really published that number. */
    const highest = (key: keyof DailyMetrics): { v: number; id: string } | null => {
      let best: { v: number; id: string } | null = null;
      for (const { id, m } of connectedPairs) {
        const v = m[key];
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        if (!best || v > best.v) best = { v, id };
      }
      return best;
    };
    const kcals = pick('activeKcal');
    const totals = pick('totalKcal');
    const steps = pick('steps');
    const hrs = pick('heartRateAvg');
    const hrl = pick('heartRateLatest');
    const kcalTop = highest('activeKcal');
    const totalTop = highest('totalKcal');
    const stepTop = highest('steps');
    const hrTop = highest('heartRateAvg');
    // The LAST reading rather than the highest, so its source is the last device
    // in the list that published one — the same one `heartRateLatest` takes.
    const hrlLast = (() => {
      let last: string | null = null;
      for (const { id, m } of connectedPairs) if (typeof m.heartRateLatest === 'number') last = id;
      return last;
    })();
    const today = {
      activeKcal: kcals ? Math.max(...kcals) : null,
      // Kept apart from activeKcal rather than folded into it. WHOOP publishes
      // only this one, and storing it as "active" is what put 1,309 kcal of
      // mostly-resting energy on a screen that meant exercise.
      totalKcal: totals ? Math.max(...totals) : null,
      steps: steps ? Math.max(...steps) : null,
      // One device's figure, like every other field on this row — NOT the mean of
      // two.
      //
      // This line used to average them, and app/(client)/devices.tsx renders the
      // result four rows under a paragraph promising the opposite: "Where two
      // disagree, Recovery shows the figure one device actually reported and
      // names it — it never averages them into a number no device recorded." A
      // member wearing an Apple Watch all day and a WHOOP overnight was shown a
      // day's average heart rate that neither had measured and neither app would
      // agree with, on the screen whose whole job is explaining where the figures
      // come from.
      //
      // `Math.max`, for the same reason steps and calories take it: two devices
      // measuring the same body disagree mostly by COVERAGE — the one that was on
      // the wrist through the session recorded the session, the one in a drawer
      // recorded the drawer — so the higher figure is the more complete
      // measurement rather than the more flattering one. And whatever else is
      // true of it, it is a number a device really reported.
      heartRateAvg: hrs ? Math.round(Math.max(...hrs)) : null,
      heartRateLatest: hrl && hrl.length ? Math.round(hrl[hrl.length - 1]) : null,
    };
    // Computed from the same pass that chose each figure, so the name beside a
    // number and the number cannot come from two different devices.
    const todayFrom = {
      activeKcal: kcalTop?.id ?? null,
      totalKcal: totalTop?.id ?? null,
      steps: stepTop?.id ?? null,
      heartRateAvg: hrTop?.id ?? null,
      heartRateLatest: hrlLast,
    };
    return { today, todayFrom };
  }, [states, metrics]);

  // How much of that row is current. A provider that is connected and has never
  // answered is 'loading' rather than absent, because a roll-up missing one of
  // three devices is not a whole answer either — and `worstStatus` puts
  // 'loading' ahead of the rest for exactly that reason.
  const todayStatus = useMemo(() => {
    const live = PROVIDERS.filter((p) => states[p.meta.id] === 'connected');
    if (!live.length) return 'ready' as LoadStatus;
    return worstStatus(...live.map((p) => syncStatus[p.meta.id] ?? 'loading'));
  }, [states, syncStatus]);

  // Memoised, not an inline literal. See the long note in src/ui/roster.tsx
  // (search "handed out through a ref"): a provider that hands out
  // `value={{ … }}` returns a different object on every render, and a consumer
  // that keys an effect on it — `useFocusEffect(useCallback(() => { x.reload();
  // }, [x]))` — builds a read loop that cannot settle. Everything below is
  // already stable for the life of the provider, so the value changes identity
  // only when something a consumer can actually see has changed.
  const value = useMemo<Value>(() => ({ states, metrics, busy, lastSync, syncStatus, todayStatus, connect, disconnect, sync, syncAll, today, todayFrom, liveMode, setLiveMode }), [states, metrics, busy, lastSync, syncStatus, todayStatus, connect, disconnect, sync, syncAll, today, todayFrom, liveMode, setLiveMode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWearables(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWearables must be used inside <WearablesProvider>');
  return v;
}
