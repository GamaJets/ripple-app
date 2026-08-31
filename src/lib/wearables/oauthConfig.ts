// OAuth configuration for the cloud wearable providers. Each vendor is wired
// here; a connection goes live the moment its client ID is provided as an
// EXPO_PUBLIC_ env var (baked into the build via eas.json). Client *secrets*
// never live in the app — they stay as Supabase edge-function secrets and are
// only used server-side during the code→token exchange.
import type { ProviderId } from './types';
import Constants from 'expo-constants';

export interface OAuthVendor {
  id: ProviderId;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientId: string;            // '' when the owner hasn't registered an app yet
  usePKCE: boolean;            // public clients (no secret) use PKCE
  special?: 'partnership';     // needs a vendor partnership, not self-serve OAuth
  /**
   * What the OWNER has to do to make this vendor work. Registration URLs, env
   * var names, Supabase secret names.
   *
   * This is a build instruction, and it was being printed to clients. The
   * Devices screen calls `unavailableReason()`, which interpolated this
   * verbatim, so a gym member who tapped Fitbit was told to "Register an app at
   * dev.fitbit.com → set EXPO_PUBLIC_FITBIT_CLIENT_ID and the
   * FITBIT_CLIENT_SECRET Supabase secret." That is not a thing they can do, not
   * a thing they should be asked to do, and it names two of our secrets on a
   * screen anybody can open. It stays here — the owner does need it, and the
   * setup UI is the right place for it — but it is no longer the sentence the
   * client reads.
   */
  note: string;
  /**
   * What the PERSON HOLDING THE PHONE should read when this vendor cannot be
   * connected.
   *
   * Kept apart from `note` because the two answer different questions. `note`
   * answers "what is missing"; this answers "is this my fault, and is there
   * anything I can do?" — and for every vendor here the honest answer to the
   * second half is no. So each of these says plainly that the gap is ours, and
   * points at the devices that DO work rather than leaving the person to guess
   * whether their ring is broken.
   */
  clientNote: string;
}

const env = (k: string): string => {
  // In Expo, EXPO_PUBLIC_* variables are baked into the build
  // Try accessing from process.env first (web), then Constants (native)
  try {
    // This cannot be the literal form: the key is a parameter and one function
    // serves five vendors. It is also why it does NOT break — the
    // Constants.expoConfig.extra fallback immediately below is a real second
    // source, and it is precisely why the WHOOP, Oura and Fitbit client ids
    // survived the inlining problem that left Spotify's empty. An indirect read
    // WITHOUT such a fallback is the bug; this is the shape that withstands it.
    // env-indirect-ok: falls back to Constants.expoConfig.extra, which is baked in by app.config.ts
    const val = (process.env as any)?.[k];
    if (val) return val;
  } catch { }
  
  try {
    const val = (Constants.expoConfig?.extra as any)?.[k];
    if (val) return val;
  } catch { }
  
  return '';
};

// The redirect must exactly match what you register with each vendor.
// Scheme comes from app.json ("repple"); path is stable.
// Deliberately fixed, not built with appLink(): WHOOP, Oura and the rest match
// this against a redirect URI registered in their dashboards, so it cannot vary
// per app. Wearables are a client-app feature, so `repple` is the right scheme.
export const OAUTH_REDIRECT = 'repple://wearables/callback';

