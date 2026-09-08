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

/**
 * The same, with NO thousands separator — the console's copy of `plain` in
 * src/lib/units.ts.
 *
 * ── why this exists rather than importing `plain` ─────────────────────────
 *
 * It is the same argument the header of this file makes about `format.ts`, one
 * module further along. `plain` spells through `new Intl.NumberFormat(appLocale())`,
 * and `appLocale()` is the module-level latch in src/lib/locale.ts that resolves
 * on the SERVER during render and again in the BROWSER during hydration, on two
 * machines with two locales. scripts/check-deltas.mjs already writes the rule
 * down for exactly this case — "a console site takes the SIGN from the helper
 * and spells the figure with the console's own formatter" — and lib/units.ts
 * was taking the sign from `deltaSign` and then spelling with `plain` anyway.
 *
 * That did not show up as a hydration error, and the reason is a property of
 * the ONE call site rather than of anything here: /coach/roster loads its rows
 * in an effect, so `ranked` is null on the server pass and no weight reaches
 * the prerendered HTML. One `initialData` and it would.
 *
 * ── why no grouping ──────────────────────────────────────────────────────
 *
 * `plain`'s own header: it "may never grow a thousands separator". These are
 * body weights and weight deltas, and in pounds a heavy client is a four-digit
 * figure only in the sense that 1000 lb is four digits — nobody is. Grouping a
 * measurement that will never need it buys nothing and would make this column
 * disagree with the same figure in the phone app.
 *
 * Digits are the reader's own, like `num` and `num1` above: `undefined` locale,
 * no `numberingSystem` forced. `plain` forces `latn` because Hermes may report
 * an `Intl` it does not fully implement and `readNumber` has to parse the
 * result back; neither is true here — this is a browser, and nothing reads
 * these strings but a person.
 */
export function numPlain(n: number | null | undefined, places = 3): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const dp = Math.min(20, Math.max(0, Math.trunc(places) || 0));
  return n.toLocaleString(undefined, { maximumFractionDigits: dp, useGrouping: false });
}
