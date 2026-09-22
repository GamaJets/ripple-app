// The month grid, asserted as a calendar rather than as a copy of itself.
// Compile with tsc, run with node.
//
// ── The rule this suite is written to ─────────────────────────────────────
//
// Not one assertion below states a literal that was read out of
// `monthGrid.ts`. A test that says `eq(grid.leading, 2)` for September 2026
// passes for a grid built the right way and for a grid built by an off-by-one
// that happens to agree on that month, and it fails the day the product moves
// its week to Monday even though nothing is broken. So the assertions are
// PROPERTIES:
//
//   · every day of the month appears once, in order, in the column its own
//     weekday puts it in;
//   · the columns are the product's week, taken from `jsDayForIndex`, not from
//     a number typed here;
//   · a month's length is what makes a year 365 or 366 days long;
//   · stepping forward and back is an identity, and twelve steps is a year.
//
// The two literals that ARE stated are facts about the Gregorian calendar and
// not about this implementation: 1 January 2023 was a Sunday (the same anchor
// `src/lib/calendarNames.ts` builds its weekday names from), and 2000 was a leap
// year while 1900 was not.
//
// ── And it is run under six timezones ─────────────────────────────────────
//
// `npm run test:zones`. A calendar assembled from `new Date()` in one zone and
// read back in another is the defect this codebase keeps finding — see
// src/lib/localDate.ts for two that shipped — so the grid's zone-independence
// is asserted here rather than hoped for: the sweep below is a pure function of
// integers and must give the same answer in Kiritimati and in Midway, and
// `todayParts` is checked against the reader's OWN local getters, which is the
// only thing it is allowed to mean.
import {
  isLeapYear, daysInMonth, weekdayOf, normalMonth, stepMonth, monthGrid,
  gridRows, isoFromParts, todayParts, openMonth,
} from './monthGrid';
import { dayIndexInWeek, jsDayForIndex, WEEK_STARTS_ON } from './weekStart';
import { dateParts } from './localDate';
import { isStartDate } from './programStart';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── leap years, by the rule and not by `% 4` ─────────────────────────────── */

ok(isLeapYear(2024), '2024 is a leap year');
ok(!isLeapYear(2023), '2023 is not');
ok(isLeapYear(2000), '2000 is a leap year — divisible by 400');
ok(!isLeapYear(1900), '1900 is not — divisible by 100 and not by 400');
ok(!isLeapYear(2100), 'nor is 2100');

/* ── February, both ways ──────────────────────────────────────────────────── */

eq(daysInMonth(2024, 1), 29, 'February in a leap year');
eq(daysInMonth(2023, 1), 28, 'February in a non-leap year');
eq(daysInMonth(2000, 1), 29, 'February 2000');
eq(daysInMonth(1900, 1), 28, 'February 1900');

// A leap February fills exactly four columns more than a common one, which is
// the property the grid actually depends on.
eq(monthGrid(2024, 1).days - monthGrid(2023, 1).days, 1,
  'the leap day is one extra cell and not a whole extra row of them');
ok(monthGrid(2024, 1).cells.filter((c) => c === 29).length === 1,
  'a leap February draws a 29 exactly once');
ok(monthGrid(2023, 1).cells.every((c) => c !== 29),
  'a common February draws no 29 at all');

/* ── month lengths, checked by what they add up to ────────────────────────── */

for (const year of [1999, 2000, 2023, 2024, 2026, 2027, 2100]) {
  let total = 0;
  for (let m = 0; m < 12; m++) {
    const n = daysInMonth(year, m);
    ok(n >= 28 && n <= 31, `${year}-${m}: a month is 28 to 31 days, got ${n}`);
    total += n;
  }
  eq(total, isLeapYear(year) ? 366 : 365, `${year}: the twelve months make the year`);
}

/* ── the weekday, against the calendar rather than against a Date ─────────── */

// 1 January 2023 was a Sunday. `src/lib/calendarNames.ts` builds its whole
// weekday row on that same fact, so if this is wrong the names are too.
eq(weekdayOf(2023, 0, 1), 0, '1 January 2023 was a Sunday');

