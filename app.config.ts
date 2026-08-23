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
    ios: { ...(config.ios ?? {}), bundleIdentifier: id.bundle },
    android: {
      ...(config.android ?? {}),
      package: id.bundle,
      // Same ripple foreground for all three; the plate behind it carries the
      // colour, matching the iOS tile.
      adaptiveIcon: { ...(config.android?.adaptiveIcon ?? {}), backgroundColor: id.tile },
    },
  };
};
