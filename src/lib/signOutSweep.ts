// Which half of the sign-out sweep each exit path can actually perform, and
// what is true of the handset once it has.
//
// src/lib/signOutState.ts is the list of keys. src/ui/signOutState.ts does the
// work. This file is the part in between: three ways a session ends, and the
// fact that they are NOT the same errand.
//
// ── The three exits, and the one difference that matters ──────────────────
//
// A session in this app ends in exactly three places, all of them in
// src/ui/auth.tsx:
//
//   · DELIBERATE — the member tapped Sign Out. `signOut` runs while the session
//     is still alive and ends it itself.
//   · BRAND MISMATCH — `refreshFromSession` read a live session belonging to
//     another white-label tenant and ends it rather than serving it. The
//     session is alive at that moment too: `getUser()` has just answered with a
//     user, which is how the guard knows there is a brand to object to.
//   · REMOTE — `onAuthStateChange` fired with no session. The token was revoked,
//     or it expired, or somebody signed this handset out FROM SOMEWHERE ELSE.
//     There is no session here and there never will be one again for this
//     account on this handset.
//
// The first two can talk to the server as the person who is leaving. The third
// cannot, and that is not a detail. `pt_self` is `user_id = auth.uid()` for
// every command on `push_tokens`, so the delete that takes this handset off
// that account's delivery list is only possible from INSIDE the session being
// ended. Without one, `revokePushToken` cannot even find out: src/ui/settings.ts
// records, from the live database, that an unauthenticated SELECT comes back as
// an empty array and an unauthenticated DELETE comes back 204 — both
// indistinguishable from the row being gone.
//
// ── Why this is a disposition and not a boolean ───────────────────────────
//
// The remote exit is the one that matters MOST — it is the path a member uses
// when the handset is lost and they are signing it out from a laptop — and it
// is the one that can do least. The honest answer is therefore not "swept" or
// "failed" but a statement of which half happened, and the half that did not
// has to be written down rather than inferred from nothing having thrown.
//
// That is the whole reason `revokePushToken` returns a BOOLEAN and its own
// header says "a failed delete and a failed verify both resolve FALSE". The
// sweep used to `await` it and throw the answer away, which made a revoke that
// could not be proven indistinguishable from one that was — success claimed
// from the absence of an error, about the one row that decides whether a
// stranger's coach's words go on arriving on this phone.
//
// Pure: strings, unions and a rule. No storage, no network, no React.

/** Where a sweep is being run from. */
export type SweepCause = 'deliberate' | 'brand-mismatch' | 'remote';

/**
 * Every exit, named.
 *
 * A list rather than a comment because the test asserts it against the three
 * call sites in src/ui/auth.tsx: a fourth way out of a session added without a
 * sweep beside it is the defect this whole file exists to close, and it should
 * fail here rather than be found on a shared handset.
 */
export const SWEEP_CAUSES: readonly SweepCause[] = ['deliberate', 'brand-mismatch', 'remote'];

/**
 * Whether the session being ended is still usable at the moment this sweep
 * runs.
 *
 * Stated once, here, because it is the single fact the three paths differ on
 * and every other decision in this file is downstream of it.
 */
export function sessionIsLiveAt(cause: SweepCause): boolean {
  switch (cause) {
    // Both of these run BEFORE `sbSignOut()`, deliberately and for this reason.
    case 'deliberate': return true;
    case 'brand-mismatch': return true;
    // By the time this one is reached the session is already gone. Nothing
    // reorders that: it is an event ABOUT the session having ended.
    case 'remote': return false;
  }
}

/**
 * What became of this handset's row in `push_tokens`.
 *
 * Five answers, and only one of them means the handset is off the list.
 */
export type PushDisposition =
  /** The delete was made and the row was read back as gone. */
  | 'revoked'
  /** Attempted, and could NOT be shown to have worked. `revokePushToken` says
   *  false for a refused delete and for a verify it could not make, and the
   *  difference between those is not knowable from here. Either way the row may
   *  still be there, which is the only thing a caller can act on. */
  | 'not-proven'
  /** Attempted and threw before it could answer at all. */
  | 'threw'
  /** Not attempted, because there was no session to attempt it under. Not a
   *  failure to try — a thing that cannot be done from this path. */
  | 'no-session'
  /** Not attempted, because an earlier sweep in this same app run already
   *  proved the row gone for this account. The ordinary case: `signOut` revokes
   *  and then ends the session, and ending the session fires the remote path at
   *  this module a second time. */
  | 'already-revoked';

