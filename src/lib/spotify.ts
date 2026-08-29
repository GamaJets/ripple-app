// ── Spotify (PKCE — public client, no secret, no edge function) ──────────────
//
// connect() runs the OAuth flow in a browser and stores the token locally. The
// rest of this file is the Web API surface the music screen and the in-session
// bar need: the person's own playlists, search, playlist creation, and playback
// control.
//
// TF-34, "Spotify won't connect", was reported against the previous version of
// this file, and the connect flow was not what failed. The token exchange
// succeeded; every request after it did not, and nothing said so:
//
//   · connectSpotify() called /v1/me only to pick up a display name, inside a
//     try/catch that swallowed everything. A 403 is a perfectly well-formed
//     JSON body, so .json() did not throw, `name` was simply left undefined,
//     the dead token was SAVED, and the screen flipped to "Connected".
//   · spotifySearchTracks() returned [] on any error, and the screen quietly
//     served the curated fallback pool instead — so "from your Spotify" tracks
//     were nothing of the kind.
//   · validToken() returned a known-expired token as "best effort" when the
//     refresh failed, guaranteeing a 401 further down with no way back.
//
// Three separate places where an operation appeared to succeed and had not.
// Every one of them now names what went wrong; see spotifyPlayback.ts for the
// classification and the reason a 403 points at the development-mode allowlist.
//
// expo-auth-session is lazy-required so an OTA without it degrades gracefully.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  classifySpotifyResponse, networkFailure, nowPlayingFrom, playlistsFrom,
  type SpotifyFailure, type SpotifyFailureKind, type NowPlaying, type PlaylistRef,
} from './spotifyPlayback';

const STORE = 'repple.spotify.token';

// Deliberately fixed, not built with appLink(): Spotify matches this against
// the redirect URI registered in its dashboard, so it cannot vary per app.
// Music is a client-app feature, so `repple` is the right scheme for it.
//
// Custom schemes are still accepted — Spotify's Feb 2025 security post says so
// explicitly ("Redirects using a custom scheme will still be supported") while
// dropping plain http for everything but loopback literals. If Spotify ever
// refuses this one it does NOT redirect back; it renders an error page in the
// browser and the person closes it, which arrives here as a "dismiss". That is
// why a dismiss no longer just says "cancelled" — see connectSpotify.
export const SPOTIFY_REDIRECT = 'repple://spotify/callback';

// Scopes. The first four were all the old build asked for, which is why real
// playlists and in-session control were impossible: reading the person's own
// playlists needs playlist-read-private, and the player endpoints need the
// user-*-playback-state pair. Widening the set invalidates tokens minted under
// the old one — Spotify does not retro-grant scopes — so the granted set is
// stored alongside the token and a token missing any of these is treated as a
// reconnect rather than as a mysterious 403 later on.
const SCOPES = [
  'playlist-modify-public', 'playlist-modify-private', 'user-read-email', 'user-read-private',
  'playlist-read-private', 'playlist-read-collaborative',
  'user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing',
];

const DISCOVERY = { authorizationEndpoint: 'https://accounts.spotify.com/authorize', tokenEndpoint: 'https://accounts.spotify.com/api/token' };
const API = 'https://api.spotify.com/v1';

function authSession(): any { try { return require('expo-auth-session'); } catch { return null; } }
function webBrowser(): any { try { return require('expo-web-browser'); } catch { return null; } }

/** Carries the classified reason so the UI can say something specific. */
export class SpotifyError extends Error {
  constructor(public kind: SpotifyFailureKind, message: string, public status?: number) {
    super(message);
    this.name = 'SpotifyError';
  }
}
function raise(f: SpotifyFailure): never { throw new SpotifyError(f.kind, f.message, f.status); }

export function spotifyClientId(): string {
  try { return (process.env as any)?.EXPO_PUBLIC_SPOTIFY_CLIENT_ID || ''; } catch { return ''; }
}
export function spotifyConfigured(): boolean { return !!spotifyClientId(); }

