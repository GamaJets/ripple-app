// Compile with tsc, run with node.
//
// Every fixture below is the shape `@supabase/auth-js` actually constructs,
// copied from `lib/errors.js` in the installed package rather than invented:
// `__isAuthError: true` set by the `AuthError` base constructor, `name` a
// string literal set by each subclass, `status` from the constructor argument
// (`CustomAuthError` re-assigns it; `AuthUnknownError` never sets it at all,
// so it is genuinely `undefined` and not merely omitted here).
//
// What is asserted is the one thing that matters and the one thing the type
// system cannot: that an outage and a sign-out come out of this function as
// two different answers, and that an error nobody has seen before comes out as
// the harmless one.
import { authReadFate, authReadUnreadable } from './authReadFate';

const errors: string[] = [];
const eq = (a: unknown, b: unknown, msg: string) => {
  if (!Object.is(a, b)) errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
};

/** An AuthError as the library builds it: branded, named, optionally statused. */
const authError = (name: string, status?: number, code?: string) => ({
  __isAuthError: true,
  name,
  status,
  code,
  message: name,
});

/* ── the outage: the case the whole apparatus was written for ───────────── */

// `_handleRequest` on a dead fetch — offline, DNS, CORS, captive portal, abort.
eq(authReadFate(authError('AuthRetryableFetchError', 0)), 'unreadable',
  'a fetch that never landed established nothing about who is signed in');

// `handleError`'s NETWORK_ERROR_CODES, the list the library itself annotates
// "should not cause session invalidation".
for (const status of [500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530]) {
  eq(authReadFate(authError('AuthRetryableFetchError', status)), 'unreadable',
    `HTTP ${status} from the auth host is the host failing, not the person being signed out`);
}

// A gateway that answered with something that is not JSON.
eq(authReadFate(authError('AuthUnknownError', undefined)), 'unreadable',
  'an unparseable response body is an infrastructure answer, and its status is undefined');

// The refresh raced a concurrent sign-out in another tab and threw its result away.
eq(authReadFate(authError('AuthRefreshDiscardedError', 409)), 'unreadable',
  'a discarded refresh is a statement about the race, not about the person');

// Rate limiting.
eq(authReadFate(authError('AuthApiError', 429, 'over_request_rate_limit')), 'unreadable',
  'being told to come back later is not being told you are not signed in');

/* ── the real sign-out: the answer that must NOT be called an outage ─────── */

// No access token in storage at all, or the server answered `session_not_found`.
// `_getUser` calls `_removeSession()` for this one — the library treats it as
// signed out, and so must we.
eq(authReadFate(authError('AuthSessionMissingError', 400)), 'signed-out',
  'no session is no session — send them to the sign-in form, do not claim the console is broken');

// GoTrue looked at the JWT and refused it.
eq(authReadFate(authError('AuthApiError', 401, 'bad_jwt')), 'signed-out',
  'a 401 with a JSON body is GoTrue refusing the credential');
eq(authReadFate(authError('AuthApiError', 403, 'user_not_found')), 'signed-out',
  'the user row is gone — a retry will never succeed');
eq(authReadFate(authError('AuthApiError', 400, 'invalid_credentials')), 'signed-out',
  'a 400 from the auth API is a verdict, not a failure to reach one');

// The token in storage does not parse.
eq(authReadFate(authError('AuthInvalidJwtError', 400, 'invalid_jwt')), 'signed-out',
  'a malformed stored token is not something a Try Again button fixes');

/* ── the asymmetry, stated as tests ─────────────────────────────────────── */

// The bucket an unrecognised error falls into is the point of the file.
eq(authReadFate(authError('AuthSomethingNobodyHasWrittenYet', 418)), 'unreadable',
  'a class added by a future auth-js version errs towards "we could not tell"');
eq(authReadFate(new Error('boom')), 'unreadable',
  'an error with no auth-js brand is not a statement about a session');
eq(authReadFate('offline'), 'unreadable', 'a thrown string establishes nothing');
eq(authReadFate(null), 'unreadable', 'and neither does null');
eq(authReadFate(undefined), 'unreadable', 'nor undefined');

// `name` is compared as a string literal on purpose: the classes are minified
// in a production Next.js build but `this.name = 'AuthApiError'` is not.
eq(authReadFate({ __isAuthError: true, status: 401 }), 'unreadable',
  'the brand alone is not enough — an unnamed auth error is still an unknown one');
eq(authReadFate({ name: 'AuthSessionMissingError', status: 400 }), 'unreadable',
  'and the name alone is not enough either: something else entirely may call itself that');

// A status that is a numeric string, as a hand-rolled fake might carry.
eq(authReadFate({ __isAuthError: true, name: 'AuthApiError', status: '401' }), 'unreadable',
  'a non-numeric status is not a status we can read a verdict out of');

/* ── the negation helper agrees with the classifier ─────────────────────── */

eq(authReadUnreadable(authError('AuthRetryableFetchError', 0)), true, 'the outage is unreadable');
eq(authReadUnreadable(authError('AuthSessionMissingError', 400)), false, 'the sign-out is not');

if (errors.length) {
  console.error(`authReadFate: ${errors.length} failure(s)`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('authReadFate: all assertions passed');
