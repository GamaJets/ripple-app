// Readiness may temper a session and may never inflate one.
//
// The assertion this file is really for is section 2: that a GOOD readiness
// score changes nothing. Four signals about sleep, a wearable's verdict, water
// and recent load do not measure strength, so a high score is not evidence
// somebody can lift more — and adding load on that basis costs a member a
// failed set under a loaded bar, where tempering wrongly costs one workout.
import { temperByReadiness } from './readyProgression';
import type { ProgressionTip, ProgressAction } from './progression';
import type { Readiness, ReadinessSignal } from './readiness';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

const tipOf = (action: ProgressAction): ProgressionTip => ({
  exercise: 'Back Squat', lastWeight: 100, lastReps: 5,
  nextWeight: 105, nextReps: '5', action,
  rationale: 'Five clean reps at 100 kg — add a little.',
  at: '2026-09-11T10:00:00.000Z',
});
const ready = (score: number, tone: Readiness['tone'], confidence: Readiness['confidence'] = 'full'): Readiness => ({
  score, tone, label: 'x', tip: 'y', confidence,
  from: ['sleep', 'recovery', 'load'] as ReadinessSignal[],
});

/* ── 1. no reading, no opinion ──────────────────────────────────────────── */

{
  const r = temperByReadiness(tipOf('increase'), null, '100 kg');
  eq(r.temper, 'as-planned', 'no readiness leaves the plan alone');
  eq(r.note, null, 'and says nothing — an app that cannot measure must not imply it did');
  eq(r.tip.nextWeight, 105, 'the load is untouched');
}
eq(temperByReadiness(tipOf('increase'), undefined, '100 kg').temper, 'as-planned', 'undefined reads the same as null');

/* ── 2. THE RULE: a good score adds nothing ─────────────────────────────── */

{
  const r = temperByReadiness(tipOf('hold'), ready(96, 'good'), '100 kg');
  eq(r.temper, 'as-planned', 'a 96 does not promote a hold into an increase');
  eq(r.tip.action, 'hold', 'the action is exactly what progression decided');
  eq(r.note, null, 'and there is nothing to explain');
}
{
  const r = temperByReadiness(tipOf('reps'), ready(99, 'good'), '100 kg');
  eq(r.tip.action, 'reps', 'nor a reps target into a load increase');
  ok(r.tip.nextWeight === 105, 'and no weight is invented');
}

/* ── 3. a moderate day holds the load rather than adding to it ──────────── */

{
  const r = temperByReadiness(tipOf('increase'), ready(58, 'moderate'), '100 kg');
  eq(r.temper, 'hold-load', 'an increase becomes a rep target');
  eq(r.tip.action, 'reps', 'the action says so');
  eq(r.tip.nextWeight, 100, 'at LAST session’s load, not the planned one');
  ok(r.note != null && /58/.test(r.note), 'the note names the score');
  ok(r.note != null && /100 kg/.test(r.note), 'and the weight in the unit the CALLER rendered — this module never names a unit');
  ok(r.note != null && /sleep/.test(r.note), 'and what the score was built from');
  ok(r.note != null && !/recovered|not recovered/i.test(r.note),
    'and never claims anything about recovery — that is a word this app refuses');
}

// A rep target is already the gentler half and is not softened again.
eq(temperByReadiness(tipOf('reps'), ready(58, 'moderate'), '100 kg').temper, 'as-planned',
  'chasing reps at the same load needs no tempering');

/* ── 4. a low day repeats last session ──────────────────────────────────── */

{
  const r = temperByReadiness(tipOf('increase'), ready(31, 'low'), '100 kg');
  eq(r.temper, 'repeat-last', 'more is not asked for');
  eq(r.tip.action, 'hold', 'the action holds');
  eq(r.tip.nextWeight, 100, 'at last session’s weight');
  eq(r.tip.nextReps, '5', 'and last session’s reps');
  ok(r.note != null && /follow the plan instead/.test(r.note),
    'and the member is told they may ignore it');
}

// Low also tempers a rep target, because that still asks for more than last time.
eq(temperByReadiness(tipOf('reps'), ready(31, 'low'), '100 kg').temper, 'repeat-last',
  'a low day does not ask for more reps either');

/* ── 5. nothing already gentle is made gentler ──────────────────────────── */

for (const a of ['hold', 'deload'] as ProgressAction[]) {
  for (const tone of ['moderate', 'low'] as Readiness['tone'][]) {
    const r = temperByReadiness(tipOf(a), ready(20, tone), '100 kg');
    eq(r.temper, 'as-planned', `${a} on a ${tone} day is left alone`);
    eq(r.tip.action, a, 'a deload is already a lighter week — tempering it twice compounds');
  }
}

/* ── 6. a partial reading says so ───────────────────────────────────────── */

{
  const r = temperByReadiness(tipOf('increase'), ready(44, 'low', 'partial'), '100 kg');
  ok(r.note != null && /partial/.test(r.note),
    'a rescaled scale is a weaker basis for changing a session, and is said out loud');
}

/* ── 7. the plan’s own reason survives ──────────────────────────────────── */

{
  const r = temperByReadiness(tipOf('increase'), ready(31, 'low'), '100 kg');
  eq(r.tip.rationale, 'Five clean reps at 100 kg — add a little.',
    'the rationale is NOT overwritten — it is the half the member is trying to follow');
  eq(r.tip.exercise, 'Back Squat', 'and the exercise never changes');
}

/* ── a member who has never chosen a unit is shown no unit ──────────────── */
//
// `liftLabel` returns null for that case, which is this codebase's rule: a
// figure whose unit is unknown is WITHHELD rather than printed in a guess. The
// advice survives without the number — "keeping the same load" is the whole
// instruction.
{
  const r = temperByReadiness(tipOf('increase'), ready(58, 'moderate'), null);
  eq(r.temper, 'hold-load', 'the advice is unchanged');
  ok(r.note != null && !/\bkg\b|\blb\b/.test(r.note), 'and names no unit at all');
  ok(r.note != null && /the same load/.test(r.note), 'saying "the same load" instead');
}
{
  const r = temperByReadiness(tipOf('increase'), ready(31, 'low'), null);
  ok(r.note != null && !/\bkg\b|\blb\b/.test(r.note), 'the low-day sentence names no unit either');
}

if (errors.length) {
  console.error('readyProgression.test.ts FAILED');
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('readyProgression.test.ts — ok');
