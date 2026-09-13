// Whether a streak is a figure or a floor.
//
// The assertions that matter are the two ends of one question: a chain that
// stopped because the member missed a day is a streak, and a chain that stopped
// because the READ stopped is a lower bound wearing a streak's clothes. The
// second is what `app/(client)/consistency.tsx` was printing as a fact to the
// members with the longest runs in the gym — the ones whose logs are big enough
// to be truncated in the first place.
//
// Compile with tsc, then run under plain node.
import {
  chainOldestDay, streakBounded, streakClaim, boundedStreakUnit, BOUNDED_STREAK_NOTE,
} from './streakReach';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

/** Local midday on a given calendar day, so the fixture is the same calendar
 *  day in every zone the suite is ever run in. */
const noon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0, 0).getTime();

const NOW = noon(2026, 9, 13); // Sunday 13 September 2026

/* ── 1. where the chain starts ────────────────────────────────────────────── */

eq(chainOldestDay(1, 0, true, NOW), '2026-09-13', 'a one-day streak logged today starts today');
eq(chainOldestDay(14, 0, true, NOW), '2026-08-31', 'a fortnight ending today opened on the 31st');

// Not logged today: `currentStreakFrozen` anchors on yesterday, so the whole
// chain shifts a day back. Getting this wrong dates the run to the wrong day
// and, worse, moves it off the read boundary by one.
eq(chainOldestDay(14, 0, false, NOW), '2026-08-30', 'an unlogged today anchors the chain on yesterday');

// A freeze is a day INSIDE the chain that has no session on it. It does not
// count towards the streak and it does occupy a calendar day, so the run
// reaches further back than the streak figure alone says.
eq(chainOldestDay(14, 2, true, NOW), '2026-08-29', 'two bridged days push the start two days earlier');

eq(chainOldestDay(0, 0, true, NOW), null, 'no streak is no chain');
eq(chainOldestDay(-3, 0, true, NOW), null, 'and neither is a negative one');
eq(chainOldestDay(5, Number.NaN, true, NOW), '2026-09-09', 'an unusable freeze count bridges nothing');

/* ── 2. calendar arithmetic, not clock arithmetic ─────────────────────────── */

// Ten days back from 1 November 2026 is 23 October in every zone on earth.
// Subtracting a fixed 86,400,000 ten times lands on the 22nd wherever the
// clocks went back in between — which is the defect src/lib/streaks.ts fixed in
// its own cursor and which a second implementation would quietly reintroduce.
eq(chainOldestDay(10, 0, true, noon(2026, 11, 1)), '2026-10-23',
  'a span crossing a clocks change is still ten calendar days');
eq(chainOldestDay(10, 0, true, noon(2026, 4, 1)), '2026-03-23',
  'and so is one crossing the spring change');

// Month and year edges, where an off-by-one is invisible in the middle of a
// month and obvious here.
eq(chainOldestDay(1, 0, true, noon(2026, 1, 1)), '2026-01-01', 'new year’s day, alone');
eq(chainOldestDay(3, 0, true, noon(2027, 1, 1)), '2026-12-30', 'a chain that crosses into last year');
eq(chainOldestDay(2, 0, true, noon(2028, 3, 1)), '2028-02-29', 'and one that lands on a leap day');

/* ── 3. is the chain inside what was read ─────────────────────────────────── */

// The chain stopped above the boundary: the day that broke it came back, so the
// streak is a statement about the member.
eq(streakBounded('2026-09-01', '2026-08-31', true), false,
  'a chain that ends after the oldest read day is established');

// The chain ran all the way to the oldest day that came back. Everything older
// is unread, so the run may continue and the figure is a floor.
eq(streakBounded('2026-08-31', '2026-08-31', true), true,
  'a chain that reaches the oldest read day is only a floor');
eq(streakBounded('2026-08-30', '2026-08-31', true), true,
  'and so is one that would reach past it');

// A whole read has no boundary. This is the guard that stops the qualifier
// appearing on the screens of members whose logs fit comfortably.
eq(streakBounded('2026-08-31', '2026-08-31', false), false,
  'a read that was not truncated bounds nothing');

eq(streakBounded(null, '2026-08-31', true), false, 'no chain, nothing to bound');
eq(streakBounded('2026-08-31', null, true), false, 'no oldest day, nothing to bound against');

// Compared as strings, never parsed. Zero-padded YYYY-MM-DD orders
// lexicographically in every zone, which is the whole reason the keys are kept
// as keys.
eq(streakBounded('2026-10-01', '2026-09-30', true), false, 'October is after September as a string too');
eq(streakBounded('2026-09-09', '2026-09-10', true), true, 'and the ninth is before the tenth');

/* ── 4. the two readings, end to end ──────────────────────────────────────── */

// The case this file exists for. Seven `workouts` rows per gym visit against a
// thousand-row cap is about a hundred and forty days of reach; a member who has
// trained every day for six months has a chain that runs straight off the
// bottom of it.
const long = streakClaim(140, 0, true, '2026-04-27', true, NOW);
eq(long.days, 140, 'the figure is what the log supports');
ok(long.bounded, 'a six-month trainer read back a hundred and forty days is a floor, not a figure');

// The ordinary case: a fortnight, on a truncated log whose boundary is a year
// old. Nothing about the truncation touches this chain.
const short = streakClaim(14, 0, true, '2025-09-13', true, NOW);
eq(short.days, 14, 'a fortnight is a fortnight');
ok(!short.bounded, 'a boundary a year below the chain does not qualify it');

// Whole read, same chain: no qualifier, ever.
ok(!streakClaim(140, 0, true, '2026-04-27', false, NOW).bounded,
  'a whole read is never bounded, however long the run');

// No streak at all: nothing to qualify, and no accidental `true` off a null
// chain compared against a boundary.
const none = streakClaim(0, 0, false, '2026-04-26', true, NOW);
eq(none.days, 0, 'no streak is zero days');
ok(!none.bounded, 'and zero days is not a floor');

// A figure that is not a figure does not become one on the way through.
eq(streakClaim(Number.NaN, 0, true, '2026-04-26', true, NOW).days, 0, 'NaN is not a streak');

/* ── 5. what the screen says ──────────────────────────────────────────────── */

eq(boundedStreakUnit(1), 'day or more', 'one day is singular');
eq(boundedStreakUnit(14), 'days or more', 'and everything else is not');
ok(/may be longer/.test(BOUNDED_STREAK_NOTE), 'the note says the run may be longer');
ok(!/lost|broken|missed/i.test(BOUNDED_STREAK_NOTE.replace('Nothing has been lost', '')),
  'and it does not tell anybody their streak broke');

/* ── done ─────────────────────────────────────────────────────────────────── */

if (errors.length) {
  console.error(`streakReach: ${errors.length} failure(s)`);
  for (const e of errors) console.error(' · ' + e);
  process.exit(1);
}
console.log('streakReach: ok');
