// Year-on-year, and how long people stay. Compile with tsc, run with node.
//
// Two rules, and both are refusals:
//
//   1. a year-on-year comparison against a month nobody recorded is not a weak
//      comparison, it is a fabricated one. `yearOnYear` returns null rather
//      than reaching for the nearest month it has — the exact substitution
//      src/lib/monthlyHistory.ts exists to prevent, one level up;
//   2. a cohort's retention at a milestone it has not REACHED is null, never
//      zero. A zero there draws as a cliff on the right-hand side of the chart,
//      which is where a reader's eye ends up, and the cliff is the calendar
//      rather than the coach's business.
//
// And the survivorship trap the whole module exists around: a curve built from
// the roster is flat at 100% forever, because the roster is the people who did
// not leave.
import {
  yearOnYear, monthsUntilYearOnYear, yearOnYearLine,
  cohorts, cohortsBlocker, MILESTONES, COHORT_CAVEAT, COHORT_FLOOR_NOTE,
  type CoachingSpan,
} from './coachCohorts';
import { MIN_COHORT_FOR_RATE } from './gymRetention';
import type { Snapshots } from './monthlyHistory';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the same month last year ──────────────────────────────────────────── */

// August 2026, with the previous August recorded. Built in LOCAL time, because
// `monthKey` is local and deliberately so — a coach in Auckland opening the app
// at 9am on 1 August is in August.
const aug26 = new Date(2026, 7, 12, 9, 0, 0, 0);

const full: Snapshots = {
  '2025-08': 4000, '2025-09': 4200, '2025-12': 5100,
  '2026-06': 5000, '2026-07': 5200, '2026-08': 6000,
};
const yoy = yearOnYear(full, aug26);
ok(yoy != null, 'with both ends recorded there is a comparison');
eq(yoy?.now, 6000, 'this month');
eq(yoy?.then, 4000, 'the same month last year');
eq(yoy?.delta, 2000, 'and the difference');
eq(yoy?.pct, 50, 'as a percentage of last year');

// Both directions, and the percentage is of LAST year rather than of this one.
eq(yearOnYear({ '2025-08': 8000, '2026-08': 6000 }, aug26)?.pct, -25, 'a fall is a fall of last year, not of this year');

// There is no percentage of nothing. "+100%" over a zero base is a figure with
// no meaning that reads like a triumph.
eq(yearOnYear({ '2025-08': 0, '2026-08': 6000 }, aug26)?.pct, null, 'a change from zero has no percentage');
eq(yearOnYear({ '2025-08': 0, '2026-08': 6000 }, aug26)?.delta, 6000, 'but the delta is still stated, which is the honest way to say it');

/* ── and the refusals ──────────────────────────────────────────────────── */

eq(yearOnYear({ '2026-08': 6000 }, aug26), null, 'no month last year is no comparison');
eq(yearOnYear({ '2025-08': 4000 }, aug26), null, 'and neither is a month this year that was never recorded');
// The substitution this whole module refuses: reaching for July 2025 because
// August 2025 is missing.
eq(yearOnYear({ '2025-07': 4000, '2026-08': 6000 }, aug26), null,
  'the month BEFORE the one it needs is not a substitute for it');
eq(yearOnYear({}, aug26), null, 'and an empty history compares nothing');

// December and January, which is where naive year arithmetic breaks.
const jan26 = new Date(2026, 0, 15, 9, 0, 0, 0);
eq(yearOnYear({ '2025-01': 100, '2026-01': 150 }, jan26)?.delta, 50, 'January against January works across the year boundary');

/* ── how far away it is ────────────────────────────────────────────────── */

eq(monthsUntilYearOnYear(full, aug26), 0, 'with the month recorded there is nothing to wait for');
eq(monthsUntilYearOnYear({}, aug26), 12, 'a coach with no history at all waits a year');
// History back to January, so seven month-steps behind August. The month the
// comparison needs is twelve behind, which is five further.
eq(monthsUntilYearOnYear({ '2026-01': 1, '2026-08': 2 }, aug26), 5,
  'and a coach part-way through their first year is told how many months away it is rather than that the feature is missing');

/* ── the sentence, and what it never says ──────────────────────────────── */

ok(/could not be read/i.test(yearOnYearLine(full, aug26, 'error')),
  'a failed read says the read failed');
ok(!/no history/i.test(yearOnYearLine(full, aug26, 'error').replace(/"no history"/, '')),
  'and does not state it as a fact about the coach');
ok(/5 months/.test(yearOnYearLine({ '2026-01': 1, '2026-08': 2 }, aug26, 'ready')),
  'a coach who is short of history is told how short');
ok(/gap in the history/i.test(yearOnYearLine({ '2024-01': 1, '2026-08': 2 }, aug26, 'ready')),
  'and a hole is called a hole rather than a quiet month');
ok(/not been recorded/i.test(yearOnYearLine({ '2025-08': 1 }, aug26, 'ready')),
  'an unrecorded current month says so');
