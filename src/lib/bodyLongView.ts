// The long view of the BODY.
//
// ── What was wrong ─────────────────────────────────────────────────────────
//
// src/lib/longView.ts opens with the observation that every progress screen in
// this app is a slice or a snapshot, and that a member who has trained for a
// year cannot see that year. It then fixes it — for training. Months of
// tonnage, a lifetime total, a timeline of personal bests, an arc from the
// first month to the last.
//
// The body side never got the same treatment. Progress shows the latest scan
// and the one before it. Body Trends draws a short window. Compare puts two
// photographs side by side with the readings from those two days. All of them
// are answers about NOW, or about now against one other moment the member had
// to pick. Nobody has ever been able to open this app and see the shape of
// their own year — which is the question that keeps a person going, and it is
// the one the body side is asked more often than the training side.
//
// ── Why this is not longView.ts with a different field ────────────────────
//
// A month of training is a SUM. Tonnage adds up, sessions add up, an empty
// month genuinely contains no work. A month of body readings is a STATE: you
// do not add January's weight to February's, and a month with three scans in it
// is not three times the body of a month with one.
//
// So a month here is its CLOSING reading — the last scan taken in it. Not the
// mean: a member who weighs in on the morning of the 1st and again after a
// holiday on the 30th has a mean that describes neither day, and every monthly
// figure would shift retroactively the moment they stepped on the scale again.
// The last reading of a month is a measurement that was actually taken, on a
// day that can be named, which is the standard the rest of this codebase holds.
//
// ── And the rules it inherits ─────────────────────────────────────────────
//
// 1. A MONTH WITH NO SCAN IS NOT A MONTH AT ZERO. Every figure is nullable and
//    an unmeasured month carries null in all of them. Writing 0 would say "in
//    March you weighed nothing"; writing February's figure forward would say
//    "in March you weighed what you weighed in February", which is a reading
//    nobody took. Both are inventions. <Spark> draws a null as a GAP, which is
//    what an unmeasured month is.
//
// 2. A SHORT HISTORY IS NOT A FAILED LONG ONE. The window starts at the first
//    scan, never earlier, so somebody two scans in sees two months rather than
//    ten holes and a picture of failure. `stageOf` in ./longView.ts already
//    makes that judgement and is reused rather than re-decided here, so the
//    body page and the training page cannot disagree about when a history is
//    long enough to draw.
//
// 3. KILOGRAMS ALL THE WAY THROUGH. Nothing here converts. A value converts
//    point by point and a CHANGE converts as a change (see ./units.ts), and a
//    module that did its arithmetic in pounds would hand a chart a different
//    shape for a pounds reader. The edge converts; this does not.
import type { ScanReading } from './photoCompare';
// The month arithmetic the training long view already owns. Imported rather
// than re-implemented: two modules deciding separately what the local month of
// an evening scan is, is how the body page and the training page come to
// disagree about which September a reading belongs to.
import { monthKey, monthLabel, monthLabels, nextMonth, monthsBetween, stageOf, MAX_MONTHS, type Span, type Stage } from './longView';

/** The three readings a scan carries, and the only three this view charts. */
export type BodyMetric = 'weightKg' | 'bodyFatPct' | 'muscleKg';

/**
 * One calendar month of body readings.
 *
 * `measured` is the flag that separates "no scan that month" from a scan whose
 * muscle figure was absent — a bathroom scale reports weight and body fat and
 * no muscle at all, and `muscleKg: null` on a measured month is that scale,
 * not a missing month.
 */
export interface BodyMonthCell {
  /** 'YYYY-MM'. */
  key: string;
  year: number;
  /** 0–11. */
  month: number;
  /** 'Mar' — the label a month axis carries, in the reader's own language. */
  label: string;
  /** At least one scan was taken in this month. */
  measured: boolean;
  /** How many scans were taken in it. Null on an unmeasured month, never 0 —
   *  the count of a thing that did not happen is not a measurement of it. */
  scans: number | null;
  /** The ISO date of the reading these figures come from — the LAST scan of
   *  the month. Null when there was none. */
  at: string | null;
  /** Kilograms. Null on an unmeasured month. */
  weightKg: number | null;
  /** Per cent. Null on an unmeasured month. */
  bodyFatPct: number | null;
  /** Kilograms, and null on a MEASURED month too when the device did not
   *  report it. See the note on `measured`. */
  muscleKg: number | null;
}

