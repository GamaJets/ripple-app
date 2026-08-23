// Spotify integration (PKCE — public client, no secret, no edge function).
// connect() runs the OAuth flow in a browser and stores the token locally;
// createPlaylist() searches each track and saves a real playlist to the user's
// account via the Web API. Lights up once EXPO_PUBLIC_SPOTIFY_CLIENT_ID is set.
// expo-auth-session is lazy-required so an OTA without it degrades gracefully.
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORE = 'repple.spotify.token';
// Deliberately fixed, not built with appLink(): Spotify matches this against
// the redirect URI registered in its dashboard, so it cannot vary per app.
// Music is a client-app feature, so `repple` is the right scheme for it.
const REDIRECT = 'repple://spotify/callback';
const SCOPES = ['playlist-modify-public', 'playlist-modify-private', 'user-read-email', 'user-read-private'];
const DISCOVERY = { authorizationEndpoint: 'https://accounts.spotify.com/authorize', tokenEndpoint: 'https://accounts.spotify.com/api/token' };

function authSession(): any { try { return require('expo-auth-session'); } catch { return null; } }
function webBrowser(): any { try { return require('expo-web-browser'); } catch { return null; } }

export function spotifyClientId(): string {
  try { return (process.env as any)?.EXPO_PUBLIC_SPOTIFY_CLIENT_ID || ''; } catch { return ''; }
}
export function spotifyConfigured(): boolean { return !!spotifyClientId(); }

interface Stored { access: string; refresh?: string; expiresAt: number; name?: string }
async function load(): Promise<Stored | null> {
  try { const raw = await AsyncStorage.getItem(STORE); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
async function save(s: Stored) { try { await AsyncStorage.setItem(STORE, JSON.stringify(s)); } catch { /* ignore */ } }
export async function spotifyDisconnect() { try { await AsyncStorage.removeItem(STORE); } catch { /* ignore */ } }
export async function spotifyStatus(): Promise<{ connected: boolean; name?: string }> {
  const s = await load();
  return { connected: !!s?.access, name: s?.name };
}

/** Full PKCE connect. Returns the display name on success; throws a clear message. */
export async function connectSpotify(): Promise<{ name?: string }> {
  const clientId = spotifyClientId();
  if (!clientId) throw new Error('Spotify isn’t set up yet — the owner adds EXPO_PUBLIC_SPOTIFY_CLIENT_ID (register an app at developer.spotify.com).');
  const AuthSession = authSession();
  if (!AuthSession) throw new Error('This build can’t open a sign-in browser yet — a native rebuild adds it.');
  const WB = webBrowser(); if (WB?.maybeCompleteAuthSession) { try { WB.maybeCompleteAuthSession(); } catch { /* ignore */ } }

  const request = new AuthSession.AuthRequest({ clientId, scopes: SCOPES, redirectUri: REDIRECT, usePKCE: true, responseType: 'code' });
  await request.makeAuthUrlAsync(DISCOVERY);
  const result = await request.promptAsync(DISCOVERY);
  if (!result || result.type !== 'success' || !result.params?.code) {
    throw new Error(result?.type === 'dismiss' || result?.type === 'cancel' ? 'Sign-in cancelled.' : 'Could not complete Spotify sign-in.');
  }
  const tok = await AuthSession.exchangeCodeAsync(
    { clientId, code: result.params.code, redirectUri: REDIRECT, extraParams: { code_verifier: request.codeVerifier ?? '' } },
    DISCOVERY,
  );
  if (!tok?.accessToken) throw new Error('Spotify token exchange failed.');
  const stored: Stored = { access: tok.accessToken, refresh: tok.refreshToken, expiresAt: Date.now() + (tok.expiresIn ?? 3600) * 1000 };
  try {
    const me = await (await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: 'Bearer ' + stored.access } })).json();
    stored.name = me?.display_name || me?.id;
  } catch { /* name optional */ }
  await save(stored);
  return { name: stored.name };
}

async function validToken(): Promise<string | null> {
  const s = await load();
  if (!s?.access) return null;
  if (s.expiresAt > Date.now() + 60000) return s.access;
  // Refresh (PKCE refresh needs only client_id).
  const AuthSession = authSession();
  if (!AuthSession || !s.refresh) return s.access; // best effort
  try {
    const tok = await AuthSession.refreshAsync({ clientId: spotifyClientId(), refreshToken: s.refresh }, DISCOVERY);
    if (tok?.accessToken) {
      const next: Stored = { ...s, access: tok.accessToken, refresh: tok.refreshToken ?? s.refresh, expiresAt: Date.now() + (tok.expiresIn ?? 3600) * 1000 };
      await save(next); return next.access;
    }
  } catch { /* fall through */ }
  return s.access;
}

/** Search Spotify for real tracks matching workout query seeds — varied, de-duped,
 * offset-rotated by salt so each generate pulls a fresh set from the live catalog. */
export async function spotifySearchTracks(queries: string[], want: number, salt: number): Promise<{ title: string; artist: string }[]> {
  const token = await validToken();
  if (!token) return [];
  const h = { Authorization: 'Bearer ' + token };
  const out: { title: string; artist: string }[] = [];
  const seen = new Set<string>();
  for (let qi = 0; qi < queries.length && out.length < want; qi++) {
    const offset = Math.min(950, ((salt * 3 + qi * 5) % 19) * 50);
    try {
      const q = encodeURIComponent(queries[qi]);
      const r = await (await fetch(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=50&offset=${offset}`, { headers: h })).json();
      const items = r?.tracks?.items ?? [];
      for (const it of items) {
        const id = it?.id; if (!id || seen.has(id) || !it?.name) continue;
        seen.add(id);
        out.push({ title: it.name, artist: (it.artists ?? []).map((a: any) => a.name).filter(Boolean).join(', ') });
        if (out.length >= want) break;
      }
    } catch { /* skip this query */ }
  }
  return out;
}

/** Create a playlist in the user's account from {title, artist} tracks. */
export async function createSpotifyPlaylist(name: string, tracks: { title: string; artist: string }[]): Promise<string> {
  const token = await validToken();
  if (!token) throw new Error('Connect Spotify first.');
  const h = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const me = await (await fetch('https://api.spotify.com/v1/me', { headers: h })).json();
  if (!me?.id) throw new Error('Could not read your Spotify profile.');
  const pl = await (await fetch(`https://api.spotify.com/v1/users/${me.id}/playlists`, {
    method: 'POST', headers: h, body: JSON.stringify({ name, description: 'Built by Repple', public: false }),
  })).json();
  if (!pl?.id) throw new Error('Could not create the playlist.');
  const uris: string[] = [];
  for (const tr of tracks) {
    try {
      const q = encodeURIComponent(`${tr.title} ${tr.artist}`);
      const s = await (await fetch(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=1`, { headers: h })).json();
      const uri = s?.tracks?.items?.[0]?.uri; if (uri) uris.push(uri);
    } catch { /* skip track */ }
  }
  if (uris.length) {
    await fetch(`https://api.spotify.com/v1/playlists/${pl.id}/tracks`, { method: 'POST', headers: h, body: JSON.stringify({ uris }) });
  }
  return pl.external_urls?.spotify || `https://open.spotify.com/playlist/${pl.id}`;
}
