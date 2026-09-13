// A movement's written steps, and the five different reasons there might be
// none of them.
//
// Compile with tsc, then run under plain node.
import { movementSteps, stepsCountLabel, type StepsView } from './movementSteps';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

const STEPS = ['Set the bar across your upper back.', 'Brace, then sit down between your hips.', 'Drive through mid-foot to stand.'];
const TIPS = ['Keep the bar over mid-foot.', 'Knees track over toes.'];

/* ── 1. the ordinary case ─────────────────────────────────────────────────── */

{
  const v = movementSteps({ instructions: STEPS, tips: TIPS, status: 'ready', hasRow: true });
  eq(v.kind, 'steps', 'a row with instructions shows them');
  eq(v.kind === 'steps' ? v.steps.length : -1, 3, 'all three steps');
  eq(v.kind === 'steps' ? v.steps[2] : '', STEPS[2], 'in the catalogue order');
  eq(v.kind === 'steps' ? v.tips.length : -1, 2, 'and the cues travel beside them');
}

// Nothing is shortened, summarised or capped. A rack-side reader wants it
// short; step four of six with "under control" removed is different advice.
{
  const long = Array.from({ length: 12 }, (_, i) => `Step ${i + 1}.`);
  const v = movementSteps({ instructions: long, tips: [], status: 'ready', hasRow: true });
  eq(v.kind === 'steps' ? v.steps.length : -1, 12, 'twelve steps come back as twelve');
}

// The cues are kept apart from the sequence rather than appended to it.
{
  const v = movementSteps({ instructions: STEPS, tips: TIPS, status: 'ready', hasRow: true });
  ok(v.kind === 'steps' && !v.steps.some((s) => TIPS.includes(s)), 'no cue is smuggled into the ordered steps');
}

/* ── 2. the two columns are filled independently ──────────────────────────── */

{
  const v = movementSteps({ instructions: [], tips: TIPS, status: 'ready', hasRow: true });
  eq(v.kind, 'tips', 'cues with no steps are still shown');
  eq(v.kind === 'tips' ? v.tips.length : -1, 2, 'both of them');
}

/* ── 3. blank strings are not content ─────────────────────────────────────── */

{
  const v = movementSteps({ instructions: ['', '   '], tips: ['\t'], status: 'ready', hasRow: true });
  eq(v.kind, 'none', 'a row of empty strings is a row with nothing on it');
  eq(v.kind === 'none' ? v.note : '', 'No written steps for this one yet.', 'and says so plainly');
}

{
  const v = movementSteps({ instructions: ['  Brace.  ', ''], tips: [], status: 'ready', hasRow: true });
  eq(v.kind === 'steps' ? v.steps[0] : '', 'Brace.', 'a real step is trimmed');
  eq(v.kind === 'steps' ? v.steps.length : -1, 1, 'and the blank beside it is dropped');
}

/* ── 4. the five nothings, kept apart ─────────────────────────────────────── */

// This is the whole reason the rule exists. A member told "this movement has no
// guide" when the truth is "your session expired" concludes their coach left
// them to guess.
const note = (v: StepsView) => (v.kind === 'none' ? v.note : '(not a none)');

const inFlight = note(movementSteps({ status: 'loading', hasRow: false }));
const failed = note(movementSteps({ status: 'error', hasRow: false }));
const truncated = note(movementSteps({ status: 'partial', hasRow: true }));
const out = note(movementSteps({ status: 'ready', signedOut: true, hasRow: false }));
const noRow = note(movementSteps({ status: 'ready', hasRow: false }));
const empty = note(movementSteps({ status: 'ready', hasRow: true }));

const all = [inFlight, failed, truncated, out, noRow, empty];
eq(new Set(all).size, all.length, 'each reason gets its own sentence');
ok(all.every((s) => s.length > 0), 'and none of them is blank');

ok(/looking up/i.test(inFlight), 'a read still in flight says it is still looking');
ok(/could not reach/i.test(failed), 'a failed read says we could not look');
ok(!/no written steps/i.test(failed), 'and never states the absence as a fact');
ok(!/no written steps/i.test(truncated), 'nor does a truncated one');
ok(/signed in/i.test(out), 'a signed-out read blames the session, not the catalogue');
ok(!/no written steps/i.test(out), 'and does not deny the steps exist');
ok(/not in our catalogue/i.test(noRow), 'a movement with no row says exactly that');
ok(/ask them/i.test(noRow), 'and points at the person who wrote it into the programme');
eq(empty, 'No written steps for this one yet.', 'only a real, whole, present row states the gap');

// Not one of them tells the member they have done something wrong.
ok(!all.some((s) => /\byou (?:did|have) not\b/i.test(s)), 'no sentence blames the member');

/* ── 5. the count beside the heading ──────────────────────────────────────── */

eq(stepsCountLabel(1, 'step'), '1 step', 'one step is singular');
eq(stepsCountLabel(6, 'step'), '6 steps', 'six are plural');
eq(stepsCountLabel(1, 'cue'), '1 cue', 'and so is one cue');
eq(stepsCountLabel(0, 'cue'), '0 cues', 'zero is plural, as English has it');

if (errors.length) {
  console.error(`movementSteps: ${errors.length} failed`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('movementSteps: ok');
