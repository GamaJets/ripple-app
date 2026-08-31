// What a chart is allowed to say about WHEN.
//
// Every line in the three apps was shape only. A member could see weight had
// gone down and had no way to read off when; an owner could see sessions climb
// and could not say from which month. Reported twice, from two screens: "points
// on the graph have a numerical value to use to see how much of a change has
// happened" and "should be able to tap on any given chart and see the numerical
// value and the date associated with the value".
//
// The drawing lives in src/ui/kit.tsx. What is here is the part that has to be
// RIGHT rather than merely pretty, so that `npm test` can hold it: which points
// can be drawn, where they sit on the time axis, which of them carry a written
// label, and — the whole reason this file exists — what a label says when the
// date behind it cannot be read.
//
// ── The rule that outranks the feature ─────────────────────────────────────
//
// **A label never invents a date.** Not today's, not an interpolated one, not
// the one either side of it. A point whose timestamp cannot be read is labelled
// with an em dash and nothing else.
//
// This is the same rule src/lib/format.ts states for figures ("Anything that is
// not a number renders as a dash — never as 0, and never as NaN") and the same
// one src/ui/loadStatus.ts states for reads. It keeps having to be restated
// because the wrong version is always the tidier code: `new Date(x)` returns
// something for almost any input, and the something it returns for garbage is
// either Invalid Date rendered as "NaN Jan" or, worse, a real-looking day that
// is off by one. Both read to a member as a fact about their own history.
//
// ── The second rule: a gap is not a zero ───────────────────────────────────
//
// src/lib/monthlyHistory.ts goes to considerable trouble to produce `null` for
// a month nobody recorded, and says so in capitals: THE NULL IS THE POINT. Then
// three screens drew it with
//
//     <Spark data={series.filter((v): v is number => v != null)} />
//
// which throws that away at the last possible moment. Two things went wrong at
// once, and the second is the bad one:
//
//   1. the line closed over the gap, so a business with no February looked like
//      a business that traded steadily through February;
//   2. the label row underneath still rendered all six month slots evenly
//      spaced. With [null,null,10,12,14,16] the line drew four points across
//      the full width while the labels printed six. **Every point sat above the
//      wrong month.** The chart was not missing its dates, it was asserting
//      dates that were wrong — which is worse, because it is believable.
//
// So position is by ORIGINAL INDEX here, always. A gap keeps its slot and the
// line is broken across it, and the label under a point is the label OF that
// point because both are computed from the same index.
//
// ── Timezones ──────────────────────────────────────────────────────────────
//
// The formatter this replaced did `new Date(raw)` on whatever it was handed.
// For the 'YYYY-MM' month keys this codebase passes around constantly that is
// parsed as UTC midnight, and read back through a local getter it becomes the
// previous month west of Greenwich:
//
//     TZ=America/Los_Angeles  new Date('2026-08').getMonth()   // 6 — July
//     TZ=Asia/Dubai           new Date('2026-08').getMonth()   // 7 — August
//
// That is exactly the trap src/lib/localDate.ts was written for, arriving in a
// chart axis instead of a membership date: invisible to the author in UTC+4,
// permanently wrong for a customer in the Americas. Month keys and bare dates
// are therefore read digit by digit and built locally, never parsed. `npm run
// test:zones` runs this suite under three zones because of these lines.
import { fmtAxisDay, fmtAxisMonth, fmtPointDay, fmtPointMonth } from './format';

/** What an unknown date looks like. The em dash, matching format.ts's `num`. */
export const DASH = '—';

/** A series that may have holes. A hole means "nobody recorded this", never 0. */
export type Series = (number | null | undefined)[];

/** A drawable point. `i` is its index in the ORIGINAL series — that is what
 *  puts it at the right place on the time axis and under the right label. */
export interface PlotPoint { i: number; v: number }

/* ── reading a date ───────────────────────────────────────────────────────── */

