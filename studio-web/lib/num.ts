// A figure with a fraction in it, written the way the reader's own browser
// writes one.
//
// ── what was wrong ────────────────────────────────────────────────────────
//
// The console had a rule for whole numbers and no rule at all for fractional
// ones. `Kpi` formats a count with `toLocaleString`, `DataTable` counts rows
// with `toLocaleString`, and both carry a comment saying that a separator is
// the reader's own decision — and then seven figures on four pages were
// written with `.toFixed(1)` and `.toFixed(0)`.
//
// `toFixed` is not a formatter. It is `Number.prototype`'s own decimal
// spelling, it writes a FULL STOP in every locale there has ever been, and it
// never groups. So a gym in Berlin read "Churn 4.2%" beside "1,204 members" —
// the count in German separators and the percentage in English ones, on the
// same row of the same table. In German "4.2" is not four point two; a full
// stop is the thousands separator, so the honest reading of that figure is
// forty-two.
//
// ── why this duplicates src/lib/format.ts rather than importing it ────────
//
// It could import it: `@lib/*` resolves to `../src/lib/*` and the console
// already uses that alias for a dozen modules. `format.ts` is not one it can
// take, because every function there asks `appLocale()` — a module-level latch
// in src/lib/locale.ts, seeded once from `Intl.DateTimeFormat().resolvedOptions()`.
// In a Next.js app that resolves on the SERVER during render and again in the
// BROWSER during hydration, and those are two different machines with two
// different locales. The mismatch is silent and it is a hydration error.
//
// So the console does what the console already does: passes `undefined`, which
// is the reader's own browser and nothing else, on both passes. Same rule as
// `Kpi` and `DataTable`; this only adds the fraction to it.

/** A whole figure, grouped. A dash for anything that is not a number — never a
 *  zero, which is the console's rule everywhere. */
export function num(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** The same, keeping one decimal — a percentage, a rate, an average visit
 *  count. */
export function num1(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/**
 * At most `places` decimals, trailing zeros dropped — "8" rather than "8.0".
 *
 * `places` is clamped to Intl's own 0-20 range rather than trusted: the
 * constructor throws a RangeError outside it, and a throw inside a formatter
 * takes out whichever page was drawing a figure.
 */
export function numUpTo(n: number | null | undefined, places: number): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const dp = Math.min(20, Math.max(0, Math.trunc(places) || 0));
  return n.toLocaleString(undefined, { maximumFractionDigits: dp });
}
