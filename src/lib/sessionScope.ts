// Whose workout the handset is holding.
//
// ── The defect ────────────────────────────────────────────────────────────
//
// Three AsyncStorage keys in app/(client)/workouts.tsx carried no account:
//
//     const LIVE_SESSION_KEY = 'repple.liveSession.v1';   // a session IN FLIGHT
//     const GUIDED_DRAFT_KEY = 'repple.guidedSession';    // the sets as typed
//     const draftKey = `repple.workoutDraft.${dstr(dateFor(dayIdx))}`;
//
// The first two are device-global outright. The third looks scoped and is not:
// a date is not an account, so every member who trains on one handset on one
// day shares one draft. A gym desk handset, a family phone, a demo device at a
// trade stand — the ordinary cases — and each of the three is inherited whole
// by whoever signs in next.
//
// ── Why these three are worse than a preference ───────────────────────────
//
// src/lib/signOutState.ts already sorts device-global keys into two piles: a
// PREFERENCE is cleared at sign-out, a RECORD is keyed by account. These are
// the second kind, and they are the far end of it — they do not merely show
// the wrong thing, they end in a WRITE of training data:
//
//   1. Member A trains, the app is killed or the phone is locked, A's session
//      and A's sets are on the disk under a key with no name on it.
//   2. A signs out. Member B signs in on the same handset.
//   3. The runner mounts, reads the unqualified key, restores A's sets, and
//      B is shown "Picked up where you left off".
//   4. B taps Finish. `SessionRunner.save` calls `onComplete`, which is
//      `logWorkouts` in src/ui/workoutLog.tsx, which sends
//      `entryToRow(uidRef.current, e)` — and `uidRef.current` is resolved
//      FRESH from `supabase.auth.getUser()` at save time, so it is B.
//
// So the row lands in `workouts` with `user_id = B`. Not refused: it is a
// well-formed insert of B's own id, made by B's session, so RLS is satisfied
// and `classifyWrite` reports 'stored'. A's lifts become B's training history —
// the history B's coach reads, programmes the next block from, and shows B as
// their progress. There is no error anywhere, and nothing afterwards can tell
// the two apart: the sets are indistinguishable from sets B performed.
//
// The same trace holds for `repple.workoutDraft.<date>`, which is poured into
// `logged` and saved by the plan screen through the same provider, and for
// `repple.liveSession.v1`, which restores the CLOCK a session is written with —
// A's `startedAt` becoming the duration on B's record.
//
// ── The fix, and why it is not a migration ────────────────────────────────
//
// The account goes in the key, as src/lib/mealSwaps.ts and
// src/lib/handsetClips.ts already do for their own stores, and the old
// unqualified key is REMOVED UNREAD.
//
// Not migrated. A migration would have to answer "whose sets are these?" and
// the blob does not say — that is the whole defect. Nothing on the device
// distinguishes a single-owner handset's own abandoned draft from the previous
// member's, so reading it into the signed-in account is a guess whose wrong
// answer is a stranger's lifts recorded under somebody's name, in a health
// record, with a coach acting on it. The right answer saves one member
// re-typing sets that had not reached the server anyway. Those two are not
// close enough to weigh, so the bytes go.
//
// ── Pure ──────────────────────────────────────────────────────────────────
//
// Strings, a clock and a rule. No storage, no React: app/(client)/workouts.tsx
// does the reads and writes, and src/lib/sessionScope.test.ts holds both ends
// of every decision here — including a whole sign-in → sign-out → sign-in
// against a fake store, which is the sequence the defect lives in and the one
// thing a screen test could not state.

import { mayRestore, parseLiveSession, type LiveSession } from './liveSession';

/* ── the keys ────────────────────────────────────────────────────────────── */

/** Every account-scoped live-session key starts with this. */
export const LIVE_SESSION_PREFIX = 'repple.liveSession.v1:';
/** Every account-scoped guided-draft key starts with this. */
export const GUIDED_DRAFT_PREFIX = 'repple.guidedSession:';
/** Every account-scoped per-day draft key starts with this. The separator is a
 *  COLON and the legacy one is a dot, which is what lets
 *  `isLegacyWorkoutDraftKey` tell a key this file writes from a key it
 *  replaces without the two ever being confusable. */
