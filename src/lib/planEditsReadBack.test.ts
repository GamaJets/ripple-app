// The member's own plan changes, read back. Compile with tsc, run with node.
//
// This is the first reader `client_plan_edits` has ever had, so every assertion
// below is about a sentence the product has never printed. Three of them are
// the ones that would cost something:
//
//   · "you haven't changed anything" over a read that failed. A member who is
//     told their coach cannot see a month of corrections will make them all
//     again, on a plan screen that will then overwrite the row that was fine.
//   · stored bytes that would not parse, rounded down to "no changes". Part 204
//     and src/lib/planEdits.ts both keep unreadable apart from empty for the
//     device's copy; the server's copy gets the same treatment.
//   · a sentence with a hole where a day or a name should be. The key carries a
//     day index only sometimes and a NAME almost never — it holds a slug — and
//     scripts/check-prose.mjs exists because a screen shipped having lost the
//     first word of its sentence to exactly this.
import { EMPTY_PLAN_EDITS, type PlanEdits } from './planEdits';
import { coachSeesPlanNote, planEditItemLine, planEditItems } from './planEditsReadBack';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const edits = (p: Partial<PlanEdits> = {}): PlanEdits => ({ ...EMPTY_PLAN_EDITS, ...p });

/* ── 1. what the blob actually holds ──────────────────────────────────────*/

{
  const items = planEditItems(edits({
    swaps: { '1:bench': 'Machine Chest Press' },
    exEdits: { '0:squat': { sets: 4 } },
    removed: ['2:plank'],
    custom: [{ key: 'facepull', name: 'Face Pull', group: 'Shoulders', sets: 3, reps: '12-15', alternatives: [] }],
  }));
  eq(items.length, 4, 'four kinds of change, four items');

  const swap = items.find((i) => i.kind === 'swap');
  eq(swap?.name, 'Machine Chest Press',
    'the swapped-TO movement is a name in the record, so it is named');
  eq(swap?.day, 2, 'the stored day index counts from zero and a reader counts from one');

  const numbers = items.find((i) => i.kind === 'numbers');
  eq(numbers?.day, 1, 'day 0 is the first day, not a missing day');
  eq(numbers?.name, null,
    'the key holds a slug and not a name, so nothing is claimed about which movement it was');

  eq(items.find((i) => i.kind === 'custom')?.day, null,
    'an added movement is held in a flat list with no day on it, and that is reported as null');

  // Ids are what a list keys on. Two added movements sharing an exercise key is
  // a state the plan screen permits, and a duplicate key silently drops a row.
  const twins = planEditItems(edits({
    custom: [
      { key: 'x', name: 'One', group: 'Core', sets: 3, reps: '10', alternatives: [] },
      { key: 'x', name: 'Two', group: 'Core', sets: 3, reps: '10', alternatives: [] },
    ],
  }));
  eq(new Set(twins.map((i) => i.id)).size, 2, 'two added movements with one key still get two keys');

  // Stable order. The blob is JSON and its key order is whatever the last write
  // produced; a list built off that reshuffles between reads.
  const a = planEditItems(edits({ swaps: { '1:b': 'B', '0:a': 'A' } })).map((i) => i.id);
  const b = planEditItems(edits({ swaps: { '0:a': 'A', '1:b': 'B' } })).map((i) => i.id);
  eq(a.join('|'), b.join('|'), 'the same set of changes lists in the same order whatever order it was written in');

  eq(planEditItems(EMPTY_PLAN_EDITS).length, 0, 'an untouched plan has nothing to list');
}

/* ── 2. the sentences, and the holes they refuse to leave ─────────────────*/

{
  eq(planEditItemLine({ id: 's', day: 2, kind: 'swap', name: 'Machine Chest Press' }),
    'Day 2: you swapped a movement for Machine Chest Press.', 'a swap names what it swapped to');

  // No day on the key. The prefix goes entirely rather than rendering "Day :".
  const noDay = planEditItemLine({ id: 's', day: null, kind: 'removed', name: null });
  ok(!noDay.includes('Day'), 'a key with no day index produces a sentence with no day in it');
  ok(!noDay.includes('—') && !noDay.includes('null') && !noDay.includes('undefined'),
    'and no dash, and nothing printed where a value was missing');
  eq(noDay, 'You took a movement off.', 'which still reads as a sentence on its own');

  const noName = planEditItemLine({ id: 's', day: 1, kind: 'swap', name: null });
  ok(!noName.includes('null') && !noName.includes('undefined'),
    'a swap whose stored value would not read says so vaguely rather than printing the absence');

  // Four kinds, four sentences. Collapsing any two of them tells the member the
  // wrong thing about what their coach is looking at.
  const said = new Set([
    planEditItemLine({ id: '1', day: 1, kind: 'swap', name: 'X' }),
    planEditItemLine({ id: '2', day: 1, kind: 'removed', name: null }),
    planEditItemLine({ id: '3', day: 1, kind: 'numbers', name: null }),
    planEditItemLine({ id: '4', day: null, kind: 'custom', name: 'X' }),
  ]);
  eq(said.size, 4, 'four kinds of change, four sentences');
}

/* ── 3. what the member is told about the copy their coach reads ──────────*/

{
  const failed = coachSeesPlanNote('error', 0, true, null);
  ok(/couldn’t read/.test(failed), 'a failed read says it failed');
  ok(/not us saying they can see nothing/.test(failed),
    'and refuses the empty claim — the response to that claim is to make every change again');
  ok(/nothing you have changed has been lost/i.test(failed),
    'and says the thing the member will actually be worrying about');

  const unreadable = coachSeesPlanNote('ready', 0, false, '1 September');
  ok(/could not read them back/.test(unreadable),
    'bytes that would not parse are stored-but-unreadable, which is not "no changes"');
  ok(!/haven’t changed anything/.test(unreadable), 'and are never reported as an untouched plan');

  eq(coachSeesPlanNote('ready', 0, true, null),
    'You haven’t changed anything in the programme you were given, so there is nothing of yours here for your coach to look at.',
    'a landed read over an empty row may say so — that is the one state where empty is a fact');

  eq(coachSeesPlanNote('ready', 1, true, '1 September'),
    '1 change of yours reached your coach, last sent on 1 September.', 'singular, with the date');
  eq(coachSeesPlanNote('ready', 3, true, '1 September'),
    '3 changes of yours reached your coach, last sent on 1 September.', 'plural, with the date');
  eq(coachSeesPlanNote('ready', 3, true, null), '3 changes of yours reached your coach.',
    'a stamp that would not read costs the date and not the count');

  // 'partial' cannot arise on a single-row read and is handled anyway: the
  // count is a figure, and src/ui/loadStatus.ts forbids a figure over a set
  // known to be a prefix.
  const part = coachSeesPlanNote('partial', 3, true, '1 September');
  ok(!part.includes('3 changes'), 'no count is stated over a read known to be short');

  const loading = coachSeesPlanNote('loading', 0, true, null);
  ok(!/haven’t changed anything/.test(loading), 'a read still in flight never asserts an empty plan');

  eq(new Set([failed, unreadable, loading, part, coachSeesPlanNote('ready', 0, true, null)]).size, 5,
    'five situations, five sentences');
}

declare const process: { exit(code: number): void };
console.log(errors.length ? 'PLAN EDITS READ-BACK FAILURES:\n' + errors.join('\n') : 'planEditsReadBack: ok — a failed read never says you changed nothing, unreadable is not empty, and no sentence is built around a missing day or name');
if (errors.length) process.exit(1);
