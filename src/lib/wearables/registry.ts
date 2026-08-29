// The device catalogue — order = display order on the Devices screen.
import type { WearableProvider, ProviderId, ProviderMeta } from './types';
import { appleHealth } from './appleHealth';
import { makeCloudProvider } from './cloudProvider';

const cloud = (m: ProviderMeta) => makeCloudProvider(m);

export const PROVIDERS: WearableProvider[] = [
  appleHealth,
  cloud({ id: 'whoop', name: 'WHOOP', icon: '🔴', kind: 'cloud', blurb: 'Strain, recovery, sleep & heart rate via the WHOOP API', metrics: ['Strain', 'Recovery', 'Sleep', 'Heart rate', 'Calories'] }),
  cloud({ id: 'oura', name: 'Oura Ring', icon: '💍', kind: 'cloud', blurb: 'Readiness, HRV & sleep via the Oura API', metrics: ['Readiness', 'HRV', 'Sleep', 'Resting HR'] }),
  cloud({ id: 'garmin', name: 'Garmin', icon: '⌚', kind: 'cloud', blurb: 'Runs, heart rate & calories via Garmin Health', metrics: ['Workouts', 'Heart rate', 'Calories', 'Steps'] }),
  cloud({ id: 'fitbit', name: 'Fitbit', icon: '⌚', kind: 'cloud', blurb: 'Steps, heart rate & sleep via the Fitbit API', metrics: ['Steps', 'Heart rate', 'Sleep', 'Calories'] }),
  cloud({ id: 'googlefit', name: 'Google Fit / Health Connect', icon: '🟢', kind: 'health-connect', blurb: 'Android health data via Health Connect', metrics: ['Steps', 'Heart rate', 'Calories'] }),
];

export function providerById(id: ProviderId): WearableProvider | undefined {
  return PROVIDERS.find((p) => p.meta.id === id);
}
