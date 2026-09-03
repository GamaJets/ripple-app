// The month a screen is currently IN, as one number a memo can be keyed on.
//
// ── the defect this exists for ────────────────────────────────────────────
//
// Six console screens build their month or quarter picker like this:
//
//     const months = useMemo(() => recentMonths(MONTHS_OFFERED), []);
//
// and every one of them is wrong in the same way, in a shape neither clock gate
// can see. `check-frozen-day` looks for a clock READ inside a memo with an empty
// dependency array and there is no `Date` on that line — the clock is
// `recentMonths(count, now = Date.now())`, one file away. `check-frozen-hook`
// follows exactly those defaulted parameters, but it skips empty dependency
// arrays on purpose, because those are the other gate's rule. So the shape falls
// between the two: an empty dependency list AND a clock that only the callee
// can see.
//
// What it costs is not subtle. The console has no router — the rail is a plain
// `<a href>` — so a tab open on a front desk is one document that lives for
// days. The picker on /close, /accounting, /costs, /tax, /payroll and
// /coach/earnings is built once, at mount, and never gains a month. On the
// first of October an owner whose tab has been open since September opens the
// month picker to close September and the newest month it offers is August;
// /payroll cannot run October at all. The one repair available is the full
// document reload this console spent a whole wave trying to stop needing.
//
// ── why a tick, and not just `nowMs` ──────────────────────────────────────
//
// Because the fix has to re-settle the picker exactly when the calendar month
// turns over and at NO other time. Keying the memo on the read instant itself
// would rebuild the array — and with it the identity of the selected period
// object — on every refresh; on the screens where the read is fired by an
// effect keyed on that object, that is not a re-render, it is a loop: read
// stamps the instant, the instant rebuilds the period, the period fires the
// read.
//
// So the instant is reduced to the month it falls in, and the picker is keyed on
// THAT. It changes once a month, which is precisely how often a month picker
// should change.
//
// Local calendar throughout, deliberately. These pickers name months to a person
// reading a screen, and `monthKeyOf` — the function whose output they are
// compared against — is local too. A UTC month would disagree with it for the
// hours between the two midnights, which is the same defect one layer down.

/**
 * Which calendar month `now` falls in, counted in whole months, so that two
 * instants in the same month give the same number and the following month gives
 * one more.
 *
 * The absolute value is meaningless and no caller should read it as a date. It
 * exists to be compared and to be handed back to `monthTickStart`.
 */
export function monthTick(now: number = Date.now()): number {
  const d = new Date(now);
  return d.getFullYear() * 12 + d.getMonth();
}

/**
 * Local midnight on the first of the month a tick names.
 *
 * The inverse of `monthTick` up to the month: `monthTick(monthTickStart(t).getTime()) === t`.
 * Handed to anything that wants an instant — `recentMonths(count, at)` and the
 * quarter builders take one — so that a picker built from a tick is a pure
 * function of the tick and cannot smuggle a fresher clock in beside it.
 *
 * Years before 100 would be remapped by `new Date(year, month)` into the 1900s.
 * Nothing in this product can produce one: every tick comes from a clock read.
 */
export function monthTickStart(tick: number): Date {
  const year = Math.floor(tick / 12);
  const month = tick - year * 12;
  return new Date(year, month, 1, 0, 0, 0, 0);
}
