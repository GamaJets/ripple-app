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
//
// `all` is the development value. It keeps the portal chooser so one build can
// reach every portal while working locally — never ship it to the store.

export type AppVariant = 'client' | 'trainer' | 'owner' | 'all';

const RAW = process.env.EXPO_PUBLIC_APP_VARIANT;

function parse(v: string | undefined): AppVariant {
  switch (v) {
    case 'client':
    case 'trainer':
    case 'owner':
    case 'all':
      return v;
    default:
      // An unset or misspelled variant must not silently become a shipping
      // value. Falling back to `all` keeps every portal reachable, which is
      // obviously wrong in a store build and so gets caught rather than
      // quietly shipping the client app with the owner portal hidden inside.
      return 'all';
  }
}

export const VARIANT: AppVariant = parse(RAW);

/** The route group this build is allowed to show. */
export const HOME_ROUTE: Record<Exclude<AppVariant, 'all'>, string> = {
  client: '/(client)/dashboard',
  trainer: '/(trainer)/dashboard',
  owner: '/(owner)/dashboard',
};

/** True when this build shows the three-way portal chooser (dev only). */
export const SHOWS_PORTAL_CHOOSER = VARIANT === 'all';

/** Whether a given route group is reachable in this build. */
export function groupAllowed(group: 'client' | 'trainer' | 'owner'): boolean {
  return VARIANT === 'all' || VARIANT === group;
}

/** Human name for the current build, used in copy and the user guide. */
export const VARIANT_LABEL: Record<AppVariant, string> = {
  client: 'Repple',
  trainer: 'Repple Coach',
  owner: 'Repple Studio',
  all: 'Repple (all portals)',
};
