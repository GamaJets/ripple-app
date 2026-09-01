// Health Connect (Android) — blood glucose, and nothing else yet.
//
// This is the Android half of the feature `appleHealth.ts` already ships on
// iOS. Two testers are on Android and have been typing their sugars in by
// hand; a Dexcom or a Libre writes into Health Connect on that phone exactly
// as it writes into Apple Health on an iPhone, so the reading was always there
// and Repple simply had no way to ask for it.
//
// ── WHAT THIS FILE DELIBERATELY DOES NOT DO ────────────────────────────────
//
// It does not read steps, heart rate, calories or workouts. Health Connect can
// supply all of them and one day should, but a permission request is read by
// the person granting it, and asking for six record types in order to ship one
// feature is how a permission screen stops being believable — the same
// argument `permissionSet` in appleHealth.ts makes about ActiveEnergyBurned,
// and the same one that keeps BloodGlucose OUT of the iOS set. One record
// type, asked for when the person opens the screen that uses it.
//
// It also does not implement `WearableProvider`. That contract is about daily
// metrics, and this module has none — `registry.ts` still lists Health Connect
// as a device Repple cannot connect for training data, and that is still true.
//
// ── WHY EVERY NATIVE CALL IS GUARDED ───────────────────────────────────────
//
// `react-native-health-connect` resolves its native module through
// `TurboModuleRegistry.getEnforcing('HealthConnect')`, which THROWS at import
// time when the module is not in the binary. That is the desired behaviour and
// it is why the require sits inside a try/catch: in Expo Go, on iOS, and in
// any build made before this dependency landed, the throw is caught and this
// module reports itself absent rather than taking the screen down with it.
//
// ── THREE WAYS THIS CAN FAIL, AND THEY ARE NOT THE SAME FAILURE ────────────
//
// Health Connect is unusual among the platform stores in that it tells the
// truth about all three, so nothing here has to guess:
//
//   the phone has no Health Connect      getSdkStatus() says so
//   the person declined                  getGrantedPermissions() omits ours
//   the read did not answer              the promise rejects
//
// `GlucoseRead` in ../glucose carries them as 'unsupported', 'denied' and
// 'error', and app/(client)/glucose.tsx prints a different sentence for each.
// Collapsing any two would tell somebody wearing a sensor something untrue
// about their own body — which on this screen is the one thing they would act
// on.
import { Platform } from 'react-native';
import { canRememberGlucoseAsk, hasAskedForGlucose, markGlucoseAsked, shouldAutoAskForGlucose } from './glucoseAccess';
import { parseHealthConnectRecords, type GlucoseRead, type GlucoseReading } from '../glucose';

/** The one record type this module ever names. */
const RECORD = 'BloodGlucose';

/** The one permission this module ever asks for. */
const GLUCOSE_READ = { accessType: 'read', recordType: RECORD } as const;

// ── Lazy native module load ────────────────────────────────────────────────
//
// The same shape as `hk()` in appleHealth.ts, and cached the same way, because
// the failure is permanent within a process: a module that was not in the
// binary at the first require will not be there at the second.
let HC: any = null;
let tried = false;
function hc(): any {
  if (tried) return HC;
  tried = true;
  // Guarded before the require rather than only after it: on iOS the require
  // would throw every time this is called, and paying for a thrown exception
  // to learn a fact `Platform.OS` already states is waste with no upside.
  if (Platform.OS !== 'android') return null;
  try {
    const mod = require('react-native-health-connect');
    HC = mod?.default ?? mod;
  } catch {
    // Either the package is absent, or the native module is not in this
    // binary. Both mean the same thing to every caller: there is nothing here
    // to read from, and a new build is what changes that.
    HC = null;
  }
  return HC;
}

/**
 * Android + a real build with the native module compiled in.
 *
 * Deliberately does NOT consult `NativeModules` the way `nativePresent()` does
 * on iOS. `getEnforcing` throwing IS the authoritative test and it works
 * whichever architecture the app is built under, whereas the NativeModules
 * table is populated differently on the new architecture and a check against
 * it would start reporting a present module as absent the day newArchEnabled
 * is turned on.
 */
export function healthConnectPresent(): boolean {
  return Platform.OS === 'android' && !!hc();
}

/**
 * Whether there is a Health Connect on this phone to talk to at all.
 *
 * Three outcomes, and the middle one is the reason this is not a boolean.
 * Health Connect is part of the framework from Android 14 onward and a
 * Play-store app before that, so a phone can have a version too old to serve
 * the request — which is fixable by the person, in one tap, and must not be
 * reported with the same sentence as a phone that cannot have it at all.
 */
