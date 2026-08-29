// The one automatic Apple Health sleep prompt (TF-01, gap 2). Compile with tsc
// then run with node.
//
// This decides whether a permission sheet appears in front of somebody without
// them asking for it, so the assertions worth having are the ones that keep it
// SHUT. Every false case below is a way the old manual-only button would have
// been replaced by something worse: a sheet on every launch, a sheet after the
// person already said no, a sheet because the phone had no signal, a sheet for
// somebody whose watch is already reporting sleep perfectly well.
//
// The single true case is narrow on purpose: HealthKit is present, we can
// remember having asked, we have never asked, the read genuinely succeeded, and
// it came back empty. That combination is only reachable by someone who
// connected Apple Health before SleepAnalysis was in the permission set.
import { shouldAutoAskForSleep, SLEEP_ASKED_KEY, type AutoAskInput } from './wearables/sleepAccess';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

/** The one state that earns a prompt: connected before sleep shipped. */
const neverAsked: AutoAskInput = {
  present: true,
  canRemember: true,
  alreadyAsked: false,
  readOk: true,
  readingCount: 0,
};

ok(shouldAutoAskForSleep(neverAsked) === true,
  'a client who was never asked, and whose successful read is empty, is asked once');

ok(shouldAutoAskForSleep({ ...neverAsked, alreadyAsked: true }) === false,
  'having asked once is the end of it — this is what stops it firing on every visit');

ok(shouldAutoAskForSleep({ ...neverAsked, readingCount: 1 }) === false,
  'a client whose watch already reports sleep never sees a permission sheet');
ok(shouldAutoAskForSleep({ ...neverAsked, readingCount: 7 }) === false,
  'a full week of readings is emphatically not a permissions problem');

ok(shouldAutoAskForSleep({ ...neverAsked, readOk: false }) === false,
  'an empty list from a FAILED read says nothing about permissions and must not prompt');

ok(shouldAutoAskForSleep({ ...neverAsked, canRemember: false }) === false,
  'without storage the ask could not be recorded, so it would repeat forever — do not start');

ok(shouldAutoAskForSleep({ ...neverAsked, present: false }) === false,
  'no HealthKit in this build means there is no sheet to raise');

// Combinations, because the failure that matters is one clause being dropped
// and the others hiding it.
ok(shouldAutoAskForSleep({ ...neverAsked, alreadyAsked: true, readingCount: 0, readOk: true }) === false,
  'an empty read after we have already asked is a real empty read, or a refusal — both are left alone');
ok(shouldAutoAskForSleep({ present: true, canRemember: false, alreadyAsked: false, readOk: false, readingCount: 0 }) === false,
  'nothing about a failed read on a device that cannot remember justifies a prompt');

// The key is versioned so that a future permission the same users were never
// asked for can be introduced without every device claiming it already asked.
ok(/\.v\d+$/.test(SLEEP_ASKED_KEY), `the stored key carries a version, got ${SLEEP_ASKED_KEY}`);

if (errors.length) {
  console.error(`sleepAccess.test — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(1);
}
console.log('sleepAccess.test — all assertions passed');
