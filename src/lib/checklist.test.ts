// Checklist derivation (TF-31). Compile with tsc then run with node.
//
// The assertions that matter here are the negative ones: that an absent target
// produces NO row rather than a default one. A test that only checks the happy
// path would have passed against the five-item constant this replaces.
import { buildChecklist, scheduledFocus, donePercent, coachHabitId, COACH_ID_PREFIX, type ChecklistInput } from './checklist';
import { buildProgram } from './programs';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

// Nothing known about this client. Every case below starts here and turns on
// exactly the one target it is about.
const NOTHING: ChecklistInput = {
  waterGoalGlasses: null,
  proteinTargetG: null,
  kcalTarget: null,
  stepGoal: null,
  sleepGoalHours: null,
  todaysTrainingFocus: null,
  coachItems: [],
};
const ids = (i: ChecklistInput) => buildChecklist(i).items.map((x) => x.id);
const labelOf = (i: ChecklistInput, id: string) => buildChecklist(i).items.find((x) => x.id === id)?.label ?? '';

// ── nothing known → nothing claimed ──
const empty = buildChecklist(NOTHING);
ok(empty.items.length === 0, `a client with no targets must get no checklist rows, got ${empty.items.length}`);
ok(empty.gaps.some((g) => g.id === 'macros'), 'missing macros should be named as a gap, not silently dropped');
ok(!empty.gaps.some((g) => g.id === 'steps' || g.id === 'sleep'),
  'there is nowhere in the app to set a step or sleep goal, so promising one is not a gap we may raise');

// ── every derived row states the client's own number ──
ok(labelOf({ ...NOTHING, proteinTargetG: 152 }, 'protein') === 'Hit 152 g protein', 'protein row must carry the gram figure');
ok(labelOf({ ...NOTHING, kcalTarget: 2140 }, 'kcal') === 'Eat to your 2,140 kcal target', 'kcal row must carry the calorie figure, separated');
ok(labelOf({ ...NOTHING, waterGoalGlasses: 8 }, 'water') === 'Drink 8 glasses of water', 'water row must carry the glass count');
ok(labelOf({ ...NOTHING, stepGoal: 8000 }, 'steps') === 'Walk 8,000 steps', 'a step goal that exists must be stated, not rounded to a slogan');
ok(labelOf({ ...NOTHING, sleepGoalHours: 7.5 }, 'sleep') === 'Sleep 7.5h+', 'a half-hour sleep goal must survive');
ok(labelOf({ ...NOTHING, sleepGoalHours: 8 }, 'sleep') === 'Sleep 8h+', 'a whole-hour sleep goal must not read "8.0h+"');

// Two clients on different plans must not get the same line — the whole
// complaint behind TF-31.
const lean = labelOf({ ...NOTHING, proteinTargetG: 118 }, 'protein');
const bulk = labelOf({ ...NOTHING, proteinTargetG: 187 }, 'protein');
ok(lean !== bulk, 'two clients with different protein targets must not read identically');

// ── an absent target is never a default ──
ok(!ids({ ...NOTHING, kcalTarget: 2140, proteinTargetG: 152 }).includes('steps'),
  'no step goal must mean no step row — never a fallback 10,000');
ok(!ids({ ...NOTHING, kcalTarget: 2140 }).includes('sleep'), 'no sleep goal must mean no sleep row');
ok(!ids({ ...NOTHING, waterGoalGlasses: 8 }).includes('protein'), 'no macro target must mean no protein row');
// A zero, a NaN and a negative are all "not set", however they got here.
for (const bad of [0, NaN, -3] as number[]) {
  ok(!ids({ ...NOTHING, stepGoal: bad }).includes('steps'), `stepGoal ${bad} must not produce a row`);
  ok(!ids({ ...NOTHING, proteinTargetG: bad }).includes('protein'), `proteinTargetG ${bad} must not produce a row`);
}
// The gap is raised only when the macros are genuinely missing.
ok(!buildChecklist({ ...NOTHING, kcalTarget: 2140, proteinTargetG: 152 }).gaps.some((g) => g.id === 'macros'),
  'a client who HAS macro targets must not be told to go and set them');

