// Wearable integration — one contract every device plugs into.
// Apple Health (HealthKit), Google Health Connect, and cloud APIs (WHOOP, Oura,
// Garmin, Fitbit) all implement WearableProvider, so the UI and the sync logic
// never care which brand they're talking to.

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
  source: ProviderId;
}

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
}

export function emptyMetrics(source: ProviderId): DailyMetrics {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { date, activeKcal: null, steps: null, heartRateAvg: null, heartRateLatest: null, heartRateResting: null, workoutMins: null, updatedAt: d.toISOString(), source };
}