export const WORKOUT_DRAFT_PREFIX = 'repple.workoutDraft:';

/** The unqualified live-session key this replaces. Removed on sight, never
 *  read — see the header. */
export const LEGACY_LIVE_SESSION_KEY = 'repple.liveSession.v1';
/** The unqualified guided-draft key this replaces. Removed on sight, never
 *  read. */
export const LEGACY_GUIDED_DRAFT_KEY = 'repple.guidedSession';
/** What the date-scoped-but-not-account-scoped draft keys start with. There is
 *  one per day the handset has ever drafted on, so they are found by prefix
 *  rather than named. */
export const LEGACY_WORKOUT_DRAFT_PREFIX = 'repple.workoutDraft.';

/** The two flat legacy keys, for a caller that removes them in one call. The
 *  dated ones are a prefix and are swept separately. */
export const LEGACY_SESSION_KEYS: readonly string[] = [
  LEGACY_LIVE_SESSION_KEY,
  LEGACY_GUIDED_DRAFT_KEY,
];

/**
 * The account a key may be built from, or null.
 *
 * Null means DO NOT TOUCH THE STORE — not "use a shared key", which is the
 * defect, and not "clear it", which would throw away the session of the member
 * whose auth read simply has not landed yet.
 *
 * 'unknown' is refused by name because it is a real value: src/ui/clientData.tsx
 * exposes `id: sbUid ?? 'unknown'`, so it is what every signed-out and
 * still-resolving session on the handset reports, and composing a key from it
 * would give all of them one key — the defect again, under a new spelling.
 * src/lib/handsetClips.ts guards the same literal for the same reason.
 *
 * A colon is refused because it is the separator: an id containing one could
 * make `<uid>:<date>` ambiguous, and an ambiguous key is a key two accounts can
 * collide on. No Supabase user id contains one; this is here so that stays
 * true by construction rather than by luck.
 */
export function accountScope(uid: string | null | undefined): string | null {
  const id = typeof uid === 'string' ? uid.trim() : '';
  if (!id) return null;
  if (id === 'unknown' || id === 'null' || id === 'undefined') return null;
  if (id.includes(':')) return null;
  return id;
}

/** Where THIS member's in-flight session is remembered, or null for no account. */
export function liveSessionKey(uid: string | null | undefined): string | null {
  const id = accountScope(uid);
  return id ? `${LIVE_SESSION_PREFIX}${id}` : null;
}

/** Where THIS member's guided-runner sets live between the typing and the
 *  save, or null for no account. */
export function guidedDraftKey(uid: string | null | undefined): string | null {
  const id = accountScope(uid);
  return id ? `${GUIDED_DRAFT_PREFIX}${id}` : null;
}

/**
 * A calendar day exactly as the screen spells it: four digits, two, two.
 *
 * Checked as a STRING and never parsed. A `new Date('2026-09-14')` is midnight
 * UTC, and rendering that back through a local getter moves the day for every
 * reader west of Greenwich — which would file a draft under the day before the
 * one it was typed on, for half the planet, and hand it back to the wrong
 * screen. scripts/check-utc-day.mjs exists because this keeps happening; there
 * is nothing to gain by normalising a string that is already canonical.
 */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Whether a string is a bare YYYY-MM-DD. Exported for the assertion. */
export const isDayKey = (d: unknown): d is string => typeof d === 'string' && DAY_RE.test(d);

/**
 * Where THIS member's draft for THIS day lives.
 *
 * Null for no account, and null for a day that is not a bare YYYY-MM-DD —
 * a malformed day would otherwise produce a key some other malformed day could
 * also produce, which is the collision this file exists to end.
 */
export function workoutDraftKey(uid: string | null | undefined, day: string): string | null {
  const id = accountScope(uid);
  if (!id || !isDayKey(day)) return null;
  return `${WORKOUT_DRAFT_PREFIX}${id}:${day}`;
}

/** Whether a stored key is one of the dated-but-unowned drafts this replaces.
 *  Used to sweep them; it must never match a key `workoutDraftKey` writes. */
