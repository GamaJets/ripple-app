// A stored minor-unit integer, read back as the whole-unit number a person typed.
// Compile with tsc, run with node.
//
// The defect: app/(owner)/financials.tsx — the screen whose only job is checking
// an owner's typed figures against the register — converted the register's
// minor units with `Math.round(cents / 100)`. That is right in about two thirds
// of the world's currencies and wrong in the rest, silently, on a screen that
// then offers a "Use It" button which writes the wrong figure into the owner's
// own numbers and grades their business on it.
//
//   TWO PLACES     the ordinary case, and that rounding goes to the nearest unit
//   ZERO PLACES    a yen has no sen: the stored integer IS the amount
//   THREE PLACES   a Kuwaiti dinar has 1000 fils, and /100 is ten times too big
//   NO CURRENCY    null, never a number, because the scale is unknown
//   THE PAIR       this and `minorFromWhole` are each other's inverse
import { wholeFromMinor, NO_CURRENCY_CHECK_NOTE } from './wholeUnits';
import { minorFromWhole } from './coachMoney';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── TWO PLACES ───────────────────────────────────────────────────────────
 * The case the old `/ 100` got right, kept here so a change that fixes the
 * others cannot break this one on its way past.
 */
{
  eq(wholeFromMinor(0, 'GBP'), 0, 'nothing taken is nothing, not null');
  eq(wholeFromMinor(1250, 'GBP'), 13, '£12.50 rounds to £13 — this figure is compared against a whole number somebody typed');
  eq(wholeFromMinor(1249, 'GBP'), 12, 'and £12.49 rounds down');
  eq(wholeFromMinor(50_000_00, 'EUR'), 50_000, '€50,000.00 of MRR is fifty thousand');
  eq(wholeFromMinor(-2500, 'USD'), -25, 'a negative — a refunded month — keeps its sign');
  eq(wholeFromMinor(1250, 'gbp'), 13, 'the currency code is not case-sensitive; the database stores both');
}

/* ── ZERO PLACES ──────────────────────────────────────────────────────────
 * The half of the bug that made a figure a hundred times too SMALL. A gym in
 * Tokyo with ¥500,000 of recurring revenue was told the register said 5,000
 * and asked whether it wanted to use that.
 */
{
  eq(wholeFromMinor(500_000, 'JPY'), 500_000, 'a yen has no minor unit — the stored integer is the amount');
  eq(wholeFromMinor(500_000, 'jpy'), 500_000, 'lower case too');
  ok(wholeFromMinor(500_000, 'JPY') !== 5_000,
    'the old `/ 100` gave 5,000 here, and the screen offered to write it into the owner’s own figures');
  eq(wholeFromMinor(1, 'KRW'), 1, 'one won is one won');
  eq(wholeFromMinor(750_000, 'VND'), 750_000, 'and the same for every other zero-decimal currency');
  eq(wholeFromMinor(1234.7, 'CLP'), 1234,
    'a stray fraction in a zero-decimal currency is truncated, not rounded up into money nobody has');
}

/* ── THREE PLACES ─────────────────────────────────────────────────────────
 * The other half, pointed the other way. 500,000 fils is KWD 500, and `/ 100`
 * reported KWD 5,000 — ten times the gym's real recurring revenue, on the
 * screen that grades the business.
 */
{
  eq(wholeFromMinor(500_000, 'KWD'), 500, 'a dinar has 1000 fils in it');
  eq(wholeFromMinor(12_500, 'BHD'), 13, 'BHD 12.500 rounds to 13 at whole-unit resolution');
  eq(wholeFromMinor(12_499, 'BHD'), 12, 'and 12.499 rounds down');
  ok(wholeFromMinor(500_000, 'KWD') !== 5_000,
    'the old `/ 100` gave 5,000 here — ten times the truth, in the direction that reads as a good month');
}

/* ── NO CURRENCY ──────────────────────────────────────────────────────────
 * There is no default currency in this product, so there is no default factor.
 * With no currency the stored integer might be hundredths of something or whole
 * units of it, and a caller must be able to withhold the figure rather than
 * print one of the two.
 */
{
  eq(wholeFromMinor(1250, null), null, 'no currency, no scale, no number');
  eq(wholeFromMinor(1250, undefined), null, 'and undefined is the same silence');
  eq(wholeFromMinor(1250, ''), null, 'an empty string is a gym that has not chosen, not a currency');
  eq(wholeFromMinor(1250, '   '), null, 'nor is whitespace');
  // Not null, and this is `currencyDecimals`'s standing rule rather than an
  // oversight here: a code that is present but unrecognised is treated as
  // two-place, which is right for every ISO currency outside the two lists and
  // is the only answer that does not break a gym on a code this build has not
  // heard of. The silence that matters is the ABSENT one, tested above.
  eq(wholeFromMinor(1250, 'ZZZ'), 13,
    'an unrecognised but stated code takes the two-place default the rest of the money family uses');

  eq(wholeFromMinor(null, 'GBP'), null, 'no amount is not zero either');
  eq(wholeFromMinor(undefined, 'GBP'), null, 'nor is undefined');
  eq(wholeFromMinor(NaN, 'GBP'), null, 'and NaN is not a figure to compare anything against');
  eq(wholeFromMinor(Infinity, 'GBP'), null, 'nor is an infinity');

  ok(NO_CURRENCY_CHECK_NOTE.includes('Ops'),
    'the no-currency sentence names where the currency is actually set, so it is an instruction and not an apology');
  ok(!/nothing recorded/i.test(NO_CURRENCY_CHECK_NOTE),
    'and it must not say the register is empty — the register is fine, the currency field is blank');
}

/* ── THE PAIR ─────────────────────────────────────────────────────────────
 * `minorFromWhole` is the direction that WRITES. If the two ever disagree
 * about the factor, a figure read off the screen and typed back in changes.
 */
{
  for (const [cur, whole] of [['GBP', 1250], ['JPY', 500_000], ['KWD', 500], ['USD', 0], ['BHD', 13]] as const) {
    const there = minorFromWhole(whole, cur);
    eq(wholeFromMinor(there, cur), whole,
      `${whole} ${cur} written to minor units and read back must be ${whole} again`);
  }
}

if (errors.length) {
  console.error(`wholeUnits: ${errors.length} failure(s)`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('wholeUnits: all assertions passed');
