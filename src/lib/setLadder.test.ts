import type { SetSpec } from './setRows';
import {
  MAX_LADDER_SETS, ladderDone, ladderFromPlan, ladderNote, ladderToPlanRows, ladderVaried,
  patchLadderRow, readLadder, readSetCount, resizeLadder, setAllLadderRows, toggleLadderRow,
  type LadderRow,
} from './setLadder';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};

const row = (reps: string, load: string, done = false): LadderRow => ({ reps, load, done });

// ── the count box ─────────────────────────────────────────────────────────
//
// It used to be `parseInt(x, 10) || 3`, which turned every mistype into three
// rows nobody asked for.
eq(readSetCount('3'), { ok: true, n: 3 }, 'three is three');
eq(readSetCount(' 4 '), { ok: true, n: 4 }, 'surrounding space is not part of the number');
eq(readSetCount('1'), { ok: true, n: 1 }, 'one set is a session');
eq(readSetCount(String(MAX_LADDER_SETS)), { ok: true, n: MAX_LADDER_SETS }, 'the bound itself is allowed');
ok(!readSetCount('').ok, 'an empty box is not a count');
ok(!readSetCount('0').ok, 'zero sets is not a number of sets');
ok(!readSetCount('-2').ok, 'nor is a negative one');
ok(!readSetCount('3.5').ok, 'half a set is not a set');
ok(!readSetCount('abc').ok, 'and neither is a word');
ok(!readSetCount(String(MAX_LADDER_SETS + 1)).ok, 'past the bound is a typo, not a session');
// The two shapes that make `Number` and `parseInt` disagree with a person.
ok(!readSetCount('3kg').ok, 'a count with a unit stuck to it is refused rather than read as three');
ok(!readSetCount('1e2').ok, 'and so is exponent notation');

// ── growing and shrinking the table ───────────────────────────────────────
eq(resizeLadder([], 3), [row('', ''), row('', ''), row('', '')], 'an empty table grows to three blank rows');
const typed = [row('8', '60', true)];
eq(resizeLadder(typed, 3), [row('8', '60', true), row('8', '60'), row('8', '60')],
  'growing copies the last row forward, so a fourth set is another of the third');
ok(resizeLadder(typed, 3).slice(1).every((r) => !r.done),
  'but never the tick: a copied number is a suggestion and a tick is testimony');
eq(resizeLadder([row('8', '60', true), row('6', '70', true), row('6', '70')], 2),
  [row('8', '60', true), row('6', '70', true)], 'shrinking drops rows off the end and keeps what was typed');
eq(resizeLadder([row('8', '60')], 0), [], 'nothing is not a table');
eq(resizeLadder([row('8', '60')], -4), [], 'and neither is a negative count');
eq(resizeLadder([row('8', '60')], Number.NaN), [], 'a count that is not a number makes no rows');
eq(resizeLadder([], MAX_LADDER_SETS + 5).length, MAX_LADDER_SETS,
  'and a count past the bound cannot make more rows than the bound');
// The first row of an empty table has nothing to copy.
eq(resizeLadder([], 1), [row('', '')], 'the first row of an empty table is blank rather than a copy of nothing');

// ── editing one row ───────────────────────────────────────────────────────
const three = resizeLadder([], 3);
eq(patchLadderRow(three, 1, { load: '65' })[1], row('', '65'), 'a patch changes the row it names');
eq(patchLadderRow(three, 1, { load: '65' })[0], row('', ''), 'and leaves the others alone');
eq(patchLadderRow(three, 9, { load: '65' }), three, 'an index off the end changes nothing');
eq(patchLadderRow(three, -1, { load: '65' }), three, 'and neither does a negative one');
eq(toggleLadderRow(three, 0)[0].done, true, 'a tick goes on');
eq(toggleLadderRow(toggleLadderRow(three, 0), 0)[0].done, false, 'and comes off again');
eq(setAllLadderRows(three, true).filter((r) => r.done).length, 3, 'all of them at once');
eq(setAllLadderRows(setAllLadderRows(three, true), false).filter((r) => r.done).length, 0, 'and off again');
eq(ladderDone(setAllLadderRows(three, true)), 3, 'the tick count is the ticks');
eq(ladderDone(three), 0, 'and none is none');