export type HealthConnectAvailability = 'ready' | 'absent' | 'needs-update' | 'unknown';

/** Health Connect's own SDK status codes, named so the numbers stay here. */
const SDK_UNAVAILABLE = 1;
const SDK_NEEDS_PROVIDER_UPDATE = 2;
const SDK_AVAILABLE = 3;

export async function healthConnectAvailability(): Promise<HealthConnectAvailability> {
  const k = hc();
  if (!k || typeof k.getSdkStatus !== 'function') return 'absent';
  try {
    const status = await k.getSdkStatus();
    if (status === SDK_AVAILABLE) return 'ready';
    if (status === SDK_NEEDS_PROVIDER_UPDATE) return 'needs-update';
    if (status === SDK_UNAVAILABLE) return 'absent';
    // A code this build has never heard of is not evidence of absence. Saying
    // "your phone does not have Health Connect" on the strength of a number we
    // do not recognise is a claim about somebody's phone that we cannot make.
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** The sentence for each way there is nothing to read from. Never invented twice. */
function unavailableSentence(a: HealthConnectAvailability): string {
  if (a === 'needs-update') {
    return 'Health Connect on this phone is too old to answer. Updating it in the Play Store is all it needs.';
  }
  if (a === 'absent') {
    return 'This phone has no Health Connect for Repple to read. On Android 14 and later it is built in; before that it installs from the Play Store.';
  }
  return 'Health Connect did not say whether it is available on this phone, so nothing was read.';
}

/**
 * Bring the client up, or say plainly that it did not come up.
 *
 * `initialize()` resolving false is not an error and is not a refusal — it is
 * the client declining to start, which the caller reports as 'error' because
 * that is what it is: we asked and got no answer.
 */
async function initialized(): Promise<boolean> {
  const k = hc();
  if (!k || typeof k.initialize !== 'function') return false;
  try {
    return (await k.initialize()) === true;
  } catch {
    return false;
  }
}

/**
 * Whether the person has granted the one read this module needs.
 *
 * `null` means the question itself did not answer, and it is not a synonym for
 * false — exactly the distinction `writeAuthStatus()` draws on iOS with its
 * 'unknown'. A caller that treated null as "declined" would put a refusal in
 * front of somebody who never refused anything.
 */
export async function hasGlucosePermission(): Promise<boolean | null> {
  const k = hc();
  if (!k || typeof k.getGrantedPermissions !== 'function') return null;
  try {
    const granted = await k.getGrantedPermissions();
    if (!Array.isArray(granted)) return null;
    return granted.some((p: any) => p?.recordType === RECORD && p?.accessType === 'read');
  } catch {
    return null;
  }
}

/**
 * Raise the Health Connect permission screen for blood glucose alone.
 *
 * Records the ask BEFORE calling, for the same reason `requestGlucoseAuth`
 * does on iOS: the promise does not resolve if the app is killed while the
 * system screen is up, and somebody who swipes it away has answered it as
 * clearly as somebody who tapped Don't allow. Writing the intent down first
 * means at most one automatic ask per device even then.
 *
 * Resolves when the person has granted it and REJECTS when they have not, so
 * that a caller awaiting this cannot read a decline as a success. The rejection
 * carries a sentence about where the decision now lives, because after this
 * screen Repple can no longer raise it — Health Connect is the only place the
 * choice can be changed.
 */
export function requestGlucoseAuth(): Promise<void> {
  const k = hc();
  if (!k || typeof k.requestPermission !== 'function') {
    return Promise.reject(new Error('This build of Repple cannot read Health Connect.'));
  }
  return markGlucoseAsked()
    .then(() => initialized())
    .then((up) => {
      if (!up) throw new Error('Health Connect did not start. Try again in a moment.');
      return k.requestPermission([GLUCOSE_READ]);
    })
    .then((granted: any) => {
      const ok = Array.isArray(granted)
        && granted.some((p: any) => p?.recordType === RECORD && p?.accessType === 'read');
      if (!ok) throw new Error('Blood sugar access was not granted, so there is nothing to read.');
    });
}

/** Takes the person to Health Connect, which is where the decision now lives. */
export function openHealthConnect(): void {
  const k = hc();
  if (!k || typeof k.openHealthConnectSettings !== 'function') return;
  try {
    k.openHealthConnectSettings();
  } catch {
    /* nothing to do — the screen already tells them where to go by name */
  }
}

/** Shared across screens so two mounting together raise one screen, not two. */
let glucoseAskInFlight: Promise<void> | null = null;

/**
 * How many records to ask for at once, and how many pages to accept.
 *
 * A CGM writes a sample every five minutes — 288 a day, roughly 4,000 a
 * fortnight — and Health Connect pages rather than returning them all. The cap
 * is generous enough for the fourteen-day window the screen shows and finite
 * enough that a store holding years of records cannot walk this loop forever.
 */
const PAGE_SIZE = 1000;
const MAX_PAGES = 10;

/** Every BloodGlucose record in the window, paged, or the reason there are none. */
async function readGlucoseRecords(sinceDays: number): Promise<{ ok: true; records: any[] } | { ok: false; reason: string }> {
  const k = hc();
  if (!k || typeof k.readRecords !== 'function') {
    return { ok: false, reason: 'This build of Repple cannot read Health Connect.' };
  }
  const start = new Date();
  start.setDate(start.getDate() - Math.max(1, sinceDays));
  const timeRangeFilter = {
    operator: 'between' as const,
    startTime: start.toISOString(),
    endTime: new Date().toISOString(),
  };

  const records: any[] = [];
  let pageToken: string | undefined;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await k.readRecords(RECORD, { timeRangeFilter, ascendingOrder: false, pageSize: PAGE_SIZE, pageToken });
      const batch = Array.isArray(res?.records) ? res.records : [];
      records.push(...batch);
      pageToken = typeof res?.pageToken === 'string' && res.pageToken ? res.pageToken : undefined;
      // No token, or a page that came back short, means the store has no more
      // to give. Continuing on a short page is how a paging loop spins.
      if (!pageToken || batch.length === 0) break;
    }
  } catch {
    return { ok: false, reason: 'Health Connect did not answer. Try again in a moment.' };
  }
  return { ok: true, records };
}

