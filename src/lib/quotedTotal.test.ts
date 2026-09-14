// A month's figure, when the month holds two moneys or a row with a hole in it.
//
// The two sentences this file exists to make impossible are both real and both
// were live on the two screens a gym quotes a figure from:
//
//   · "Money in —", under a gym that took AED 6,000 and GBP 400. Two real
//     totals of like things, and the screen quoted neither.
//   · "Money in —", under a gym that took £4,210 across 38 payments and had 3
//     more with no amount recorded. The three took the thirty-eight off the
//     page.
//
// So the assertions below are about what is PRINTED, not only about what is
// computed: a module that gets the pots right and then hands a screen a null is
// the same defect one layer further in.
//
// Compile with tsc, run with node.
import {
  quotedOf, quotedOfLines, quotedText, quotedNote, quotedShort, quotedWhole,
  type QuotedRow,
} from './quotedTotal';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const row = (amountCents: number | null, currency: string | null): QuotedRow => ({ amountCents, currency });

/** A stand-in for `money()`. Deliberately NOT the real one: the real one asks
 *  the device's locale, and the assertions here are about which amounts and
 *  which codes reach a formatter, in what order, not about separators. The
 *  minor-unit factor is the real one's business and is asserted for by the
 *  fact that nothing here divides by anything. */
const fmt = (minorUnits: number, currency: string) => `${currency} ${minorUnits}`;

/* ── two moneys are two figures, and both get quoted ───────────────────────── */
{
  // The defect, exactly: AED 6,000.00 and GBP 400.00 in one month.
  const q = quotedOf([
    row(600000, 'AED'),
    row(40000, 'GBP'),
  ]);
  eq(q.pots.length, 2, 'two currencies are two pots');
  eq(quotedText(q, fmt), 'AED 600000 and GBP 40000',
    'and both are quoted, side by side — this used to be a dash');
  ok(quotedText(q, fmt) !== null,
    'the one assertion that matters: a mixed month is not a month with no figure in it');
  ok(!quotedWhole(q), 'nothing may be derived from it, though — two moneys are not one number');
  ok(quotedNote(q, { one: 'payment', many: 'payments' }, 'nothing recorded').includes('never added'),
    'and the sentence says they were not added');
}

/* ── biggest pot first, then by code, so the order cannot wander ───────────── */
{
  const q = quotedOf([row(100, 'AED'), row(900, 'GBP'), row(900, 'EUR')]);
  eq(q.pots.map((p) => p.currency).join(','), 'EUR,GBP,AED',
    'biggest first; the two that tie sort by code so a re-render cannot reorder a quoted figure');
}

/* ── a hole is counted, never swallowed, and never blanks the figure ───────── */
{
  // Thirty-eight of forty-one: the brief's own example.
  const rows: QuotedRow[] = [];
  for (let i = 0; i < 38; i++) rows.push(row(11079, 'GBP'));
  rows.push(row(null, 'GBP'), row(null, 'GBP'), row(null, 'GBP'));
  const q = quotedOf(rows);

  eq(q.rows, 41, 'forty-one rows went in');
  eq(q.counted, 38, 'thirty-eight of them reached the figure');
  eq(q.unpriced, 3, 'and three carried no amount');
  eq(quotedShort(q), 3, 'which is what the figure cannot speak for');

  // The heart of it. A refusing total printed a dash here and took a real
  // £4,210 off the page because three rows out of forty-one were blank.
  eq(quotedText(q, fmt), 'GBP 421002',
    'the thirty-eight that stated an amount still produce a figure');
  const note = quotedNote(q, { one: 'payment', many: 'payments' }, 'nothing recorded');
  ok(note.includes('38 of 41 payments'),
    `the sentence says how much of the month it covers — got: ${note}`);
  ok(note.includes('3 carry no amount'), 'and what the rest are');
  ok(!quotedWhole(q), 'and it is not a figure anything else may be derived from');
}

/* ── an amount with no currency is not dollars and is not zero ─────────────── */
{
  const q = quotedOf([row(1000, 'GBP'), row(2500, '  '), row(4000, null)]);
  eq(q.pots.length, 1, 'only the row that named a money is in a pot');
  eq(q.pots[0].minorUnits, 1000, 'and the other two are not quietly added to it');
  eq(q.unlabelled, 2, 'they are counted');
  ok(quotedNote(q, { one: 'invoice', many: 'invoices' }, 'nothing recorded').includes('2 state no currency'),
    'and named as the kind of hole they are');
}

