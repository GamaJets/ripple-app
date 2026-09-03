// One readiness answer, for every screen that shows one.
//
// Three screens derive this today — the home screen's hero, the AI coach's
// context block, and now Recovery, which is where the hero's own tap lands.
// Each of them assembled it by hand out of five providers, and the assembly is
// twenty lines of gates that are easy to get subtly wrong: device nights before
// typed ones, a null load rather than a zero, a null hydration rather than
// `water / goal`, `isWhole` on the water read, `logKnown` on the training log.
// Two of those gates have already shipped as bugs on one screen while being
// correct on another — app/(client)/coach.tsx was gating the training log by
// hand for months while the home screen's hero rose whenever the log failed to
// load, and the home screen read the typed sleep log alone while Recovery
// showed a week of WHOOP nights, which is the "whoop is connected and sleep is
// also there. its not updating the repple app" report.
//
// That is the pattern this codebase keeps paying for: two screens deriving one
// fact separately and disagreeing about it. So the derivation lives here once,
// the screens read the answer, and a screen that wants to explain the number
// gets the explanation from the same call that produced it.
//
// Nothing is computed in this file. Every decision is in src/lib/readiness.ts
// and src/lib/readinessBreakdown.ts, both pure and both tested; this only
// collects the provider state and hands it over.
import { useMemo } from 'react';
import { useNow } from './today';
import { useWellness } from './wellness';
import { useWearables } from './wearables';
import { useDeviceSleep } from './deviceSleep';
import { useHabits } from './habits';
import { useWorkoutLog } from './workoutLog';
import { isWhole, type LoadStatus } from './loadStatus';
import { readinessScore, readinessSleep, type Readiness, type ReadinessSleep } from '../lib/readiness';
import { todayISO } from '../lib/bodyFigures';
import { readinessBreakdown, type ReadinessBreakdown, type ReadinessSource } from '../lib/readinessBreakdown';
import { providerById } from '../lib/wearables/registry';
import type { ProviderId } from '../lib/wearables/types';

/**
 * How many nights readiness averages over.
 *
 * Three, and named here rather than typed as a literal at each call site: the
 * home screen and the coach screen both passed 3 by hand, and the breakdown
 * prints the number back to the member ("over 2 of the last 3 nights"), so a
 * drift between the two would make the sentence a lie about the arithmetic.
 */
export const READINESS_NIGHTS = 3;

export interface ReadinessView {
  /** The score, or null when there was nothing honest to compute it from. */
  readiness: Readiness | null;
  /** The nights behind it, and where each came from. */
  sleep: ReadinessSleep;
  /** What went in, what did not, and how complete the read was. */
  breakdown: ReadinessBreakdown;
  /** Sessions in the last two days, or null when the training log was unreadable. */
  workoutsLast2Days: number | null;
}

