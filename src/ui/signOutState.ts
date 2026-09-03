// Taking one person's things off the handset when they sign out.
//
// src/lib/signOutState.ts is the policy — which keys, why those and not the
// rest. This file is the parts that need a device: the storage writes, the
// notifications the OS is already holding, and the push registration the
// server would otherwise go on delivering to.
//
// ── The order matters, and it is the whole file ───────────────────────────
//
// 1. REVOKE THE PUSH TOKEN FIRST, while the session is still alive. `pt_self`
//    is `user_id = auth.uid()` for every command, so the delete is only
//    possible from inside the session being ended — a token revoked after
//    `signOut()` is a token that cannot be revoked at all, and the row stays,
//    and this handset goes on receiving the previous member's notifications
//    with their coach's words in them.
//
// 2. CANCEL THE SCHEDULED REMINDERS BEFORE CLEARING THE KEY THEY ARE LISTED
//    IN. `repple.reminders` holds the OS notification IDS
//    (src/ui/reminderSync.tsx), and they are the only handle anything has on
//    them. Clearing the key first would leave a weekly 6am reminder firing on
//    the next member's phone with nothing left in the app that knows its id —
//    unfixable short of a reinstall. Cancelling by id is also why this does not
//    reach for a cancel-everything: a booked session's one-hour warning and a
//    rest-timer alert are scheduled elsewhere and are not this person's to lose
//    in the general case, though in practice they go with the session too.
//
// 3. THEN clear the keys, and only the ones on the list.
//
// ── What it never does ────────────────────────────────────────────────────
//
// It does not touch the outbox, or any per-account cache. Those are keyed by
// uid, they are unreadable to the next account, and they hold writes this app
// has promised the member will go up when they have signal. Ending a session is
// not a reason to break that promise — see src/lib/outbox.ts.
//
// Every step is best-effort and none of them can stop the sign-out. A member
// tapping Sign Out on a phone with no signal must end up signed out; the token
// revoke fails honestly in that case and the reconciler in src/ui/settings.tsx
// tries again at the next launch.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PERSONAL_DEVICE_KEYS } from '../lib/signOutState';
import { savedFromStored } from '../lib/reminderPlan';
import { REMINDERS_KEY } from './reminderSync';
import { cancelReminders, pushAvailable } from './pushNotifications';
import { revokePushToken } from './settings';
import { reportError } from '../lib/reportError';

/**
 * Take this person's device-local state off this handset.
 *
 * Resolves once everything that can be done has been. Never throws: every
 * failure here leaves the app in the state it was already in, and none of them
 * is a reason to refuse to sign somebody out.
 *
 * @param revokePush whether to attempt the push-token delete. True from a real
 *   sign-out, where the session is still alive; there is no other caller, and
 *   the flag exists so that a future teardown with no session does not have to
 *   pretend.
 */
export async function clearPersonalDeviceState(opts: { revokePush?: boolean } = {}): Promise<void> {
  if (opts.revokePush) {
    try {
      // Not `setPushEnabled(false)`, which would also record that the member
      // turned notifications OFF. They did not; they signed out, and the
      // preference is theirs to keep for the next time they sign in.
      await revokePushToken(() => false);
    } catch (e) { reportError('signOut.revokePush', e); }
  }

  // By id, off the key that is about to be cleared.
  try {
    if (pushAvailable()) {
      const raw = await AsyncStorage.getItem(REMINDERS_KEY);
      if (raw != null) await cancelReminders(savedFromStored(raw).ids);
    }
  } catch (e) { reportError('signOut.cancelReminders', e); }

  try {
    await AsyncStorage.multiRemove([...PERSONAL_DEVICE_KEYS]);
  } catch (e) {
    // A phone that will not let go of these is a phone where the next person
    // inherits them. Nothing can be done about it here, but it is not silent.
    reportError('signOut.clearKeys', e);
  }
}
