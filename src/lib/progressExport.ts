// What a progress export is made of, with no React Native in sight.
//
// These functions were written inside src/lib/exportShare.ts, which imports
// react-native for the Share API. The test suite runs under plain node, so
// anything importing that module cannot be asserted against — and the answers
// here are exactly the kind that need asserting: whether a single scan reports
// a change (it must not), whether a missing figure becomes an empty CSV cell
// (it must) and whether a gain is described as a gain.
//
// Split out on the same reasoning as ics.ts. exportShare re-exports everything
// below, so every existing call site is untouched.

import { toCsv, isoDatePart } from './gymExport';
import { localDate } from './localDate';

export interface ProgressRow {
  /**
   * The scan's own calendar day as `YYYY-MM-DD`.
   *
   * Deliberately not a pre-formatted locale string, which is what used to
   * arrive here. A CSV column of `03/04/2026` is unreadable by the importing
   * app and ambiguous to the coach opening it in another country; ISO is
   * neither. Display formatting happens at the point of display instead.
   */
  date: string;
  /**
   * `null` means this scan did not record the figure. Never 0: nobody has ever
   * weighed nothing, carried no muscle, or had a body fat of zero, so a 0 here
   * would be an invented reading rather than a missing one — and it would land
   * in a coach's spreadsheet looking exactly like a measurement.
   */
  weightKg: number | null;
  bodyFatPct: number | null;
  muscleKg: number | null;
}

export type ProgressMetric = 'weightKg' | 'bodyFatPct' | 'muscleKg';

/** Label and unit per metric, in the order they are shown everywhere below. */
const PROGRESS_METRICS: [ProgressMetric, string, string][] = [
  ['weightKg', 'Weight', ' kg'],
  ['bodyFatPct', 'Body fat', '%'],
  ['muscleKg', 'Muscle', ' kg'],
];

/** A figure for display, or an em-dash where there is no reading. */
export const figure = (v: number | null | undefined, unit = ''): string =>
  v == null || !Number.isFinite(v) ? '—' : `${v}${unit}`;

/** A date-only value as the reader's own day, never shifted by their timezone. */
export const dayLabel = (iso: string): string => localDate(iso)?.toLocaleDateString() ?? iso;

/**
 * The first and last readings of one metric, and the change between them.
 *
 * Computed per metric rather than per row because the rows are not uniform: a
 * client whose gym scale reports weight every week but skeletal muscle only on
 * the InBody has two series of different lengths, and the change in muscle has
 * to be measured between the two scans that actually recorded muscle. Fewer
 * than two readings is not a change, and returns null rather than a zero —
 * "0.0 kg" and "we cannot say yet" are opposite claims.
 */
export function progressChange(
  rows: ProgressRow[],
  key: ProgressMetric,
): { from: number; to: number; change: number; fromDate: string; toDate: string } | null {
  const seen = rows.filter((r) => r[key] != null && Number.isFinite(r[key] as number));
  if (seen.length < 2) return null;
  const a = seen[0], b = seen[seen.length - 1];
  const from = a[key] as number, to = b[key] as number;
  return { from, to, change: Math.round((to - from) * 10) / 10, fromDate: a.date, toDate: b.date };
}

/**
 * One line per metric that has two readings to compare — nothing for the rest.
 *
 * The direction is taken from the sign rather than assumed: a client who has
 * gained weight on purpose is not "down 3 kg", and the same screen has been
 * fixed for that before (see app/(client)/social.tsx).
 */
export function progressChangeLines(rows: ProgressRow[]): string[] {
  return PROGRESS_METRICS.flatMap(([key, label, unit]) => {
    const c = progressChange(rows, key);
    if (!c) return [];
    const sign = c.change >= 0 ? '+' : '−';
    return [`${label} ${c.from}${unit} → ${c.to}${unit} (${sign}${Math.abs(c.change)}${unit})`];
  });
}

/**
 * What the client is about to send, in one line — "6 scans, 12/02/2026 to
 * 24/08/2026". Shown before the share sheet opens, because half of TF-21 is
 * knowing the size and span of the thing, not just its file format.
 */
export function progressSpanLabel(rows: ProgressRow[]): string {
  if (!rows.length) return 'No scans yet';
  const count = `${rows.length} scan${rows.length === 1 ? '' : 's'}`;
  const a = dayLabel(rows[0].date), b = dayLabel(rows[rows.length - 1].date);
  return a === b ? `${count} from ${a}` : `${count}, ${a} to ${b}`;
}

/**
 * The share-sheet message.
 *
 * Long enough to be worth receiving: a coach who opens it in WhatsApp should
 * be able to see the change without asking for a file, and a story posted from
 * it should say something. A bare app link would satisfy neither, which is
 * what TF-25 was complaining about.
 *
 * With fewer than two scans there is no change to report, so it states the
 * latest reading instead of dressing a single scan up as progress.
 */
export function progressSummary(name: string, rows: ProgressRow[], brand = 'Repple'): string {
  const first = (name || '').split(' ')[0] || 'My';
  const head = `${first === 'My' ? 'My' : first + "'s"} progress — ${brand}`;
  if (!rows.length) return `${head}\nNo scans recorded yet.`;

  const lines = progressChangeLines(rows);
  if (lines.length) return [head, progressSpanLabel(rows), '', ...lines].join('\n');

  const last = rows[rows.length - 1];
  const latest = PROGRESS_METRICS
    .filter(([key]) => last[key] != null)
    .map(([key, label, unit]) => `${label} ${figure(last[key], unit)}`);
  return [head, `Latest scan ${dayLabel(last.date)}`, ...(latest.length ? ['', latest.join(' · ')] : [])].join('\n');
}

/**
 * The importable half of the product owner's "both".
 *
 * Column names are snake_case and unit-suffixed so the receiving app needs no
 * legend: `weight_kg` cannot be mistaken for pounds the way `weight` can. One
 * row per scan, oldest first, in the order the caller supplied. Figures go out
 * as bare numbers — no unit inside the cell, no thousands separator, no
 * percent sign — because a spreadsheet that has to strip characters before it
 * can add up a column is not importable, it is just a table in a text file.
 */
export const PROGRESS_CSV_HEADER = ['date', 'weight_kg', 'body_fat_pct', 'skeletal_muscle_kg'];

export function progressCsv(rows: ProgressRow[]): string {
  return toCsv(
    PROGRESS_CSV_HEADER,
    // isoDatePart rather than a slice: a date it does not recognise comes back
    // empty instead of being guessed at, which is the same rule the figures
    // follow one column over.
    rows.map((r) => [isoDatePart(r.date), r.weightKg, r.bodyFatPct, r.muscleKg]),
  );
}
