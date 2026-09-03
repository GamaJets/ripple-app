"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALLOWLIST_ADVICE = void 0;
exports.classifySpotifyResponse = classifySpotifyResponse;
exports.networkFailure = networkFailure;
exports.nowPlayingFrom = nowPlayingFrom;
exports.msLabel = msLabel;
exports.progressLine = progressLine;
exports.playlistsFrom = playlistsFrom;
exports.playlistLine = playlistLine;
exports.playlistSavedLine = playlistSavedLine;
/** Spotify's error envelope: { error: { status, message, reason? } }. */
function errorBody(body) {
    if (!body || typeof body !== 'object')
        return {};
    const e = body.error;
    if (!e || typeof e !== 'object')
        return {};
    const message = e.message;
    const reason = e.reason;
    return {
        message: typeof message === 'string' && message ? message : undefined,
        reason: typeof reason === 'string' && reason ? reason : undefined,
    };
}
exports.ALLOWLIST_ADVICE = 'A Spotify app in development mode only works for the accounts on its allowlist — up to 5. ' +
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
function classifySpotifyResponse(status, body) {
    if (status >= 200 && status < 300)
        return null;
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
            message: 'Spotify accepted the sign-in but refused the request (403). ' + exports.ALLOWLIST_ADVICE + tail,
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
function networkFailure(detail) {
    return { kind: 'network', message: 'Could not reach Spotify. Check the connection.' + (detail ? ` (${detail})` : '') };
}
function str(v) {
    return typeof v === 'string' && v.length > 0 ? v : null;
}
function num(v) {
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
function nowPlayingFrom(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const r = raw;
    const item = r.item && typeof r.item === 'object' ? r.item : null;
    const title = item ? str(item.name) : null;
    if (!title)
        return null;
    const artists = item && Array.isArray(item.artists) ? item.artists : [];
    const artist = artists
        .map((a) => (a && typeof a === 'object' ? str(a.name) : null))
        .filter((n) => !!n)
        .join(', ');
    const album = item && item.album && typeof item.album === 'object' ? item.album : null;
    const images = album && Array.isArray(album.images) ? album.images : [];
    const first = images.length && images[0] && typeof images[0] === 'object' ? images[0] : null;
    const device = r.device && typeof r.device === 'object' ? r.device : null;
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
function msLabel(ms) {
    if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0)
        return '—';
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}
/** "1:14 / 3:52", with a dash on either side that Spotify did not report. */
function progressLine(progressMs, durationMs) {
    return `${msLabel(progressMs)} / ${msLabel(durationMs)}`;
}
/**
 * Map Get Current User's Playlists (`GET /v1/me/playlists`) onto the list rows.
 *
 * Spotify pads the `items` array with nulls for playlists the caller can no
 * longer see; those are dropped rather than rendered as blank rows.
 */
function playlistsFrom(raw) {
    if (!raw || typeof raw !== 'object')
        return [];
    const items = raw.items;
    if (!Array.isArray(items))
        return [];
    const out = [];
    for (const it of items) {
        if (!it || typeof it !== 'object')
            continue;
        const p = it;
        const id = str(p.id);
        const name = str(p.name);
        if (!id || !name)
            continue;
        const tracks = p.tracks && typeof p.tracks === 'object' ? p.tracks : null;
        const owner = p.owner && typeof p.owner === 'object' ? p.owner : null;
        const ext = p.external_urls && typeof p.external_urls === 'object' ? p.external_urls : null;
        const images = Array.isArray(p.images) ? p.images : [];
        const first = images.length && images[0] && typeof images[0] === 'object' ? images[0] : null;
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
function playlistLine(p) {
    const count = p.trackCount === null ? '— tracks' : `${p.trackCount} track${p.trackCount === 1 ? '' : 's'}`;
    return p.ownerName ? `${count} · ${p.ownerName}` : count;
}
/**
 * The sentence a member is shown after a playlist is saved.
 *
 * The screen used to announce "…is in your Spotify library" whatever fraction
 * arrived. A twenty-track list could land with eleven tracks in it — some of
 * them different recordings, because the write re-searched every track by
 * `"${title} ${artist}"` text and kept whatever came back first — and the
 * member was told the same thing either way.
 *
 * Two facts, and only when they are true: how many of the tracks are actually
 * there, and how many of those were matched by name rather than taken exactly.
 * A complete, exact save says the short sentence it always said.
 */
function playlistSavedLine(name, r) {
    const head = r.added === r.requested
        ? `${name} is in your Spotify library.`
        : `${name} is in your Spotify library with ${r.added} of its ${r.requested} tracks. Spotify had no match for the other ${r.requested - r.added}.`;
    if (r.guessed === 0)
        return head;
    return `${head} ${r.guessed === 1 ? 'One track was' : `${r.guessed} tracks were`} matched by name, so ${r.guessed === 1 ? 'it may be a different recording' : 'some may be different recordings'}.`;
}
