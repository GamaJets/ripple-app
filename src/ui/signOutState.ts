// Taking one person's things off the handset when their session ends.
//
// src/lib/signOutState.ts is the policy — which keys, why those and not the
// rest. src/lib/signOutSweep.ts is the decision about WHICH HALF of the work
// each exit path can do. This file is the parts that need a device: the storage
// writes, the notifications the OS is already holding, and the push
// registration the server would otherwise go on delivering to.
//
// ── Three ways a session ends, and they do not reach equally far ──────────
//
// `SweepCause` names them and src/lib/signOutSweep.ts argues them. The short of
// it: 'deliberate' and 'brand-mismatch' both run while the session is still
// alive, so both can do the whole job. 'remote' cannot. It is an event ABOUT
// the session having ended — a token revoked, an expiry, or a member signing
// this handset out FROM SOMEWHERE ELSE because they have LOST it — and by the
// time it arrives there is no session left to delete a `push_tokens` row under.
//
// So the remote path does the LOCAL half and says out loud which half it did
// not do. It does not call the revoke and let it come back false: `pt_self` is
// `user_id = auth.uid()` for every command, and src/ui/settings.tsx records from
// the live database that an unauthenticated SELECT returns an empty array and an
// unauthenticated DELETE returns 204 — both indistinguishable from the row being
// gone. A revoke attempted without a session cannot fail loudly enough to be
// useful; it can only look done.
//
// ── The order matters, and it is the whole file ───────────────────────────
//
// 1. REVOKE THE PUSH TOKEN FIRST, while the session is still alive. A token
//    revoked after `signOut()` is a token that cannot be revoked at all, and the
//    row stays, and this handset goes on receiving the previous member's
//    notifications with their coach's words in them. The ANSWER is kept, not
//    thrown away: `revokePushToken` returns false for a delete it could not
//    prove, and this used to `await` it and discard that — success claimed from
//    the absence of an error, about the one row that decides whether a
//    stranger's messages keep arriving.
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
//    And if that key will not READ, the key is KEPT. A failed read is not an
//    empty list — there may be notifications scheduled whose ids are now
//    unknown, and clearing the key is exactly how they become permanent.
//    `remindersKeyMayGo` in src/lib/signOutSweep.ts holds that rule and its
//    cost.
//
// 3. THEN clear the keys, and only the ones on the list — and READ THEM BACK.
//    `multiRemove` resolving is not evidence that anything was removed. The
//    record says what is still there, or says that it could not be read back,
//    and those are two different facts.
//
// 4. AND STRIP THE TWO CONSENTS OUT OF `repple.settings`, which is not on that
//    list and cannot be. The list is consumed by `multiRemove`, so an entry is
//    all-or-nothing about a whole key, and that key holds two of this person's
//    answers (`notifPush`, `restSound`) beside the CACHE of an account-scoped
//    one (their units). Removing the key would take the leaver's only surviving
//    copy of a unit chosen before those columns existed — the record-destroying
//    half of the rule src/lib/signOutState.ts states. So the fields come out and
//    the cache stays. src/lib/personalSettings.ts holds the transform and the
//    argument.
//
//    The in-process latches go with them, in the same breath. SettingsProvider
//    is mounted at the root of app/_layout.tsx and outlives every sign-out, so
//    clearing the blob alone would leave the previous member's answer sitting in
//    `pushConsent()` and `restSoundConsent()` for the whole of the next member's
//    session — the switch on screen and the gate behind it disagreeing, which is
//    the original defect pointing the other way.
//
// ── Running twice is the ORDINARY case ────────────────────────────────────
//
// `signOut` sweeps and then calls `sbSignOut()`, and ending a session is exactly
// what fires `onAuthStateChange` with no session — which sweeps again, on the
// remote path. That second pass must be harmless and must not file a false
// alarm: a `multiRemove` of keys that are already gone is a no-op that does not
// throw, and the push disposition comes back 'already-revoked' rather than
// 'no-session' because `pushProvenGoneFor` finds the first pass's record.
//
// The record is APPEND-ONLY for that reason. The second sweep does not amend
// the first; it files a second fact beside it. Otherwise the only evidence that
// the deliberate sign-out did the server half would be overwritten by the remote
// event that sign-out itself caused.
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
// tries again at the next launch on which somebody is signed in on this handset
// with notifications off.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PERSONAL_DEVICE_KEYS } from '../lib/signOutState';
import {
  keysToClear, makeSweepLog, pushDisposition, pushLine, sessionIsLiveAt, tokenLeftBehind,
  type PushDisposition, type ReminderDisposition, type SweepCause, type SweepRecord,
} from '../lib/signOutSweep';
import { SETTINGS_KEY, stripPersonalSettings } from '../lib/personalSettings';
import { forgetPushConsent } from '../lib/pushConsent';
import { forgetRestSoundConsent } from '../lib/restTimer';
import { savedFromStored } from '../lib/reminderPlan';
import { REMINDERS_KEY } from './reminderSync';
import { cancelReminders, pushAvailable } from './pushNotifications';
import { revokePushToken } from './settings';
import { reportError } from '../lib/reportError';

export type { SweepCause, SweepRecord };

/**
 * Every sweep this app run has made, newest last.
 *
 * At module scope because the thing it has to outlive is the session: the fact
 * that the deliberate sign-out revoked the token is read by the remote sweep
 * that same sign-out triggers a moment later, after there is no session left to
 * read anything else from.
 */
const sweeps = makeSweepLog();

/** What this app run has done about ending sessions. Exported for a reader,
 *  never for a decision taken elsewhere. */
