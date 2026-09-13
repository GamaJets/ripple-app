// Training readiness — a simple, transparent 0–100 score from the data the app
// already has: recent sleep, the device's own recovery verdict, hydration, and
// short-term training load. Higher = better recovered. Pure function so it unit
// tests and ships over-the-air.
//
// ── The fourth signal, and why it is the vendor's score and not raw HRV ─────
//
// This file's header promised a fourth signal "when HealthKit/wearable HRV
// lands" for as long as the file has existed, and the wearable layer has been
// reading nothing but sleep out of a WHOOP the whole time. A member could have
// a strap on their wrist reporting 31% recovered and open a screen whose entire
// purpose is to say whether to train today, and the screen would not have
// looked.
//
// What went in is `recoveryPct` — WHOOP recovery, Oura readiness — and NOT a
// raw HRV or a resting heart rate, even though the wearable layer now carries
// both. The reason is that neither of those means anything without the
// member's own baseline: 42 ms of RMSSD is an excellent night for one person
// and an alarm for another, and this app holds no per-member HRV history to
// compare against. Scoring an absolute figure against a population norm we do
// not have would be exactly the kind of invented number the rest of this file
// exists to refuse. The vendor's 0–100 score is already normalised against
// that member's own weeks of data, by the device that collected them, which is
// the only place that baseline exists today.
//
// It is scored the way hydration is — a signal that leaves the scale when it is
// absent, rather than one that withholds the score. Most members own no such
// device and never will, and that is a permanent, true state rather than a
// failed read; see the long note on readinessScore below, which already had to
// draw this exact line once.
//
// `recentNights` is imported rather than reimplemented: it is the same function
// src/ui/deviceSleep.tsx bounds the device half of the sleep read with, and a
// second run of night keys written here would be a second answer to "which
// nights are recent" for one screen to disagree with itself over. sleepMerge
// imports nothing from this file, so the direction is one-way.
import { recentNights } from './sleepMerge';

export type ReadinessTone = 'good' | 'moderate' | 'low';

/** The signals the score is built from, named so a screen can say which of them
 *  it actually had. */
export type ReadinessSignal = 'sleep' | 'recovery' | 'hydration' | 'load';

export interface Readiness {
  score: number;        // 0..100
  label: string;        // short status
  tip: string;          // one-line guidance
  tone: ReadinessTone;
  /**
   * What the number is made of, in scale order — which is order of WEIGHT:
   * sleep 50, recovery 40, hydration 30, recent sessions 20. Always contains
   * 'sleep' and 'load' — without either there is no score at all — and contains
   * 'recovery' and 'hydration' only when each was actually scored.
   *
   * This exists because the score is the first and largest figure on the home
   * screen, and an 83 built from sleep and training alone and an 83 built from
   * all three are different claims. The member cannot tell them apart from the
   * number, so the number has to be able to say.
   */
  from: ReadinessSignal[];
  /**
   * 'full' when every signal in the scale was scored, 'partial' when one was
   * dropped and the rest rescaled.
   *
   * Deliberately confidence and NOT a deduction. A signal nobody recorded is
   * not a bad reading, so it leaves the scale rather than scoring zero against
   * it — the score keeps its meaning and this field carries the caveat.
   */
  confidence: 'full' | 'partial';
}

export interface ReadinessInput {
  /** Average of recent nights. **null means none logged**, which is not zero. */
  avgSleepHours: number | null;
  /** 0..1 (cups / goal today). null means there is no honest hydration figure —
   *  either the client tracks no water, or today's count could not be read. */
  hydrationPct: number | null;
  /**
   * The connected device's own 0–100 recovery verdict — WHOOP recovery, Oura
   * readiness — or **null when no device published one today**.
   *
   * Null is by far the commonest value and is not a failure: most members own
   * no device that scores recovery, and a device that could not be read lands
   * in the same null deliberately. Both leave the signal out of the scale
   * rather than scoring zero against it, exactly as an untracked hydration does
   * — see the long note on this function about why the two absences that
   * RESCALE differ from the one that withholds.
   *
   * Values outside 0–100 are clamped rather than refused: the field is the
   * vendor's, we do not control it, and a 101 is a rounding artefact rather
   * than a reason to delete somebody's readiness for the day.
   */
  recoveryPct: number | null;
  /**
   * Sessions in the last two days, or **null when the training log could not be
   * read**. Null is not zero, and this channel exists because it used to not:
   * the type was a bare `number`, so every caller with an unreadable log had to
   * pass 0 — which scores as MAXIMALLY RESTED and hands back a tip telling
   * somebody to push. app/(client)/coach.tsx had already noticed and was
   * gating the whole call by hand; app/(client)/dashboard.tsx had not, so the
   * home screen's hero rose when the workout log failed to load.
   */
  workoutsLast2Days: number | null;
}

