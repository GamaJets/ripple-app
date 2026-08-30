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
import { linkFor, noteMetric } from '../wearableLinkLedger';
import { reportError } from '../reportError';

/**
 * Providers the client has connected, in registry (display) order.
 *
 * Deliberately the app's own remembered flag and not the link state. This
 * answers "which devices are we meant to be reading", which is a wider set than
 * "which are working" — a WHOOP whose token has died still belongs in the list,
 * because dropping it silently would replace a sentence telling the client to
 * reconnect with a screen implying they never owned the thing. Whether each one
 * can actually be read is settled per provider below, and said out loud.
 */
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
    // Both of these are gaps in Repple rather than in the person's device, so
    // they are recorded as metric-level absences. Left unrecorded they would be
    // invisible to the connection state machine, and Watch & devices would go
    // on describing the device as plainly "connected" while this list said it
    // could not be read — the same two-screens-disagree shape as the WHOOP bug.
    if (!fetchSleep) {
      const why = `${p.meta.name} does not report sleep.`;
      noteMetric(id, 'sleep', { kind: 'absent', why });
      return { provider: id, status: 'unsupported', readings: [], reason: why };
    }
    // A provider that cannot run in this binary at all — HealthKit outside a
    // real build — has not failed to read; there was nothing to read it with.
    if (!p.isAvailable()) {
      const why = p.unavailableReason() ?? `${p.meta.name} is not available on this device.`;
      noteMetric(id, 'sleep', { kind: 'absent', why });
      return { provider: id, status: 'unsupported', readings: [], reason: why };
    }
    // A token the server has already told us is dead will refuse this read too,
    // so the round trip is skipped and the answer is given straight from the
    // verdict. Not an optimisation: it guarantees this list and Watch & devices
    // print the identical sentence from the identical fact, instead of racing
    // to discover it separately and momentarily disagreeing.
    const known = linkFor(id, p.meta.name, states[id] ?? 'connected', 'sleep');
    if (known.state === 'expired') {
      return { provider: id, status: 'error', readings: [], reason: known.detail };
    }
    try {
      return await fetchSleep(sinceDays);
    } catch (e) {
      // A dead token is still an error for THIS read: we do not know what the
      // client slept. Clearing the connection is the wearables context's job on
      // its own sync, not a side effect of drawing a sleep list.
      //
      // The wording is no longer written here. It used to be a sentence unique
      // to this file — "needs reconnecting — Repple no longer has permission to
      // read it" — which is how one screen came to contradict another about the
      // same device. `linkFor` reads the verdict that `fetchVendorSleep` has
      // just recorded, so this list says exactly what Watch & devices says.
      //
      // Note what can no longer reach this branch: a sleep endpoint refusing a
      // token that is otherwise working. That now returns a refusal rather than
      // throwing, so a missing scope can never again be announced here as the
      // whole device having lost its connection.
      const reason = e instanceof WearableNotConnectedError
        ? linkFor(id, p.meta.name, 'connected', 'sleep').detail
        : `${p.meta.name} could not be read just now. This is our end, not your device.`;
      reportError('wearables.fetchSleep', e, { provider: id });
      return { provider: id, status: 'error', readings: [], reason };
    }
  }));
}
