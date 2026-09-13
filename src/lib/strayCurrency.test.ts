// The five this file exists to stop.
//
//   1. A NORMALISATION REPORTED AS A FAULT. ' gbp ' and 'GBP' are one currency
//      everywhere else in this tree, and a warning that names the first one is
//      a warning an owner learns to dismiss — after which it is worth nothing
//      on the day it names a real one.
//
//   2. THE ROWS VOUCHING FOR THEMSELVES. If the set being checked counted as
//      evidence of what the gym uses, one mistyped row would excuse itself and
//      a whole import in the wrong money would excuse every row in it. The
//      book is the gym's record, never the rows on screen.
//
//   3. "UNKNOWN CURRENCY" SAID OVER AN UNREAD PRICE BOOK. A null book is not
//      an empty book. A screen that ran the comparison anyway would flag every
//      payment the gym has ever taken for as long as one read was in flight,
//      which is the null-is-zero mistake pointed at somebody's ledger.
//
//   4. THREE FAULTS COLLAPSED INTO ONE. A blank column, a value that is not a
//      code, and a code this gym has never used are three different things
//      with three different fixes, and only the third of them is a judgement
//      that can be wrong.
//
//   5. A WARNING THAT CORRECTS THE ROW. Nothing here proposes a replacement
//      code. A euro payment in a GBP gym is as likely to be a euro as a slip,
//      and no rate in this product could put it back if it were not.
//
// Compile with tsc, run with node.
import {
  strayCurrencies, strayLines, STRAY_UNCHECKED_NOTE, type StrayReport,
} from './strayCurrency';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const rows = (...cs: Array<string | null>) => cs.map((currency) => ({ currency }));
const kinds = (r: StrayReport) => r.strays.map((x) => x.kind).join(',');

/* ── 1. the ordinary gym has nothing to say ────────────────────────────── */
{
  const r = strayCurrencies(rows('GBP', 'GBP', 'GBP'), ['GBP']);
  eq(r.strays.length, 0, 'a single-currency gym in its own currency raises nothing');
  eq(r.checked, true, 'and the comparison was actually made');

  // The defect the whole mixed-currency machinery was repaired for, from the
  // other side: the row reads as a second currency to anything comparing the
  // raw column, and it is not one.
  const cased = strayCurrencies(rows('GBP', ' gbp ', 'GBP'), [' gbp ']);
  eq(cased.strays.length, 0, 'case and spacing are not a stray currency');
  eq(cased.book.join(','), 'GBP', 'and the book is normalised before it is printed');
}

/* ── 2. a code the gym has no record of using ──────────────────────────── */
{
  const r = strayCurrencies(rows('GBP', 'EUR', 'GBP'), ['GBP']);
  eq(kinds(r), 'unseen', 'a well-formed code the gym has never used is named');
  eq(r.strays[0].stated, 'EUR', 'and named by what the row actually holds');
  eq(r.strays[0].rows, 1, 'with the row count, so the owner knows what to look for');

  // Two of them are still one warning about one code, and still not a reason to
  // believe it: an import in the wrong money is many rows agreeing with each
  // other about nothing.
  const twice = strayCurrencies(rows('EUR', 'EUR', 'GBP'), ['GBP']);
  eq(twice.strays.length, 1, 'one entry per code, however many rows state it');
  eq(twice.strays[0].rows, 2, 'and the count is the rows, not the codes');

  // A gym that has changed currency is on record as using both, and the older
  // half of its own ledger is not a fault.
  const changed = strayCurrencies(rows('AED', 'GBP'), ['GBP', 'AED']);
  eq(changed.strays.length, 0, 'every currency in the book is a currency the gym uses');
  eq(changed.book.join(','), 'AED,GBP', 'the book is sorted, so the sentence is stable');
}

