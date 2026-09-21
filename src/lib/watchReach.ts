// Whether a watch can actually reach this screen — and the four different
// reasons it might not.
//
// ── The report ────────────────────────────────────────────────────────────
//
// "Under Watch and Devices it says Apple Watch is connected but doesn't ask for
// permissions to access Apple Health. Then in cardio, starting a cardio session
// the heart rate zone doesn't come up. Says connect a watch even though the
// Watch and Devices tab says the Apple Watch is connected."
//
// Two screens, one fact, two answers. That is the defect — not either sentence
// on its own.
//
// ── Why "connected" was not a claim about reading ────────────────────────
//
// `connect()` on the Apple provider requests HealthKit authorisation, so a
// member who taps Connect is asked. The RESTORE path does not go through it:
// src/ui/wearables.tsx marks every REMEMBERED id 'connected' on start-up, and
// the ids come from AsyncStorage AND from a server read. So an install that
// never showed the sheet — a reinstall, a new phone, a restore from the
// account rather than the device — starts life saying Apple Watch is connected
// while iOS has never been asked anything.
//
// ── And HealthKit will not tell you ──────────────────────────────────────
//
// There is no query for whether READ access was granted. Apple withholds it on
// purpose: telling an app that a type was refused reveals the refusal, which is
// itself information about the person. `getAuthStatus` answers for WRITE and
// nothing else — src/lib/wearables/appleHealth.ts `writeAuthStatus` is that, and
// its doc says `unknown` is not a synonym for denied for the same reason.
//
// So no screen in this app can ever say "you have not granted heart rate". What
// it CAN say is what it observed: a source is connected, and no reading has
// arrived. That is a smaller claim and it is a true one, and it points at the
// two things that actually produce it — a watch that has not been worn since
// the session started, and permission that was never asked for or was refused.
//
// This module holds only the choice between sentences. It reads nothing.

/** What the screen knows about getting a heart rate right now. */
export type WatchReach =
  /** A reading arrived and is current. Nothing to say. */
  | 'live'
  /** A reading arrived and has stopped moving — see src/lib/hrFreshness.ts,
   *  which owns that distinction and the sentence for it. */
  | 'stale'
  /** A local source is connected and no reading has come through it. */
  | 'connected-silent'
  /** Nothing that can produce a live reading is connected. */
  | 'none';

/**
 * Which of the four this is.
 *
 * `localConnected` means a source that streams SAMPLES — HealthKit or Health
 * Connect. A cloud vendor deliberately does not count: WHOOP, Oura and Fitbit
 * return day aggregates, there is nothing per-second in them, and a screen that
 * treated a connected Oura ring as "a watch is connected" would be promising
 * live zones that cannot arrive.
 */
export function watchReach(
  localConnected: boolean,
  hasSample: boolean,
  fresh: 'live' | 'stale' | 'unknown',
): WatchReach {
  if (hasSample && fresh === 'live') return 'live';
  if (hasSample) return 'stale';
  return localConnected ? 'connected-silent' : 'none';
}

/**
 * What the zones panel says when it has no zones to draw.
 *
 * Null for 'live' — there is nothing to explain — and null for 'stale', which
 * `staleHrNote` already answers in full beside the bpm; two sentences about the
 * same silence on one screen is how a member ends up reading neither.
 *
 * The 'connected-silent' sentence is the one this file exists for. It used to
 * be the 'none' sentence, shown to everybody, which is how somebody with a
 * connected watch was told to connect a watch.
 */
export function zonesNote(reach: WatchReach): string | null {
  switch (reach) {
    case 'live':
    case 'stale':
      return null;
    case 'connected-silent':
      return 'Your watch is connected and has not sent a reading yet. An Apple Watch only streams '
        + 'heart rate while a workout is running ON THE WATCH. Start one there. If it still says '
        + 'nothing, open the iPhone’s Health app ▸ Sharing ▸ Apps and check Repple may read Heart Rate.';
    case 'none':
      return 'Connect a watch under Train → Watch & Devices and your zones appear here live while you train.';
  }
}

/**
 * What to say BESIDE THE BPM when there is no live heart rate.
 *
 * ── Why this is a function and not two string literals ────────────────────
 *
 * It was two string literals, and they had drifted. The cardio runner branched
 * on `reach` and told a member with a connected watch the one thing that
 * actually works — start a workout ON THE WATCH. The strength runner, which is
 * the path most sessions take, said "Wear your Apple Watch for live heart rate
 * & calories" unconditionally.
 *
 * That sentence is not merely vague, it is wrong, and wrong in the way that
 * costs the reading: wearing the watch is exactly what the member was already
 * doing. An Apple Watch writes a heart-rate sample to HealthKit every several
 * MINUTES at rest and every few SECONDS only while a workout runs on the watch
 * — src/lib/hrFreshness.ts has the whole argument — and `freshSample` in the
 * runner is null unless the reading is moving. No fresh sample, no zone timer,
 * no `zones` on the row.
 *
 * The evidence is in the data. Across every user this platform has, exactly
 * one workout has ever carried zones, and it is a CYCLING session — logged
 * through the cardio runner, the one with the correct sentence. Not one
 * strength session has ever recorded a zone.
 *
 * So both callers now ask this, and a test holds the sentence to naming the
 * watch-workout requirement. Two screens that answer one question must not be
 * able to answer it differently again.
 *
 * Null for 'live' (nothing to explain) and for 'stale' — `staleHrNote` already
 * says that one in full right beside this, and two sentences about one silence
 * is how a member reads neither.
 *
 * @param calories whether this runner also credits calories to the watch.
 *   Recovery sessions do not, and promising calories there would be a claim
 *   about a figure that screen never shows.
 */
export function liveHrNote(reach: WatchReach, calories: boolean): string | null {
  switch (reach) {
    case 'live':
    case 'stale':
      return null;
    case 'connected-silent':
      return 'Your watch is connected and has not sent a reading yet. An Apple Watch only '
        + 'streams heart rate while a workout is running on the watch. Start one there.';
    case 'none':
      return `Connect an Apple Watch under Watch & Devices, then start a workout on the watch. `
        + `That is what streams live heart rate${calories ? ' and calories' : ''}.`;
  }
}
