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
      m.zoneSeconds = raw.zoneSeconds && typeof raw.zoneSeconds === 'object' ? raw.zoneSeconds : null;
      m.workoutMins = typeof raw.workoutMins === 'number' ? raw.workoutMins : null;
      return m;
    },
  };
}
