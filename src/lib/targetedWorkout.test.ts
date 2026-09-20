// Every assertion here is about a workout a member who typed "triceps" would
// actually be handed, or about a sentence they would be told about it.
//
// The two failures this file exists to stop:
//
//   Triceps served out of the Arms group. "Triceps" is not one of the 11
//   `muscle_group` values and `primary_muscles` is where it lives; a match that
//   fell back to the group would hand a member biceps curls under the heading
//   they asked for.
//
//   A target quietly swapped or padded. Biceps plus No equipment is an empty
//   set against the live catalogue — 33 movements, none of them doable with
//   nothing — and the only acceptable output is a report that names Biceps and
//   says why.
import {
  MUSCLE_TARGETS, targetedProgram, targetedCoverageNote, targetForMuscle, targetsUnder,
  type TargetRow,
} from './targetedWorkout';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

const row = (
  name: string, group: string | null, primaryMuscles: string[],
  equipment: string | null, isBodyweight: boolean | null,
  extra: { category?: string | null; mechanic?: string | null } = {},
): TargetRow => ({ name, group, primaryMuscles, equipment, isBodyweight, ...extra });

/* ── the vocabulary covers the catalogue, not a sample of it ───────────────
 *
 * The 27 names in `primary_muscles` on the live table, counted 20 Sep 2026. A
 * muscle missing from `MUSCLE_TARGETS` is a muscle no member can ask for, and
 * it fails silently — `targetForMuscle` returns null and the picker simply
 * never offers it — so the whole set is asserted rather than the entries that
 * happen to be interesting. */
const CATALOGUE_MUSCLES = [
  'gluteus maximus', 'quadriceps', 'pectoralis major', 'latissimus dorsi', 'anterior deltoid',
  'hamstrings', 'rectus abdominis', 'triceps brachii', 'erector spinae', 'lateral deltoid',
  'trapezius', 'biceps brachii', 'rhomboids', 'obliques', 'hip flexors', 'gluteus medius',
  'gastrocnemius', 'adductors', 'posterior deltoid', 'forearm flexors', 'transverse abdominis',
  'brachialis', 'soleus', 'forearm extensors', 'abductors', 'brachioradialis', 'quadratus lumborum',
];
{
  for (const m of CATALOGUE_MUSCLES) {
    ok(targetForMuscle(m) != null, `a member can ask for ${m} by some name they would use`);
  }
  // And nothing here names a muscle the catalogue does not have — a chip that
  // filters to nothing forever.
  for (const t of MUSCLE_TARGETS) {
    for (const m of t.muscles) {
      ok(CATALOGUE_MUSCLES.includes(m), `${t.label} names ${m}, which the catalogue does not carry`);
    }
  }
  eq(targetForMuscle('triceps brachii')?.label, 'Triceps', 'the member says triceps');
  eq(targetForMuscle('TRICEPS BRACHII')?.label, 'Triceps', 'and the column capitalisation does not matter');
  // One friendly name over several anatomical ones is the normal case.
  eq(targetForMuscle('brachialis')?.label, 'Biceps', 'the brachialis is bicep work to a member');
  eq(targetsUnder('Arms').map((x) => x.label), ['Triceps', 'Biceps', 'Forearms'],
    'a member who opens Arms finds Triceps without knowing it is not a group');
}

/** A catalogue in the live one's shape for the corner this feature turns:
 *  triceps rows split across four muscle_groups, an Arms group that also holds
 *  biceps and forearm work, and a biceps pool with nothing bodyweight in it. */