/**
 * A label's date, as year / month index / day — or null when there isn't one.
 *
 * Strict on purpose. `dateParts` in localDate.ts accepts '2026-13-99' because
 * its regex only counts digits, and `new Date(2026, 12, 99)` happily rolls that
 * forward into April 2027 rather than failing. A chart that renders April 2027
 * for a corrupt row is the invented-date bug wearing its most convincing
 * disguise, so the parts are round-tripped through a Date and checked to still
 * be themselves.
 *
 * `day` is null for a month-precision key ('2026-08'), which is a real thing to
 * plot — the owner charts are monthly — and is not the same as an unreadable
 * one.
 */
export function readDate(raw: string | null | undefined): { y: number; m: number; day: number | null } | null {
  if (raw == null) return null;
  const s = String(raw).trim();

  // A BARE date and a TIMESTAMP mean different things and are read differently
  // — the distinction localDate.ts sets out at length. A bare 'YYYY-MM-DD' is a
  // calendar day in the reader's own life, so its digits are read off the
  // string and never parsed; parsing resolves it to UTC midnight and it comes
  // back as the day before west of Greenwich. A timestamp is an INSTANT, so it
  // is parsed and read through local getters — a workout finished at 9pm in
  // Auckland belongs to the Auckland day it was done on, not to UTC's.
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (bare) {
    const y = Number(bare[1]), m = Number(bare[2]) - 1, day = Number(bare[3]);
    const d = new Date(y, m, day);
    if (d.getFullYear() !== y || d.getMonth() !== m || d.getDate() !== day) return null;
    return { y, m, day };
  }

  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) {
    const ms = Date.parse(s);
    if (!Number.isFinite(ms)) return null;
    const d = new Date(ms);
    return { y: d.getFullYear(), m: d.getMonth(), day: d.getDate() };
  }

  const month = /^(\d{4})-(\d{2})$/.exec(s);
  if (month) {
    const y = Number(month[1]), m = Number(month[2]) - 1;
    if (m < 0 || m > 11) return null;
    return { y, m, day: null };
  }

  return null;
}

/**
 * True when a label is CLAIMING to be a machine date.
 *
 * Callers pass two different kinds of thing in the same array and both are
 * legitimate. useMrrHistory hands over words it has already formatted — 'Mar',
 * 'Apr' — and trends.tsx hands over 'w/c 12/8'. Those are labels, and a label
 * is printed as written; it is not this file's business to reformat somebody
 * else's prose. An ISO-shaped string, on the other hand, is raw data that this
 * file must read, and if it cannot read it the answer is a dash.
 *
 * Distinguishing the two by shape rather than by trying to parse everything is
 * what stops 'w/c 12/8' becoming a dash and stops '2026-99-99' becoming a date.
 */
export const looksIso = (raw: string | null | undefined): boolean =>
  raw != null && /^\d{4}-\d{2}/.test(String(raw).trim());

/**
 * The short form, for the axis under the line: "14 Aug", "Aug 26".
 *
 * An empty or missing label is a dash and not an empty string. A blank space
 * under a point reads as "no label here"; a dash reads as "this point's date is
 * not known", which is the true statement.
 */
export function axisLabel(raw: string | null | undefined): string {
  if (raw == null || String(raw).trim() === '') return DASH;
  const s = String(raw).trim();
  if (!looksIso(s)) return s;
  const p = readDate(s);
  if (!p) return DASH;
  return p.day == null ? fmtAxisMonth(p.y, p.m) : fmtAxisDay(p.y, p.m, p.day);
}

/**
 * The long form, for the readout when a reader touches a point: "14 Aug 2026".
 *
 * Carries the year where the axis does not. The axis is scanned — six labels
 * across 320px, and "14 Aug 2026" six times over is a smear — but the touch
 * readout is a single line answering "when exactly", and a weight history two
 * years long has two 14 Augs in it.
 */
export function pointLabel(raw: string | null | undefined): string {
  if (raw == null || String(raw).trim() === '') return DASH;
  const s = String(raw).trim();
  if (!looksIso(s)) return s;
  const p = readDate(s);
  if (!p) return DASH;
  return p.day == null ? fmtPointMonth(p.y, p.m) : fmtPointDay(p.y, p.m, p.day);
}

