// What `uidFromAuth` has to get right, and the two ways it was got wrong before
// it existed.
//
// The defect it closes is not visible in any assertion about a happy path: it
// is that `{ data: { user: null }, error: <outage> }` and `{ data: { user:
// null }, error: <no session> }` are the SAME value at `auth?.user?.id`, and
// the fourteen call sites in connect.ts and subscriptions.ts read only that.
// So the cases below are mostly about `error`, and the ones that matter most
// are the ones where a user is absent for a reason that is not a sign-out.
//
// Run: `npx tsc -p tsconfig.test.json && node .tmp/lib/authedUid.test.js`
// (this file is not in tsconfig.test.json's `files` list yet — that file is
// managed centrally and Lane 140 does not edit it; the entry to add is named in
// the lane report).
import { uidFromAuth, authGateMessage, authGateFault, type AuthUserResult } from './authedUid';

let failures = 0;
function ok(what: string, cond: boolean) {
  if (!cond) { failures++; console.error('FAIL ' + what); } else { console.log('  ok  ' + what); }
}
function eq(what: string, actual: unknown, expected: unknown) {
  ok(what + ' → ' + JSON.stringify(actual), actual === expected);
}

/** An auth-js error as it arrives: branded, named by string literal, with a
 *  status. Built as a plain object on purpose — the classifier reads the brand
 *  and the name, never the prototype, because two copies of the package are
 *  installed and `instanceof` does not cross that. */
const authErr = (name: string, status?: number) => ({ __isAuthError: true, name, status, message: name });

const NO_USER = { data: { user: null } };

// ── signed in ────────────────────────────────────────────────────────────
eq('a user id with no error is a uid',
  uidFromAuth({ data: { user: { id: 'u-1' } } }).uid, 'u-1');
eq('a uid carries no fate to classify',
  uidFromAuth({ data: { user: { id: 'u-1' } } }).fate, null);

// ── genuinely signed out ─────────────────────────────────────────────────
eq('no user and no error is a sign-out (getSession with nothing stored)',
  uidFromAuth(NO_USER).fate, 'signed-out');
eq('AuthSessionMissingError is a sign-out',
  uidFromAuth({ ...NO_USER, error: authErr('AuthSessionMissingError', 400) }).fate, 'signed-out');
eq('AuthApiError at 401 is a sign-out',
  uidFromAuth({ ...NO_USER, error: authErr('AuthApiError', 401) }).fate, 'signed-out');
eq('AuthInvalidJwtError is a sign-out',
  uidFromAuth({ ...NO_USER, error: authErr('AuthInvalidJwtError', 400) }).fate, 'signed-out');

// ── the outage: the whole reason this module exists ──────────────────────
//
// `AuthRetryableFetchError` is what auth-js's lib/fetch.js constructs for a
// dead fetch (status 0) and for every 5xx, under its own comment that these
// "should not cause session invalidation". It is an AuthError, so `_getUser`
// RESOLVES with it rather than throwing, and the fourteen call sites saw a null
// user. If this ever reads 'signed-out', a coach mid-onboarding is told their
// payout account does not exist.
eq('a dead fetch (AuthRetryableFetchError, status 0) is UNREADABLE',
  uidFromAuth({ ...NO_USER, error: authErr('AuthRetryableFetchError', 0) }).fate, 'unreadable');
eq('a 503 (AuthRetryableFetchError) is UNREADABLE',
  uidFromAuth({ ...NO_USER, error: authErr('AuthRetryableFetchError', 503) }).fate, 'unreadable');
eq('a gateway page (AuthUnknownError, no status) is UNREADABLE',
  uidFromAuth({ ...NO_USER, error: authErr('AuthUnknownError') }).fate, 'unreadable');
eq('rate limiting (AuthApiError 429) is UNREADABLE, not a sign-out',
  uidFromAuth({ ...NO_USER, error: authErr('AuthApiError', 429) }).fate, 'unreadable');
eq('a concurrent refresh (AuthRefreshDiscardedError 409) is UNREADABLE',
  uidFromAuth({ ...NO_USER, error: authErr('AuthRefreshDiscardedError', 409) }).fate, 'unreadable');
eq('an error class nobody has seen yet is UNREADABLE, not a sign-out',
  uidFromAuth({ ...NO_USER, error: authErr('AuthSomethingNewError', 400) }).fate, 'unreadable');