for (const s of ['loading', 'ready', 'error'] as const) {
  const line = yearOnYearLine(full, aug26, s);
  ok(!/flat|no change|unchanged/i.test(line), `under '${s}' the line never claims the coach's trading was flat`);
}

/* ── cohorts: the milestone nobody has reached is null ─────────────────── */

const MONTH = 30.436875 * 86_400_000;
const ago = (months: number) => new Date(aug26.getTime() - months * MONTH).toISOString();

// Twelve people who all started three months ago. Eight are still coaching.
const three: CoachingSpan[] = [
  ...Array.from({ length: 8 }, () => ({ startedAt: ago(3.2), endedAt: null })),
  ...Array.from({ length: 4 }, () => ({ startedAt: ago(3.2), endedAt: ago(0.5) })),
];
const rows = cohorts(three, aug26);
eq(rows.length, 1, 'one join month, one cohort');
eq(rows[0].size, 12, 'twelve joined');
eq(MILESTONES[0], 1, 'the milestones start at one month');
eq(rows[0].held[0], 12, 'all twelve were still there at one month');
// The four who left did so two and a bit months in, so they did not make three.
eq(rows[0].held[1], 8, 'eight of them made it to three');
eq(rows[0].held[2], null, 'six months has not happened yet, so it is UNKNOWN and not zero');
eq(rows[0].held[3], null, 'and neither has twelve');
eq(rows[0].retained[2], null, 'the percentage is null there too rather than 0%');

/* ── and the survivorship trap ─────────────────────────────────────────── */

// Everybody who left, removed — which is what a curve built from the roster
// would be. It must NOT come out the same as the real one.
const survivorsOnly = three.filter((s) => s.endedAt == null);
const fake = cohorts(survivorsOnly, aug26);
// Counts rather than percentages, because eight people is under the floor —
// which is itself the point of `held` existing beside `retained`.
eq(fake[0].held[1], fake[0].size, 'a curve built from only the people who stayed retains everybody, at every milestone');
ok((rows[0].held[1] ?? 0) < rows[0].size,
  'and the real one, with the endings in it, does not — which is why this reads coaching_relationships and not the roster');

/* ── the floor: a count always, a percentage only above it ─────────────── */

const small: CoachingSpan[] = [
  ...Array.from({ length: 4 }, () => ({ startedAt: ago(7), endedAt: null })),
  ...Array.from({ length: 2 }, () => ({ startedAt: ago(7), endedAt: ago(5) })),
];
const smallRow = cohorts(small, aug26)[0];
eq(smallRow.size, 6, 'six people');
ok(smallRow.tooSmall, `six is under the floor of ${MIN_COHORT_FOR_RATE}`);
eq(smallRow.retained[2], null, 'so no percentage is stated — three of five leaving is not the same fact as 40% of two hundred');
eq(smallRow.held[2], 4, 'but the COUNT is, because a count makes no claim beyond itself');
ok(smallRow.held.every((h) => h === null || (h >= 0 && h <= smallRow.size)), 'and never exceeds the cohort');

const big: CoachingSpan[] = [
  ...Array.from({ length: 15 }, () => ({ startedAt: ago(7), endedAt: null })),
  ...Array.from({ length: 5 }, () => ({ startedAt: ago(7), endedAt: ago(2) })),
];
const bigRow = cohorts(big, aug26)[0];
ok(!bigRow.tooSmall, 'twenty is above the floor');
eq(bigRow.retained[2], 75, 'so the percentage is stated');
eq(bigRow.held[2], 15, 'alongside the count it came from');

/* ── an unreadable date is dropped rather than grouped with the rest ───── */

const messy = cohorts([{ startedAt: 'not a date', endedAt: null }, { startedAt: ago(2), endedAt: null }], aug26);
eq(messy.length, 1, 'a relationship with no readable start is in no cohort rather than in a NaN one');

/* ── the read has to be whole ──────────────────────────────────────────── */

eq(cohortsBlocker('ready'), null, 'a whole history may be drawn');
ok(cohortsBlocker('partial') != null, 'a truncated one may not — the missing rows may be the endings');
ok(/100/.test(cohortsBlocker('partial') as string), 'and the refusal says what the curve would look like without them');
ok(cohortsBlocker('error') != null, 'and neither may one that did not come back');
ok(cohortsBlocker('loading') != null, 'nor one still arriving');

/* ── the caveats, said on the screen ───────────────────────────────────── */

ok(/came back|left/i.test(COHORT_CAVEAT), 'the re-join caveat is stated, because it flatters the number');
ok(/better than the truth/i.test(COHORT_CAVEAT), 'and in which direction');
ok(COHORT_FLOOR_NOTE.includes(String(MIN_COHORT_FOR_RATE)),
  'the floor sentence carries the actual number, so the two cannot drift apart');

if (errors.length) {
  for (const e of errors) console.error('  ✗ ' + e);
  console.error(`coachCohorts: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('coachCohorts: ok (no comparison against a month nobody recorded, and no zero at a milestone nobody has reached)');
