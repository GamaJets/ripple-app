// What `uidFromSession` has to get right.
//
// The defect it closes is the one src/lib/authReadFate.ts documents, on the
// call two thirds of this tree actually makes: `getSession()` resolves with
// `{ data: { session: null }, error }` when the stored access token has expired
// and the refresh could not reach the server, and `sess?.session?.user?.id` is
// `undefined` there — the same `undefined` somebody who never signed in gets.
// So the cases that matter are the ones where a session is absent for a reason
// that is NOT a sign-out, and the one where a session is present but its user
// is not.
//
// Run: `npx tsc -p tsconfig.test.json && node .tmp/lib/sessionUidRead.test.js`
// (this file is not in tsconfig.test.json's `files` list yet — that file is
// managed centrally and this lane does not edit it; the entries to add are
// named in the lane report).
import { uidFromSession, type AuthSessionResult } from './sessionUidRead';

let failures = 0;
function ok(what: string, cond: boolean) {
  if (!cond) { failures++; console.error('FAIL ' + what); } else { console.log('  ok  ' + what); }
}
function eq(what: string, actual: unknown, expected: unknown) {
  ok(what + ' → ' + JSON.stringify(actual), actual === expected);
}

/** An auth-js error as it arrives: branded, named by string literal, with a
 *  status. A plain object on purpose — the classifier reads the brand and the
 *  name, never the prototype, because two copies of the package are installed
 *  and `instanceof` does not cross that. */
const authErr = (name: string, status?: number) => ({ __isAuthError: true, name, status, message: name });

/** `{ data: { session: null }, error: null }` — what auth-js returns verbatim
 *  for a device with nothing in storage. */
const NO_SESSION: AuthSessionResult = { data: { session: null }, error: null };

// ── signed in ────────────────────────────────────────────────────────────
eq('a session with a user id is a uid',
  uidFromSession({ data: { session: { user: { id: 'u-1' } } } }).uid, 'u-1');
eq('a uid carries no fate to classify',
  uidFromSession({ data: { session: { user: { id: 'u-1' } } } }).fate, null);

// ── genuinely signed out ─────────────────────────────────────────────────
eq('no session and no error is a sign-out',
  uidFromSession(NO_SESSION).fate, 'signed-out');
eq('an absent session key is a sign-out',
  uidFromSession({ data: {} }).fate, 'signed-out');
eq('a session missing error is a sign-out',
  uidFromSession({ ...NO_SESSION, error: authErr('AuthSessionMissingError', 400) }).fate, 'signed-out');
eq('a refused credential is a sign-out',
  uidFromSession({ ...NO_SESSION, error: authErr('AuthApiError', 401) }).fate, 'signed-out');
eq('an unparseable stored token is a sign-out',
  uidFromSession({ ...NO_SESSION, error: authErr('AuthInvalidJwtError', 400) }).fate, 'signed-out');

// ── the outage, which is the whole reason for the file ───────────────────
//
// THE case. A dead fetch during the refresh of an expired access token: this is
// what a member in a basement gym, or anybody through a captive portal, gets.
// Before this module the line above it read `sess?.session?.user?.id`, saw
// `undefined`, and every caller drew an empty screen under 'ready'.
eq('a dropped connection is unreadable, not a sign-out',
  uidFromSession({ ...NO_SESSION, error: authErr('AuthRetryableFetchError', 0) }).fate, 'unreadable');
for (const status of [500, 502, 503, 504]) {
  eq(`a ${status} from the auth server is unreadable`,
    uidFromSession({ ...NO_SESSION, error: authErr('AuthRetryableFetchError', status) }).fate, 'unreadable');
}
eq('a gateway error page is unreadable',
  uidFromSession({ ...NO_SESSION, error: authErr('AuthUnknownError') }).fate, 'unreadable');
eq('being rate limited is not being signed out',
  uidFromSession({ ...NO_SESSION, error: authErr('AuthApiError', 429) }).fate, 'unreadable');
eq('a discarded refresh is a statement about the race, not the person',
  uidFromSession({ ...NO_SESSION, error: authErr('AuthRefreshDiscardedError', 409) }).fate, 'unreadable');
eq('an error class this tree has never seen lands in the harmless bucket',
  uidFromSession({ ...NO_SESSION, error: authErr('AuthSomethingNewError', 400) }).fate, 'unreadable');
eq('a plain Error is unreadable',
  uidFromSession({ ...NO_SESSION, error: new Error('boom') }).fate, 'unreadable');
eq('an outage never yields a uid',
  uidFromSession({ ...NO_SESSION, error: authErr('AuthRetryableFetchError', 0) }).uid, null);

// The error outranks a session that came back beside it. auth-js does not
// produce this shape today; the assertion pins the direction of the doubt for
// the day it does.
eq('an error beside a session still refuses the uid',
  uidFromSession({ data: { session: { user: { id: 'u-1' } } }, error: authErr('AuthRetryableFetchError', 0) }).uid, null);

// ── a session that is there, with no user readable on it ─────────────────
//
// The one judgement this module makes that `uidFromAuth` alone cannot. Handed
// `{ user: undefined }` that function answers 'signed-out', correctly, because
// for `getUser()` an absent user IS the sign-out. Here a session object exists,
// so somebody IS signed in — auth-js substitutes `userNotAvailableProxy()` into
// exactly this shape when a `userStorage` is configured and the user half is
// missing — and calling that person signed out is the substitution this family
// of files exists to stop.
eq('a session with no user at all is unreadable, not a sign-out',
  uidFromSession({ data: { session: {} } }).fate, 'unreadable');
eq('a session whose user is null is unreadable',
  uidFromSession({ data: { session: { user: null } } }).fate, 'unreadable');
eq('a session whose user has no id is unreadable',
  uidFromSession({ data: { session: { user: {} } } }).fate, 'unreadable');
eq('a blank id on a live session is unreadable',
  uidFromSession({ data: { session: { user: { id: '   ' } } } }).fate, 'unreadable');
eq('an id of the wrong type is unreadable',
  uidFromSession({ data: { session: { user: { id: 12345 } } } } as never).fate, 'unreadable');

// ── nothing answered at all ──────────────────────────────────────────────
eq('undefined is unreadable', uidFromSession(undefined).fate, 'unreadable');
eq('null is unreadable', uidFromSession(null).fate, 'unreadable');
eq('a non-object is unreadable', uidFromSession('nope' as never).fate, 'unreadable');

// ── the narrowing trap, asserted rather than described ───────────────────
//
// `UidRead` is discriminated by `fate`, never by `uid`: the signed-in member's
// `uid` is `string`, which includes '', so `if (!read.uid)` does not narrow
// `fate` and every call site that tried it failed to compile. The guard below
// is the one that works, and this asserts the property it relies on — that a
// non-null fate always comes with a null uid, and never the other way.
for (const shape of [
  NO_SESSION,
  { ...NO_SESSION, error: authErr('AuthRetryableFetchError', 0) },
  { data: { session: { user: {} } } },
  { data: { session: { user: { id: 'u-1' } } } },
] as AuthSessionResult[]) {
  const read = uidFromSession(shape);
  ok('exactly one of uid and fate is set: ' + JSON.stringify(shape),
    (read.fate === null) !== (read.uid === null));
}

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
