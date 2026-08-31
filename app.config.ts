// Three apps, one codebase — now times however many brands.
//
// app.json stays the single source of everything shared — plugins, permissions,
// icons, the Supabase and wearable client ids. This file layers the handful of
// fields that must differ per app on top of it: display name, bundle id,
// Android package and URL scheme.
//
// There are two axes, and an app is a point on both:
//
//   VARIANT — EXPO_PUBLIC_APP_VARIANT (client|trainer|owner). Which of the
//     three products this binary is. Unset means the client app, which is what
//     app.json already describes — see the matching fallback in
//     src/lib/variant.ts.
//
//   BRAND — EXPO_PUBLIC_BRAND. Whose name is on it. Repple is a brand and it is
//     the default, so unset means Repple, which is what every profile in
//     eas.json that existed before this axis did leaves it as. Those profiles
//     therefore resolve to exactly the values this file used to hold inline.
//     They have to: three App Store records and three Play listings are keyed
//     to those bundle ids, and a bundle id that changes orphans an app in the
//     store rather than updating it.
//
// Both come from the profile's env in eas.json. EAS applies a profile's env
// before evaluating this config, so the same variables drive both the native
// identity here and the runtime behaviour in src/lib/variant.ts and
// src/lib/brands.ts — they cannot disagree.
//
// The table itself lives in src/lib/brands.ts rather than here, because the app
// bundle needs it too: a brand's join links point at the brand's own domain,
// not Repple's. One table read from both sides is the same property the variant
// mechanism already has, and a second copy is how the copy nobody runs drifts.
//
// The `.ts` on the import is required and is not a typo. @expo/config
// transpiles THIS file but then requires its imports as plain Node modules, so
// the extension is what makes brands.ts loadable at build time; brands.ts says
// what that costs it.

import type { ExpoConfig, ConfigContext } from 'expo/config';
import { brandFor } from './src/lib/brands.ts';

type Variant = 'client' | 'trainer' | 'owner';

export default ({ config }: ConfigContext): ExpoConfig => {
  const raw = process.env.EXPO_PUBLIC_APP_VARIANT;
  const variant: Variant | null = (raw === 'client' || raw === 'trainer' || raw === 'owner') ? raw : null;

  // No variant set: a dev build. Leave app.json untouched so nothing about the
  // existing client identity shifts under a local `expo start`. A brand without
  // a variant is not a thing — there is no app to be — so this check stays
  // first and unchanged.
  if (!variant) return config as ExpoConfig;

  // Each app gets its own icon. Within a brand the mark is the same across all
  // three and only the tile colour differs, because at 60 points on a home
  // screen colour is the only difference anyone can actually see. Repple's
  // sources are the assets/repple-icon-*.svg files next to the PNGs.
  const brand = brandFor(process.env.EXPO_PUBLIC_BRAND);
  const id = brand.apps[variant];

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
      //
      // The hosts are the BRAND's, because the link a coach hands out has to be
      // on the site their members have heard of. Each brand's own domain must
      // serve its own association file naming its own client bundle — one file
      // per domain, not one file listing everybody.
      ...(variant === 'client'
        ? { associatedDomains: brand.linkHosts.map((h) => `applinks:${h}`) }
        : null),
    },
    android: {
      ...(config.android ?? {}),
      package: id.bundle,
      // Same mark for all three; the plate behind it carries the colour,
      // matching the iOS tile.
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
                data: brand.linkHosts.map((host) => ({ scheme: 'https', host, pathPrefix: '/join' })),
                category: ['BROWSABLE', 'DEFAULT'],
              },
            ],
          }
        : null),
      // A brand with its own Android packages needs its own Firebase project:
      // the Google Services Gradle plugin refuses to build a package that its
      // google-services.json does not list. Repple declares nothing here, so
      // app.json's single googleServicesFile is left exactly as it is.
      ...(brand.androidGoogleServices
        ? { googleServicesFile: brand.androidGoogleServices }
        : null),
    },
  };
};
