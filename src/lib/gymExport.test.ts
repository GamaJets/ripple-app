// The money cell in the bundle a gym hands to an accountant, and hands back to
// this importer six months later.
// Compile with tsc, run with node.
//
// `minorToDecimal` is the export half of the same question `parseMoneyCents`
// answers on the way in, and the two have to give the same answer or the round
// trip changes the money. Its own doc comment records what happened when they
// did not: a gym in Tokyo exported ¥50,000 as "500.00" and a gym in Kuwait
// exported KWD 12.340 as "123.40", because this padded to three digits and
// sliced two for every currency there is.
//
// The gap this file was added for is the one LEFT after that fix.
// `currencyDecimals` answered 2 for anything non-empty, so a row whose currency
// column held 'pounds' or '£' was written out at two places — and the export is
// the worst place of the seven for that, because the guess does not merely get
// printed. `parseMoneyCents` is currency-aware now, so the cell comes back
// through the importer and a guessed "50.00" is WRITTEN BACK IN as 5000 minor
// units of something.
//
// An empty cell is the honest answer. Nothing is lost by it: every table that
// carries a money column carries the stored integer and the raw currency string
// in their own columns beside it (see `paymentsTable`'s header — 'amount',
// 'amount_cents', 'currency'), so the row still holds everything anybody needs
// to work the figure out once the currency is named.
import { minorToDecimal } from './gymExport';
import { parseMoneyCents } from './csvImport';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the three shapes of money ────────────────────────────────────────────
 * First, so a change aimed at the refusal below cannot alter a good cell.
 */
{
  eq(minorToDecimal(5000, 'GBP'), '50.00', 'two places');
  eq(minorToDecimal(5, 'GBP'), '0.05', 'and a sub-unit amount keeps its leading nought, which a spreadsheet needs to read it as a number');
  eq(minorToDecimal(50000, 'JPY'), '50000', 'no places: the stored integer IS the amount');
  eq(minorToDecimal(12340, 'KWD'), '12.340', 'three places: a dinar has a thousand fils');
  eq(minorToDecimal(5, 'BHD'), '0.005', 'five fils, with its nought');
  eq(minorToDecimal(-2500, 'GBP'), '-25.00', 'a negative keeps its sign');
  eq(minorToDecimal(5000, 'ZZZ'), '50.00',
    'a stated but unrecognised three-letter code is two places — the silence is about non-codes, not unknown ones');
}

/* ── nothing to state ─────────────────────────────────────────────────────
 * Empty, never "0.00". A pass with no recorded price is not a free pass, and
 * an amount in no currency is not an amount.
 */
{
  eq(minorToDecimal(null, 'GBP'), '', 'no amount, no cell');
  eq(minorToDecimal(5000, null), '', 'no currency, no cell');
  eq(minorToDecimal(5000, ''), '', 'and a blank currency is the same silence');
  eq(minorToDecimal(1.5, 'GBP'), '', 'a fractional minor unit is not a stored amount');
}

/* ── stated, and not a currency ───────────────────────────────────────────
 * The hole. Each figure below is the cell this exporter WROTE before
 * `currencyDecimals` was given the three-letter rule.
 */
{
  eq(minorToDecimal(5000, 'pounds'), '', 'a word is not a code — this wrote "50.00"');
  eq(minorToDecimal(12340, '£'), '', 'nor is a symbol — this wrote "123.40"');
  eq(minorToDecimal(5000, 'GB'), '', 'nor is a country code — this wrote "50.00"');
  eq(minorToDecimal(50000, 'Japanese yen'), '', 'and naming the currency in words is not naming it — this wrote "500.00", a hundredth of the sale');
  ok(minorToDecimal(5000, 'pounds') !== '0.00',
    'and the empty cell is empty rather than a nought — a nought in an accountant’s column is a sale for nothing');
}

/* ── THE ROUND TRIP ───────────────────────────────────────────────────────
 * The property that makes the two halves one decision rather than two: a cell
 * this writes must re-import as the integer it was written from, and a cell it
 * refuses to write must be one the importer would have refused to read.
 */
{
  for (const [cents, cur] of [[5000, 'GBP'], [50000, 'JPY'], [12340, 'KWD'], [5, 'BHD'], [5000, 'ZZZ']] as const) {
    const cell = minorToDecimal(cents, cur);
    ok(cell !== '', `${cents} ${cur} is written out`);
    const back = parseMoneyCents(cell, cur);
    eq(back.ok ? back.value : null, cents, `${cents} ${cur} written to "${cell}" and read back must be ${cents} again`);
  }

  // And the other direction of the same agreement. Where the exporter withholds
  // a cell, the importer withholds a figure — so neither half can be the one
  // that quietly invents a factor the other does not use.
  for (const bad of ['pounds', '£', 'GB', 'Japanese yen', '', null]) {
    eq(minorToDecimal(5000, bad), '', `the exporter writes nothing for ${JSON.stringify(bad)}`);
    eq(parseMoneyCents('50.00', bad).ok, false, `and the importer reads nothing for ${JSON.stringify(bad)}`);
  }
}

if (errors.length) {
  console.error(`gymExport: ${errors.length} failure(s)`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('gymExport: all assertions passed — a money cell is written at the currency’s own places, or not written');
