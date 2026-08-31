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
import {
  readMeasurements, measureBoard, unmeasuredSites, siteChangeCm, siteChangeLine,
  siteAgeDays, siteAgeLine, isSiteStale, MEASURE_SITES, DIRECTION_CAVEAT,
  type MeasurementRow,
} from './clientMeasurements';

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
// Baseline 90 kg, now 87, target 84: half way.
//
// This exercises `startPoint`'s FALLBACK arm, not its primary rule. The goal was
// set on Jan 1 and the earliest reading is the Jan 5 scan, so there is no
// reading "at or before" it and `before ?? sorted[0]` returns the earliest one
// after. The comment used to claim Jan 5 WAS "the last reading at or before the
// goal was set", which cannot be true of a date four days later — and it left
// the primary arm looking covered when nothing here touched it. It is covered
// immediately below now.
ok(prog?.start === 90, 'with no reading before the goal, the earliest one after it stands in as the baseline');
ok(prog?.current === 87, 'against the latest one, whichever source it came from');
ok(prog?.pct === 50, `half of a 6 kg span is 50%, got ${prog?.pct}`);
ok(prog?.reached === false, 'and 87 has not crossed 84');

// The PRIMARY arm, which nothing here reached until now: a goal set AFTER some
// readings is measured from the last one at or before it, not from the earliest
// on record. This is the rule the paragraph above claimed to be demonstrating.
// The same client, the same three weight points (Jan 5: 90, Feb 5: 88,
// Feb 20: 87), with the goal set on Feb 10 — so the baseline is the Feb 5
// reading of 88, and the earliest reading of 90 must NOT be used.
{
  const later = readGoal(goalRow({ target_value: 84, created_at: '2026-02-10T09:00:00.000Z' })) as GoalTarget;
  const lp = progressOf(later, seriesFor(series, 'weight'));
  ok(lp?.start === 88, `a goal set after a reading is measured from that reading, not the earliest on record — got ${lp?.start}`);
  ok(lp?.current === 87, 'still against the latest reading');
  ok(lp?.pct === 25, `1 kg of a 4 kg span is 25%, got ${lp?.pct}`);
}

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

// ══ tape measurements, read for their coach ════════════════════════════════
//
// The third coach-read policy nothing used. Same file as the goals above rather
// than a new one, because a new *.test.ts is not in tsconfig.test.json's files
// list or in `npm test` and would therefore never run — and a test that never
// runs is worse than no test, because the next person believes it.
//
// Everything below is above the `process.exit(1)` guard on purpose. Assertions
// placed after it still execute and still print, and can never fail the suite;
// this repo has shipped that mistake twice.

const M_TODAY = '2026-08-30';

const mRow = (kind: string, taken_at: string, value: number | string | null): MeasurementRow =>
  ({ kind, taken_at, value });

// A believable client: a waist measured often and recently, a chest measured
// twice in the spring and not since, a thigh someone took down once.
const mRead = readMeasurements([
  mRow('waist', '2026-08-23', 84),
  mRow('waist', '2026-07-26', 86),
  mRow('chest', '2026-05-01', 100),
  mRow('chest', '2026-03-01', '102.0'),
  mRow('thigh', '2026-08-20', 58),
]);
const siteFor = (k: string) => mRead.sites.find((s) => s.key === k) ?? null;

ok(mRead.sites.length === 3, `three sites have readings, got ${mRead.sites.length}`);
ok(mRead.sites.map((s) => s.key).join(',') === 'waist,chest,thigh',
  'and they come back in the order the client’s own screen lists them, so the two people are reading the same body down the same list');
ok(siteFor('chest')?.previous?.cm === 102,
  'a numeric column delivered as a string is a number here too');

// ── rows this build cannot use are dropped and counted ─────────────────────

const mJunk = readMeasurements([
  mRow('waist', '2026-08-23', 84),
  mRow('calf', '2026-08-23', 38),
  mRow('waist', '2026-08-23', 0),
  mRow('waist', 'not a date', 84),
  mRow('waist', '2026-08-23', null),
]);
ok(mJunk.sites.length === 1, 'only the readable site is drawn');
ok(mJunk.skipped === 4,
  `a site this build cannot name, a 0 cm reading, an unreadable date and a null are counted rather than swallowed, got ${mJunk.skipped}`);

// ── one reading is a number, not a trend ───────────────────────────────────

const thigh = siteFor('thigh');
ok(thigh?.previous === null, 'a site measured once has no previous reading');
ok(siteChangeCm(thigh!) === null, 'and no change — null, never 0, which would read as "held steady"');
ok(siteChangeLine(thigh!, 'cm').includes('nothing yet to compare'),
  `a single reading says so in words, got "${siteChangeLine(thigh!, 'cm')}"`);
