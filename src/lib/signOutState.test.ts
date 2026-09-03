// What sign-out clears, and what it is not allowed to. Compile with tsc, run
// with node.
//
// Three failures are guarded, and all three have a handset in them:
//
//   1. A PERSON'S ANSWERS SURVIVING THEM. The four device-local preferences the
//      app keeps off the server — notification categories, quiet hours, the
//      biometric lock, the reminders — were inherited by the next account to
//      sign in on the phone, while the preferences screen told the member they
//      were "kept on this phone".
//
//   2. THE CLEAR TAKING TOO MUCH. `AsyncStorage.clear()` would also take the
//      cached gym name, which is the ONLY thing the signed-out screens have to
//      go on, and the per-account outbox, which holds writes the member has
//      been promised will go up when they have signal. Both are asserted as
//      absent from the list rather than left to a reviewer to notice.
//
//   3. AN ACCOUNT-SCOPED KEY ON A DEVICE-SCOPED LIST. The test for membership
//      of this list is "one person's answers under a key with no account in
//      it". A key carrying a uid is already private to that account and must
//      not be swept by a sign-out that may not even be that account's.
import {
  ACCOUNT_SCOPED_PREFIXES, KEPT_ON_SIGN_OUT, PERSONAL_DEVICE_KEYS, isPersonalDeviceKey,
} from './signOutState';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── 1 · the four that go ──────────────────────────────────────────────── */

{
  ok(isPersonalDeviceKey('repple.notifyPrefs'), 'the notification categories and quiet hours are cleared');
  ok(isPersonalDeviceKey('repple.appLock.enabled'), 'so is the biometric lock, which was left armed by somebody who had gone');
  ok(isPersonalDeviceKey('repple.reminders'), 'and so are the reminders, which were scheduled on the phone itself');
  eq(PERSONAL_DEVICE_KEYS.length, 3, 'and nothing has joined the list without a line in this file about it');
}

/* ── 2 · what must not go ──────────────────────────────────────────────── */

{
  for (const k of KEPT_ON_SIGN_OUT) {
    ok(!isPersonalDeviceKey(k), `${k} survives a sign-out — it is this device's, not this person's`);
  }
  // Named specifically, because this is the one whose loss would be visible on
  // the very next screen: the sign-in page of a white-label build reading the
  // supplier's name instead of the gym's.
  ok(!PERSONAL_DEVICE_KEYS.includes('repple.appName'),
    'the gym name cached for the signed-out screens is never cleared');
}

/* ── 3 · nothing account-scoped ────────────────────────────────────────── */

{
  for (const k of PERSONAL_DEVICE_KEYS) {
    for (const p of ACCOUNT_SCOPED_PREFIXES) {
      ok(!k.startsWith(p), `${k} is device-scoped — an account-scoped key must not be swept by a sign-out`);
    }
    ok(k.startsWith('repple.'), `${k} is one of this app's own keys`);
    // A uid in the key means the key is already private to that account, which
    // is a different mechanism from this one and must not be mixed with it.
    ok(!/[0-9a-f]{8}-[0-9a-f]{4}/i.test(k), `${k} carries no account id`);
  }
  ok(new Set(PERSONAL_DEVICE_KEYS).size === PERSONAL_DEVICE_KEYS.length, 'no key is listed twice');
  ok(!isPersonalDeviceKey('outbox:v1:abc'), 'an outbox is a person’s unsent work and survives their sign-out');
}

if (errors.length) {
  console.error(`signOutState: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('signOutState: ok');
