// Pure-logic tests for what the Music screen is allowed to call "connected".
//
// The defect these pin down: `spotifyStatus()` reads AsyncStorage and never
// asks Spotify, so `connected: true` only ever meant "this device still holds a
// token blob". Spotify's refusal of that token arrives at a different call site
// as a SpotifyError of kind 'signed_out'. The screen showed the first fact in
// the header and the second one, if at all, as a retryable problem line inside a
// section that its own gate kept open — so a member whose token had expired read
// "Connected · Tim", pressed Try Again forever, and had their generated
// playlists quietly fall back to the built-in list.
//
// Run: npx tsx src/lib/musicLink.test.ts
import { linkState, canReachSpotify, linkActionLabel, linkStatusNote, type LinkFacts } from './music';

const errors: string[] = [];
let asserted = 0;
const ok = (cond: boolean, msg: string) => { asserted += 1; if (!cond) errors.push(msg); };

const facts = (over: Partial<LinkFacts> = {}): LinkFacts =>
  ({ remembersToken: false, scopesStale: false, refusal: null, ...over });

// ── never granted vs expired: two different facts ───────────────────────────
const never = facts();
const expired = facts({ remembersToken: true, refusal: 'Your Spotify session expired and could not be renewed. Connect Spotify again.' });

ok(linkState(never) === 'absent', 'no token on the device is "absent"');
ok(linkState(expired) === 'refused', 'a token Spotify refused is "refused", not "absent"');
ok(linkState(never) !== linkState(expired), 'never-granted and expired must not collapse to one state');
ok(linkActionLabel(never) === 'Connect', 'nothing granted offers Connect');
ok(linkActionLabel(expired, 'Tim') === 'Reconnect', 'a refused token offers Reconnect');
ok(linkActionLabel(expired, 'Tim') !== 'Tim', 'a refused token is NEVER labelled with the account name');
ok(linkStatusNote(never) === undefined, 'nothing granted claims no status');
ok(linkStatusNote(expired) === 'Signed Out', 'a refusal is reported as Spotify signing them out');
ok(linkStatusNote(expired) !== 'Connected', 'a refused token must not read Connected');

// ── the remembered flag alone may not open a Web API path ───────────────────
const remembered = facts({ remembersToken: true });
ok(linkState(remembered) === 'live', 'a held token Spotify has not refused is live');
ok(canReachSpotify(remembered), 'live may call the Web API');
ok(!canReachSpotify(expired), 'a refused token may NOT call the Web API, however well remembered');
ok(!canReachSpotify(never), 'an absent token may not call the Web API');
ok(linkActionLabel(remembered, 'Tim') === 'Tim', 'a live link shows whose account it is');
ok(linkActionLabel(remembered) === 'Connected', 'a live link with no name still reads Connected');

// ── silence is not consent ──────────────────────────────────────────────────
// `refusal: null` is "Spotify has not refused it", which is what the screen
// knows before it has asked. It is not an approval, and the state name must not
// imply one beyond "we may try".
ok(facts({ remembersToken: true }).refusal === null, 'an unasked service has said nothing');
ok(linkState(facts({ remembersToken: true, refusal: '' })) === 'live', 'an empty refusal string is not a refusal');

// ── a refusal outranks a scope gap ──────────────────────────────────────────
const stale = facts({ remembersToken: true, scopesStale: true });
ok(linkState(stale) === 'scopes_stale', 'a live token missing scopes is scopes_stale');
ok(!canReachSpotify(stale), 'a token missing scopes may not be treated as usable');
ok(linkStatusNote(stale) === 'Needs Permission', 'a scope gap says so');
const both = facts({ remembersToken: true, scopesStale: true, refusal: 'Spotify signed you out. Connect Spotify again.' });
ok(linkState(both) === 'refused', 'a dead token is dead whatever its scopes claimed');
ok(linkActionLabel(both, 'Tim') === 'Reconnect', 'a dead token asks for a sign-in, not for more permissions');

// ── no token, no refusal to report ──────────────────────────────────────────
// Giving up the link deliberately is not Spotify signing you out, and must not
// be reported as one.
ok(linkState(facts({ refusal: 'Spotify signed you out. Connect Spotify again.' })) === 'absent',
  'with no token held there is nothing for a stale refusal to describe');

if (errors.length) { console.error(errors.map((e) => ' ✗ ' + e).join('\n')); process.exit(1); }
console.log(`musicLink: ok (${asserted} assertions)`);
