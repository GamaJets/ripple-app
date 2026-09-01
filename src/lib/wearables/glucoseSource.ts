// Which health store this phone reads blood sugar out of.
//
// Apple Health and Health Connect are the same feature twice, and the two
// readers already expose the same `fetchGlucose` / `requestGlucoseAuth`
// contract returning the same `GlucoseRead`. This file is the one place that
// chooses between them, so that every screen and hook above it picks a source
// once and then contains no platform branch at all.
//
// That is the whole point of it. The alternative — `Platform.OS === 'ios'`
// scattered through the screen, the hook and the copy — is what the app had,
// and it is why the Android half of a shipped feature could be a sentence
// apologising for itself in three different wordings. There is one sentence
// per fact here and the screen renders whichever it is handed.
//
// Nothing in this file touches a native module. Both readers load theirs
// lazily behind a guard, so importing both on either platform costs nothing
// and cannot throw.
import { Platform } from 'react-native';
import type { GlucoseRead } from '../glucose';
import * as apple from './appleHealth';
import * as android from './healthConnect';

export interface GlucoseSource {
  /** The store's own name, as its owner would say it out loud. */
  storeName: string;
  /**
   * Where a reading comes from, for the screen's own explanation of itself.
   * True on every platform including the one with no store at all.
   */
  whereFrom: string;
  /**
   * Whether THIS binary could read that store on THIS device right now — the
   * same question `WearableProvider.isAvailable()` asks, and answered the same
   * honest way. False hides the import control rather than offering a button
   * whose only possible outcome is an apology; see the long note on
   * `cloudProvider.isAvailable()`, which is the bug this rule came from.
   */
  present: boolean;
  /** Why not, when `present` is false. Null when it is true. */
  absentReason: string | null;
  fetchGlucose(sinceDays?: number): Promise<GlucoseRead>;
  requestGlucoseAuth(): Promise<void>;
  /**
   * Open the store's own permission screen. Null where there is nowhere to go.
   *
   * Android only, and it is the whole answer to a decline: once Health Connect
   * has been answered, Repple cannot raise that screen again, and the person
   * has to be taken to the place where the decision actually lives.
   */
  openStore: (() => void) | null;
}

/** iOS. HealthKit, one extra permission sheet, no way to read a decline. */
function appleSource(): GlucoseSource {
  const present = apple.healthKitPresent();
  return {
    storeName: 'Apple Health',
    whereFrom: 'A Dexcom, or a Libre through its own app, writes into Apple Health. Repple reads from there — so any monitor that reaches Health reaches Repple.',
    present,
    absentReason: present ? null : 'Apple Health is not available in this build, so readings can only be typed in.',
    fetchGlucose: apple.fetchGlucose,
    requestGlucoseAuth: apple.requestGlucoseAuth,
    // iOS has no equivalent: the Health app's sharing screen is not reachable
    // by URL, and offering a button that goes nowhere is worse than the
    // sentence that names where to look.
    openStore: null,
  };
}

/** Android. Health Connect, which does tell us when somebody has declined. */
function androidSource(): GlucoseSource {
  const present = android.healthConnectPresent();
  return {
    storeName: 'Health Connect',
    whereFrom: 'A Dexcom, or a Libre through its own app, writes into Health Connect. Repple reads from there — so any monitor that reaches Health Connect reaches Repple.',
    present,
    absentReason: present ? null : 'This build of Repple cannot read Health Connect. It is part of the app itself, so it arrives with a new version from the Play Store rather than in an update.',
    fetchGlucose: android.fetchGlucose,
    requestGlucoseAuth: android.requestGlucoseAuth,
    openStore: android.openHealthConnect,
  };
}

/**
 * Neither store — the web build, and anything else that is not a phone.
 *
 * It returns 'unsupported' rather than throwing or resolving empty, because an
 * empty 'ready' would be this file asserting that a device with no health
 * store has recorded no readings.
 */
function noSource(): GlucoseSource {
  const reason = 'Readings are read from the health store on a phone, and there is none here.';
  return {
    storeName: 'your phone’s health store',
    whereFrom: 'On a phone, a monitor writes into Apple Health or Health Connect and Repple reads from there. Here, readings can only be typed in.',
    present: false,
    absentReason: reason,
    fetchGlucose: async () => ({ status: 'unsupported', readings: [], reason }),
    requestGlucoseAuth: () => Promise.reject(new Error(reason)),
    openStore: null,
  };
}

/** The store for this platform. Cheap enough to call on every render. */
export function glucoseSource(): GlucoseSource {
  if (Platform.OS === 'ios') return appleSource();
  if (Platform.OS === 'android') return androidSource();
  return noSource();
}
