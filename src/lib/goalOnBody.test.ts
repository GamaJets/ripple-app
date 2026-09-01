// The target line on a body screen: what it says, and the four things it refuses.
//
// This line is small and it is read next to a number the member's whole plan is
// built on, so the failures worth guarding are the quiet ones — a target
// printed in kilograms under a figure in pounds, a "0.0 kg to go" that never
// resolves, a percentage of a goal that was never a number.
//
// `ok`/`eq` into an errors array and process.exit(1), never node:assert — the
// house rule, and the reason is that assert stops at the first failure and this
// file is worth reading all of.
import { goalOnBody, goalOfKind } from './goalOnBody';
import type { GoalTarget, Point } from './goalTargets';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const goal = (over: Partial<GoalTarget> = {}): GoalTarget => ({
  id: 'g1',
  kind: 'weight',
  targetValue: 80,
  title: null,
  targetDateISO: null,
  achievedAtISO: null,
  createdAtISO: '2026-01-01T00:00:00.000Z',
  ...over,
});

const series = (...vals: number[]): Point[] =>
  vals.map((v, i) => ({ t: new Date(Date.UTC(2026, 0, 2 + i * 7)).toISOString(), v }));

// ── a plain distance ──────────────────────────────────────────────────────
{
  const r = goalOnBody(goal({ targetValue: 80 }), series(90, 85), { weight: true, unit: 'kg', wu: 'kg' });
  ok(r != null, 'a measured goal with readings produces a line');
  eq(r!.target, 80, 'the target is stated');
  eq(r!.remaining, 5, 'and the distance still to go');
  eq(r!.reached, false, 'which is not a reached goal');
  ok(/5 kg to go/.test(r!.note), 'the sentence leads with the distance, which is the thing being asked');
  ok(!r!.note.endsWith('.'), 'no trailing full stop — the caller punctuates');
}

// ── the distance is UNSIGNED, in both directions ──────────────────────────
//
// `deltaLabel` is the house rule for a signed movement and this is not one. A
// member gaining muscle toward a target above them must not read "-3 kg to go",
// and a member losing weight toward one below them must not read "+3".
{
  const down = goalOnBody(goal({ targetValue: 80 }), series(90, 83), { weight: true, unit: 'kg', wu: 'kg' });
  const up = goalOnBody(goal({ kind: 'muscle', targetValue: 40 }), series(34, 37), { weight: true, unit: 'kg', wu: 'kg' });
  eq(down!.remaining, 3, 'losing toward a lower target has three to go');
  eq(up!.remaining, 3, 'and gaining toward a higher one has three to go as well');
  for (const r of [down, up]) {
    ok(!/[+-]\d/.test(r!.note), `a distance is never signed — got "${r!.note}"`);
  }
}

// ── the target reads in the MEMBER'S unit ─────────────────────────────────
//
// The one that costs something. Every mass in this app is stored in kilograms;
// a pounds reader shown "target 80 kg" under a figure reading 187 lb has been
// handed two numbers in two unit systems with nothing saying so, and the
// obvious reading of it is that they are nine pounds away rather than seven
// stone.
{
  const r = goalOnBody(goal({ targetValue: 80 }), series(90), { weight: true, unit: 'kg', wu: 'lb' });
  eq(r!.unit, 'lb', 'a pounds reader is given pounds');
  eq(r!.target, 176, '80 kg is 176 lb');
  ok(!/kg/.test(r!.note), `and the sentence never says kg to a pounds reader — got "${r!.note}"`);
  eq(r!.remaining, 22, 'the 10 kg gap is 22 lb, converted as one span rather than as two rounded endpoints');
}

// A percentage has no unit system, so it passes through whatever the reader's
// weight preference is.
{
  const r = goalOnBody(goal({ kind: 'bodyfat', targetValue: 15 }), series(22, 18), { weight: false, unit: '%', wu: 'lb' });
  eq(r!.unit, '%', 'body fat is a percentage in every unit system');
  eq(r!.target, 15, 'and is not converted');
  eq(r!.remaining, 3, 'nor is the distance');
}

// ── reaching it ──────────────────────────────────────────────────────────
{
  const exactly = goalOnBody(goal({ targetValue: 80 }), series(90, 80), { weight: true, unit: 'kg', wu: 'kg' });
  const past = goalOnBody(goal({ targetValue: 80 }), series(90, 78), { weight: true, unit: 'kg', wu: 'kg' });
  for (const r of [exactly, past]) {
    eq(r!.reached, true, 'landing on the target and crossing it both count as reached');
    eq(r!.remaining, null, 'and a reached goal has no distance left, rather than a distance of zero');
    ok(/reached/i.test(r!.note), 'the sentence says so');
  }
}

// ── the rounding artefact, which is the one that reads as being stuck ─────
//
// A member 20 g from their target is not "0.0 kg to go" forever. That figure is
// a rounding artefact standing where an achievement should be, and it never
// resolves because the next weigh-in rounds the same way.
{
  const r = goalOnBody(goal({ targetValue: 80 }), series(90, 80.02), { weight: true, unit: 'kg', wu: 'kg' });
  eq(r!.remaining, null, 'a gap under the printing grain is not a distance');
  eq(r!.reached, false, 'AND IT IS NOT A REACHED GOAL EITHER — claiming that is claiming something progressOf did not');
  ok(!/0 kg to go|0\.0/.test(r!.note), `and the sentence never prints the artefact — got "${r!.note}"`);
  ok(/all but there/.test(r!.note), 'it says what is actually true instead');
}

// ── the four refusals ────────────────────────────────────────────────────
{
  eq(goalOnBody(null, series(90), { weight: true, unit: 'kg', wu: 'kg' }), null,
    'no goal, no line — the caller owns the sentence about why, because only the caller can tell "none set" from "not read"');
  eq(goalOnBody(goal({ kind: 'custom', targetValue: null, title: 'Run a 10k' }), series(90), { weight: true, unit: 'kg', wu: 'kg' }), null,
    'A CUSTOM GOAL IS A SENTENCE, NOT A NUMBER — percentages of sentences are how progress stops meaning anything');
  eq(goalOnBody(goal({ targetValue: null }), series(90), { weight: true, unit: 'kg', wu: 'kg' }), null,
    'a goal with no target value has no distance to be from');
  eq(goalOnBody(goal(), [], { weight: true, unit: 'kg', wu: 'kg' }), null,
    'and no readings means nothing to measure the distance from — not a distance of the whole target');
}

// ── picking the goal for a metric ────────────────────────────────────────
{
  const goals = [goal({ id: 'a', kind: 'weight' }), goal({ id: 'b', kind: 'bodyfat', targetValue: 15 })];
  eq(goalOfKind(goals, 'bodyfat')!.id, 'b', 'the goal of the asked-for kind is the one returned');
  eq(goalOfKind(goals, 'muscle'), null, 'and a kind with no goal is null rather than the first goal in the list');
  eq(goalOfKind(null, 'weight'), null, 'an unread goal list is null, and the caller decides what to say about that');
  eq(goalOfKind([], 'weight'), null, 'as is an empty one');
  // An achieved goal is still the answer to "what am I aiming at", and hiding
  // the line the moment somebody reaches it deletes the only good news the
  // screen had.
  const done = [goal({ id: 'c', achievedAtISO: '2026-06-01T00:00:00.000Z' })];
  eq(goalOfKind(done, 'weight')!.id, 'c', 'an achieved goal is still returned');
}

if (errors.length) {
  console.error(`goalOnBody.test.ts — ${errors.length} failures:`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('goalOnBody.test.ts — ok');
