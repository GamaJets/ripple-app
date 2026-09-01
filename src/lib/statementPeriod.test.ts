// A year that does not start in January. Compile with tsc, run under node.
//
// A statement is handed to an accountant, so the failure this file is aimed at
// is a document that covers the wrong twelve months and looks exactly like one
// that covers the right ones. Four specific ways that happens:
//
//   · a one-based month number fed to a zero-based month index, which shifts a
//     whole statement by a month and produces a perfectly plausible document;
//   · a year end computed from a table of month lengths, which is wrong for a
//     year that starts on 29 February and for one that starts mid-month;
//   · quarters counted from January inside a year that starts in April, so
//     "Q1 2026/27" and "Q1 2026" name different three-month periods under
//     labels a reader cannot tell apart;
//   · a backwards custom range silently swapped, producing a period nobody
//     asked for with nothing on the page to give it away.
import {
  fiscalYear,
  fiscalQuarter,
  customRange,
  isCalendarStart,
  calendarYear,
  calendarQuarter,
  periodRange,
  CALENDAR_YEAR_START,
  YEAR_START_IS_YOURS,
} from './coachStatement';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => { if (!Object.is(a, b)) errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); };

/* ── 1. the calendar year is still exactly what it was ──────────────────── */

// The default argument has to reproduce the old behaviour byte for byte, or
// every statement a coach has already taken changes the day this ships.
{
  const a = fiscalYear(2026);
  const b = calendarYear(2026);
  eq(a.from, b.from, 'a default fiscal year opens where the calendar year did');
  eq(a.to, b.to, 'and closes where it did');
  eq(a.label, b.label, 'and is labelled the same');
  eq(a.label, '2026', 'a calendar year is labelled with one year, because it is in one');
}
for (const q of [1, 2, 3, 4]) {
  const a = fiscalQuarter(2026, q);
  const b = calendarQuarter(2026, q);
  eq(a.from, b.from, `Q${q} of a default year opens where the calendar quarter did`);
  eq(a.to, b.to, `and closes where it did`);
  eq(a.label, b.label, `and is labelled the same`);
}

ok(isCalendarStart(CALENDAR_YEAR_START), 'the default start is the calendar one');
ok(!isCalendarStart({ month: 4, day: 6 }), 'and 6 April is not');

/* ── 2. the month number is one-based, all the way through ──────────────── */

// THE bug this is aimed at. `iso()` in this module takes a ZERO-BASED index,
// like Date does, and a year start is the 1-to-12 number a person types. Feed
// one to the other and a UK coach's April year opens in May — a whole statement
// for the wrong twelve months, with a heading that reads correctly.
{
  const uk = fiscalYear(2026, { month: 4, day: 6 });
  eq(uk.from, '2026-04-06', 'a year starting 6 April opens on 6 April');
  eq(uk.to, '2027-04-05', 'and closes the day before the anniversary');
  eq(uk.label, '2026/27', 'and spans both calendar years in its label');
}
{
  const au = fiscalYear(2026, { month: 7, day: 1 });
  eq(au.from, '2026-07-01', 'a year starting 1 July opens on 1 July');
  // A start on the 1st is the case a naive "anniversary minus a day" gets
  // wrong: `new Date(y + 1, 6, 0)` has to normalise a day number of 0 to the
  // last day of the PREVIOUS month, which it does.
  eq(au.to, '2027-06-30', 'and closes on 30 June');
}

/* ── 3. the end is an anniversary, not a table of month lengths ─────────── */

// 2028 is a leap year. A year opening on 1 March 2027 closes on 29 February
// 2028, which no fixed table of month lengths produces.
eq(fiscalYear(2027, { month: 3, day: 1 }).to, '2028-02-29', 'a leap day is the last day of the year that contains it');
// And the reverse: a year that OPENS on 29 February closes on 28 February,
// because the anniversary in a non-leap year normalises to 1 March and stepping
// back one day lands on the last day of February.
eq(fiscalYear(2028, { month: 2, day: 29 }).from, '2028-02-29', 'a year may open on a leap day');
eq(fiscalYear(2028, { month: 2, day: 29 }).to, '2029-02-28', 'and closes on the last day of February in a year with no 29th');

// A day past the end of its own month is the last day of that month, never a
// rollover into the next one. A coach who types 31 for a February start means
// the end of February; `new Date(y, 1, 31)` would silently give them 3 March.
eq(fiscalYear(2026, { month: 2, day: 31 }).from, '2026-02-28', 'a start day past the end of its month is clamped, not rolled over');
eq(fiscalYear(2026, { month: 4, day: 31 }).from, '2026-04-30', 'and April has thirty days');
eq(fiscalYear(2026, { month: 13, day: 1 }).from, '2026-12-01', 'a month past December is clamped rather than rolled into next year');
eq(fiscalYear(2026, { month: 0, day: 0 }).from, '2026-01-01', 'and a zero month and day are the first of January');

