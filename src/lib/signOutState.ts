// What signing out has to take off the handset, and what it must not touch.
//
// ── The defect ────────────────────────────────────────────────────────────
//
// `signOut` in src/ui/auth.tsx ended the session and cleared nothing else. Four
// things this app deliberately keeps on the DEVICE rather than on the server
// therefore survived it, and were inherited by whoever signed in next:
//
//   · the notification categories — which kinds of thing this person agreed to
//     be told about;
//   · their quiet hours — the window they asked not to be disturbed in;
//   · the biometric lock — armed, by somebody who is no longer here;
//   · the reminders — scheduled ON the phone, so the next member's handset went
//     on buzzing at 6am for a session that was never theirs.
//
// One more was found later, and it is worse than the ones above because it is
// not a preference at all: the Spotify access and refresh tokens. They live on the
// handset and nowhere else, under a key with no account in it, and only the
// Disconnect button ever removed them — so the next member inherited a live,
// writable connection to a stranger's Spotify account. See the list below.
//
// A shared handset at a gym desk is not a rare case; nor is a member selling a
// phone. And app/(client)/notification-prefs.tsx says out loud that these
// choices "are kept on this phone", which is a promise about privacy as much as
// about a second handset: the person reading it is entitled to assume that
// leaving takes them with it.
//
// ── Why a list here rather than a `clear()` ───────────────────────────────
//
// AsyncStorage.clear() would take the lot, and some of the lot must survive:
//
//   · `repple.appName` is the GYM's name, cached for the screens shown when
//     NOBODY is signed in (src/ui/brand.tsx). Clearing it on sign-out would
//     hand a white-label member their supplier's name on the very screen they
//     come back to sign in on.
//   · `repple.theme.*` and `repple.palette` are how the app looks on this
//     device, chosen before and after any session.
//   · The offline outbox (`outbox:v1:<uid>`) and every per-account cache are
//     keyed BY ACCOUNT already. They are another person's unsent work, they are
//     unreadable to the next account by construction, and destroying them on
//     sign-out would throw away writes the member has been promised will go up
//     when they have signal — the exact loss src/lib/outbox.ts exists to stop.
//
// So the list is explicit, and it names only keys that hold ONE PERSON's
// answers under a key with no account in it. That is the whole test, and it is
// stated here rather than in the caller so that the next device-local
// preference has a place to be considered.
//
// Pure: strings and a rule, no storage. src/ui/signOutState.ts does the work.

/**
 * The device-local keys that belong to the person who is signing out.
 *
 * Each is owned by exactly one provider and the owner is named beside it, so a
 * key that moves has one place to be corrected rather than two that drift.
 */
export const PERSONAL_DEVICE_KEYS: readonly string[] = [
  // src/ui/notifyPrefs.tsx — categories and quiet hours.
  'repple.notifyPrefs',
  // src/ui/appLock.tsx — whether Face ID / a fingerprint guards this app.
  'repple.appLock.enabled',
  // src/ui/reminderSync.tsx — the weekly reminders and the ids of the OS
  // notifications they were scheduled as. The ids are why cancelling has to
  // happen BEFORE this key goes; see src/ui/signOutState.ts.
  'repple.reminders',
  // src/lib/spotify.ts — the member's Spotify access and refresh tokens.
  //
  // The only entry on this list that is a CREDENTIAL rather than a preference. It is stored on the handset and nowhere else — there is no
  // server-side row for it, the key carries no account id, and the only thing
  // that ever removed it was `spotifyDisconnect()`, which runs when a member
  // taps Disconnect on Meals › Music & Playlists and at no other time.
  //
  // So it survived a sign-out, and the next person to sign in on the same
  // handset opened that screen to somebody else's Spotify account: their
  // display name printed as "Connected as", their private playlists listed by
  // `spotifyMyPlaylists`, and — because the granted scopes include
  // playlist-modify-public, playlist-modify-private and
  // user-modify-playback-state — the ability to write to those playlists and
  // to start and stop playback on that person's devices. A shared gym handset
  // is the ordinary case for all three of the keys above it; this is the one
  // where the inheritance reaches outside Repple entirely.
  //
  // Clearing it here does not revoke the grant at Spotify's end. Neither does
  // Disconnect, which removes exactly this key and nothing more, so a sign-out
  // now leaves the account in the same state tapping Disconnect leaves it in —
  // which is the promise the Music screen already makes. Revoking properly is
  // a Spotify-side action and belongs to the member, not to a handset they are
  // walking away from.
  'repple.spotify.token',
];

/**
 * Whether a key is one of the above.
 *
 * Exported for the assertion rather than for a caller: what needs to be
 * checkable is that a key somebody adds is on the list ON PURPOSE, and that
 * nothing account-scoped or brand-scoped has crept onto it.
 */
export const isPersonalDeviceKey = (k: string): boolean => PERSONAL_DEVICE_KEYS.includes(k);

/**
 * Keys that must SURVIVE a sign-out, named so the rule can be asserted.
 *
 * Not a denylist the clear consults — it iterates the list above and touches
 * nothing else. This is here so that the test can state the intent as a
 * property ("none of these is ever cleared") rather than as a comment nobody
 * runs.
 */
export const KEPT_ON_SIGN_OUT: readonly string[] = [
  'repple.appName',
  'repple.palette',
  'repple.theme.follow',
  'repple.theme.contrast',
];

/** The prefix every per-account outbox key carries (src/lib/outbox.ts). A key
 *  that starts with it names one account's unsent work and is never cleared
 *  here — the member is owed those writes whether or not they are signed in. */
export const ACCOUNT_SCOPED_PREFIXES: readonly string[] = ['outbox:v1:', 'repple.announcements:'];
