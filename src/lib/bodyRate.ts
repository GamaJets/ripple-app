// How fast a body figure is moving — the number every other app leads with, and
// the one this one has never printed.
//
// ── the gap ────────────────────────────────────────────────────────────────
//
// app/(client)/body-trends.tsx prints, under each metric, the TOTAL change
// since the first reading: "−3.2 kg since 4 May". That is a true sentence and
// it is not the one people act on. InBody's own app, Withings, Renpho and Happy
// Scale all headline a RATE — "−0.6 kg/week", "−1.3 lb/week" — because the
// total confounds two things a member needs kept apart:
//
//   · how much has changed, which grows for ever and is mostly a fact about how
//     long ago they started;
//   · how fast it is changing NOW, which is the only figure that says whether
//     what they are doing this month is working.
//
// A member three months into a cut reads "−6.0 kg since 4 May" for six weeks
// running while the actual weekly loss falls to nothing, and the screen whose
// whole subject is the direction of travel never says the travel stopped. A
// rate is also the figure a coach programmes from: 0.5–1% of bodyweight a week
// is the standard cut, and nothing in this app has ever put a member's own
// number beside it.
//
// ── what a rate may not be ─────────────────────────────────────────────────
//
// It is a claim about a trend, so it needs a trend to be a claim about, and
// this module refuses in three cases rather than dividing something by
// something:
//
//   · fewer than two readings. There is no change to have a rate of.
//   · a window shorter than `MIN_TREND_DAYS`. src/lib/goalTargets.ts already
//     owns that threshold and states the argument: "two weigh-ins a day apart
//     differing by 400 g is water, and extrapolating it produced finish dates
//     that moved by months between launches". The constant is IMPORTED rather
//     than re-declared — a second copy of a threshold is a second thing to
//     disagree with the first.
//   · either end's date unreadable. A span nobody can measure has no rate, and
//     0 is not the answer to that: it would print "holding steady" over a body
//     that may have moved.
//
// ── and what it may not CLAIM ──────────────────────────────────────────────
//
// The precision. This is the half that makes a rate dangerous rather than
// merely useless, and it is why `rateDecimals` is here beside the arithmetic.
//
// A rate is a difference of two readings divided by a number of weeks, so the
// grain of the two readings is divided too. A body weight printed to whole
// pounds carries ±1 lb at each end; over two weeks that is ±0.5 lb/week, and
// printing "−0.87 lb/week" off it states a hundredth that the record cannot
// support — the same defect src/lib/compositionUnit.ts was written against,
// where "0.1 lb under a 0.22 lb grain invents half a step of precision".
//
// So the printed grain is DERIVED from the window rather than fixed: the finest
// power of ten that is still no finer than one endpoint step spread over the
// weeks measured. A fortnight of whole-pound weights prints whole pounds per
// week; three months of them earns a decimal. The rule runs rather than being
// written down as a table, for the same reason `compositionDecimals` derives
// its answer from KG_PER_LB.
//
// Pure: no React, no provider, no clock. The window is measured between the two
// readings themselves, so "today" is not an input and nothing here goes stale.
import { daysBetween } from './bodyFigures';
import { MIN_TREND_DAYS } from './goalTargets';

export { MIN_TREND_DAYS };

/** The minimum a reading list must carry for a rate to be stated at all. */
export const MIN_RATE_POINTS = 2;

/** As little of a reading as the arithmetic needs. `BodyReading` from
 *  src/lib/bodyFigures.ts satisfies it structurally, and so does a bare
 *  `{ t, v }` series point once its caller names the fields. */
export interface RatePoint {
  /** A bare `YYYY-MM-DD` or an ISO instant. Read through `daysBetween`, which
   *  takes both as the LOCAL calendar day — `Date.parse` on a bare date is UTC
   *  midnight and shortens the window by a day for every reader west of
   *  Greenwich, which inflates the rate. */
  at: string;
  value: number;
}

export interface BodyRate {
  /**
   * The change per seven days, SIGNED, in whatever unit the readings were
   * stored in. Never converted here: this module is handed kilograms,
   * percentages, points and litres and has no way to tell them apart, so the
   * conversion stays at the edge where the caller knows which it has.
   */
  perWeek: number;
  /** Whole calendar days between the first and last reading. Always at least
   *  `MIN_TREND_DAYS`, because a shorter window returns null instead. */
  days: number;
  /** The days the rate is measured BETWEEN, so a caller can name them. A rate
   *  with no window stated is a rate measured over a period nobody can check. */
  fromISO: string;
  toISO: string;
  /** How many readings stand behind it. Two ends and nothing between them is
   *  still a rate, and a caller may want to say so. */
  points: number;
}