interface Stored { access: string; refresh?: string; expiresAt: number; name?: string; scopes?: string[] }
async function load(): Promise<Stored | null> {
  try { const raw = await AsyncStorage.getItem(STORE); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
async function save(s: Stored) { try { await AsyncStorage.setItem(STORE, JSON.stringify(s)); } catch { /* ignore */ } }
export async function spotifyDisconnect() { try { await AsyncStorage.removeItem(STORE); } catch { /* ignore */ } }

function missingScopes(granted: string[] | undefined): string[] {
  if (!granted || !granted.length) return [];   // pre-scope-tracking token: assume nothing, test it live instead
  return SCOPES.filter((s) => granted.indexOf(s) === -1);
}

export interface SpotifyStatus {
  connected: boolean;
  name?: string;
  /** True when the stored token predates the wider scope set and must be re-granted. */
  needsReconnect: boolean;
  /** Which permissions the stored token is missing, so the UI can say why. */
  missing: string[];
}
export async function spotifyStatus(): Promise<SpotifyStatus> {
  const s = await load();
  if (!s?.access) return { connected: false, needsReconnect: false, missing: [] };
  const missing = missingScopes(s.scopes);
  return { connected: true, name: s.name, needsReconnect: missing.length > 0, missing };
}

/**
 * Full PKCE connect. Returns the display name on success and throws a
 * SpotifyError that names the actual problem otherwise.
 *
 * The /v1/me call at the end is a REQUIRED verification, not a nicety. It is
 * the only thing standing between a tester and a stored token that 403s
 * forever while the screen says "Connected".
 */
export async function connectSpotify(): Promise<{ name?: string }> {
  const clientId = spotifyClientId();
  if (!clientId) {
    raise({ kind: 'not_configured', message: 'Spotify isn’t set up in this build — the owner sets EXPO_PUBLIC_SPOTIFY_CLIENT_ID (register an app at developer.spotify.com).' });
  }
  const AuthSession = authSession();
  if (!AuthSession) {
    raise({ kind: 'unknown', message: 'This build can’t open a sign-in browser yet — a native rebuild adds it.' });
  }
  const WB = webBrowser(); if (WB?.maybeCompleteAuthSession) { try { WB.maybeCompleteAuthSession(); } catch { /* ignore */ } }

  const request = new AuthSession.AuthRequest({ clientId, scopes: SCOPES, redirectUri: SPOTIFY_REDIRECT, usePKCE: true, responseType: 'code' });
  await request.makeAuthUrlAsync(DISCOVERY);
  const result = await request.promptAsync(DISCOVERY);

  if (!result || result.type !== 'success' || !result.params?.code) {
    // Spotify reports a refused request two different ways and they need
    // different words. If it redirected back with ?error= we can quote it. If
    // it refused the redirect URI itself it never redirects at all — it draws
    // an error page, the person closes the browser, and that arrives here
    // indistinguishably from "changed my mind". Naming the exact URI is what
    // lets the owner compare it against the dashboard in ten seconds.
    const err = result?.params?.error_description || result?.params?.error || (result as any)?.error?.message;
    if (err) raise({ kind: 'unknown', message: `Spotify refused the sign-in: ${err}` });
    if (result?.type === 'dismiss' || result?.type === 'cancel') {
      raise({
        kind: 'cancelled',
        message: 'Sign-in closed before it finished. If Spotify showed an error page instead of a login, the redirect URI is not registered — it must be exactly ' + SPOTIFY_REDIRECT + ' in the Spotify developer dashboard.',
      });
    }
    raise({ kind: 'redirect_rejected', message: 'Spotify never came back to the app. Check that ' + SPOTIFY_REDIRECT + ' is registered as a redirect URI in the Spotify developer dashboard.' });
  }

  let tok: any;
  try {
    tok = await AuthSession.exchangeCodeAsync(
      { clientId, code: result.params.code, redirectUri: SPOTIFY_REDIRECT, extraParams: { code_verifier: request.codeVerifier ?? '' } },
      DISCOVERY,
    );
  } catch (e: any) {
    raise({ kind: 'unknown', message: 'Spotify rejected the token exchange: ' + (e?.message || 'no reason given') + '. This is usually a redirect URI that does not match ' + SPOTIFY_REDIRECT + ' exactly.' });
  }
  if (!tok?.accessToken) raise({ kind: 'unknown', message: 'Spotify returned no access token.' });

  // Spotify echoes the scopes it actually granted; fall back to what we asked
  // for only if it says nothing, so a partial grant is not recorded as a full one.
  const granted: string[] = typeof tok.scope === 'string' && tok.scope ? tok.scope.split(' ') : SCOPES.slice();

  // Verify before storing. A token that cannot read the profile it belongs to
  // is not a connection, whatever the exchange said.
  let me: any;
  try {
    const res = await fetch(API + '/me', { headers: { Authorization: 'Bearer ' + tok.accessToken } });
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    const bad = classifySpotifyResponse(res.status, body);
    if (bad) raise(bad);
    me = body;
  } catch (e: any) {
    if (e instanceof SpotifyError) throw e;
    raise(networkFailure(e?.message));
  }

  const stored: Stored = {
    access: tok.accessToken,
    refresh: tok.refreshToken,
    expiresAt: Date.now() + (tok.expiresIn ?? 3600) * 1000,
    name: me?.display_name || me?.id || undefined,
    scopes: granted,
  };
  await save(stored);
  return { name: stored.name };
}

/**
 * A token that is known to be live, or a thrown reason why there isn't one.
 *
 * The old version returned an expired token when the refresh failed and called
 * it best effort. It is not: it guarantees a 401 in the next call, several
 * layers away from the thing that actually went wrong.
 */
async function tokenOrThrow(): Promise<string> {
  const s = await load();
  if (!s?.access) raise({ kind: 'signed_out', message: 'Connect Spotify first.' });
  if (s.expiresAt > Date.now() + 60000) return s.access;

  const AuthSession = authSession();
  if (AuthSession && s.refresh) {
    try {
      const tok = await AuthSession.refreshAsync({ clientId: spotifyClientId(), refreshToken: s.refresh }, DISCOVERY);
      if (tok?.accessToken) {
        const next: Stored = { ...s, access: tok.accessToken, refresh: tok.refreshToken ?? s.refresh, expiresAt: Date.now() + (tok.expiresIn ?? 3600) * 1000 };
        await save(next);
        return next.access;
      }
    } catch { /* fall through to the honest answer below */ }
  }
  raise({ kind: 'signed_out', message: 'Your Spotify session expired and could not be renewed. Connect Spotify again.' });
}

/** One Web API call, with the failure classified rather than swallowed. */
async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T | null> {
  const token = await tokenOrThrow();
  const headers: Record<string, string> = { Authorization: 'Bearer ' + token };
  if (init?.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(API + path, {
      method: init?.method || 'GET',
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (e: any) {
    raise(networkFailure(e?.message));
  }
  // 204 is a real answer from the player endpoints: "nothing is playing", or
  // "the command was accepted". It carries no body.
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  const bad = classifySpotifyResponse(res.status, body);
  if (bad) raise(bad);
  return body as T | null;
}

// ── the person's own playlists (TF-35) ───────────────────────────────────────

/**
 * The playlists in this Spotify account. Real, theirs, paged to the API's
 * documented maximum of 50 per request.
 *
 * Note what this deliberately does NOT call: Get Featured Playlists and Get
 * Category's Playlists were restricted for development-mode apps on 27 Nov
 * 2024, along with Recommendations and Audio Features. Building "real
 * playlists" on any of those would 404/403 for this app forever.
 */
export async function spotifyMyPlaylists(limit = 50): Promise<PlaylistRef[]> {
  const body = await api<unknown>(`/me/playlists?limit=${Math.min(50, Math.max(1, limit))}`);
  return playlistsFrom(body);
}

/** The tracks inside one of the person's playlists, as {title, artist, uri}. */
export async function spotifyPlaylistTracks(playlistId: string, limit = 100): Promise<{ title: string; artist: string; uri: string | null }[]> {
  const body = await api<any>(`/playlists/${encodeURIComponent(playlistId)}/tracks?limit=${Math.min(100, Math.max(1, limit))}`);
  const items = Array.isArray(body?.items) ? body.items : [];
  const out: { title: string; artist: string; uri: string | null }[] = [];
  for (const it of items) {
    const tr = it?.track;
    if (!tr?.name) continue;   // local files and removed tracks come back as null
    out.push({
      title: tr.name,
      artist: (tr.artists ?? []).map((a: any) => a?.name).filter(Boolean).join(', '),
      uri: typeof tr.uri === 'string' ? tr.uri : null,
    });
  }
  return out;
}

// ── playback control (TF-36) ─────────────────────────────────────────────────

export interface SpotifyDevice { id: string | null; name: string; isActive: boolean; type: string | null }

/** Spotify Connect devices this account can play on. */
export async function spotifyDevices(): Promise<SpotifyDevice[]> {
  const body = await api<any>('/me/player/devices');
  const list = Array.isArray(body?.devices) ? body.devices : [];
  return list.filter((d: any) => typeof d?.name === 'string').map((d: any) => ({
    id: typeof d.id === 'string' ? d.id : null,
    name: d.name,
    isActive: d.is_active === true,
    type: typeof d.type === 'string' ? d.type : null,
  }));
}

/** What is playing right now, or null when Spotify answers 204 — nothing is. */
export async function spotifyNowPlaying(): Promise<NowPlaying | null> {
  const body = await api<unknown>('/me/player');
  return nowPlayingFrom(body);
}

/**
 * Resume, or start a specific playlist/track set.
 *
 * Every player command needs Premium and a device Spotify already knows about;
 * without one it answers 404 NO_ACTIVE_DEVICE, which reaches the UI as its own
 * state rather than as a button that did nothing.
 */
export async function spotifyPlay(opts?: { contextUri?: string; uris?: string[]; deviceId?: string | null }): Promise<void> {
  const q = opts?.deviceId ? `?device_id=${encodeURIComponent(opts.deviceId)}` : '';
  const body: Record<string, unknown> = {};
  if (opts?.contextUri) body.context_uri = opts.contextUri;
  if (opts?.uris?.length) body.uris = opts.uris;
  await api(`/me/player/play${q}`, { method: 'PUT', body: Object.keys(body).length ? body : {} });
}
export async function spotifyPause(): Promise<void> { await api('/me/player/pause', { method: 'PUT' }); }
export async function spotifyNext(): Promise<void> { await api('/me/player/next', { method: 'POST' }); }
export async function spotifyPrevious(): Promise<void> { await api('/me/player/previous', { method: 'POST' }); }

/** Move playback to a device, so "no active device" is recoverable in-app. */
export async function spotifyTransfer(deviceId: string, startPlaying = true): Promise<void> {
  await api('/me/player', { method: 'PUT', body: { device_ids: [deviceId], play: startPlaying } });
}

// ── search and playlist creation ─────────────────────────────────────────────

/**
 * Search the live catalog for workout-shaped queries — varied, de-duped,
 * offset-rotated by salt so each generate pulls a fresh set.
 *
 * This used to return [] on any failure, and the caller took an empty result as
 * "nothing matched" and served the curated fallback pool labelled as Spotify's.
 * It now throws, because a 403 here is the single most likely thing a TestFlight
 * tester hits and it needs to be said out loud.
 */
export async function spotifySearchTracks(queries: string[], want: number, salt: number): Promise<{ title: string; artist: string; uri: string | null }[]> {
  const out: { title: string; artist: string; uri: string | null }[] = [];
  const seen = new Set<string>();
  for (let qi = 0; qi < queries.length && out.length < want; qi++) {
    const offset = Math.min(950, ((salt * 3 + qi * 5) % 19) * 50);
    const q = encodeURIComponent(queries[qi]);
    const r = await api<any>(`/search?q=${q}&type=track&limit=50&offset=${offset}`);
    const items = r?.tracks?.items ?? [];
    for (const it of items) {
      const id = it?.id; if (!id || seen.has(id) || !it?.name) continue;
      seen.add(id);
      out.push({
        title: it.name,
        artist: (it.artists ?? []).map((a: any) => a?.name).filter(Boolean).join(', '),
        uri: typeof it.uri === 'string' ? it.uri : null,
      });
      if (out.length >= want) break;
    }
  }
  return out;
}

/** Create a playlist in the account from {title, artist} tracks. Returns its URL. */
export async function createSpotifyPlaylist(name: string, tracks: { title: string; artist: string }[]): Promise<string> {
  const me = await api<any>('/me');
  if (!me?.id) raise({ kind: 'unknown', message: 'Spotify did not return a profile id.' });
  const pl = await api<any>(`/users/${encodeURIComponent(me.id)}/playlists`, {
    method: 'POST', body: { name, description: 'Built by Repple', public: false },
  });
  if (!pl?.id) raise({ kind: 'unknown', message: 'Spotify did not return a playlist id.' });

  const uris: string[] = [];
  for (const tr of tracks) {
    const q = encodeURIComponent(`${tr.title} ${tr.artist}`);
    const s = await api<any>(`/search?q=${q}&type=track&limit=1`);
    const uri = s?.tracks?.items?.[0]?.uri;
    if (uri) uris.push(uri);
  }
  // Say so rather than reporting a saved playlist that has nothing in it.
  if (!uris.length) {
    raise({ kind: 'unknown', message: `“${name}” was created but Spotify matched none of its ${tracks.length} tracks, so it is empty.` });
  }
  await api(`/playlists/${encodeURIComponent(pl.id)}/tracks`, { method: 'POST', body: { uris } });
  return pl.external_urls?.spotify || `https://open.spotify.com/playlist/${pl.id}`;
}

export type { NowPlaying, PlaylistRef };
