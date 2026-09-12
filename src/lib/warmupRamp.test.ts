// The warm-up ladder. Compile with tsc, run with node.
//
// The failure this guards is not a wrong percentage. It is a rung nobody can
// load: 40% of 102.5 is 41, and there is no 41 kg on a barbell. A ladder of
// numbers that cannot be made is read once and never opened again.
import { warmupRamp, warmupNote, warmupRefusal } from './warmupRamp';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── every rung is loadable ───────────────────────────────────────────────── */

{
  // 102.5 kg is the case the header is about: the raw percentages are 41,
  // 56.375, 71.75 and 87.125, and not one of them can go on a bar.
  const sets = warmupRamp(102.5, 2.5);
  ok(sets.length > 0, 'a 102.5 kg working set gets a ramp');
  for (const s of sets) {
    ok(Math.abs(s.weight / 2.5 - Math.round(s.weight / 2.5)) < 1e-9,
      `every rung is a multiple of the step — ${s.weight} is not`);
  }
  // 40, 56.375, 71.75 and 87.125 floored to 2.5 — the last one lands on 85,
  // not 87.5, which is what rounding DOWN means and is what this asserts. I
  // wrote 87.5 here first and the test corrected me rather than the other way
  // round, which is the right order.
  eq(sets.map((s) => s.weight).join(','), '40,55,70,85', 'and they are the rounded-down ladder');
}

// Rounded DOWN, not to nearest. A rung that rounds up can land on or above the
// rung after it, and a ladder that goes backwards is worse than no ladder.
{
  const sets = warmupRamp(100, 20);
  const weights = sets.map((s) => s.weight);
  for (let i = 1; i < weights.length; i += 1) {
    ok(weights[i] > weights[i - 1], `rung ${i} must be heavier than the one before it (${weights.join(',')})`);
  }
}

// Never at or above the working set. That is not a warm-up.
{
  for (const [w, step] of [[100, 2.5], [60, 5], [42.5, 2.5], [300, 10]] as const) {
    for (const s of warmupRamp(w, step)) {
      ok(s.weight < w, `a ${w} working set must not have a ${s.weight} warm-up rung`);
    }
  }
}

// Rungs that collapse onto one loadable weight are dropped rather than repeated.
{
  const sets = warmupRamp(30, 10);
  const weights = sets.map((s) => s.weight);
  eq(new Set(weights).size, weights.length, 'no weight appears twice in the ladder');
}

/* ── reps fall as the weight rises ────────────────────────────────────────── */

{
  const sets = warmupRamp(140, 2.5);
  for (let i = 1; i < sets.length; i += 1) {
    ok(sets[i].reps <= sets[i - 1].reps, 'reps never rise as the bar gets heavier');
  }
  ok(sets[0].reps > sets[sets.length - 1].reps, 'and the first rung is more reps than the last');
}

/* ── the four refusals, which are not the same refusal ────────────────────── */

eq(warmupRamp(0, 2.5).length, 0, 'no working weight, no ladder');
eq(warmupRamp(-100, 2.5).length, 0, 'and a negative one is not a light one');
eq(warmupRamp(Number.NaN, 2.5).length, 0, 'NaN is not a weight');
eq(warmupRamp(100, 0).length, 0, 'a step of zero would produce unloadable numbers');
eq(warmupRamp(100, -5).length, 0, 'and so would a negative one');
eq(warmupRamp(5, 2.5).length, 0, 'a working set inside two steps has no room for a ladder');

// The sentence must name the actual cause. A lifter who typed nothing must not
// be told their lift is too light.
ok((warmupRefusal(0, 2.5) ?? '').includes('Type the weight'), 'an empty weight asks for the weight');
ok((warmupRefusal(5, 2.5) ?? '').includes('light enough'), 'a light lift says it is light');
ok((warmupRefusal(100, 0) ?? '').includes('plate change'), 'an unknown step says what it is missing');
eq(warmupRefusal(100, 2.5), null, 'and a workable lift has nothing to refuse');

/* ── the note is a convention, and says so ────────────────────────────────── */

{
  const sets = warmupRamp(100, 2.5);
  const note = warmupNote(sets, 'kg') ?? '';
  ok(/common ramp/.test(note), 'the note calls it a convention rather than a prescription');
  ok(note.includes('kg'), 'and names the unit it rounded to');
  eq(warmupNote([], 'kg'), null, 'no ladder, no note');
}

// Pounds behave identically — nothing in here assumes kilograms.
{
  const sets = warmupRamp(225, 5);
  ok(sets.length > 0 && sets.every((s) => s.weight % 5 === 0), 'a 225 lb set ramps in 5 lb steps');
  ok(sets.every((s) => s.weight < 225), 'and stays under the working set');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`warmupRamp: ok (${warmupRamp(102.5, 2.5).length} rungs on the awkward case, every one loadable)`);