export const isLegacyWorkoutDraftKey = (k: unknown): boolean =>
  typeof k === 'string' && k.startsWith(LEGACY_WORKOUT_DRAFT_PREFIX);

/* ── the gate on a write ─────────────────────────────────────────────────── */

/**
 * Whether a write may stand on the bytes at a key.
 *
 * `hydrated` is the arming flag: false until a read OF THIS KEY has come back.
 * It exists because the alternative is worse than showing the wrong draft —
 * an account switch whose read then FAILS would write the new account's empty
 * state straight over their stored sets, which is the one way to lose a draft
 * rather than merely misfile one. Lane 4 hit this in `repple.mealOverride`,
 * src/ui/exerciseVideos.ts carries the same note, and it is the reason this is
 * a value rather than a boolean somebody remembers to reset.
 */
export interface DraftGate {
  /** The key the flag is ABOUT. A gate is only ever consulted for its own key. */
  key: string | null;
  hydrated: boolean;
}

/** The gate a key change must produce: disarmed, for the new key. Called
 *  BEFORE the read, so a read that fails leaves nothing armed. */
export const gateForKey = (key: string | null): DraftGate => ({ key, hydrated: false });

/**
 * Arm the gate, if the read that came back is still the read we are waiting
 * for.
 *
 * The key argument is the key that was READ. A response for the previous
 * account arriving after the switch must not arm the new account's key — it
 * answered a different question, and treating it as an answer to this one is
 * how one member's emptiness gets written over another's sets.
 */
export const gateHydrated = (g: DraftGate, readKey: string | null): DraftGate =>
  (readKey != null && g.key === readKey ? { key: g.key, hydrated: true } : g);

/** Whether `key` may be written. Both halves are required: an account to write
 *  under, and a landed read of that same account's bytes. */
export const mayPersist = (g: DraftGate, key: string | null): boolean =>
  key != null && g.key === key && g.hydrated;

/* ── the resume decision ─────────────────────────────────────────────────── */

/**
 * What to do about a session record on the disk.
 *
 * Four answers rather than a boolean, because three of them are different
 * kinds of "no" and the store must be treated differently in each:
 *
 *   · 'wait'   — there is no account yet. Read nothing, write nothing, remove
 *                nothing. The member's own session is still on the disk under
 *                their own key and must survive the seconds before the auth
 *                read lands, or a benign remount would cost somebody a workout
 *                in progress.
 *   · 'none'   — nothing to resume. Either the store held nothing, or the read
 *                FAILED, or the bytes did not parse. The store is left exactly
 *                as it is: a failed read is not an empty store, and nothing may
 *                be deleted on the strength of a question that was not
 *                answered.
 *   · 'forget' — a real record, too old to be about anything. Removed. See
 *                RESTORE_WINDOW_MS in src/lib/liveSession.ts: restoring it
 *                would put a nine-hour "workout" into a health record.
 *   · 'resume' — this member's session, in the window. Re-open it.
 */
export type ResumeDecision =
  | { act: 'wait' }
  | { act: 'none' }
  | { act: 'forget' }
  | { act: 'resume'; session: LiveSession };

/**
 * Whether the bytes at this account's live-session key are a session to
 * re-open.
 *
 * `read` is the outcome of the getItem, passed in rather than inferred from
 * `raw`, so "the store answered with nothing" and "the store did not answer"
 * stay two facts. They differ in exactly one place and it is the one that
 * matters: whether the record may be deleted.
 */
export function liveSessionResume(input: {
  uid: string | null | undefined;
  read: 'ok' | 'failed';
  raw: string | null | undefined;
  now: number;
}): ResumeDecision {
  if (!accountScope(input.uid)) return { act: 'wait' };
  if (input.read !== 'ok') return { act: 'none' };
  const session = parseLiveSession(input.raw);
  // Unparseable is not "stale". It is bytes we could not read, and the member
  // may yet be mid-session; removing them would end a workout on the strength
  // of a JSON error. They are overwritten by the next real write.
  if (!session) return { act: 'none' };
  if (!mayRestore(session, input.now)) return { act: 'forget' };
  return { act: 'resume', session };
}
