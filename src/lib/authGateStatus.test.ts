// The mapping this file exists to hold still: which auth failure is an empty
// set and which one is an unknown one.
//
// These are two assertions and they look trivial. They are not: the whole
// defect this family of files was written for is that an outage and a sign-out
// arrive at a provider as the same absent uid, and the last place that
// distinction can be lost is here, where it is turned back into a single word a
// screen reads. Reversing the two arms of `authGateStatus` compiles, passes
// tsc, passes check:reads (the error IS named by then), and puts "you have
// written nothing about this client" in front of a coach whose phone had no
// signal. Nothing else in this repo fails when that happens — the four callers
// are React hooks that import react-native and cannot be run by `npm test`.
//
// Run: `npx tsc -p tsconfig.test.json && node .tmp/lib/authGateStatus.test.js`
// (this file is not in tsconfig.test.json's `files` list — that file is managed
// centrally and this lane does not edit it; the entry to add is named in the
// lane report.)
import { authGateStatus } from './authGateStatus';

let failures = 0;
function eq(what: string, actual: unknown, expected: unknown) {
  if (actual !== expected) {
    failures++;
    console.error('FAIL ' + what + ' → ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected));
  } else {
    console.log('  ok  ' + what + ' → ' + JSON.stringify(actual));
  }
}

// Nobody is signed in, so this coach's own list is empty and that is a true
// thing to say. A provider that answered 'error' here would put a "something
// went wrong" state on the welcome screen of an app nobody has signed into yet
// — the latch src/ui/authRevision.tsx documents for seventeen providers.
eq("a sign-out is an empty set, and 'ready' is true of it",
  authGateStatus('signed-out'), 'ready');

// THE assertion. Nothing was established about who this is, so nothing may be
// said about what they have saved, written or been adjusted to. If this ever
// reads 'ready', every one of the four callers renders its empty state over an
// outage and states it as a fact about the person holding the phone.
eq("an unreadable auth read is NOT an empty set, and must not be 'ready'",
  authGateStatus('unreadable'), 'error');

// The two fates never agree. Written as its own assertion because the failure
// mode is a function that has collapsed to a constant — `() => 'ready'` passes
// the first check above, and `() => 'error'` passes the second.
eq('the two fates do not map to the same status',
  authGateStatus('signed-out') === authGateStatus('unreadable'), false);

if (failures) { console.error('authGateStatus: ' + failures + ' failure(s)'); process.exit(1); }
console.log('authGateStatus: all assertions passed');
