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
import { vendorFor, isConfigured } from './oauthConfig';
import { connectVendor, fetchVendorDay, disconnectVendor, fetchVendorWorkouts } from './oauth';

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
     * Sleep from a cloud vendor — not available yet, and it says so rather than
     * reporting an empty night.
     *
     * WHOOP, Oura and Fitbit all measure sleep and all expose it, but nothing
     * in Repple reads it: `wearable-day` (supabase/functions/wearable-day) has
     * exactly three per-vendor readers — fitbitDay, ouraDay, whoopDay — and none
     * of them touches a sleep endpoint, so there is no sleep in the payload to
     * parse. Until a `sleep` action ships there, this returns 'unsupported'.
     *
     * It deliberately does NOT call the function on the off-chance. A request
     * for an action the deployed function does not know falls through to the
     * daily-metrics reader and comes back with no sleep in it, which is
     * indistinguishable from "your ring recorded nothing last night" — the
     * client would be told their Oura had no reading when Repple never asked it
     * for one. It is also a wasted round trip on every visit, which is the same
     * mistake the Devices screen already had to have fixed once.
     *
     * Writing a parser for the response shape would mean guessing that shape,
     * since none of these APIs can be exercised without live vendor
     * credentials. The honest state is: declared, connectable, no sleep.
     */
    async fetchSleep(): Promise<SleepRead> {
      const reason = isHealthConnect
        ? 'Health Connect sleep arrives with the Android native module.'
        : vendor?.special === 'partnership'
        ? `${meta.name} needs an approved partnership before Repple can read anything from it.`
        : `${meta.name} records sleep, but Repple cannot read it yet — the server-side reader has not shipped. Your ${meta.name} sleep is not missing, it is unread.`;
      return { provider: meta.id, status: 'unsupported', readings: [], reason };
    },
    async fetchToday(): Promise<DailyMetrics | null> {
      if (isHealthConnect) return null;
      const raw = await fetchVendorDay(meta.id);
      if (!raw) return null;
      const m = emptyMetrics(meta.id);
      m.activeKcal = typeof raw.activeKcal === 'number' ? raw.activeKcal : null;
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