// ── what gets saved, and what emphatically does not ───────────────────────
//
// THE assertion of this file. A member enters three sets and fills two: the
// third is missing, not zero, and it must not reach the log in any form.
const twoOfThree: LadderRow[] = [row('8', '60', true), row('8', '65', true), row('', '')];
const read = readLadder(twoOfThree, 'kg');
ok(read.ok, 'two ticked rows read');
if (read.ok) {
  eq(read.sets, [[8, 60], [8, 65]], 'two sets are saved at their OWN loads — the point of the whole table');
  eq(read.sets.length, 2, 'and the untouched third row is not a third set');
}
// The same table with the third row ticked but not filled is a question, not a
// silent drop. Somebody who ticked it said they did it.
const tickedBlank: LadderRow[] = [row('8', '60', true), row('8', '65', true), row('', '', true)];
const blankRead = readLadder(tickedBlank, 'kg');
ok(!blankRead.ok, 'a ticked row with no reps is refused rather than written as zero');
ok(!blankRead.ok && blankRead.reason.includes('Set 3'), 'and the refusal names which set');
// An unticked row is never refused, however wrong its boxes are: it is not a
// set, so nothing about it is being claimed.
const rubbishUnticked: LadderRow[] = [row('8', '60', true), row('nonsense', 'also nonsense')];
const rubbish = readLadder(rubbishUnticked, 'kg');
ok(rubbish.ok, 'an unticked row is not read at all, so its boxes cannot refuse the save');
if (rubbish.ok) eq(rubbish.sets, [[8, 60]], 'and contributes nothing');
// Nothing ticked at all.
ok(!readLadder(resizeLadder([], 3), 'kg').ok, 'a table with no ticks saves nothing and says so');
ok(!readLadder([], 'kg').ok, 'and neither does no table');

// A blank load box is a bodyweight set, stored as 0 — this app's existing
// written convention, not a figure invented here.
const bwRead = readLadder([row('10', '', true)], 'kg');
ok(bwRead.ok, 'a set with no load is still a set');
if (bwRead.ok) eq(bwRead.sets, [[10, 0]], 'and its load is the zero every other writer of workouts.sets stores');

// Reps are bounded at both ends.
ok(!readLadder([row('0', '60', true)], 'kg').ok, 'zero reps is not a set that happened');
ok(!readLadder([row('201', '60', true)], 'kg').ok, 'and two hundred and one is a typo');
ok(readLadder([row('200', '60', true)], 'kg').ok, 'two hundred is allowed');
ok(!readLadder([row('8.5', '60', true)], 'kg').ok, 'half a rep is not a rep');

// A load that cannot be believed is refused, with the set named and the reason
// stated in the unit on the keyboard. `readLift` owns the bound.
const badLoad = readLadder([row('8', '9000', true)], 'kg');
ok(!badLoad.ok, 'an unbelievable load is refused');
ok(!badLoad.ok && badLoad.reason.indexOf('Set 1') === 0, 'and the refusal opens with the set it came from');

// ── the unit is read, never assumed ───────────────────────────────────────
//
// Storage is kilograms whatever is on the keyboard. 100 lb is 45.36 kg, and a
// table read as kilograms would put more than double the weight on the bar.
const lb = readLadder([row('5', '100', true)], 'lb');
ok(lb.ok, 'a pounds table reads');
if (lb.ok) {
  ok(lb.sets[0][1] > 45 && lb.sets[0][1] < 46, 'and 100 lb is stored as about 45 kg rather than as 100');
  ok(lb.sets[0][1] !== 100, 'the number typed is not the number stored');
}
const kg = readLadder([row('5', '100', true)], 'kg');
if (kg.ok) eq(kg.sets[0][1], 100, 'while 100 kg is stored as 100');

// ── the sentence under the table ──────────────────────────────────────────
eq(ladderNote(setAllLadderRows(resizeLadder([], 3), true)), null,
  'nothing is said when every row is ticked — the screen already shows that');
eq(ladderNote([]), null, 'and nothing is said about no table');
ok((ladderNote(resizeLadder([], 3)) ?? '').includes('not saved'),
  'a table with no ticks says out loud that nothing is saved');
const partial = ladderNote([row('8', '60', true), row('8', '60'), row('8', '60')]) ?? '';
ok(partial.includes('1 of 3'), 'a part-ticked table counts the ticks');
ok(partial.includes('2 are'), 'and counts what is being left out, in the plural');
const one = ladderNote([row('8', '60', true), row('8', '60')]) ?? '';
ok(one.includes('one is'), 'a single unticked row is singular rather than "1 are"');

