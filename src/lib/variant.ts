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
 * The accent this build's interface is drawn in, as its light-scheme fill.
 *
 * One hue per app again (REDESIGN-PLAN §6, the user's decision of 15 Oct
 * 2026, reversing the board-era shared green): client green, Coach purple from
 * the #665FE8 family, Studio gold. Each is in its own logo mark's hue
 * (`VARIANT_MARK`), which coverage.test.ts holds. The dark-scheme luminous
 * values and the inks are `VARIANT_ACCENTS` in src/theme/tokens.ts, applied by
 * src/ui/components.tsx over the two Repple palettes.
 */
export const VARIANT_ACCENT: Record<AppVariant, string> = {
  client: '#15803d',
  trainer: '#5b52e0',
  owner: '#b45309',
};

/**
 * The colour of the wordmark's three bars, per app: green for the member app,
 * purple for Coach, gold for Studio. The owner's choice on 22 Sep 2026, so each
 * app keeps the same R≡PPLE mark in its own colour; the same values are drawn
 * into assets/repple-icon-*.svg. The interface accent is `VARIANT_ACCENT`, in the same hue, and a gym that sets its own brand colour has its
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
