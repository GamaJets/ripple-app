// ── Spotify: turning a response into something a person can act on ───────────
//
// This file exists because of TF-34, "Spotify won't connect". The connect flow
// itself was fine — the token exchange succeeded. What failed was every call
// afterwards, and nothing told anyone. A Spotify app in *development mode*
// lets any Spotify account log in and hands back a perfectly valid token, then
// answers 403 to every Web API request from an account that is not on the
// app's allowlist. Spotify's own documentation says so in as many words:
// "Users may be able to log into a development mode app without having been
// allowlisted by the developer. However, API requests with an access token
// associated to that user and app will receive a 403 status code error."
// (developer.spotify.com/documentation/web-api/concepts/quota-modes, read
// 29 Aug 2026.)
//
// So the app stored a token, said "Connected", and then quietly did nothing —
// the exact failure mode this codebase is built to refuse. A 403 has to name
// the allowlist, and a 404 from the player has to say "no device is playing"
// rather than vanishing into a catch block.
//
// Pure and UI-free on purpose: no fetch, no react-native, no storage. It maps
// (status, body) → a named failure and maps documented response shapes → view
// models, so both are testable under plain node. See spotifyPlayback.test.ts.
//
// The response shapes below are transcribed from Spotify's published reference
// for Get Playback State and Get Current User's Playlists. They were NOT
// observed against a live account — verifying that would need a real Spotify
// login, which nothing here does. Every field is therefore read defensively
// and anything missing stays null rather than becoming a zero.

/** What went wrong, in terms the UI can act on rather than a bare status code. */
export type SpotifyFailureKind =
  | 'not_configured'      // no client id in the build at all
  | 'cancelled'           // person closed the sign-in browser
  | 'redirect_rejected'   // Spotify never redirected back — bad/unregistered redirect URI
  | 'signed_out'          // 401: token dead, reconnect
  | 'not_allowlisted'     // 403: development-mode allowlist, the TF-34 cause
  | 'premium_required'    // 403 PREMIUM_REQUIRED: playback control needs Premium
  | 'no_device'           // 404 NO_ACTIVE_DEVICE: nothing to control
  | 'rate_limited'        // 429
  | 'network'             // request never completed
  | 'unknown';

export interface SpotifyFailure {
  kind: SpotifyFailureKind;
  /** Shown to the person. Always names what is wrong and who can fix it. */
  message: string;
  /** HTTP status when the failure came from a response. */
  status?: number;
}

/** Spotify's error envelope: { error: { status, message, reason? } }. */
function errorBody(body: unknown): { message?: string; reason?: string } {
  if (!body || typeof body !== 'object') return {};
  const e = (body as { error?: unknown }).error;
  if (!e || typeof e !== 'object') return {};
  const message = (e as { message?: unknown }).message;
  const reason = (e as { reason?: unknown }).reason;
  return {
    message: typeof message === 'string' && message ? message : undefined,
    reason: typeof reason === 'string' && reason ? reason : undefined,
  };
}

export const ALLOWLIST_ADVICE =
  'A Spotify app in development mode only works for the accounts on its allowlist — up to 5. ' +
  'The owner adds this Spotify account in the Spotify developer dashboard under the app’s Settings → User Management.';

/**
 * Classify one Spotify Web API response. Returns null when the response is a
 * success, so a caller reads as `const bad = classifySpotifyResponse(...); if (bad) throw ...`.
 *
 * 403 is deliberately reported as the allowlist first. It is not the only thing
 * a 403 can mean, but it is overwhelmingly the one that bites a TestFlight
 * tester on a development-mode app, and Spotify's own message is appended
 * verbatim so a different cause is still legible rather than hidden behind our
 * guess.
 */
export function classifySpotifyResponse(status: number, body?: unknown): SpotifyFailure | null {
  if (status >= 200 && status < 300) return null;
  const { message, reason } = errorBody(body);
  const tail = message ? ` Spotify said: “${message}”.` : '';

  if (status === 401) {
    return { kind: 'signed_out', status, message: 'Spotify signed you out. Connect Spotify again.' + tail };
  }
  if (status === 403) {
    if (reason === 'PREMIUM_REQUIRED') {
      return { kind: 'premium_required', status, message: 'Controlling playback needs Spotify Premium. Your playlists still load.' + tail };
    }
    return {
      kind: 'not_allowlisted',
      status,
      message: 'Spotify accepted the sign-in but refused the request (403). ' + ALLOWLIST_ADVICE + tail,
    };
  }
  if (status === 404) {
    if (reason === 'NO_ACTIVE_DEVICE') {
      return { kind: 'no_device', status, message: 'No Spotify device is playing. Start a track in the Spotify app, then come back.' + tail };
    }
    return { kind: 'unknown', status, message: 'Spotify could not find that (404).' + tail };
  }
  if (status === 429) {
    return { kind: 'rate_limited', status, message: 'Spotify is rate-limiting this app. Try again in a minute.' + tail };
  }
  return { kind: 'unknown', status, message: `Spotify returned ${status}.` + tail };
}