/**
 * The score, or **null when there is nothing to score from**.
 *
 * Sleep is half the scale. Without it there is no readiness, and the arithmetic
 * that treats its absence as zero produces a specific, wrong, and quite
 * alarming claim: a brand-new account scores 0 sleep + 0 hydration + 20 rest =
 * 20, which is 'Under-recovered', and the home screen tells somebody who has
 * logged nothing at all to take a rest day.
 *
 * That is what it did. The Readiness hero above the card already showed a dash
 * and said "Log a night of sleep to see your readiness" — but the card beside
 * it read the fabricated 20 and asserted a physiological state from it. Two
 * elements, one screen, opposite claims, and only one of them honest.
 *
 * Hydration is different: null there means "not tracked", so the remaining
 * signals are rescaled rather than being docked 30 points for a number nobody
 * asked the user for.
 *
 * ── Why an unknown training load withholds the score and an unknown hydration
 *    figure only shrinks the scale ────────────────────────────────────────────
 *
 * Both are missing inputs and they get opposite treatments, so the difference
 * has to be written down or somebody will make them consistent and reintroduce
 * a bug.
 *
 * Every signal here can only ever count AGAINST the member: sleep short of
 * eight hours, water short of the goal, sessions in the last two days. So
 * dropping any of them from the scale can only make the score go UP. That is
 * fine when it is honest and dangerous when it is not, and the two cases differ
 * in whether "missing" is a fact about the member or a fact about our read.
 *
 *   HYDRATION. `null` here is overwhelmingly "this person tracks no water" —
 *   they never set a goal, and part 70 forbids inventing one. That is a
 *   permanent, true state for a large share of members, and withholding their
 *   score forever because of it would delete the feature for them. Rescaling
 *   puts them on the same footing as everyone else on the signals they do have,
 *   which is exactly what this function already did and why. A hydration read
 *   that FAILED lands in the same null and is treated the same way: it joins a
 *   population that already exists rather than inventing a new claim, and it
 *   beats the alternative the callers used to pass — `water / goal` with water
 *   still at its initial 0, which scored a network blip as a day of drinking
 *   nothing and took thirty points off.
 *
 *   RECOVERY. Identical in shape to hydration and for a stronger reason: a
 *   member with no WHOOP and no Oura has no recovery score and never will, and
 *   they are most of the app. Withholding readiness from everybody without a
 *   strap would delete the feature for the majority in order to be strict about
 *   a minority's missing figure. A device that failed to sync joins the same
 *   null for the same reason hydration's failed read does — it joins a large
 *   population that already exists rather than inventing a new claim — and
 *   readinessBreakdown says in words which of the two happened, because the
 *   member's next action differs.
 *
 *   TRAINING LOAD. There is no equivalent. Every member has a training log, and
 *   `workoutsLast2Days` is never legitimately absent — a null there means one
 *   thing only: the read failed. Dropping it from the scale would raise the
 *   number of anybody who HAS trained hard for the last two days, and the tip
 *   attached to a raised number is "Great day to push". That is a green light
 *   computed from an absence, handed to the exact person it is most wrong for.
 *   So the score is withheld and the screen says it does not know, which is
 *   what app/(client)/coach.tsx had already worked out and was doing by hand.
 */
