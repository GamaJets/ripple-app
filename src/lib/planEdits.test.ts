// A member's own changes to their plan, and the two ways they get lost.
// Compile with tsc, run with node.
//
//   THE ROUND TRIP   what is written is what comes back, keys and all
//   UNREADABLE       bytes nobody could parse are not "no changes"
//   THE SENTENCE     "your coach can see this" is never said off an
//                    unanswered write
import {
  readPlanEdits, writePlanEdits, isEmptyEdits, editCount, editsForDay,
  planEditsNote, EMPTY_PLAN_EDITS, PLAN_EDITS_KEY, type PlanEdits,
} from './planEdits';
import type { ProgramExercise } from './programs';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const CUSTOM: ProgramExercise = {
  key: 'cx-1', name: 'Kettlebell Windmill', group: 'Core', sets: 3, reps: '8', alternatives: [],
};

const FULL: PlanEdits = {
  swaps: { '0:bench': 'Dumbbell Press' },
  exEdits: { '0:squat': { sets: 4, reps: '5', loadKg: 102.5 }, '2:rdl': { loadKg: null } },
  removed: ['0:lateral', '2:calf'],
  custom: [CUSTOM],
};

/* ── THE ROUND TRIP ───────────────────────────────────────────────────────── */
{
  const back = readPlanEdits(writePlanEdits(FULL));
  ok(back.read, 'what this file wrote, this file can read');
  eq(JSON.stringify(back.edits.swaps), JSON.stringify(FULL.swaps), 'the swaps survive');
  eq(back.edits.exEdits['0:squat'].loadKg, 102.5, 'and a corrected load survives as a number');
  eq(back.edits.removed.length, 2, 'both removals survive');
  eq(back.edits.custom[0].name, 'Kettlebell Windmill', 'and a movement the member added survives with its name');

  // Absent and null are different answers, exactly as they are in setRows.ts.
  ok('loadKg' in back.edits.exEdits['2:rdl'], 'a load explicitly set to nothing keeps its key');
  eq(back.edits.exEdits['2:rdl'].loadKg, null, 'and stays null rather than becoming a number');
  ok(!('sets' in back.edits.exEdits['2:rdl']), 'while a field nobody touched does not gain one');

  eq(editCount(FULL), 6, 'six separate changes — a movement both swapped and re-loaded is two things to look at');
  eq(editsForDay(FULL, 0), 3, 'three of them are about Monday');
  eq(editsForDay(FULL, 2), 2, 'and two about Wednesday, with the custom movement belonging to no one day');
  eq(isEmptyEdits(FULL), false, 'a plan with changes is not an unchanged plan');
  eq(isEmptyEdits(EMPTY_PLAN_EDITS), true, 'and an untouched one is');
  eq(PLAN_EDITS_KEY, 'repple.planEdits', 'the storage key is stable, because a renamed key is a wiped plan');
}

/* ── UNREADABLE ───────────────────────────────────────────────────────────
 *
 * The distinction the offline queue draws for the same reason: `null` from
 * AsyncStorage is a real answer, and bytes that will not parse are not. A
 * caller that cannot tell them apart writes an empty object over a member's
 * whole set of corrections the first time one JSON parse fails.
 */
{
  const never = readPlanEdits(null);
  ok(never.read, 'a member who has never changed anything HAS been read');
  eq(isEmptyEdits(never.edits), true, 'and has no changes');

  const broken = readPlanEdits('{ not json');
  ok(!broken.read, 'bytes nobody can parse are not an empty plan');
  eq(isEmptyEdits(broken.edits), true, 'though what is handed back is safe to render');

  const wrongShape = readPlanEdits('[1,2,3]');
  ok(!wrongShape.read, 'and neither is an array where an object belongs');

  // Junk inside a readable object is dropped field by field rather than
  // failing the whole read: one bad key must not cost a member every swap.
  const messy = readPlanEdits(JSON.stringify({
    swaps: { '0:bench': 'Dumbbell Press', '0:row': 42 },
    exEdits: { '0:squat': { sets: 'four' }, '1:x': null },
    removed: ['0:lateral', 7],
    custom: [CUSTOM, { name: 'no key' }, 'nonsense'],
  }));
  ok(messy.read, 'a readable object is read');
  eq(Object.keys(messy.edits.swaps).length, 1, 'a swap to something that is not a name is dropped');
  eq(messy.edits.swaps['0:bench'], 'Dumbbell Press', 'and the good one beside it is kept');
  eq(Object.keys(messy.edits.exEdits).length, 0, 'an edit with nothing readable in it is dropped');
  eq(messy.edits.removed.length, 1, 'and so is a removal that is not a key');
  eq(messy.edits.custom.length, 1, 'a custom movement with no key or name is not a movement');
}

