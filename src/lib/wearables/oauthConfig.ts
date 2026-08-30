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
  note: string;                // shown in setup UI / errors
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
  },
  oura: {
    id: 'oura',
    authorizeUrl: 'https://cloud.ouraring.com/oauth/authorize',
    tokenUrl: 'https://api.ouraring.com/oauth/token',
    scopes: ['daily', 'personal', 'heartrate'],
    clientId: env('EXPO_PUBLIC_OURA_CLIENT_ID'),
    usePKCE: false,
    note: 'Register at cloud.ouraring.com/oauth/applications → set EXPO_PUBLIC_OURA_CLIENT_ID and OURA_CLIENT_SECRET.',
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
  },
};

export function vendorFor(id: ProviderId): OAuthVendor | undefined {
  return OAUTH_VENDORS[id];
}
export function isConfigured(id: ProviderId): boolean {
  const v = OAUTH_VENDORS[id];
  return !!v && !v.special && !!v.clientId;
}
