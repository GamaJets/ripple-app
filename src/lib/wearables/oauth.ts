// Client OAuth runner for cloud wearables. Uses expo-auth-session (lazy-required
// so an OTA to a build without it degrades gracefully instead of crashing). The
// flow: open the vendor's consent page → get an auth code → hand the code to the
// `wearable-oauth` edge function, which exchanges it for tokens using the vendor
// secret (server-side only) and stores the refresh token per user. No secret
// ever touches the app.
import { supabase } from '../supabase';
import { vendorFor, isConfigured, OAUTH_REDIRECT } from './oauthConfig';
import type { ProviderId } from './types';
import { reportError } from '../reportError';

function authSession(): any {
  try { return require('expo-auth-session'); } catch { return null; }
}
function webBrowser(): any {
  try { return require('expo-web-browser'); } catch { return null; }
}

/** Run the full connect handshake for a cloud vendor. Throws a clear message. */
export async function connectVendor(id: ProviderId): Promise<void> {
  const v = vendorFor(id);
  if (!v) throw new Error('Unknown provider.');
  if (v.special === 'partnership') throw new Error(v.note);
  if (!isConfigured(id)) throw new Error(`${id} isn't set up yet. ${v.note}`);

  const AuthSession = authSession();
  if (!AuthSession) throw new Error('This build cannot open a sign-in browser yet — a native rebuild adds it. Apple Health works today.');
  const WB = webBrowser();
  if (WB?.maybeCompleteAuthSession) { try { WB.maybeCompleteAuthSession(); } catch { /* ignore */ } }

  const discovery = { authorizationEndpoint: v.authorizeUrl, tokenEndpoint: v.tokenUrl };
  const redirectUri = OAUTH_REDIRECT;

  const request = new AuthSession.AuthRequest({
    clientId: v.clientId,
    scopes: v.scopes,
    redirectUri,
    usePKCE: v.usePKCE,
    responseType: 'code',
  });
  await request.makeAuthUrlAsync(discovery);
  const result = await request.promptAsync(discovery);

  if (!result || result.type !== 'success' || !result.params?.code) {
    throw new Error(result?.type === 'dismiss' || result?.type === 'cancel' ? 'Sign-in cancelled.' : 'Could not complete sign-in.');
  }

  // Hand the code to the server for the secret-bearing token exchange.
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  const { data, error } = await supabase.functions.invoke('wearable-oauth', {
    body: {
      provider: id,
      code: result.params.code,
      code_verifier: request.codeVerifier ?? null,
      redirect_uri: redirectUri,
      user_id: userId,
    },
  });
  if (error || (data as any)?.error) {
    const detail = (data as any)?.error || (error as any)?.message || 'unknown';
    reportError('wearables.connect.tokenExchange', detail, { provider: id });
    throw new Error((data as any)?.error || 'The server could not finish connecting. Check the vendor secret is set.');
  }
}

/**
 * Thrown when the server reports there is no usable token for this vendor — the
 * connection is dead and the user must reconnect. Distinct from "no data today",
 * which is a perfectly normal null.
 */
export class WearableNotConnectedError extends Error {
  constructor(public provider: string, public reason?: string) {
    super(`${provider} is not connected`);
    this.name = 'WearableNotConnectedError';
  }
}

/** Ask the server for today's metrics for a connected cloud vendor. */
export async function fetchVendorDay(id: ProviderId): Promise<any | null> {
  let payload: any;
  try {
    const { data, error } = await supabase.functions.invoke('wearable-day', { body: { provider: id } });
    if (error || !data || (data as any).error) return null;
    payload = data;
  } catch (e) {
    reportError('wearables.fetchDay', e, { provider: id });
    return null;
  }
  if (payload?.connected === false) {
    reportError('wearables.notConnected', payload?.reason || 'no usable token', { provider: id });
    throw new WearableNotConnectedError(id, payload?.reason);
  }
  return payload?.metrics ?? null;
}

/**
 * Actually drop the stored token. This used to be a no-op with a comment claiming
 * revocation happened server-side; nothing deleted the row, so "disconnect" only
 * cleared a local flag and the dead token lingered forever.
 */
export async function disconnectVendor(id: ProviderId): Promise<void> {
  try {
    await supabase.from('wearable_tokens').delete().eq('provider', id);
  } catch (e) {
    reportError('wearables.disconnect', e, { provider: id });
  }
}
