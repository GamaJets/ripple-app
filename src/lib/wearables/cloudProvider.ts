// Cloud-API providers (WHOOP, Oura, Garmin, Fitbit) and Android Health Connect.
//
// These devices never talk to the phone directly — they expose an OAuth-guarded
// REST API. The real flow is: connect() opens the vendor's OAuth page, the user
// approves, a Supabase edge function stores the refresh token, and fetchToday()
// asks that function for the latest day. The plumbing/slot is here now; the
// edge function lands with the backend phase, so connect() reports that clearly
// rather than pretending. Swapping in the live calls touches only this file.
import { Platform } from 'react-native';
import type { WearableProvider, ProviderMeta, DailyMetrics } from './types';

export function makeCloudProvider(meta: ProviderMeta): WearableProvider {
  const isHealthConnect = meta.kind === 'health-connect';
  return {
    meta,
    isAvailable() {
      if (isHealthConnect) return Platform.OS === 'android';
      return true; // cloud APIs are reachable from any build
    },
    unavailableReason() {
      if (isHealthConnect && Platform.OS !== 'android') return 'Health Connect is Android-only.';
      return null;
    },
    async connect() {
      if (isHealthConnect && Platform.OS !== 'android') {
        throw new Error('Health Connect is Android-only.');
      }
      // TODO(backend): open OAuth (expo-web-browser) → Supabase fn stores token.
      throw new Error(`${meta.name} connects through the Repple cloud — turning on ${meta.name} sync is part of the backend rollout. Apple Watch works today.`);
    },
    async disconnect() {
      // TODO(backend): revoke token via Supabase fn.
    },
    async fetchToday(): Promise<DailyMetrics | null> {
      // TODO(backend): supabase.functions.invoke('wearable-day', { provider: meta.id })
      return null;
    },
  };
}
