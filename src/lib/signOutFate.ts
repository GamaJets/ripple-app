// What a failed `supabase.auth.signOut()` actually established, and what a
// person can honestly be told about it.
//
// ── why this is not just `if (error) return false` ────────────────────────
//
// The owner console's rail ran this:
//
//     supabase.auth.signOut().then(() => location.reload())
//
// The `error` is discarded and the page reloads whatever happened, so a
// sign-out that was refused looks byte-for-byte like one that worked. On the
// shared front-desk machine — the case the button exists for — that is somebody
// walking away from a console the next person is still signed into, having
// watched it apparently sign them out.
//
// The naive repair is "reload only when there is no error", and it is wrong in
// both directions. `supabase.auth.*` does not reject on failure: it RESOLVES
// with `{ error }`, and `@supabase/auth-js` brands offline, DNS, a captive
// portal and every 5xx as an `AuthError` alongside a genuine refusal. So
// `error` on its own cannot tell an outage from a sign-out, and a console that
// refused to reload on any error would keep a genuinely signed-out person
// staring at a console with a broken-looking button. `./authReadFate` is where
// that discrimination is written down and tested; this file is the join between
// it and the one question a Sign Out button asks.
//
// ── what an errored signOut leaves behind, read rather than assumed ───────
//
// `_signOut` in `@supabase/auth-js` (v2.112.3, the copy under
// studio-web/node_modules; the root copy is 2.110.2 and identical here) has two
// failure exits and they leave the machine in opposite states:
//
//   · the session read at the top fails with something other than
//     session-missing — it returns that error and does NOT call
//     `removeCurrentSession()`, so the stored session survives and the person
//     is still signed in on this device;
//   · the POST to /logout fails — it calls `removeCurrentSession()` FIRST and
//     then returns the error, so local storage is clear while the refresh token
//     stays live on the server.
//
// Nothing in the resolved value separates those. Nor does asking afterwards:
// `getSession()` and `getUser()` fail the same way on the same dropped
// connection, and `{ user: null }` out of a failed read is not a statement
// about the person — which is the whole argument of `./authReadFate`.
//
// ── so the answer is two-valued, and the sentence claims neither outcome ──
//
// `'ended'` is only returned where the session is genuinely gone: no error at
// all, or an error that establishes there was no usable credential to end.
// Everything else is `'unconfirmed'`, including a plain `Error` and anything a
// future version of auth-js invents — the same allowlist direction
// `./authReadFate` argues for, for the same reason. Being told to press it
// again costs one press. Being wrongly told the desk is clear costs the gym's
// books to whoever sits down next.
import { authReadFate } from './authReadFate';

/**
 * `'ended'` — the session is gone and a reload lands somewhere honest.
 *
 * `'unconfirmed'` — the question could not be asked. Nothing was established
 * about whether this browser is still signed in, and in particular this is NOT
 * a statement that it is signed out.
 */
export type SignOutOutcome = 'ended' | 'unconfirmed';

/**
 * Classify the `error` half of a `supabase.auth.signOut()` result.
 *
 * A falsy `error` is `'ended'`: the library reached the end of `_signOut`, which
 * only happens after `removeCurrentSession()`.
 *
 * A `'signed-out'` fate is `'ended'` too, and that is not a fudge. It means the
 * credential was looked at and refused, or there was never one — there is no
 * session left to end, so saying so and showing the sign-in form is the truth
 * rather than a guess. (`AuthSessionMissingError` and an `AuthApiError` at 401
 * or 403 never reach a caller anyway: `_signOut` swallows those deliberately,
 * under its own comment that an expired JWT should still sign the session out.)
 *
 * Pass the error and nothing else. Do not decide from a `user` or `session`
 * read afterwards, which is null in both cases.
 */
export function signOutOutcome(error: unknown): SignOutOutcome {
  if (!error) return 'ended';
  return authReadFate(error) === 'signed-out' ? 'ended' : 'unconfirmed';
}

/**
 * What the person is told when the sign-out could not be confirmed.
 *
 * Three things, and nothing beyond them. It says the sign-out was NOT
 * confirmed, which is the only fact available. It states the consequence that
 * matters where this button matters — this browser MAY still be signed in —
 * without claiming that it is. And it gives the action that follows from not
 * knowing: stay with the machine until a sign out goes through.
 *
 * What it deliberately does not say: "you are signed out" (unestablished, and
 * the dangerous direction), "you are still signed in" (equally unestablished),
 * and "try again later" (the session on the server may already be gone, so
 * later may never confirm anything). "Check your connection" is left out too —
 * a 502 from the auth host reaches here as well, and telling somebody to fix
 * their wifi over a server fault sends them off to fix the wrong thing.
 */
export const SIGN_OUT_UNCONFIRMED =
  'Sign out was not confirmed. The sign-in service could not be reached, so this '
  + 'browser may still be signed in. Do not leave this machine until a sign out goes through.';