export function readinessScore(i: ReadinessInput): Readiness | null {
  if (i.avgSleepHours == null || !(i.avgSleepHours > 0)) return null;
  // See the header. An unread log is not a rested member.
  if (i.workoutsLast2Days == null || !Number.isFinite(i.workoutsLast2Days)) return null;

  const sleep = Math.max(0, Math.min(1, i.avgSleepHours / 8)) * 50;             // up to 50
  const rest = Math.max(0, 20 - Math.max(0, i.workoutsLast2Days - 1) * 10); // 0–1 sessions = 20, 2 = 10, 3+ = 0

  // Untracked hydration is not dehydration. Score the signals we have and
  // rescale to 100, rather than capping everyone who ignores the water tracker
  // at 70 and calling them under-recovered for it.
  const pct = i.hydrationPct;
  const tracked = pct != null && Number.isFinite(pct);
  const hydration = tracked ? Math.max(0, Math.min(1, pct as number)) * 30 : 0;

  // The device's verdict, worth 40 — more than hydration and less than sleep.
  //
  // The weight is a judgement and it is written down so it can be argued with:
  // WHOOP and Oura each compute their score from a night of HRV, resting heart
  // rate and sleep against that member's own baseline, which is more physiology
  // than anything else on this scale, and less than sleep only because sleep is
  // the one signal every member can supply. Nothing here re-derives it — a
  // vendor score is taken at face value or not at all.
  const rec = i.recoveryPct;
  const scored = rec != null && Number.isFinite(rec);
  const recovery = scored ? Math.max(0, Math.min(1, (rec as number) / 100)) * 40 : 0;

  const raw = sleep + rest + hydration + recovery;
  // Built up from the signals that were actually in the scale rather than
  // written as a literal, so adding a fifth signal cannot leave a stale
  // denominator behind — a mismatch here does not throw, it silently shifts
  // everybody's number.
  const outOf = 70 + (tracked ? 30 : 0) + (scored ? 40 : 0);
  const score = Math.round((raw / outOf) * 100);

  let tone: ReadinessTone, label: string, tip: string;
  if (score >= 75) {
    tone = 'good'; label = 'Well Recovered';
    tip = 'Great day to push — aim for a PR or add a little load.';
  } else if (score >= 50) {
    tone = 'moderate'; label = 'Moderately Recovered';
    tip = 'Train as planned, but listen to your body and don’t force it.';
  } else {
    tone = 'low'; label = 'Under-recovered';
    tip = 'Prioritise sleep, water and a lighter session or rest today.';
  }
  const from: ReadinessSignal[] = [
    'sleep',
    ...(scored ? ['recovery' as const] : []),
    ...(tracked ? ['hydration' as const] : []),
    'load',
  ];
  // 'full' means every signal in the scale was scored, which now takes a device
  // as well as a water goal — so it is rarer than it was, and that is the field
  // reporting the truth rather than the bar moving. Nothing in the app hides
  // behind it: `readinessMadeOf` is printed under the score on every screen and
  // on every day, precisely so that a member never has to infer completeness
  // from a word they cannot see.
  return { score, label, tip, tone, from, confidence: from.length === 4 ? 'full' : 'partial' };
}

/**
 * What the score is made of, as a sentence to print under it.
 *
 * Sentence case and no trailing full stop, because every caller appends it to a
 * tip that already ends in one. It never names what is MISSING: "no hydration
 * figure" invites the member to read the score as having been marked down for
 * it, and nothing was marked down — the signal simply is not in the scale.
 */
export function readinessMadeOf(r: Readiness): string {
  const words: Record<ReadinessSignal, string> = {
    sleep: 'your sleep',
    // "your device's recovery score" rather than "recovery": the member has to
    // be able to tell this apart from the app's own opinion, which is the whole
    // number it sits inside.
    recovery: 'your device’s recovery score',
    hydration: 'hydration',
    load: 'recent sessions',
  };
  const parts = r.from.map((s) => words[s]);
  const list = parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
    : parts[0];
  return `Scored from ${list}`;
}

