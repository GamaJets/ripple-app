// Did the auth server say "not you", or did it not say anything at all?
//
// ── why this file exists ──────────────────────────────────────────────────
//
// `supabase.auth.getUser()` does not reject when the auth server is down. It
// RESOLVES, with `{ data: { user: null }, error }` — the same shape it resolves
// with when the person genuinely has no session. Read without `error`, both
// arrive as `user === null`, and a console that reads `null` as "signed out"
// puts the sign-in form in front of a signed-in owner during an outage and
// invites them to re-enter a password that was never the problem.
//
// Observed, not remembered — `@supabase/auth-js`, `GoTrueClient.js`, the
// `catch` at the bottom of `_getUser` (v2.112.3, the copy installed under
// studio-web/node_modules; identical in the v2.110.2 copy at the repo root):
//
//     catch (error) {
//       if (isAuthError(error)) {
//         if (isAuthSessionMissingError(error)) { await this._removeSession(); }
//         return this._returnResult({ data: { user: null }, error });
//       }
//       throw error;                       // ONLY a non-AuthError throws
//     }
//
// and `lib/fetch.js`, `_handleRequest`, which turns a failed `fetch` — offline,
// DNS, CORS, captive portal, abort — into `new AuthRetryableFetchError(msg, 0)`,
// which IS an AuthError. So the outage is precisely the case that never throws.
//
// ── so `error` has to be read, and then classified ────────────────────────
//
// Reading `error` is necessary but not sufficient. "Any error means the console
// is unreadable" would tell a genuinely signed-out person that the console is
// broken, which is its own defect — quieter than the first one, but the same
// substitution in the other direction. The two ARE separable, and this file is
// where the separation is written down and tested.
//
// ── which errors are a verdict about the credential ───────────────────────
//
// From `lib/errors.js` in the same package. Every class sets `this.name` to a
// STRING LITERAL in its constructor, so the discrimination below survives
// minification — a `instanceof` check would not, and neither would a check on
// the constructor's name.
//
//   · `AuthSessionMissingError`  (name set via CustomAuthError, status 400)
//       Either there is no access token in storage at all, or the server
//       answered `session_not_found` — the `session_id` in the JWT has no row
//       in `sessions`. `_getUser` calls `_removeSession()` for this one, i.e.
//       the library itself treats it as signed out. So do we.
//
//   · `AuthApiError` at 400 / 401 / 403
//       GoTrue answered, with a JSON body, and refused the credential:
//       expired, revoked, malformed, or the user row is gone (403
//       `user_not_found`). `handleError` only constructs an AuthApiError once
//       `await error.json()` has SUCCEEDED, so this is the auth service
//       speaking, not an intermediary — a WAF or proxy 403 serves HTML, fails
//       that parse, and becomes an `AuthUnknownError` instead.
//
//   · `AuthInvalidJwtError`      (status 400, code `invalid_jwt`)
//       The token in storage does not parse. Nothing a retry fixes.
//
// ── which errors are not ──────────────────────────────────────────────────
//
//   · `AuthRetryableFetchError` — status 0 for a dead fetch, or the HTTP status
//     for 500/501/502/503/504 and Cloudflare's 520-530, which `handleError`
//     lists by number under the comment "These are infrastructure errors and
//     should not cause session invalidation." The library's own words.
//   · `AuthUnknownError` — a response whose body would not parse as JSON. A
//     gateway error page. Status is left `undefined` by its constructor.
//   · `AuthRefreshDiscardedError` (409) — a concurrent sign-out or another
//     tab's rotation landed mid-refresh and this attempt threw its result
//     away. It is a statement about the race, not about the person.
//   · `AuthApiError` at 429 — rate limited. Being told to come back later is
//     not being told you are not signed in.
//   · anything this file does not recognise, including a plain `Error`.
//
// ── the direction of the default, and why it is that way ──────────────────
//
// The list above is an ALLOWLIST of "signed out", not a denylist of "broken".
// Unrecognised is `unreadable`. That is deliberate and it is the asymmetry:
//
//   · calling an outage "signed out" pushes a working password into a form
//     that will not accept it, hides the console behind a login, and teaches
//     the owner to distrust their own credentials;
//   · calling a real sign-out "unreadable" shows a screen that says the
//     account could not be read, with a Try Again button — one wasted press
//     before the next read returns `AuthSessionMissingError` and the sign-in
//     form appears properly.
//
// A new error class added by a future version of auth-js lands in the second
// bucket rather than the first. That is the side to be wrong on.

