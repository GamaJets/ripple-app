// Cloud-API providers (WHOOP, Oura, Garmin, Fitbit) and Android Health Connect.
//
// These devices expose an OAuth-guarded REST API. connect() runs the vendor's
// OAuth in a browser (via ./oauth), a Supabase edge function stores the refresh
// token, and fetchToday() asks that function for the latest day. A provider is
// only "available" to connect once its client ID is configured (env var) — until
// then the UI shows exactly what the owner needs to register.
import { Platform } from 'react-native';
import type { WearableProvider, ProviderMeta, DailyMetrics } from './types';
import { emptyMetrics } from './types';
import { vendorFor, isConfigured } from './oauthConfig';
import { connectVendor, fetchVendorDay, disconnectVendor } from './oauth';

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
    async fetchToday(): Promise<DailyMetrics | null> {
      if (isHealthConnect) return null;
      const raw = await fetchVendorDay(meta.id);
      if (!raw) return null;
      const m = emptyMetrics(meta.id);
      m.activeKcal = typeof raw.activeKcal === 'number' ? raw.activeKcal : null;
      m.steps = typeof raw.steps === 'number' ? raw.steps : null;
      m.heartRateAvg = typeof raw.heartRateAvg === 'number' ? raw.heartRateAvg : null;
      m.heartRateResting = typeof raw.heartRateResting === 'number' ? raw.heartRateResting : null;
      m.workoutMins = typeof raw.workoutMins === 'number' ? raw.workoutMins : null;
      return m;
    },
  };
}
