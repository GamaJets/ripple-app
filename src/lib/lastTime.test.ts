// What you did the last time you did this movement, said in the runner.
// Compile with tsc, run with node.
//
// The runner seeds the load box from `suggestForExercise` and throws away the
// sentence that justifies it, so a member at the rack sees a number with no
// provenance. Worse, four different states all render as an empty box: a
// movement never done, a history capped at the row ceiling, a read that failed,
// and any bodyweight movement at all. `logStatus` is passed into SessionRunner
// and consulted in exactly one place — the PR confetti.
import { lastTime, MAX_CHIPS } from './lastTime';
import type { WorkoutEntry } from './mockData';
import { liftLabel } from './units';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const TODAY = '2026-09-03';
/** A local instant on the day `d` days before TODAY. Local, because a log row
 *  is a timestamptz and the day it belongs to is the member's own. */
const daysAgo = (d: number, hour = 18): string => new Date(2026, 8, 3 - d, hour, 30, 0).toISOString();

const base = { log: [] as WorkoutEntry[], exercise: 'Back Squat', today: TODAY, unit: 'kg' as const };

/* ── the four silences that used to be one blank box ───────────────────── */

eq(lastTime({ ...base, status: 'loading' }).kind, 'loading',
  'a read in flight says so rather than implying an empty history');

{
  const r = lastTime({ ...base, status: 'error' });
  eq(r.kind, 'error', 'a failed read is not a member with no history');
  const note = r.kind === 'error' ? r.note : '';
  ok(/could not be read/.test(note), 'and says which of the two it is');
  ok(/read that failed rather than a movement you have never done/.test(note),
    'and refuses the sentence that would accuse them of never having done it');
}

{
  const r = lastTime({ ...base, status: 'ready' });
  eq(r.kind, 'never', 'a whole read with nothing in it IS a first time');
  ok(r.kind === 'never' && /First time/.test(r.note), 'and says so encouragingly rather than blankly');
}

{
  // The row ceiling. src/ui/workoutLog.tsx reads newest-first and stops at
  // capLimit(), so a movement missing from a truncated read may simply be older
  // than what came back. Calling that "first time" is the accusation of absence
  // src/lib/builderProgression.ts had to take back once already.
  const r = lastTime({ ...base, status: 'partial' });
  eq(r.kind, 'unknown', 'a truncated read cannot say the movement is new');
  ok(r.kind === 'unknown' && /cut short/.test(r.note), 'and explains why it cannot');
}

/* ── the recap ─────────────────────────────────────────────────────────── */

const squats: WorkoutEntry[] = [
  { t: daysAgo(20), exercise: 'Back Squat', sets: [[8, 55], [8, 55]] },
  { t: daysAgo(6), exercise: 'Back Squat', sets: [[8, 60], [8, 60], [7, 60]] },
  { t: daysAgo(2), exercise: 'Bench Press', sets: [[10, 40]] },
];

{
  const r = lastTime({ ...base, log: squats, status: 'ready' });
  if (r.kind !== 'outing') { errors.push('the newest session for the movement is an outing'); }
  else {
    eq(r.when, '6 days ago', 'dated in the member’s own days, not as a timestamp');
    eq(r.daysAgo, 6, 'and the span is exposed for the caller');
    eq(r.sets.length, 3, 'every set of that session, in the order it was done');
    eq(r.sets[0].label, `${liftLabel(60, 'kg')} × 8`, 'phrased as the Records board phrases it');
    eq(r.sets[2].label, `${liftLabel(60, 'kg')} × 7`, 'including the set that dropped a rep');
    eq(r.more, 0, 'with nothing hidden');
    eq(r.boxNote, null, 'and no comparison when the box is empty');
  }
}

{
  // 'partial' with the movement PRESENT. The read is newest-first, so
  // truncation can remove a movement but never substitute an older outing for
  // a newer one — the same argument builderProgression.ts sets out.
  const r = lastTime({ ...base, log: squats, status: 'partial' });
  eq(r.kind, 'outing', 'a capped read still knows the most recent session it holds');
}

