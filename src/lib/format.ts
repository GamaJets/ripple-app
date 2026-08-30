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
