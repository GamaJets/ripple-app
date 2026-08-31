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
import { suggestNextWeight, suggestForExercise, suggestProgression, parseRepRange, priorBest1RM } from './progression';
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

// ── omitting the unit no longer means kilograms ────────────────────────────
{
  // This block used to assert the opposite: that `suggestNextWeight` defaulted
  // to 'kg', so "every existing caller keeps working". That default was the
  // defect — a pure module with no member in scope inventing the unit a member
  // reads in, which is `money(cents, currency = 'AED')` in a different costume.
  // `clients.weight_unit` is NULL until somebody taps one, and a caller with no
  // unit to pass is a caller that does not know.
  //
  // So an omitted unit now WITHHOLDS the load rather than stating it in a guess.
  // The sentence stays useful because, unlike an amount of money, the coaching
  // advice does not depend on the unit — only the figure does.
  const bare = suggestNextWeight([[8, 60]], { low: 6, high: 8 });
  ok(!!bare, 'a suggestion still comes back without a unit');
  ok(!/\bkgs?\b/i.test(bare!.reason), `no kilograms are invented — got "${bare!.reason}"`);
  ok(!/\blbs?\b/i.test(bare!.reason), `and no pounds either — got "${bare!.reason}"`);
  ok(!bare!.reason.includes('60'), `nor the raw stored figure, which means nothing on its own — got "${bare!.reason}"`);
  ok(bare!.reason.includes('8 reps'), `the rep count survives, being unitless — got "${bare!.reason}"`);
  // The decision is untouched by the missing unit: only the wording is.
  eq(bare!.weight, 62.5, 'and the suggested load is still kilograms, unchanged');
  eq(bare!.up, true, 'and still reads the range the same way');
}

// ── the seven kilograms in the coaching cues ──────────────────────────────
//
// `suggestProgression` built `rationale` with "kg" written into seven separate
// templates. app/(client)/progression.tsx renders that string directly under a
// KPI reading "Target Load · 132 lb", so a pounds member got both units for one
// lift on one card. These sweep every branch rather than the one that was
// reported, because six of the seven were only reachable through a particular
// rep count or a particular "felt" answer.
{
  const at = (t: string) => `2026-08-3${t}T10:00:00.000Z`;
  const one = (sets: [number, number][], feel?: string[]) =>
    suggestProgression([{ t: at('0'), exercise: 'Back Squat', sets, feel } as never], 'lb')[0];

  // Each of the four base branches, then the three the "felt" signal rewrites.
  const branches = [
    { tip: one([[12, 100], [12, 100]]), what: 'increase' },
    { tip: one([[9, 100], [9, 100]]), what: 'chase a rep' },
    { tip: one([[6, 100], [6, 100]]), what: 'hold' },
    { tip: one([[2, 100], [2, 100]]), what: 'deload' },
    { tip: one([[12, 100], [12, 100]], ['hard', 'hard']), what: 'cleared but hard' },
    { tip: one([[9, 100], [9, 100]], ['ok', 'hard']), what: 'in range but hard' },
    { tip: one([[9, 100], [9, 100]], ['easy', 'easy']), what: 'in range and easy' },
  ];
  // Seven DISTINCT cues, not merely seven entries in this array. The version
  // this replaces read `eq(branches.length, 7, …)` — the length of a literal
  // declared twelve lines above, checked against the number it was written
  // with. Nothing from the module was involved and it could not fail. What it
  // was reaching for is that each of the seven fixtures lands on its own branch:
  // if two of them collapsed into one cue, the loop below would still pass
  // every rationale (both would be unit-clean) while a whole branch had
  // silently stopped existing.
  eq(new Set(branches.map(({ tip }) => tip.rationale)).size, branches.length,
    `each fixture reaches a branch of its own — got ${new Set(branches.map(({ tip }) => tip.rationale)).size} distinct cues from ${branches.length} fixtures`);
  for (const { tip, what } of branches) {
    ok(!!tip, `the ${what} branch produces a tip`);
    ok(!/\bkgs?\b/i.test(tip.rationale), `the ${what} cue never says kilograms to a pounds member — got "${tip.rationale}"`);
  }

  // The two branches that name a LOAD must name it converted, not relabelled.
  // 100 kg is 220.5 lb; the old string carried the literal 100.
  const hold = one([[6, 100], [6, 100]]);
  ok(hold.rationale.includes('220.5'), `the hold cue reads 100 kg as 220.5 lb — got "${hold.rationale}"`);
  // And the bump: a 5 kg step on a squat is 11 lb, not 5.
  const up = one([[12, 100], [12, 100]]);
  ok(up.rationale.includes('11 lb'), `a 5 kg step reads as 11 lb — got "${up.rationale}"`);
  ok(!up.rationale.includes('5 lb'), `and never as a relabelled 5 — got "${up.rationale}"`);

  // Metric readers still get the figures they always did.
  const kg = suggestProgression([{ t: at('0'), exercise: 'Back Squat', sets: [[6, 100], [6, 100]] } as never], 'kg')[0];
  ok(kg.rationale.includes('100 kg'), `a metric member still reads 100 kg — got "${kg.rationale}"`);

  // And a caller with no member in scope — app/(client)/coach.tsx builds a
  // one-line summary from the tip and never renders the rationale — gets advice
  // with the load left out rather than advice in a unit nobody chose.
  const none = suggestProgression([{ t: at('0'), exercise: 'Back Squat', sets: [[6, 100], [6, 100]] } as never])[0];
  ok(!/\bkgs?\b|\blbs?\b/i.test(none.rationale), `no unit is invented — got "${none.rationale}"`);
  ok(!none.rationale.includes('100'), `nor is the bare stored figure printed — got "${none.rationale}"`);
  ok(none.rationale.length > 20, `and it is still a sentence worth reading — got "${none.rationale}"`);
  // The decision behind it is identical whichever unit the prose is in.
  eq(none.action, kg.action, 'the action does not depend on the unit');
  eq(none.nextWeight, kg.nextWeight, 'and neither does the kilograms it targets');
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
