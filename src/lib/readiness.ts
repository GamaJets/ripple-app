// Training readiness — a simple, transparent 0–100 score from the data the app
// already has: recent sleep, hydration, and short-term training load. Higher =
// better recovered. Pure function so it unit-tests and ships over-the-air; when
// HealthKit/wearable HRV lands it can feed in as a fourth signal.
export type ReadinessTone = 'good' | 'moderate' | 'low';

export interface Readiness {
  score: number;        // 0..100
  label: string;        // short status
  tip: string;          // one-line guidance
  tone: ReadinessTone;
}

export interface ReadinessInput {
  /** Average of recent nights. **null means none logged**, which is not zero. */
  avgSleepHours: number | null;
  /** 0..1 (cups / goal today). null means hydration is not being tracked. */
  hydrationPct: number | null;
  workoutsLast2Days: number;  // training load proxy
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
 */
export function readinessScore(i: ReadinessInput): Readiness | null {
  if (i.avgSleepHours == null || !(i.avgSleepHours > 0)) return null;

  const sleep = Math.max(0, Math.min(1, i.avgSleepHours / 8)) * 50;             // up to 50
  const rest = Math.max(0, 20 - Math.max(0, (i.workoutsLast2Days || 0) - 1) * 10); // 0–1 sessions = 20, 2 = 10, 3+ = 0

  // Untracked hydration is not dehydration. Score the signals we have and
  // rescale to 100, rather than capping everyone who ignores the water tracker
  // at 70 and calling them under-recovered for it.
  const pct = i.hydrationPct;
  const tracked = pct != null;
  const hydration = pct != null ? Math.max(0, Math.min(1, pct)) * 30 : 0;
  const raw = sleep + rest + hydration;
  const outOf = tracked ? 100 : 70;
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
  return { score, label, tip, tone };
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

export interface ReadinessNight {
  night: string;
  hours: number;
  from: 'device' | 'typed';
}

export interface ReadinessSleep {
  /** Mean of the nights that were actually recorded, or null when none were. */
  avgHours: number | null;
  /** The nights behind it, newest first — so a screen can say how many. */
  nights: ReadinessNight[];
  fromDevice: number;
  fromTyped: number;
}

/**
 * The nights readiness may score, newest first, at most `count` of them.
 *
 * `deviceNights` are merged nights from src/lib/sleepMerge — only `measured`
 * ones carry a figure. `typed` are wellness-log entries, dated by the local day
 * they were logged for.
 */
export function readinessSleep(
  deviceNights: readonly { night: string; outcome: string; minutesAsleep: number | null }[],
  typed: readonly { at: string; hours: number }[],
  count = 3,
): ReadinessSleep {
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

  const nights = [...byNight.values()]
    .sort((a, b) => (a.night < b.night ? 1 : a.night > b.night ? -1 : 0))
    .slice(0, Math.max(0, count));

  if (!nights.length) return { avgHours: null, nights: [], fromDevice: 0, fromTyped: 0 };
  return {
    avgHours: nights.reduce((a, n) => a + n.hours, 0) / nights.length,
    nights,
    fromDevice: nights.filter((n) => n.from === 'device').length,
    fromTyped: nights.filter((n) => n.from === 'typed').length,
  };
}

/** The local calendar day of an instant, as YYYY-MM-DD, or null if unreadable. */
function localDay(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
