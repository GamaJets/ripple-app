// The coach's sheet against the last time their client did the movement.
//
// The assertion this file is really for is section 3: that 8 × 60 followed by
// 5 × 70 does not report minus three reps in a row headed progress. Everything
// else is the ordinary discipline — nulls where a figure cannot be derived, and
// no opinion anywhere about whether a change is good.
//
// Compile with tsc, then run under plain node.
import { sheetTally, compareToLast, topRepsNote, hasComparison, previousSets } from './sheetProgress';
import { est1RM } from './streaks';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

/* ── 1. the fold ──────────────────────────────────────────────────────────── */

{
  const t = sheetTally([[8, 60], [8, 60], [6, 65]]);
  eq(t.setCount, 3, 'three sets');
  eq(t.reps, 22, 'and twenty-two reps');
  eq(t.volumeKg, 8 * 60 + 8 * 60 + 6 * 65, 'tonnage is reps times load, summed');
  eq(t.topLoadKg, 65, 'the heaviest load is the top load');
  eq(t.topReps, 6, 'and the reps at it');
  eq(t.best1RMKg, Math.max(est1RM(60, 8), est1RM(65, 6)), 'the best estimate across the sets');
}

// The most reps AT the top load, not the most reps.
{
  const t = sheetTally([[12, 60], [5, 100], [8, 100]]);
  eq(t.topLoadKg, 100, 'the heaviest is the heaviest');
  eq(t.topReps, 8, 'and eight at it beats five at it');
  ok(t.topReps !== 12, 'twelve at a lighter load is not the top set');
}

/* ── 2. nulls, never noughts ──────────────────────────────────────────────── */

// A blank row somebody tabbed past is not a set of no repetitions.
{
  const t = sheetTally([[8, 60], [0, 60], [-2, 60]]);
  eq(t.setCount, 1, 'only sets with a rep count are counted');
  eq(t.reps, 8, 'and only their reps');
}

// Bodyweight sets: reps are real, load is unknown. A session of eight
// bodyweight sets is not a session of no work, so the tonnage is withheld
// rather than reported as zero.
{
  const t = sheetTally([[8, null], [8, null]]);
  eq(t.setCount, 2, 'the sets happened');
  eq(t.reps, 16, 'and the reps did');
  eq(t.volumeKg, null, 'but the tonnage is unknown, not nought');
  eq(t.topLoadKg, null, 'and there is no top load');
  eq(t.topReps, null, 'so there are no reps at one');
  eq(t.best1RMKg, null, 'and no estimate');
}

eq(sheetTally([]).volumeKg, null, 'an empty sheet has no tonnage');
eq(sheetTally(null).setCount, 0, 'and nothing at all is nothing');
eq(sheetTally(undefined).reps, 0, 'either way round');

/* ── 3. THE TRAP: reps are not comparable across a changed load ───────────── */

// 8 × 60 last week, 5 × 70 this week. A naive subtraction reports −3 reps about
// a session that went up ten kilograms.
{
  const last = sheetTally([[8, 60]]);
  const now = sheetTally([[5, 70]]);
  const d = compareToLast(now, last);
  eq(d.topLoadKg, 10, 'the load went up ten');
  eq(d.sameTopLoad, false, 'the top loads differ');
  eq(d.topReps, null, 'so reps at the top set are NOT compared');
  ok(d.best1RMKg != null && d.best1RMKg > 0, 'and the estimated max, which does carry across, went up');
  ok((topRepsNote(d) ?? '').includes('different weight'), 'and the screen is told why the reps figure is absent');
  ok(/1RM/i.test(topRepsNote(d) ?? ''), 'and pointed at the figure that answers the question');
}

// Same load: now reps ARE the comparison, and they are the whole story.
{
  const last = sheetTally([[6, 100]]);
  const now = sheetTally([[8, 100]]);
  const d = compareToLast(now, last);
  eq(d.sameTopLoad, true, 'the same weight on the bar');
  eq(d.topReps, 2, 'so two more reps at it is the progress');
  eq(d.topLoadKg, 0, 'and the load itself did not move');
  eq(topRepsNote(d), null, 'nothing to explain');
}

/* ── 4. no first-session comparison, and no zero standing in for a gap ────── */

{
  const d = compareToLast(sheetTally([[8, 60]]), null);
  ok(!hasComparison(d), 'a movement never done before has no comparison');
  eq(d.topLoadKg, null, 'and no figure is invented for it');
  eq(d.reps, null, 'not one');
}

// Nothing typed yet must not report the whole of last week as a loss.
{
  const d = compareToLast(sheetTally([]), sheetTally([[8, 60], [8, 60]]));
  ok(!hasComparison(d), 'an untouched sheet compares to nothing');
  eq(d.reps, null, 'rather than to minus sixteen');
}