/**
 * What an `error` from a `supabase.auth.*` call actually established.
 *
 * `'signed-out'` — the credential was looked at and refused, or there was
 * never one. Asking the person to sign in is the true next step.
 *
 * `'unreadable'` — the question could not be asked. Nothing was established
 * about who they are, and nothing that implies they are not signed in.
 */
export type AuthReadFate = 'signed-out' | 'unreadable';

/**
 * The shape this file reads, written structurally rather than imported.
 *
 * Nothing here depends on `@supabase/auth-js` at compile time: `src/lib` is
 * shared by the phone apps and the web console and is kept free of their
 * dependencies, and a structural type is also what lets the test hand in plain
 * objects rather than constructing library errors it would then be asserting
 * against itself.
 */
export interface AuthErrorLike {
  readonly name?: unknown;
  readonly status?: unknown;
  readonly code?: unknown;
  readonly __isAuthError?: unknown;
}

/**
 * `isAuthError` from the library, restated: the brand, not the prototype.
 *
 * auth-js checks `'__isAuthError' in error` for the same reason this does —
 * an error that crossed a bundle boundary, or came from a second copy of the
 * package in a nested node_modules (there are two copies installed in this
 * repo, 2.112.3 under studio-web and 2.110.2 at the root), fails `instanceof`
 * against the class the caller imported.
 */
function isAuthErrorLike(error: unknown): error is AuthErrorLike {
  return typeof error === 'object' && error !== null && '__isAuthError' in error;
}

/** The HTTP statuses at which GoTrue is refusing a credential rather than failing. */
const CREDENTIAL_REFUSED_STATUSES = new Set([400, 401, 403]);

/**
 * Error names that are a verdict about the credential. See the header for the
 * reasoning behind each, and for why this is an allowlist.
 */
const SIGNED_OUT_NAMES = new Set(['AuthSessionMissingError', 'AuthInvalidJwtError']);

/**
 * Classify the `error` half of a `supabase.auth.*` result.
 *
 * Call this with the error and nothing else — in particular, do NOT decide
 * from `user === null`, which is true in both cases and is the whole reason
 * this file exists.
 *
 * A falsy `error` is not a question this function answers: there was no
 * failure to classify. Callers check `error` first.
 */
export function authReadFate(error: unknown): AuthReadFate {
  if (!isAuthErrorLike(error)) return 'unreadable';

  const name = typeof error.name === 'string' ? error.name : '';
  if (SIGNED_OUT_NAMES.has(name)) return 'signed-out';

  // `AuthApiError` is the only name where the status decides, because it is
  // the only one that means "GoTrue answered in JSON". A 5xx never reaches
  // here as an AuthApiError — `handleError` converts those to
  // AuthRetryableFetchError before construction — but the check is written
  // positively anyway, so a future status that is neither is unreadable.
  if (name === 'AuthApiError') {
    return typeof error.status === 'number' && CREDENTIAL_REFUSED_STATUSES.has(error.status)
      ? 'signed-out'
      : 'unreadable';
  }

  return 'unreadable';
}

/**
 * True when the auth read established nothing — the negation worth naming,
 * because it is the branch that must not collapse into `null`.
 */
export function authReadUnreadable(error: unknown): boolean {
  return authReadFate(error) === 'unreadable';
}
