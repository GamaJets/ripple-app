"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.BRAND = exports.BRAND_ID = exports.DEFAULT_BRAND_ID = exports.BRANDS = void 0;
exports.resolveBrandId = resolveBrandId;
exports.brandFor = brandFor;
/**
 * Every brand this codebase can build.
 *
 * Adding a brand is adding a key here plus the icons, the EAS profiles, the
 * store listings and the association files. docs/WHITE-LABEL.md is the list,
 * and the list is longer than this table.
 */
exports.BRANDS = {
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
            client: { name: 'Repple', bundle: 'com.washateria.repple', scheme: 'repple', icon: './assets/icon.png', tile: '#0d9488' },
            trainer: { name: 'Repple Coach', bundle: 'com.washateria.repple.coach', scheme: 'repplecoach', icon: './assets/icon-coach.png', tile: '#4338ca' },
            owner: { name: 'Repple Studio', bundle: 'com.washateria.repple.studio', scheme: 'repplestudio', icon: './assets/icon-studio.png', tile: '#b45309' },
        },
        joinOrigin: 'https://www.repplefitness.com',
        // Deliberately apex, no www — this is the exact literal deepLink.ts has
        // always used, kept character for character so no reset URL moves.
        webOrigin: 'https://repplefitness.com',
        linkHosts: ['repplefitness.com', 'www.repplefitness.com'],
        // The literal that was already spelled out in gdpr.ts, on eight settings
        // screens and across web/. Unchanged, deliberately, for the same reason the
        // bundle ids above are unchanged: this is the address in the wild.
        supportEmail: 'support@repplefitness.com',
        // The exact URLs already registered as this app's Privacy Policy and Terms
        // in both store listings, and already served from web/ in this repo.
        privacyUrl: 'https://repplefitness.com/privacy.html',
        termsUrl: 'https://repplefitness.com/terms.html',
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
            client: { name: 'Example Fitness', bundle: 'com.example.fitness', scheme: 'examplefitness', icon: './assets/brands/example/icon.png', tile: '#1f6feb' },
            trainer: { name: 'Example Fitness Coach', bundle: 'com.example.fitness.coach', scheme: 'examplefitnesscoach', icon: './assets/brands/example/icon-coach.png', tile: '#6e40c9' },
            owner: { name: 'Example Fitness Studio', bundle: 'com.example.fitness.studio', scheme: 'examplefitnessstudio', icon: './assets/brands/example/icon-studio.png', tile: '#9a6700' },
        },
        joinOrigin: 'https://www.example.com',
        webOrigin: 'https://example.com',
        linkHosts: ['example.com', 'www.example.com'],
        supportEmail: 'support@example.com',
        privacyUrl: 'https://example.com/privacy.html',
        termsUrl: 'https://example.com/terms.html',
        androidGoogleServices: './google-services.example.json',
    },
};
/** The brand a build gets when EXPO_PUBLIC_BRAND says nothing. */
exports.DEFAULT_BRAND_ID = 'repple';
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
function resolveBrandId(raw) {
    const id = (raw || '').trim();
    return id && Object.prototype.hasOwnProperty.call(exports.BRANDS, id) ? id : exports.DEFAULT_BRAND_ID;
}
/** The brand record for an id, falling back to Repple the same way. */
function brandFor(raw) {
    return exports.BRANDS[resolveBrandId(raw)];
}
/** This build's brand id. */
exports.BRAND_ID = resolveBrandId(process.env.EXPO_PUBLIC_BRAND);
/** This build's brand. */
exports.BRAND = exports.BRANDS[exports.BRAND_ID];