{
  // Identity, not spelling. The builder, the catalogue and the log disagree
  // about case and punctuation; the movement does not.
  const r = lastTime({ ...base, exercise: 'back squat', log: squats, status: 'ready' });
  eq(r.kind, 'outing', 'the movement is matched by slug, not by exact spelling');
  if (r.kind === 'outing') eq(r.name, 'Back Squat', 'and it is shown as it was actually written that day');
}

{
  const r = lastTime({ ...base, exercise: 'Front Squat', log: squats, status: 'ready' });
  eq(r.kind, 'never', 'a different movement is a different movement');
}

/* ── the number in the box, beside the number above it ─────────────────── */

{
  const r = lastTime({ ...base, log: squats, status: 'ready', boxKg: 62.5 });
  if (r.kind === 'outing') ok(/2\.5 kg more/.test(r.boxNote ?? ''), 'a step up is stated as arithmetic');
}
{
  const r = lastTime({ ...base, log: squats, status: 'ready', boxKg: 60 });
  if (r.kind === 'outing') ok(/same as/.test(r.boxNote ?? ''), 'a repeat says it is a repeat');
}
{
  const r = lastTime({ ...base, log: squats, status: 'ready', boxKg: 57.5 });
  if (r.kind === 'outing') ok(/2\.5 kg less/.test(r.boxNote ?? ''), 'and a step down is not hidden');
}
{
  // The box is a text field the member can edit, so a difference too small to
  // load onto a bar can reach here. "0.1 lb more" beside a rack is noise.
  const r = lastTime({ ...base, log: squats, status: 'ready', boxKg: 60.01 });
  if (r.kind === 'outing') ok(/same as/.test(r.boxNote ?? ''), 'a difference that rounds away is not a difference');
}
{
  const r = lastTime({ ...base, log: squats, status: 'ready', unit: 'lb', boxKg: 62.5 });
  if (r.kind === 'outing') {
    ok(/lb/.test(r.boxNote ?? ''), 'the comparison is in the member’s own unit');
    ok(!/kg/.test(r.boxNote ?? ''), 'and never in two units on one line');
    ok(/5\.5 lb more/.test(r.boxNote ?? ''), 'and 2.5 kg is 5.5 lb, not 6');
  }
}
{
  // Converted ONCE, as a difference, rather than by subtracting two separately
  // rounded readings — the defect `liftDeltaIn` was written for.
  //
  // 40.48 kg reads as 89.0 lb and 42.98 kg as 95.0 lb, both at the half-pound
  // this app rounds lifted loads to. Subtracting the two READINGS gives 6 lb.
  // The step is 2.5 kg, which is 5.5 lb, and it is 5.5 lb whichever pair of
  // loads it sits between — that stability is the whole point, and it is what
  // stops a member being told their progression changed size when it did not.
  const dbl: WorkoutEntry[] = [{ t: daysAgo(3), exercise: 'Back Squat', sets: [[5, 40.48]] }];
  const r = lastTime({ ...base, log: dbl, status: 'ready', unit: 'lb', boxKg: 42.98 });
  if (r.kind === 'outing') ok(/5\.5 lb more/.test(r.boxNote ?? ''),
    'the difference is converted once, not taken between two rounded readings');
}
{
  // An emptied box arriving as a zero rather than as a null. A load of nothing
  // is not a load, and "60 kg less than that" is a sentence about a bar nobody
  // is standing at.
  const r = lastTime({ ...base, log: squats, status: 'ready', boxKg: 0 });
  if (r.kind === 'outing') eq(r.boxNote, null, 'an empty box is compared to nothing');
}

/* ── a body is not a bar ───────────────────────────────────────────────── */

const pullups: WorkoutEntry[] = [
  { t: daysAgo(4), exercise: 'Pull-up', sets: [[8, 0], [8, 20], [6, 20]], bw: [true, true, true] },
];

{
  const r = lastTime({ ...base, exercise: 'Pull-up', log: pullups, status: 'ready', boxKg: 20 });
  if (r.kind !== 'outing') { errors.push('a bodyweight movement has a history like any other'); }
  else {
    eq(r.sets[0].label, '8 reps at bodyweight', 'a plain pull-up is not a lift of 0 kg');
    eq(r.sets[1].label, `8 reps at bodyweight +${liftLabel(20, 'kg')}`, 'and a belted one names what was added');
    ok(!/× 8/.test(r.sets[0].label), 'a body is never printed as a bar figure');
    eq(r.boxNote, null,
      'and nothing compares the box to a figure that is partly a weigh-in');
  }
}