// ── the training row comes from the plan, on the days the plan schedules ──
const ppl = buildProgram('muscle', 18).days;   // Mon / Wed / Fri
ok(scheduledFocus(ppl, 1) === 'Push', 'Monday of a PPL plan is Push');
ok(scheduledFocus(ppl, 3) === 'Pull', 'Wednesday of a PPL plan is Pull');
ok(scheduledFocus(ppl, 0) === null, 'Sunday is not in a Mon/Wed/Fri plan and must not borrow the nearest day');
ok(scheduledFocus(ppl, 2) === null, 'Tuesday is not a training day in a Mon/Wed/Fri plan');
ok(scheduledFocus([], 1) === null, 'a plan with no days schedules nothing');
ok(labelOf({ ...NOTHING, todaysTrainingFocus: 'Pull' }, 'train') === 'Train — Pull', 'the training row names the session');
ok(!ids({ ...NOTHING, todaysTrainingFocus: '   ' }).includes('train'), 'a blank focus is not a session');
ok(!ids(NOTHING).includes('train'), 'a rest day carries no training row');

// ── coach items ──
const coached = buildChecklist({
  ...NOTHING,
  waterGoalGlasses: 8,
  coachItems: [
    { id: 'a1b2', label: 'No late-night snacks', icon: '🌙' },
    { id: 'c3d4', label: '  Ten minutes of mobility  ' },
    { id: 'e5f6', label: '   ' },
    { id: '', label: 'orphan' },
    { id: 'a1b2', label: 'a duplicate of the first' },
  ],
});
const coachIds = coached.items.filter((i) => i.source === 'coach').map((i) => i.id);
ok(coachIds.length === 2, `two of the five coach rows are usable, got ${coachIds.length}`);
ok(coachIds[0] === coachHabitId('a1b2'), 'a coach item is keyed on its row id');
ok(coachIds.every((id) => id.startsWith(COACH_ID_PREFIX)), 'coach ids must be namespaced away from derived ones');
ok(coached.items.some((i) => i.label === 'Ten minutes of mobility'), 'a coach label is trimmed, not dropped');
ok(coached.items.find((i) => i.id === coachHabitId('c3d4'))?.icon !== '', 'a coach item with no icon still gets one');
// Renaming the label must not move the storage key, or the tick history detaches.
const renamed = buildChecklist({ ...NOTHING, coachItems: [{ id: 'a1b2', label: 'Something else entirely' }] });
ok(renamed.items.find((i) => i.source === 'coach')?.id === coachIds[0], 'renaming a coach item must not change its habit id');
// Coach rows come after the client's own plan and targets.
ok(coached.items[0].id === 'water', 'derived rows lead; coach additions follow');

// ── the hero percentage ──
ok(donePercent(0, 0) === null, 'an empty checklist has no percentage — this is the divide-by-zero that rendered NaN%');
ok(donePercent(3, 0) === null, 'a done count over an empty list is still nothing to show');
ok(donePercent(0, 4) === 0, 'nothing ticked is 0%, which is a real answer');
ok(donePercent(2, 4) === 50, 'half ticked is 50%');
ok(donePercent(4, 4) === 100, 'all ticked is 100%');
ok(donePercent(5, 4) === 100, 'a stale done count must not exceed 100%');
ok(donePercent(1, NaN) === null, 'a non-finite total has no percentage');
ok(donePercent(1, -4) === null, 'a negative total has no percentage — clamping it to 0% would state a fact');

declare const process: { exit(code: number): void };
console.log(errors.length ? 'CHECKLIST FAILURES:\n' + errors.join('\n') : 'ALL CHECKLIST TESTS PASSED');
if (errors.length) process.exit(1);
