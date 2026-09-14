// Who is signed in — and, when nobody is, WHICH of the two reasons it was.
//
// ── the shape this exists to replace ──────────────────────────────────────
//
//     const { data: auth } = await supabase.auth.getUser();
//     const uid = auth?.user?.id; if (!uid) return null;
//
// That line appeared fourteen times across src/lib/connect.ts and
// src/lib/subscriptions.ts — the Stripe Connect onboarding and the recurring
// billing, which is to say most of what this app says to anybody about their
// own money. `error` is not on the line, so it is discarded, and
// src/lib/authReadFate.ts sets out at length why that single omission is not a
// tidiness problem: `getUser()` RESOLVES on a dropped connection with
// `{ data: { user: null }, error }`, so an outage and a genuine sign-out arrive
// at `uid` as the same `undefined`. Read without `error`, `!uid` means "either
// nobody is signed in, or we could not ask, and this code cannot tell which".
//
// ── what this module is, and what it deliberately is not ─────────────────
//
// It is the join between that destructure and `authReadFate`, and nothing
// more. It does NOT re-decide which errors mean signed out — that
// discrimination is written once, in authReadFate.ts, against the installed
// library, and a second copy of it here would be a second thing to keep true.
// This file answers only the question the call sites actually ask, which is a
// different one: "have I got a uid, and if not, what do I say".
//
// It takes the RESULT of the auth call rather than making it, so that it holds
// no dependency on `./supabase` and therefore none on react-native. src/lib is
// shared by the phone apps and the web console; connect.ts and subscriptions.ts
// are both unreachable from a plain `node` test because they import
// `react-native` at the top for `Linking`, and this module has to be testable
// even though its callers are not. src/lib/signedInUid.ts is the four-line glue
// that does make the call, and it is thin precisely because everything worth
// asserting is in here.
//
// ── the direction the doubt runs ─────────────────────────────────────────
//
// Inherited from authReadFate.ts and restated because it is the whole point:
// an outage called 'signed-out' tells a coach mid-onboarding that their payout
// setup does not exist and invites them to re-enter a password that was never
// the problem. A real sign-out called 'unreadable' costs one wasted retry.
// Where the two cannot be told apart, this answers 'unreadable'.

import { authReadFate, type AuthReadFate } from './authReadFate';

/**
 * The answer to "who is signed in", with the failure kept rather than collapsed.
 *
 * A `uid` and a `fate` are mutually exclusive on purpose: there is no such
 * thing as a half-read identity, and a caller holding a uid has nothing left to
 * classify.
 */
export type UidRead =
  | { readonly uid: string; readonly fate: null }
  | { readonly uid: null; readonly fate: AuthReadFate };

/**
 * The part of `supabase.auth.getUser()`'s resolved value this reads.
 *
 * Structural rather than imported, for the reason authReadFate.ts gives about
 * the same shape: there are two copies of `@supabase/auth-js` installed and
 * src/lib takes a compile-time dependency on neither. `getSession()` resolves
 * with `{ data: { session }, error }` instead, so a caller of that one passes
 * `{ data: { user: res.data.session?.user }, error: res.error }`.
 */
export interface AuthUserResult {
  readonly data?: { readonly user?: { readonly id?: unknown } | null } | null;
  readonly error?: unknown;
}

/**
 * Turn a resolved `supabase.auth.getUser()` into a uid, or into the reason
 * there is not one.
 *
 * Three cases, and the third is the one worth reading twice:
 *
 *   · an `error` — classified by `authReadFate`, never by the absent user. The
 *     error decides even in the shape auth-js does not produce today (an error
 *     AND an id), because "something went wrong asking about the credential" is
 *     the more cautious of the two readings and this is a money path.
 *   · no error and a non-empty string id — signed in, and that is the only way
 *     to be signed in here. An id that is not a string, or is blank, is not a
 *     uid; it is a response shape nobody has seen, and it lands as unreadable
 *     rather than as a person.
 *   · no error and no id — 'signed-out'. This is `getSession()`'s answer for
 *     somebody with no stored session (`{ session: null, error: null }`), and
 *     it is the one place a null user is genuinely a statement about the
 *     person. `getUser()` reaches the same verdict by way of
 *     `AuthSessionMissingError`, which `authReadFate` puts in the same bucket.
 *
 * A result that is null, or not an object at all, is 'unreadable': nothing
 * answered, so nothing was established.
 */
export function uidFromAuth(res: AuthUserResult | null | undefined): UidRead {
  if (typeof res !== 'object' || res === null) return { uid: null, fate: 'unreadable' };
  if (res.error) return { uid: null, fate: authReadFate(res.error) };
  const id = res.data?.user?.id;
  if (typeof id === 'string' && id.trim()) return { uid: id, fate: null };
  // An id of the wrong type is not a sign-out. Nobody said anything about this
  // person's credential; the answer simply did not have a person in it.
  if (id != null) return { uid: null, fate: 'unreadable' };
  return { uid: null, fate: 'signed-out' };
}

/** The credential was looked at and refused, or there was never one. */
const SIGNED_OUT_MESSAGE = 'You are signed out. Sign in again and nothing will have been lost.';

/**
 * The question could not be asked.
 *
 * Says what did NOT happen, because the sentence it replaces — "Not signed in."
 * — told a working coach during an outage that their session had ended, over an
 * action that never reached a write. The second clause is true of every caller
 * in this repo today: each returns BEFORE its insert. A future caller that
 * writes first must not borrow this sentence.
 */
const AUTH_UNREADABLE_MESSAGE =
  'We could not check your account just now, so nothing has been changed. That is our end rather than your sign-in — try again in a moment.';

/**
 * What to put in front of somebody when an action could not establish who they
 * are. Two sentences, because there are two facts, and the difference between
 * them is the difference between "go and sign in again" and "this is our end".
 */
export function authGateMessage(fate: AuthReadFate): string {
  return fate === 'signed-out' ? SIGNED_OUT_MESSAGE : AUTH_UNREADABLE_MESSAGE;
}

/**
 * The thing to hand `reportError` when an auth read established nothing, and
 * `null` when it established a sign-out.
 *
 * Somebody not being signed in is not a fault and is not reported. An outage is
 * both, and it has to leave a trace somewhere, because the twelve callers that
 * return `null` or `status: 'error'` for BOTH fates give the outage no other
 * way to be seen — their return types have no room for a third answer and
 * widening them reaches screens this module cannot see.
 */
export function authGateFault(fate: AuthReadFate): Error | null {
  return fate === 'unreadable'
    ? new Error('auth read unreadable — who is signed in could not be established')
    : null;
}
