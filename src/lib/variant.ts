// Which of the three Repple apps this bundle is.
//
// Repple ships as three separate App Store apps built from this one codebase:
// a client app, a trainer app and an owner app. They share `src/lib`, `src/ui`
// and one Supabase backend; what differs is which route group is reachable and
// which App Store record the build belongs to.
//
// The value comes from EXPO_PUBLIC_APP_VARIANT, set per build profile in
// eas.json. Anything with the EXPO_PUBLIC_ prefix is inlined into the bundle at
// build time, which is right here: the variant is not a secret, it is a build
// constant, and it must be readable synchronously before the first render.

export type AppVariant = 'client' | 'trainer' | 'owner';

const RAW = process.env.EXPO_PUBLIC_APP_VARIANT;

function parse(v: string | undefined): AppVariant {
  switch (v) {
    case 'client':
    case 'trainer':
    case 'owner':
      return v;
    default:
      // Unset falls back to the client app because that is what the build
      // physically is: app.config.ts also treats an unset variant as "leave
      // app.json alone", and app.json carries the client name, bundle id and
      // scheme. Runtime and native identity therefore agree in every case,
      // including a bare `expo start`.
      return 'client';
  }
}

export const VARIANT: AppVariant = parse(RAW);

/** The route group this build is allowed to show. */
export const HOME_ROUTE: Record<AppVariant, string> = {
  client: '/(client)/dashboard',
  trainer: '/(trainer)/dashboard',
  owner: '/(owner)/dashboard',
};

/** Whether a given route group is reachable in this build. */
export function groupAllowed(group: AppVariant): boolean {
  return VARIANT === group;
}

/**
 * The tile colour behind this build's icon on the home screen, from
 * app.config.ts. Kept in step with that table by hand — it is three constants,
 * and importing a config file into the runtime bundle to avoid it would cost
 * more than it saves.
 *
 * Used where the app has to identify ITSELF (the welcome mark), so the tile a
 * user just tapped on their home screen is the tile that greets them. The rest
 * of the UI stays on the shared brand accent.
 */
export const VARIANT_TILE: Record<AppVariant, string> = {
  client: '#0d9488',
  trainer: '#4338ca',
  owner: '#b45309',
};

/**
 * The accent this build's interface is drawn in.
 *
 * NOT the same value as VARIANT_TILE, deliberately. The tile colours are
 * plate colours behind a 60-point home-screen icon, where a deep saturated
 * ground reads well. As a UI accent on a near-black background the trainer
 * indigo (#4338ca) and the owner amber (#b45309) are too dark: button labels
 * sit on them, small dots and 1px rules are drawn in them, and both fall below
 * a comfortable contrast at that size.
 *
 * These are the same hues lifted a step, and they are the values the marketing
 * site already uses for each app (--client / --coach / --studio in
 * web/styles.css). So the app, its icon and its page on the website now agree
 * about what colour each product is, which is what somebody means when they
 * say the screens should match the logo.
 */
export const VARIANT_ACCENT: Record<AppVariant, string> = {
  // The approved board draws all three apps in one green. It used to be a
  // hue per app — teal, indigo, amber, the same three the site's --client,
  // --coach and --studio carry — and the board's reviewers chose one mark
  // for the family instead. The tile colours above are untouched: they are
  // the plates behind three different home-screen icons and still tell the
  // apps apart where that matters. A stored white-label accent still wins
  // over this, in src/ui/components.tsx, exactly as before.
  //
  // As a fill this green is fine; as TEXT on white it is 2.3:1 and
  // unreadable, which is why `brandInkFor` picks the ink that sits on it and
  // why check:contrast refuses `t.brand` as a text colour.
  client: '#22C55E',
  trainer: '#22C55E',
  owner: '#22C55E',
};

/** Human name for the current build, used in copy and the user guide. */
export const VARIANT_LABEL: Record<AppVariant, string> = {
  client: 'Repple',
  trainer: 'Repple Coach',
  owner: 'Repple Studio',
};
