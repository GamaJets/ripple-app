// Which BRAND this bundle belongs to. The second axis.
//
// Repple already ships three apps from one codebase, selected by
// EXPO_PUBLIC_APP_VARIANT (client | trainer | owner) — see variant.ts. Nothing
// here replaces that. This adds a second, independent axis: which BRAND the
// three apps are published under.
//
// Brand × variant identifies an app. A gym chain buying Repple gets THEIR app,
// under THEIR name, in the store — their own listing, their own bundle id,
// their own icon, their own domain. Not a theme toggle inside one binary: the
// store record itself is different, because that is what a chain is buying.
//
// Repple is a brand. It is the DEFAULT brand, and it is spelled out below with
// exactly the values app.config.ts used to hold inline. That is not tidiness,
// it is the safety property this whole file has to have: a bundle id is
// permanent, and an app whose bundle id changes is not an updated app, it is a
// new app with none of its users. So `EXPO_PUBLIC_BRAND` unset must resolve to
// Repple, and Repple must resolve to byte-identical values. Every existing
// build profile leaves the variable unset and is therefore unchanged.
//
// Loaded from two places with two different module systems:
//
//   * app.config.ts, evaluated by @expo/config in Node at build time. That
//     loader transpiles app.config.ts itself but requires its imports as plain
//     Node modules, so the import there carries an explicit `.ts` extension and
//     relies on Node's type stripping. Which is why this file stays inside what
//     stripping can erase: no `enum`, no namespaces, and type-only imports
//     written as `import type`. eas.json pins node 26.7.0 on every profile, so
//     the capability is not in question — but the constraint is real, and
//     breaking it breaks `eas build` rather than `tsc`.
//
//   * the app bundle itself, via joinCode.ts, where `EXPO_PUBLIC_BRAND` is
//     inlined by Metro at build time exactly as `EXPO_PUBLIC_APP_VARIANT` is.
//
// One table read by both is the point. The variant mechanism earned its comment
// in app.config.ts by making it impossible for the native identity and the
// runtime routing to disagree; a brand table that existed twice would give that
// back immediately, and the copy that drifted would be the one nobody ran.

import type { AppVariant } from './variant';

/**
 * What differs between the three apps of ONE brand.
 *
 * Identical in shape to the `Identity` record app.config.ts used to declare
 * inline, because it is the same thing: the handful of fields that cannot be
 * shared and must be layered over app.json.
 */
export type BrandApp = {
  /** Display name on the home screen and in the store listing. */
  name: string;
  /** iOS bundle identifier and Android package. Permanent. Never edit one. */
  bundle: string;
  /** Custom URL scheme this binary registers. */
  scheme: string;
  /** Path to the icon PNG, relative to the project root. */
  icon: string;
  /** Tile colour behind the icon — the Android adaptive-icon plate, and the
   *  one difference anybody can see between three apps at 60 points. */
  tile: string;
};

export type Brand = {
  /** The value of EXPO_PUBLIC_BRAND that selects this brand. */
  id: string;
  /** The family name, used where the brand names itself with no variant. */
  label: string;
  /** The three apps. */
  apps: Record<AppVariant, BrandApp>;
  /**
   * Origin for join links — `<origin>/join?c=CODE`.
   *
   * A coach's invite link is composed on the coach's phone and read on somebody
   * else's, so it has to be a real https URL on a real site (see joinCode.ts).
   * That site is the BRAND's, not Repple's: a chain's coach handing out
   * repplefitness.com links is advertising their supplier to their own members.
   */
  joinOrigin: string;
  /**
   * Hosts whose `/join` this brand's CLIENT app claims as universal links.
   *
   * Both the apex and the www host, in that order, because the two are separate
   * origins to Apple and to Android and a link in the wild may be either. Each
   * host must serve this brand's own /.well-known/apple-app-site-association
   * and /.well-known/assetlinks.json naming this brand's client bundle — see
   * docs/UNIVERSAL-LINKS.md and docs/WHITE-LABEL.md. A brand that has not set
   * those files up yet is not broken, it just opens the browser.
   *
   * Client only, and /join only. The reasoning is in app.config.ts and it is
   * about variants, not brands: password reset is shared by all three apps, so
   * only a path that exactly one app can honestly own may be claimed.
   */
  linkHosts: string[];
  /**
   * This brand's `google-services.json`, or null to use app.json's.
   *
   * Android push is not portable between brands. A Firebase project's
   * google-services.json enumerates the package names it serves, and the Google
   * Services Gradle plugin FAILS THE BUILD when the package being built is not
   * in the file. So a brand with new packages needs its own Firebase project
   * and its own file here — this is not a runtime nicety, it is the difference
   * between a build and a red X.
   *
   * Repple leaves this null so app.json's value is not touched at all.
   */
  androidGoogleServices: string | null;
};

