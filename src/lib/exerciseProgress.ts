// One movement's progress line, by metric and by time range.
//
// app/(client)/exercise.tsx drew a single line — each day's estimated 1RM over
// the whole log. A lifter asks three questions of a movement (how heavy, how
// strong, how much work) over a window they choose, so this picks the metric
// and the window and hands Spark a series. Pure, kilograms in, the member's
// unit applied by the caller through `conv`, so the arithmetic is testable.
//
// Figures come from `exerciseOutings` (src/lib/exerciseHistory.ts), which
// already folds every day's sets through the app's one Epley — nothing here
// recomputes a 1RM.

export type ProgressMetric = 'best' | 'e1rm' | 'volume';
export type ProgressRange = '1m' | '3m' | '6m' | '1y' | 'all';

export const PROGRESS_RANGES: readonly { key: ProgressRange; label: string; a11y: string; days: number | null }[] = [
  { key: '1m', label: '1M', a11y: 'Last month', days: 31 },
  { key: '3m', label: '3M', a11y: 'Last 3 months', days: 92 },
  { key: '6m', label: '6M', a11y: 'Last 6 months', days: 183 },
  { key: '1y', label: '1Y', a11y: 'Last year', days: 366 },
  { key: 'all', label: 'All', a11y: 'All time', days: null },
];

export interface ProgressOuting {
  day: string | null;
  topLoadKg: number | null;
  best1RMKg: number | null;
  volumeKg: number | null;
}

export interface ProgressSeries {
  data: (number | null)[];
  labels: string[];
  /** Days that carry a figure for this metric — ChartShell's two-point rule. */
  points: number;
  /** Highest value in the window, in the caller's unit; null when none. */
  peak: number | null;
  /** Last value minus first value in the window; null with under two points. */
  change: number | null;
}

/** `YYYY-MM-DD` of `today` minus `days`, in local calendar terms. */
export function rangeStart(today: Date, range: ProgressRange): string | null {
  const r = PROGRESS_RANGES.find((x) => x.key === range);
  if (!r || r.days == null) return null;
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - r.days);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Outings may come in any order; the series is oldest first. Undated outings
 * are dropped (a point needs a place on the axis). A day without a figure for
 * the metric stays null so the line gaps rather than dipping to zero.
 */
export function progressSeries(
  outings: readonly ProgressOuting[],
  metric: ProgressMetric,
  range: ProgressRange,
  today: Date,
  conv: (kg: number) => number = (kg) => kg,
): ProgressSeries {
  const from = rangeStart(today, range);
  const days = outings
    .filter((o): o is ProgressOuting & { day: string } => o.day != null && (from == null || o.day >= from))
    .slice()
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const pick = (o: ProgressOuting) => (metric === 'best' ? o.topLoadKg : metric === 'e1rm' ? o.best1RMKg : o.volumeKg);
  const data = days.map((o) => {
    const kg = pick(o);
    return kg == null || !Number.isFinite(kg) ? null : Math.round(conv(kg) * 10) / 10;
  });
  const present = data.filter((v): v is number => v != null);
  return {
    data,
    labels: days.map((o) => o.day),
    points: present.length,
    peak: present.length ? Math.max(...present) : null,
    change: present.length >= 2 ? Math.round((present[present.length - 1] - present[0]) * 10) / 10 : null,
  };
}
