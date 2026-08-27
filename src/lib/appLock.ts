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
    return {
      state: 'open',
      reason: 'This device has no Face ID, Touch ID or passcode set up, so the lock cannot be applied. Setting a passcode in iOS Settings turns it on.',
    };
  }
  // Cold start: no record of backgrounding, so lock.
  if (i.backgroundedAt == null) return { state: 'locked', reason: null };
  const away = i.now - i.backgroundedAt;
  if (away >= GRACE_MS) return { state: 'locked', reason: null };
  return { state: 'unlocked', reason: null };
}

/** What the Settings row should say underneath the toggle. */
export function lockSettingNote(available: boolean, enabled: boolean, label: string): string {
  if (!available) {
    return 'Unavailable — this device has no Face ID, Touch ID or passcode set up.';
  }
  return enabled
    ? `${label} is needed to open Repple after a minute away. Your training stays signed in either way; this only decides who can see it.`
    : `Anyone who picks up this phone can open Repple. Turn on to require ${label}.`;
}