eq('a plain Error is UNREADABLE',
  uidFromAuth({ ...NO_USER, error: new Error('boom') }).fate, 'unreadable');
eq('no uid comes back from any failure',
  uidFromAuth({ ...NO_USER, error: authErr('AuthRetryableFetchError', 0) }).uid, null);

// ── shapes that are not an answer ────────────────────────────────────────
eq('nothing at all is unreadable', uidFromAuth(undefined).fate, 'unreadable');
eq('null is unreadable', uidFromAuth(null).fate, 'unreadable');
eq('an empty result is a sign-out, not a uid', uidFromAuth({}).uid, null);
eq('a blank id is not a uid', uidFromAuth({ data: { user: { id: '   ' } } }).uid, null);
eq('an id of the wrong type is unreadable, not a sign-out',
  uidFromAuth({ data: { user: { id: 12345 } } } as never).fate, 'unreadable');

// The error decides even when an id came back beside it — a shape auth-js does
// not produce, and the cautious reading on a money path.
eq('an error beside an id is still classified by the error',
  uidFromAuth({ data: { user: { id: 'u-1' } }, error: authErr('AuthRetryableFetchError', 0) }).uid, null);

// ── the fact the call sites' guard rests on ──────────────────────────────
//
// Three sites — src/lib/signedInUid.ts, connect.createPackage and
// subscriptions.myCoachId — guard on `fate !== null` rather than on `!uid`,
// because `uid`'s non-null member is `string`, which includes '', so `!uid`
// leaves `fate` as `AuthReadFate | null` and the compiler will not pass it to
// `authGateMessage`. Swapping the guard is only behaviour-preserving if the two
// tests agree on EVERY value this function can produce — that is, if a blank
// uid is unreachable. That is asserted here rather than argued, because it is
// the load-bearing half of the swap and it lives in this file, not at the sites.
const EVERY_SHAPE: Array<AuthUserResult | null | undefined> = [
  undefined, null, {}, NO_USER,
  { data: null }, { data: { user: null } }, { data: { user: {} } },
  { data: { user: { id: 'u-1' } } },
  { data: { user: { id: '' } } },
  { data: { user: { id: '   ' } } },
  { data: { user: { id: '\t\n' } } },
  { data: { user: { id: 0 } } },
  { data: { user: { id: 12345 } } },
  { data: { user: { id: false } } },
  { data: { user: { id: 'u-1' } }, error: authErr('AuthRetryableFetchError', 0) },
  { ...NO_USER, error: authErr('AuthSessionMissingError', 400) },
  { ...NO_USER, error: authErr('AuthApiError', 429) },
  { ...NO_USER, error: new Error('boom') },
];
let disagreements = 0;
let blankUids = 0;
for (const shape of EVERY_SHAPE) {
  const read = uidFromAuth(shape);
  // `!uid` and `fate !== null` must be the same question.
  if ((read.fate !== null) !== !read.uid) disagreements++;
  if (read.fate === null && !read.uid) blankUids++;
}
eq(`all ${EVERY_SHAPE.length} shapes: \`!uid\` and \`fate !== null\` agree`, disagreements, 0);
eq('no shape yields a falsy uid with a null fate (a blank uid is unreachable)', blankUids, 0);
eq('a blank-string id is unreadable, not a person and not a sign-out',
  uidFromAuth({ data: { user: { id: '' } } }).fate, 'unreadable');

// ── what the person is told, and what is recorded ────────────────────────
ok('the sign-out sentence asks them to sign in',
  /sign in again/i.test(authGateMessage('signed-out')));
ok('the unreadable sentence does NOT tell them they are signed out',
  !/you are signed out/i.test(authGateMessage('unreadable')));
ok('the unreadable sentence says nothing was changed',
  /nothing has been changed/i.test(authGateMessage('unreadable')));
ok('the two sentences are different',
  authGateMessage('signed-out') !== authGateMessage('unreadable'));
ok('an outage is reportable', authGateFault('unreadable') instanceof Error);
eq('a sign-out is not a fault and is not reported', authGateFault('signed-out'), null);

console.log(failures ? `\n${failures} failure(s)` : '\nauthedUid: all assertions passed');
process.exit(failures ? 1 : 0);