// ── Which sleep readiness is allowed to use ────────────────────────────────
//
// The home screen computed readiness from `useWellness().sleep` alone — the
// hand-typed wellness log — and nothing else. Sleep read from a watch or a ring
// went to the Recovery screen and stopped there, so a client with WHOOP
// connected, the sleep scope granted and a full week of nights recorded opened
// the app to "Log a night of sleep to see your readiness." Reported exactly
// that way: "whoop is connected and sleep is also there. its not updating the
// repple app."
//
// A measured night beats a typed one for the same date. Not because somebody
// typing is careless, but because the device recorded when they actually fell
// asleep and the person is recalling it in the morning — and when both exist
// the device is the one with a time behind it.
//
// It does not average a measured night with a typed one, and it does not fill a
// gap with either. A night nobody recorded contributes nothing and shortens the
// window instead, because readiness over a shorter run of real nights is a
// smaller claim, and readiness over an invented one is a wrong claim.
//
// ── The window, which this function did not have ──────────────────────────
//
// "Shortens the window" above was describing a window that existed on one side
// only. `deviceNights` arrives already bounded — src/ui/deviceSleep.tsx builds
// it from `recentNights(DEVICE_SLEEP_NIGHTS, today)` and nothing older can be
// in it. `typed` does not: src/ui/wellness.tsx reads `sleep_logs` with no date
// filter at all, newest first up to the page cap, so it is the member's WHOLE
// history. The two were merged, sorted and sliced to `count`, and the slice is
// a count rather than a date — so the three newest nights on record were taken
// whatever their age.
//
// What that scored. A member whose last logged nights were 30 July to 1 August,
// opening the app on 13 September: three typed nights of eight hours, averaged
// to eight, scored 100 out of 100, labelled 'Well Recovered', with the tip
// "Great day to push". No caveat anywhere — the breakdown's own status was
// 'ready' — and readinessBreakdown printed "8h a night over the last 3 nights"
// about three nights six weeks gone. That sentence is not a rounding error or a
// stale cache; it is a statement about a span of time that did not happen.
//
// ── What an empty window returns, and why it is neither 0 nor 100 ─────────
//
// The window is now `count` night keys ending today, from the same
// `recentNights` that bounds the device half, so the two halves cannot come to
// disagree about which nights exist. Everything outside it is dropped. The
// question that leaves is what to hand back when nothing survives.
//
// Not zero hours. A member with no sleep on record is not a member who slept
// none, and `readinessScore`'s own header is a record of what that arithmetic
// did the last time somebody wrote it: 0 sleep + 0 hydration + 20 rest = 20,
// 'Under-recovered', handed to a brand-new account. Not the old behaviour
// either, which is what 100 was: an average over whatever nights existed
// somewhere in the past, presented as an average over this week.
//
// So `avgHours` is null and there is NO SCORE — `readinessScore` already
// refuses a null average, and that refusal is the honest answer. A readiness
// score computed over no nights is not a smaller readiness score; it is not one
// at all. What is added is `state`, so that the four ways of having no average
// stay four things rather than collapsing into one dash:
//
//   'scored'   at least one night landed inside the window. `nights.length`
//              says how many, and it is never more than `windowNights`.
//   'stale'    nights are on record and every one of them is older than the
//              window. Nothing failed and nothing is missing from our read —
//              the member simply has not logged or synced recently, and the
//              sentence they need says so rather than "log a night of sleep",
//              which reads as a claim that they never have.
//   'none'     nothing is recorded at all, in the window or out of it.
//   'unknown'  the window could not be drawn, because `now` was not a readable
//              instant. Ours, not theirs, and it must not read as 'none' — see
//              the house rule that a failed read is not an empty list.
//
// `windowNights` travels with the answer for the same reason. The breakdown's
// span sentence used to be built from a window number the CALLER passed
// separately, so the sentence and the arithmetic were two copies of one fact
// and could drift; it is now taken from the answer that did the averaging.

export interface ReadinessNight {
  night: string;
  hours: number;
  from: 'device' | 'typed';
}

/**
 * Why there is no average, when there is none — and 'scored' when there is.
 * See the long note above: these are four different things to say to a member
 * and only one of them is "you have not logged a night".
 */
export type ReadinessSleepState = 'scored' | 'stale' | 'none' | 'unknown';

export interface ReadinessSleep {
  /** Mean of the nights inside the window, or **null when none were**. Never
   *  zero: no night on record is not a night of no sleep. */
  avgHours: number | null;
  /** The nights behind it, newest first — so a screen can say how many. Every
   *  one of them is inside the window, so a span named over them is true. */
  nights: ReadinessNight[];
  fromDevice: number;
  fromTyped: number;
  /**
   * How many nights the window spans — the run `nights` was taken from.
   *
   * Carried on the answer rather than looked up again by whoever describes it.
   * "over the last 3 nights" is a claim about THIS average, and a description
   * built from a separately-passed number is a second copy of the fact.
   */
  windowNights: number;
  /** Whether there is an average, and if not, which absence it is. */
  state: ReadinessSleepState;
}

