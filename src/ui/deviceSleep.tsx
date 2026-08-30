// Sleep read from whatever devices a client has connected, for any screen.
//
// ── Why this is shared rather than loaded per screen ───────────────────────
//
// Recovery loaded it inline and was the only screen that did. Home computed
// readiness from the hand-typed wellness log alone, so a client with WHOOP
// connected, the sleep scope granted and a week of nights on record opened the
// app to "Log a night of sleep to see your readiness" while Recovery, one tap
// away, showed those nights. Reported as "whoop is connected and sleep is also
// there. its not updating the repple app."
//
// The fix is not another copy of the loader. Two screens deriving "last night"
// separately is how they come to disagree, which is the bug this codebase keeps
// finding in other shapes — so there is one loader and both read it.
//
// ── The two things this keeps that the inline version had ──────────────────
//
// Both were bugs before they were fixed, and both are easy to lose in an
// extraction:
//
//  · The effect is keyed on WHICH providers are connected, not on the states
//    object. That object is replaced on every 60-second sync, and keying on it
//    re-read the whole week each time.
//  · `linkRev` is the other half of that key. Reconnecting a device that was
//    ALREADY in the list does not change the list, so without it the effect
//    never re-ran and a stale "needs reconnecting" outlived the reconnect that
//    fixed it — reported verbatim as "Reconnected whoop and it says need to
//    connect whoop."
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { readSleepFromDevices, connectedProviders } from '../lib/wearables/sleep';
import { mergeSleepNights, recentNights, type MergedNight, type SleepRead } from '../lib/sleepMerge';
import { useWearables } from './wearables';
import { useLinkRevision } from '../lib/wearableLinkLedger';
import { reportError } from '../lib/reportError';
import type { LoadStatus } from './loadStatus';

/** How far back to read. A week is enough for a readiness average and short
 *  enough that a provider outage does not dominate it. */
export const DEVICE_SLEEP_NIGHTS = 7;

interface DeviceSleepValue {
  /** Per provider, including the ones that could not answer — a screen that
   *  wants to say WHY a night is missing needs the failures, not just the wins. */
  reads: SleepRead[];
  /** One entry per night in the window, newest first. `outcome` says whether
   *  anybody measured it; nothing here is ever inferred. */
  nights: MergedNight[];
  status: LoadStatus;
  /** Re-read now — after a reconnect, or a pull-to-refresh. */
  refresh: () => void;
}

const Ctx = createContext<DeviceSleepValue | null>(null);

export function DeviceSleepProvider({ children }: { children: ReactNode }) {
  const wear = useWearables();
  const linkRev = useLinkRevision();
  const [reads, setReads] = useState<SleepRead[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const next = await readSleepFromDevices(wear.states, DEVICE_SLEEP_NIGHTS);
      setReads(next);
      setStatus('ready');
    } catch (e) {
      // readSleepFromDevices catches per provider, so reaching here means the
      // walk itself broke. Still not an empty night: still unknown.
      reportError('deviceSleep.read', e);
      setReads([]);
      setStatus('error');
    }
  }, [wear.states]);

  const connectedKey = connectedProviders(wear.states).map((p: { meta: { id: string } }) => p.meta.id).join(',');
  useEffect(() => { void load(); }, [connectedKey, linkRev]);

  const nights = useMemo(
    () => mergeSleepNights(reads, recentNights(DEVICE_SLEEP_NIGHTS)),
    [reads],
  );

  return (
    <Ctx.Provider value={{ reads, nights, status, refresh: load }}>{children}</Ctx.Provider>
  );
}

export function useDeviceSleep(): DeviceSleepValue {
  const v = useContext(Ctx);
  // Deliberately not a silent empty default. A screen that reads this outside
  // the provider would render "no sleep recorded" — a statement about the
  // client — rather than failing where the mistake is.
  if (!v) throw new Error('useDeviceSleep must be used inside <DeviceSleepProvider>');
  return v;
}