function ymOf(key: string): { year: number; month: number } {
  const [y, m] = key.split('-');
  return { year: Number(y), month: Number(m) - 1 };
}

function blank(key: string): BodyMonthCell {
  const { year, month } = ymOf(key);
  return {
    key, year, month, label: monthLabels()[month] ?? key,
    measured: false, scans: null, at: null,
    weightKg: null, bodyFatPct: null, muscleKg: null,
  };
}

/** A finite, positive reading, or null. A scan row has been through PostgREST
 *  and a JSON round trip; `0` weight and `NaN` body fat have both reached
 *  screens in this codebase and been charted as measurements. */
function reading(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * The member's body, month by month, oldest first.
 *
 * The window opens at the month of their FIRST scan and runs to this month —
 * including the months since they last stepped on anything, which for somebody
 * who has stopped measuring is the most informative part of the page.
 *
 * Capped to the most recent `maxMonths`. Compare `bodySpan().months` against
 * the length to tell the member that earlier months exist rather than silently
 * cropping their history.
 */
export function bodyMonthlyHistory(
  scans: readonly ScanReading[],
  now: number = Date.now(),
  maxMonths: number = MAX_MONTHS,
): BodyMonthCell[] {
  const byMonth = new Map<string, ScanReading[]>();
  let first: string | null = null, last: string | null = null;
  for (const s of scans) {
    if (!s || typeof s.takenAt !== 'string') continue;
    const k = monthKey(s.takenAt);
    if (!k) continue;
    const bucket = byMonth.get(k);
    if (bucket) bucket.push(s); else byMonth.set(k, [s]);
    // Month keys are 'YYYY-MM' and are compared as STRINGS. A bare calendar
    // key parsed back into a Date to be compared is the defect check:utc-day
    // exists for, and it would move a 31 December reading into the next year.
    if (first == null || k < first) first = k;
    if (last == null || k > last) last = k;
  }
  if (first == null || last == null) return [];

  const nowKey = monthKey(new Date(now).toISOString()) ?? last;
  const end = nowKey > last ? nowKey : last;

  const cells: BodyMonthCell[] = [];
  for (let k = first; ; k = nextMonth(k)) {
    cells.push(cellFrom(k, byMonth.get(k) ?? []));
    if (k === end) break;
    // A clock skewed decades forward must not spin here — the same stop
    // ./longView.ts keeps, for the same reason.
    if (cells.length > 1200) break;
  }
  return cells.length > maxMonths ? cells.slice(cells.length - maxMonths) : cells;
}

function cellFrom(key: string, scans: ScanReading[]): BodyMonthCell {
  const cell = blank(key);
  if (!scans.length) return cell;
  // The month's CLOSING reading. Sorted rather than assumed: the provider
  // appends a manually typed figure after the scans it read, so "the last one
  // in the array" is an ordering nobody promised.
  let latest: ScanReading | null = null;
  for (const s of scans) {
    const ts = Date.parse(s.takenAt);
    if (!Number.isFinite(ts)) continue;
    if (latest == null || ts >= Date.parse(latest.takenAt)) latest = s;
  }
  if (latest == null) return cell;
  return {
    ...cell,
    measured: true,
    scans: scans.length,
    at: latest.takenAt,
    weightKg: reading(latest.weightKg),
    bodyFatPct: reading(latest.bodyFatPct),
    muscleKg: reading(latest.skeletalMuscleKg),
  };
}

/** The figure this metric holds in this month, or null. One place, so a chart
 *  and the numbers printed beside it cannot read two different fields. */
export function metricOf(cell: BodyMonthCell, metric: BodyMetric): number | null {
  return metric === 'weightKg' ? cell.weightKg
    : metric === 'bodyFatPct' ? cell.bodyFatPct
    : cell.muscleKg;
}

/** The months that actually carry a figure for this metric. Not the measured
 *  months: a scale reports no muscle, so a muscle chart over "every month with
 *  a scan in it" would be mostly holes with no explanation. */
export function measuredMonths(cells: readonly BodyMonthCell[], metric: BodyMetric): BodyMonthCell[] {
  return cells.filter((c) => metricOf(c, metric) != null);
}

/**
 * Then against now, for one metric.
 *
 * Null unless the metric has a figure in two different months. One reading is a
 * data point and not an arc, and "down 4 kg" off a single scan is a sentence
 * about nothing — the same rule `volumeArc` keeps on the training side.
 *
 * `delta` is in the metric's own stored unit: kilograms for the two masses,
 * per cent for body fat. The edge converts it as a CHANGE — see ./units.ts,
 * where subtracting two separately rounded ends is the bug that exists to be
 * avoided.
 */
export interface BodyArc {
  metric: BodyMetric;
  fromKey: string;
  toKey: string;
  /** ISO of the reading each end came from, so a screen can date them. */
  fromAt: string;
  toAt: string;
  from: number;
  to: number;
  delta: number;
  /** Calendar months from the first to the last, inclusive of both. */
  months: number;
}

export function bodyArc(cells: readonly BodyMonthCell[], metric: BodyMetric): BodyArc | null {
  const have = measuredMonths(cells, metric);
  if (have.length < 2) return null;
  const a = have[0], b = have[have.length - 1];
  const from = metricOf(a, metric)!, to = metricOf(b, metric)!;
  return {
    metric,
    fromKey: a.key, toKey: b.key,
    fromAt: a.at ?? '', toAt: b.at ?? '',
    from, to, delta: to - from,
    months: monthsBetween(a.key, b.key),
  };
}

/**
 * How long this person has been measuring.
 *
 * The same `Span` the training side uses, so `stageOf` can judge both and the
 * two pages cannot disagree about when a history is long enough to draw.
 */
export function bodySpan(scans: readonly ScanReading[], now: number = Date.now()): Span | null {
  let firstT = Infinity, lastT = -Infinity;
  let firstAt = '', lastAt = '';
  for (const s of scans) {
    if (!s || typeof s.takenAt !== 'string') continue;
    const ts = Date.parse(s.takenAt);
    if (!Number.isFinite(ts)) continue;
    if (ts < firstT) { firstT = ts; firstAt = s.takenAt; }
    if (ts > lastT) { lastT = ts; lastAt = s.takenAt; }
  }
  if (!firstAt) return null;
  // Local midnights, so the count is of calendar days and not of 24-hour
  // blocks — a scan at 11pm yesterday makes today day two.
  const startOfDay = (ts: number) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const from = startOfDay(firstT);
  const to = startOfDay(Math.max(now, lastT));
  const days = Math.max(1, Math.round((to - from) / 86_400_000) + 1);
  const firstKey = monthKey(firstAt);
  const nowKey = monthKey(new Date(Math.max(now, lastT)).toISOString());
  return {
    firstAt, lastAt, days,
    months: firstKey && nowKey ? Math.max(1, monthsBetween(firstKey, nowKey)) : 1,
  };
}

/** How much body history there is to look at, on the training side's own
 *  scale. Re-exported so a screen needs one import and one vocabulary. */
export function bodyStage(scans: readonly ScanReading[], now: number = Date.now()): Stage {
  return stageOf(bodySpan(scans, now));
}

/**
 * Whole months since the last scan, or null when nothing has ever been
 * measured.
 *
 * The open-ended silence at the end of the series. It is deliberately not
 * called a "gap": a gap is a break somebody came back from, and this one has
 * no end yet — putting a length on it would be closing a story that is still
 * running.
 */
export function monthsSinceMeasured(cells: readonly BodyMonthCell[]): number | null {
  let lastIdx = -1;
  for (let i = 0; i < cells.length; i++) if (cells[i].measured) lastIdx = i;
  if (lastIdx < 0) return null;
  return cells.length - 1 - lastIdx;
}

/**
 * One honest line about the size of the body history.
 *
 * Never claims a year that is not there, and never scolds somebody for being
 * new to it. Each branch states only what has been counted: months with a
 * reading in them, and the month the first one was taken.
 */
export function bodyHistoryNote(scans: readonly ScanReading[], now: number = Date.now()): string {
  const span = bodySpan(scans, now);
  if (!span) return 'Your body history starts with your first weigh-in.';
  const cells = bodyMonthlyHistory(scans, now);
  const months = cells.filter((c) => c.measured).length;
  if (stageOf(span) === 'starting') {
    return `Day ${span.days} — this is the start of your body history, and it fills out as the months go by.`;
  }
  const firstKey = monthKey(span.firstAt);
  const back = firstKey ? monthLabel(firstKey) : 'your first weigh-in';
  return `${months} month${months === 1 ? '' : 's'} with a reading, back to ${back}.`;
}
