// The coach's own calorie target, and the three answers it may not be built
// without.
//
// What is defended here is a NUMBER A PERSON EATS AGAINST. The defect was not a
// wrong figure on a dashboard: it was a bulking target, headed "Calories
// Remaining", put in front of a coach who is cutting and counted down all day —
// built from 'muscle', 'meat' and a hardcoded 1.5 that nobody was ever asked
// for.
import {
  ACTIVITY_LEVELS, activityFactor, activityLevelOf, asOwnGoal, asOwnDiet,
  macroGate, unaskedLine, builtFromLine,
  type OwnMacroInputs,
} from './coachMacros';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const NONE: OwnMacroInputs = { goal: null, diet: null, activity: null };
const ALL: OwnMacroInputs = { goal: 'fatloss', diet: 'vegan', activity: 1.375 };

/* ── the levels ─────────────────────────────────────────────────────────── */

eq(ACTIVITY_LEVELS.length, 5, 'five levels');
ok(ACTIVITY_LEVELS.every((a) => a.factor >= 1.0 && a.factor <= 2.5),
  'every factor is inside the range supabase/parts/1020 allows');
ok(ACTIVITY_LEVELS.every((a, i, xs) => i === 0 || xs[i - 1].factor < a.factor),
  'and they ascend, so the list reads as a scale');
ok(ACTIVITY_LEVELS.every((a) => a.note.length > 0 && a.label.length > 0),
  'each says what it means — 1.55 is a number nobody can calibrate themselves against');
eq(activityFactor('sedentary'), 1.2, 'the multiplier is the published one');
eq(activityFactor('very-active'), 1.9, 'at the other end too');

eq(activityLevelOf(1.375), 'light', 'an exact factor reads back as its level');
eq(activityLevelOf(1.5), 'moderate', 'and a value between two — a row written by an older build — takes the nearer');
eq(activityLevelOf(null), null, 'nothing is not a level');
eq(activityLevelOf(0.4), null, 'and neither is a figure outside the range');
eq(activityLevelOf(9), null, 'at either end — asked again rather than snapped to something plausible');
eq(activityLevelOf(Number.NaN), null, 'nor a NaN out of a numeric column');

/* ── what a stored value is allowed to be ───────────────────────────────── */

eq(asOwnGoal('fatloss'), 'fatloss', 'a known goal passes');
eq(asOwnGoal('bulk'), null, 'an unknown one is null and not a fall-through to a default');
eq(asOwnGoal(null), null, 'and so is nothing');
eq(asOwnDiet('keto'), 'keto', 'a known diet passes');
eq(asOwnDiet('carnivore'), null, 'an unknown one does not silently become "meat"');

/* ── the gate, which is the whole point ─────────────────────────────────── */

{
  const g = macroGate({ status: 'ready', inputs: ALL, measured: true });
  ok(g.ok, 'every answer present and a measured body builds a target');
  if (g.ok) {
    eq(g.goal, 'fatloss', 'and it carries the coach’s OWN goal');
    eq(g.diet, 'vegan', 'their own diet');
    eq(g.activity, 1.375, 'and their own activity');
  }
}

for (const missing of [
  { ...ALL, goal: null }, { ...ALL, diet: null }, { ...ALL, activity: null }, NONE,
] as OwnMacroInputs[]) {
  const g = macroGate({ status: 'ready', inputs: missing, measured: true });
  eq(g.ok, false, 'ANY unanswered question withholds the target');
  if (!g.ok) eq(g.reason, 'unasked', 'and says the question was never asked');
}

{
  const g = macroGate({ status: 'error', inputs: NONE, measured: true });
  eq(g.ok, false, 'a failed read builds nothing');
  if (!g.ok) {
    eq(g.reason, 'unread', 'and is not reported as an unanswered question');
    ok(/could not be read/i.test(g.why), 'it says the read failed');
    ok(!/you have not told this app/i.test(g.why),
      'and never tells a coach who HAS answered that they have not');
  }
}

{
  const g = macroGate({ status: 'loading', inputs: NONE, measured: true });
  if (!g.ok) {
    eq(g.reason, 'reading', 'a read in flight is its own state');
    ok(!/have not/i.test(g.why), 'and claims nothing about what was answered');
  }
}

{
  // The gate this screen already had, kept exactly as it was.
  const g = macroGate({ status: 'ready', inputs: ALL, measured: false });
  eq(g.ok, false, 'no measured body, no target');
  if (!g.ok) eq(g.reason, 'unmeasured', 'and it says which of the two is missing');
}

// Order matters: a failed read must not be reported as an unmeasured body, and
// an unmeasured body must not be reported as an unanswered question.
{
  const g = macroGate({ status: 'error', inputs: ALL, measured: false });
  if (!g.ok) eq(g.reason, 'unread', 'not knowing comes before anything it would explain');
}

/* ── the sentences ──────────────────────────────────────────────────────── */

{
  const one = unaskedLine({ ...ALL, goal: null });
  ok(/what you are training for/i.test(one), 'one missing answer is named');
  ok(!/how you eat/i.test(one), 'and the ones that are answered are not');

  const all = unaskedLine(NONE);
  ok(/what you are training for/i.test(all) && /how you eat/i.test(all) && /how active/i.test(all),
    'all three are named when all three are missing');
  ok(/ or /.test(all), 'and read as a list a person finishes rather than a count');
  ok(/building muscle|assume/i.test(all),
    'it says what the app used to assume, because that is what a coach has been eating against');
}

{
  const line = builtFromLine('fatloss', 'vegan', 1.375);
  ok(/losing fat/i.test(line), 'the built-from line names the goal in words');
  ok(/vegan/i.test(line), 'and the diet');
  ok(/lightly active/i.test(line), 'and the activity level, not the multiplier');
  ok(!/1\.375/.test(line), 'a coach is never shown the bare factor — it is not a number anybody can judge');
}

// Nothing renders as a gap, whatever the state.
for (const status of ['loading', 'ready', 'partial', 'error'] as LoadStatus[]) {
  for (const inputs of [NONE, ALL]) {
    for (const measured of [true, false]) {
      const g = macroGate({ status, inputs, measured });
      if (!g.ok) {
        ok(g.why.length > 0 && !g.why.includes('undefined') && !g.why.includes('null'),
          `${status}/${measured} produces a real sentence`);
      }
    }
  }
}

if (errors.length) {
  console.error(`coachMacros.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('coachMacros.test.ts — ok: no target is built from an answer nobody gave');