/** What the transport layer reports when the request never got an answer at all. */
export function networkFailure(detail?: string): SpotifyFailure {
  return { kind: 'network', message: 'Could not reach Spotify. Check the connection.' + (detail ? ` (${detail})` : '') };
}

// ── Now playing ──────────────────────────────────────────────────────────────

export interface NowPlaying {
  title: string;
  artist: string | null;
  isPlaying: boolean;
  deviceName: string | null;
  /** null when Spotify did not report it — rendered as a dash, never as 0:00. */
  progressMs: number | null;
  durationMs: number | null;
  artUrl: string | null;
  uri: string | null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Map Get Playback State (`GET /v1/me/player`) onto the bar's view model.
 *
 * Returns null for "nothing is playing", which Spotify signals with 204 and an
 * empty body — the caller passes null in that case. A payload that has a device
 * but no `item` is also null: there is a device, but no track to name, and
 * inventing one is exactly the thing this app does not do.
 */
export function nowPlayingFrom(raw: unknown): NowPlaying | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const item = r.item && typeof r.item === 'object' ? (r.item as Record<string, unknown>) : null;
  const title = item ? str(item.name) : null;
  if (!title) return null;

  const artists = item && Array.isArray(item.artists) ? item.artists : [];
  const artist = artists
    .map((a) => (a && typeof a === 'object' ? str((a as Record<string, unknown>).name) : null))
    .filter((n): n is string => !!n)
    .join(', ');

  const album = item && item.album && typeof item.album === 'object' ? (item.album as Record<string, unknown>) : null;
  const images = album && Array.isArray(album.images) ? album.images : [];
  const first = images.length && images[0] && typeof images[0] === 'object' ? (images[0] as Record<string, unknown>) : null;

  const device = r.device && typeof r.device === 'object' ? (r.device as Record<string, unknown>) : null;

  return {
    title,
    artist: artist || null,
    isPlaying: r.is_playing === true,
    deviceName: device ? str(device.name) : null,
    progressMs: num(r.progress_ms),
    durationMs: item ? num(item.duration_ms) : null,
    artUrl: first ? str(first.url) : null,
    uri: item ? str(item.uri) : null,
  };
}

/** m:ss, or a dash when the record cannot support a figure. */
export function msLabel(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/** "1:14 / 3:52", with a dash on either side that Spotify did not report. */
export function progressLine(progressMs: number | null, durationMs: number | null): string {
  return `${msLabel(progressMs)} / ${msLabel(durationMs)}`;
}

// ── The person's own playlists ───────────────────────────────────────────────

export interface PlaylistRef {
  id: string;
  name: string;
  /** null when Spotify omitted tracks.total. A playlist of unknown length is not an empty one. */
  trackCount: number | null;
  ownerName: string | null;
  url: string | null;
  uri: string | null;
  artUrl: string | null;
}

/**
 * Map Get Current User's Playlists (`GET /v1/me/playlists`) onto the list rows.
 *
 * Spotify pads the `items` array with nulls for playlists the caller can no
 * longer see; those are dropped rather than rendered as blank rows.
 */
export function playlistsFrom(raw: unknown): PlaylistRef[] {
  if (!raw || typeof raw !== 'object') return [];
  const items = (raw as Record<string, unknown>).items;
  if (!Array.isArray(items)) return [];
  const out: PlaylistRef[] = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const p = it as Record<string, unknown>;
    const id = str(p.id);
    const name = str(p.name);
    if (!id || !name) continue;
    const tracks = p.tracks && typeof p.tracks === 'object' ? (p.tracks as Record<string, unknown>) : null;
    const owner = p.owner && typeof p.owner === 'object' ? (p.owner as Record<string, unknown>) : null;
    const ext = p.external_urls && typeof p.external_urls === 'object' ? (p.external_urls as Record<string, unknown>) : null;
    const images = Array.isArray(p.images) ? p.images : [];
    const first = images.length && images[0] && typeof images[0] === 'object' ? (images[0] as Record<string, unknown>) : null;
    out.push({
      id,
      name,
      trackCount: tracks ? num(tracks.total) : null,
      ownerName: owner ? str(owner.display_name) : null,
      url: ext ? str(ext.spotify) : null,
      uri: str(p.uri),
      artUrl: first ? str(first.url) : null,
    });
  }
  return out;
}

/** "24 tracks · Tim", with a dash where the record is silent. */
export function playlistLine(p: PlaylistRef): string {
  const count = p.trackCount === null ? '— tracks' : `${p.trackCount} track${p.trackCount === 1 ? '' : 's'}`;
  return p.ownerName ? `${count} · ${p.ownerName}` : count;
}
