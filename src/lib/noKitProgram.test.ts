// Every assertion here is about a week somebody with nothing to train with
// would actually be handed, or about a sentence they would be told about it.
//
// The catalogue shape under test is the live one: 615 rows, 183 of which carry
// `equipment is null AND is_bodyweight = true`, 7 more with a null column and
// no flag, and a Calves group whose no-kit count is zero. The two failures this
// file exists to stop are a band or a pull-up bar getting into a no-kit week,
// and a group being dropped from the week without the screen saying so.
import { needsNoKit } from './equipmentFacet';
import { noKitProgram, noKitCoverageNote, type NoKitRow } from './noKitProgram';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

const row = (name: string, group: string | null, equipment: string | null, isBodyweight: boolean | null, category?: string): NoKitRow =>
  ({ name, group, equipment, isBodyweight, category });

// ── what counts as needing nothing ────────────────────────────────────────
{
  ok(needsNoKit({ equipment: null, isBodyweight: true }), 'no column and flagged bodyweight is the pool');
  ok(needsNoKit({ equipment: '   ', isBodyweight: true }), 'a blank column is the same gap as a null one');

  // The 7 rows with a null column and no flag. The catalogue has not said they
  // need nothing, and "we did not record it" is not "you need nothing".
  ok(!needsNoKit({ equipment: null, isBodyweight: null }), 'a null flag is not a yes');
  ok(!needsNoKit({ equipment: null }), 'nor is an absent one');
  ok(!needsNoKit({ equipment: null, isBodyweight: false }), 'nor is a false one');

  // Bands are equipment, and so is a bar you hang off. Neither is listed
  // anywhere in the module — the column keeps them out on its own.
  ok(!needsNoKit({ equipment: 'loop band', isBodyweight: true }), 'a band is equipment even on a bodyweight row');
  ok(!needsNoKit({ equipment: 'pull up bar', isBodyweight: true }), 'so is a pull-up bar');
}

/** A catalogue in the live one's shape: eleven groups, Calves present with no
 *  no-kit movement in it, Arms present with exactly one. */
const catalogue: NoKitRow[] = [
  ...['Burpee', 'Mountain Climber', 'Bear Crawl', 'Inchworm'].map((n) => row(n, 'Full body', null, true)),
  ...['Plank', 'Dead Bug', 'Hollow Hold', 'Bird Dog'].map((n) => row(n, 'Core', null, true)),
  ...['Bodyweight Squat', 'Reverse Lunge', 'Wall Sit'].map((n) => row(n, 'Legs', null, true)),
  ...['Push-up', 'Incline Push-up'].map((n) => row(n, 'Chest', null, true)),
  ...['Superman', 'Prone Y Raise'].map((n) => row(n, 'Back', null, true)),
  ...['Pike Push-up', 'Wall Walk'].map((n) => row(n, 'Shoulders', null, true)),
  ...['Glute Bridge', 'Donkey Kick'].map((n) => row(n, 'Glutes', null, true)),
  ...['Nordic Hamstring Curl', 'Single-leg Deadlift'].map((n) => row(n, 'Hamstrings', null, true)),
  row('Prone Back Extension', 'Lower back', null, true),
  // Arms: exactly one, which is the live count.
  row('Diamond Push-up', 'Arms', null, true),
  // Calves: the group exists in the catalogue and nothing in it needs no kit.
  row('Standing Calf Raise', 'Calves', 'machine', false),
  row('Seated Calf Raise', 'Calves', 'machine', false),
  // Equipped rows that must never reach the week.
  row('Pull-up', 'Back', 'pull up bar', false),
  row('Band Pull-apart', 'Shoulders', 'resistance band', false),
  row('Bench Press', 'Chest', 'barbell', false),
  // A null column with no flag — unknown, excluded, and it is a Chest row so
  // its exclusion is visible in the Chest movements that do get picked.
  row('Mystery Fly', 'Chest', null, null),
];

// ── the week is drawn only from the pool ──────────────────────────────────
{
  const { program, coverage } = noKitProgram(catalogue);
  eq(coverage.poolSize, 23, 'the pool is every row with no kit and the flag, and nothing else');

  const picked = program.days.flatMap((d) => d.exercises.map((e) => e.name));
  ok(picked.length > 0, 'a catalogue with a pool in it produces a week');
  const banned = ['Pull-up', 'Band Pull-apart', 'Bench Press', 'Mystery Fly', 'Standing Calf Raise', 'Seated Calf Raise'];
  for (const n of banned) ok(!picked.includes(n), `${n} needs kit and is not in a no-equipment week`);

  // Never invented. Every name on the week is a row that was passed in.
  const known = new Set(catalogue.map((r) => r.name));
  ok(picked.every((n) => known.has(n)), 'every movement in the week came from the catalogue');

  eq(program.days.length, 3, 'three days by default');
  ok(program.days.every((d) => d.exercises.length === 5), 'five movements a day');

  // Keys are edited by the builder and must be unique even when a one-option
  // group forces the same movement into two days.
  const keys = program.days.flatMap((d) => d.exercises.map((e) => e.key));
  eq(new Set(keys).size, keys.length, 'no two rows in the week share an edit key');

  // Deterministic: a coach reviewing the week has to be looking at the same
  // week they generated.
  eq(noKitProgram(catalogue).program, program, 'the same catalogue gives the same week twice');
}