const catalogue: TargetRow[] = [
  // Triceps — primary, spread over Full body / Chest / Arms, as the live rows are.
  row('Tricep Pushdown', 'Arms', ['triceps brachii'], 'cable', false, { mechanic: 'isolation' }),
  row('Skull Crusher', 'Full body', ['triceps brachii'], 'barbell', false, { mechanic: 'isolation' }),
  row('Dumbbell Tricep Kickback', 'Full body', ['triceps brachii'], 'dumbbell', false, { mechanic: 'isolation' }),
  row('Bench Dips', 'Arms', ['triceps brachii'], null, true, { mechanic: 'compound' }),
  row('Diamond Push Ups', 'Chest', ['triceps brachii'], null, true, { mechanic: 'compound' }),
  row('Close-Grip Bench Press', 'Full body', ['triceps brachii'], 'barbell', false, { mechanic: 'compound' }),
  row('Machine Preacher Tricep Extension', 'Arms', ['triceps brachii'], null, false, { mechanic: null }),
  row('Overhead Triceps Stretch', 'Full body', ['triceps brachii'], null, true, { category: 'stretching', mechanic: 'isolation' }),
  // Biceps — in the catalogue, and not one of them doable with nothing.
  row('Barbell Curl', 'Arms', ['biceps brachii'], 'barbell', false, { mechanic: 'isolation' }),
  row('Hammer Curl', 'Arms', ['brachialis'], 'dumbbell', false, { mechanic: 'isolation' }),
  row('Reverse Curl', 'Arms', ['brachioradialis'], 'ez bar', false, { mechanic: 'isolation' }),
  // Chest, for a group target to have something of its own.
  row('Push-up', 'Chest', ['pectoralis major'], null, true, { mechanic: 'compound' }),
  row('Bench Press', 'Chest', ['pectoralis major'], 'barbell', false, { mechanic: 'compound' }),
  row('Cable Fly', 'Chest', ['pectoralis major'], 'cable', false, { mechanic: 'isolation' }),
];

// ── "I want to train triceps" ─────────────────────────────────────────────
{
  const { program, coverage } = targetedProgram(catalogue, [{ kind: 'muscle', name: 'Triceps' }]);
  eq(program.days.length, 1, 'one target is one session, not a week');
  eq(program.title, 'Triceps Workout', 'and it is named after what was asked for');
  const picked = program.days[0].exercises.map((e) => e.name);
  eq(picked.length, 5, 'five movements, the default day');

  // The assertion this file is for. Every row must carry triceps in
  // `primary_muscles`; nothing may arrive because it happens to be filed
  // under Arms.
  const byName = new Map(catalogue.map((r) => [r.name, r]));
  for (const n of picked) {
    ok(byName.get(n)?.primaryMuscles.includes('triceps brachii') === true,
      `${n} is in a triceps workout because it trains the triceps`);
  }
  ok(!picked.includes('Barbell Curl'), 'a curl is Arms and is not triceps');
  ok(!picked.includes('Hammer Curl'), 'nor is the brachialis work beside it');

  // Isolation first, stretches last, catalogue-silent rows behind both.
  eq(picked, [
    'Dumbbell Tricep Kickback', 'Skull Crusher', 'Tricep Pushdown',
    'Bench Dips', 'Close-Grip Bench Press',
  ], 'direct triceps work opens the session and the presses follow it');

  eq(coverage.empty, [], 'nothing was left unserved');
  eq(coverage.served, [{ target: 'Triceps', options: 8 }], 'and the whole pool is reported, not the five used');
  eq(targetedCoverageNote(coverage), null, 'a workout with nothing to admit admits nothing');

  // Deterministic. A workout that reshuffles is one nobody can repeat.
  eq(targetedProgram(catalogue, [{ kind: 'muscle', name: 'Triceps' }]).program, program,
    'the same catalogue gives the same workout twice');

  // Alternatives are real rows from the same pool and never already in the day.
  for (const e of program.days[0].exercises) {
    ok(e.alternatives.every((a) => byName.has(a)), `${e.name}'s alternatives are catalogue rows`);
    ok(e.alternatives.every((a) => !picked.includes(a)), `${e.name}'s alternatives are not already prescribed`);
  }
}

// ── the group level is a different question and gets a different answer ───
{
  const { program } = targetedProgram(catalogue, [{ kind: 'group', name: 'Arms' }]);
  const picked = program.days[0].exercises.map((e) => e.name);
  ok(picked.includes('Barbell Curl'), 'the Arms GROUP does include the curls');
  ok(picked.every((n) => catalogue.find((r) => r.name === n)?.group === 'Arms'),
    'and only rows the catalogue files under Arms');
  ok(!picked.includes('Diamond Push Ups'),
    'a triceps movement filed under Chest is not in the Arms group, however much it trains the triceps');
}

