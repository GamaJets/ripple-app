// What kind of session a logged entry is, and which movements are cardio.
//
// This module had no test file, which is how the alias gap below survived: the
// screen matched a movement's name EXACTLY against the eight activities its own
// picker offers and the seven cardio machines in the catalogue — the names THIS
// app writes. A programme written by a coach, or imported from a catalogue,
// calls the same movements other things, so a member cycling inside a programme
// was offered no distance box and no way to record the ride they had just done.
//
// Exactness is not the defect and is not being loosened here. 380e71b
// established at some cost that a substring rule puts a distance box on every
// barbell row — and a figure typed into that box reclassifies the whole entry
// as cardio, because `workoutKind` reads the block and not the movement. What
// was missing was names, and names are cheap to add and safe.
//
// Compile with tsc, then run under plain node.
import {
  workoutKind, KIND_LABEL, WORKOUT_KINDS, HIIT_ACTIVITIES, MOBILITY_ACTIVITIES,
  CARDIO_MOVEMENT_ALIASES,
} from './workoutKind';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

/* ── 1. the kinds themselves ──────────────────────────────────────────────── */

for (const k of WORKOUT_KINDS) {
  ok(!!KIND_LABEL[k], `${k} has a label`);
}

// An entry carrying a cardio block is cardio whatever the movement is called.
// This is the reason a stray distance box matters: the BLOCK decides the kind.
eq(workoutKind({ exercise: 'Anything At All', cardio: { mins: 30, dist: 8, unit: 'km' } }), 'cardio',
  'a cardio block makes the entry cardio, whatever the movement is named');
eq(workoutKind({ exercise: 'Back Squat', sets: [[5, 100]] }), 'strength',
  'and sets of reps and weight make it strength');

/* ── 2. the aliases, which is the gap ─────────────────────────────────────── */

const aliases = new Set(CARDIO_MOVEMENT_ALIASES.map((a) => a.trim().toLowerCase()));

// Every name a gym or a programme puts on a bike. 'Cycling' was already in the
// screen's own list; not one of these was, and each is a real thing to be
// riding while wanting to write down how far you went.
for (const n of ['bike', 'stationary bike', 'exercise bike', 'indoor cycling', 'spin bike', 'assault bike', 'wattbike']) {
  ok(aliases.has(n), `a programme calling it "${n}" is still a bike`);
}

// Rowers, under the words printed on the machine rather than in our picker.
for (const n of ['rower', 'erg', 'concept2', 'rowerg']) {
  ok(aliases.has(n), `"${n}" is a rower`);
}

// 'Treadmill / Run' was ONE entry in the old set, so neither word matched on
// its own — a programme saying "Run" got nothing.
for (const n of ['run', 'running', 'jog', 'sprint']) {
  ok(aliases.has(n), `"${n}" is something you do on your feet, at speed`);
}

/* ── 3. what must NOT be in here ──────────────────────────────────────────── */

// The whole history of this rule. A barbell row is a back exercise and a step-up
// is a leg exercise, and neither may acquire a distance box — because a figure
// typed into one turns the entry into cardio.
for (const n of ['row', 'barbell row', 'seated row', 'upright row', 'step', 'step up', 'step ups']) {
  ok(!aliases.has(n), `"${n}" must not be treated as cardio`);
}

// Nor may an alias be a bare fragment that a strength movement contains. This
// is the property that keeps the exact match safe: if 'row' were ever added
// here, every barbell row in every programme would grow a distance box.
for (const a of aliases) {
  ok(a.length >= 3, `"${a}" is too short to be a movement name`);
  ok(a === a.trim(), `"${a}" has no stray whitespace`);
  ok(a === a.toLowerCase(), `"${a}" is already lowercase, so the screen's lookup finds it`);
}

// No duplicates, and no alias that merely repeats a name the picker already has
// under exactly that spelling — a set would swallow it, but a list nobody
// prunes is how the next reader stops trusting it.
eq(aliases.size, CARDIO_MOVEMENT_ALIASES.length, 'the alias list holds no duplicates');
{
  const own = new Set([
    ...HIIT_ACTIVITIES.map((a) => a.name.toLowerCase()),
    ...MOBILITY_ACTIVITIES.map((a) => a.name.toLowerCase()),
  ]);
  for (const a of aliases) {
    ok(!own.has(a), `"${a}" is a HIIT or mobility activity and must not be listed as cardio`);
  }
}

if (errors.length) {
  console.error(`workoutKind.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('workoutKind.test.ts — ok');
