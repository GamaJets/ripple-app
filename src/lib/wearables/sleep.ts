// Ask every connected device about sleep (TF-01).
//
// This is the one path. Before it, sleep on the Recovery screen came from a
// single hard-coded place — the hours the client typed in — and nothing in the
// wearables layer read sleep at all, so somebody wearing a watch and a ring saw
// neither of them. This walks the registry instead of naming a provider, so a
// device that gains a sleep reader later is included the day it does, with no
// screen to change.
//
// Two things it refuses to do, both of them regressions this codebase has
// shipped before:
//
//   · It never turns a failure into an empty list. A provider that throws
//     comes back as status 'error', which the merge turns into an UNKNOWN
//     night rather than a night of no sleep (src/ui/loadStatus.ts).
//   · It never asks a provider that is not connected. Opening a screen used to
//     fire the wearable-day function for WHOOP, Oura, Fitbit and Garmin alike,
//     three pointless round trips a visit for vendors with no stored token.
import { PROVIDERS } from './registry';
import type { ConnectionState, ProviderId } from './types';
import type { SleepRead } from '../sleepMerge';
import { WearableNotConnectedError } from './oauth';
import { reportError } from '../reportError';

/** Providers the client has connected, in registry (display) order. */
export function connectedProviders(states: Record<string, ConnectionState>) {
  return PROVIDERS.filter((p) => states[p.meta.id] === 'connected');
}

/**
 * Every connected provider's answer for the last `sinceDays` nights, one entry
 * per provider — including the ones that could not answer, because a screen
 * that only receives the successes cannot tell the client what it does not
 * know. Order matches the registry so the UI is stable between reads.
 */
export async function readSleepFromDevices(
  states: Record<string, ConnectionState>,
  sinceDays = 7,
): Promise<SleepRead[]> {
  const connected = connectedProviders(states);
  return Promise.all(connected.map(async (p): Promise<SleepRead> => {
    const id = p.meta.id as ProviderId;
    const fetchSleep = p.fetchSleep?.bind(p);
    if (!fetchSleep) {
      return { provider: id, status: 'unsupported', readings: [], reason: `${p.meta.name} does not report sleep.` };
    }
    // A provider that cannot run in this binary at all — HealthKit outside a
    // real build — has not failed to read; there was nothing to read it with.
    if (!p.isAvailable()) {
      return { provider: id, status: 'unsupported', readings: [], reason: p.unavailableReason() ?? `${p.meta.name} is not available on this device.` };
    }
    try {
      return await fetchSleep(sinceDays);
    } catch (e) {
      // A dead token is still an error for THIS read: we do not know what the
      // client slept. Clearing the connection is the wearables context's job on
      // its own sync, not a side effect of drawing a sleep list.
      const reason = e instanceof WearableNotConnectedError
        ? `${p.meta.name} needs reconnecting — Repple no longer has permission to read it.`
        : `${p.meta.name} could not be read just now. This is our end, not your device.`;
      reportError('wearables.fetchSleep', e, { provider: id });
      return { provider: id, status: 'error', readings: [], reason };
    }
  }));
}
