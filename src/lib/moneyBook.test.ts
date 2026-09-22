// Breaking a coach's own book down. Compile with tsc, then run under plain
// node.
//
// The harmful versions of this all look reasonable:
//
//   · "your biggest cost" picked by comparing a dirham integer with a sterling
//     one, over a book this app holds no rate between;
//   · a month total built by parsing a bare `YYYY-MM-DD`, which moves the first
//     of the month into the previous one for every coach west of Greenwich;
//   · a row whose day will not read swept into the current month, making one
//     month quietly too big;
//   · a slice printed at 0.00, which states that a coach took no transfers when
//     what it means is that they recorded none;
//   · slices ordered by a total across currencies, which is the addition this
//     whole family of modules refuses.
import {
  groupLines, linesByMonth, biggestLines,
  MONTHS_ARE_WHAT_YOU_WROTE_DOWN, BIGGEST_IS_OF_WHAT_YOU_RECORDED,
  type BookLine,
} from './moneyBook';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => {
  if (!Object.is(a, b)) errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
};

let n = 0;
const line = (o: Partial<BookLine> = {}): BookLine => ({
  id: `l${++n}`, day: '2026-09-01', amountCents: 5000, currency: 'GBP', label: 'A line', ...o,
});

/* ── 1. slices by anything the caller can name ───────────────────────────
   The shape `costsByCategory` already has, generalised so the cash book can
   use it for method and for client without a second opinion about either. */

{
  const lines = [
    line({ label: 'Cash', amountCents: 3000, currency: 'GBP' }),
    line({ label: 'Cash', amountCents: 2000, currency: 'GBP' }),
    line({ label: 'Transfer', amountCents: 9000, currency: 'GBP' }),
  ];
  const kind = (l: BookLine) => l.label.toLowerCase();
  const groups = groupLines(lines, kind, (k) => k.toUpperCase());

  eq(groups.length, 2, 'two kinds in, two slices out');
  eq(groups[0].key, 'transfer', 'the biggest slice is first');
  eq(groups[0].taken.pots[0].minorUnits, 9000, 'and carries its own pot');
  eq(groups[1].taken.pots[0].count, 2, 'the smaller slice counted both of its rows');
  eq(groups[0].label, 'TRANSFER', 'the label comes from the caller, so one wording lives in one place');

  // A slice with nothing in it is ABSENT and not present at zero: a "Bank
  // Transfer — 0.00" row is a claim about what this coach took.
  const onlyCash = groupLines([line({ label: 'Cash' })], kind, (k) => k);
  eq(onlyCash.length, 1, 'a kind nobody used does not appear at zero');

  // A row whose key is missing is counted somewhere rather than dropped, or the
  // breakdown would not add up to the book above it.
  const blank = groupLines([line({ label: '' })], (l) => l.label, (k) => k);
  eq(blank.length, 1, 'a row with no key is still in a slice');
  eq(blank[0].key, 'other', 'under the fallback');
}

/* ── 2. two currencies are never added, and never compared ─────────────── */

{
  const mixed = [
    line({ label: 'Cash', amountCents: 40000, currency: 'AED' }),
    line({ label: 'Cash', amountCents: 30000, currency: 'GBP' }),
  ];
  const one = groupLines(mixed, () => 'cash', () => 'Cash');
  eq(one.length, 1, 'one slice');
  eq(one[0].taken.pots.length, 2, 'holding two pots, because two currencies are two amounts of money');
  ok(!one[0].taken.pots.some((p) => p.minorUnits === 70000), 'and nothing anywhere added them together');

  // Ordering off the largest single POT, never off a total across them — the
  // same rule `costsByCategory` states, because a sum across currencies is the
  // one thing this family of modules refuses to compute.
  const twoSlices = groupLines(
    [
      line({ label: 'a', amountCents: 6000, currency: 'AED' }),
      line({ label: 'a', amountCents: 6000, currency: 'GBP' }),
      line({ label: 'b', amountCents: 9000, currency: 'GBP' }),
    ],
    (l) => l.label, (k) => k,
  );
  eq(twoSlices[0].key, 'b', 'the slice with the single biggest pot leads, not the one with two pots that would have summed higher');
}

/* ── 3. months, read off the string ─────────────────────────────────────
   Never `Date.parse`. A bare date parsed as UTC midnight puts the first of the
   month in the previous month for every coach in the Americas, and nothing
   downstream notices because the row simply is not counted. */

