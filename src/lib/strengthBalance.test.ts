// Which lift is furthest behind. Compile with tsc, run with node.
//
// The defect this suite exists to prevent is the one the feature would most
// naturally have shipped with: comparing bodyweight RATIOS between lifts.
// The five ladders in STRENGTH_LIFTS are not the same ladder — Elite overhead
// press is 1.1× and Beginner deadlift is 1.0× — so a member with an Elite press
// and a beginner deadlift reads, down the ratio column, as a lifter whose press
// is the weak one. The first assertion below is exactly that case.
import {
  standardScore, weakestLift, balanceLine, MIN_GAP_LEVELS,
  type LiftStanding,
} from './strengthBalance';
import { levelFor } from './strengthLevel';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const near = (a: number | null, b: number, msg: string) =>
  ok(a != null && Math.abs(a - b) < 1e-9, `${msg} — got ${JSON.stringify(a)}, wanted ${b}`);

// The real ladders from src/lib/strengthLifts.ts, copied so a change to that
// table shows up here as a failing assertion rather than as silently different
// arithmetic.
const SQUAT = [0.75, 1.25, 1.5, 2.0, 2.5];
const BENCH = [0.5, 0.75, 1.0, 1.5, 2.0];
const DEAD = [1.0, 1.5, 2.0, 2.5, 3.0];
const OHP = [0.35, 0.55, 0.7, 0.9, 1.1];

/* ── the whole point: ratios are not comparable, positions are ──────────── */

{
  // A 1.1× overhead press is ELITE. A 1.1× deadlift is a fifth of the way from
  // Beginner to Novice. Sorted by ratio the two are identical; sorted properly
  // the deadlift is four levels behind.
  const r = weakestLift([
    { name: 'Overhead Press', ratio: 1.1, mult: OHP },
    { name: 'Deadlift', ratio: 1.1, mult: DEAD },
  ]);
  eq(r.kind, 'behind', 'two lifts at the same ratio are not level');
  ok(r.kind === 'behind' && r.name === 'Deadlift',
    'the deadlift is the lift behind — comparing raw ratios would name the press');
  ok(r.kind === 'behind' && r.aheadName === 'Overhead Press',
    'the lift it is behind is named, so the claim has a stated basis');
}

/* ── standardScore: the rungs themselves ────────────────────────────────── */

near(standardScore(0.75, SQUAT), 0, 'exactly the first standard is position 0');
near(standardScore(1.25, SQUAT), 1, 'exactly the second standard is position 1');
near(standardScore(2.5, SQUAT), 4, 'exactly the top standard is the top position');
near(standardScore(1.375, SQUAT), 1.5, 'halfway between rung 1 and rung 2 is 1.5');

// The integer part must never disagree with the bar the screen draws.
for (const ratio of [0.4, 0.75, 1.0, 1.25, 1.4, 1.5, 1.9, 2.0, 2.49]) {
  const s = standardScore(ratio, SQUAT);
  ok(s != null && Math.floor(s) === levelFor(ratio, SQUAT),
    `the whole part of the score is levelFor's answer at ${ratio} — got ${s}, rung ${levelFor(ratio, SQUAT)}`);
}

/* ── below the first standard, and the floor under it ───────────────────── */

near(standardScore(0.375, SQUAT), -0.5, 'half of the first standard is halfway between the floor and it');
{
  const s = standardScore(0.0001, SQUAT);
  ok(s != null && s > -1 && s < -0.99, 'a ratio approaching nothing approaches -1 and never passes it');
}
// `levelFor` answers -1 for everything below the first rung; the score agrees
// on the sign, which is what stops "below beginner" reading as a level reached.
ok((standardScore(0.5, SQUAT) ?? 0) < 0, 'below the first standard is a negative position');

/* ── past the top, deliberately flat ────────────────────────────────────── */

