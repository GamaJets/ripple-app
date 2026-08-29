// Pure-logic tests for the Spotify response mapping. Compile with tsc, run with node.
//
// The cases below are the ones that produced TF-34 in the field: a token that
// works for sign-in and 403s on every request, and a player call that answers
// 404 because nothing is playing. Both used to be swallowed.
import {
  classifySpotifyResponse, networkFailure, nowPlayingFrom, msLabel, progressLine,
  playlistsFrom, playlistLine, ALLOWLIST_ADVICE,
} from './spotifyPlayback';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

// ── classification ──
ok(classifySpotifyResponse(200, {}) === null, '200 is not a failure');
ok(classifySpotifyResponse(204) === null, '204 (nothing playing) is not a failure');

const forbidden = classifySpotifyResponse(403, { error: { status: 403, message: 'Forbidden' } });
ok(forbidden?.kind === 'not_allowlisted', 'a plain 403 is the development-mode allowlist');
ok(!!forbidden && forbidden.message.indexOf('User Management') > -1, '403 must name where the owner fixes it');
ok(!!forbidden && forbidden.message.indexOf('Forbidden') > -1, '403 must quote Spotify’s own message too');
ok(ALLOWLIST_ADVICE.indexOf('5') > -1, 'the allowlist advice states the account limit');

const premium = classifySpotifyResponse(403, { error: { status: 403, reason: 'PREMIUM_REQUIRED', message: 'Player command failed' } });
ok(premium?.kind === 'premium_required', 'PREMIUM_REQUIRED is not the allowlist');

const dead = classifySpotifyResponse(401, { error: { status: 401, message: 'The access token expired' } });
ok(dead?.kind === 'signed_out', '401 asks for a reconnect');

const noDevice = classifySpotifyResponse(404, { error: { status: 404, reason: 'NO_ACTIVE_DEVICE' } });
ok(noDevice?.kind === 'no_device', 'NO_ACTIVE_DEVICE is its own state, not a generic 404');
ok(classifySpotifyResponse(404, {})?.kind === 'unknown', 'a 404 without a reason is not claimed to be a device problem');
ok(classifySpotifyResponse(429, {})?.kind === 'rate_limited', '429 is rate limiting');

const odd = classifySpotifyResponse(502);
ok(odd?.kind === 'unknown' && odd.message.indexOf('502') > -1, 'an unrecognised status still names itself');
ok(networkFailure('timeout').kind === 'network', 'a dead request is a network failure');

// A malformed body must not throw or invent a reason.
ok(classifySpotifyResponse(403, 'not json')?.kind === 'not_allowlisted', 'a non-object body is tolerated');
ok(classifySpotifyResponse(403, { error: 7 })?.kind === 'not_allowlisted', 'a non-object error is tolerated');

// ── now playing ──
const playing = nowPlayingFrom({
  device: { id: 'd1', name: 'Tim’s iPhone', is_active: true, volume_percent: 60 },
  is_playing: true, progress_ms: 74000, shuffle_state: false, repeat_state: 'off',
  item: { name: 'Till I Collapse', uri: 'spotify:track:1', duration_ms: 297000,
    artists: [{ name: 'Eminem' }, { name: 'Nate Dogg' }],
    album: { images: [{ url: 'https://i.example/a.jpg', height: 640, width: 640 }] } },
});
ok(playing?.title === 'Till I Collapse', 'track title is read');
ok(playing?.artist === 'Eminem, Nate Dogg', 'every artist is joined');
ok(playing?.isPlaying === true, 'is_playing is read');
ok(playing?.deviceName === 'Tim’s iPhone', 'device name is read');
ok(playing?.progressMs === 74000 && playing?.durationMs === 297000, 'timings are read');
ok(playing?.artUrl === 'https://i.example/a.jpg', 'album art is read');

ok(nowPlayingFrom(null) === null, '204/no body is nothing playing');
ok(nowPlayingFrom({ device: { name: 'Kitchen' }, is_playing: false }) === null, 'a device with no item names no track');
const partial = nowPlayingFrom({ item: { name: 'Weightless' } });
ok(partial?.artist === null, 'a track with no artist reports null, not an empty guess');
ok(partial?.progressMs === null && partial?.durationMs === null, 'absent timings stay null, never 0');
ok(partial?.isPlaying === false, 'absent is_playing is false, not assumed true');

// ── figures render as dashes when the record is silent ──
ok(msLabel(null) === '—', 'unknown time is a dash');
ok(msLabel(0) === '0:00', 'a real zero is still a zero');
ok(msLabel(74000) === '1:14', '74s is 1:14');
ok(msLabel(297000) === '4:57', '297s is 4:57');
ok(msLabel(-5) === '—', 'a negative time is not a figure');
ok(progressLine(null, 297000) === '— / 4:57', 'half-known progress shows one dash');
ok(progressLine(null, null) === '— / —', 'unknown progress is two dashes');

// ── playlists ──
const lists = playlistsFrom({
  total: 3,
  items: [
    { id: 'p1', name: 'Leg day', tracks: { total: 24 }, owner: { display_name: 'Tim' },
      external_urls: { spotify: 'https://open.spotify.com/playlist/p1' }, uri: 'spotify:playlist:p1',
      images: [{ url: 'https://i.example/p1.jpg' }] },
    null,
    { id: 'p2', name: 'Cooldown' },
    { id: '', name: 'broken' },
  ],
});
ok(lists.length === 2, 'null and id-less rows are dropped');
ok(lists[0].name === 'Leg day' && lists[0].trackCount === 24, 'a real playlist keeps its real count');
ok(lists[0].url === 'https://open.spotify.com/playlist/p1', 'the open-in-Spotify url is read');
ok(lists[1].trackCount === null, 'a playlist with no reported total is null, not 0');
ok(lists[1].ownerName === null && lists[1].artUrl === null, 'absent owner and art stay null');
ok(playlistsFrom({}).length === 0, 'a body with no items is an empty list');
ok(playlistsFrom(null).length === 0, 'no body is an empty list');

ok(playlistLine(lists[0]) === '24 tracks · Tim', 'the line reads as data');
ok(playlistLine(lists[1]) === '— tracks', 'an unknown count renders as a dash, never as 0 tracks');
ok(playlistLine({ ...lists[0], trackCount: 1 }) === '1 track · Tim', 'one track is singular');

declare const process: { exit(code: number): void };
console.log(errors.length ? 'SPOTIFY PLAYBACK FAILURES:\n' + errors.join('\n') : 'ALL SPOTIFY PLAYBACK TESTS PASSED');
if (errors.length) process.exit(1);