/**
 * Read the disposition off what actually happened.
 *
 * @param proven what `revokePushToken` answered, or null when it threw. Ignored
 *   when no attempt was possible.
 * @param priorRevoked whether an earlier sweep in this app run proved the row
 *   gone for this same account.
 */
export function pushDisposition(input: {
  cause: SweepCause;
  proven?: boolean | null;
  priorRevoked?: boolean;
}): PushDisposition {
  if (!sessionIsLiveAt(input.cause)) {
    return input.priorRevoked ? 'already-revoked' : 'no-session';
  }
  if (input.proven === true) return 'revoked';
  if (input.proven === false) return 'not-proven';
  return 'threw';
}

/**
 * Whether this handset is knowingly still reachable by notifications sent to
 * the account that has just left.
 *
 * Three of the five say yes, and they say it for different reasons that come to
 * the same thing for the reader: nobody has established that the row is gone.
 * `'not-proven'` is deliberately in here — "the delete did not report an error"
 * is not evidence, and treating it as evidence is the defect this replaces.
 */
export function tokenLeftBehind(d: PushDisposition): boolean {
  return d === 'not-proven' || d === 'threw' || d === 'no-session';
}

/**
 * The sentence for a disposition, in the terms of what is true of the handset.
 *
 * Written out rather than assembled, and it never says "failed" about
 * `'no-session'`: nothing failed there. The call could not be made, the row is
 * therefore still on the server, and the thing that will eventually take it off
 * is named so that a reader of a report is not left thinking it is lost.
 */
export function pushLine(d: PushDisposition): string {
  switch (d) {
    case 'revoked':
      return 'This handset was taken off that account’s notification list and the row was read back as gone.';
    case 'not-proven':
      return 'The delete of this handset’s notification registration could not be shown to have worked, so the row may still be there and this phone may still receive that account’s notifications.';
    case 'threw':
      return 'The delete of this handset’s notification registration could not be attempted to a conclusion, so the row may still be there.';
    case 'no-session':
      return 'The session had already ended, so this handset’s notification registration could not be deleted from here — that delete is only possible from inside the session being ended. The row is still on the server. The reconciler in src/ui/settings.tsx removes it at the next launch on which somebody is signed in on this handset with notifications off.';
    case 'already-revoked':
      return 'This handset had already been taken off that account’s notification list earlier in this session, and that is not repeated.';
  }
}

/**
 * What happened to the reminders scheduled on the phone itself.
 *
 * The ids in `repple.reminders` are the ONLY handle anything has on those OS
 * notifications, so this is not merely a report — `remindersKeyMayGo` reads it
 * to decide whether the key is allowed to be cleared at all.
 */
export type ReminderDisposition =
  /** The ids were read and a cancel was issued for each. */
  | 'cancelled'
  /** Nothing was stored under the key. Nothing is scheduled to cancel. */
  | 'none-stored'
  /** The key could not be READ. A failed read is not an empty list: there may
   *  be notifications scheduled whose ids are now unknown. */
  | 'ids-unknown'
  /** The ids were read and cancelling them threw before it was done. */
  | 'cancel-failed'
  /** This build has no OS scheduler, so nothing is holding a notification and
   *  the key is only data. */
  | 'no-scheduler';

/**
 * Whether `repple.reminders` may be cleared, given what happened above it.
 *
 * This is the ordering hazard src/lib/signOutState.ts sets out for
 * `repple.motivation.armed`, applied to the key that is already on the list.
 * Clearing the key when the ids are unknown, or when cancelling them did not
 * finish, leaves a stranger's 6am reminder firing on the next member's phone
 * with nothing left in the app that knows its id — unfixable short of a
 * reinstall. So the key stays, the sweep says it stayed, and the next launch
 * that can read it gets another go.
 *
 * Keeping it has a cost and it is the smaller one: the next member on a shared
 * handset can see a stranger's reminder times on the reminders screen until
 * that read succeeds. Nobody is buzzed by them — the cancel is what stops that
 * — and a visible wrong list is recoverable in a way an un-cancellable
 * notification is not.
 */
