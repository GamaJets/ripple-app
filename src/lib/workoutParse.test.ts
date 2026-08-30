// The natural-language workout parser, which had no test at all.
//
// It understood "60kg" and "135lb", so it read as finished. What it did with an
// UNSUFFIXED number was the bug: every one of them was kilograms. A pounds
// member typing what the plates in front of them say — "bench 3x8 @135" —
// stored 135kg, and every screen rendered that back through liftLabel as 297lb.
// Nothing anywhere said "kg". The member sees a number that is merely wrong,
// not a number that is obviously an error, which is why this went unreported
// while the parser looked correct.
import { parseWorkoutText } from './workoutParse';
import { KG_PER_LB } from './units';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const near = (a: number, b: number, tol = 0.51) => Math.abs(a - b) <= tol;

// ── the bug ────────────────────────────────────────────────────────────────
{
  const lb = parseWorkoutText('bench 3x8 @135', 'lb');
  ok(lb.length === 1, `one lift from a pounds sentence, got ${lb.length}`);
  const w = lb[0]?.sets[0]?.[1] ?? -1;
  ok(near(w, 135 * KG_PER_LB), `"@135" from a pounds member is 61.2kg, got ${w}`);
  // The assertion that names the defect: not merely "close to 61" but nowhere
  // near 135. A parser that ignored the unit would put 135 here.
  ok(w < 100, `"@135" must not be stored as 135 kilograms, got ${w}`);

  const kg = parseWorkoutText('bench 3x8 @135', 'kg');
  ok(near(kg[0]?.sets[0]?.[1] ?? -1, 135), 'the same sentence from a kg member is 135kg');
}

// ── a suffix still means what it says ──────────────────────────────────────
{
  const explicit = parseWorkoutText('squat 5x5 100kg', 'lb');
  ok(near(explicit[0]?.sets[0]?.[1] ?? -1, 100),
    'writing "100kg" while set to pounds is deliberate and stays 100kg');
  const lbs = parseWorkoutText('squat 5x5 225lb', 'kg');
  ok(near(lbs[0]?.sets[0]?.[1] ?? -1, 225 * KG_PER_LB),
    'and "225lb" while set to kg converts, got ' + lbs[0]?.sets[0]?.[1]);
}

// ── the rep scan, which the conversion breaks if written naively ───────────
// The weight is removed from the list of numbers by matching it. Convert it
// first and it equals nothing in the sentence, so the weight reappears as a
// set. "curl @20 10 10" in pounds: 20lb is 9.07kg, which matches no number
// written, and the 20 comes back as a set of twenty reps.
{
  const curls = parseWorkoutText('curl @20 10 10', 'lb');
  ok(curls.length === 1, `one lift, got ${curls.length}`);
  const sets = curls[0]?.sets ?? [];
  ok(sets.length === 2, `two sets of ten, got ${sets.length}: ${JSON.stringify(sets)}`);
  ok(sets.every(([r]) => r === 10), `both sets are ten reps, got ${JSON.stringify(sets.map(([r]) => r))}`);
  ok(sets.every(([, w]) => near(w, 20 * KG_PER_LB)), 'each at 9kg');
}

// ── the "5x100" reading, also a bare number ────────────────────────────────
{
  const heavy = parseWorkoutText('deadlift 5x315', 'lb');
  const s = heavy[0]?.sets ?? [];
  ok(s.length === 1 && s[0][0] === 5, `"5x315" is five reps, got ${JSON.stringify(s)}`);
  ok(near(s[0]?.[1] ?? -1, 315 * KG_PER_LB), `at 142.9kg, got ${s[0]?.[1]}`);
}

// ── unchanged behaviour: the default is still kilograms ────────────────────
{
  const d = parseWorkoutText('bench 3x8 60kg, squat 100kg 5 5 5');
  ok(d.length === 2, `two clauses, got ${d.length}`);
  ok(d[0]?.exercise === 'Bench' && d[1]?.exercise === 'Squat',
    `names survive, got ${d.map((x) => x.exercise).join('/')}`);
  ok(d[0]?.sets.length === 3 && d[0].sets.every(([r, w]) => r === 8 && w === 60), 'three sets of eight at 60kg');
  ok(d[1]?.sets.length === 3 && d[1].sets.every(([r, w]) => r === 5 && w === 100), 'three fives at 100kg');
  const bodyweight = parseWorkoutText('3x12 pushups');
  ok(bodyweight[0]?.sets.length === 3 && bodyweight[0].sets.every(([, w]) => w === 0),
    'bodyweight stays zero rather than picking up a unit');
}

if (errors.length) {
  console.error(`workoutParse.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('workoutParse.test.ts — ok');
