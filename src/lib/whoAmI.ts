// "Who is signed in?", asked of the server 128 times.
//
// ── The measurement ───────────────────────────────────────────────────────
//
// From this project's own edge logs, over three minutes of ordinary navigation
// in the coach app on a simulator — opening the Program Builder, picking a
// date, opening Invoices:
//
//     /auth/v1/user        218
//     /rest/v1/profiles     52
//     /rest/v1/clients      22
//     /rest/v1/trainers     20
//
// `/auth/v1/user` is not merely the busiest path, it is four times the next
// one, and it carries no data any screen draws. Per minute it ran 87, 49, 82 —
// and **0 whenever the app was left alone**. So it is not a poll and there is
// no timer to find: it is one round trip per screen mount, per provider, per
// helper, and `supabase.auth.getUser()` appears at 128 call sites.
//
// The reason it costs a request at all is the reason it is the right call to
// make: `getUser()` asks the auth server to validate the token, where
// `getSession()` reads whatever is in local storage and believes it. Nobody
// should switch these call sites to `getSession()` to make this number go
// down. What is wrong is not that the app asks — it is that eleven things
// mounting at once ask eleven times inside the same second.
//
// ── What this does ────────────────────────────────────────────────────────
//
// Collapses the burst and nothing else. Callers arriving while a request is
// out await that request; a request that has just landed is reused for a few
// seconds; every caller receives the SAME response object it would have
// received anyway, and branches on it exactly as it does today. No call site
// changes, which is the point — the per-provider handling of a missing session
// genuinely does differ between `tenant`, `settings`, `invites` and
// `clientData`, and it must keep differing.
//
// ── The two things it must never do ───────────────────────────────────────
//
// SHARE AN ANSWER ABOUT SOMEBODY ELSE. `getUser(jwt)` with an explicit token
// asks about the bearer of THAT token, not about the signed-in user —
// supabase/functions/send-push does exactly this to identify whoever called
// it. Serving that from a flight started by the current session would answer
// "who sent this push" with "the person holding this phone". So an explicit
// argument always goes straight to the server and is never held.
//
// HOLD A FAILURE. `getUser` reports an expired or missing session by RETURNING
// an error rather than throwing, so an errored response is an ordinary value
// and would be cached as readily as a good one. It is passed back to the
// caller verbatim and never held, so the next caller asks again — the shape
// `createSharedRead` already enforces, reused here rather than rebuilt.
//
// ── The window, and what it widens ────────────────────────────────────────
//
// A few seconds: long enough to cover the providers that mount together on one
// launch, short enough that it is not a session cache. Signing out, signing in
// and a token refresh all invalidate it through `onAuthStateChange`.
//
// TWO cases widen, not one, and the second was missed when this was written:
//
//   · A session revoked SERVER-side with no client event stays honoured for
//     at most those few seconds longer than it otherwise would.
//
//   · A read that overlaps a sign-out. The real `getUser()` takes GoTrue's
//     internal lock, and `_signOut` holds that lock while it runs — so an
//     unwrapped call arriving between `_removeSession()` and the `SIGNED_OUT`
//     notification BLOCKS, and then answers `AuthSessionMissingError`. A held
//     answer is served from a bare `Promise.resolve` and takes no lock, so for
//     that window it says "signed in" where the library would have said
//     "signed out".
//
// Both are bounded by the freshness window and neither grants access to
// anything: what a signed-out caller may then READ is decided by RLS, which
// this cannot touch. The second is written down because a lane checking this
// file against auth-js found it, and an argument that names only the case its
// author thought of is worth less than one that names the case they missed.
import { createSharedRead, SAME_LAUNCH_MS } from './sharedRead';

/** How long a landed answer is reused. See the note above on what it widens. */
export const WHO_AM_I_MS = SAME_LAUNCH_MS;

/** The single registry key. There is one signed-in user, so there is one. */
const ME = 'me';

export interface SharedGetUser<R> {
  /** Drop-in for `auth.getUser`: same arguments, same response. */
  getUser(jwt?: string): Promise<R>;
  /** Forget the held answer. Wired to every auth state change. */
  forget(): void;
}

/**
 * Wrap a `getUser` so that concurrent callers share one request.
 *
 * `native` is the real one. `isFailure` says which responses must not be held;
 * it is injected rather than hard-coded to `r.error` so this module can be
 * tested without supabase-js, and so a caller can be explicit about what it
 * considers an answer worth reusing.
 *
 * The failing response travels through `createSharedRead` as the *error* of a
 * failed outcome and is handed back untouched. That is not a trick: it is what
 * makes "failures are never held" apply to a function that reports failure by
 * returning normally.
 */
export function shareGetUser<R>(
  native: (jwt?: string) => Promise<R>,
  isFailure: (response: R) => boolean,
  opts?: { freshMs?: number; now?: () => number },
): SharedGetUser<R> {
  const shared = createSharedRead<R>({ freshMs: opts?.freshMs ?? WHO_AM_I_MS, now: opts?.now });

  return {
    async getUser(jwt?: string): Promise<R> {
      // `!== undefined`, deliberately stricter than the library — and NOT for the
      // reason first written here. auth-js's own `getUser` opens with `if (jwt)`,
      // so it treats an empty string as "no token given" and falls through to the
      // session path anyway; passing `''` straight down would change nothing about
      // what comes back. The strictness is there so that ANY explicit argument —
      // including one that arrived empty because a header was missing — is a
      // question about a token rather than about this session, and cannot be
      // answered out of a flight started for somebody else.
      if (jwt !== undefined) return native(jwt);

      const outcome = await shared.read(ME, async () => {
        const response = await native();
        return isFailure(response)
          ? { ok: false as const, error: response }
          : { ok: true as const, value: response };
      });
      // `outcome.error` in the failing branch IS the response, put there by the
      // run above. A genuine throw out of `native` cannot reach here as a
      // response — createSharedRead turns one into a failed outcome too, and
      // that is re-thrown below rather than returned as if it were an answer.
      if (outcome.ok) return outcome.value;
      if (isRawThrow(outcome.error)) throw outcome.error;
      return outcome.error as R;
    },
    forget() { shared.forget(ME); },
  };
}

/**
 * Whether a failed outcome carries a thrown error rather than a returned
 * response.
 *
 * `createSharedRead` funnels both into the same slot, and the two must not be
 * confused: a returned error response is what every call site is written to
 * branch on, while a throw is a network fault the call site expects to catch.
 * Returning a thrown TypeError as if it were a `UserResponse` would give every
 * caller `response.error === undefined` and let it read `data.user` off
 * nothing.
 *
 * A response is an object with an own `data` or `error` key; anything else
 * reaching this slot came out of a `throw`.
 */
function isRawThrow(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return true;
  return !('data' in e) && !('error' in e);
}
