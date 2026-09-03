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
