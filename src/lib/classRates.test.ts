// A fill rate that could exceed 100%.
//
// `capacity` adds `r.capacity || 0`, so a class whose capacity was never
// recorded contributes nothing to the denominator — while `booked` adds every
// row, so its bookings reach the numerator anyway. The owner app printed the
// result as "Avg Fill 117%".
//
// Compile with tsc, then run under plain node.
import { summariseClassRows, type ClassSummaryRow } from './classRates';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};
const row = (capacity: number, booked: number, attended = 0): ClassSummaryRow =>
  ({ capacity, booked, attended } as ClassSummaryRow);

/* ── 1. THE DEFECT: a capacity-less class cannot push fill over 100% ─────── */

{
  const r = summariseClassRows([row(12, 12), row(12, 9), row(0, 7)]);
  ok(r.fill != null && r.fill <= 1, `fill must never exceed 1 — got ${r.fill}`);
  eq(r.fill, 21 / 24, 'it is the filled proportion of the places that were RECORDED');
  // The totals in their own right are untouched: a screen asking how many
  // people booked wants all of them, including the class with no capacity.
  eq(r.booked, 28, 'booked still counts every row');
  eq(r.capacity, 24, 'and capacity still sums what was recorded');
}

/* ── 2. the ordinary case is unchanged ──────────────────────────────────── */

eq(summariseClassRows([row(10, 5), row(10, 10)]).fill, 0.75, 'half and full is three quarters');
eq(summariseClassRows([row(20, 20)]).fill, 1, 'a full class is exactly 1');

/* ── 3. no recorded capacity anywhere is UNKNOWN, not nought ────────────── */

{
  const r = summariseClassRows([row(0, 7), row(0, 3)]);
  eq(r.fill, null, 'no places recorded is no fill rate');
  eq(r.booked, 10, 'though the bookings are real and still counted');
}
eq(summariseClassRows([]).fill, null, 'no classes is no rate');

/* ── 4. the show rate is unaffected ─────────────────────────────────────── */
//
// It was always safe — a class with booked:0 has attended:0 — and the fix must
// not disturb it.
eq(summariseClassRows([row(10, 8, 4)]).show, 0.5, 'half of those booked turned up');
eq(summariseClassRows([row(10, 0, 0)]).show, null, 'nobody booked is no show rate, not 0%');

if (errors.length) {
  console.error('classRates.test.ts FAILED');
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('classRates.test.ts — ok');
