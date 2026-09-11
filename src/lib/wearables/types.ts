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
  /**
   * Energy burned ON TOP of resting metabolism — a run, a session, walking to
   * work. NOT the whole day.
   *
   * The distinction is not pedantry, it is the difference between two numbers
   * that differ by about 1,600 kcal. WHOOP's cycle `kilojoule` is TOTAL daily
   * expenditure and was being stored here, so the app showed a mid-afternoon
   * "Calories Burned" of 1,309 — a plausible active figure for a hard day, and
   * in fact mostly the client lying still. Fitbit has the same trap: its
   * `caloriesOut` is total and `activityCalories` is active.
   */
  activeKcal: number | null;
  /** Whole-day expenditure including resting metabolism. Some providers give
   *  only this (WHOOP), some only active (Oura), some both (Fitbit, Apple).
   *  Kept apart so a screen never compares one against the other. */
  totalKcal: number | null;
  steps: number | null;
  heartRateAvg: number | null;  // bpm, mean of today's samples
  heartRateLatest: number | null; // bpm, most recent sample
  /**
   * WHEN that sample was taken, ISO, or null when the source cannot say.
   *
   * It used to be thrown away, and the comment on the line above used to read
   * "live-ish during a workout". That hedge was the whole defect: an Apple
   * Watch only streams heart rate while a workout is running ON THE WATCH, so
   * away from one this figure can be many minutes old — and with no time
   * attached, the runner drew a ten-minute-old reading exactly like a
   * five-second-old one. Reported as the heart rate never updating.
   *
   * src/lib/hrFreshness.ts is what reads this and decides what the screen may
   * call live.
   */
  heartRateLatestAt: string | null;
  heartRateResting: number | null;
  heartRateMax: number | null;    // bpm, peak of today's workouts
  /** Seconds per training zone (z1..z5, the Orange-Theory scale in src/lib/hr).
   *  WHOOP reports these per workout; HealthKit gives raw samples instead, from
   *  which the client derives the same shape. */
  zoneSeconds: ZoneSeconds | null;
  workoutMins: number | null;
  /**
   * Nightly heart-rate variability in MILLISECONDS, and always RMSSD.
   *
   * Named in the unit because the two vendors that publish it publish it in
   * different ones and neither says so in the field name: WHOOP's recovery
   * score carries `hrv_rmssd_milli` in SECONDS (0.0621 for 62 ms), Oura's
   * `average_hrv` on a sleep document is already milliseconds. The conversion
   * belongs in the edge function next to the field it reads, and this comment
   * exists so nobody "fixes" a 62 that looks small by multiplying it again.
   *
   * It is deliberately NOT comparable between people. HRV is a personal
   * baseline — 40 ms is excellent for one member and a red flag for another —
   * so every screen that prints it prints it as a trend against that member's
   * own history, never against a population norm this app does not have.
   */
  hrv: number | null;
  /**
   * The vendor's own 0–100 verdict on how recovered the member is: WHOOP
   * recovery, Oura readiness.
   *
   * One field for two vendors because they answer the same question on the same
   * scale in the same direction. `recoverySource` says which one, because the
   * screens must be able to name it — "Recovery 34%" with no attribution is a
   * number the member cannot check against the app they already trust.
   */
  recoveryPct: number | null;
  /** Which vendor's word `recoveryPct` is. Null whenever recoveryPct is. */
  recoverySource: 'whoop' | 'oura' | null;
  /**
   * WHOOP day strain, on WHOOP's 0–21 logarithmic scale.
   *
   * The scale is stated because it is not a percentage and not out of 10, and a
   * 14.2 rendered against either of those reads as a completely different day.
   * Only WHOOP publishes it; nothing else in this app computes one, and nothing
   * may derive one — a "strain" invented from sets and reps would sit on the
   * same row as a measured one with no way for the member to tell them apart.
   */
  strain: number | null;
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
  /** Heart-rate samples between two ISO timestamps, DOWNSAMPLED for drawing.
   *  Optional. For a chart this is what you want; for arithmetic it is not —
   *  see `fetchHeartRateSamples`. */
  fetchHeartRateSeries?(startISO: string, endISO: string): Promise<HrPoint[]>;
  /**
   * The same window at FULL RESOLUTION, for rebuilding a zone breakdown.
   *
   * Separate from `fetchHeartRateSeries` because that one thins the series to
   * keep an SVG light, and thinning is fatal to this arithmetic: it keeps every
   * Nth sample, so a short burst into zone 4 is dropped entirely — and a splat
   * point is a minute at zone 4 or above. A chart that loses a spike looks
   * almost the same; a breakdown that loses it is wrong about the session.
   */
  fetchHeartRateSamples?(startISO: string, endISO: string): Promise<HrPoint[]>;
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
  return { date, activeKcal: null, totalKcal: null, steps: null, heartRateAvg: null, heartRateLatest: null, heartRateLatestAt: null, heartRateResting: null, heartRateMax: null, zoneSeconds: null, workoutMins: null, hrv: null, recoveryPct: null, recoverySource: null, strain: null, updatedAt: d.toISOString(), source };
}
