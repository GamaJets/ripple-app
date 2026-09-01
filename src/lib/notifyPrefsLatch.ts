// The member's notification preferences, readable synchronously from anywhere.
//
// ── Why a module-level latch and not a React context ──────────────────────
//
// The same argument src/lib/pushConsent.ts makes, for the same reason. The gate
// lives inside `scheduleLocal` and `scheduleDailyReminder` in
// src/ui/pushNotifications.ts, which are called from outside React — a booking
// callback, a provider effect, a screen's save handler. A context is unreadable
// from those places, and threading the preferences through every call site as
// an argument is how the gate gets forgotten at the next one.
//
// A latch is also what lets a switch take effect in the SAME TICK it is
// flipped. `NotifyPrefsProvider` writes here before it writes to AsyncStorage,
// so a member who turns off daily reminders and immediately saves the reminders
// screen does not race their own storage write and schedule the thing they just
// turned off.
//
// ── What it reads before the store has answered ───────────────────────────
//
// The defaults, which are EVERYTHING ON. AsyncStorage is asynchronous and there
// is a real window at launch in which nobody in this process knows what the
// member chose, and the two ways to be wrong in that window are not symmetric:
//
//   default-on  a notification the member had turned off may slip through once,
//               in the seconds before the read lands.
//   default-off a session reminder the member wanted is silently not scheduled,
//               and nothing anywhere will ever schedule it again — the booking
//               that would have armed it has already been made.
//
// The first is recoverable and visible; the second is neither. So the window
// defaults to on, and the provider seeds this within a tick or two of launch.
//
// This differs deliberately from `pushConsent`, whose 'unknown' blocks: that
// gate guards raising the OS permission prompt, which happens once per install
// and cannot be taken back. Nothing here is irreversible.
import { DEFAULT_NOTIFY_PREFS, type NotifyPrefs } from './notifyPrefs';

let current: NotifyPrefs = DEFAULT_NOTIFY_PREFS;

/** What the member chose, or the defaults until the store has answered. */
export function notifyPrefs(): NotifyPrefs {
  return current;
}

/** Called by NotifyPrefsProvider, and by nothing else. */
export function setNotifyPrefsLatch(prefs: NotifyPrefs): void {
  current = prefs;
}