export function useReadiness(): ReadinessView {
  const { sleep: typed, status: typedStatus } = useWellness();
  const devSleep = useDeviceSleep();
  const { water, waterGoal, waterStatus } = useHabits();
  const { log, status: logStatus } = useWorkoutLog();
  const { states: deviceStates, metrics: deviceMetrics } = useWearables();

  const reads = devSleep.reads;
  const nights = devSleep.nights;
  const deviceStatus: LoadStatus = devSleep.status;
  /**
   * The instant the two-day training window is measured back from.
   *
   * `useNow()` rather than a `Date.now()` in the memo body, and it is IN the
   * dependency list below. The bare call was evaluated once per memo run and the
   * list held no clock, so on the home screen — a TAB, mounted for as long as
   * the app is — the window was pinned to whenever the member first opened it.
   * A session from four days ago went on counting as one from the last two, so
   * readiness stayed suppressed and the app told a rested member to take it
   * easy; and a member who trains without logging drifts the other way. It
   * self-healed only when `log` happened to change, which is the one thing a
   * member on a rest day does not do.
   */
  const nowMs = useNow().getTime();

  return useMemo(() => {
    const sleep = readinessSleep(nights, typed, READINESS_NIGHTS);

    // Days with a session in the last two, not entries — three sets on Monday
    // are one day of training. `log` is EMPTY under 'error', so the count is
    // only offered when the log was actually read; otherwise null travels, and
    // readinessScore withholds the score rather than scoring an unread log as
    // maximally rested and telling somebody to push.
    const since = nowMs - 2 * 86400000;
    // The LOCAL day of each session, not a slice of its ISO string. Its sibling
    // file states the rule where it does the same job for sleep: "Slicing the
    // ISO string would take the UTC day and file a 9pm entry under tomorrow for
    // anybody west of Greenwich." Here the cost is the other way round and
    // lands on the score: a member in Auckland training on Monday and Tuesday
    // evening produced two UTC dates that were the SAME day, so two days of
    // training counted as one, readiness read them as rested, and the app told
    // them to push. `todayISO` is the local calendar day.
    const days = new Set(log.filter((e) => Date.parse(e.t) >= since).map((e) => todayISO(new Date(e.t)))).size;
    const workoutsLast2Days = isWhole(logStatus) ? days : null;

    // Null, never `water / 8` and never `?? 0`. No goal means there is no
    // percentage of a goal to take, and an unread count over a goal they DID
    // set is thirty points off for a network blip.
    const hydrationPct = waterGoal && isWhole(waterStatus) ? water / waterGoal : null;

    // The device's own recovery verdict, from whichever connected provider
    // published one today.
    //
    // Only CONNECTED providers are consulted. `metrics` keeps the last roll-up
    // a provider produced and `disconnect()` clears it, but a provider whose
    // token died sets state to 'disconnected' and leaves the metrics in place
    // on purpose — so reading the map alone would score a member on the
    // recovery their strap reported before it stopped talking to us, for as
    // long as the app stayed open.
    //
    // First rather than best. Two straps both scoring recovery is vanishingly
    // rare, and taking the higher of two would be picking the flattering one;
    // taking the first in registry order is at least a rule that does not
    // depend on which number is nicer. The name travels with it so the
    // breakdown can attribute the figure to the device that made it.
    let recoveryPct: number | null = null;
    let recoveryFrom: string | null = null;
    let recoveryDeviceConnected = false;
    for (const [id, m] of Object.entries(deviceMetrics)) {
      if (deviceStates[id] !== 'connected') continue;
      // A device that scores recovery at all — which is what makes a null
      // meaningful. Apple Health publishes no such score, so an iPhone-only
      // member is "no connected device scores recovery" rather than "your
      // device has not reported one today", and is not sent to look for a
      // sync that was never going to happen.
      if (id === 'whoop' || id === 'oura') recoveryDeviceConnected = true;
      if (recoveryPct != null) continue;
      const v = m?.recoveryPct;
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      recoveryPct = v;
      recoveryFrom = providerById(id as ProviderId)?.meta.name ?? id;
    }

    const readiness = readinessScore({
      avgSleepHours: sleep.avgHours,
      hydrationPct,
      recoveryPct,
      workoutsLast2Days,
    });

    // One row per provider the member has actually connected, named as the
    // Devices screen names it — a caveat reading "whoop could not be read" and
    // a settings row reading "WHOOP" are two names for one device.
    const sources: ReadinessSource[] = reads.map((r) => ({
      name: providerById(r.provider as ProviderId)?.meta.name ?? r.provider,
      status: r.status,
      nights: r.readings.length,
    }));

    return {
      readiness,
      sleep,
      workoutsLast2Days,
      breakdown: readinessBreakdown({
        readiness,
        sleep,
        windowNights: READINESS_NIGHTS,
        deviceStatus,
        sources,
        typedStatus,
        hydrationGoal: waterGoal != null,
        hydrationStatus: waterStatus,
        hydrationPct,
        recoveryPct,
        recoveryFrom,
        recoveryDeviceConnected,
        workoutsLast2Days,
      }),
    };
  }, [nights, typed, typedStatus, reads, deviceStatus, water, waterGoal, waterStatus, log, logStatus, deviceStates, deviceMetrics, nowMs]);
}