// Consecutive days advance by exactly one column, across a month boundary, a
// year boundary and a leap day. This is the property; the anchor above fixes
// which of the seven answers is "Sunday".
{
  const walk = (y: number, m: number, d: number, days: number, what: string) => {
    let prev = weekdayOf(y, m, d);
    let cy = y, cm = m, cd = d;
    for (let i = 0; i < days; i++) {
      cd += 1;
      if (cd > daysInMonth(cy, cm)) { cd = 1; const n = stepMonth(cy, cm, 1); cy = n.year; cm = n.month; }
      const now = weekdayOf(cy, cm, cd);
      eq(now, (prev + 1) % 7, `${what}: ${cy}-${cm + 1}-${cd} follows the day before it`);
      prev = now;
    }
  };
  walk(2024, 1, 26, 10, 'across the leap day');
  walk(2023, 1, 26, 10, 'across the end of a common February');
  walk(2026, 11, 26, 12, 'across New Year');
}

/* ── the grid, swept ──────────────────────────────────────────────────────── */

// Thirty-four years of months, every one of them checked against the same four
// properties. A month that is drawn wrong anywhere in that range fails here,
// which is what a sweep buys over three hand-picked examples.
for (let year = 1999; year <= 2032; year++) {
  for (let month = 0; month < 12; month++) {
    const g = monthGrid(year, month);
    const where = `${year}-${String(month + 1).padStart(2, '0')}`;

    eq(g.cells.length % 7, 0, `${where}: the grid is whole weeks`);
    eq(g.cells.length, g.leading + g.days + g.trailing, `${where}: blanks and days account for every cell`);
    eq(g.weeks, g.cells.length / 7, `${where}: weeks counts the rows`);
    ok(g.leading >= 0 && g.leading < 7, `${where}: fewer than seven leading blanks`);
    ok(g.trailing >= 0 && g.trailing < 7, `${where}: fewer than seven trailing blanks`);
    ok(g.weeks >= 4 && g.weeks <= 6, `${where}: a month needs four to six rows, got ${g.weeks}`);

    // The blanks are at the two ends and nowhere else: no hole in the middle of
    // a month, which is what an off-by-one in the padding would look like.
    for (let i = 0; i < g.cells.length; i++) {
      const blank = g.cells[i] == null;
      const shouldBeBlank = i < g.leading || i >= g.leading + g.days;
      eq(blank, shouldBeBlank, `${where}: cell ${i} blank-ness`);
    }

    // Every day, once, in order.
    const days = g.cells.filter((c): c is number => c != null);
    eq(days.length, g.days, `${where}: as many days as the month has`);
    eq(days.length, daysInMonth(year, month), `${where}: and it agrees with daysInMonth`);
    ok(days.every((d, i) => d === i + 1), `${where}: the days run 1..${g.days} in order`);

    // THE property: each day sits in the column its own weekday puts it in,
    // where the columns are the product's week and not a number written here.
    for (let i = 0; i < g.cells.length; i++) {
      const d = g.cells[i];
      if (d == null) continue;
      eq(i % 7, dayIndexInWeek(weekdayOf(year, month, d)),
        `${where}: day ${d} is in its own weekday's column`);
    }
  }
}

// The first column IS the week's start day, whatever that day is set to. This
// is the assertion that keeps the grid honest if `WEEK_STARTS_ON` ever moves:
// nothing above states Sunday, so nothing above has to change.
eq(jsDayForIndex(0), WEEK_STARTS_ON, 'column zero is the day the week starts on');
{
  // A month that opens ON the start day has no leading blanks, and one that
  // opens the day after has exactly one. Found rather than asserted, so the
  // test does not name a month.
  let openers = 0, seconds = 0;
  for (let year = 2020; year <= 2030; year++) {
    for (let month = 0; month < 12; month++) {
      const g = monthGrid(year, month);
      const idx = dayIndexInWeek(weekdayOf(year, month, 1));
      if (idx === 0) { openers++; eq(g.leading, 0, `${year}-${month + 1} opens the week: no leading blanks`); }
      if (idx === 1) { seconds++; eq(g.leading, 1, `${year}-${month + 1} opens one day in: one leading blank`); }
    }
  }
  ok(openers > 0 && seconds > 0, 'the sweep found months of both shapes to check');
}

