// Cloud-API providers (WHOOP, Oura, Garmin, Fitbit) and Android Health Connect.
//
// These devices expose an OAuth-guarded REST API. connect() runs the vendor's
// OAuth in a browser (via ./oauth), a Supabase edge function stores the refresh
// token, and fetchToday() asks that function for the latest day. A provider is
// only "available" to connect once its client ID is configured (env var) — until
// then the UI shows exactly what the owner needs to register.
import { Platform } from 'react-native';
import type { WearableProvider, ProviderMeta, DailyMetrics, WorkoutSample } from './types';
import { emptyMetrics } from './types';
import type { SleepRead } from '../sleepMerge';
import { parseVendorSleep, vendorReadsSleep } from '../vendorSleep';
import { vendorFor, isConfigured } from './oauthConfig';
import { connectVendor, fetchVendorDay, disconnectVendor, fetchVendorWorkouts, fetchVendorSleep } from './oauth';
import { linkFor, noteMetric } from '../wearableLinkLedger';

export function makeCloudProvider(meta: ProviderMeta): WearableProvider {
  const isHealthConnect = meta.kind === 'health-connect';
  const vendor = vendorFor(meta.id);

  return {
    meta,
    isAvailable() {
      if (isHealthConnect) return Platform.OS === 'android';
      return true; // cloud APIs are reachable from any build (once configured)
    },
    unavailableReason() {
      if (isHealthConnect && Platform.OS !== 'android') return 'Health Connect is Android-only — connect it from an Android device.';
      if (vendor?.special === 'partnership') return vendor.note;
      if (vendor && !isConfigured(meta.id)) return `Not set up yet. ${vendor.note}`;
      return null;
    },
    async connect() {
      if (isHealthConnect) {
        if (Platform.OS !== 'android') throw new Error('Health Connect is Android-only.');
        throw new Error('Health Connect connects on Android via the native module — added in the Android build.');
      }
      await connectVendor(meta.id);
    },
    async disconnect() {
      if (isHealthConnect) return;
      await disconnectVendor(meta.id);
    },
    async fetchWorkouts(sinceDays = 14): Promise<WorkoutSample[]> {
      if (isHealthConnect) return [];
      const raw = await fetchVendorWorkouts(meta.id, sinceDays);
      return raw.map((r: any) => ({
        id: String(r.id),
        activity: String(r.activity || 'Workout'),
        rawActivity: String(r.rawActivity || r.activity || 'Workout'),
        start: String(r.start),
        mins: Number(r.mins) || 0,
        kcal: typeof r.kcal === 'number' ? r.kcal : null,
        distanceKm: typeof r.distanceKm === 'number' ? r.distanceKm : null,
        avgHr: typeof r.avgHr === 'number' ? r.avgHr : null,
        maxHr: typeof r.maxHr === 'number' ? r.maxHr : null,
        source: meta.id,
      })).filter((x: WorkoutSample) => x.mins > 0 && !!x.start);
    },
    /**
     * Sleep from a cloud vendor.
     *
     * Three outcomes and never one. 'unsupported' says Repple has no reader for
     * this device — a fact about us, which leaves the night a plain dash.
     * 'error' says we asked and did not get an answer, which makes the night
     * UNKNOWN. And 'ready' with no readings is a real measurement of absence:
     * the vendor answered and holds no sleep for those nights. A dead token
     * throws `WearableNotConnectedError`, which `wearables/sleep.ts` turns into
     * its own 'error' sentence telling the person to reconnect — a different
     * problem with a different fix from a server that did not answer.
     *
     * The parsing lives in `src/lib/vendorSleep.ts`, on the device, because a
     * night is a LOCAL calendar day and the edge function runs in UTC.
     */
    async fetchSleep(sinceDays = 7): Promise<SleepRead> {
      // The four gaps below are all facts about REPPLE, not about the person's
      // device or their connection, so each is recorded as a metric-level
      // absence. That is what stops any of them being read one layer up as the
      // account being disconnected — and it is why the sentence they produce
      // opens by saying the device is connected and working.
      const absent = (why: string): SleepRead => {
        noteMetric(meta.id, 'sleep', { kind: 'absent', why });
        return { provider: meta.id, status: 'unsupported', readings: [], reason: why };
      };
      if (isHealthConnect) {
        return absent('Health Connect sleep arrives with the Android native module.');
      }
      if (vendor?.special === 'partnership') {
        return absent(`${meta.name} needs an approved partnership before Repple can read anything from it.`);
      }
      if (!isConfigured(meta.id)) {
        return absent(`${meta.name} is not set up yet, so there is nothing to read.`);
      }
      if (!vendorReadsSleep(meta.id)) {
        return absent(`${meta.name} does not publish a sleep endpoint Repple can read.`);
      }
      const res = await fetchVendorSleep(meta.id, sinceDays);
      if (!res.ok) {
        // A refusal is not a failure to reach the vendor, and must not borrow
        // that sentence. The endpoint answered — it answered "no" — because
        // this build never asked for the scope, and the only thing that changes
        // it is the person re-authorising. The wording comes from the shared
        // state machine so that this list, Watch & devices and Recovery all say
        // the same thing about the same device.
        //
        // The status stays 'error' regardless, and deliberately: whichever of
        // the two it was, we do not know what the person slept. 'unsupported'
        // would let the night render as "no device recorded this" — which is
        // false, since WHOOP recorded it perfectly well and simply will not
        // show us.
        const reason = res.refused
          ? linkFor(meta.id, meta.name, 'connected', 'sleep').detail
          : `${meta.name} could not be read just now, so these nights are unknown rather than empty.`;
        return { provider: meta.id, status: 'error', readings: [], reason };
      }
      // meta.name rather than the vendor's own label, so the sentence on the
      // screen names the device the way the person connected it.
      return { provider: meta.id, status: 'ready', readings: parseVendorSleep(meta.id, res.records, meta.name) };
    },
    async fetchToday(): Promise<DailyMetrics | null> {
      if (isHealthConnect) return null;
      const raw = await fetchVendorDay(meta.id);
      if (!raw) return null;
      const m = emptyMetrics(meta.id);
      m.activeKcal = typeof raw.activeKcal === 'number' ? raw.activeKcal : null;
      m.totalKcal = typeof raw.totalKcal === 'number' ? raw.totalKcal : null;
      m.steps = typeof raw.steps === 'number' ? raw.steps : null;
      m.heartRateAvg = typeof raw.heartRateAvg === 'number' ? raw.heartRateAvg : null;
      m.heartRateResting = typeof raw.heartRateResting === 'number' ? raw.heartRateResting : null;
      m.heartRateMax = typeof raw.heartRateMax === 'number' ? raw.heartRateMax : null;
      // Only accept the z1..z5 shape. An older edge-function deploy sends
      // {rest,warmup,aerobic,threshold,max}; taking that verbatim would render
      // as five empty zones rather than an obvious failure, so it is rejected.
      const rz = raw.zoneSeconds;
      const num = (v: unknown) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : 0);
      m.zoneSeconds = rz && typeof rz === 'object' && ('z1' in rz || 'z4' in rz)
        ? { z1: num(rz.z1), z2: num(rz.z2), z3: num(rz.z3), z4: num(rz.z4), z5: num(rz.z5) }
        : null;
      m.workoutMins = typeof raw.workoutMins === 'number' ? raw.workoutMins : null;
      return m;
    },
  };
}
