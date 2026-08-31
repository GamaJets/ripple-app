// Three apps, one codebase.
//
// app.json stays the single source of everything shared — plugins, permissions,
// icons, the Supabase and wearable client ids. This file layers the handful of
// fields that must differ per app on top of it: display name, bundle id,
// Android package and URL scheme.
//
// The variant comes from EXPO_PUBLIC_APP_VARIANT, set per build profile in
// eas.json. EAS applies a profile's env before evaluating this config, so the
// same variable drives both the native identity here and the runtime routing in
// src/lib/variant.ts — they cannot disagree.
//
// Unset means the client app, which is what app.json already describes — see
// the matching fallback in src/lib/variant.ts.

import type { ExpoConfig, ConfigContext } from 'expo/config';

type Variant = 'client' | 'trainer' | 'owner';

// Each app gets its own icon. The ripple is the brand and is identical across
// all three; only the tile colour differs, because at 60 points on a home
// screen colour is the only difference anyone can actually see. Sources are
// the assets/repple-icon-*.svg files next to the PNGs.
type Identity = { name: string; bundle: string; scheme: string; icon: string; tile: string };

const IDENTITY: Record<Variant, Identity> = {
  client:  { name: 'Repple',        bundle: 'com.washateria.repple',        scheme: 'repple',        icon: './assets/icon.png',        tile: '#0d9488' },
  trainer: { name: 'Repple Coach',  bundle: 'com.washateria.repple.coach',  scheme: 'repplecoach',   icon: './assets/icon-coach.png',  tile: '#4338ca' },
  owner:   { name: 'Repple Studio', bundle: 'com.washateria.repple.studio', scheme: 'repplestudio',  icon: './assets/icon-studio.png', tile: '#b45309' },
};

export default ({ config }: ConfigContext): ExpoConfig => {
  const raw = process.env.EXPO_PUBLIC_APP_VARIANT;
  const variant = (raw === 'client' || raw === 'trainer' || raw === 'owner') ? raw : null;

  // No variant set: a dev build. Leave app.json untouched so nothing about the
  // existing client identity shifts under a local `expo start`.
  if (!variant) return config as ExpoConfig;

  const id = IDENTITY[variant];
  return {
    ...(config as ExpoConfig),
    name: id.name,
    scheme: id.scheme,
    icon: id.icon,
    ios: {
      ...(config.ios ?? {}),
      bundleIdentifier: id.bundle,
      // Universal links, CLIENT APP ONLY and only for /join.
      //
      // A custom scheme cannot be what a coach puts in an Instagram bio:
      // `repple://join?c=…` is not tappable on the web and does nothing to
      // somebody who has not installed the app yet. https://repplefitness.com/join
      // is, and with this it opens the app directly for anybody who has.
      //
      // Only /join, and only here, on purpose. Password reset and email
      // confirmation are shared by all three apps, and if all three claimed
      // those paths iOS would hand the link to whichever it felt like — a coach
      // resetting their password could land in the client app. Joining is
      // something only a client does, so /join has exactly one honest owner.
      ...(variant === 'client'
        ? { associatedDomains: ['applinks:repplefitness.com', 'applinks:www.repplefitness.com'] }
        : null),
    },
    android: {
      ...(config.android ?? {}),
      package: id.bundle,
      // Same ripple foreground for all three; the plate behind it carries the
      // colour, matching the iOS tile.
      adaptiveIcon: { ...(config.android?.adaptiveIcon ?? {}), backgroundColor: id.tile },
      // Android App Links — the same decision as associatedDomains above, and
      // the same scope. `autoVerify` is what makes Android open the app without
      // asking; it requires /.well-known/assetlinks.json to name this package
      // and the SHA-256 of the certificate the app is actually signed with,
      // which under Play App Signing is Google's, not the upload key.
      //
      // Verification failing is not a regression: the link simply opens the
      // browser, which is what it does today.
      ...(variant === 'client'
        ? {
            intentFilters: [
              {
                action: 'VIEW',
                autoVerify: true,
                data: [
                  { scheme: 'https', host: 'repplefitness.com', pathPrefix: '/join' },
                  { scheme: 'https', host: 'www.repplefitness.com', pathPrefix: '/join' },
                ],
                category: ['BROWSABLE', 'DEFAULT'],
              },
            ],
          }
        : null),
    },
  };
};
