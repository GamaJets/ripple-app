// Ask connected devices what they hold for the client's body.
//
// The point is narrow and worth stating plainly: a client wearing a WHOOP has
// already told WHOOP what they weigh, and Repple was asking them to type it
// again. This reads it instead — and then OFFERS it. Nothing here writes
// anything anywhere.
//
// ── Why this is not a scan ──────────────────────────────────────────────────
//
// The obvious-looking move is to write the weight into `scans` so it joins the
// body-composition trend. It must not. `scans.body_fat_pct` is NOT NULL and
// WHOOP measures no body fat, so a row would need a fabricated figure — and it
// would then sit in the body-fat series looking exactly like a measurement
// somebody took. A weight from a watch is a weight from a watch.
//
// ── Why every field is separately nullable ─────────────────────────────────
//
// WHOOP returns the record with only what the client has actually filled in.
// A missing height is a height nobody entered, not a height of zero, and the
// three fields go missing independently of each other.
import { PROVIDERS } from './registry';
import type { ConnectionState, ProviderId } from './types';
import { fetchVendorBody, WearableNotConnectedError } from './oauth';
import { linkFor, noteMetric } from '../wearableLinkLedger';
import { reportError } from '../reportError';
import { isConfigured } from './oauthConfig';
import { bodyFigure, hasBodyFigure, type BodyRead } from '../vendorBody';

export { bodyFigure, hasBodyFigure };
export type { BodyRead };

/** Whether Repple has a body-measurement reader for this provider at all. */
export function vendorReadsBody(id: string): boolean {
  return id === 'whoop';
}

export async function readBodyFromDevices(
  states: Record<string, ConnectionState>,
): Promise<BodyRead[]> {
  const connected = PROVIDERS.filter((p) => states[p.meta.id] === 'connected');
  return Promise.all(connected.map(async (p): Promise<BodyRead> => {
    const id = p.meta.id as ProviderId;
    const base = { provider: id, providerName: p.meta.name, weightKg: null, heightM: null, maxHeartRate: null };

    // Recorded as a metric-level absence rather than left silent. Unrecorded,
    // it would be invisible to the connection state machine and Watch & devices
    // would go on calling the device plainly "connected" while this said it
    // could not be read — the two-screens-disagree shape that keeps recurring.
    const absent = (why: string): BodyRead => {
      noteMetric(id, 'body', { kind: 'absent', why });
      return { ...base, status: 'unsupported', reason: why };
    };

    if (!p.isAvailable()) {
      return absent(p.unavailableReason() ?? `${p.meta.name} is not available on this device.`);
    }
    if (!isConfigured(id)) {
      return absent(`${p.meta.name} is not set up yet, so there is nothing to read.`);
    }
    if (!vendorReadsBody(id)) {
      return absent(`${p.meta.name} does not publish a body measurement Repple can read.`);
    }
    // A token already known dead will refuse this too, so the round trip is
    // skipped and the sentence comes from the shared verdict — which is what
    // stops this screen and Watch & devices printing different wording about
    // the identical fact.
    const known = linkFor(id, p.meta.name, states[id] ?? 'connected', 'body');
    if (known.state === 'expired') {
      return { ...base, status: 'error', reason: known.detail };
    }
    try {
      const res = await fetchVendorBody(id);
      if (!res.ok) {
        // A refusal means the endpoint answered "no" on a working token: the
        // scope was never granted, and only re-authorising changes it. The
        // wording comes from the state machine so every screen agrees.
        const reason = res.refused
          ? linkFor(id, p.meta.name, 'connected', 'body').detail
          : `${p.meta.name} could not be read just now, so this is unknown rather than empty.`;
        return { ...base, status: 'error', reason };
      }
      return {
        ...base,
        status: 'ready',
        weightKg: res.weightKg,
        heightM: res.heightM,
        maxHeartRate: res.maxHeartRate,
      };
    } catch (e) {
      const reason = e instanceof WearableNotConnectedError
        ? linkFor(id, p.meta.name, 'connected', 'body').detail
        : `${p.meta.name} could not be read just now. This is our end, not your device.`;
      reportError('wearables.fetchBody', e, { provider: id });
      return { ...base, status: 'error', reason };
    }
  }));
}
