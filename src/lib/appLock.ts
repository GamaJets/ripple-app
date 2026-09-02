// Face ID (or Touch ID, or a device passcode) over the app.
//
// ── What this is, and what it deliberately is not ────────────────────────────
//
// This is a LOCK over an app you are already signed in to. It is not a second
// way to sign in, and it does not store your password anywhere.
//
// That distinction is the whole design. A "log in with Face ID" that keeps your
// email and password in the keychain and replays them is strictly worse than
// what already happens: the Supabase session persists and refreshes itself, so
// you are signed in already. Adding stored credentials would create a second
// copy of something we currently do not hold at all, to solve a problem that
// does not exist. What people actually want from Face ID here is that a phone
// left on a bench does not show a stranger their body-composition history.
//
// So: the session is untouched, and biometrics gate whether the UI is shown.
//
// ── When it asks ─────────────────────────────────────────────────────────────
//
// On a cold start, and when the app has been in the background longer than
// GRACE_MS. Not on every resume: an app that demands your face because you
// glanced at a notification gets turned off within a day, and a lock nobody
// leaves on protects nobody.
export const GRACE_MS = 60_000;

export type LockState =
  /** No lock configured, or the hardware cannot do it. Show the app. */
  | 'open'
  /** Enabled, and the app must be unlocked before anything is shown. */
  | 'locked'
  /** Unlocked for now. */
  | 'unlocked';

export interface LockDecision {
  state: LockState;
  /** Why, in words a person could be shown. Null when there is nothing to say. */
  reason: string | null;
}

/**
 * Which handset's vocabulary to use.
 *
 * The same shape and the same reason as `SOUND_PLATFORM` in
 * app/(client)/settings.tsx, which exists because a note "used to name the MUTE
 * SWITCH on every platform and Android phones do not have one, so the only
 * sentence explaining a silent chime sent Android members hunting for a control
 * that is not on their handset."
 *
 * This file had the identical failure one section down. Every sentence about
 * the lock named Face ID, Touch ID and iOS Settings — so an Android member was
 * told to go and set up an Apple feature inside an Apple settings app that is
 * not on their phone.
 *
 * A string rather than a `Platform` import, because the whole point of this
 * file is that it has no imports and can be asserted on without a device.
 */
export type LockPlatform = 'ios' | 'android' | 'other';

/** What the device's own unlock security is CALLED on this handset. */
export function lockMethodsLabel(p: LockPlatform): string {
  switch (p) {
    case 'ios': return 'Face ID, Touch ID or a passcode';
    // Android vendors name the biometric differently on every skin, so this
    // names the capability rather than a brand: "face unlock" and "fingerprint"
    // are what the OS itself calls them, and "screen lock" is the Settings entry
    // a PIN, a pattern and a password all live under.
    case 'android': return 'a fingerprint, face unlock or a screen lock';
    case 'other': return 'a screen lock';
  }
}

/** Where the person actually goes to set one up. */
export function lockSettingsLabel(p: LockPlatform): string {
  switch (p) {
    case 'ios': return 'iOS Settings';
    case 'android': return 'your phone’s Settings';
    case 'other': return 'your device settings';
  }
}

/** What to call the lock when the device has not told us which kind it has.
 *  "your passcode" is an iOS word; Android calls the same thing a screen lock. */
export function defaultLockLabel(p: LockPlatform): string {
  return p === 'ios' ? 'your passcode' : 'your screen lock';
}

export interface LockInputs {
  /** The user has turned the lock on in Settings. */
  enabled: boolean;
  /** The device has a usable enrolled biometric or passcode. */
  available: boolean;
  /** Somebody is signed in. A lock over a sign-in screen protects nothing. */
  signedIn: boolean;
  /** When the app last went to the background, or null on a cold start. */
  backgroundedAt: number | null;
  now: number;
  /** Whose vocabulary to explain an unavailable lock in. Optional, and absent
   *  means the neutral wording — never the iOS wording, which is the defect. */
  platform?: LockPlatform;
}

/**
 * Whether to show the app or the lock screen.
 *
 * Every "open" answer names its reason, because the states are easy to confuse
 * and a user who turned the lock on and is not being asked for their face
 * deserves to find out why in Settings rather than assume it is working.
 */
export function lockDecision(i: LockInputs): LockDecision {
  if (!i.signedIn) return { state: 'open', reason: null };
  if (!i.enabled) return { state: 'open', reason: null };
  if (!i.available) {
    const p = i.platform ?? 'other';
    return {
      state: 'open',
      reason: `This device does not have ${lockMethodsLabel(p)} set up, so the lock cannot be applied. Setting one up in ${lockSettingsLabel(p)} turns it on.`,
    };
  }
  // Cold start: no record of backgrounding, so lock.
  if (i.backgroundedAt == null) return { state: 'locked', reason: null };
  const away = i.now - i.backgroundedAt;
  if (away >= GRACE_MS) return { state: 'locked', reason: null };
  return { state: 'unlocked', reason: null };
}

/**
 * What the Settings row should say underneath the toggle.
 *
 * `brand` rather than the literal "Repple". This is a white-label build and the
 * app on this phone may not be called Repple at all — the same sentence
 * app/(client)/settings.tsx's push handler already carries about itself, five
 * lines above where this string is rendered.
 *
 * Both trailing parameters are optional and their absent forms are the neutral
 * ones, so a caller that has not been updated gets wording that is true
 * everywhere rather than wording that is true on iOS.
 */
export function lockSettingNote(
  available: boolean,
  enabled: boolean,
  label: string,
  platform: LockPlatform = 'other',
  brand = 'this app',
): string {
  if (!available) {
    return `Unavailable — this device does not have ${lockMethodsLabel(platform)} set up.`;
  }
  return enabled
    ? `${label} is needed to open ${brand} after a minute away. Your training stays signed in either way; this only decides who can see it.`
    : `Anyone who picks up this phone can open ${brand}. Turn on to require ${label}.`;
}