ok(!/^[+−-]?0(\.0)?\s/.test(siteChangeLine(thigh!, 'cm')),
  'and never opens with a zero');

// Two rows for the same site on the same day are reachable — the table has no
// unique constraint — and they are a correction, not a change over time.
const sameDay = readMeasurements([
  mRow('waist', '2026-08-23', 84),
  mRow('waist', '2026-08-23', 85),
]);
ok(sameDay.sites[0].previous === null,
  'a second row on the same day is not a previous reading, because no time passed between them');

// ── a change converts as a span, rounded once ──────────────────────────────

const spanCase = readMeasurements([
  mRow('thigh', '2026-08-01', 61.1),
  mRow('thigh', '2026-07-01', 60),
]);
ok(siteChangeCm(spanCase.sites[0]) != null
  && Math.abs(siteChangeCm(spanCase.sites[0])! - 1.1) < 1e-9,
  'the change is held in centimetres, as stored');
// 60.0 → 61.1 cm is +0.4 in taken as one span. Converting the ENDS first gives
// 23.6 → 24.1 = +0.5 in, a tenth of an inch the tape never measured. This is
// the exact pair that separates the two, which is why it is here and not a
// round number.
ok(siteChangeLine(spanCase.sites[0], 'in').includes('+0.4 in'),
  `a span converts once: expected +0.4 in, got "${siteChangeLine(spanCase.sites[0], 'in')}"`);

// ── each site carries its own date, and says how stale it is ───────────────

ok(siteAgeDays(siteFor('waist')!, M_TODAY) === 7, 'the waist was measured a week ago');
ok(siteAgeDays(siteFor('chest')!, M_TODAY) === 121, 'and the chest four months ago');
ok(!isSiteStale(siteFor('waist')!, M_TODAY) && isSiteStale(siteFor('chest')!, M_TODAY),
  'sites go stale one at a time — a fresh waist does not make a four-month-old chest current, and one screen-level "last measured" date would have said it did');
ok(siteAgeLine(siteFor('chest')!, M_TODAY).includes('121 days ago'),
  `a stale reading says exactly how stale, got "${siteAgeLine(siteFor('chest')!, M_TODAY)}"`);
ok(siteAgeLine(siteFor('waist')!, M_TODAY).includes('7 days ago')
  && !siteAgeLine(siteFor('waist')!, M_TODAY).includes('training block'),
  'and a current one still carries its age, without being scolded for it');

// ── direction is reported, not judged ──────────────────────────────────────

// The same fall, at two sites where it means opposite things. If the wording
// ever acquires a valence — "good", "on track", "well done" — these two stop
// matching, which is the point: the tape does not know what the client wants.
const falling = (site: string) => readMeasurements([
  mRow(site, '2026-08-20', 84),
  mRow(site, '2026-07-20', 86),
]).sites[0];
ok(siteChangeLine(falling('waist'), 'cm') === siteChangeLine(falling('arm'), 'cm'),
  'a waist and an arm falling by the same amount are described in the same words');
ok(siteChangeLine(falling('waist'), 'cm').startsWith('−2 cm'),
  `the sign carries the direction and nothing else, got "${siteChangeLine(falling('waist'), 'cm')}"`);
ok(!/good|great|progress|on track|well done|improved/i.test(siteChangeLine(falling('waist'), 'cm')),
  'and no change line congratulates anybody on a number it cannot interpret');
ok(DIRECTION_CAVEAT.includes('waist') && DIRECTION_CAVEAT.includes('arm'),
  'the caveat names the two sites that make the point, rather than gesturing at it');

const flat = readMeasurements([
  mRow('waist', '2026-08-20', 84),
  mRow('waist', '2026-07-20', 84),
]).sites[0];
ok(siteChangeLine(flat, 'cm').startsWith('Unchanged'),
  'a reading that has not moved says so, rather than printing a signed zero');

// ── the three states a coach must be able to tell apart ────────────────────

ok(measureBoard(null).state === 'unreadable',
  'a read that did not come back is unreadable — never a client who has never picked up a tape');
ok(measureBoard([]).state === 'none', 'a read that came back empty is a client with nothing recorded');
ok(measureBoard(mRead.sites).state === 'measured', 'and readings are readings');

ok(unmeasuredSites(mRead.sites).join(',') === 'Arm,Hips',
  `the sites nobody has measured are named, got "${unmeasuredSites(mRead.sites).join(',')}"`);
ok(unmeasuredSites([]).length === MEASURE_SITES.length,
  'and a client with nothing recorded has not measured any of them');

declare const process: { exit(code: number): void };
console.log(errors.length ? 'CLIENT-GOALS FAILURES:\n' + errors.join('\n') : 'ALL CLIENT-GOALS TESTS PASSED');
if (errors.length) process.exit(1);