/* ── seconds are not repetitions ───────────────────────────────────────── */

const planks: WorkoutEntry[] = [
  { t: daysAgo(3), exercise: 'Plank', sets: [[45, 0], [60, 10]], timed: [true, true], bw: [true, false] },
];

{
  const r = lastTime({ ...base, exercise: 'Plank', log: planks, status: 'ready', boxKg: 10 });
  if (r.kind !== 'outing') { errors.push('a hold is a session too'); }
  else {
    ok(r.sets[0].held, 'a hold is flagged as one so a caller need not parse the phrase');
    ok(/45 s hold/.test(r.sets[0].label), 'and is printed as a length of time');
    ok(!/45 ×|× 45/.test(r.sets[0].label), 'never as forty-five of something');
    ok(/1:00 hold/.test(r.sets[1].label), 'a minute reads as a clock');
    eq(r.boxNote, null, 'and a plank is not a comparison for anything on a bar');
  }
}

/* ── mixed, and the odd row a queue can produce ────────────────────────── */

{
  // A session of holds and repped sets together. The bar figure must come from
  // the repped, non-bodyweight sets only.
  const mixed: WorkoutEntry[] = [
    { t: daysAgo(5), exercise: 'Circuit', sets: [[30, 0], [10, 40]], timed: [true, false] },
  ];
  const r = lastTime({ ...base, exercise: 'Circuit', log: mixed, status: 'ready', boxKg: 45 });
  if (r.kind === 'outing') ok(/5 kg more/.test(r.boxNote ?? ''), 'the hold contributes nothing to the top load');
}

{
  // Every set unreadable. There IS a session and nothing to say about it, which
  // is not the same answer as no session and is certainly not "first time".
  const junk: WorkoutEntry[] = [{ t: daysAgo(9), exercise: 'Back Squat', sets: [[0, 0]] }];
  const r = lastTime({ ...base, log: junk, status: 'ready' });
  eq(r.kind, 'unknown', 'a session whose sets will not read is not a first time');
}

{
  // A stamp that will not parse. The session happened; nothing can date it.
  const undated: WorkoutEntry[] = [{ t: 'not a timestamp', exercise: 'Back Squat', sets: [[5, 100]] }];
  const r = lastTime({ ...base, log: undated, status: 'ready' });
  eq(r.kind, 'outing', 'an unparseable stamp does not delete the session');
  if (r.kind === 'outing') {
    eq(r.when, null, 'it is simply not dated');
    eq(r.daysAgo, null, 'and no span is invented for it');
  }
}

{
  // Newest wins whatever order the provider hands them over in.
  const shuffled = [squats[1], squats[0]];
  const r = lastTime({ ...base, log: shuffled, status: 'ready' });
  if (r.kind === 'outing') eq(r.daysAgo, 6, 'the outing is chosen by date, not by position');
}

{
  const r = lastTime({ ...base, log: [{ t: daysAgo(0, 9), exercise: 'Back Squat', sets: [[5, 70]] }], status: 'ready' });
  if (r.kind === 'outing') eq(r.when, 'Today', 'a second session on the same day reads as today');
}

/* ── truncation is stated, not silently trimmed ────────────────────────── */

{
  const many: WorkoutEntry[] = [{
    t: daysAgo(1), exercise: 'Back Squat',
    sets: Array.from({ length: MAX_CHIPS + 4 }, () => [5, 50] as [number, number]),
  }];
  const r = lastTime({ ...base, log: many, status: 'ready' });
  if (r.kind === 'outing') {
    eq(r.sets.length, MAX_CHIPS, 'the strip stops at the cap');
    eq(r.more, 4, 'and the rest are counted rather than vanishing');
  }
}

/* ── nothing is claimed about a movement with no name ──────────────────── */

eq(lastTime({ ...base, exercise: '   ', log: squats, status: 'ready' }).kind, 'never',
  'a nameless movement matches nothing rather than matching everything');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('lastTime: ok — the runner can say what you did last time, and which kind of nothing it has');
