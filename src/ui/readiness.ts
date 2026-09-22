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
import { isWhole, worstStatus, type LoadStatus } from './loadStatus';
import { readinessScore, readinessSleep, type Readiness, type ReadinessSleep } from '../lib/readiness';
import { todayISO } from '../lib/bodyFigures';
import { deviceSleepTrust, readinessBreakdown, type ReadinessBreakdown, type ReadinessSource } from '../lib/readinessBreakdown';
import { readinessDirection, yesterdayOf, type ReadinessDirection, type ReadinessYesterday } from '../lib/readinessDirection';
import { providerById } from '../lib/wearables/registry';
import { hardwareFor, useLinkRevision } from '../lib/wearableLinkLedger';
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
  /**
   * Which way the score has moved since yesterday, or which of the four reasons
   * there is no saying — and **null when there is no score to give a direction
   * to at all**, where `breakdown.absence` is the whole answer.
   *
   * A screen draws the figure only for `state === 'scored'`. The other three
   * states are for a screen that would otherwise have to infer an absence from
   * a missing number, which is how "no change" comes to be printed about a day
   * nobody has any record of.
   */
  direction: ReadinessDirection | null;
}

export function useReadiness(): ReadinessView {
  const { sleep: typed, status: typedStatus } = useWellness();
  const devSleep = useDeviceSleep();
  const { water, waterGoal, waterStatus } = useHabits();
  const { log, status: logStatus } = useWorkoutLog();
  const { states: deviceStates, metrics: deviceMetrics } = useWearables();
  const linkRev = useLinkRevision();

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
    // The window and the memo key are ONE clock read, not two. `readinessSleep`
    // defaults its `now` to a fresh `new Date()`, which is correct today —
    // this memo re-runs when the day rolls over or the app foregrounds, so the
    // default is read again each time. But it is a second read of the clock
    // beside `nowMs`, and src/ui/deviceSleep.tsx records that exact drift
    // having shipped once: "the seven night keys were the seven ending on the
    // day this provider first mounted". Passing the instant the memo is
    // already keyed on means the nights the average may use and the sessions
    // counted beneath it cannot come from two different moments.
    const sleep = readinessSleep(nights, typed, READINESS_NIGHTS, new Date(nowMs));

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
      // ...unless the vendor has told us there is no device on the account, in
      // which case this screen would commit the very error the paragraph above
      // exists to prevent, one vendor along. A connected Oura account with no
      // ring on it scores no recovery and never will, and counting it here
      // produced "your device has not reported one today" — a sentence that
      // sends somebody to look for a sync that cannot happen. See
      // `noteHardware` in wearableLinkLedger.ts; undefined means nobody asked,
      // and the flag stands.
      if ((id === 'whoop' || id === 'oura') && hardwareFor(id as ProviderId) !== 'absent') recoveryDeviceConnected = true;
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

    // ── and what it was yesterday ─────────────────────────────────────────
    //
    // A score with no direction is half an answer: 62 on its own says nothing
    // about whether this is a bad morning or the best of the week. See
    // src/lib/readinessDirection.ts for the four ways of not having a yesterday
    // and why the fourth one refuses to subtract.
    //
    // Yesterday is REBUILT from the same record rather than read back from a
    // store, because this app keeps no daily readiness snapshot — nothing in
    // the schema holds yesterday's score. Two of the four signals can be
    // rebuilt and two cannot:
    //
    //   · sleep     yes. `useDeviceSleep` holds seven nights and the typed log
    //               is the member's whole history, so yesterday's three-night
    //               window is entirely inside what we already have.
    //   · training  yes. The workout log is read newest-first to its page cap
    //               and reaches days back, not hours.
    //   · hydration NO. `useHabits` exposes today's glass count and today's
    //               only; yesterday's is not kept anywhere this hook can see.
    //   · recovery  NO. `metrics` is the latest roll-up a provider published,
    //               with no per-day history behind it.
    //
    // So the rebuild is always sleep-and-training, and `readinessDirection`
    // compares the SETS: for a member with no water goal and no strap — most of
    // them — today's score is sleep-and-training too, the pair is out of the
    // same 70, and they get a real direction every morning. For everybody else
    // the pair is two different denominators and the answer is 'not-comparable',
    // which is the honest one.
    //
    // The two-day training window hangs off `y.at`, which is the same clock time
    // yesterday and not local midnight — measuring back from the start of
    // yesterday would look at the two days BEFORE it and see none of yesterday
    // at all. `t <= yMs` closes the far end, which the live window above does
    // not need because nothing is logged in the future.
    const y = yesterdayOf(new Date(nowMs));
    const yMs = y ? y.at.getTime() : NaN;
    const yHave = y != null && Number.isFinite(yMs);
    const ySleep = y ? readinessSleep(nights, typed, READINESS_NIGHTS, y.at) : null;
    const ySince = yMs - 2 * 86400000;
    const yDays = new Set(
      log.filter((e) => { const t = Date.parse(e.t); return t >= ySince && t <= yMs; })
        .map((e) => todayISO(new Date(e.t))),
    ).size;
    // Null, never 0, for exactly the reason the live count above is: an unread
    // log scores as maximally rested, and a fabricated yesterday would put a
    // direction on the hero built out of a read that failed.
    const yWorkouts = isWhole(logStatus) && yHave ? yDays : null;
    const yScored = ySleep && yHave
      ? readinessScore({ avgSleepHours: ySleep.avgHours, hydrationPct: null, recoveryPct: null, workoutsLast2Days: yWorkouts })
      : null;
    // No rebuilt score is TWO different things and they must not be folded. If
    // every read behind the rebuild came back whole, yesterday genuinely has no
    // readiness — a complete answer. If any of them was short or failed, the
    // nights or the sessions we would have scored may be sitting behind it, and
    // 'no-record' would be a claim about the member made out of our own failed
    // read. `deviceSleepTrust` and not `deviceStatus`: the walk reports 'ready'
    // the moment every provider has been ASKED, whatever each of them answered.
    const yStatus: LoadStatus = yScored != null
      ? 'ready'
      : yHave && worstStatus(deviceSleepTrust(deviceStatus, sources), typedStatus, logStatus) === 'ready'
        ? 'ready'
        : 'error';
    const yesterday: ReadinessYesterday = {
      status: yStatus,
      score: yScored && y ? { day: y.day, score: yScored.score, from: yScored.from } : null,
    };
    const direction = readinessDirection(readiness, yesterday, new Date(nowMs));

    // An incomparable pair reaching the breakdown from THIS caller is always
    // ours, never a fact about yesterday: the rebuild above cannot carry
    // hydration or recovery, so every member with a water goal or a strap would
    // be told their two days were built from different signals on every single
    // day, for as long as that stayed true. A warn flag that prints every day is
    // the flag people stop reading, which is the cost the breakdown's own note
    // on `short` describes. The state is still exposed on the view, so a screen
    // can quietly draw no direction and say why if asked — it simply does not
    // become a standing caveat on the number.
    //
    // The other three states pass through untouched. A yesterday that FAILED to
    // read is a real short read and earns its sentence.
    const directionCaveat = direction?.state === 'not-comparable' ? null : direction;

    return {
      readiness,
      sleep,
      workoutsLast2Days,
      direction,
      breakdown: readinessBreakdown({
        direction: directionCaveat,
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
  // `linkRev` is a dependency and not a value used in the body: `hardwareFor`
  // above reads the link ledger, which lives outside React state on purpose,
  // so without this the memo would hold whatever the ledger said when it last
  // ran. The revision is what every other screen uses to re-ask after a
  // verdict changes — see useLinkRevision in wearableLinkLedger.ts.
  }, [nights, typed, typedStatus, reads, deviceStatus, water, waterGoal, waterStatus, log, logStatus, deviceStates, deviceMetrics, nowMs, linkRev]);
}