/* ── 3. the column will take anything, and two of those are not codes ──── */
{
  const blank = strayCurrencies(rows('GBP', '', 'GBP'), ['GBP']);
  eq(kinds(blank), 'unstated', 'an empty currency column is its own fault, not an unknown code');
  eq(blank.strays[0].stated, null, 'and there is no value to quote back');

  const words = strayCurrencies(rows('GBP', 'Pounds'), ['GBP']);
  eq(kinds(words), 'not_a_code', 'text that is not ISO 4217 is not an unknown currency');
  eq(words.strays[0].stated, 'Pounds', 'and it is quoted exactly as it was typed');

  const twoLetters = strayCurrencies(rows('GB'), ['GBP']);
  eq(kinds(twoLetters), 'not_a_code', 'two letters is not a currency code');

  // A gym whose own setting is not a code does not get to make the same
  // non-code legitimate on its rows.
  const badBook = strayCurrencies(rows('Pounds'), ['Pounds']);
  eq(kinds(badBook), 'not_a_code', 'a malformed gym setting legitimises nothing');
  eq(badBook.checked, false, 'and leaves the gym with no established currency at all');
  eq(badBook.book.length, 0, 'so there is no book to print');

  // Worst first. The order is an argument, read top to bottom.
  const all = strayCurrencies(rows('', 'Pounds', 'EUR', 'GBP'), ['GBP']);
  eq(kinds(all), 'unstated,not_a_code,unseen', 'the three faults are reported worst first');
}

/* ── 4. a book that was not read is not an empty book ──────────────────── */
{
  const unread = strayCurrencies(rows('GBP', 'EUR', ''), null);
  eq(unread.checked, false, 'a null book means the unseen question was never asked');
  eq(kinds(unread), 'unstated',
    'so a code cannot be called unknown — but a blank column is still blank');
  ok(!unread.strays.some((x) => x.kind === 'unseen'),
    'nothing is accused of being unknown to a gym whose record did not load');

  // The gym that has set no currency and priced no plan. Same answer, and for
  // the same reason: nothing has been established for a code to be unknown to.
  const nothing = strayCurrencies(rows('EUR'), [null, '', undefined]);
  eq(nothing.checked, false, 'a book with no usable code in it establishes nothing');
  eq(nothing.strays.length, 0, 'and raises nothing about a code it cannot judge');

  const empty = strayCurrencies([], ['GBP']);
  eq(empty.checked, true, 'no rows is a real answer about no rows');
  eq(empty.strays.length, 0, 'and there is nothing in them to warn about');
}

/* ── 5. the sentences ──────────────────────────────────────────────────── */
{
  const [line] = strayLines(strayCurrencies(rows('EUR', 'GBP'), ['GBP']), 'payment');
  ok(line.includes('EUR'), 'the sentence names the code that was found');
  ok(line.includes('GBP'), 'and what the gym is on record as using');
  ok(line.startsWith('1 payment '), 'and counts the rows in the caller’s noun');
  ok(!/\s{2}/.test(line), 'no sentence is assembled with a gap in it');
  ok(!/\s\./.test(line), 'and none of them strands a full stop');
  ok(!/change it to|should be|did you mean|corrected to/i.test(line),
    'a warning never proposes the code to replace it with');

  const two = strayLines(strayCurrencies(rows('EUR', 'EUR'), ['GBP']), 'payment');
  ok(two[0].startsWith('2 payments '), 'and pluralises the noun it was handed');

  // The two faults that can be reported with no book behind them must still
  // read as sentences when there is nothing to say about the gym.
  const bookless = strayLines(strayCurrencies(rows('', 'Pounds'), null), 'invoice');
  eq(bookless.length, 2, 'both column faults are still worth a sentence with no book');
  for (const l of bookless) {
    ok(!/\s{2}/.test(l), 'a missing book does not leave a hole in the sentence');
    ok(l.trim().endsWith('.'), 'each one is a sentence');
    ok(l.includes('invoice'), 'and is about the rows the caller actually has');
  }

  eq(strayLines(strayCurrencies(rows('GBP'), ['GBP']), 'payment').length, 0,
    'a clean ledger produces no sentences at all');

  ok(!/is fine|are correct|no problem/i.test(STRAY_UNCHECKED_NOTE),
    'the unchecked note never claims the rows are right');
  ok(/not been checked|could be compared|nothing here/i.test(STRAY_UNCHECKED_NOTE),
    'it says that nothing was checked, which is the fact it carries');
  ok(STRAY_UNCHECKED_NOTE.trim().endsWith('.'), 'it is a sentence');
}

if (errors.length) { for (const e of errors) console.error('FAIL ' + e); process.exit(1); }
console.log('strayCurrency: ok');