// ── the groups it could not cover are named ───────────────────────────────
{
  const { coverage, program } = noKitProgram(catalogue);
  eq(coverage.missing, ['Calves'], 'a group the catalogue has and the pool cannot fill is named');
  // Arms and Lower back hold one movement each: in the week, with nothing to
  // alternate with, and a coach has to be told rather than left to count.
  eq(coverage.thin, [{ group: 'Arms', options: 1 }, { group: 'Lower back', options: 1 }],
    'and so is a group the catalogue holds one no-equipment movement for');
  eq(coverage.unplaced, 0, 'every pooled row here is placed on the body');

  // Named, not counted. "Two groups are not covered" sends a coach hunting.
  const note = noKitCoverageNote(coverage);
  ok(note != null && note.includes('Calves'), 'the sentence names Calves');
  ok(note != null && note.includes('Arms'), 'and names Arms');
  ok(note != null && !note.includes('programme'), 'American spelling throughout');
  // The note travels with the program, so it reaches a screen that only has
  // the program and never read the coverage.
  ok(program.note.includes('Calves'), 'and the program carries it');

  // A group that IS covered is not in either list, or the sentence cries wolf.
  ok(!coverage.missing.includes('Core') && !coverage.thin.some((x) => x.group === 'Core'),
    'a well-stocked group is not reported as a gap');

  // Arms has one movement and it is still IN the week — the honest outcome is
  // "here it is, and it is the only one", not silently dropping the group.
  const picked = program.days.flatMap((d) => d.exercises.map((e) => e.name));
  ok(picked.includes('Diamond Push-up'), 'the single Arms movement is in the week, not dropped');
}

// ── an empty pool is not a program with gaps in it ────────────────────────
{
  // What a failed or unread catalogue looks like by the time it reaches here.
  const none = noKitProgram([]);
  eq(none.program.days, [], 'nothing to draw from draws nothing — never a half week');
  eq(none.coverage.poolSize, 0, 'and says the pool was empty');
  const note = noKitCoverageNote(none.coverage);
  ok(note != null && note.includes('nothing to build'), 'the sentence says there is nothing to build from');
  // It must NOT start naming groups as uncovered: over an empty catalogue that
  // would be a claim about a catalogue nobody read.
  ok(note != null && !note.includes('is not in this program'), 'and makes no claim about individual groups');

  // A catalogue that loaded and genuinely holds no bodyweight row is the same
  // sentence, which is the honest one either way.
  const equipped = noKitProgram([row('Bench Press', 'Chest', 'barbell', false)]);
  eq(equipped.program.days, [], 'a catalogue of machines yields no no-equipment week');
}

// ── a stretch is a hold, not twelve repetitions ───────────────────────────
{
  const stretchy: NoKitRow[] = [
    row('Standing Quad Stretch', 'Legs', null, true, 'stretching'),
    row('Bodyweight Squat', 'Legs', null, true, 'strength'),
  ];
  const { program } = noKitProgram(stretchy, { days: 2, perDay: 1 });
  const squat = program.days[0].exercises[0];
  eq(squat.name, 'Bodyweight Squat', 'strength is offered before stretching inside a group');
  eq(squat.reps, '10-15', 'and is prescribed in repetitions');
  const stretch = program.days[1].exercises[0];
  eq(stretch.name, 'Standing Quad Stretch', 'the stretch comes next');
  eq(stretch.reps, '30 sec', 'and is prescribed as a hold, because reps on a stretch is nonsense');
}

// ── the alternatives are real rows, not suggestions ───────────────────────
{
  const { program } = noKitProgram(catalogue);
  const known = new Set(catalogue.map((r) => r.name));
  for (const d of program.days) {
    for (const e of d.exercises) {
      ok(e.alternatives.every((a) => known.has(a)), `${e.name}'s alternatives are catalogue rows`);
      ok(!e.alternatives.includes(e.name), `${e.name} is not offered as its own alternative`);
    }
  }
  const arms = program.days.flatMap((d) => d.exercises).find((e) => e.group === 'Arms');
  eq(arms?.alternatives, [], 'a group with one movement offers no alternatives rather than inventing one');
}

if (errors.length) {
  console.error(`noKitProgram.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('noKitProgram.test.ts — ok');
