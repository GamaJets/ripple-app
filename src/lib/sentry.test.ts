// Sentry stays OFF without a DSN. Compile with tsc, run with node.
//
// The promise in src/lib/sentry.ts is that a build with no
// EXPO_PUBLIC_SENTRY_DSN behaves exactly as it did before the dependency: the
// SDK is never even required, nothing is captured, the root is not wrapped.
// Under node there is no react-native, so if this file got as far as requiring
// the SDK the require itself would throw — which is the assertion that matters.
import { SENTRY_DSN, initSentry, sentryEnabled, captureToSentry, setSentryUser, withSentry } from './sentry';

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
