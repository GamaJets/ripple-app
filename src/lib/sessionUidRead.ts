// The same question as src/lib/authedUid.ts, asked of the OTHER call shape.
//
// ── why this exists at all ────────────────────────────────────────────────
//
// `uidFromAuth` takes `{ data: { user }, error }` — what `supabase.auth
// .getUser()` resolves with. Most of `src/ui` does not call `getUser()`. It
// calls `getSession()`, which resolves with `{ data: { session }, error }`, and
// seventy of the hundred-and-sixteen discarded auth reads on `check:reads`'s
// ratchet are that call rather than the other one.
//
// The swap is deliberate and it is not a mistake to be undone: `getSession()`
// answers from device storage and therefore answers OFFLINE, and src/ui
// /glucoseData.ts records at length what happened when a provider fronted its
// reads with `getUser()` instead — the network revalidation resolved with
// `user: null` behind an `AuthRetryableFetchError`, the id stayed null, every
// refresher returned at its `if (!uid)` guard without writing a status, and a
// member wearing a continuous glucose monitor was left looking at "Still
// loading." for a whole session. So the fix for the error-discarding defect
// must NOT be "call getUser() and pass it to uidFromAuth": that trades a wrong
// answer for a slower wrong answer.
//
// ── but getSession has the identical defect ───────────────────────────────
//
// Observed in the installed `@supabase/auth-js`, `GoTrueClient.js`,
// `__loadSession` — the function `getSession()` is a one-line wrapper around:
//
//     const { data: session, error } = await this._callRefreshToken(…);
//     if (error) {
//       … if the access token is still inside its real expiry window, hand
//         back the stored session …
//       return this._returnResult({ data: { session: null }, error });
//     }
//
// So when the stored access token HAS expired and the refresh cannot reach the
// server, `getSession()` resolves with `session: null` and a retryable error
// beside it. `sess?.session?.user?.id` is `undefined` — exactly what it is for
// somebody who has never signed in. That is the whole defect, on the call that
// two thirds of this tree actually makes.
//
// ── what this module adds, and what it refuses to add ─────────────────────
//
// It adds the adapter and nothing else. Which errors mean "signed out" is
// decided in src/lib/authReadFate.ts, against the installed library, and is not
// restated here; every path below ends in `uidFromAuth`, which ends in
// `authReadFate`. A second copy of that discrimination would be a second thing
// to keep true, and the two would drift on the day auth-js adds an error class.
//
// The one judgement this file makes that its sibling cannot is about a session
// that is PRESENT but has no readable user on it — see `uidFromSession`.

import { uidFromAuth, type UidRead } from './authedUid';

/**
 * The part of `supabase.auth.getSession()`'s resolved value this reads.
 *
 * Structural rather than imported, for the reason both sibling files give: two
 * copies of `@supabase/auth-js` are installed (2.110.2 at the root, 2.112.3
 * under studio-web) and `src/lib` takes a compile-time dependency on neither.
 */
export interface AuthSessionResult {
  readonly data?: {
    readonly session?: { readonly user?: { readonly id?: unknown } | null } | null;
  } | null;
  readonly error?: unknown;
}

/**
 * Turn a resolved `supabase.auth.getSession()` into a uid, or into the reason
 * there is not one.
 *
 * Four cases:
 *
 *   · an `error` — handed to `uidFromAuth` with no user, so `authReadFate`
 *     decides. An outage lands as 'unreadable'; a refused or missing
 *     credential lands as 'signed-out'. The error decides even where a session
 *     also came back, because "something went wrong asking" is the more
 *     cautious reading and these callers gate screens on the answer.
 *
 *   · no error and `session: null` — 'signed-out'. This is the library's
 *     answer for a device with nothing in storage (`{ data: { session: null },
 *     error: null }`), and it is the one place a null session is genuinely a
 *     statement about the person rather than about the network.
 *
 *   · a session carrying a non-empty string user id — signed in.
 *
 *   · a session that is THERE but whose user is not readable — 'unreadable',
 *     and this is the case `uidFromAuth` alone would get wrong. Handed
 *     `{ user: undefined }` it answers 'signed-out', because for `getUser()`
 *     an absent user IS the sign-out. Here it is not: a session object exists,
 *     so somebody is signed in, and auth-js can hand back exactly this shape —
 *     when a `userStorage` is configured and the user half is missing it
 *     substitutes `userNotAvailableProxy()`. Telling that person they are
 *     signed out is the substitution this whole family of files exists to
 *     stop, so the session's own existence outweighs the missing id and the
 *     answer is the harmless one.
 */
export function uidFromSession(res: AuthSessionResult | null | undefined): UidRead {
  if (typeof res !== 'object' || res === null) return { uid: null, fate: 'unreadable' };

  // Classified once, in authReadFate, by way of uidFromAuth. The user is passed
  // as null rather than as whatever came back, because on this path the error
  // is the whole answer and a session beside it would only invite a reading of
  // `data` that the error has already disqualified.
  if (res.error) return uidFromAuth({ data: { user: null }, error: res.error });

  const session = res.data?.session;
  if (session == null) return { uid: null, fate: 'signed-out' };

  const read = uidFromAuth({ data: { user: session.user } });
  // Narrowed on `fate`, never on `!read.uid`. UidRead's members are told apart
  // by fate being null or not; `uid`'s non-null member is `string`, which
  // includes '', so `!read.uid` leaves `fate` as `AuthReadFate | null` and the
  // compiler is right to refuse it.
  if (read.fate === null) return read;
  // Reached only for a session with no usable id on it. See the doc comment:
  // a present session outranks an absent user, and the doubt runs toward the
  // answer that costs a retry rather than the one that costs a false sign-out.
  return { uid: null, fate: 'unreadable' };
}
