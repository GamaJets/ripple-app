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
// Unset means a local dev build: keep the existing identity and let the portal
// chooser stand, so `expo start` behaves exactly as it did before the split.

import type { ExpoConfig, ConfigContext } from 'expo/config';

type Variant = 'client' | 'trainer' | 'owner';

const IDENTITY: Record<Variant, { name: string; bundle: string; scheme: string }> = {
  client:  { name: 'Repple',        bundle: 'com.washateria.repple',        scheme: 'repple' },
  trainer: { name: 'Repple Coach',  bundle: 'com.washateria.repple.coach',  scheme: 'repplecoach' },
  owner:   { name: 'Repple Studio', bundle: 'com.washateria.repple.studio', scheme: 'repplestudio' },
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
    ios: { ...(config.ios ?? {}), bundleIdentifier: id.bundle },
    android: { ...(config.android ?? {}), package: id.bundle },
  };
};
