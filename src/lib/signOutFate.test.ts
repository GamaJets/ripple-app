// Pressing Sign out, and what may be claimed afterwards.
//
// The console's rail used to reload the page whatever `signOut()` came back
// with, so a refused sign-out was indistinguishable from a successful one. The
// repair is not "reload only on success" — `@supabase/auth-js` brands an
// outage, a DNS failure and every 5xx as an AuthError alongside a genuine
// refusal, and those leave the machine in opposite states. So there are three
// outcomes and only two of them may be acted on.
//
// These assertions are about the BRANCH, and about the sentence: the console
// has no test runner of its own, so the decision lives in src/lib where it can
// be asserted without a browser and studio-web/components/Shell.tsx imports it.
import { signOutOutcome, SIGN_OUT_UNCONFIRMED } from './signOutFate';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** An auth-js error as it actually arrives: the brand, and `name` as a string
 *  literal. Same construction as src/lib/authReadFate.test.ts, and for the same
 *  reason — `instanceof` does not survive two installed copies of the package. */
const authError = (name: string, status?: number, code?: string) =>
  ({ __isAuthError: true, name, status, code });

/* ── the session is genuinely gone ─────────────────────────────────────────── */

eq(signOutOutcome(null), 'ended', 'no error is a sign-out that happened');
eq(signOutOutcome(undefined), 'ended', 'and so is no error at all');

// `_signOut` only reaches its `{ error: null }` return after
// `removeCurrentSession()`, so this is not an assumption about the network.
eq(signOutOutcome(authError('AuthSessionMissingError', 400)), 'ended',
  'there was no session to end, so there is nothing left to be signed into — reloading to the sign-in form is the truth, not a guess');
eq(signOutOutcome(authError('AuthApiError', 401, 'bad_jwt')), 'ended',
  'the credential was looked at and refused: the same conclusion');
eq(signOutOutcome(authError('AuthInvalidJwtError', 400, 'invalid_jwt')), 'ended',
  'a token that does not parse is not a session either');

/* ── nothing was established, which is NOT the same as signed out ──────────── */

eq(signOutOutcome(authError('AuthRetryableFetchError', 0)), 'unconfirmed',
  'a dead fetch — offline, DNS, a captive portal — says nothing about whether this browser is still signed in, and it is the single most likely failure at a front desk');
for (const status of [500, 502, 503, 504, 520, 530]) {
  eq(signOutOutcome(authError('AuthRetryableFetchError', status)), 'unconfirmed',
    `a ${status} from the auth host is an infrastructure failure, which auth-js says in its own words, and never a verdict about the person`);
}
eq(signOutOutcome(authError('AuthUnknownError', undefined)), 'unconfirmed',
  'a gateway error page whose body would not parse as JSON establishes nothing');
eq(signOutOutcome(authError('AuthApiError', 429, 'over_request_rate_limit')), 'unconfirmed',
  'being told to come back later is not being told the session ended');
eq(signOutOutcome(authError('AuthRefreshDiscardedError', 409)), 'unconfirmed',
  'another tab won a refresh race: a statement about the race, not about the desk');
eq(signOutOutcome(new Error('boom')), 'unconfirmed',
  'a plain Error — which is also what the console gets when signOut() THROWS rather than resolving');
eq(signOutOutcome('offline'), 'unconfirmed', 'and a thrown string establishes nothing');
eq(signOutOutcome(authError('AuthSomethingNobodyHasWrittenYet', 418)), 'unconfirmed',
  'an error class a future version of auth-js invents lands on the careful side, which is the whole direction of the default');

// The one that looks like a detail and is the defect. Reading the fate off a
// user or session read afterwards cannot work, because BOTH cases are null.
eq(signOutOutcome({ __isAuthError: true, status: 401 }), 'unconfirmed',
  'an error with no name is not an AuthApiError at 401 — the discrimination is on the name, and an unnamed one may not borrow a verdict from its status');

/* ── the sentence itself ───────────────────────────────────────────────────── */

ok(/not confirmed/i.test(SIGN_OUT_UNCONFIRMED),
  'it says the sign-out was not confirmed, which is the only fact available');
ok(/may still be signed in/i.test(SIGN_OUT_UNCONFIRMED),
  'and names the consequence that matters on a shared machine');
ok(!/\byou (are|have been) signed out\b/i.test(SIGN_OUT_UNCONFIRMED),
  'it must NEVER claim the session ended — that is the unestablished half that sends somebody away from a live console');
ok(!/\bstill signed in\b/i.test(SIGN_OUT_UNCONFIRMED.replace(/may still be signed in/i, '')),
  'and it must not claim the opposite either: "still signed in" as a flat statement is equally unestablished');
ok(!/wi-?fi|connection|internet/i.test(SIGN_OUT_UNCONFIRMED),
  'and it does not send somebody off to fix their network — a 502 from the auth host reaches here too');

if (errors.length) {
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error(`signOutFate: ${errors.length} failure(s)`);
  process.exit(1);
}
console.log('signOutFate: all assertions passed');