/* ── rows ─────────────────────────────────────────────────────────────────── */

{
  const g = monthGrid(2026, 8);
  const rows = gridRows(g);
  eq(rows.length, g.weeks, 'gridRows gives one array per week');
  ok(rows.every((r) => r.length === 7), 'and seven cells in each');
  eq(rows.flat().join(','), g.cells.join(','), 'and loses nothing on the way');
}

/* ── stepping months ──────────────────────────────────────────────────────── */

// December → January carries the year forward.
{
  const n = stepMonth(2026, 11, 1);
  eq(n.year, 2027, 'December steps forward into the next year');
  eq(n.month, 0, 'and lands on January');
}
// January → December carries it back.
{
  const p = stepMonth(2026, 0, -1);
  eq(p.year, 2025, 'January steps back into the previous year');
  eq(p.month, 11, 'and lands on December');
}
// Twelve steps is a year, in both directions, and a step and its opposite are
// an identity — which is what a coach paging back and forth actually does.
for (let month = 0; month < 12; month++) {
  const up = stepMonth(2026, month, 12);
  eq(up.year, 2027, `month ${month}: twelve forward is next year`);
  eq(up.month, month, `month ${month}: and the same month`);
  const down = stepMonth(2026, month, -12);
  eq(down.year, 2025, `month ${month}: twelve back is last year`);
  eq(down.month, month, `month ${month}: and the same month`);
  for (const delta of [1, 5, 11, 13, -1, -7, -25]) {
    const there = stepMonth(2026, month, delta);
    const back = stepMonth(there.year, there.month, -delta);
    eq(back.year, 2026, `month ${month} ±${delta}: comes back to the year it left`);
    eq(back.month, month, `month ${month} ±${delta}: and to the month it left`);
  }
}
// A month index out of range means the month it counts to, and never a throw.
eq(normalMonth(2026, 12).year, 2027, 'month 12 of 2026 is 2027');
eq(normalMonth(2026, 12).month, 0, 'and is January');
eq(normalMonth(2026, -1).year, 2025, 'month -1 of 2026 is 2025');
eq(normalMonth(2026, -1).month, 11, 'and is December');
eq(normalMonth(2026, 5).month, 5, 'an in-range month is left alone');

// Paging a whole year forward one month at a time visits twelve distinct
// months and arrives where it started. This is the loop the sheet's chevrons
// run, and it is where a `month + 1 > 11` written by hand goes wrong.
{
  let y = 2026, m = 10;
  const seen = new Set<string>();
  for (let i = 0; i < 12; i++) { seen.add(`${y}-${m}`); const n = stepMonth(y, m, 1); y = n.year; m = n.month; }
  eq(seen.size, 12, 'a year of forward steps visits twelve different months');
  eq(`${y}-${m}`, '2027-10', 'and comes back round to the same month a year on');
}

/* ── the string a cell writes ─────────────────────────────────────────────── */

eq(isoFromParts(2026, 8, 7), '2026-09-07', 'month index is one-based on the wire');
eq(isoFromParts(2026, 0, 1), '2026-01-01', 'and both halves are padded');
eq(isoFromParts(2026, 11, 31), '2026-12-31', 'and December is 12');

// Every cell of a swept year produces something this app will actually store,
// and reads back as the day it was built from. `isStartDate` is the product's
// own gate on the field this sheet fills in; if a cell can produce a value it
// refuses, the sheet can hand a coach a date the assign button then rejects.
for (let month = 0; month < 12; month++) {
  const g = monthGrid(2024, month);
  for (const d of g.cells) {
    if (d == null) continue;
    const iso = isoFromParts(2024, month, d);
    ok(isStartDate(iso), `${iso} is a date this app will store`);
    const p = dateParts(iso);
    ok(p != null, `${iso} parses`);
    if (p) {
      eq(p[0], 2024, `${iso}: year survives the round trip`);
      eq(p[1], month, `${iso}: month survives the round trip`);
      eq(p[2], d, `${iso}: day survives the round trip`);
    }
  }
}