near(standardScore(3.0, SQUAT), 4, 'past Elite caps at the top rung');
near(standardScore(9.9, SQUAT), 4, 'far past Elite still caps — there is no sixth standard');
{
  // Two lifters both past the top compare as even rather than racing on a
  // figure the table cannot price.
  const r = weakestLift([
    { name: 'Squat', ratio: 2.6, mult: SQUAT },
    { name: 'Deadlift', ratio: 4.0, mult: DEAD },
  ]);
  eq(r.kind, 'even', 'two lifts past Elite are even, not four levels apart');
}

/* ── what cannot be positioned at all ───────────────────────────────────── */

eq(standardScore(0, SQUAT), null, 'a ratio of zero has no position — it is an absent lift, not a weak one');
eq(standardScore(-1, SQUAT), null, 'a negative ratio has no position');
eq(standardScore(Number.NaN, SQUAT), null, 'a NaN ratio has no position');
eq(standardScore(Number.POSITIVE_INFINITY, SQUAT), null, 'an infinite ratio has no position');
eq(standardScore(1, [1.0]), null, 'a one-rung ladder cannot be interpolated');
eq(standardScore(1, []), null, 'an empty ladder has no positions on it');
eq(standardScore(1, [1.5, 1.0]), null, 'a ladder whose rungs descend is malformed, not a scale');
eq(standardScore(1, [1.0, 1.0]), null, 'a ladder with a repeated rung would divide by zero');
eq(standardScore(1, [0, 1.0]), null, 'a ladder starting at zero is malformed');

/* ── fewer than two graded lifts is not a comparison ────────────────────── */

eq(weakestLift([]).kind, 'too-few', 'no lifts is not a comparison');
eq(weakestLift([{ name: 'Squat', ratio: 1.5, mult: SQUAT }]).kind, 'too-few',
  'one lift cannot be behind anything');
// An unscoreable lift is DROPPED, not scored zero. Scoring it zero would make
// it the weakest every time and name a lift the member may never have done.
eq(weakestLift([
  { name: 'Squat', ratio: 1.5, mult: SQUAT },
  { name: 'Bench Press', ratio: 0, mult: BENCH },
]).kind, 'too-few', 'a lift with no ratio is dropped, leaving one lift and no comparison');
{
  const r = weakestLift([
    { name: 'Squat', ratio: 2.4, mult: SQUAT },
    { name: 'Bench Press', ratio: 0, mult: BENCH },
    { name: 'Overhead Press', ratio: 0.36, mult: OHP },
  ]);
  ok(r.kind === 'behind' && r.name === 'Overhead Press',
    'the dropped lift is not the answer — the weakest SCORED lift is');
}

/* ── the noise floor ────────────────────────────────────────────────────── */

eq(MIN_GAP_LEVELS, 1, 'the threshold is one full rung');
{
  // Squat at exactly rung 2, bench 0.9 of a rung above it: inside the noise of
  // an estimated 1RM, so no lift is named.
  const r = weakestLift([
    { name: 'Squat', ratio: 1.5, mult: SQUAT },        // score 2.0
    { name: 'Bench Press', ratio: 1.45, mult: BENCH },  // score 2.9
  ]);
  eq(r.kind, 'even', 'a gap under a full level is not named');
}
{
  const r = weakestLift([
    { name: 'Squat', ratio: 1.5, mult: SQUAT },        // score 2.0
    { name: 'Bench Press', ratio: 1.5, mult: BENCH },   // score 3.0
  ]);
  eq(r.kind, 'behind', 'a gap of exactly one full level IS named');
  ok(r.kind === 'behind' && r.name === 'Squat', 'and it names the lower-scoring lift');
  ok(r.kind === 'behind' && r.levels === 1, 'the gap is reported in rungs');
}

/* ── stable under ties ──────────────────────────────────────────────────── */