// One side bodyweight, the other loaded: the load-derived figures are withheld
// and the rep count still compares, because reps are known on both days.
{
  const d = compareToLast(sheetTally([[10, 40]]), sheetTally([[8, null]]));
  eq(d.reps, 2, 'reps compare, because both days have them');
  eq(d.volumeKg, null, 'tonnage does not, because one day has none');
  eq(d.topLoadKg, null, 'nor the top load');
  eq(d.best1RMKg, null, 'nor the estimate');
  eq(d.sameTopLoad, false, 'and the two top loads are not "the same"');
  eq(topRepsNote(d), null, 'which is not the changed-weight case and must not claim to be');
}

/* ── 5. the comparison takes an outing straight from the history ──────────── */

// `SheetTally` is a structural subset of `ExerciseOuting` on purpose, so this
// compiles with no adapter. If somebody renames a field on either side, this
// stops building — which is the point of writing it out.
{
  const outing = {
    slug: 'back-squat', name: 'Back Squat', day: '2026-09-03', at: '2026-09-03T10:00:00.000Z',
    sets: [[8, 60]] as [number, number | null][], holds: [] as [number, number | null][],
    setCount: 1, bodyweightSets: 0, unpricedSets: 0, timedSets: 0, holdSeconds: 0,
    reps: 8, volumeKg: 480, topLoadKg: 60, topReps: 8,
    best1RMKg: est1RM(60, 8), bestSet: { reps: 8, loadKg: 60 }, entryCount: 1,
  };
  const d = compareToLast(sheetTally([[10, 60]]), outing);
  eq(d.sameTopLoad, true, 'an outing goes straight in');
  eq(d.topReps, 2, 'and compares');
  eq(d.setCount, 0, 'same number of sets');
}

/* ── 6. direction is never asserted ───────────────────────────────────────── */

// Down is a figure, not a failure. Nothing in the module names one direction.
{
  const d = compareToLast(sheetTally([[5, 50]]), sheetTally([[8, 60]]));
  eq(d.topLoadKg, -10, 'a lighter day is a signed figure');
  ok(hasComparison(d), 'and is shown rather than hidden');
  const note = topRepsNote(d) ?? '';
  ok(!/worse|drop|down|regress|fail/i.test(note), 'and nothing calls it a decline');
}

/* ── 7. the PREVIOUS column, aligned set by set ───────────────────────────── */

// One entry per row of the CURRENT sheet, in order. This is the shape the
// column is drawn from, so a mismatch in length is a mis-drawn table.
{
  const last = { sets: [[12, 42.5], [12, 42.5], [10, 42.5]] as [number, number | null][] };
  const p = previousSets(last, 3);
  eq(p.length, 3, 'one entry per row on the sheet');
  eq(p[0]?.reps, 12, 'set one is set one');
  eq(p[2]?.reps, 10, 'and the set that dropped a rep keeps its own figure');
  eq(p[2]?.loadKg, 42.5, 'with its own load, in kilograms and unconverted');
}

// A fourth set today against three last time. The extra row is a dash, which
// means "there was no set there", and it is the only thing it means.
{
  const last = { sets: [[12, 40], [12, 40]] as [number, number | null][] };
  const p = previousSets(last, 4);
  eq(p.length, 4, 'the column is as long as the sheet');
  ok(p[1] != null, 'the rows that existed last time are filled');
  eq(p[2], null, 'and the ones that did not are blank');
  eq(p[3], null, 'however many of them there are');
}

// Fewer today than last time: the extra history is simply not drawn. Nothing is
// squeezed upward, because set 2 must stay opposite set 2.
{
  const last = { sets: [[12, 40], [10, 45], [8, 50]] as [number, number | null][] };
  const p = previousSets(last, 2);
  eq(p.length, 2, 'only as many as there are rows');
  eq(p[1]?.loadKg, 45, 'and position is kept — set 2 is last time’s set 2, not its best');
}

// Bodyweight: the reps happened, the load is unknown. Null and not nought, so
// the screen can say "12 reps" rather than "0 kg × 12".
{
  const p = previousSets({ sets: [[12, null]] as [number, number | null][] }, 1);
  eq(p[0]?.reps, 12, 'the reps are real');
  eq(p[0]?.loadKg, null, 'and the load is unknown rather than zero');
}

// No history at all, and the degenerate inputs.
eq(previousSets(null, 3).length, 3, 'no outing still fills the column');
ok(previousSets(null, 3).every((x) => x === null), 'entirely with blanks');
eq(previousSets(undefined, 2).length, 2, 'and undefined reads the same as null');
eq(previousSets({ sets: [] }, 2).filter(Boolean).length, 0, 'an outing with no sets fills nothing');
eq(previousSets({ sets: [[12, 40]] as [number, number | null][] }, 0).length, 0, 'a sheet with no rows has no column');
eq(previousSets({ sets: [[12, 40]] as [number, number | null][] }, -1).length, 0, 'and neither has a nonsense one');

// A zero-rep row in the history is not a set that happened.
eq(previousSets({ sets: [[0, 40], [8, 40]] as [number, number | null][] }, 2)[0], null,
  'a set of no repetitions is blank, not "0 x 40"');

if (errors.length) {
  console.error(`sheetProgress.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('sheetProgress.test.ts — ok');
