// Somebody else's three years of training, read out of their export.
//
// The assertions that matter are sections 3 and 4: a row that cannot be read
// WHOLE produces nothing and is counted, and the reader never converts a weight
// whose unit it has not been told. Filing a partial set puts a lift into a
// permanent record that nobody did — and every figure this app derives from the
// log would then be built on it.
import { previewLiftingImport, detectSource, liftingImportNote } from './liftingImport';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

const STRONG = [
  'Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE',
  '2026-09-10 18:00:00,Evening,Squat (Barbell),1,100,5,,,,,',
  '2026-09-10 18:00:00,Evening,Squat (Barbell),2,100,5,,,,,',
  '2026-09-10 18:00:00,Evening,Bench Press (Barbell),1,80,8,,,,,',
  '2026-09-08 18:00:00,Evening,Squat (Barbell),1,97.5,5,,,,,',
].join('\n');

const HEVY = [
  'title,start_time,end_time,exercise_title,set_index,weight_kg,reps,rpe',
  'Push,2026-09-11 07:00:00,2026-09-11 08:00:00,"Bench Press (Dumbbell), Incline",1,30,10,',
  'Push,2026-09-11 07:00:00,2026-09-11 08:00:00,"Bench Press (Dumbbell), Incline",2,30,9,',
].join('\n');

/* ── 1. both formats are recognised by their COLUMNS ────────────────────── */

eq(detectSource(STRONG.split('\n')[0]), 'strong', 'Strong is recognised');
eq(detectSource(HEVY.split('\n')[0]), 'hevy', 'Hevy is recognised');
eq(detectSource('a,b,c'), null, 'anything else is not');

/* ── 2. rows fold into one entry per day and exercise ───────────────────── */

{
  const p = previewLiftingImport(STRONG);
  eq(p.source, 'strong', 'the source is reported');
  eq(p.entries.length, 3, 'two exercises on the 10th and one on the 8th is three entries, not five');
  eq(p.setsRead, 4, 'and all four sets were read');
  // Newest first, matching how the log itself is ordered.
  ok(p.entries[0].t > p.entries[2].t, 'newest session first');
  const squat = p.entries.find((e) => e.exercise.startsWith('Squat') && e.t.startsWith('2026-09-10'));
  eq(JSON.stringify(squat?.sets), '[[5,100],[5,100]]', 'both squat sets are on ONE entry, as [reps, kg]');
}

// A quoted exercise name containing a comma survives.
{
  const p = previewLiftingImport(HEVY);
  eq(p.entries.length, 1, 'one exercise on one day');
  eq(p.entries[0].exercise, 'Bench Press (Dumbbell), Incline', 'the comma inside the quotes is part of the name');
  eq(JSON.stringify(p.entries[0].sets), '[[10,30],[9,30]]', 'with both sets');
}

/* ── 3. a row that cannot be read whole is DROPPED AND COUNTED ──────────── */

{
  const p = previewLiftingImport([
    'Date,Workout Name,Exercise Name,Set Order,Weight,Reps',
    '2026-09-10 18:00:00,E,Squat (Barbell),1,100,5',
    '2026-09-10 18:00:00,E,Squat (Barbell),2,100,',      // logged but empty
    '2026-09-10 18:00:00,E,,3,100,5',                     // no exercise
    'not a date,E,Squat (Barbell),4,100,5',               // unreadable date
  ].join('\n'));
  eq(p.setsRead, 1, 'only the one complete set is read');
  eq(p.entries.length, 1, 'and it is the only entry');
  const total = p.skipped.reduce((a, s) => a + s.rows, 0);
  eq(total, 3, 'all three bad rows are counted');
  ok(p.skipped.some((s) => /rep count/.test(s.reason)), 'and the reasons are named');
  ok(p.skipped.some((s) => /exercise name/.test(s.reason)), 'each of them');
  ok(p.skipped.some((s) => /date/.test(s.reason)), 'individually');
  // The note must say so — a session count alone hides the drops.
  const note = liftingImportNote(p);
  ok(/3 rows will not be imported/.test(note), 'the note states the number dropped');
  ok(/rather than guessed at/.test(note), 'and that they were not guessed');
}

/* ── 4. a bodyweight set is real; a missing weight is not ───────────────── */

{
  const p = previewLiftingImport([
    'Date,Workout Name,Exercise Name,Set Order,Weight,Reps',
    '2026-09-10 18:00:00,E,Pull Up,1,0,12',
    '2026-09-10 18:00:00,E,Pull Up,2,,10',
  ].join('\n'));
  eq(p.setsRead, 1, 'zero IS a load — a plain pull-up — and is kept');
  eq(JSON.stringify(p.entries[0].sets), '[[12,0]]', 'stored as zero rather than dropped');
  ok(p.skipped.some((s) => /weight/.test(s.reason)), 'while a MISSING weight is refused');
}

/* ── 5. pounds are refused, not converted ───────────────────────────────── */
//
// Converting would be this module deciding a number it has never seen a unit
// for is pounds. The refusal sends the member back to the export screen, where
// the unit is theirs to set.
{
  const p = previewLiftingImport('Date,Workout Name,Exercise,Weight (lb),Reps\n2026-09-10,E,Squat,225,5');
  eq(p.source, null, 'an export this reader cannot vouch for is not read');
  ok(p.blocker != null && /kilograms/.test(p.blocker), 'and the blocker says to switch the unit');
  eq(p.entries.length, 0, 'nothing is imported on an assumption');
}

/* ── 6. nothing readable is a sentence, not a crash ─────────────────────── */

eq(previewLiftingImport('').blocker != null, true, 'an empty file is refused');
eq(previewLiftingImport('   ').blocker != null, true, 'and so is whitespace');
{
  const p = previewLiftingImport('Date,Workout Name,Exercise Name,Set Order,Weight,Reps\n');
  ok(p.blocker != null, 'a header with no rows is refused');
  eq(p.entries.length, 0, 'with nothing imported');
}

/* ── 7. it does NOT deduplicate ─────────────────────────────────────────── */
//
// Two identical sessions a week apart are two sessions. Guessing here would
// silently drop somebody who squatted the same weight for the same reps on two
// consecutive Mondays; the screen knows whether this is a re-import and this
// does not.
{
  const p = previewLiftingImport([
    'Date,Workout Name,Exercise Name,Set Order,Weight,Reps',
    '2026-09-07 18:00:00,E,Squat (Barbell),1,100,5',
    '2026-09-14 18:00:00,E,Squat (Barbell),1,100,5',
  ].join('\n'));
  eq(p.entries.length, 2, 'the same lift on two days is two entries');
}

if (errors.length) {
  console.error('liftingImport.test.ts FAILED');
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('liftingImport.test.ts — ok');