// ── whether the ticked sets differ ────────────────────────────────────────
ok(!ladderVaried([row('8', '60', true), row('8', '60', true)]), 'two identical sets are not a ramp');
ok(ladderVaried([row('8', '60', true), row('8', '65', true)]), 'two loads are');
ok(ladderVaried([row('8', '60', true), row('6', '60', true)]), 'and so are two rep counts');
ok(!ladderVaried([row('8', '60', true)]), 'one set cannot differ from anything');
ok(!ladderVaried([row('8', '60'), row('8', '65')]), 'and unticked rows are not part of what happened');

// ── none of it writes to what it was given ────────────────────────────────
const frozen: LadderRow[] = [row('8', '60', true), row('8', '65')];
const before = JSON.stringify(frozen);
resizeLadder(frozen, 4); patchLadderRow(frozen, 0, { reps: '99' }); toggleLadderRow(frozen, 0);
setAllLadderRows(frozen, true); readLadder(frozen, 'kg'); ladderNote(frozen); ladderVaried(frozen);
eq(JSON.stringify(frozen), before, 'the table handed in is never written to');


// ── the same rows read as a PLAN rather than as a log ─────────────────────
//
// The one place in this module where a blank load box means something else: in
// a log it is a bodyweight set, in a plan it is no target at all.
const planned: SetSpec = { sets: 3, reps: '8-10', loadKg: 42.5 };
eq(ladderFromPlan(planned, 'kg'), [
  { reps: '8-10', load: '42.5', done: false },
  { reps: '8-10', load: '42.5', done: false },
  { reps: '8-10', load: '42.5', done: false },
], 'a plan with no table opens as its own sets, written out');
eq(ladderFromPlan({ sets: 1, reps: '12' }, 'kg'), [{ reps: '12', load: '', done: false }],
  'a movement with no prescribed load opens on an empty box rather than on a zero');
eq(ladderFromPlan({ sets: 1, reps: '5', loadKg: 100 }, 'lb')[0].load, '220.5',
  'and it opens in the unit the sheet is set to, so what is shown is what would be saved');
// A coach's ramp survives being opened.
eq(ladderFromPlan({
  sets: 2, reps: '8', loadKg: 60,
  setRows: [{ reps: '8', loadKg: 60 }, { reps: '6', loadKg: 70 }],
}, 'kg'), [
  { reps: '8', load: '60', done: false },
  { reps: '6', load: '70', done: false },
], 'a table opens as the table, one row per row');

const plan = ladderToPlanRows([
  { reps: '8-10', load: '42.5', done: false },
  { reps: 'AMRAP', load: '', done: false },
], 'kg');
ok(plan.ok, 'a plan table reads whether or not anything is ticked');
if (plan.ok) {
  eq(plan.setRows, [{ reps: '8-10', loadKg: 42.5 }, { reps: 'AMRAP', loadKg: null }],
    'a range and an AMRAP are what a coach writes, and neither is narrowed to a number');
  ok(plan.setRows[1].loadKg === null, 'and a blank load on a PLAN is no target — null, not the log side’s zero');
}
// A load that cannot be believed is still refused, named by its row.
const badPlan = ladderToPlanRows([{ reps: '8', load: 'heavy', done: false }], 'kg');
ok(!badPlan.ok, 'a load that is not a number is refused');
ok(!badPlan.ok && badPlan.reason.indexOf('Set 1') === 0, 'and the refusal names the row');
ok(!ladderToPlanRows([], 'kg').ok, 'a movement of no sets is not a movement');
// The unit is read here too. A plan typed in pounds is stored in kilograms.
const lbPlan = ladderToPlanRows([{ reps: '5', load: '220.5', done: false }], 'lb');
if (lbPlan.ok) ok((lbPlan.setRows[0].loadKg ?? 0) > 99 && (lbPlan.setRows[0].loadKg ?? 0) < 101,
  '220.5 lb is stored as about 100 kg');
// Round trip: what a sheet opens on is what it saves back.
const there = ladderFromPlan(planned, 'kg');
const back = ladderToPlanRows(there, 'kg');
if (back.ok) eq(back.setRows, [
  { reps: '8-10', loadKg: 42.5 }, { reps: '8-10', loadKg: 42.5 }, { reps: '8-10', loadKg: 42.5 },
], 'opening a plan and saving it unchanged changes nothing about it');

if (errors.length) { errors.forEach((e) => console.error('FAIL', e)); process.exit(1); }
console.log('setLadder ok — three sets can carry three loads, and a row nobody ticked is not a set');
