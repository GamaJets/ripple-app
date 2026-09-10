// The tick beside a set on the coach's sheet.
//
// Most of this file is about the two things the tick refuses to do: decide a
// range on the coach's behalf, and put seconds into a reps box. Both refusals
// are the same refusal `setTicks.ts` and `planPrefill.ts` already make, and the
// assertions here exist so that widening the span reader one day cannot quietly
// turn a plank into forty-five repetitions in somebody's permanent record.
//
// Compile with tsc, then run under plain node.
import {
  sheetTick, sheetTickLabel, sheetTicksLine, willSave, isTappable,
} from './sheetTick';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

/* ── 1. the definite case, which is the only one that ticks ───────────────── */

{
  const t = sheetTick('8', '');
  eq(t.state, 'fill', 'a plan that says 8 offers a tick');
  eq(t.state === 'fill' ? t.reps : null, 8, 'and one tap would write 8');
  ok(isTappable(t), 'so it is tappable');
  ok(!willSave(t), 'and nothing is saved until it is tapped');
}

// Ticked: the box now holds exactly what the plan asked for, so the tick is
// what put it there and can take it back out.
{
  const t = sheetTick('8', '8');
  eq(t.state, 'clear', 'the plan figure in the box reads as ticked');
  ok(willSave(t), 'and that set will be saved');
  ok(isTappable(t), 'and can be unticked');
}

/* ── 2. a figure the coach typed is not the tick's to erase ───────────────── */

// This screen has no undo. A tick that clears a hand-typed 12 on one stray tap
// takes work back that nothing can recover, which is the rule `loadPlanDay` is
// written under in the same file.
{
  const t = sheetTick('8', '12');
  eq(t.state, 'done', 'a count the coach typed is done, not ticked');
  ok(willSave(t), 'it will be saved');
  ok(!isTappable(t), 'and the tick cannot erase it');
}

// The same on a row with no prescription at all — added by hand, typed by hand.
{
  const t = sheetTick(null, '10');
  eq(t.state, 'done', 'a hand-added set with reps in it is done');
  ok(willSave(t), 'and will be saved');
  ok(!isTappable(t), 'and is not the tick’s to clear');
}

/* ── 3. the invariant: a filled tick means the set gets written ───────────── */

// `entriesToWrite` saves a set when `(parseInt(reps, 10) || 0) > 0` and this
// agrees with it on every case, including the two that look like typos.
// A tick that claims a save which does not happen is the whole failure this
// design exists to avoid.
for (const junk of ['', '   ', '0', '-3', 'abc', 'AMRAP']) {
  const t = sheetTick('8', junk);
  ok(!willSave(t), `"${junk}" in the box is not a set that will be saved`);
  ok(t.state === 'fill', `"${junk}" leaves the tick offered rather than filled`);
}

/* ── 4. a range is not decided by the fastest control on the screen ───────── */

for (const range of ['6-8', '8-12', '12-8', '8 - 12', '8–12']) {
  const t = sheetTick(range, '');
  eq(t.state, 'manual', `"${range}" is a decision, not a figure, so there is no tick`);
  ok(!isTappable(t), `and "${range}" cannot be tapped`);
  ok(t.state === 'manual' && /type what they actually did/i.test(t.reason),
    `and "${range}" says what it is waiting for`);
  ok(t.state === 'manual' && t.reason.includes(range.trim()),
    `and quotes the coach’s own words back — "${range}"`);
}

/* ── 5. a hold is never tickable HERE, whatever setTicks does ─────────────── */

// The sheet writes [reps, kg] with no timed flag, so a 45 in the reps box is
// forty-five repetitions. src/lib/planPrefill.ts refuses to seed one; this
// refuses to tick one. If a future span reader ever accepted '45s', these
// assertions are what stops it reaching the box.
for (const hold of ['30s', '45 sec', '60 seconds', '1 min', '30-60s']) {
  const t = sheetTick(hold, '');
  eq(t.state, 'manual', `"${hold}" is a hold and is typed, not ticked`);
  ok(t.state === 'manual' && /hold/i.test(t.reason), `and "${hold}" is named as a hold`);
  ok(t.state === 'manual' && /repetitions/i.test(t.reason),
    `and "${hold}" says why this sheet cannot take it`);
}

/* ── 6. everything else the catalogue actually contains ───────────────────── */

// The live strings across this platform's own catalogue, per planPrefill.ts.
for (const other of ['AMRAP', '10/leg', '8/side', '15/side', '', null, undefined]) {
  const t = sheetTick(other, '');
  eq(t.state, 'manual', `${JSON.stringify(other)} offers no tick`);
  ok(t.state === 'manual' && t.reason.length > 0, `${JSON.stringify(other)} still says something`);
}

// A blank prescription says the plainest thing, because there is nothing of the
// coach's own to quote back at them.
{
  const t = sheetTick(null, '');
  ok(t.state === 'manual' && /Type the reps/i.test(t.reason), 'a bare row asks for the reps');
}

/* ── 7. what a screen reader hears ────────────────────────────────────────── */

{
  const fill = sheetTickLabel(sheetTick('8', ''), 'Back Squat', 2);
  ok(/Back Squat set 2/.test(fill), 'the label names the movement and the set');
  ok(/8 reps/.test(fill), 'and what one tap would write');

  const manual = sheetTickLabel(sheetTick('6-8', ''), 'Back Squat', 3);
  ok(/not ticked/i.test(manual), 'an unticked set says so');
  ok(/6-8/.test(manual), 'and carries the reason, which is the caption a VoiceOver user cannot see');

  const done = sheetTickLabel(sheetTick(null, '10'), 'Back Squat', 1);
  ok(/will be saved/i.test(done), 'and a done set says what happens to it');
}

/* ── 8. the count under the sheet ─────────────────────────────────────────── */

eq(sheetTicksLine(0, 0), null, 'an empty sheet is not nought out of nought');
eq(sheetTicksLine(0, 4), 'None of the 4 sets on the sheet has a rep count yet, so nothing would be saved.',
  'none is said as none');
eq(sheetTicksLine(4, 4), 'All 4 sets have a rep count and will be saved.', 'and all as all');
ok((sheetTicksLine(1, 4) ?? '').includes('other 3 will not be saved'),
  'and a part-filled sheet names what would be left behind');

if (errors.length) {
  console.error(`sheetTick.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('sheetTick.test.ts — ok');
