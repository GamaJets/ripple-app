// The next-set suggestion, and the sentence printed beside it.
//
// ── What was wrong ─────────────────────────────────────────────────────────
//
// `suggestNextWeight` returns two things: a `weight`, which is KILOGRAMS and is
// fed back into the log, the warm-up ramp and the PR check; and a `reason`,
// which is prose a member reads. The weight was always rendered through
// `liftLabel`, so a pounds member saw the right figure. The reason was built
// here with "kg" written into the template, so the Train tab showed them:
//
//     132 lb  ↑  You hit 8 reps at 60kg — add 2.5kg
//
// One lift, two units, one line, and the kilogram half looks like the app has
// lost track of what they lift — in front of a trainer, mid-session, which is
// where that suggestion is read. Nothing was stored wrong, which is exactly why
// nobody caught it: the record was fine and only the sentence was nonsense.
//
// The DECISION is deliberately not unit-aware. The increment ladder stays
// metric — 2.5 kg is a plate pair, not a converted number — so what changes
// here is the wording and only the wording. The assertions below hold both
// halves of that: the reason must read in the member's unit, and the weight
// must come back in kilograms whatever the member reads.
import { suggestNextWeight, suggestForExercise, parseRepRange, priorBest1RM } from './progression';
import type { WorkoutEntry } from './mockData';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(a === b, `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

// ── the bug: the sentence is in the member's unit ──────────────────────────
{
  // Eight reps at 60 kg against a 6-8 range: the top of the range is cleared,
  // so this is the "add load" branch — the one with two figures in it.
  const lb = suggestNextWeight([[8, 60]], { low: 6, high: 8 }, 2.5, 'lb');
  ok(!!lb, 'a suggestion comes back at all');
  ok(!/\bkg\b/i.test(lb!.reason), `a pounds member is never shown kilograms — got "${lb!.reason}"`);
  ok(/\blb\b/.test(lb!.reason), `and is shown pounds — got "${lb!.reason}"`);
  // 60 kg is 132 lb. The assertion that names the defect: the old string
  // carried the literal 60, so this fails loudly if the conversion is dropped.
  ok(lb!.reason.includes('132'), `the load reads as 132 lb — got "${lb!.reason}"`);
  ok(!lb!.reason.includes('60'), `and never as the raw 60 — got "${lb!.reason}"`);
  // 2.5 kg is 5.5 lb at the half-pound `liftDeltaIn` works in, and must not be
  // printed as a bare "2.5" beside a figure in pounds.
  ok(lb!.reason.includes('5.5'), `the bump reads as 5.5 lb — got "${lb!.reason}"`);

  const kg = suggestNextWeight([[8, 60]], { low: 6, high: 8 }, 2.5, 'kg');
  ok(kg!.reason.includes('60 kg'), `a metric member still reads 60 kg — got "${kg!.reason}"`);
  ok(kg!.reason.includes('2.5 kg'), `and a 2.5 kg bump — got "${kg!.reason}"`);
}

// ── what must NOT move: the stored decision ────────────────────────────────
{
  const lb = suggestNextWeight([[8, 60]], { low: 6, high: 8 }, 2.5, 'lb');
  const kg = suggestNextWeight([[8, 60]], { low: 6, high: 8 }, 2.5, 'kg');
  // The invariant the whole change hangs on. `weight` is written to the log and
  // read by the PR check; if the unit leaked into it, a pounds member's next
  // target would be 62.5 POUNDS stored as kilograms — 138 kg — and the session
  // after that would be built on it.
  eq(lb!.weight, kg!.weight, 'the suggested weight is kilograms in both unit systems');
  eq(kg!.weight, 62.5, 'and it is last + increment, metric');
  eq(lb!.up, true, 'both agree the range was cleared');
}

// ── the hold branch carries a load too ─────────────────────────────────────
{
  const hold = suggestNextWeight([[6, 50]], { low: 6, high: 8 }, 2.5, 'lb');
  eq(hold!.up, false, 'six of a 6-8 range is not a bump');
  eq(hold!.weight, 50, 'and the weight is unchanged, in kilograms');
  ok(!/\bkg\b/i.test(hold!.reason), `the hold sentence is in pounds too — got "${hold!.reason}"`);
  ok(hold!.reason.includes('110'), `50 kg reads as 110 lb — got "${hold!.reason}"`);
}

// ── no range: the "match last" wording ─────────────────────────────────────
{
  // '45 sec' is a plank, not a rep range — parseRepRange returns null for it,
  // and the branch that has no range still prints a load.
  eq(parseRepRange('45 sec'), null, 'a duration is not a rep range');
  const none = suggestNextWeight([[10, 40]], null, 2.5, 'lb');
  ok(!/\bkg\b/i.test(none!.reason), `the no-range sentence is in pounds — got "${none!.reason}"`);
  ok(none!.reason.includes('88'), `40 kg reads as 88 lb — got "${none!.reason}"`);
}

// ── the default is unchanged, so every existing caller keeps working ───────
{
  const bare = suggestNextWeight([[8, 60]], { low: 6, high: 8 });
  ok(bare!.reason.includes('60 kg'), `omitting the unit means kilograms — got "${bare!.reason}"`);
}

// ── through the convenience wrapper the Train tab actually calls ───────────
{
  const log: WorkoutEntry[] = [
    { t: '2026-08-30T10:00:00.000Z', exercise: 'Back Squat', sets: [[8, 60], [8, 60]] },
  ];
  const lb = suggestForExercise(log, 'Back Squat', '6-8', 2.5, 'lb');
  ok(!!lb, 'the wrapper finds the last session');
  ok(!/\bkg\b/i.test(lb!.reason), `and passes the unit down — got "${lb!.reason}"`);
  eq(lb!.weight, 62.5, 'while still returning kilograms');
  // Unrelated to the unit, and the thing the runner's PR banner depends on:
  // the best estimated 1RM ever logged against the name.
  ok(priorBest1RM(log, 'Back Squat') > 60, 'a prior best exists for the PR check');
  eq(priorBest1RM(log, 'Front Squat'), 0, 'and is per movement, not shared');
}

if (errors.length) {
  console.error(`progression.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('progression.test.ts — ok');