/**
 * The nights readiness may score: those inside the window, newest first.
 *
 * `deviceNights` are merged nights from src/lib/sleepMerge — only `measured`
 * ones carry a figure. `typed` are wellness-log entries, dated by the local day
 * they were logged for, and arriving UNBOUNDED: the whole log, to whatever
 * depth it was read.
 *
 * The window is the `count` night keys ending on `now`'s local day, built by
 * the same `recentNights` that bounds the device half one layer up. Nights are
 * matched by bare day key, as strings — never by parsing one into a Date, which
 * would take UTC midnight and shift the whole window for anybody west of
 * Greenwich.
 *
 * `now` defaults to the clock for the benefit of the one caller
 * (src/ui/readiness.ts), whose memo already re-runs on `useNow()`, so the
 * default is read afresh whenever the day rolls over or the app comes back.
 * Pass it explicitly anywhere the answer must be reproducible.
 */
export function readinessSleep(
  deviceNights: readonly { night: string; outcome: string; minutesAsleep: number | null }[],
  typed: readonly { at: string; hours: number }[],
  count = 3,
  now: Date = new Date(),
): ReadinessSleep {
  const windowNights = Math.max(0, Math.floor(count));
  const ms = now instanceof Date ? now.getTime() : NaN;
  // No readable instant, no window. Emphatically not 'none': that would be a
  // statement about what the member has recorded, made out of our own failure
  // to work out which nights to look at.
  if (!Number.isFinite(ms)) {
    return { avgHours: null, nights: [], fromDevice: 0, fromTyped: 0, windowNights, state: 'unknown' };
  }
  const inWindow = new Set(recentNights(windowNights, now));

  const byNight = new Map<string, ReadinessNight>();

  for (const d of deviceNights) {
    if (d.outcome !== 'measured') continue;
    const m = d.minutesAsleep;
    if (m == null || !Number.isFinite(m) || m <= 0) continue;
    if (!byNight.has(d.night)) byNight.set(d.night, { night: d.night, hours: m / 60, from: 'device' });
  }

  for (const e of typed) {
    const h = Number(e.hours);
    if (!Number.isFinite(h) || h <= 0) continue;
    // The wellness log stores an instant; the night it belongs to is the local
    // day of that instant. Slicing the ISO string would take the UTC day and
    // file a 9pm entry under tomorrow for anybody west of Greenwich.
    const night = localDay(e.at);
    if (!night) continue;
    // Only where no device measured it. A device figure already present is not
    // replaced — see the header.
    if (!byNight.has(night)) byNight.set(night, { night, hours: h, from: 'typed' });
  }

  // Bare day keys against bare day keys. `inWindow` holds YYYY-MM-DD strings
  // built by local-date arithmetic in recentNights, and `n.night` is the same
  // shape from the same kind of arithmetic; neither is parsed back into a Date
  // to be compared, because `new Date('2026-09-04')` is UTC midnight and is the
  // previous day for most of the world.
  const nights = [...byNight.values()]
    .filter((n) => inWindow.has(n.night))
    .sort((a, b) => (a.night < b.night ? 1 : a.night > b.night ? -1 : 0))
    // Belt and braces: the window already holds at most `windowNights` keys, so
    // this can only ever be a no-op. It stays so that a future window built some
    // other way cannot silently lengthen the run the average is taken over.
    .slice(0, windowNights);

  if (!nights.length) {
    // Recorded-but-older is not unrecorded, and the difference is the whole
    // point of this branch — see the header. `byNight` is every night we hold
    // from either source, so its emptiness is the only honest test for "there
    // is nothing at all".
    return {
      avgHours: null, nights: [], fromDevice: 0, fromTyped: 0, windowNights,
      state: byNight.size ? 'stale' : 'none',
    };
  }
  return {
    avgHours: nights.reduce((a, n) => a + n.hours, 0) / nights.length,
    nights,
    fromDevice: nights.filter((n) => n.from === 'device').length,
    fromTyped: nights.filter((n) => n.from === 'typed').length,
    windowNights,
    state: 'scored',
  };
}

/** The local calendar day of an instant, as YYYY-MM-DD, or null if unreadable. */
function localDay(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
