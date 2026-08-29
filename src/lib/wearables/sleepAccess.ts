// Asking existing Apple Health users for sleep, once (TF-01, gap 2).
//
// THE BUG. Repple's HealthKit permission set gained `SleepAnalysis` the day
// sleep merging shipped. `initHealthKit` only ever prompts for types iOS has
// not yet decided on, and everyone who connected Health before that day was
// asked for heart rate, energy, steps and workouts — so for all of them
// SleepAnalysis is still undecided and has never been requested. Their sleep
// read returns an empty array. Forever.
//
// WHY THAT IS INVISIBLE. HealthKit deliberately never reveals a READ denial:
// a type the user refused returns exactly the same empty array as a type they
// allowed and simply have no data for. So nothing in the response can tell the
// two apart, and a screen looking only at the response would have to either
// nag every client on every visit or leave the affected ones permanently
// blank. There was a manual "Allow sleep in Apple Health" button, which helps
// precisely the people who happen to scroll far enough to find it.
//
// WHAT MAKES IT DECIDABLE. The missing fact is not in HealthKit, it is in us:
// whether REPPLE has ever included SleepAnalysis in an `initHealthKit` call on
// this device. We know that for certain, because we make the call. So it is
// written down the first time it happens, and an empty sleep read with no such
// record is the one case — the never-asked case — that earns an automatic
// prompt. An empty read WITH the record is a genuinely empty read, or a
// refusal, and both of those are the person's business, not ours to re-open.
//
// NO NATIVE IMPORT AT THE TOP. AsyncStorage is reached through a guarded lazy
// require, the same way `appleHealthWrite.ts` does it, so that the pure
// decision below can be compiled and run under plain node by
// `src/lib/sleepAccess.test.ts` without dragging in the React Native runtime.
// The literal module name matters: Metro resolves requires statically and
// `require(someVariable)` fails the production bundle outright.

/**
 * Where the "we have asked for sleep" fact lives.
 *
 * Versioned in the name (`v1`) so that if the permission set ever changes again
 * — a new read type that existing users were likewise never asked for — the
 * next key can be introduced without every device believing it has already
 * been asked about it.
 */
export const SLEEP_ASKED_KEY = 'repple.hk.sleepAsked.v1';

function storage(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const m = require('@react-native-async-storage/async-storage');
    const s = m?.default ?? m;
    return s && typeof s.getItem === 'function' && typeof s.setItem === 'function' ? s : null;
  } catch {
    return null;
  }
}

/**
 * Whether this device can remember that it asked.
 *
 * Load-bearing rather than cosmetic: without somewhere to write the fact down,
 * an automatic prompt would fire on every visit to Recovery and every visit to
 * Devices, for the rest of the app's life. A permission sheet that reappears
 * after you have answered it is worse than the blank list it was fixing, so
 * when this is false the automatic path is abandoned and the manual button —
 * which the person chose to press — remains the only route.
 */
export function canRememberSleepAsk(): boolean {
  return storage() != null;
}

/** True once Repple has requested SleepAnalysis on this device. Never throws. */
export async function hasAskedForSleep(): Promise<boolean> {
  const s = storage();
  if (!s) return false;
  try {
    return (await s.getItem(SLEEP_ASKED_KEY)) != null;
  } catch {
    // A storage read that failed is not evidence we have never asked, and
    // treating it as such is how a prompt starts repeating. Claim we have.
    return true;
  }
}

/**
 * Write down that the sheet has been raised.
 *
 * Called BEFORE `initHealthKit`, not after. `initHealthKit`'s callback does not
 * fire if the app is backgrounded while the sheet is up, and a person who
 * swipes away from a permission sheet has answered it as clearly as one who
 * taps Don't Allow — recording it only on the callback would ask them again on
 * the next launch. Recording the intent means at most one automatic prompt per
 * device even if the app is killed mid-sheet.
 */
export async function markSleepAsked(): Promise<void> {
  const s = storage();
  if (!s) return;
  try {
    await s.setItem(SLEEP_ASKED_KEY, new Date().toISOString());
  } catch {
    /* nothing to do; canRememberSleepAsk() gates the automatic path anyway */
  }
}

/** Everything the decision needs, passed in so the decision itself is pure. */
export interface AutoAskInput {
  /** HealthKit is compiled into this binary and the module loaded. */
  present: boolean;
  /** The fact that we asked can actually be persisted on this device. */
  canRemember: boolean;
  /** Repple has already requested SleepAnalysis here at least once. */
  alreadyAsked: boolean;
  /** The sleep query itself succeeded. A failed read proves nothing. */
  readOk: boolean;
  /** How many nights came back. */
  readingCount: number;
}

/**
 * Whether to raise the Health sheet automatically, this once.
 *
 * Every clause is a way of NOT nagging:
 *
 *   present       — no HealthKit in this build, so there is no sheet to raise.
 *   canRemember   — see canRememberSleepAsk: an ask we cannot record repeats.
 *   !alreadyAsked — the whole point. Asked once, never again automatically,
 *                   whatever the person answered. Someone who declined and
 *                   later changes their mind uses the manual button.
 *   readOk        — an empty list from a FAILED read says nothing about
 *                   permissions, and prompting on it would put a sheet in front
 *                   of someone every time the phone loses signal.
 *   readingCount  — a client whose watch is already reporting sleep obviously
 *                   granted it, and must never see a permission sheet.
 */
export function shouldAutoAskForSleep(i: AutoAskInput): boolean {
  return !!i.present && !!i.canRemember && !i.alreadyAsked && !!i.readOk && i.readingCount === 0;
}
