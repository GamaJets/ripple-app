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
import { nextAlternative } from './builtWorkout';

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

  // Alternatives are real rows from the same pool: the whole of it bar the row
  // itself, with the movements NOT on the day first.
  for (const e of program.days[0].exercises) {
    ok(e.alternatives.every((a) => byName.has(a)), `${e.name}'s alternatives are catalogue rows`);
    eq(e.alternatives.length, 8, `${e.name} carries the whole triceps pool, not a slice of it`);
    eq(nextAlternative(e.alternatives, picked, 'Arms', [], 'ready', e.name) !== null
      && !picked.includes(nextAlternative(e.alternatives, picked, 'Arms', [], 'ready', e.name)!), true,
      `${e.name} is never replaced by a movement already on the day, itself included`);
    eq(e.alternatives.slice(0, 3).some((a) => picked.includes(a)), false,
      `${e.name}'s first alternatives are movements the day does not already hold`);
  }
}

/* ── Replace draws from the real pool, not a slice of it ───────────────────
 *
 * The defect: two alternatives per day, shared by every row, so a five-movement
 * triceps day could be replaced twice and then said "No other triceps movement
 * left in the catalogue" over a catalogue holding fifty. Simulated exactly the
 * way app/(client)/build-workout.tsx drives it: `used` is the day as it stands,
 * swaps included. */
{
  const tri = Array.from({ length: 50 }, (_, i) =>
    row(`Triceps Move ${String(i).padStart(2, '0')}`, 'Arms', ['triceps brachii'], 'dumbbell', false, { mechanic: 'isolation' }));
  const replaceAll = (rows: TargetRow[], rounds: number): number => {
    const day = targetedProgram(rows, [{ kind: 'muscle', name: 'Triceps' }]).program.days[0];
    const swaps: Record<string, string> = {};
    let done = 0;
    for (let r = 0; r < rounds; r++) {
      for (const e of day.exercises) {
        const used = day.exercises.map((x) => swaps[x.key] || x.name);
        const alt = nextAlternative(e.alternatives, used, 'Arms', [], 'ready', swaps[e.key] || e.name);
        if (!alt) return done;
        ok(!used.includes(alt), `swap ${done + 1} puts a movement on the day that is not already there`);
        swaps[e.key] = alt;
        done++;
      }
    }
    return done;
  };
  // 45 fresh movements, then the swapped-out ones come back round: Replace
  // never claims the pool is empty while the pool holds more than the day.
  eq(replaceAll(tri, 20), 100, 'a five-movement day out of fifty is never told the catalogue ran out');
  {
    const day = targetedProgram(tri, [{ kind: 'muscle', name: 'Triceps' }]).program.days[0];
    const seen = new Set<string>();
    const swaps: Record<string, string> = {};
    for (let i = 0; i < 45; i++) {
      const e = day.exercises[i % 5];
      const alt = nextAlternative(e.alternatives, day.exercises.map((x) => swaps[x.key] || x.name), 'Arms', [], 'ready', swaps[e.key] || e.name)!;
      seen.add(alt); swaps[e.key] = alt;
    }
    eq(seen.size, 45, 'the first 45 swaps are 45 different movements, none of them the original five');
  }
  // One row, Replace pressed again and again, walks the pool rather than
  // flipping between the two movements a swap keeps freeing.
  {
    const day = targetedProgram(tri, [{ kind: 'muscle', name: 'Triceps' }]).program.days[0];
    const e = day.exercises[0];
    const used = day.exercises.map((x) => x.name);
    const walked: string[] = [];
    for (let i = 0; i < 45; i++) {
      const alt = nextAlternative(e.alternatives, used, 'Arms', [], 'ready', used[0])!;
      walked.push(alt); used[0] = alt;
    }
    eq(new Set(walked).size, 45, 'one row pressed 45 times shows 45 different movements');
    eq(nextAlternative(e.alternatives, used, 'Arms', [], 'ready', used[0]), e.name,
      'and the 46th press brings back the movement it started with');
  }
  // "None left" is true only when the pool IS the day.
  eq(replaceAll(tri.slice(0, 5), 1), 0, 'five triceps movements, five on the day: nothing to swap, and the screen says so');
  eq(replaceAll(tri.slice(0, 6), 3), 15, 'one spare movement keeps Replace working, rotating through the pool');
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

// ── one session, or a day each ───────────────────────────────────────────
//
// The member who trains chest and triceps on a Tuesday was being handed a
// two-day week and no way to say otherwise.
{
  const picks = [{ kind: 'group' as const, name: 'Chest' }, { kind: 'muscle' as const, name: 'Triceps' }];
  const apart = targetedProgram(catalogue, picks);
  eq(apart.program.days.length, 2, 'a day each is still what two targets do by default');

  const one = targetedProgram(catalogue, picks, { together: true });
  eq(one.program.days.length, 1, 'together puts both in one session');
  eq(one.coverage.overflow, [], 'and nothing overflows a single day');
  const names = one.program.days[0].exercises.map((e) => e.name);
  eq(new Set(names).size, names.length, 'no movement is on the day twice');
  ok(names.length >= 2, 'and both targets reached it');
  // Taken in turns, so the second target is not left to the end of the day.
  const groups = one.program.days[0].exercises.map((e) => e.group);
  ok(groups[0] !== groups[1] || new Set(groups).size === 1,
    'the day alternates between the targets rather than emptying one first');
  ok(one.program.days[0].focus.includes('Chest') && one.program.days[0].focus.includes('Triceps'),
    'and the day says what it is for');
}

// ── the day it is for ────────────────────────────────────────────────────
{
  const picks = [{ kind: 'muscle' as const, name: 'Triceps' }];
  const plain = targetedProgram(catalogue, picks);
  const moved = targetedProgram(catalogue, picks, { startDay: 3 });
  ok(plain.program.days[0].day !== moved.program.days[0].day,
    'a session lands on the day the member picked, not always the start of the week');
  eq(targetedProgram(catalogue, picks, { startDay: 0 }).program.days[0].day, plain.program.days[0].day,
    'and day 0 is the week as it was');
}

// ── an injured area is built around, never hidden ────────────────────────
{
  const picks = [{ kind: 'muscle' as const, name: 'Triceps' }];
  const flags = (name: string) => name === 'Tricep Pushdown';
  const built = targetedProgram(catalogue, picks, { flags });
  const names = built.program.days[0].exercises.map((e) => e.name);
  ok(names[0] !== 'Tricep Pushdown', 'a flagging movement is not the first thing on the day');
  ok(built.program.days[0].exercises.concat(
    built.program.days[0].exercises.flatMap((e) => e.alternatives.map((a) => ({ name: a } as any))),
  ).some((e: any) => e.name === 'Tricep Pushdown'), 'and it is still offered rather than hidden');
  // Every movement flagging is not an empty workout.
  const all = targetedProgram(catalogue, picks, { flags: () => true });
  eq(all.program.days.length, 1, 'a target whose every movement flags still gets its day');
}

if (errors.length) {
  console.error(`targetedWorkout.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('targetedWorkout.test.ts — ok');
