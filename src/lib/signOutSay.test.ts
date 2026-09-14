// The sentence a phone shows when the sign-out could not be confirmed.
//
// Its console sibling is asserted in ./signOutFate.test.ts and the rules are
// the same rules — this is the same question asked on a handset, so the same
// four things must hold of the wording. The discrimination itself is NOT
// re-tested here: there is one `signOutOutcome` and one set of assertions on
// it, and a second copy of that branch is the thing this file exists to avoid.
import { SIGN_OUT_UNCONFIRMED_HANDSET, SIGN_OUT_UNCONFIRMED_TITLE } from './signOutSay';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

const said = `${SIGN_OUT_UNCONFIRMED_TITLE}. ${SIGN_OUT_UNCONFIRMED_HANDSET}`;

ok(/not confirmed/i.test(said),
  'it says the sign-out was not confirmed, which is the only fact available');
ok(/may still be signed in/i.test(SIGN_OUT_UNCONFIRMED_HANDSET),
  'and it states the consequence as a possibility, not as a finding');

ok(!/\byou (are|have been) signed out\b/i.test(said),
  'it must NEVER claim the session ended — that is the unestablished half, and the one that sends somebody away from a live account');
ok(!/\bstill signed in\b/i.test(SIGN_OUT_UNCONFIRMED_HANDSET.replace(/may still be signed in/i, '')),
  'and it must not claim the opposite either: "still signed in" flat is equally unestablished');
ok(!/wi-?fi|connection|internet/i.test(said),
  'and it does not send somebody off to fix their network — a 502 from the auth host reaches here too');

ok(/phone/i.test(SIGN_OUT_UNCONFIRMED_HANDSET) && !/browser/i.test(SIGN_OUT_UNCONFIRMED_HANDSET),
  'it is about the handset in the reader’s hand: the console sentence names a browser and is not this one');
ok(/open the app again/i.test(SIGN_OUT_UNCONFIRMED_HANDSET),
  'it gives the action that follows from not knowing — the stored session is restored at the next launch, so looking again is the check');
ok(/do not hand this phone/i.test(SIGN_OUT_UNCONFIRMED_HANDSET),
  'and the consequence that matters where the lock screen matters: a phone somebody picked up by mistake must not be passed on');

/* ── and that the screens actually ask ─────────────────────────────────────
 *
 * The sentence above is worth nothing if a Sign Out button navigates without
 * reading the fate, which is what all nine of them did. That is a fact about
 * the source rather than about any value this file can call, so it is read —
 * the same reason src/lib/signOutState.test.ts reads src/ui/auth.tsx to hold
 * the sweep ordering, and the same locally-declared `require`, because two
 * TypeScript configurations compile this file and only one has node types. */

declare const require: (id: string) => any;
const { readFileSync: readSrc, existsSync: srcExists } = require('node:fs') as {
  readFileSync: (p: string, enc: string) => string;
  existsSync: (p: string) => boolean;
};

const AUTH_FILE = 'src/ui/auth.tsx';
const LOCK_FILE = 'src/ui/LockScreen.tsx';
const WAIVER_FILE = 'src/ui/waiver.tsx';

if (!srcExists(AUTH_FILE) || !srcExists(LOCK_FILE) || !srcExists(WAIVER_FILE)) {
  // Loud rather than a section that silently asserts nothing and prints "ok".
  console.error('signOutSay.test.ts — src/ui not found; run from the repository root.');
  process.exit(1);
}

{
  const auth = readSrc(AUTH_FILE, 'utf8');

  ok(/signOut: \(\) => Promise<SignOutOutcome>;/.test(auth),
    `${AUTH_FILE} publishes what the sign-out established; a Promise<void> here is the swallow returning`);
  ok(/return signOutOutcome\(e\);/.test(auth),
    `${AUTH_FILE} classifies the caught error rather than deciding the fate itself`);
  ok(!/catch \(e\) \{ reportError\('auth\.signOut', e\); \}\s*\n\s*\};/.test(auth),
    `${AUTH_FILE} no longer ends with the error going into reportError and nothing coming back`);

  // The one thing the hook may never do: decide the fate is 'ended' on its own.
  const hook = auth.slice(auth.indexOf('export function useSignOutAndSay'));
  ok(hook.length > 0, `${AUTH_FILE} exports the one join between the fate and a screen`);
  ok(/fate !== 'ended'/.test(hook),
    'and it says the sentence on every outcome that is not an established end');
}

for (const file of [LOCK_FILE, WAIVER_FILE]) {
  const src = readSrc(file, 'utf8');
  ok(/useSignOutAndSay\(/.test(src),
    `${file} signs out through the one helper that reads the fate`);
  ok(!/\bauth\.signOut\(\)/.test(src),
    `${file} never calls signOut bare — a bare call is a screen claiming an outcome it did not read`);
}

if (errors.length) {
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error(`signOutSay: ${errors.length} failure(s)`);
  process.exit(1);
}
console.log('signOutSay: all assertions passed');
