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
  // The near-black the board's splash screens use, in three green-tinted
  // steps — the plates behind the redesign's mark (assets/repple-icon-*.svg).
  // Still distinct, so the three icons can be told apart on a home screen,
  // and all three sit in the accent's hue family so each app matches its
  // own logo; coverage.test.ts holds both.
  client: '#0b0f0e',
  trainer: '#0c1210',
  owner: '#0a1311',
};

/**
 * The accent this build's interface is drawn in.
 *
 * One green for the whole family, as the approved board draws it. It used
 * to be a hue per app — teal, indigo, amber, the same three the website's
 * --client / --coach / --studio carried — and the board's reviewers chose
 * one mark for the three products instead; what tells the apps apart on a
 * screen is the wordmark's COACH / STUDIO line and the icon plate. This is
 * the same value as the default palette's `brand` in src/theme/tokens.ts,
 * and src/ui/components.tsx no longer overrides the palette with it; it is
 * kept here because it is the value the build's icon plates are held to.
 */
export const VARIANT_ACCENT: Record<AppVariant, string> = {
  client: '#15803d',
  trainer: '#15803d',
  owner: '#15803d',
};

/**
 * The colour of the wordmark's three bars, per app: green for the member app,
 * purple for Coach, gold for Studio. The owner's choice on 22 Sep 2026, so each
 * app keeps the same R≡PPLE mark in its own colour; the same values are drawn
 * into assets/repple-icon-*.svg. Only the MARK changes: the interface stays on
 * the one shared accent, and a gym that sets its own brand colour has its
 * colour in the bars instead (src/ui/BrandMark.tsx `useMarkSignal`).
 */
export const VARIANT_MARK: Record<AppVariant, string> = {
  client: '#22c55e',
  trainer: '#665fe8',
  owner: '#d88c0b',
};

/** Human name for the current build, used in copy and the user guide. */
export const VARIANT_LABEL: Record<AppVariant, string> = {
  client: 'Repple',
  trainer: 'Repple Coach',
  owner: 'Repple Studio',
};