/* ── 4. every day is in exactly one period ──────────────────────────────── */

// The join between one year and the next. A gap loses a day of somebody's
// takings; an overlap counts a day twice, in two documents that both look
// complete.
for (const start of [{ month: 1, day: 1 }, { month: 4, day: 6 }, { month: 7, day: 1 }, { month: 10, day: 15 }]) {
  const a = fiscalYear(2026, start);
  const b = fiscalYear(2027, start);
  const ra = periodRange(a)!;
  const rb = periodRange(b)!;
  eq(ra.toMs, rb.fromMs, `one year ends exactly where the next begins (start ${start.month}/${start.day})`);
}

// The four quarters tile the year, with no gap and no overlap.
for (const start of [{ month: 1, day: 1 }, { month: 4, day: 6 }, { month: 7, day: 1 }]) {
  const y = fiscalYear(2026, start);
  eq(fiscalQuarter(2026, 1, start).from, y.from, `Q1 opens with the year (start ${start.month}/${start.day})`);
  eq(fiscalQuarter(2026, 4, start).to, y.to, `Q4 closes with it (start ${start.month}/${start.day})`);
  for (const q of [1, 2, 3]) {
    const here = periodRange(fiscalQuarter(2026, q, start))!;
    const next = periodRange(fiscalQuarter(2026, q + 1, start))!;
    eq(here.toMs, next.fromMs, `Q${q} ends where Q${q + 1} begins (start ${start.month}/${start.day})`);
  }
}

/* ── 5. quarters are counted from the coach's own start ─────────────────── */

// Not from January. "Q1 2026/27" for a year starting 6 April is April to July,
// and if it were January to March it would be a different three months under a
// label a reader cannot tell from the right one.
{
  const q1 = fiscalQuarter(2026, 1, { month: 4, day: 6 });
  eq(q1.from, '2026-04-06', 'Q1 of an April year opens in April');
  eq(q1.to, '2026-07-05', 'and closes the day before July the 6th');
  eq(q1.label, 'Q1 2026/27', 'and its label carries the split year, so it cannot be read as a calendar quarter');
  // Q4 crosses into the next calendar year, and has to take the year with it.
  const q4 = fiscalQuarter(2026, 4, { month: 4, day: 6 });
  eq(q4.from, '2027-01-06', 'Q4 of an April year opens in the next calendar year');
  eq(q4.to, '2027-04-05', 'and closes with the year');
}
eq(fiscalQuarter(2026, 9, { month: 4, day: 6 }).label, 'Q4 2026/27', 'a quarter number past four is clamped rather than wrapped');
eq(fiscalQuarter(2026, 0, { month: 4, day: 6 }).label, 'Q1 2026/27', 'and one below one is too');

/* ── 6. any two dates, or nothing at all ────────────────────────────────── */

{
  const p = customRange('2026-03-01', '2026-05-31')!;
  ok(!!p, 'two readable dates in order are a period');
  eq(p.from, '2026-03-01', 'the first is the start');
  eq(p.to, '2026-05-31', 'the second is the end');
  ok(p.label.includes('1 Mar 2026') && p.label.includes('31 May 2026'), 'and the label spells both out rather than saying "custom"');
}
ok(!!customRange('2026-03-01', '2026-03-01'), 'a single day is a period');

// Refused, never corrected. A silently swapped pair produces a document for a
// period the coach did not ask for, headed with dates they did not choose, and
// there is no cue on the page that would give it away.
eq(customRange('2026-05-31', '2026-03-01'), null, 'a backwards range is refused rather than swapped');
eq(customRange('', ''), null, 'and so is an empty one');
eq(customRange('2026-3-1', '2026-05-31'), null, 'and one that is not zero-padded');
eq(customRange('last march', '2026-05-31'), null, 'and one that is words');
// Passes the shape test and is not a day that exists. `periodRange` is the one
// authority on whether a period is real, and a period with no bounds would read
// every table with no filter at all.
eq(customRange('2026-02-30', '2026-05-31'), null, 'and one naming a day that does not exist');

/* ── 7. the sentence that keeps this out of tax advice ──────────────────── */

ok(/does not know which tax year/i.test(YEAR_START_IS_YOURS), 'the page says this app does not know the coach’s tax year');
ok(/has not inferred/i.test(YEAR_START_IS_YOURS), 'and that it has not guessed one from anything');
ok(/does not check/i.test(YEAR_START_IS_YOURS), 'and that it has not checked the one they chose');

declare const process: { exit(code: number): void };
console.log(errors.length ? 'STATEMENT PERIOD FAILURES:\n' + errors.join('\n') : 'ALL STATEMENT PERIOD TESTS PASSED');
if (errors.length) process.exit(1);
