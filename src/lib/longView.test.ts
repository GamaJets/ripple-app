// The long view's monthly figures — and the three of them nothing rendered.
//
// src/lib/longView.ts has computed `kcal`, `best1RM` and `topLift` for every
// month since it was written, and had no test file at all. The client's own
// History screen rendered none of the three; app/(trainer)/client-training.tsx
// rendered `topLift` and nothing else. So three figures on a member's history
// were derived, carried through two data structures and thrown away, with
// nothing anywhere asserting what they mean.
//
// Now that app/(client)/history.tsx prints all three, what they mean is load
// bearing, and each of the assertions below is a sentence that screen now says
// out loud:
//
//   · "most of it Squat" — `topLift` is the movement that carried the most
//     VOLUME in the month, which is not the movement behind the estimate.
//   · "Best Est. 1RM · set Apr 2026" — the estimate and the tonnage peak in
//     different months routinely, so the estimate needs its own pick. That is
//     `peakEstimateMonth`, and reading `bestMonth(cells).best1RM` instead is
//     the defect it exists to make impossible.
//   · "Energy adds up only the sessions that carried a calorie figure" — a
//     month with none has `kcal: null`, never 0. A zero there would print
//     "0 kcal" to a member with no watch, which is a measurement claim about
//     something nobody measured.
import { monthlyHistory, bestMonth, peakEstimateMonth, lifetimeTotals, MAX_MONTHS } from './longView';
import { est1RM } from './streaks';
import type { WorkoutEntry } from './mockData';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(a === b, `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/**
 * Midday UTC, so the LOCAL calendar month `monthKey` reads is the month written
 * here in every timezone this app ships to. A date at midnight would be the
 * previous month west of Greenwich and the test would pass or fail on where it
 * was run.
 */
const at = (day: string) => `${day}T12:00:00.000Z`;

// March is a high-rep month: the most tonnage of the three and the LOWEST
// estimated single. April is one heavy double: almost no tonnage and the best
// estimate on record. That is the ordinary shape of a block finishing into a
// peak week, and it is what separates the two picks.
const log: WorkoutEntry[] = [
  { t: at('2026-03-10'), exercise: 'Squat', sets: [[20, 60], [20, 60], [20, 60]] },
  { t: at('2026-03-12'), exercise: 'Curl', sets: [[10, 20]] },
  { t: at('2026-04-14'), exercise: 'Deadlift', sets: [[2, 140]], kcal: 300 },
  { t: at('2026-05-05'), exercise: 'Plank', sets: [[60, 0]], timed: [true] },
];
const now = Date.parse(at('2026-05-20'));
const cells = monthlyHistory(log, now, MAX_MONTHS, []);
const march = cells.find((c) => c.key === '2026-03');
const april = cells.find((c) => c.key === '2026-04');
const may = cells.find((c) => c.key === '2026-05');

{
  eq(cells.length, 3, 'the window runs from the first logged month to the month `now` sits in');
  ok(!!march && !!april && !!may, 'and holds all three of them');
}

// ── topLift is the VOLUME leader, and only that ────────────────────────────
{
  eq(march!.topLift, 'Squat', 'the month’s top lift is the movement that carried the most tonnage');
  eq(march!.volumeKg, 3600 + 200, 'and the month’s tonnage is every weighted set in it');
  eq(april!.topLift, 'Deadlift', 'a month with one movement in it has that movement as its top lift');
  eq(may!.topLift, null,
    'a month of holds has no top lift — a plank carries no tonnage, so nothing in it can lead on tonnage');
}

// ── the estimate peaks in a different month from the tonnage ───────────────
{
  eq(bestMonth(cells)!.key, '2026-03', 'March is the heaviest month by tonnage');
  eq(peakEstimateMonth(cells)!.key, '2026-04',
    'and April holds the best estimated single — the two picks are different months and must be made separately');
  eq(march!.best1RM, est1RM(60, 20), 'March’s estimate is Epley over its best single set');
  eq(april!.best1RM, est1RM(140, 2), 'and April’s over its own');
  ok(peakEstimateMonth(cells)!.best1RM! > bestMonth(cells)!.best1RM!,
    'reading the estimate off bestMonth() would print the lower of the two as the member’s best');
}

// ── a hold is not a set with a load on it ──────────────────────────────────
{
  eq(may!.trained, true, 'a month of holds is a month that was trained');
  eq(may!.volumeKg, null, 'and has no tonnage — not a tonnage of zero');
  eq(may!.best1RM, null,
    'and no estimate: Epley over 60 SECONDS is arithmetic on a stopwatch, and it would outrank every real set for ever');
}

// ── kcal is null where nobody recorded one, and never 0 ────────────────────
{
  eq(march!.kcal, null,
    'a month whose sessions carried no calorie figure reports none — a 0 there is "you burned nothing", which is not what the record says');
  eq(april!.kcal, 300, 'and a month with one is the sum of the figures that were actually recorded');
  eq(may!.kcal, null, 'a month of holds carries none either');

  const life = lifetimeTotals(log, [])!;
  eq(life.kcal, 300,
    'the lifetime figure is the same floor — only the sessions that carried a number are in it, which is why the screen may not call it what you burned');
  eq(life.lifts, 3, 'and the lift count is the movements with a load on them: the plank is not one');
  eq(life.days, 4, 'four distinct calendar days trained');
}

// ── nothing to estimate from at all ────────────────────────────────────────
{
  const cardio: WorkoutEntry[] = [
    { t: at('2026-02-02'), exercise: 'Run', cardio: { mins: 30, dist: 6, unit: 'km' }, kcal: 280 },
  ];
  const only = monthlyHistory(cardio, Date.parse(at('2026-02-20')), MAX_MONTHS, []);
  eq(peakEstimateMonth(only), null,
    'a history with no weighted set has no peak estimate — null, so the screen prints a dash rather than a max nobody lifted');
  eq(bestMonth(only), null, 'and no heaviest month by tonnage either');
  eq(only[0].kcal, 280, 'the calorie figure a run carried is still counted');
  eq(peakEstimateMonth([]), null, 'and an empty series answers null rather than throwing');
}

if (errors.length) {
  console.error(`longView.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('longView.test.ts — ok');