/**
 * Every brand this codebase can build.
 *
 * Adding a brand is adding a key here plus the icons, the EAS profiles, the
 * store listings and the association files. docs/WHITE-LABEL.md is the list,
 * and the list is longer than this table.
 */
export const BRANDS: Record<string, Brand> = {
  // ── Repple — the default brand, and the one already in the stores ─────────
  //
  // These values are transcribed from app.config.ts as it stood before the
  // brand axis existed, deliberately unchanged and deliberately not derived
  // from anything. Three App Store records and three Play listings point at
  // these bundle ids. Nothing may be tidied here.
  repple: {
    id: 'repple',
    label: 'Repple',
    apps: {
      client:  { name: 'Repple',        bundle: 'com.washateria.repple',        scheme: 'repple',       icon: './assets/icon.png',        tile: '#0d9488' },
      trainer: { name: 'Repple Coach',  bundle: 'com.washateria.repple.coach',  scheme: 'repplecoach',  icon: './assets/icon-coach.png',  tile: '#4338ca' },
      owner:   { name: 'Repple Studio', bundle: 'com.washateria.repple.studio', scheme: 'repplestudio', icon: './assets/icon-studio.png', tile: '#b45309' },
    },
    joinOrigin: 'https://www.repplefitness.com',
    linkHosts: ['repplefitness.com', 'www.repplefitness.com'],
    androidGoogleServices: null,
  },

  // ── Example Fitness — the shape of a second brand, and nothing more ───────
  //
  // A worked example, not a customer. Everything below is deliberately drawn
  // from IANA's reserved `example.com` and the matching `com.example` namespace
  // so that no part of it can be mistaken for a real chain's real details, and
  // so that a copy-paste of it cannot collide with anybody's registered
  // identifier.
  //
  // It will NOT build as it stands: `assets/brands/example/` does not exist.
  // That is on purpose. A brand's icons are the one thing that cannot be
  // defaulted — shipping a second brand's app carrying Repple's ripple is worse
  // than failing the build, because it reaches the store looking finished.
  example: {
    id: 'example',
    label: 'Example Fitness',
    apps: {
      client:  { name: 'Example Fitness',        bundle: 'com.example.fitness',        scheme: 'examplefitness',       icon: './assets/brands/example/icon.png',        tile: '#1f6feb' },
      trainer: { name: 'Example Fitness Coach',  bundle: 'com.example.fitness.coach',  scheme: 'examplefitnesscoach',  icon: './assets/brands/example/icon-coach.png',  tile: '#6e40c9' },
      owner:   { name: 'Example Fitness Studio', bundle: 'com.example.fitness.studio', scheme: 'examplefitnessstudio', icon: './assets/brands/example/icon-studio.png', tile: '#9a6700' },
    },
    joinOrigin: 'https://www.example.com',
    linkHosts: ['example.com', 'www.example.com'],
    androidGoogleServices: './google-services.example.json',
  },
};

/** The brand a build gets when EXPO_PUBLIC_BRAND says nothing. */
export const DEFAULT_BRAND_ID = 'repple';

/**
 * What the environment says → which brand that is.
 *
 * Pure, and takes the raw value rather than reading the environment itself, so
 * app.config.ts can resolve a brand for a build while this module's own
 * constants below resolve one for the running app. Same rules, one place.
 *
 * An unrecognised brand falls back to Repple rather than throwing, and that is
 * the conservative direction: a typo in a profile's env then produces a build
 * that is visibly the wrong brand — wrong name on the home screen, before it
 * ever reaches a store — instead of a build that fails opaquely on a CI worker.
 * The failure everybody notices beats the failure nobody can read.
 */
export function resolveBrandId(raw: string | undefined | null): string {
  const id = (raw || '').trim();
  return id && Object.prototype.hasOwnProperty.call(BRANDS, id) ? id : DEFAULT_BRAND_ID;
}

/** The brand record for an id, falling back to Repple the same way. */
export function brandFor(raw: string | undefined | null): Brand {
  return BRANDS[resolveBrandId(raw)];
}

/** This build's brand id. */
export const BRAND_ID: string = resolveBrandId(process.env.EXPO_PUBLIC_BRAND);

/** This build's brand. */
export const BRAND: Brand = BRANDS[BRAND_ID];
