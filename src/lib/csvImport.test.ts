// Reading a money column out of somebody else's spreadsheet.
// Compile with tsc, run with node.
//
// This file exists for ONE gap, and it is the gap with the worst consequence of
// the seven that `currencyDecimals` feeds. `parseMoneyCents` is the only one of
// them that reads a file THIS PRODUCT DID NOT WRITE, and the integer it returns
// goes into `gym_payments.amount_cents` and `membership_plans.price_cents` — the
// permanent record of what a member paid, written once at setup from a sheet
// nobody opens again.
//
// `currencyDecimals` answered 2 for anything non-empty, so a currency column
// reading "Pounds", "£" or "GBP " (an export with a trailing space in it — the
// single commonest shape of this) was silently taken as two-place money and the
// figure scaled by a hundred. In a file that was actually in yen or dinars the
// stored amount is then a hundred times or a tenth of what the member handed
// over, and the sheet it disagrees with is in somebody's Downloads folder.
//
// The rest of the family is asserted beside its own function. What is asserted
// here is the import's two REFUSALS, which are two refusals rather than one
// because they have two different fixes and only one of them is in this app.
import { parseMoneyCents } from './csvImport';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const val = (r: ReturnType<typeof parseMoneyCents>) => (r.ok ? r.value : null);
const why = (r: ReturnType<typeof parseMoneyCents>) => (r.ok ? '' : r.reason);

/* ── the three shapes of money, which must not have moved ─────────────────
 * Kept first so a change aimed at the refusals below cannot quietly alter what
 * a good file imports as.
 */
{
  eq(val(parseMoneyCents('50.00', 'GBP')), 5000, 'two places: fifty pounds is five thousand pence');
  eq(val(parseMoneyCents('50.00', 'JPY')), 50, 'no places: a yen has no sen, and the trailing noughts lose nothing');
  eq(val(parseMoneyCents('50000', 'JPY')), 50000, 'and a plain yen figure is not multiplied by a hundred');
  eq(val(parseMoneyCents('12.340', 'KWD')), 12340, 'three places: a dinar has a thousand fils in it');
  eq(val(parseMoneyCents('50.00', 'ZZZ')), 5000,
    'a stated but unrecognised three-letter code is two places — a real currency this build has not been told about by name is not an unknown');
}

/* ── NOBODY SAID WHICH MONEY ──────────────────────────────────────────────
 * The refusal that already existed. The fix is in this app, at the import
 * screen or in the gym's settings, and the sentence says so.
 */
{
  eq(parseMoneyCents('50.00', null).ok, false, 'no currency, no scale, no figure');
  eq(parseMoneyCents('50.00', '').ok, false, 'and an empty column is the same silence');
  eq(parseMoneyCents('50.00', '   ').ok, false, 'as is one holding only spaces');
  ok(/set the gym/i.test(why(parseMoneyCents('50.00', null))),
    'and the sentence names where a currency is set, because that is the fix');
}

/* ── SOMETHING WAS SAID AND IT IS NOT A CURRENCY ──────────────────────────
 * The hole. Every left-hand figure below is what this importer WROTE TO THE
 * LEDGER before `currencyDecimals` was given the three-letter rule.
 */
{
  eq(parseMoneyCents('50.00', 'pounds').ok, false, 'a word is not a code — this imported as 5000');
  eq(parseMoneyCents('50.00', 'Pounds Sterling').ok, false, 'nor is a longer one');
  eq(parseMoneyCents('50.00', '£').ok, false, 'nor is a symbol — this imported as 5000');
  eq(parseMoneyCents('50.00', 'GB').ok, false, 'nor is a country code — this imported as 5000');
  eq(parseMoneyCents('50.00', 'GBPX').ok, false, 'nor is four letters');

  // The one that changes a figure rather than merely mislabelling it: read at a
  // guessed two places, a three-place Kuwaiti figure was refused for having "3
  // decimal places" — naming the figure as the fault when the fault was the
  // column beside it. A gym would go and edit its own correct spreadsheet.
  const kwd = parseMoneyCents('12.340', 'Kuwaiti dinar');
  eq(kwd.ok, false, 'and a real three-place figure against a non-code is refused');
  ok(!/has \d+ decimal place/.test(why(kwd)),
    'but NOT for having three decimal places — that was the old message, and it sent a gym to edit a correct file');
  ok(!/"12\.340"/.test(why(kwd)),
    'and the message does not quote the figure back as the offending thing');
  ok(/not a currency code/.test(why(kwd)),
    'the refusal names the currency column as the thing to fix');

  // A trailing space in an exported code is the commonest shape of this, and it
  // is the one case where the value really is a currency. It is still refused:
  // guessing which three of the characters were meant is how "GBP " becomes a
  // silent 2 again, and the person reading the message can strip a space.
  ok(/“GBP X”/.test(why(parseMoneyCents('50.00', 'GBP X'))),
    'the message quotes the value that is actually in the column, trimmed and upper-cased as the row would store it');

  // Not the other sentence. This gym HAS set a currency; telling it to go and
  // set one is an instruction that leads nowhere.
  ok(!/set the gym/i.test(why(parseMoneyCents('50.00', 'pounds'))),
    'and it is not the no-currency sentence, which would send somebody to a setting that already has a value in it');
}

/* ── the figure is never silently rescaled ────────────────────────────────
 * The property that matters more than any single message: for every shape of
 * non-currency, the answer is a refusal and never a number.
 */
{
  for (const bad of ['pounds', '£', 'GB', 'GBPX', 'gb p', '$', 'Japanese yen', '¥', 'EURO']) {
    eq(val(parseMoneyCents('50.00', bad)), null, `"${bad}" yields no figure at all`);
    eq(val(parseMoneyCents('0', bad)), null, `and "${bad}" does not yield a zero either, which would read as a free membership`);
  }
}

if (errors.length) {
  console.error(`csvImport: ${errors.length} failure(s)`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('csvImport: all assertions passed — a money column is scaled by a currency somebody stated, or it is refused');
