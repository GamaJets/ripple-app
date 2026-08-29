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
// TF-37 reached every screen and stopped at the door. The documents built here
// are the ones a client SENDS — to a coach, to a spreadsheet, to a story — and
// they were emitting kilograms to a client who reads pounds, which is the one
// audience least able to check. The unit arrives as an argument rather than
// from a provider because everything in this module is pure and has to stay
// that way: it is the half of the export the node suite can actually assert on.
import { weightIn, weightDeltaIn, type WeightUnit } from './units';

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

/**
 * Label, printed suffix and whether the figure is a MASS, per metric, in the
 * order they are shown everywhere below.
 *
 * The `mass` flag is the whole point of the table. Weight and skeletal muscle
 * are kilograms and convert; body fat is a proportion of a body, which is the
 * same proportion however that body is weighed, and putting it through a
 * weight conversion would turn 24.1% into 53.1% — a figure that looks like a
 * measurement and is arithmetic nonsense. Anything added here that is not a
 * mass gets `false`.
 */
interface MetricSpec { key: ProgressMetric; label: string; suffix: string; mass: boolean }

const progressMetrics = (unit: WeightUnit): MetricSpec[] => [
  { key: 'weightKg', label: 'Weight', suffix: ` ${unit}`, mass: true },
  { key: 'bodyFatPct', label: 'Body fat', suffix: '%', mass: false },
  { key: 'muscleKg', label: 'Muscle', suffix: ` ${unit}`, mass: true },
];

/**
 * A stored figure as this document should print it.
 *
 * The non-null assertions are not a shortcut past the missing-reading rule:
 * every caller below has already established that the value is a finite
 * reading (`progressChange` filters for it, and the summary's latest-scan
 * branch tests for null first), so `weightIn` cannot answer null here. Where a
 * reading may genuinely be absent — the document table, the CSV — the nullable
 * result is passed straight through to `figure()` and becomes a dash.
 */
const readingShown = (v: number, spec: MetricSpec, unit: WeightUnit): number =>
  spec.mass ? weightIn(v, unit)! : v;

/** A stored CHANGE as this document should print it: converted as one span. */
const changeShown = (v: number, spec: MetricSpec, unit: WeightUnit): number =>
  spec.mass ? weightDeltaIn(v, unit)! : v;

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
export function progressChangeLines(rows: ProgressRow[], unit: WeightUnit = 'kg'): string[] {
  return progressMetrics(unit).flatMap((spec) => {
    const c = progressChange(rows, spec.key);
    if (!c) return [];
    const from = readingShown(c.from, spec, unit), to = readingShown(c.to, spec, unit);
    const change = changeShown(c.change, spec, unit);
    // The sign belongs to the figure printed beside it, not to the stored one.
    // A 0.2 kg loss is −0.44 lb, which is no whole pounds at all: "(−0 lb)"
    // would be a direction attached to nothing, and "(+0 lb)" is not a thing
    // anybody writes. A converted zero gets no sign and says what it is.
    const sign = change > 0 ? '+' : change < 0 ? '−' : '';
    return [`${spec.label} ${from}${spec.suffix} → ${to}${spec.suffix} (${sign}${Math.abs(change)}${spec.suffix})`];
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
export function progressSummary(name: string, rows: ProgressRow[], brand = 'Repple', unit: WeightUnit = 'kg'): string {
  const first = (name || '').split(' ')[0] || 'My';
  const head = `${first === 'My' ? 'My' : first + "'s"} progress — ${brand}`;
  if (!rows.length) return `${head}\nNo scans recorded yet.`;

  const lines = progressChangeLines(rows, unit);
  if (lines.length) return [head, progressSpanLabel(rows), '', ...lines].join('\n');

  const last = rows[rows.length - 1];
  const latest = progressMetrics(unit)
    // Finite, not merely non-null. `figure()` used to be the thing that caught
    // a NaN reading here; now that the value is converted on the way past, the
    // check has to happen before the conversion rather than after it.
    .filter((spec) => Number.isFinite(last[spec.key] as number))
    .map((spec) => `${spec.label} ${figure(readingShown(last[spec.key] as number, spec, unit), spec.suffix)}`);
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
 *
 * ── This file stays METRIC, and that is a decision, not an omission ────────
 *
 * TF-37 converted every screen, and the report and the summary below it now
 * convert too, because a person reading a sentence about their own body should
 * read it in their own unit. This one does not, and the split is on purpose:
 * the other two are read by a human, this one is parsed by a machine.
 *
 * The alternative was honest enough — convert the cells and rename the header
 * to `weight_lb` — and it was rejected for what it does to the file as a
 * format. A header that changes with a per-client setting is a schema that
 * changes with a per-client setting: two clients' exports of the same coach's
 * roster stop stacking into one sheet, a column formula written against last
 * month's file silently means something different this month, and an importer
 * that has been reading `weight_kg` for a year starts finding nothing without
 * failing. None of that is visible to the person who tapped Share, and all of
 * it is invisible to whoever opens the file next.
 *
 * What must never happen is the third option — pounds in the cells under a
 * header that still says `weight_kg`. A stated unit that is wrong is worse
 * than either honest answer, because nothing downstream has any way to catch
 * it. So the header keeps naming the unit the cells are actually in, the cells
 * stay in the unit the record is stored in, and the share sheet in
 * app/(client)/scans.tsx tells a pounds reader that the spreadsheet is in
 * kilograms BEFORE they send it, rather than leaving them to notice.
 */
export const PROGRESS_CSV_HEADER = ['date', 'weight_kg', 'body_fat_pct', 'skeletal_muscle_kg'];

/** Deliberately takes no unit — see the header constant above for why. */
export function progressCsv(rows: ProgressRow[]): string {
  return toCsv(
    PROGRESS_CSV_HEADER,
    // isoDatePart rather than a slice: a date it does not recognise comes back
    // empty instead of being guessed at, which is the same rule the figures
    // follow one column over.
    rows.map((r) => [isoDatePart(r.date), r.weightKg, r.bodyFatPct, r.muscleKg]),
  );
}
