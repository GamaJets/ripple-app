// The device catalogue — order = display order on the Devices screen.
//
// ── What a blurb is allowed to say ──────────────────────────────────────────
//
// `blurb` and `metrics` are the app's ADVERTISEMENT for a device. They render
// on Watch & Devices under the device's name, above its button, for every
// provider in this list — including the ones that cannot be connected. So they
// are read first and they are read by everybody, and until now four of the six
// described a capability no build has ever had:
//
//   Fitbit  "Steps, heart rate & sleep via the Fitbit API"
//   Garmin  "Runs, heart rate & calories via Garmin Health"
//
// Neither has a client id (both are empty strings in app.json, and absent from
// eas.json and .env entirely), so `isConfigured()` is false for Fitbit and
// Garmin is `special: 'partnership'` besides. `cloudProvider.isAvailable()` now
// returns false for both and the screen prints "Unavailable" — but it printed
// it directly underneath a sentence promising four metrics, which reads as a
// temporary outage rather than a feature that does not exist. The button and
// the blurb were making opposite claims about the same device, one word apart.
//
// The rule this file now holds to: a blurb describes what THIS build can read
// today, and `metrics` is empty when the answer is nothing. Anything else is a
// promise made by the catalogue that the provider layer then has to refuse.
import type { WearableProvider, ProviderId, ProviderMeta } from './types';
import { appleHealth } from './appleHealth';
import { makeCloudProvider } from './cloudProvider';

const cloud = (m: ProviderMeta) => makeCloudProvider(m);

export const PROVIDERS: WearableProvider[] = [
  appleHealth,
  cloud({ id: 'whoop', name: 'WHOOP', icon: '🔴', kind: 'cloud', blurb: 'Strain, recovery, sleep & heart rate via the WHOOP API', metrics: ['Strain', 'Recovery', 'Sleep', 'Heart rate', 'Calories'] }),
  cloud({ id: 'oura', name: 'Oura Ring', icon: '💍', kind: 'cloud', blurb: 'Readiness, HRV & sleep via the Oura API', metrics: ['Readiness', 'HRV', 'Sleep', 'Resting HR'] }),
  // The three that cannot be connected. Each blurb states the gap in its own
  // words rather than deferring to the "Unavailable" button, because the button
  // says only that it is shut and these say why — and Garmin's says the one
  // thing a client can actually act on.
  //
  // They stay listed. Removing them would be the tidier catalogue and the worse
  // screen: somebody who owns a Garmin and finds no mention of it concludes
  // Repple has never heard of their device, and has no way to discover that
  // Apple Health already carries its nights. A named absence answers the
  // question; a missing row leaves them to guess.
  cloud({ id: 'garmin', name: 'Garmin', icon: '⌚', kind: 'cloud', blurb: 'Needs Garmin’s approval before Repple can read it — on iPhone it comes through Apple Health', metrics: [] }),
  cloud({ id: 'fitbit', name: 'Fitbit', icon: '⌚', kind: 'cloud', blurb: 'Not set up in Repple yet — nothing to connect to', metrics: [] }),
  // This row carried `metrics: []` and a blurb saying Repple read no training
  // from Health Connect, and both were true: an Android member could sync
  // nothing but blood sugar, which was the whole Android wearable story.
  //
  // `./healthConnectTraining.ts` reads all five now, and the blurb lists them
  // under the rule this file's header sets — a blurb describes what THIS build
  // can read. Blood sugar is still not listed, and that is not an oversight:
  // this row is a CONNECT button, connecting it does not grant blood sugar, and
  // blood sugar is asked for separately on its own screen.
  //
  // The blurb does not promise a working connection, because that depends on
  // the installed binary declaring the health permissions in its manifest and
  // this catalogue cannot see the manifest. What happens on a build that cannot
  // ask is that Connect fails with a sentence naming both reasons it might have
  // — see cloudProvider.connect() — rather than a blurb hedging a capability
  // for everybody in order to describe a minority of installs.
  cloud({ id: 'googlefit', name: 'Google Fit / Health Connect', icon: '🟢', kind: 'health-connect', blurb: 'Android’s health store — the steps, heart rate, calories, workouts and sleep your phone and watch write into it', metrics: ['Steps', 'Heart rate', 'Calories', 'Workouts', 'Sleep'] }),
];

export function providerById(id: ProviderId): WearableProvider | undefined {
  return PROVIDERS.find((p) => p.meta.id === id);
}
