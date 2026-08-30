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
import { classifyRefusal } from '../wearableLink';
import { accountProvenAlive, noteMetric, noteReauthorised, noteTokenAlive, noteTokenDead } from '../wearableLinkLedger';

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
  // The token behind every stored verdict has just been replaced, so every
  // verdict about it is now about something that no longer exists. Clearing
  // them here — rather than waiting for the next read to overwrite them one at
  // a time — is what makes a reconnect resolve on EVERY screen at once, which
  // is the third of the four reports: the client did exactly what the app asked
  // and the app carried on asking.
  noteReauthorised(id);
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
    // The daily roll-up is not scoped to one metric, so a refusal here is
    // always about the token itself. Written down so that a LATER refusal on a
    // single metric endpoint can be told apart from this one.
    noteTokenDead(id, classifyRefusal(payload?.reason, false).why);
    throw new WearableNotConnectedError(id, payload?.reason);
  }
  // The server used this token and the vendor answered. This is the evidence
  // that lets a 403 on one endpoint be read as a scope gap rather than as a
  // disconnected account.
  noteTokenAlive(id);
  return payload?.metrics ?? null;
}

/** Recent workouts from a cloud vendor, for importing into the training log. */
export async function fetchVendorWorkouts(id: ProviderId, sinceDays = 14): Promise<any[]> {
  try {
    const { data, error } = await supabase.functions.invoke('wearable-day', {
      body: { provider: id, action: 'workouts', sinceDays },
    });
    if (error || !data) return [];
    if ((data as any).connected === false) {
      noteTokenDead(id, classifyRefusal((data as any).reason, false).why);
      throw new WearableNotConnectedError(id, (data as any).reason);
    }
    noteTokenAlive(id);
    return Array.isArray((data as any).workouts) ? (data as any).workouts : [];
  } catch (e) {
    if (e instanceof WearableNotConnectedError) throw e;
    reportError('wearables.fetchWorkouts', e, { provider: id });
    return [];
  }
}

/**
 * How a cloud sleep read went, before anything has been parsed.
 *
 * FOUR cases now, and they must stay four all the way to the screen. `ok` with
 * an empty `records` list is a real answer — the vendor was asked and holds no
 * sleep for the window — while a plain `ok: false` means we asked and got
 * nothing back, which makes the night unknown rather than empty. A dead token
 * is neither: it throws `WearableNotConnectedError`, because the fix is the
 * user reconnecting and no amount of waiting will produce the night.
 *
 * `refused` is the fourth, and it is the one build 35 was missing. The vendor's
 * SLEEP endpoint said 401/403 while the same token is serving every other
 * request in the app — a scope this build never asked for, not a connection
 * that has died. It has to be a distinct case because its two neighbours are
 * both wrong about it: reported as a dead token it tells the client their
 * working WHOOP is disconnected (four TestFlight reports), and reported as an
 * ordinary failure it tells them to wait for something that will never fix
 * itself.
 */
export type VendorSleepResult =
  | { ok: true; records: any[] }
  | { ok: false; refused?: boolean; reason: string };

/**
 * Ask the server for recent sleep from a connected cloud vendor.
 *
 * Unlike `fetchVendorDay`, a failure here is NOT flattened to null. Null would
 * reach the merge as "this device recorded nothing", and the whole point of
 * TF-01 is that a night we failed to read and a night nobody slept must not
 * look the same on the Recovery screen.
 */
export async function fetchVendorSleep(id: ProviderId, sinceDays = 7): Promise<VendorSleepResult> {
  let payload: any;
  try {
    const { data, error } = await supabase.functions.invoke('wearable-day', {
      body: { provider: id, action: 'sleep', sinceDays },
    });
    if (error) {
      reportError('wearables.fetchSleep.invoke', error, { provider: id });
      return { ok: false, reason: 'Repple could not reach the server to read this device.' };
    }
    payload = data;
  } catch (e) {
    reportError('wearables.fetchSleep.invoke', e, { provider: id });
    return { ok: false, reason: 'Repple could not reach the server to read this device.' };
  }
  if (payload?.connected === false) {
    // The one place the two meanings of `connected: false` are pulled apart.
    //
    // The edge function cannot tell them apart — from inside one request, a
    // token it cannot use and an endpoint that refused it look identical, so it
    // sends `connected: false` for both. We can, because we know whether the
    // SAME token has already served the daily roll-up. If it has, this refusal
    // belongs to the sleep endpoint alone and the account is untouched.
    const refusal = classifyRefusal(payload?.reason, accountProvenAlive(id));
    if (refusal.level === 'metric') {
      reportError('wearables.sleepScopeRefused', payload?.reason || 'sleep endpoint refused', { provider: id });
      noteMetric(id, 'sleep', { kind: 'refused', at: Date.now() });
      return { ok: false, refused: true, reason: String(payload?.reason || 'sleep endpoint refused') };
    }
    reportError('wearables.notConnected', payload?.reason || 'no usable token', { provider: id });
    noteTokenDead(id, refusal.why);
    throw new WearableNotConnectedError(id, payload?.reason);
  }
  const sleep = payload?.sleep;
  // An older deploy of `wearable-day` does not know the 'sleep' action and
  // answers with the daily metrics instead. That response has no `sleep` key at
  // all, and reading it as an empty night would tell the client their ring
  // recorded nothing when the server was never asked the question.
  if (!sleep || typeof sleep !== 'object') {
    return { ok: false, reason: 'The server did not answer with sleep for this device.' };
  }
  if (sleep.ok === true) {
    // The vendor answered on this endpoint, on this token. Both facts are worth
    // recording: it clears a stale 'refused' verdict the moment a re-authorised
    // connection starts working, which is what "reconnecting must visibly
    // resolve" comes down to.
    noteTokenAlive(id);
    noteMetric(id, 'sleep', { kind: 'ok', at: Date.now() });
    return { ok: true, records: Array.isArray(sleep.records) ? sleep.records : [] };
  }
  // A non-2xx that was NOT 401/403 — the vendor is down, or we sent something
  // it did not like. The token is not implicated either way, so no verdict is
  // written: the night is unknown, and that is all this proves.
  return { ok: false, reason: String(sleep.reason || 'unknown') };
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
  // Whatever we knew about that token was about a row that is now gone. Left in
  // place it would outlive its subject and put a "reconnect WHOOP" sentence in
  // front of somebody who has just deliberately removed WHOOP.
  noteTokenDead(id, 'no-token');
}
