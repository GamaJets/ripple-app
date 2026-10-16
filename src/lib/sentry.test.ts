// Sentry stays OFF without a DSN. Compile with tsc, run with node.
//
// The promise in src/lib/sentry.ts is that a build with no
// EXPO_PUBLIC_SENTRY_DSN behaves exactly as it did before the dependency: the
// SDK is never even required, nothing is captured, the root is not wrapped.
// Under node there is no react-native, so if this file got as far as requiring
// the SDK the require itself would throw — which is the assertion that matters.
import { SENTRY_DSN, initSentry, sentryEnabled, captureToSentry, setSentryUser, withSentry, isTransientAuthFetch } from './sentry';

let failed = 0;
const ok = (cond: unknown, msg: string) => { if (!cond) { failed++; console.error('FAIL:', msg); } };

ok(SENTRY_DSN === '', 'no DSN is configured in the test environment');
initSentry();
ok(!sentryEnabled(), 'without a DSN, init leaves Sentry off');
let threw = false;
try {
  captureToSentry(new Error('x'), 'ctx', { a: 1 });
  captureToSentry('a string', 'ctx');
  setSentryUser('u1');
  setSentryUser(null);
} catch { threw = true; }
ok(!threw, 'capture and setUser are silent no-ops while off');
const Root = () => null;
ok(withSentry(Root) === Root, 'the root component is returned unwrapped while off');

if (failed) { console.error(`sentry: ${failed} failed`); process.exit(1); }
console.log('sentry: ok');

// isTransientAuthFetch: REPPLE-5 dropped, real auth failures kept.
{

  const ev = (type: string, value: string) => ({ exception: { values: [{ type, value }] } });
  const eq = (a: boolean, b: boolean, m: string) => { if (a !== b) throw new Error(m); };
  eq(isTransientAuthFetch(ev('AuthRetryableFetchError', 'fetch failed: UnexpectedException: cancelled')), true, 'cancelled refresh dropped');
  eq(isTransientAuthFetch(ev('AuthRetryableFetchError', 'Network request failed')), true, 'offline dropped');
  eq(isTransientAuthFetch(ev('AuthRetryableFetchError', '{"message":"upstream 502"}')), false, '5xx kept');
  eq(isTransientAuthFetch(ev('AuthApiError', 'Invalid Refresh Token: Refresh Token Not Found')), false, 'real auth failure kept');
  eq(isTransientAuthFetch(ev('TypeError', 'Network request failed')), false, 'other errors kept');
  eq(isTransientAuthFetch({}), false, 'no exception kept');
  console.log('sentry: isTransientAuthFetch ok');
}

{
  const { describeThrown } = require('./sentry') as typeof import('./sentry');
  const d = describeThrown({ message: 'permission denied for function my_wearable_providers', code: '42501', details: null, hint: null });
  if (d !== 'permission denied for function my_wearable_providers code=42501') throw new Error('describeThrown: ' + d);
  if (describeThrown('x') !== 'x') throw new Error('describeThrown string');
  console.log('sentry: describeThrown ok');
}
