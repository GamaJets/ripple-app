// The two week edits the builder could not make, and the overview of a block
// nobody could read without opening twelve weeks.
//
// ── What is actually being held here ──────────────────────────────────────
//
// Three properties, and every one of them is silent when it breaks:
//
//   1. THE INDEX THAT COMES BACK. A move or a duplicate that returns the wrong
//      index leaves the coach typing into a week they are not looking at. There
//      is no cue on the screen for that — the strip highlights one week and the
//      day list below it is another week's — and what it produces is a
//      programme with two half-written weeks in it.
//
//   2. WHETHER WEEK ONE MOVED. `days` is week one and week one is what the
//      client's phone renders (src/lib/programBlock.ts). A move that reports
//      `movedWeekOne: false` when it did move week one is a screen that stays
//      quiet while changing what somebody trains.
//
//   3. THAT THE COPY IS A COPY. `duplicateWeek` takes the caller's `clone`
//      because the builder's exercises are keyed, and a duplicate that shared
//      the original's objects would make typing into one edit the other. The
//      assertion below is that `clone` is actually called and that its answer
//      is what lands.
//
// Compile with tsc, run with node.
import { blockOverview, blockWarnings, duplicateWeek, moveWeek, weekEditWarning, type PlanWeek } from './blockPlan';
import { MAX_WEEKS } from './programBlock';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const ex = (name: string, sets = 3, reps = '8-10') => ({ name, sets, reps });
const day = (d: string, ...names: string[]): PlanWeek['days'][number] =>
  ({ day: d, focus: 'Upper', exercises: names.map((n) => ex(n)) });
const week = (...ds: PlanWeek['days'][number][]): PlanWeek => ({ days: ds });

/* ── the overview ───────────────────────────────────────────────────────── */
{
  const w1 = week(day('Mon', 'Bench Press', 'Seated Row'), day('Wed', 'Back Squat'));
  const w2 = week(day('Mon', 'Bench Press', 'Seated Row'), day('Wed', 'Back Squat'));
  const w3: PlanWeek = { days: [day('Mon', 'Bench Press')], deload: true, label: 'Easy week' };
  const rows = blockOverview([w1, w2, w3, { days: [] }]);

  eq(rows.length, 4, 'one line per week');
  eq(rows[0].n, 1, 'the number a person reads is 1-based');
  eq(rows[0].days, 2, 'the day count is the days in that week');
  eq(rows[0].exercises, 3, 'the movement count is summed across the days of that week');
  eq(rows[0].sameAsPrevious, false, 'week one has nothing before it, so it is never a repeat');
  eq(rows[1].sameAsPrevious, true, 'an identical week is reported as a repeat of the one before it');
  eq(rows[2].sameAsPrevious, false, 'a week with different training is not a repeat');
  eq(rows[2].label, 'Easy week · Deload', 'the coach’s own label is used, and the deload is in it');
  eq(rows[3].empty, true, 'a week with no days is empty');
  // Two empty weeks in a row fingerprint identically, and calling the second a
  // repeat of the first would put "same as week 4" on a screen whose whole job
  // here is to say that both of them are holes. `blockWarnings` names them.
  const twoHoles = blockOverview([w1, { days: [] }, { days: [] }]);
  eq(twoHoles[2].sameAsPrevious, false, 'two empty weeks are not reported as repeats of each other');
  ok(rows[0].detail.includes('2 days'), 'the detail line pluralises the day count');
  ok(rows[2].detail.includes('1 movement') && !rows[2].detail.includes('1 movements'), 'one movement is not "1 movements"');
  ok(/no training days/i.test(rows[3].detail), 'an empty week says so rather than showing two noughts');

  // The label and the deload flag are NOT part of what makes two weeks
  // different. A coach who marks week two a deload and changes nothing else has
  // named the week they wrote, not written a different one.
  const named = blockOverview([w1, { ...w2, deload: true, label: 'Deload' }]);
  eq(named[1].sameAsPrevious, true, 'marking a week a deload does not make it different training');

  // Prose is not training either — `daySignature` in groupProgram.ts compares
  // the same fields and this must not disagree with it.
  const sameSets = blockOverview([w1, { days: [{ ...w1.days[0], focus: 'Push' }, w1.days[1]] }]);
  eq(sameSets[1].sameAsPrevious, false, 'a changed focus is a changed day');

  eq(blockOverview([]).length, 0, 'an empty block has no lines');
  eq(blockOverview(null).length, 0, 'a missing block has no lines rather than throwing');
}

