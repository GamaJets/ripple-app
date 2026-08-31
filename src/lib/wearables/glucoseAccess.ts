// Asking for blood glucose, once, and only of people who want it.
//
// This is the sleep problem again (see sleepAccess.ts), with one deliberate
// difference. Sleep was added to the permission set EVERYBODY is asked for on
// connect, so the whole job there was rescuing existing users who had already
// answered a shorter sheet. Glucose is never in that set at all: almost nobody
// wears a CGM, and a permission sheet listing types the app will not use for
// you is a sheet you stop reading.
//
// So BloodGlucose gets its own one-type sheet, raised the first time somebody
// actually looks at the glucose screen. `initHealthKit` only prompts for types
// iOS has not yet decided about, which is what makes a second, narrower call
// safe: it re-confirms nothing and adds one row.
//
// The fact this file keeps is the same one sleepAccess keeps, and it is kept
// for the same reason: HealthKit answers an UNREQUESTED read with an empty
// array, exactly as it answers a REFUSED one. Nothing in the response
// distinguishes "never asked", "declined", and "no sensor" — so the only way
// to avoid either nagging everybody forever or leaving the affected people
// permanently blank is to write down whether we have ever asked.
//
// No native import at the top: AsyncStorage is reached through a guarded lazy
// require so the pure decision below runs under plain node in the test. The
// literal module name matters — Metro resolves requires statically, and
// `require(someVariable)` fails the production bundle outright.

/**
 * Where the "we have asked for glucose" fact lives.
 *
 * Versioned in the name for the same reason the sleep key is: if the glucose
 * permission set ever gains a second type — insulin delivery, carbohydrates —
 * the next key can be introduced without every device believing it has already
 * been asked about it.
 */
export const GLUCOSE_ASKED_KEY = 'repple.hk.glucoseAsked.v1';

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
 * Load-bearing: without somewhere to write the fact down, the automatic sheet
 * would reappear on every visit to the glucose screen for the rest of the
 * app's life. When this is false the automatic path is abandoned entirely and
 * the manual button — which the person chose to press — is the only route.
 */
export function canRememberGlucoseAsk(): boolean {
  return storage() != null;
}

/** True once Repple has requested BloodGlucose on this device. Never throws. */
export async function hasAskedForGlucose(): Promise<boolean> {
  const s = storage();
  if (!s) return false;
  try {
    return (await s.getItem(GLUCOSE_ASKED_KEY)) != null;
  } catch {
    // A storage read that failed is not evidence we have never asked, and
    // treating it as such is how a prompt starts repeating. Claim we have.
    return true;
  }
}

/**
 * Write down that the sheet has been raised.
 *
 * Called BEFORE `initHealthKit`. Its callback does not fire if the app is
 * backgrounded while the sheet is up, and somebody who swipes a permission
 * sheet away has answered it as clearly as somebody who taps Don't Allow.
 */
export async function markGlucoseAsked(): Promise<void> {
  const s = storage();
  if (!s) return;
  try {
    await s.setItem(GLUCOSE_ASKED_KEY, new Date().toISOString());
  } catch {
    /* nothing to do; canRememberGlucoseAsk() gates the automatic path anyway */
  }
}

/** Everything the decision needs, passed in so the decision itself is pure. */
export interface GlucoseAskInput {
  /** HealthKit is compiled into this binary and the module loaded. */
  present: boolean;
  /** The fact that we asked can actually be persisted on this device. */
  canRemember: boolean;
  /** Repple has already requested BloodGlucose here at least once. */
  alreadyAsked: boolean;
  /** The glucose query itself succeeded. A failed read proves nothing. */
  readOk: boolean;
  /** How many readings came back. */
  readingCount: number;
}

/**
 * Whether to raise the Health sheet automatically, this once.
 *
 * Every clause is a way of NOT nagging:
 *
 *   present       — no HealthKit in this build, so there is no sheet to raise.
 *   canRemember   — an ask this device cannot record is an ask that repeats.
 *   !alreadyAsked — the whole point. Asked once, never again automatically,
 *                   whatever the person answered. Somebody who declined and
 *                   later changes their mind uses the manual button.
 *   readOk        — an empty list from a FAILED read says nothing about
 *                   permissions, and prompting on it would raise a sheet every
 *                   time the read glitched.
 *   readingCount  — somebody whose sensor is already reporting has obviously
 *                   granted it, and must never see a permission sheet.
 */
export function shouldAutoAskForGlucose(i: GlucoseAskInput): boolean {
  return !!i.present && !!i.canRemember && !i.alreadyAsked && !!i.readOk && i.readingCount === 0;
}
