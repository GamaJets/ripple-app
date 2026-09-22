// What a HealthKit sample's number is worth, and what an unreadable one is worth.
//
// ── the bug this file is the fix for ───────────────────────────────────────
//
// `src/lib/wearables/appleHealth.ts` reduced native-bridge samples with
// `(s, x) => s + (Number(x?.value) || 0)` in three places. That coercion is the
// invented zero named at the top of scripts/check-invented-zero.mjs, and it is
// worse inside a mean than inside a sum:
//
//   `Number(undefined)` is NaN and `|| 0` eats it. `Number(null)` is 0.
//   `Number('')` is 0. `Number('72 bpm')` is NaN and `|| 0` eats that too.
//
// So a heart-rate sample the bridge handed over without a readable number was
// counted as a reading of ZERO BPM — and `avgValues` then divided by
// `res.length`, which still counted it. Two samples, one of 72 bpm and one the
// bridge could not describe, came out as an average heart rate of 36. That
// figure goes to the Recovery screen, into `hrFreshness` and into readiness
// scoring, and there is nothing on the screen to say it was a mean of one real
// measurement and one hole.
//
// `newestValue` was the same coercion with a smaller denominator and a louder
// consequence: the most recent sample, unreadable, shown as a resting heart
// rate of 0.
//
// ── the rule ───────────────────────────────────────────────────────────────
//
// A sample that does not carry a number is NOT A READING. It contributes
// nothing to a sum, it is not counted in the denominator of a mean, and it is
// never the "latest" value. A list in which no sample carries a number is not a
// day of zeroes: it is null, which every `DailyMetrics` field is already typed
// to hold and which every screen already draws as a dash.
//
// ── why this is its own module ─────────────────────────────────────────────
//
// `appleHealth.ts` imports `react-native`, so nothing in it can be loaded by a
// plain `node` test — which is exactly why this arithmetic sat untested while
// it was wrong. The decision is pure, so it lives here, where
// `healthSamples.test.ts` can hand it the shapes a native bridge actually
// produces: an absent `value`, a null one, a string one, and a NaN.

/** The number a sample carries, or null when it does not carry one.
 *
 *  Strings are read because the values cross a native bridge and arrive as
 *  whatever the bridge chose; `'72'` is a reading and `'72 bpm'` is not a
 *  number we may do arithmetic on. Booleans are refused outright — `Number(true)`
 *  is 1, and a sample of `true` is not one beat per minute. */
export function sampleValue(x: unknown): number | null {
  const v = (x as { value?: unknown } | null | undefined)?.value;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Total of the samples that carry a number, or null when none of them does.
 *
 *  Null and not 0: an empty read, a read of rows the bridge could not describe,
 *  and a genuine day of no steps are three different sentences, and only the
 *  last of them is a zero anybody measured. */
export function sumSamples(res: unknown): number | null {
  if (!Array.isArray(res) || res.length === 0) return null;
  let total = 0;
  let seen = 0;
  for (const x of res) {
    const v = sampleValue(x);
    if (v == null) continue;
    total += v;
    seen++;
  }
  return seen > 0 ? Math.round(total) : null;
}

/** Mean of the samples that carry a number.
 *
 *  The divisor is `seen` and NOT `res.length`. That one word is the whole
 *  defect: a sample with no readable value was being added as a zero AND
 *  counted in the denominator, so every unreadable row dragged the mean towards
 *  nothing twice over. */
export function avgSamples(res: unknown): number | null {
  if (!Array.isArray(res) || res.length === 0) return null;
  let total = 0;
  let seen = 0;
  for (const x of res) {
    const v = sampleValue(x);
    if (v == null) continue;
    total += v;
    seen++;
  }
  return seen > 0 ? Math.round(total / seen) : null;
}

/**
 * The most recent sample THAT CARRIES A NUMBER, with that number.
 *
 * Which end of the list is the recent one depends on how the query was sorted,
 * and this file's caller sorts its two heart-rate reads differently — see the
 * note on `newestValue` in wearables/appleHealth.ts. So the caller states the
 * sort and this walks from that end.
 *
 * It walks PAST unreadable rows rather than stopping at the first one, because
 * one malformed row at the head of ten thousand good ones is not a reason to
 * show a dash for a live heart rate. It returns the sample alongside the value
 * so that the time on the screen is the time OF THE FIGURE on the screen: the
 * value and its timestamp were read by two separate walks before, and the
 * moment one of them skipped a row they would have described different samples.
 */
export function newestReading(res: unknown, ascending: boolean): { value: number; sample: unknown } | null {
  if (!Array.isArray(res) || res.length === 0) return null;
  for (let n = 0; n < res.length; n++) {
    const sample = ascending ? res[res.length - 1 - n] : res[n];
    const value = sampleValue(sample);
    if (value != null) return { value, sample };
  }
  return null;
}
