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
//
// ── and, since 14 Sep 2026, the third refusal: the payment METHOD ─────────
//
// `previewPayments` read the method column as `METHODS[raw] ?? 'other'`, the
// one coercion left among this file's word parsers — status, delivery mode,
// billing period and active all refuse a word they do not know. So "cheque",
// "paypal", "efectivo" and the typo "cardd" became `other`, which is also what
// a BLANK cell becomes, on an import screen that never displays the parsed
// method. Nothing downstream could tell the two apart and nobody was shown the
// difference, and the row is the gym's permanent record of how a member paid.
//
// The blank is deliberately still `other`, and the assertions below hold both
// halves of that: an unreadable word is refused BY NAME, a blank (or a missing
// column, which is the same thing on every row of a sheet that never had one)
// imports as `other` in silence.
import { parseMoneyCents, previewPayments } from './csvImport';

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

/* ── the payment method is read, or refused by name ───────────────────────
 * Every row here is otherwise perfect — a name, a good amount in the gym's own
 * currency, an unambiguous ISO date — so the only thing that can reject one is
 * the method column, and a rejection therefore means exactly what it says.
 */
{
  const sheet = (method: string) =>
    `member,amount,date,method\nSam Patel,50.00,2026-09-01,${method}\n`;
  const preview = (method: string) => previewPayments(sheet(method), undefined, 'GBP');
  const first = (method: string) => preview(method).rows[0];

  // The spellings that are read, including the four stored values themselves
  // and `other`, which gymExport.ts writes into this column — a file this
  // product exported has to re-import.
  const reads: [string, string][] = [
    ['Card', 'card'], ['visa', 'card'], ['Stripe', 'card'],
    ['CASH', 'cash'],
    ['Bank Transfer', 'transfer'], ['bacs', 'transfer'], ['transfer', 'transfer'],
    ['Direct Debit', 'direct_debit'], ['direct_debit', 'direct_debit'],
    ['GoCardless', 'direct_debit'],
    ['other', 'other'],
  ];
  for (const [written, read] of reads) {
    const r = first(written);
    eq(r.errors.length, 0, `"${written}" is a method this reads, so the row is not rejected — ${r.errors.join('; ')}`);
    eq(r.value?.method, read, `"${written}" reads as ${read}`);
    eq(preview(written).ready.length, 1, `and "${written}" reaches ready[]`);
  }

  // The coercion this test exists for. Each of these was silently `other`.
  for (const bad of ['cheque', 'check', 'paypal', 'efectivo', 'cardd', 'crypto', 'venmo', 'invoice']) {
    const r = first(bad);
    ok(r.errors.length > 0, `"${bad}" is refused rather than filed as other`);
    ok(r.errors.some((e) => e.includes(`"${bad}"`)),
      `and the refusal NAMES the value that could not be read — got ${JSON.stringify(r.errors)}`);
    ok(r.errors.some((e) => e.includes('is not one this recognises')),
      `in the same words as status, delivery and billing period — got ${JSON.stringify(r.errors)}`);
    eq(preview(bad).ready.length, 0, `and "${bad}" does not reach ready[], where it would become a stored row`);
    eq(preview(bad).rejected.length, 1, `it is in rejected[], where the gym is shown it`);
  }

  // The cell decides whether the file said anything, not the stripped key: "1"
  // and "-" have no letters in them and would otherwise read as blank.
  for (const noisy of ['1', '-', '???']) {
    const r = first(noisy);
    ok(r.errors.some((e) => e.includes(`"${noisy}"`)),
      `"${noisy}" is the file saying something unreadable, not the file saying nothing — got ${JSON.stringify(r.errors)}`);
  }

  // A blank cell is the other case, and it is not the same case.
  {
    const r = first('');
    eq(r.errors.length, 0, `a blank method is not an error — ${r.errors.join('; ')}`);
    eq(r.value?.method, 'other', 'a blank method imports as other, which is the only value the not-null column has for "the file did not say"');
  }

  // A sheet with no method column at all is that blank on every row. Refusing
  // it would make an optional column mandatory through the back door.
  {
    const p = previewPayments('member,amount,date\nSam Patel,50.00,2026-09-01\nAsha Khan,20.00,2026-09-02\n', undefined, 'GBP');
    eq(p.rejected.length, 0, `a payments sheet with no method column imports whole — ${JSON.stringify(p.rejected.map((r) => r.errors))}`);
    eq(p.ready.length, 2, 'both rows are ready');
    eq(p.ready.every((v) => v.method === 'other'), true, 'each reading as other');
  }

  // The refusal is the method's alone: it does not swallow another column's
  // reason, and it does not fire on a row that is wrong for another cause.
  {
    const r = previewPayments('member,amount,date,method\nSam Patel,50.00,2026-09-01,cheque\n', undefined, 'GBP').rows[0];
    eq(r.errors.length, 1, `one row, one fault, one message — got ${JSON.stringify(r.errors)}`);
  }
}

if (errors.length) {
  console.error(`csvImport: ${errors.length} failure(s)`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('csvImport: all assertions passed — a money column is scaled by a currency somebody stated, or it is refused; and a payment method is one this reads, or it is refused by name');