// ── the group a row wears is the catalogue's, not the target's ────────────
{
  const { program } = targetedProgram(catalogue, [{ kind: 'muscle', name: 'Triceps' }]);
  const dip = program.days[0].exercises.find((e) => e.name === 'Close-Grip Bench Press');
  eq(dip?.group, 'Full body', 'the row keeps the group the catalogue gave it');
}

// ── biceps with no equipment is an empty set, and says so ─────────────────
{
  const { program, coverage } = targetedProgram(
    catalogue, [{ kind: 'muscle', name: 'Biceps' }], { noKit: true });
  eq(program.days, [], 'nothing could be built, so nothing was');
  eq(coverage.empty, [{ target: 'Biceps', reason: 'kit', held: 3 }],
    'named, with the count the catalogue actually holds');
  const note = targetedCoverageNote(coverage) || '';
  ok(note.includes('Biceps'), 'the sentence names the target');
  ok(/no equipment/.test(note), 'and says what it was that could not be met');
  ok(!/tricep/i.test(note), 'and never offers a different muscle instead');
}

// ── a mixed pick: one target served, one not, in one report ───────────────
{
  const { program, coverage } = targetedProgram(
    catalogue,
    [{ kind: 'muscle', name: 'Triceps' }, { kind: 'muscle', name: 'Biceps' }, { kind: 'muscle', name: 'Calves' }],
    { noKit: true },
  );
  eq(program.days.map((d) => d.focus), ['Triceps'], 'only the target that could be served is a day');
  eq(program.days[0].exercises.map((e) => e.name),
    ['Bench Dips', 'Diamond Push Ups', 'Overhead Triceps Stretch'],
    'and it holds only the no-equipment triceps rows, the stretch last');
  eq(coverage.empty, [
    { target: 'Biceps', reason: 'kit', held: 3 },
    { target: 'Calves', reason: 'none', held: 0 },
  ], 'two different reasons, both stated');
  const note = targetedCoverageNote(coverage) || '';
  ok(note.includes('Calves') && note.includes('Biceps'), 'both are named');
  ok(note.includes('only 3 movements'), 'and a short day is admitted rather than passed off as full');
}

// ── a target nobody can look up is reported, never guessed at ─────────────
{
  const { program, coverage } = targetedProgram(catalogue, [{ kind: 'muscle', name: 'Lower Traps' }]);
  eq(program.days, [], 'nothing invented for a name we do not hold');
  eq(coverage.empty, [{ target: 'Lower Traps', reason: 'unknown', held: 0 }], 'and it is named');
}

// ── an empty catalogue is not a body with no muscles in it ────────────────
{
  const { program, coverage } = targetedProgram([], [{ kind: 'muscle', name: 'Triceps' }]);
  eq(program.days, [], 'no rows, no workout');
  eq(coverage.poolSize, 0, 'and the report says the pool was empty');
  const note = targetedCoverageNote(coverage) || '';
  ok(/catalogue came back empty/.test(note),
    'which is a sentence about the read, not about the triceps');
}

// ── seven days in a week, and the rest are named ──────────────────────────
{
  const many = Array.from({ length: 9 }, (_, i) => ({ kind: 'group' as const, name: `G${i}` }));
  const rows: TargetRow[] = many.flatMap((g) =>
    [1, 2].map((n) => row(`${g.name} Move ${n}`, g.name, [], null, true, { mechanic: 'compound' })));
  const { program, coverage } = targetedProgram(rows, many);
  eq(program.days.length, 7, 'a week is seven days');
  eq(coverage.overflow, ['G7', 'G8'], 'and the two that did not fit are named');
  ok((targetedCoverageNote(coverage) || '').includes('G7'), 'in words as well as in the report');
}

if (errors.length) {
  console.error(`targetedWorkout.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('targetedWorkout.test.ts — ok');
