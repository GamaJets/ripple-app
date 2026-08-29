// Reading somebody else's goals off the wire. Compile with tsc, run with node.
//
// The assertions divide in two, and the second half is the half worth having.
// The first says the mapping is right — a numeric column becomes a number, a
// scan becomes three points. The second says the module refuses to produce a
// goal, a reading or an empty list that the rows do not support: an unknown
// kind is dropped and COUNTED, a missing muscle figure does not become zero
// kilograms, and a failed read is a different value from a client who has set
// nothing. A test that only checked the happy path would pass just as well
// against a version that showed a coach "no goals" for a refused query.
import {
  readGoal, readGoals, seriesFrom, seriesFor, goalBoard, goalUnit, goalValue, goalDelta,
  type GoalRow, type ScanRow, type WeighInRow,
} from './clientGoals';
import { progressOf, projectionOf, type GoalTarget } from './goalTargets';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

const goalRow = (over: Partial<GoalRow> = {}): GoalRow => ({
  id: 'g1',
  kind: 'weight',
  target_value: 80,
  title: null,
  target_date: '2026-06-01',
  achieved_at: null,
  created_at: '2026-01-01T09:00:00.000Z',
  ...over,
});

// ── one row into one goal ──────────────────────────────────────────────────

const weight = readGoal(goalRow());
ok(weight != null, 'a plain weight row is readable');
ok(weight?.targetValue === 80, 'and its target arrives as a number');
ok(weight?.title === null, 'a measured goal carries no title, whatever the column says');

// numeric(6,2) reaches supabase-js as a string on some driver paths. Number()
// on it is right; Number(null) is 0, which is why the column is not simply cast.
ok(readGoal(goalRow({ target_value: '78.50' }))?.targetValue === 78.5,
  'a numeric column delivered as a string is still a number');

const custom = readGoal(goalRow({ kind: 'custom', target_value: null, title: 'Squat without my knee complaining' }));
ok(custom?.kind === 'custom', 'a custom row is readable');
ok(custom?.title === 'Squat without my knee complaining', 'and keeps the client’s own words');
ok(custom?.targetValue === null, 'and is never given a number');

// ── rows this build cannot draw are dropped, not half-drawn ────────────────

ok(readGoal(goalRow({ kind: 'vo2max' })) === null,
  'a kind this build has never heard of is not cast to one it has');
ok(readGoal(goalRow({ target_value: null })) === null,
  'a measured goal with no number is not a goal at 0 kg');
ok(readGoal(goalRow({ kind: 'custom', target_value: null, title: '   ' })) === null,
  'a custom goal with no words has nothing to show and is dropped');

const mixed = readGoals([
  goalRow({ id: 'a' }),
  goalRow({ id: 'b', kind: 'vo2max' }),
  goalRow({ id: 'c', kind: 'custom', target_value: null, title: 'Sleep before midnight' }),
]);
ok(mixed.goals.length === 2, 'the readable goals come through');
ok(mixed.skipped === 1,
  'and the dropped one is counted, so a coach is told rather than shown a list that is quietly short');

// ── the readings behind them ───────────────────────────────────────────────

const scans: ScanRow[] = [
  { taken_at: '2026-01-05', weight_kg: 90, body_fat_pct: 24, skeletal_muscle_kg: 36 },
  // A scan sheet with no skeletal-muscle figure on it. Common: not every
  // machine reports it, and OCR misses it on the ones that do.
  { taken_at: '2026-02-05', weight_kg: 88, body_fat_pct: '23.4', skeletal_muscle_kg: null },
];
const weighIns: WeighInRow[] = [
  { at: '2026-02-20T07:30:00.000Z', weight_kg: 87 },
  // A check-in where they logged how they felt but never stepped on the scales.
  { at: '2026-02-21T07:30:00.000Z', weight_kg: null },
];
const series = seriesFrom(scans, weighIns);

ok(series.weight.length === 3, 'weight comes from both scans and weigh-ins, and only where a figure was recorded');
ok(series.bodyfat.length === 2, 'body fat comes from scans alone');
ok(series.bodyfat[1].v === 23.4, 'and a string-delivered percentage is still a number');
ok(series.muscle.length === 1,
  'a scan with no muscle figure is ABSENT from the muscle series — a missing reading is not a reading of zero');