{
  const tied: LiftStanding[] = [
    { name: 'Bench Press', ratio: 0.5, mult: BENCH },   // score 0
    { name: 'Squat', ratio: 0.75, mult: SQUAT },        // score 0
    { name: 'Deadlift', ratio: 2.5, mult: DEAD },       // score 3
  ];
  const a = weakestLift(tied);
  const b = weakestLift(tied);
  ok(a.kind === 'behind' && a.name === 'Bench Press',
    'a tie for weakest is broken by the order given, so the sentence is stable');
  eq(JSON.stringify(a), JSON.stringify(b), 'the same input gives the same answer every time');
}

/* ── the sentence ───────────────────────────────────────────────────────── */

eq(balanceLine({ kind: 'too-few' }), null, 'nothing is said when nothing can be compared');
{
  const s = balanceLine({ kind: 'even' });
  ok(typeof s === 'string' && s.length > 0, 'an even set of lifts still gets a sentence');
  ok(!(s ?? '').includes('furthest'), 'and it does not name a weakest lift');
}
{
  const s = balanceLine({ kind: 'behind', name: 'Overhead Press', aheadName: 'Deadlift', levels: 1 }) ?? '';
  ok(s.includes('Overhead Press'), 'the lift behind is named');
  ok(s.includes('Deadlift'), 'the lift it is behind is named too');
  ok(s.includes('about a level'), 'a gap of one rung reads as "about a level", never "about 1 levels"');
  ok(!/\btrain\b|\bfocus\b|\bwork on\b/i.test(s),
    'the sentence states a comparison and never issues a coaching instruction');
}
{
  const s = balanceLine({ kind: 'behind', name: 'Bench Press', aheadName: 'Squat', levels: 2.3 }) ?? '';
  ok(s.includes('about 2.3 levels'), 'a larger gap is quoted to one decimal');
}

/* ── a worked case off the real table ───────────────────────────────────── */

{
  // An 80 kg lifter: 140 kg squat (1.75×), 100 kg bench (1.25×), 180 kg
  // deadlift (2.25×), 50 kg press (0.625×).
  //
  // By RATIO the ordering is deadlift 2.25, squat 1.75, bench 1.25, press 0.63
  // — three clear places between the bench and the press. By POSITION the first
  // three are all at 2.5, exactly halfway from Intermediate to Advanced on
  // their own ladders, and the press is at 1.5. So this lifter is even across
  // squat, bench and deadlift and a full level down on the press, which no
  // reading of the ratio column would tell them.
  const squat = { name: 'Squat', ratio: 140 / 80, mult: SQUAT };
  const bench = { name: 'Bench Press', ratio: 100 / 80, mult: BENCH };
  const dead = { name: 'Deadlift', ratio: 180 / 80, mult: DEAD };
  const press = { name: 'Overhead Press', ratio: 50 / 80, mult: OHP };
  near(standardScore(squat.ratio, SQUAT), 2.5, 'the worked squat sits at 2.5');
  near(standardScore(bench.ratio, BENCH), 2.5, 'the worked bench sits at 2.5 too');
  near(standardScore(dead.ratio, DEAD), 2.5, 'and so does the worked deadlift');
  near(standardScore(press.ratio, OHP), 1.5, 'the worked press sits a full level below all three');

  const r = weakestLift([squat, bench, dead, press]);
  ok(r.kind === 'behind' && r.name === 'Overhead Press', 'the worked case names the press');
  ok(r.kind === 'behind' && r.levels === 1, 'a full level behind, which is exactly the threshold');
  // Three lifts are tied for strongest at 2.5. The one named is the first in
  // the order given — the caller's order, which on standards.tsx is the order
  // of STRENGTH_LIFTS — so the sentence is the same on every render.
  ok(r.kind === 'behind' && r.aheadName === 'Squat',
    'the strongest named under a tie is the first in the order given');
}

if (errors.length) {
  console.error(`strengthBalance: ${errors.length} failure(s)`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('strengthBalance: ok');