export const sweepHistory = (): readonly SweepRecord[] => sweeps.all();

/**
 * The push half. Only ever attempted where there is a session to attempt it
 * under, and the answer is carried rather than discarded.
 */
async function sweepPushToken(cause: SweepCause, uid: string | null): Promise<PushDisposition> {
  if (!sessionIsLiveAt(cause)) {
    // Nothing is tried, and that is the point. See the header: a revoke without
    // a session cannot distinguish "the row is gone" from "I cannot see it", so
    // attempting one would produce a confident wrong answer instead of an
    // honest missing one.
    return pushDisposition({ cause, priorRevoked: sweeps.pushProvenGoneFor(uid) });
  }
  let proven: boolean | null = null;
  try {
    // Not `setPushEnabled(false)`, which would also record that the member
    // turned notifications OFF. They did not; they signed out, and the
    // preference is theirs to keep for the next time they sign in.
    proven = await revokePushToken(() => false);
  } catch (e) {
    reportError('signOut.revokePush', e);
    proven = null;
  }
  return pushDisposition({ cause, proven });
}

/**
 * The reminders half: cancel by id, off the key that is about to be cleared.
 *
 * Returns what is true afterwards rather than a success flag, because the
 * caller has a decision to make on it — whether the key may go at all.
 */
async function sweepReminders(): Promise<ReminderDisposition> {
  if (!pushAvailable()) return 'no-scheduler';
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(REMINDERS_KEY);
  } catch (e) {
    reportError('signOut.readReminders', e);
    return 'ids-unknown';
  }
  if (raw == null) return 'none-stored';
  try {
    await cancelReminders(savedFromStored(raw).ids);
    return 'cancelled';
  } catch (e) {
    reportError('signOut.cancelReminders', e);
    return 'cancel-failed';
  }
}

/**
 * Take this person's device-local state off this handset.
 *
 * Resolves once everything that CAN be done from this path has been, with a
 * record of what that was. Never throws: every failure here leaves the app in
 * the state it was already in, and none of them is a reason to refuse to end
 * somebody's session.
 *
 * @param cause which exit this is. It decides whether the server half is even
 *   possible — see src/lib/signOutSweep.ts. There is no boolean here on purpose:
 *   a caller has to say where it is calling from, and the three answers are the
 *   three exits, so a fourth exit cannot quietly pick a default.
 * @param uid whose session is ending, where that is knowable. Used only to match
 *   this sweep against earlier ones in the same app run; a null uid never
 *   matches, which is the conservative answer rather than the convenient one.
 */
export async function clearPersonalDeviceState(
  opts: { cause: SweepCause; uid?: string | null },
): Promise<SweepRecord> {
  const uid = opts.uid ?? null;

  const push = await sweepPushToken(opts.cause, uid);
  if (tokenLeftBehind(push)) {
    // Written down rather than left to be inferred from silence. This is the
    // half the remote path cannot do, and the report is the only place it is
    // said while anybody can still act on it.
    reportError('signOut.pushTokenStillRegistered', new Error(pushLine(push)), {
      cause: opts.cause, disposition: push,
    });
  }

  const reminders = await sweepReminders();

  // Everything on the list, minus the reminders key when its ids are not
  // accounted for. A second sweep over keys that are already gone is a no-op
  // that does not throw, so nothing here reads as a failure on the ordinary
  // double pass.
  try {
    await AsyncStorage.multiRemove(keysToClear(PERSONAL_DEVICE_KEYS, reminders, REMINDERS_KEY));
  } catch (e) {
    // A phone that will not let go of these is a phone where the next person
    // inherits them. Nothing can be done about it here, but it is not silent.
    reportError('signOut.clearKeys', e);
  }

  // Read back, over the WHOLE list rather than over what was attempted, so a
  // reminders key deliberately kept shows up here as what it is: still on the
  // handset. `null` means the device would not answer, which is not the same as
  // nothing being left and must not collapse into it.
  let left: string[] | null = null;
  try {
    const back = await AsyncStorage.multiGet([...PERSONAL_DEVICE_KEYS]);
    left = back.filter(([, v]) => v != null).map(([k]) => k);
  } catch (e) {
    reportError('signOut.verifyKeys', e);
    left = null;
  }

  // The latches first, and unconditionally. They are in this process and cannot
  // fail, so the next member's session starts from 'unknown' whatever the store
  // does below — which is a refusal for both gates, and a refusal is the safe
  // answer to "we do not know what this person said".
  forgetPushConsent();
  forgetRestSoundConsent();

  // Then the two fields inside `repple.settings`. Read-modify-write rather than
  // a remove, for the reason in the header: the unit cache in the same blob is
  // the leaver's, and a blob that will not READ is not a blob that is empty.
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    const rest = stripPersonalSettings(raw);
    if (rest == null) {
      // Nothing was stored, or nothing worth keeping survived. A removeItem on a
      // key that was never there is a no-op, so this needs no separate branch.
      await AsyncStorage.removeItem(SETTINGS_KEY);
    } else if (rest !== raw) {
      await AsyncStorage.setItem(SETTINGS_KEY, rest);
    }
  } catch (e) {
    // A throw here is the read failing or the write failing, and in neither case
    // is anything written: `stripPersonalSettings` never runs on a read that did
    // not land, so this cannot erase the leaver's units on the strength of a
    // failure. What it does leave is the consents on the handset, which is what
    // the next member would have inherited anyway — so it is reported, not
    // guessed around.
    reportError('signOut.clearSettings', e);
  }

  return sweeps.record({ cause: opts.cause, uid, at: Date.now(), push, reminders, left });
}
