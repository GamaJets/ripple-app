// The day a goal is due, asserted from the member's own calendar.
//
// Every `from` below is built with `new Date(y, m, d, h, min)` — the LOCAL
// constructor — and every expectation is the day a person holding that phone
// would count to. That is what makes these assertions timezone-independent
// while still catching a timezone bug: the answer is the same sentence in Los
// Angeles and in Auckland, and the two implementations that got this wrong
// disagree with it in opposite directions.
//
// The two mutations these are written against, both confirmed to fail here
// before the fix went in (npm run test:zones):
//
//   new Date(from + days * 86400000).toISOString().slice(0, 10)
//        — the shipped expression. Fails on the 20:00 cases west of UTC-4 and
//          on the 02:00 cases east of UTC+3.
//   base.setDate(base.getDate() + days) with the setHours(0,0,0,0) removed
//        — fails the daylight-saving case in any zone that has one.
//
// Compile with tsc, run with node.
import { targetDayIn } from './goalDeadline';

// Start failed and reach success, so a hang or an early exit cannot pass.
process.exitCode = 1;

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** A local wall-clock instant, the way the member's phone has it. */
const at = (y: number, mon: number, d: number, h = 12, min = 0) =>
  new Date(y, mon - 1, d, h, min, 0, 0).getTime();

/* ── the chips the screen actually offers ─────────────────────────────────
 *
 * 4, 8 and 12 weeks, counted on a calendar. Late evening and early morning are
 * both here on purpose: the UTC form is right for one of them in any given zone
 * and wrong for the other, so a single time of day would let it through in half
 * the world. */
{
  eq(targetDayIn(28, at(2026, 3, 10, 20, 0)), '2026-04-07',
    'four weeks from the evening of 10 March is 7 April — the member\'s evening, not UTC\'s next morning');
  eq(targetDayIn(28, at(2026, 3, 10, 2, 0)), '2026-04-07',
    'and four weeks from the small hours of the same day is the same 7 April — not UTC\'s previous evening');
  eq(targetDayIn(56, at(2026, 3, 10, 20, 0)), '2026-05-05', 'eight weeks from 10 March is 5 May');
  eq(targetDayIn(56, at(2026, 3, 10, 2, 0)), '2026-05-05', 'from either end of the same day');
  eq(targetDayIn(84, at(2026, 3, 10, 23, 45)), '2026-06-02',
    'twelve weeks from a quarter to midnight on 10 March is still counted from 10 March');
  eq(targetDayIn(84, at(2026, 3, 10, 0, 5)), '2026-06-02', 'and so is twelve weeks from five past midnight');
}

/* ── a clocks change inside the window ────────────────────────────────────
 *
 * `days * 86400000` is `days` lots of twenty-four hours. A calendar day that
 * loses an hour is twenty-three, so the millisecond form lands on the evening
 * of the day BEFORE — a day the member never chose. Both hemispheres, because
 * the shift goes the other way in one of them. */
{
  // Northern spring: the clocks go forward inside these four weeks in the US
  // (8 March), in Europe (29 March) and in New Zealand's autumn (5 April).
  eq(targetDayIn(28, at(2026, 3, 1, 0, 30)), '2026-03-29',
    'four weeks from half past midnight on 1 March is 29 March, even where an hour goes missing in between');
  eq(targetDayIn(28, at(2026, 10, 20, 0, 30)), '2026-11-17',
    'and four weeks from half past midnight on 20 October is 17 November, even where an hour is repeated');
}

/* ── month and year ends ──────────────────────────────────────────────────
 *
 * `setDate` past the end of a month rolls it; this is the part a hand-written
 * `${y}-${m}-${d + days}` would get wrong, and it is asserted rather than
 * assumed. */
{
  eq(targetDayIn(1, at(2026, 12, 31, 18, 0)), '2027-01-01', 'a day past new year\'s eve is new year\'s day');
  eq(targetDayIn(28, at(2028, 2, 1, 9, 0)), '2028-02-29', 'four weeks from 1 February 2028 lands on the leap day');
  eq(targetDayIn(28, at(2027, 2, 1, 9, 0)), '2027-03-01', 'and in a common year the same span lands on 1 March');
  eq(targetDayIn(365, at(2026, 9, 4, 9, 0)), '2027-09-04', 'a year of days is a year');
}

/* ── today, and the answers that are not days ─────────────────────────────── */
{
  eq(targetDayIn(0, at(2026, 9, 4, 23, 59)), '2026-09-04',
    'nought days is today — read at one minute to midnight, still today');
  eq(targetDayIn(null), null, 'no date is a real choice on this screen and stays null');
  eq(targetDayIn(undefined), null, 'and so does an absent one');
  eq(targetDayIn(28.5, at(2026, 3, 10)), null, 'half a day is not a target date');
  eq(targetDayIn(-7, at(2026, 3, 10)), null, 'and neither is a date in the past');
  eq(targetDayIn(Number.NaN, at(2026, 3, 10)), null, 'nor a figure that is not a number');
  eq(targetDayIn(28, Number.NaN), null, 'an unreadable instant yields no day rather than "NaN-NaN-NaN"');
}

/* ── the shape the database column takes ──────────────────────────────────
 *
 * `goal_targets.target_date` is a bare Postgres `date` and src/ui/goalTracker.tsx
 * writes `.slice(0, 10)` of whatever it is handed. A value that is already ten
 * characters passes through that untouched, which is the property that lets the
 * screen hand this straight over. */
{
  const d = targetDayIn(84, at(2026, 3, 10, 20, 0));
  ok(typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d), `a bare YYYY-MM-DD, got ${JSON.stringify(d)}`);
  eq(d!.slice(0, 10), d, 'and the slice goalTracker takes of it is the whole of it');
}

if (errors.length) {
  console.error('goalDeadline.test FAILED');
  for (const e of errors) console.error(' · ' + e);
  process.exit(1);
}
console.log('goalDeadline.test passed');
process.exitCode = 0;
