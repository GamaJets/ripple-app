// Wearable integration — one contract every device plugs into.
// Apple Health (HealthKit), Google Health Connect, and cloud APIs (WHOOP, Oura,
// Garmin, Fitbit) all implement WearableProvider, so the UI and the sync logic
// never care which brand they're talking to.

import type { ZoneSeconds } from '../hr';
import type { SleepRead } from '../sleepMerge';

export type ProviderId = 'apple' | 'whoop' | 'garmin' | 'fitbit' | 'oura' | 'googlefit';
export type ProviderKind = 'healthkit' | 'health-connect' | 'cloud';
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/** A single day's roll-up. Any field a provider can't supply is null. */
export interface DailyMetrics {
  date: string;                 // YYYY-MM-DD (local)
  activeKcal: number | null;    // active energy burned
  steps: number | null;
  heartRateAvg: number | null;  // bpm, mean of today's samples
  heartRateLatest: number | null; // bpm, most recent sample (live-ish during a workout)
  heartRateResting: number | null;
  heartRateMax: number | null;    // bpm, peak of today's workouts
  /** Seconds per training zone (z1..z5, the Orange-Theory scale in src/lib/hr).
   *  WHOOP reports these per workout; HealthKit gives raw samples instead, from
   *  which the client derives the same shape. */
  zoneSeconds: ZoneSeconds | null;
  workoutMins: number | null;
  updatedAt: string;            // ISO timestamp of the sync
  source: ProviderId;
}

/** A single completed workout pulled from a wearable (e.g. an Apple Watch session). */
export interface WorkoutSample {
  id: string;                 // stable id for dedupe (source + start + activity)
  activity: string;           // app-facing exercise name (mapped from the device's activity label)
  rawActivity: string;        // the device's original activity label (for display / debugging)
  start: string;              // ISO start time
  mins: number;               // duration in minutes
  kcal: number | null;        // active energy burned, if recorded
  distanceKm: number | null;  // distance in km if the activity records it (else null)
  /** Vendor-reported heart rate for the session. WHOOP gives these directly;
   *  HealthKit does not, so the client derives them from the sample series. */
  avgHr?: number | null;
  maxHr?: number | null;
  source: ProviderId;
}

/** A single heart-rate reading in a series (for the session/day HR chart). */
export interface HrPoint { t: string; bpm: number }

export interface ProviderMeta {
  id: ProviderId;
  name: string;
  icon: string;
  kind: ProviderKind;
  blurb: string;
  metrics: string[];            // human labels of what it can read
}

export interface WearableProvider {
  meta: ProviderMeta;
  /** Can this provider run in the *current* binary right now? (native module present / cloud reachable) */
  isAvailable(): boolean;
  /** If not available, a short human reason for the UI (else null). */
  unavailableReason(): string | null;
  /** Request permission / start OAuth. Resolves when connected, throws with a message otherwise. */
  connect(): Promise<void>;
  /** Forget the connection locally. */
  disconnect(): Promise<void>;
  /** Pull today's metrics, or null if not connected / nothing available. */
  fetchToday(): Promise<DailyMetrics | null>;
  /** Pull recent completed workouts for import into the training log. Optional — not every provider supports it. */
  fetchWorkouts?(sinceDays?: number): Promise<WorkoutSample[]>;
  /** Heart-rate samples between two ISO timestamps (for the zone chart). Optional. */
  fetchHeartRateSeries?(startISO: string, endISO: string): Promise<HrPoint[]>;
  /**
   * Recent nights of sleep. Optional, and it returns a SleepRead rather than a
   * bare list precisely so that "this device recorded nothing" and "we could
   * not ask this device" arrive as different answers — a provider that resolved
   * to an empty array for a failed read is how the recurring data-loss bug in
   * src/ui/loadStatus.ts gets written. It never throws for an ordinary failure.
   */
  fetchSleep?(sinceDays?: number): Promise<SleepRead>;
}

export function emptyMetrics(source: ProviderId): DailyMetrics {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { date, activeKcal: null, steps: null, heartRateAvg: null, heartRateLatest: null, heartRateResting: null, heartRateMax: null, zoneSeconds: null, workoutMins: null, updatedAt: d.toISOString(), source };
}
