// How old the heart rate on screen actually is.
//
// ── The report ────────────────────────────────────────────────────────────
//
// "Whenever you select cardio and cycling and tap on start workout, the heart
// rate shows up ... however what it seems to do is only capture what the heart
// rate is at that moment on the Apple Watch and nothing is being updated. I've
// tried disconnecting the Apple Watch and reconnecting it to see if it would
// help update it, but it doesn't do anything."
//
// Both halves of that are right, and the second half is the tell: reconnecting
// changes nothing because the connection was never the problem.
//
// ── Why polling faster did not and cannot fix it ─────────────────────────
//
// src/ui/wearables.tsx already drops to a FIVE SECOND cadence while a runner is
// open (`liveMode`), and app/(client)/workouts.tsx turns it on for both
// runners. That machinery works. What it re-reads every five seconds is
// HealthKit's newest heart-rate sample — and an Apple Watch does not write one
// every five seconds unless a WORKOUT IS RUNNING ON THE WATCH. At rest it
// writes every several minutes. So the phone asks twelve times a minute and is
// handed the same sample back, which is precisely "captures what it is at that
// moment and never updates".
//
// A watchOS companion app holding an HKWorkoutSession is what makes the samples
// stream. That is a native target and a new binary, not something an app can
// poll its way to.
//
// ── So the defect this file fixes is the SCREEN, not the cadence ─────────
//
// `newestValue()` in appleHealth.ts took the newest sample's value and threw
// its timestamp away, and `Metrics.heartRateLatest` is commented "live-ish".
// The runner then printed it under the heading bpm beside a live zone. A
// ten-minute-old reading and a five-second-old one were drawn identically, and
// the member had no way to tell which they were looking at — so a number that
// had stopped moving looked like a heart that had.
//
// The house rule covers this exactly: say what was measured and when. A reading
// is not wrong because it is old; it is wrong to present an old one as current.
//
// This module decides nothing about heart rate and everything about time.

/** How fresh the reading on screen is. */
export type HrFreshness =
  /** Moving. A watch workout is streaming, or the sample is new enough that it
   *  might as well be. */
  | 'live'
  /** A real reading, and not a current one. The screen must say how old. */
  | 'stale'
  /** No sample at all, or none with a usable time on it. */
  | 'unknown';

/**
 * Newer than this and the reading is treated as live.
 *
 * Ninety seconds, not five. During a watch workout HealthKit gets a sample
 * every few seconds, so anything genuinely streaming is far inside this; the
 * margin is for the gap between the watch writing and the phone syncing, which
 * is not instant and is not ours to control. Tighter than that and a live
 * session would flicker between 'live' and 'stale' on sync jitter alone, which
 * would be a worse lie than the one being fixed.
 */
export const HR_LIVE_WINDOW_MS = 90_000;

/**
 * How old the reading is, and whether that counts as live.
 *
 * `atISO` is when the SAMPLE was taken, not when it was read. Null means the
 * source could not say — Health Connect's aggregate reads, or a provider that
 * returns a figure with no time — and that is `unknown` rather than a guess in
 * either direction.
 *
 * `now` is injected so this is testable without waiting.
 */
export function hrFreshness(atISO: string | null | undefined, now: number): { state: HrFreshness; ageMs: number | null } {
  if (!atISO) return { state: 'unknown', ageMs: null };
  const at = Date.parse(atISO);
  if (!Number.isFinite(at)) return { state: 'unknown', ageMs: null };
  const age = now - at;
  // A sample stamped in the future is a clock disagreement, not a reading from
  // later. Treated as live rather than as an error: the member is wearing the
  // thing, and an alarming sentence about clock skew helps nobody mid-set.
  if (age < 0) return { state: 'live', ageMs: 0 };
  return { state: age <= HR_LIVE_WINDOW_MS ? 'live' : 'stale', ageMs: age };
}

/**
 * How old, in the words a person would use.
 *
 * Minutes once past a minute, because seconds stop being useful the moment the
 * answer is "not now" — and "6 minutes ago" is the fact that explains why the
 * number has not moved.
 */
export function hrAgeLabel(ageMs: number | null): string | null {
  if (ageMs == null || !Number.isFinite(ageMs) || ageMs < 0) return null;
  const secs = Math.round(ageMs / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return hrs === 1 ? 'over an hour ago' : `over ${hrs} hours ago`;
}

/**
 * The sentence under a stale reading.
 *
 * Names the cause and the one thing the member can actually do about it. The
 * remedy is NOT "reconnect your watch" — that was tried, it did nothing, and
 * telling somebody to repeat an action that cannot work is worse than saying
 * nothing. Starting the workout on the watch is what makes HealthKit stream.
 */
export function staleHrNote(ageMs: number | null): string {
  const age = hrAgeLabel(ageMs);
  const when = age ? ` — last reading ${age}` : '';
  return `That bpm is the newest your watch has written${when}, not a live reading. An Apple Watch only streams heart rate while a workout is running ON THE WATCH, so start one there and this will track you.`;
}