/* ── laying out the axis ──────────────────────────────────────────────────── */

/**
 * Which points get a written label.
 *
 * First and last always: those two answer "what period am I looking at", which
 * is the question the whole change was asked for. Beyond that, as many evenly
 * spaced as the width allows.
 *
 * Evenly spaced by INDEX, so a tick lands on a real point and its label is that
 * point's own date. Choosing ticks by pixel position instead would put a label
 * between two points and require a date to be made up for it.
 */
export function tickIndices(count: number, maxTicks: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  if (maxTicks <= 2) return [0, count - 1];
  if (count <= maxTicks) return Array.from({ length: count }, (_, i) => i);
  const out: number[] = [];
  for (let k = 0; k < maxTicks; k++) {
    const i = Math.round((k / (maxTicks - 1)) * (count - 1));
    if (!out.includes(i)) out.push(i);
  }
  return out;
}

/**
 * How many labels fit across `width` px without crowding.
 *
 * Two at minimum — the ends are not negotiable, and on a narrow phone two
 * slightly tight labels still beat none. Six at most: past that the labels are
 * closer together than they are tall and the axis becomes a texture.
 *
 * `perLabel` is a measured guess at the widest label this axis will draw ("14
 * Aug" at ty.micro), not a font metric. Erring generous costs one label; erring
 * mean produces overlap, which is the failure a reader actually notices.
 */
export function maxTicksForWidth(width: number, perLabel = 54): number {
  if (!Number.isFinite(width) || width <= 0) return 2;
  return Math.max(2, Math.min(6, Math.floor(width / Math.max(1, perLabel))));
}

/* ── gaps ─────────────────────────────────────────────────────────────────── */

/** Every point that can be drawn, each keeping the index it had. */
export function readablePoints(data: Series): PlotPoint[] {
  const out: PlotPoint[] = [];
  data.forEach((v, i) => {
    if (typeof v === 'number' && Number.isFinite(v)) out.push({ i, v });
  });
  return out;
}

/**
 * The series broken into runs the line may be drawn through.
 *
 * A run ends at a hole. Two runs are two polylines with air between them, and
 * that air is the honest picture: nobody knows what happened there. Joining
 * them would draw a straight line across the unrecorded months, which is a
 * measurement nobody took.
 *
 * A run of one is kept rather than dropped. It cannot be a line, and kit.tsx
 * draws it as a single dot — a reading that exists, surrounded by months that
 * do not. Dropping it would delete the only evidence that the month was
 * recorded at all.
 */
export function segments(data: Series): PlotPoint[][] {
  const out: PlotPoint[][] = [];
  let run: PlotPoint[] = [];
  data.forEach((v, i) => {
    if (typeof v === 'number' && Number.isFinite(v)) {
      run.push({ i, v });
    } else if (run.length) {
      out.push(run);
      run = [];
    }
  });
  if (run.length) out.push(run);
  return out;
}

/** True when the series has a hole between two readings — the case where the
 *  axis must not imply even spacing the data does not have. Leading and
 *  trailing holes do not count: nothing is being bridged. */
export function hasInteriorGap(data: Series): boolean {
  const pts = readablePoints(data);
  if (pts.length < 2) return false;
  return pts[pts.length - 1].i - pts[0].i + 1 !== pts.length;
}

/**
 * The nearest point with a value, for a touch that lands on a gap.
 *
 * Returns null rather than a neighbour when the series has nothing readable at
 * all. Snapping to the nearest REAL point is the honest response to a touch on
 * empty air: the reader is shown a reading that exists, at its own date, rather
 * than an interpolated value at the date they happened to press.
 */
export function nearestPoint(data: Series, i: number): PlotPoint | null {
  const pts = readablePoints(data);
  if (!pts.length) return null;
  return pts.reduce((best, p) => (Math.abs(p.i - i) < Math.abs(best.i - i) ? p : best), pts[0]);
}