ok(series.muscle.every((p) => p.v > 0), 'so nothing in the muscle series is a fabricated zero');
ok(seriesFor(series, 'bodyfat') === series.bodyfat, 'a goal kind picks its own series');
ok(seriesFrom([], []).weight.length === 0, 'a client with nothing on record has an empty series, not a seeded one');

// ── the whole path, as the screen walks it ─────────────────────────────────

const goal = readGoal(goalRow({ target_value: 84, created_at: '2026-01-01T09:00:00.000Z' })) as GoalTarget;
const prog = progressOf(goal, seriesFor(series, 'weight'));
// Baseline 90 kg (the last reading at or before the goal was set is the Jan 5
// scan, the earliest there is), now 87, target 84: half way.
ok(prog?.start === 90, 'progress is measured from the reading the goal started at');
ok(prog?.current === 87, 'against the latest one, whichever source it came from');
ok(prog?.pct === 50, `half of a 6 kg span is 50%, got ${prog?.pct}`);
ok(prog?.reached === false, 'and 87 has not crossed 84');

ok(progressOf(goal, seriesFor(seriesFrom([], []), 'weight')) === null,
  'a goal with no readings behind it yields no progress at all — not 0%');

const proj = projectionOf(goal, seriesFor(series, 'weight'), Date.parse('2026-02-25T00:00:00.000Z'));
ok(proj?.kind === 'eta', `46 days of readings is a trend, got ${proj?.kind ?? 'null'}`);

// ── the three states a coach must be able to tell apart ────────────────────

ok(goalBoard(null).state === 'unreadable',
  'a read that did not come back is unreadable — never an empty book');
ok(goalBoard([]).state === 'none', 'a read that came back empty is a client who has set nothing');

const done: GoalTarget = { ...goal, id: 'done', achievedAtISO: '2026-03-01T09:00:00.000Z' };
const board = goalBoard([done]);
ok(board.state === 'reached',
  'a client who has reached everything is not a client with no goals — it is the sentence that starts the next conversation');
ok(board.state === 'reached' && board.achieved.length === 1, 'and the reached goals are still there to show');

const working = goalBoard([done, goal]);
ok(working.state === 'working', 'one open goal makes the client a working one');
ok(working.state === 'working' && working.open.length === 1 && working.open[0].id === goal.id,
  'the open goals are separated from the achieved ones');
ok(working.state === 'working' && working.achieved.length === 1,
  'and the achieved ones are kept rather than discarded');

// ── the reader's own unit ──────────────────────────────────────────────────

ok(goalUnit('weight', 'lb') === 'lb' && goalUnit('muscle', 'lb') === 'lb',
  'the two weight-shaped goals are read in whatever unit the reader has set');
ok(goalUnit('bodyfat', 'lb') === '%',
  'body fat is a proportion of the body and is a percentage in every unit system');
ok(goalValue(80, 'weight', 'kg') === 80, 'kilograms pass through untouched');
ok(goalValue(80, 'weight', 'lb') === 176, `80 kg reads as 176 lb, got ${goalValue(80, 'weight', 'lb')}`);
ok(goalValue(24, 'bodyfat', 'lb') === 24, 'and a body-fat figure is never converted');
// The span converts once. Rounding each end into pounds first is what made
// "2 lb to go" flicker to "3 lb" on a reading that had not really moved.
ok(goalDelta(-0.4, 'weight', 'lb') === -1, `0.4 kg to go is 1 lb, got ${goalDelta(-0.4, 'weight', 'lb')}`);
ok(goalDelta(-0.4, 'weight', 'kg') === -0.4, 'and in kilograms it is the tenth the reading supports');

declare const process: { exit(code: number): void };
console.log(errors.length ? 'CLIENT-GOALS FAILURES:\n' + errors.join('\n') : 'ALL CLIENT-GOALS TESTS PASSED');
if (errors.length) process.exit(1);
