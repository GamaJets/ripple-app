// ── Date / time formatting helpers (pure) ────────────────────────────────────
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h < 12 ? 'am' : 'pm';
  h = h % 12 || 12;
  return `${h}${m ? ':' + String(m).padStart(2, '0') : ''}${ap}`;
}

/* ── Chart axis dates ─────────────────────────────────────────────────────────
 * The four forms a chart writes a date in, and the only four. They take year,
 * month index and day as NUMBERS rather than a string, because every one of
 * this codebase's date bugs has been a string being parsed: `new Date('2026-08')`
 * is UTC midnight and reads back as July west of Greenwich. Taking the parts
 * means there is nothing left to parse — src/lib/chartAxis.ts does the reading,
 * strictly and locally, and these only render.
 *
 * They live here beside fmtDay rather than in the chart file because the fifth
 * hand-rolled date formatter was exactly what this change was asked to remove:
 * src/ui/kit.tsx carried its own hardcoded month-name array, src/ui/Chart.tsx
 * printed "14/8" from raw getters, and the two disagreed on screen.
 *
 * 'en-GB' matches fmtDay and num() above — day before month, which is what the
 * rest of the app already says to every reader. When this app finally takes the
 * reader's own locale it takes it in one place, and this is the place.
 */

/** Axis, day precision: "14 Aug". No year — see chartAxis.axisLabel. */
export function fmtAxisDay(y: number, m: number, day: number): string {
  return new Date(y, m, day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Axis, month precision: "Aug 26". The year is two digits because a six-month
 *  window that crosses New Year is otherwise two identically labelled Augusts. */
export function fmtAxisMonth(y: number, m: number): string {
  return new Date(y, m, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}

/** Touch readout, day precision: "14 Aug 2026". The exact date that was asked for. */
export function fmtPointDay(y: number, m: number, day: number): string {
  return new Date(y, m, day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Touch readout, month precision: "Aug 2026". */
export function fmtPointMonth(y: number, m: number): string {
  return new Date(y, m, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

/** Signed one-decimal delta between the first and last value of a series. */
export function seriesDelta(values: number[]): number {
  if (values.length < 2) return 0;
  return +(values[values.length - 1] - values[0]).toFixed(1);
}

/**
 * Title case for a value the exercise catalogue stores in lower snake case.
 *
 * A muscle, a goal and a tag are NAMES — "Rectus Abdominis", "Hypertrophy",
 * "Requires Bench". Capitalising only the first letter produced "Rectus
 * abdominis", which reads like a sentence someone cut off.
 *
 * Shared rather than copied. It existed four times — once per screen that
 * renders a catalogue value — and three of those copies still capitalised only
 * the first letter after the fourth was fixed, which is how the client app and
 * the coach app came to disagree about the name of a muscle.
 */
export function catalogueValue(s: string | null | undefined): string {
  return String(s || '')
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * A figure as a person reads it: thousands separated.
 *
 * Reported as "when you have more than 3 digits in a number add a comma."
 * Half the screens already called toLocaleString and half printed the raw
 * number, so the same day's calories appeared as 2,860 on the Meals hero and
 * 2860 four lines down. A helper rather than a habit, so the two cannot drift.
 *
 * Rounds first: a hero showing 1,499.8 kcal is not a hero, and separators on a
 * fractional number look like a bug even when the number is right. Anything
 * that is not a number renders as a dash — never as 0, and never as "NaN".
 */
export function num(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-GB');
}

/** The same, keeping one decimal — for weights and other measured figures
 *  where the tenth is the point (73.5 kg, 1,204.5 kg lifted). */
export function num1(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