/* ── THE SENTENCE ─────────────────────────────────────────────────────────
 *
 * Three states, three sentences, and the middle one has to exist: changes kept
 * on the phone but not yet seen by the coach are neither lost nor shared.
 */
{
  eq(planEditsNote(EMPTY_PLAN_EDITS, true), null, '"0 changes are saved" is not a sentence');

  const shared = planEditsNote(FULL, true)!;
  ok(/coach can see/.test(shared), 'a write the server took says the coach can see it');

  const kept = planEditsNote(FULL, false)!;
  ok(/not reached your coach/.test(kept), 'a write nobody answered says so');
  ok(/saved on this phone/.test(kept), 'and says the changes are not lost, which is the other half of it');
  ok(!/coach can see/.test(kept), 'and never claims the coach has seen them');

  const unknown = planEditsNote(FULL, null)!;
  ok(/saved on this phone/.test(unknown), 'before we know, the phone is what we can vouch for');
  ok(!/coach/.test(unknown), 'and the coach is not mentioned at all rather than guessed about');

  const one = planEditsNote({ ...EMPTY_PLAN_EDITS, removed: ['0:lateral'] }, true)!;
  ok(/1 change to your plan/.test(one), 'one change reads as one change');
  ok(/see it\./.test(one), 'in the singular all the way through the sentence');
}


/**
 * THE TABLE — a member writing 60 / 65 / 65 into their own plan.
 *
 * `setRows` arrived after the other three keys, and the whole safety of adding
 * it is that an edit written before it round-trips unchanged: absent stays
 * absent, and every correction already on a phone still means "N of the same
 * set".
 */
{
  const withTable: PlanEdits = {
    ...EMPTY_PLAN_EDITS,
    exEdits: { '0:squat': { sets: 3, reps: '8', loadKg: 60, setRows: [
      { reps: '8', loadKg: 60 }, { reps: '8', loadKg: 65 }, { reps: '6', loadKg: 65 },
    ] } },
  };
  const back = readPlanEdits(writePlanEdits(withTable));
  ok(back.read, 'a table round-trips');
  eq(JSON.stringify(back.edits.exEdits['0:squat'].setRows), JSON.stringify(withTable.exEdits['0:squat'].setRows),
    'and comes back row for row, each with its own load');

  // The case every existing correction is in.
  const old = readPlanEdits(JSON.stringify({ swaps: {}, exEdits: { '0:squat': { sets: 3, reps: '8', loadKg: 60 } }, removed: [], custom: [] }));
  ok(!('setRows' in old.edits.exEdits['0:squat']),
    'an edit written before the table has no setRows key at all — absent, not null');

  // A row with a null load is "nothing on the bar", which is not the same as a
  // row that has not said. Both survive JSON, which is why the shape is what it
  // is; see src/lib/setRows.ts.
  const nulls = readPlanEdits(JSON.stringify({ exEdits: { '0:dip': { setRows: [{ reps: '10', loadKg: null }] } } }));
  eq(JSON.stringify(nulls.edits.exEdits['0:dip'].setRows), JSON.stringify([{ reps: '10', loadKg: null }]),
    'a row with nothing on the bar keeps its null');

  // The blob also arrives from the server, where a jsonb column will hold
  // anything at all.
  const junk = readPlanEdits(JSON.stringify({ exEdits: { '0:row': { sets: 2, setRows: ['nope', 7, null, { reps: '8' }] } } }));
  eq(JSON.stringify(junk.edits.exEdits['0:row'].setRows), JSON.stringify([{ reps: '8' }]),
    'rows that are not objects are dropped rather than carried into the plan');
  const empty = readPlanEdits(JSON.stringify({ exEdits: { '0:row': { sets: 2, setRows: [] } } }));
  ok(!('setRows' in empty.edits.exEdits['0:row']),
    'an empty table is not a table — a movement with no sets to log against is worse than the old fields');
  const notArray = readPlanEdits(JSON.stringify({ exEdits: { '0:row': { sets: 2, setRows: 'three' } } }));
  ok(!('setRows' in notArray.edits.exEdits['0:row']), 'and neither is a string');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('planEdits.test.ts ok');
