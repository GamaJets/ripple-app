"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Pure-logic tests for the Spotify response mapping. Compile with tsc, run with node.
//
// The cases below are the ones that produced TF-34 in the field: a token that
// works for sign-in and 403s on every request, and a player call that answers
// 404 because nothing is playing. Both used to be swallowed.
const spotifyPlayback_1 = require("./spotifyPlayback");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
// ── classification ──
ok((0, spotifyPlayback_1.classifySpotifyResponse)(200, {}) === null, '200 is not a failure');
ok((0, spotifyPlayback_1.classifySpotifyResponse)(204) === null, '204 (nothing playing) is not a failure');
const forbidden = (0, spotifyPlayback_1.classifySpotifyResponse)(403, { error: { status: 403, message: 'Forbidden' } });
ok(forbidden?.kind === 'not_allowlisted', 'a plain 403 is the development-mode allowlist');
ok(!!forbidden && forbidden.message.indexOf('User Management') > -1, '403 must name where the owner fixes it');
ok(!!forbidden && forbidden.message.indexOf('Forbidden') > -1, '403 must quote Spotify’s own message too');
ok(spotifyPlayback_1.ALLOWLIST_ADVICE.indexOf('5') > -1, 'the allowlist advice states the account limit');
const premium = (0, spotifyPlayback_1.classifySpotifyResponse)(403, { error: { status: 403, reason: 'PREMIUM_REQUIRED', message: 'Player command failed' } });
ok(premium?.kind === 'premium_required', 'PREMIUM_REQUIRED is not the allowlist');
const dead = (0, spotifyPlayback_1.classifySpotifyResponse)(401, { error: { status: 401, message: 'The access token expired' } });
ok(dead?.kind === 'signed_out', '401 asks for a reconnect');
const noDevice = (0, spotifyPlayback_1.classifySpotifyResponse)(404, { error: { status: 404, reason: 'NO_ACTIVE_DEVICE' } });
ok(noDevice?.kind === 'no_device', 'NO_ACTIVE_DEVICE is its own state, not a generic 404');
ok((0, spotifyPlayback_1.classifySpotifyResponse)(404, {})?.kind === 'unknown', 'a 404 without a reason is not claimed to be a device problem');
ok((0, spotifyPlayback_1.classifySpotifyResponse)(429, {})?.kind === 'rate_limited', '429 is rate limiting');
const odd = (0, spotifyPlayback_1.classifySpotifyResponse)(502);
ok(odd?.kind === 'unknown' && odd.message.indexOf('502') > -1, 'an unrecognised status still names itself');
ok((0, spotifyPlayback_1.networkFailure)('timeout').kind === 'network', 'a dead request is a network failure');
// A malformed body must not throw or invent a reason.
ok((0, spotifyPlayback_1.classifySpotifyResponse)(403, 'not json')?.kind === 'not_allowlisted', 'a non-object body is tolerated');
ok((0, spotifyPlayback_1.classifySpotifyResponse)(403, { error: 7 })?.kind === 'not_allowlisted', 'a non-object error is tolerated');
// ── now playing ──
const playing = (0, spotifyPlayback_1.nowPlayingFrom)({
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
ok((0, spotifyPlayback_1.nowPlayingFrom)(null) === null, '204/no body is nothing playing');
ok((0, spotifyPlayback_1.nowPlayingFrom)({ device: { name: 'Kitchen' }, is_playing: false }) === null, 'a device with no item names no track');
const partial = (0, spotifyPlayback_1.nowPlayingFrom)({ item: { name: 'Weightless' } });
ok(partial?.artist === null, 'a track with no artist reports null, not an empty guess');
ok(partial?.progressMs === null && partial?.durationMs === null, 'absent timings stay null, never 0');
ok(partial?.isPlaying === false, 'absent is_playing is false, not assumed true');
// ── figures render as dashes when the record is silent ──
ok((0, spotifyPlayback_1.msLabel)(null) === '—', 'unknown time is a dash');
ok((0, spotifyPlayback_1.msLabel)(0) === '0:00', 'a real zero is still a zero');
ok((0, spotifyPlayback_1.msLabel)(74000) === '1:14', '74s is 1:14');
ok((0, spotifyPlayback_1.msLabel)(297000) === '4:57', '297s is 4:57');
ok((0, spotifyPlayback_1.msLabel)(-5) === '—', 'a negative time is not a figure');
ok((0, spotifyPlayback_1.progressLine)(null, 297000) === '— / 4:57', 'half-known progress shows one dash');
ok((0, spotifyPlayback_1.progressLine)(null, null) === '— / —', 'unknown progress is two dashes');
// ── playlists ──
const lists = (0, spotifyPlayback_1.playlistsFrom)({
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
ok((0, spotifyPlayback_1.playlistsFrom)({}).length === 0, 'a body with no items is an empty list');
ok((0, spotifyPlayback_1.playlistsFrom)(null).length === 0, 'no body is an empty list');
ok((0, spotifyPlayback_1.playlistLine)(lists[0]) === '24 tracks · Tim', 'the line reads as data');
ok((0, spotifyPlayback_1.playlistLine)(lists[1]) === '— tracks', 'an unknown count renders as a dash, never as 0 tracks');
ok((0, spotifyPlayback_1.playlistLine)({ ...lists[0], trackCount: 1 }) === '1 track · Tim', 'one track is singular');
console.log(errors.length ? 'SPOTIFY PLAYBACK FAILURES:\n' + errors.join('\n') : 'ALL SPOTIFY PLAYBACK TESTS PASSED');
// ── what actually landed in the account ──
//
// The screen announced "is in your Spotify library" whatever fraction arrived:
// a twenty-track list could land with eleven tracks in it, some of them
// different recordings, and the sentence was identical.
const whole = (0, spotifyPlayback_1.playlistSavedLine)('Leg Day', { url: 'u', added: 20, requested: 20, guessed: 0 });
ok(/is in your Spotify library\.$/.test(whole), `a complete exact save says so and stops — got ${whole}`);
const short = (0, spotifyPlayback_1.playlistSavedLine)('Leg Day', { url: 'u', added: 11, requested: 20, guessed: 0 });
ok(/11 of its 20/.test(short), `a partial save counts what is really there — got ${short}`);
ok(/other 9/.test(short), 'and says how many are missing');
const guessy = (0, spotifyPlayback_1.playlistSavedLine)('Leg Day', { url: 'u', added: 20, requested: 20, guessed: 4 });
ok(/4 tracks were/.test(guessy), 'tracks matched by name are counted');
ok(/different recordings/.test(guessy), 'and the member is told they may not be the same recording');
ok(!/different recordings/.test(whole), 'while an exact save claims nothing of the kind');
ok(/One track was/.test((0, spotifyPlayback_1.playlistSavedLine)('Leg Day', { url: 'u', added: 20, requested: 20, guessed: 1 })), 'one is singular');
const both = (0, spotifyPlayback_1.playlistSavedLine)('Leg Day', { url: 'u', added: 11, requested: 20, guessed: 3 });
ok(/11 of its 20/.test(both) && /3 tracks were/.test(both), 'both facts survive together');
if (errors.length)
    process.exit(1);