/* ── today's cell ─────────────────────────────────────────────────────────── */

// `todayParts` means the reader's own day, so it is checked against the reader's
// own local getters and against nothing else. Under `test:zones` this runs in
// six zones, three of which are on a different calendar day from each other at
// any given instant — which is the whole reason it is not `toISOString()`.
{
  const now = new Date();
  const [y, m, d] = todayParts(now);
  eq(y, now.getFullYear(), 'todayParts takes the local year');
  eq(m, now.getMonth(), 'the local month');
  eq(d, now.getDate(), 'and the local day');

  // The day is in this month's grid, exactly once, and at the index its
  // position in the month puts it at.
  const g = monthGrid(y, m);
  eq(g.cells.filter((c) => c === d).length, 1, "today's number appears once in today's month");
  eq(g.cells[g.leading + d - 1], d, "and the cell at today's index is today");
  ok(d >= 1 && d <= g.days, 'today is a day this month has');

  // And the string a tap on that cell would write is the day the reader is
  // standing in — built from parts, so it is the same day in Midway and in
  // Kiritimati even though those two are never on the same date.
  const iso = isoFromParts(y, m, d);
  eq(iso, `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    "today's cell writes the reader's own calendar day");
  ok(isStartDate(iso), 'and it is a date this app will store');
}

// A fixed instant, so the assertion above is not the only thing standing
// between this and a clock. 14:30 UTC on 1 January is a different calendar day
// in Kiritimati (+14) and Midway (-11), and `todayParts` must answer with the
// one the READER is in, which is what the local getters say.
{
  const at = new Date(2026, 0, 1, 14, 30);
  const [y, m, d] = todayParts(at);
  eq(y, 2026, 'a stated local instant keeps its year');
  eq(m, 0, 'its month');
  eq(d, 1, 'and its day, in every zone this runs in');
}

/* ── which month the sheet opens on ───────────────────────────────────────── */

{
  const now = new Date(2026, 8, 3);
  eq(openMonth('2027-03-02', now).year, 2027, 'a typed date opens its own year');
  eq(openMonth('2027-03-02', now).month, 2, 'and its own month');
  eq(openMonth('', now).year, 2026, 'an empty field opens the reader\'s year');
  eq(openMonth('', now).month, 8, 'and the reader\'s month');
  eq(openMonth(null, now).month, 8, 'so does null');
  eq(openMonth(undefined, now).month, 8, 'and undefined');
  eq(openMonth('2026-0', now).month, 8, 'a half-typed date falls back rather than throwing');
  eq(openMonth('next tuesday', now).month, 8, 'and so does prose');
  // A date the app would REFUSE to store still opens a month rather than
  // nothing: the sheet is how the coach fixes it, so it must be reachable.
  ok(!isStartDate('2026-02-30'), 'the 30th of February is not a storable date');
  ok(Number.isFinite(openMonth('2026-02-30', now).month), 'but it still opens a month');
}

/* ── the same answer everywhere ───────────────────────────────────────────── */

// The grid is integers all the way down, so its output must not vary with the
// process zone at all. Nothing here can prove that from inside one process —
// `npm run test:zones` is what proves it, by running this file six times — but
// this pins the shape that makes it true: the same call, twice, with a clock
// moving underneath, is the same object.
{
  const a = monthGrid(2026, 1);
  const b = monthGrid(2026, 1);
  eq(a.cells.join(','), b.cells.join(','), 'the grid is a pure function of its arguments');
  eq(a.leading, b.leading, 'including its leading blanks');
}

if (errors.length) {
  console.error(`monthGrid: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('monthGrid: ok');