/* ── the one warning, and the silence around it ─────────────────────────── */
{
  const full = week(day('Mon', 'Bench Press'));
  eq(blockWarnings([{ days: [] }]).length, 0, 'an unstarted one-week programme is not complained about');
  eq(blockWarnings([full]).length, 0, 'a one-week programme is never warned about');
  eq(blockWarnings([full, full]).length, 0, 'a block with training in every week is not warned about');

  const one = blockWarnings([full, { days: [] }]);
  eq(one.length, 1, 'one empty week in a block is reported');
  ok(one[0].includes('Week 2'), 'the warning names the week');
  ok(/trains nothing/.test(one[0]), 'the warning says what it means for the person on the block');

  const two = blockWarnings([full, { days: [] }, full, { days: [] }]);
  eq(two.length, 1, 'the empty weeks are one sentence, not one sentence each');
  ok(two[0].includes('Week 2') && two[0].includes('Week 4'), 'every empty week is named');
  ok(two[0].includes(' and '), 'two empty weeks read as a list');
}

/* ── moving a week ──────────────────────────────────────────────────────── */
{
  const ws = ['a', 'b', 'c', 'd'];

  const later = moveWeek(ws, 1, 2);
  eq(later?.weeks.join(''), 'acbd', 'a week moved one later swaps with the week after it');
  eq(later?.index, 2, 'the coach follows the week they moved');
  eq(later?.movedWeekOne, false, 'moving two middle weeks does not touch week one');
  eq(ws.join(''), 'abcd', 'the list handed in is not mutated');

  const earlier = moveWeek(ws, 3, 0);
  eq(earlier?.weeks.join(''), 'dabc', 'a week moved to the front lands at the front');
  eq(earlier?.index, 0, 'the index follows it to the front');
  eq(earlier?.movedWeekOne, true, 'a move INTO position one is a change to what a client trains');

  const outOfOne = moveWeek(ws, 0, 2);
  eq(outOfOne?.weeks.join(''), 'bcad', 'a week moved out of position one leaves the next week there');
  eq(outOfOne?.movedWeekOne, true, 'a move OUT of position one is a change to what a client trains');

  eq(moveWeek(ws, 1, 1), null, 'a move to the same position does nothing and says so');
  eq(moveWeek(ws, -1, 2), null, 'a negative source is refused');
  eq(moveWeek(ws, 1, 4), null, 'a destination past the end is refused rather than clamped');
  eq(moveWeek(ws, 4, 1), null, 'a source past the end is refused');
  eq(moveWeek(['a'], 0, 0), null, 'a one-week block cannot be reordered');
  eq(moveWeek(ws, 1.5, 2), null, 'a fractional index is refused rather than floored');
}

/* ── duplicating a week ─────────────────────────────────────────────────── */
{
  const ws = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  let cloned = 0;
  const clone = (w: { id: string }) => { cloned += 1; return { id: w.id + '-copy' }; };

  const dup = duplicateWeek(ws, 1, clone, MAX_WEEKS);
  eq(dup?.weeks.map((w) => w.id).join(','), 'a,b,b-copy,c', 'the copy lands directly after the week it came from');
  eq(dup?.index, 2, 'the coach lands on the copy');
  eq(dup?.movedWeekOne, false, 'a copy inserted after week one cannot change week one');
  eq(cloned, 1, 'the caller’s clone is what makes the copy');
  ok(dup?.weeks[2] !== ws[1], 'the copy is not the same object as the original');
  eq(ws.length, 3, 'the list handed in is not mutated');

  const first = duplicateWeek(ws, 0, clone, MAX_WEEKS);
  eq(first?.weeks.map((w) => w.id).join(','), 'a,a-copy,b,c', 'duplicating week one leaves week one where it is');
  eq(first?.movedWeekOne, false, 'duplicating week one does not change what a client trains');

  const atCeiling = Array.from({ length: MAX_WEEKS }, (_, i) => ({ id: String(i) }));
  eq(duplicateWeek(atCeiling, 0, clone, MAX_WEEKS), null, 'a block at the ceiling refuses rather than dropping a week');
  eq(duplicateWeek(atCeiling, 0, clone, MAX_WEEKS + 1)?.weeks.length, MAX_WEEKS + 1, 'the ceiling is the caller’s, not a constant in here');
  eq(duplicateWeek(ws, 3, clone, MAX_WEEKS), null, 'duplicating a week that is not there is refused');
  eq(duplicateWeek([], 0, clone, MAX_WEEKS), null, 'there is nothing to duplicate in an empty block');
}

/* ── what the coach is told before it lands ─────────────────────────────── */
{
  eq(weekEditWarning(null), null, 'no edit is no warning');
  eq(weekEditWarning({ weeks: [], index: 0, movedWeekOne: false }), null, 'an edit that leaves week one alone is silent');
  const line = weekEditWarning({ weeks: [], index: 0, movedWeekOne: true });
  ok(!!line && /week one/i.test(line), 'the warning names week one');
  ok(!!line && /assign/i.test(line), 'the warning says nothing reaches anybody until it is assigned again');
}

if (errors.length) {
  console.error(`blockPlan: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('blockPlan: ok');