/**
 * Why there is no rate, in the words a screen needs — or null when there is
 * one.
 *
 * Separate from `bodyRate` because the two answers have different shapes and
 * collapsing them into one return value is how a caller ends up printing
 * "not enough readings" over a rate it actually has.
 */
export type RateGap = 'no-readings' | 'one-reading' | 'too-short' | 'undated';

export interface RateAnswer {
  rate: BodyRate | null;
  gap: RateGap | null;
  /** For 'too-short': the window that was available, so the screen can say how
   *  much longer. Null otherwise — never 0, which would claim a same-day pair. */
  days: number | null;
}

/**
 * The rate across a metric's readings, or the reason there is none.
 *
 * Measured between the FIRST and LAST reading of whatever it is given. It does
 * not fit a line, and that is deliberate: a least-squares slope over a body
 * series is dominated by whichever end happens to be denser — a member who
 * weighed in daily for a fortnight and monthly since would have their fortnight
 * decide the year — and it produces a number nobody can check against the two
 * figures the screen is already showing them. Endpoint-to-endpoint is the same
 * arithmetic `projectionOf` uses in src/lib/goalTargets.ts, so a rate on the
 * body screen and a finish date on the goal screen cannot disagree about how
 * fast somebody is going.
 *
 * The caller decides the window by deciding what it passes in — the last
 * ninety days, the whole history, the readings since a goal was set.
 */
export function rateOf(readings: readonly RatePoint[] | null | undefined): RateAnswer {
  const pts = (readings ?? []).filter(
    (p): p is RatePoint => !!p && typeof p.value === 'number' && Number.isFinite(p.value) && !!p.at,
  );
  if (pts.length === 0) return { rate: null, gap: 'no-readings', days: null };
  if (pts.length < MIN_RATE_POINTS) return { rate: null, gap: 'one-reading', days: null };

  const first = pts[0];
  const last = pts[pts.length - 1];
  const days = daysBetween(first.at, last.at);
  // Null, never 0. An unreadable date at either end is "we cannot say how long
  // this took", and calling that zero days would divide by it.
  if (days == null) return { rate: null, gap: 'undated', days: null };
  // A window running backwards means the caller handed this an unsorted list.
  // Reporting a rate off it would silently invert the sign of everything.
  if (days < 0) return { rate: null, gap: 'undated', days: null };
  if (days < MIN_TREND_DAYS) return { rate: null, gap: 'too-short', days };

  return {
    rate: {
      perWeek: ((last.value - first.value) / days) * 7,
      days,
      fromISO: first.at,
      toISO: last.at,
      points: pts.length,
    },
    gap: null,
    days,
  };
}

/**
 * How many decimal places this rate may honestly be printed to.
 *
 * `step` is the grain of ONE endpoint in the unit it will be printed in — 1 for
 * a body weight in pounds, 0.1 for one in kilograms, 0.1 for a body-fat
 * percentage, 0.01 for a segmental lean mass in kilograms. `days` is the window
 * the rate was measured over.
 *
 * The uncertainty on the rate is about one endpoint step spread over the weeks
 * measured, and the answer is the finest power of ten that is no finer than
 * that. Rounding to the finer place instead would invent up to half a step of
 * precision, which is the rule src/lib/compositionUnit.ts already holds for the
 * same reason.
 *
 * Clamped at both ends: never negative, because rounding a rate to TENS of
 * pounds a week is a loss rather than an honesty gain, and never past `maxDp`,
 * because a two-year window does not earn a thousandth of a kilogram a week off
 * readings taken to a tenth.
 */
export function rateDecimals(step: number, days: number, maxDp = 2): number {
  if (!Number.isFinite(step) || step <= 0 || !Number.isFinite(days) || days <= 0) return 0;
  const weeks = days / 7;
  const grain = step / weeks;
  const dp = Math.floor(-Math.log10(grain));
  return Math.max(0, Math.min(Math.trunc(maxDp), dp));
}

/**
 * What to say when there is no rate, or null where the screen should say
 * nothing at all.
 *
 * 'no-readings' returns null on purpose: a metric with nothing behind it
 * already has its own sentence on every screen that draws one, and adding "no
 * rate yet" under it would be the app apologising twice for one absence.
 */
export function rateGapNote(gap: RateGap | null, days: number | null): string | null {
  if (gap === 'too-short') {
    const left = Math.max(1, MIN_TREND_DAYS - (days ?? 0));
    return `Too close together to call a rate — ${left} more day${left === 1 ? '' : 's'} between readings and this says how fast it is moving.`;
  }
  if (gap === 'one-reading') return 'One reading, so there is no rate yet — a second one starts it.';
  if (gap === 'undated') return 'These readings cannot be dated, so there is no window to measure a rate over.';
  return null;
}