export function remindersKeyMayGo(d: ReminderDisposition): boolean {
  return d === 'cancelled' || d === 'none-stored' || d === 'no-scheduler';
}

/**
 * The keys this sweep is allowed to remove.
 *
 * Everything on the list, minus `repple.reminders` when its ids are not
 * accounted for. `remindersKey` is passed in rather than imported because this
 * file is compiled and run under plain node and that key belongs to a React
 * Native module (src/ui/reminderSync.tsx).
 */
export function keysToClear(
  all: readonly string[],
  reminders: ReminderDisposition,
  remindersKey: string,
): string[] {
  if (remindersKeyMayGo(reminders)) return [...all];
  return all.filter((k) => k !== remindersKey);
}

/** One sweep, as it happened. Append-only; see `makeSweepLog`. */
export interface SweepRecord {
  cause: SweepCause;
  /** Whose session ended, where that is knowable. Null on a remote end for
   *  which nothing in this app run ever read a user id. */
  uid: string | null;
  at: number;
  push: PushDisposition;
  reminders: ReminderDisposition;
  /**
   * The personal keys still on the handset AFTER the sweep, read back off the
   * device rather than inferred.
   *
   * An empty array means the device was asked and none of them is there. `null`
   * means the read-back itself could not be made, which is a different fact and
   * must not collapse into the first: `multiRemove` returning without throwing
   * is not evidence that anything was removed.
   */
  left: readonly string[] | null;
}

/**
 * Whether this sweep is known to have taken everything.
 *
 * Three-valued on purpose, and the middle value is the point: null is "the
 * device would not tell us", which is neither of the other two.
 */
export function sweptClean(r: SweepRecord): boolean | null {
  if (r.left == null) return null;
  return r.left.length === 0;
}

/** A reader's summary of one sweep. Says what was done and what was not, in
 *  that order, and never lets the second half go unsaid. */
export function sweepLine(r: SweepRecord): string {
  const clean = sweptClean(r);
  const keys =
    clean === true ? 'Every device-local key belonging to that account is off this handset.'
    : clean === false ? `Still on this handset: ${r.left!.join(', ')}.`
    : 'Whether the keys are off this handset could not be read back, so it is not known.';
  return `${keys} ${pushLine(r.push)}`;
}

/**
 * The sweeps this app run has made.
 *
 * APPEND-ONLY, and that is the whole design. A later sweep that finds the push
 * token already revoked does not go back and amend the first record; it files a
 * second one saying `'already-revoked'`. A correction is another recorded fact,
 * never an erasure — otherwise the only evidence that the deliberate sign-out
 * did the server half would be overwritten by the remote event that sign-out
 * itself caused.
 *
 * Bounded, because this outlives every session in the process and a handset at
 * a gym desk sees a great many of them.
 */
export interface SweepLog {
  record(r: SweepRecord): SweepRecord;
  all(): readonly SweepRecord[];
  /**
   * Whether some earlier sweep in this app run PROVED the push row gone for
   * this account.
   *
   * A null uid is not a wildcard and never matches: not knowing who is leaving
   * is a reason to assume the row is still there, not permission to assume
   * somebody else's revoke covered it.
   */
  pushProvenGoneFor(uid: string | null): boolean;
}

export function makeSweepLog(limit = 20): SweepLog {
  const rows: SweepRecord[] = [];
  return {
    record(r) {
      rows.push(r);
      if (rows.length > limit) rows.splice(0, rows.length - limit);
      return r;
    },
    all() { return rows; },
    pushProvenGoneFor(uid) {
      if (uid == null || uid === '') return false;
      return rows.some((r) => r.uid === uid && (r.push === 'revoked' || r.push === 'already-revoked'));
    },
  };
}