export const OAUTH_VENDORS: Partial<Record<ProviderId, OAuthVendor>> = {
  fitbit: {
    id: 'fitbit',
    authorizeUrl: 'https://www.fitbit.com/oauth2/authorize',
    tokenUrl: 'https://api.fitbit.com/oauth2/token',
    scopes: ['activity', 'heartrate', 'profile', 'sleep'],
    clientId: env('EXPO_PUBLIC_FITBIT_CLIENT_ID'),
    usePKCE: true,
    note: 'Register an app at dev.fitbit.com → set EXPO_PUBLIC_FITBIT_CLIENT_ID and the FITBIT_CLIENT_SECRET Supabase secret.',
    // Says whose fault it is in the first clause, on purpose. Fitbit was
    // offered as a working option for long enough that somebody who taps it and
    // reads only "not set up" will reasonably wonder whether their Fitbit
    // account is the problem.
    clientNote: 'Repple has not finished setting Fitbit up, so there is nothing here to sign in to yet — nothing is wrong with your Fitbit. WHOOP and Oura connect today, and an Apple Watch reads through Apple Health.',
  },
  oura: {
    id: 'oura',
    authorizeUrl: 'https://cloud.ouraring.com/oauth/authorize',
    tokenUrl: 'https://api.ouraring.com/oauth/token',
    scopes: ['daily', 'personal', 'heartrate'],
    clientId: env('EXPO_PUBLIC_OURA_CLIENT_ID'),
    usePKCE: false,
    note: 'Register at cloud.ouraring.com/oauth/applications → set EXPO_PUBLIC_OURA_CLIENT_ID and OURA_CLIENT_SECRET.',
    // Oura is configured, so this is unreachable today. It exists because the
    // thing that makes a vendor unreachable is an empty env var in one build
    // profile, which is a deploy away and gives no warning — and the fallback
    // for a missing sentence must not be the owner's setup instructions.
    clientNote: 'Oura is not available in this version of Repple, so there is nothing here to sign in to — nothing is wrong with your ring.',
  },
  whoop: {
    id: 'whoop',
    authorizeUrl: 'https://api.prod.whoop.com/oauth/oauth2/auth',
    tokenUrl: 'https://api.prod.whoop.com/oauth/oauth2/token',
    // 'offline' is required for WHOOP to issue a refresh_token at all. Without
    // it the connection dies silently ~1h after connecting, with no way to
    // recover except reconnecting by hand.
    //
    // 'read:sleep' is the fix for build 35's four TestFlight reports. WHOOP
    // gates `/v2/activity/sleep` behind its own scope, and this list has never
    // asked for it — which did not matter until the sleep reader shipped and
    // started calling that endpoint. WHOOP answered 403, the `wearable-day`
    // edge function turns 401/403 into `connected: false`, and Recovery
    // rendered that as "WHOOP needs reconnecting" while Watch & devices still
    // said Connected — because every other WHOOP endpoint was working fine on
    // the very same token. Reconnecting re-requested the same four scopes and
    // hit the same 403, so the loop had no exit: "Reconnected whoop and it says
    // need to connect whoop."
    //
    // NOTE FOR ANYONE READING THIS AFTER A DEPLOY: adding the scope here fixes
    // new connections only. A refresh reissues the grant the user originally
    // gave, so everybody already connected keeps a token with no sleep scope
    // until they re-authorise once. That is why the state machine has a
    // 'metric-blocked' state that says so plainly and offers the re-auth,
    // instead of calling their working WHOOP disconnected.
    // 'read:body_measurement' is what lets Repple offer the client the weight
    // their own watch already holds instead of asking them to type it again.
    // The same re-authorisation caveat above applies to it: existing grants do
    // not gain it on refresh.
    scopes: ['read:recovery', 'read:cycles', 'read:sleep', 'read:workout', 'read:profile', 'read:body_measurement', 'offline'],
    clientId: env('EXPO_PUBLIC_WHOOP_CLIENT_ID'),
    usePKCE: false,
    note: 'Register at developer.whoop.com → set EXPO_PUBLIC_WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET.',
    // As with Oura: configured today, so unreachable today. See the note there.
    clientNote: 'WHOOP is not available in this version of Repple, so there is nothing here to sign in to — nothing is wrong with your strap.',
  },
  garmin: {
    id: 'garmin',
    authorizeUrl: 'https://connect.garmin.com/oauthConfirm',
    tokenUrl: '',
    scopes: [],
    clientId: env('EXPO_PUBLIC_GARMIN_CLIENT_ID'),
    usePKCE: false,
    special: 'partnership',
    note: 'Garmin Health API requires an approved partnership (apply at developer.garmin.com). It uses OAuth1.0a, not self-serve. Garmin data also flows into Apple Health today.',
    // The one vendor here with a real route for the client, so it is the one
    // sentence that ends in something they can actually do. Garmin's own app
    // writes into HealthKit, so an iPhone owner gets their Garmin days by
    // connecting Apple Health — and sleepMerge already treats a Garmin night
    // arriving that way as a Garmin night (family 'garmin'), not a watch night.
    clientNote: 'Garmin has to approve Repple before it will hand over your data, and it has not yet — so this is not something you can sign in to. On an iPhone, your Garmin already writes into Apple Health: connect that above and these days come through.',
  },
};

export function vendorFor(id: ProviderId): OAuthVendor | undefined {
  return OAUTH_VENDORS[id];
}
export function isConfigured(id: ProviderId): boolean {
  const v = OAUTH_VENDORS[id];
  return !!v && !v.special && !!v.clientId;
}