{
  const book = linesByMonth([
    line({ day: '2026-09-01', amountCents: 1000 }),
    line({ day: '2026-09-30', amountCents: 2000 }),
    line({ day: '2026-08-15', amountCents: 4000 }),
  ]);
  eq(book.months.length, 2, 'two months');
  eq(book.months[0].key, '2026-09', 'newest first');
  eq(book.months[0].taken.pots[0].minorUnits, 3000, 'and September holds both of its days, the first included');
  eq(book.months[1].key, '2026-08', 'then August');
  ok(book.months[0].label.includes('2026'), 'a month is labelled for a person to read');
  eq(book.undated, 0, 'nothing was unplaceable');

  // The year boundary, where a string sort is the whole reason this is safe.
  const across = linesByMonth([line({ day: '2025-12-31' }), line({ day: '2026-01-01' })]);
  eq(across.months[0].key, '2026-01', 'January 2026 is newer than December 2025');

  // A day that will not read is NOT swept into the current month, and is not
  // silently dropped either — the months would then add up to less than the
  // book above them with nothing saying why.
  const bad = linesByMonth([line({ day: '' }), line({ day: 'last Tuesday' }), line({ day: '2026-09-01' })]);
  eq(bad.undated, 2, 'unreadable days are counted');
  eq(bad.months.length, 1, 'and are in no month');
  eq(bad.months[0].taken.pots[0].count, 1, 'so the month that is there holds only what belongs in it');
}

/* ── 4. the biggest line, one per currency ────────────────────────────── */

{
  const top = biggestLines([
    line({ label: 'Rent', amountCents: 45000, currency: 'GBP' }),
    line({ label: 'Insurance', amountCents: 12000, currency: 'GBP' }),
  ]);
  eq(top.top.length, 1, 'one currency, one answer — which is what the item asked for');
  eq(top.top[0].line.label, 'Rent', 'and it is the biggest line');
  eq(top.top[0].minorUnits, 45000, 'carrying its own amount');
  eq(top.skipped, 0, 'nothing was left out');

  // THE defect this shape exists to refuse. 1,200 dirhams is a smaller amount
  // of money than 450 pounds and a larger integer, and there is no rate in this
  // product that could say so.
  const mixed = biggestLines([
    line({ label: 'Rent', amountCents: 45000, currency: 'GBP' }),
    line({ label: 'Insurance', amountCents: 120000, currency: 'AED' }),
  ]);
  eq(mixed.top.length, 2, 'two currencies are two answers, never one ranking');
  eq(mixed.top[0].currency, 'AED', 'ordered by code, which is stable and is not a ranking');
  ok(mixed.top.every((b) => b.line.currency === b.currency), 'each answer is in its own money');

  // An amount with no unit is not an amount of money and cannot be the biggest
  // anything. Counted, so the answer is not read as "nothing here is larger".
  const holes = biggestLines([
    line({ amountCents: null }),
    line({ currency: null }),
    line({ currency: '  ' }),
    line({ label: 'Real', amountCents: 900, currency: 'GBP' }),
  ]);
  eq(holes.skipped, 3, 'the rows that cannot be ranked are counted');
  eq(holes.top[0].line.label, 'Real', 'and the one that can is the answer');

  eq(biggestLines([]).top.length, 0, 'an empty book has no biggest line');
  eq(biggestLines([]).skipped, 0, 'and nothing to leave out');
}

/* ── 5. ties are broken the same way every redraw ─────────────────────── */

{
  const tie = biggestLines([
    { id: 'a', day: '2026-08-01', amountCents: 45000, currency: 'GBP', label: 'August rent' },
    { id: 'b', day: '2026-09-01', amountCents: 45000, currency: 'GBP', label: 'September rent' },
  ]);
  eq(tie.top[0].line.id, 'b', 'two equal rents resolve to the later one, every time');

  const sameDay = biggestLines([
    { id: 'b', day: '2026-09-01', amountCents: 45000, currency: 'GBP', label: 'One' },
    { id: 'a', day: '2026-09-01', amountCents: 45000, currency: 'GBP', label: 'Two' },
  ]);
  eq(sameDay.top[0].line.id, 'b', 'and on the same day, by id — so a redraw cannot swap them');
}

/* ── 6. the sentences that keep both screens honest ───────────────────── */

{
  ok(MONTHS_ARE_WHAT_YOU_WROTE_DOWN.includes('not a return'), 'a month total is not a tax period and says so');
  ok(BIGGEST_IS_OF_WHAT_YOU_RECORDED.includes('not necessarily the biggest one there was'),
    'and the biggest line is the biggest RECORDED line');
}

if (errors.length) {
  console.error(`moneyBook.test.ts — ${errors.length} failed`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('moneyBook.test.ts — all assertions passed');