/* ── the two holes are different holes ─────────────────────────────────────── */
{
  const q = quotedOf([row(1000, 'GBP'), row(null, 'GBP'), row(500, null)]);
  eq(q.unpriced, 1, 'a row with no amount');
  eq(q.unlabelled, 1, 'a row with no currency');
  const note = quotedNote(q, { one: 'cost', many: 'costs' }, 'nothing recorded');
  ok(note.includes('1 carries no amount') && note.includes('1 states no currency'),
    `both are named, because they send somebody to two different places — got: ${note}`);
}

/* ── ' gbp ' and 'GBP' are one money ───────────────────────────────────────── */
{
  // `gym_payments.currency` is NOT NULL and carries no ISO check, so nothing in
  // the schema stops a lower-case code reaching here. Two pots for one money
  // would print "GBP 10 and GBP 25" at a gym with one price list.
  const q = quotedOf([row(1000, ' gbp '), row(2500, 'GBP')]);
  eq(q.pots.length, 1, 'one money, however it was spelled');
  eq(q.pots[0].minorUnits, 3500, 'and one total');
  eq(q.pots[0].currency, 'GBP', 'normalised for printing');
}

/* ── nothing recorded is the caller's sentence, never an invented zero ─────── */
{
  const q = quotedOf([]);
  eq(quotedText(q, fmt), null, 'no rows is no figure — a dash, never a 0');
  eq(quotedNote(q, { one: 'payment', many: 'payments' }, 'no payment is recorded in August.'),
    'no payment is recorded in August.',
    'and the sentence is the one the screen chose, about the record rather than about the till');
}

/* ── rows that exist and say nothing are NOT "nothing recorded" ────────────── */
{
  const q = quotedOf([row(null, null), row(null, null)]);
  eq(quotedText(q, fmt), null, 'there is still no figure');
  const note = quotedNote(q, { one: 'payment', many: 'payments' }, 'no payment is recorded in August.');
  ok(note.includes('2 payments on record'),
    `two rows exist and the screen must not say the month is empty — got: ${note}`);
  ok(!note.includes('no payment is recorded'),
    'this is the substitution the module exists to refuse');
}

/* ── quotedWhole is the gate on deriving anything ──────────────────────────── */
{
  ok(quotedWhole(quotedOf([row(100, 'GBP'), row(200, 'GBP')])),
    'one money, every row spoke: a net figure or a percentage may be taken from this');
  ok(!quotedWhole(quotedOf([row(100, 'GBP'), row(null, 'GBP')])),
    'a short total is not something to subtract from — the answer would carry an unstated error');
  ok(!quotedWhole(quotedOf([])), 'and neither is nothing at all');
}

/* ── the grouped door: /close already holds its pots ───────────────────────── */
{
  // `incomeOf` groups by method AND currency, so these are what /close has.
  const q = quotedOfLines([
    { currency: 'AED', cents: 600000, count: 12 },
    { currency: 'GBP', cents: 40000, count: 2 },
  ]);
  eq(quotedText(q, fmt), 'AED 600000 and GBP 40000', 'the same two figures, from the lines');
  eq(q.rows, 14, 'and the payment counts add up across them');
  eq(q.counted, 14, 'with nothing left out');
}

{
  const q = quotedOfLines([
    { currency: 'GBP', cents: 40000, count: 4 },
    { currency: null, cents: 999, count: 1 },
  ]);
  eq(q.pots.length, 1, 'a line naming no money is not a pot');
  eq(q.pots[0].minorUnits, 40000, 'and its cents reach nothing');
  eq(q.unlabelled, 1, 'its count is the hole');
  eq(q.counted, 4, 'so the figure covers four of five');
  ok(!quotedWhole(q), 'and is not whole');
}

/* ── a formatter that withholds takes the whole figure with it ─────────────── */
{
  const q = quotedOf([row(1000, 'GBP'), row(2000, 'AED')]);
  const half = (minorUnits: number, currency: string) => (currency === 'GBP' ? `GBP ${minorUnits}` : null);
  eq(quotedText(q, half), null,
    'half of a two-currency figure reads as the whole of a one-currency one, so it is withheld entirely');
}

if (errors.length) {
  console.error(`quotedTotal: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('quotedTotal ok');