/**
 * Recent glucose readings out of Health Connect.
 *
 * The same contract as `fetchGlucose` in appleHealth.ts, deliberately down to
 * the argument, so that the screen picks a provider once and then has no
 * platform branch left in it.
 *
 * The automatic ask is the same one-shot mechanism, resting on the same
 * recorded fact (see glucoseAccess.ts) — but on a different signal. iOS cannot
 * tell "never asked" from "declined" and so infers it from an empty read;
 * Health Connect answers the question directly, so the ask fires on a MISSING
 * PERMISSION rather than on an empty result. Somebody who granted access and
 * simply has no sensor is therefore never prompted at all, which on iOS took a
 * `readingCount === 0` clause to approximate.
 */
export async function fetchGlucose(sinceDays = 7): Promise<GlucoseRead> {
  if (!healthConnectPresent()) {
    return {
      status: 'unsupported',
      readings: [],
      reason: Platform.OS === 'android'
        ? 'This build of Repple cannot read Health Connect yet. It is part of the app itself, so it arrives with a new version rather than in an update.'
        : 'Health Connect is Android’s health store, so there is nothing on this phone for it to read.',
    };
  }

  const availability = await healthConnectAvailability();
  if (availability !== 'ready') {
    // 'unknown' lands here too. We could not establish that there is anything
    // to read from, and reporting that as 'error' would blame a read that was
    // never attempted.
    return { status: 'unsupported', readings: [], reason: unavailableSentence(availability) };
  }

  if (!(await initialized())) {
    return { status: 'error', readings: [], reason: 'Health Connect did not start. Try again in a moment.' };
  }

  let granted = await hasGlucosePermission();
  if (granted !== true) {
    const auto = shouldAutoAskForGlucose({
      present: true,
      canRemember: canRememberGlucoseAsk(),
      alreadyAsked: await hasAskedForGlucose(),
      // The permission question answered, which is this platform's equivalent
      // of the read having answered: a null means we do not know the
      // permission state, and asking on the strength of that is how a system
      // screen starts appearing every time somebody opens a tab.
      readOk: granted !== null,
      // Nothing has been read, because without the permission nothing can be.
      readingCount: 0,
    });
    if (auto) {
      if (!glucoseAskInFlight) glucoseAskInFlight = requestGlucoseAuth().catch(() => { /* declined, or the screen never appeared */ });
      await glucoseAskInFlight;
      granted = await hasGlucosePermission();
    }
    if (granted !== true) {
      return {
        status: 'denied',
        readings: [],
        reason: granted === null
          ? 'Health Connect did not say whether Repple may read your blood sugar, so nothing was read.'
          : 'Repple has not been given access to blood sugar in Health Connect. That is set in Health Connect itself, under App permissions.',
      };
    }
  }

  const res = await readGlucoseRecords(sinceDays);
  if (!res.ok) return { status: 'error', readings: [], reason: res.reason };

  const readings: GlucoseReading[] = parseHealthConnectRecords(res.records);
  return { status: 'ready', readings };
}
