// Apple Health (HealthKit) provider.
//
// HealthKit is native code — it only exists in a real build of Repple (a dev
// build or a store build), NOT in Expo Go. So every native call is lazy and
// guarded: in Expo Go this provider reports itself unavailable and the UI shows
// "needs the Repple app build" instead of crashing.
//
// Apple Watch data reaches us automatically: the watch syncs heart rate,
// calories, steps and workouts into the iPhone's Health app, and HealthKit
// reads from there — no separate watchOS target required to READ this data.
import { Platform, NativeModules } from 'react-native';
import type { WearableProvider, ProviderMeta, DailyMetrics } from './types';
import { emptyMetrics } from './types';

const meta: ProviderMeta = {
  id: 'apple',
  name: 'Apple Watch',
  icon: '⌚',
  kind: 'healthkit',
  blurb: 'Heart rate, calories, steps & workouts via Apple Health',
  metrics: ['Heart rate', 'Active calories', 'Steps', 'Resting HR', 'Workouts'],
};

// ── Lazy native module load ────────────────────────────────────────────────
let HK: any = null;
let tried = false;
function hk(): any {
  if (tried) return HK;
  tried = true;
  try {
    const mod = require('react-native-health');
    HK = mod?.default ?? mod;
  } catch {
    HK = null; // package not installed yet
  }
  return HK;
}
/** True only in a real build where the native HealthKit module is compiled in. */
function nativePresent(): boolean {
  return Platform.OS === 'ios' && !!NativeModules.AppleHealthKit && !!hk();
}

function isoStartOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Promisified single HealthKit read; resolves null on any error. */
function read(method: string, options: any): Promise<any> {
  return new Promise((resolve) => {
    const k = hk();
    if (!k || typeof k[method] !== 'function') return resolve(null);
    try {
      k[method](options, (err: any, res: any) => resolve(err ? null : res));
    } catch {
      resolve(null);
    }
  });
}

function requestAuth(): Promise<void> {
  return new Promise((resolve, reject) => {
    const k = hk();
    if (!k || !k.Constants) return reject(new Error('HealthKit is not available in this build.'));
    if (typeof k.initHealthKit !== 'function') return reject(new Error('The Apple Health module is not loaded in this build. A new build with the compatibility fix is needed.'));
    const P = k.Constants.Permissions;
    const permissions = {
      permissions: {
        read: [P.HeartRate, P.RestingHeartRate, P.ActiveEnergyBurned, P.StepCount, P.Workout],
        write: [],
      },
    };
    k.initHealthKit(permissions, (err: string) => (err ? reject(new Error(String(err))) : resolve()));
  });
}

function sumValues(res: any): number | null {
  if (!Array.isArray(res) || res.length === 0) return null;
  return Math.round(res.reduce((s: number, x: any) => s + (Number(x?.value) || 0), 0));
}
function avgValues(res: any): number | null {
  if (!Array.isArray(res) || res.length === 0) return null;
  return Math.round(res.reduce((s: number, x: any) => s + (Number(x?.value) || 0), 0) / res.length);
}
function lastValue(res: any): number | null {
  if (!Array.isArray(res) || res.length === 0) return null;
  return Math.round(Number(res[res.length - 1]?.value) || 0);
}

export const appleHealth: WearableProvider = {
  meta,
  isAvailable: () => nativePresent(),
  unavailableReason: () =>
    Platform.OS !== 'ios'
      ? 'Apple Health is iPhone-only.'
      : nativePresent()
      ? null
      : 'Needs the Repple app build (Apple Health can’t run inside Expo Go).',

  async connect() {
    if (Platform.OS !== 'ios') throw new Error('Apple Health is iPhone-only.');
    if (!nativePresent()) throw new Error('Open the Repple dev build to connect Apple Health — it can’t read HealthKit inside Expo Go.');
    await requestAuth();
  },

  async disconnect() {
    // HealthKit has no revoke API; the user manages access in iOS Settings ▸ Health.
    // We just drop the local connection flag (handled by the context).
  },

  async fetchToday(): Promise<DailyMetrics | null> {
    if (!nativePresent()) return null;
    const options = { startDate: isoStartOfToday(), endDate: new Date().toISOString() };
    // Sample-based reads need an explicit limit — without it react-native-health
    // returns an empty array (aggregate reads like getStepCount do not).
    const sampleOpts = { ...options, limit: 10000, ascending: true };
    const [active, steps, hr, rhr, workouts] = await Promise.all([
      read('getActiveEnergyBurned', sampleOpts),
      read('getStepCount', options),
      read('getHeartRateSamples', sampleOpts),
      read('getRestingHeartRateSamples', { ...sampleOpts, ascending: false }),
      read('getSamples', { ...options, type: 'Workout', limit: 100 }),
    ]);
    const m = emptyMetrics('apple');
    m.activeKcal = sumValues(active);
    m.steps = steps && typeof steps.value === 'number' ? Math.round(steps.value) : sumValues(steps);
    m.heartRateAvg = avgValues(hr);
    m.heartRateLatest = lastValue(hr);
    m.heartRateResting = lastValue(rhr);
    if (Array.isArray(workouts) && workouts.length) {
      const mins = workouts.reduce((s: number, w: any) => {
        const a = Date.parse(w?.start ?? w?.startDate);
        const b = Date.parse(w?.end ?? w?.endDate);
        return s + (isFinite(a) && isFinite(b) ? (b - a) / 60000 : 0);
      }, 0);
      m.workoutMins = Math.round(mins) || null;
    }
    return m;
  },
};
