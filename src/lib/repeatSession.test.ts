// Repeating a past session. Compile with tsc, run with node.
//
// The failure this guards is not a crash. It is a plan that claims more than
// the log said: four sets offered for a session where two were done, a belted
// dip priced as 20 kg on a machine, a plank offered as forty-five repetitions,
// or a movement quietly missing from the list because the catalogue no longer
// knows its name. Every one of those looks completely normal on screen.
import {
  loggedSessions, repeatSession, sessionSummary,
  type PastSession, type RepeatConversion,
} from './repeatSession';
import { prescribedSeconds, isTimedPrescription } from './timedSets';
import { expandSets, setCount } from './setRows';
import type { WorkoutEntry } from './mockData';
import type { ExerciseRef } from './exerciseId';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const CAT: ExerciseRef[] = [
  { id: 'back-squat', name: 'Back Squat', group: 'Legs' },
  { id: 'plank', name: 'Plank', group: 'Core' },
  { id: 'pull-up', name: 'Pull-up', group: 'Back' },
];

const T = '2026-09-08T18:30:00.000Z';
const entry = (over: Partial<WorkoutEntry> & { exercise: string }): WorkoutEntry =>
  ({ t: T, ...over });

const one = (e: WorkoutEntry, known: ExerciseRef[] | null = CAT): RepeatConversion =>
  repeatSession([e], known);

/* ── what was recorded, and not one set more ──────────────────────────────── */

{
  // The session where somebody did two of four and went home. The plan is not
  // in the log, so the log says two, and two is what comes back.
  const c = one(entry({ exercise: 'Back Squat', sets: [[8, 60], [6, 60]] }));
  eq(c.exercises.length, 1, 'one movement in, one movement out');
  const ex = c.exercises[0];
  eq(ex.sets, 2, 'two sets logged is two sets offered — the plan is not in the log to pad from');
  eq(setCount(ex), 2, 'and the table agrees with the count, which is the one fact with two homes');
  eq(c.skipped.length, 0, 'nothing was skipped');
}

// Per-set loads survive. A ramp that collapsed into one number would tell a
// member they lifted 40 for all three.
{
  const c = one(entry({ exercise: 'Back Squat', sets: [[8, 40], [8, 42.5], [6, 45]] }));
  const rows = expandSets(c.exercises[0]);
  eq(rows.map((r) => r.loadKg).join(','), '40,42.5,45', 'every set carries the load it was done at');
  eq(rows.map((r) => r.reps).join(','), '8,8,6', 'and the reps that were done at it');
  eq(c.exercises[0].loadKg, 40, 'the exercise-level fallback is the first set, which is the one it opens on');
  eq(c.exercises[0].reps, '8', 'and so is the rep fallback');
}

/* ── the three shapes of a set ────────────────────────────────────────────── */

// A hold is seconds, and has to come back as a prescription the runner can
// read. `holdLabel` prints 90 as "1:30" and `prescribedSeconds` cannot read
// that back, which would open a reps box on a plank.
{
  const c = one(entry({ exercise: 'Plank', sets: [[45, 0], [90, 0]], timed: [true, true] }));
  const rows = expandSets(c.exercises[0]);
  eq(rows[0].reps, '45 sec', 'a 45 second hold is prescribed in seconds');
  eq(rows[1].reps, '90 sec', 'and so is a 90 second one — never as a clock');
  ok(isTimedPrescription(rows[0].reps), 'the runner opens a hold box on the first');
  eq(prescribedSeconds(rows[1].reps), 90, 'and reads ninety seconds back out of the second, not one and a half');
  eq(c.exercises[0].reps, '45 sec', 'the exercise fallback is a hold too, so the collapsed row does not say 45 reps');
}

// A bodyweight set's second number is what was ADDED to the body. The plan
// shape has nowhere to put the body, so the addition is not written either —
// 20 in `loadKg` is 20 kg on a machine to every reader downstream.
{
  const c = one(entry({ exercise: 'Pull-up', sets: [[10, 0], [8, 20]], bw: [true, true] }));
  const rows = expandSets(c.exercises[0]);
  eq(rows[0].loadKg, null, 'a plain pull-up carries no load into the plan');
  eq(rows[1].loadKg, null, 'and neither does a belted one — 20 kg on a bar is a different claim');
  eq(c.bodyweightSets, 2, 'both are counted so the screen can say what it could not carry');
  eq(rows.map((r) => r.reps).join(','), '10,8', 'the reps are untouched — only the load could not be said');
}

// The ambiguous zero. A stored 0 on a set with no `bw` flag is either a
// bodyweight set from before the flag existed or an empty box, and this app
// does not let a figure mean two things.
{
  const c = one(entry({ exercise: 'Back Squat', sets: [[10, 0]] }));
  eq(expandSets(c.exercises[0])[0].loadKg, null, 'a bare zero is no load, never a load of zero');
  eq(c.bodyweightSets, 0, 'and it is not counted as bodyweight either, because nobody said it was');
}

// A hold that was also bodyweight is both shapes at once.
{
  const c = one(entry({ exercise: 'Plank', sets: [[60, 0]], timed: [true], bw: [true] }));
  const r = expandSets(c.exercises[0])[0];
  eq(r.reps, '60 sec', 'a bodyweight hold is still a hold');
  eq(r.loadKg, null, 'and still carries no load');
  eq(c.bodyweightSets, 1, 'and is still counted as bodyweight');
}

// Flags shorter than the sets they align to. Every entry written before either
// flag existed has none at all, and a half-written array must not read as
// "false for the rest" by accident — it reads as "nobody said", which is what
// `isBodyweightSet` and `isTimedSet` already answer.
{
  const c = one(entry({ exercise: 'Pull-up', sets: [[10, 0], [8, 0]], bw: [true] }));
  const rows = expandSets(c.exercises[0]);
  eq(c.bodyweightSets, 1, 'only the set that was flagged is bodyweight');
  eq(rows[1].loadKg, null, 'and the unflagged one is still a set with nothing recorded on the bar');
}

/* ── what is NOT converted ────────────────────────────────────────────────── */

// `feel` is the member's own account of their session. `rpe` is a coach's
// instruction. This is the one conversion this app never makes.
{
  const c = one(entry({ exercise: 'Back Squat', sets: [[5, 100], [5, 100]], feel: ['hard', 'hard'] }));
  const ex = c.exercises[0];
  eq(ex.rpe ?? null, null, "a member's 'hard' never comes back at them as a prescribed RPE");
  eq(ex.pct1rm ?? null, null, 'nothing invents a share of a maximum nobody tested');
  eq(ex.method ?? null, null, 'and nothing invents a set method, which changes tonnage and the rest timer');
  eq(ex.note ?? null, null, 'the note is the coach’s voice and stays empty');
  eq(ex.restSec ?? null, null, 'nobody timed the rests, so nothing is written where a coach’s rest goes');
  eq(ex.setGroupId ?? null, null, 'and a repeated session has no supersets, because the log records no pairing');
  eq(ex.alternatives.length, 0, 'no alternatives either, so the runner offers no swap to a movement nobody named');
}

/* ── a movement the catalogue no longer knows ─────────────────────────────── */

{
  const c = repeatSession([
    entry({ exercise: 'Back Squat', sets: [[5, 100]] }),
    entry({ exercise: 'Jefferson Curl', sets: [[8, 20]] }),
  ], CAT);
  eq(c.exercises.length, 2, 'a movement the catalogue has never heard of is still offered');
  eq(c.exercises[1].name, 'Jefferson Curl', 'under the name it was logged under');
  eq(c.exercises[1].sets, 1, 'with its set intact');
  eq(c.unknown.join(','), 'Jefferson Curl', 'and it is named, so the screen can say which');
  eq(c.exercises[0].group, 'Legs', 'a known movement takes the group the catalogue gives it');
  eq(c.exercises[1].group, 'Repeated', 'and an unknown one gets a word rather than an empty separator');
  ok(c.identified, 'a catalogue was supplied, so the answer means something');
}

// Nobody looked. An unread catalogue has not established that anything is
// missing from it.
{
  const c = repeatSession([entry({ exercise: 'Jefferson Curl', sets: [[8, 20]] })], null);
  eq(c.exercises.length, 1, 'the movement is offered whether or not a catalogue was read');
  eq(c.identified, false, 'and the result says plainly that nobody looked');
  eq(c.unknown.length, 0, 'so nothing is claimed to be missing');
}

/* ── nothing vanishes, and nothing throws ─────────────────────────────────── */

{
  const c = repeatSession([
    entry({ exercise: 'Back Squat', sets: [[5, 100]] }),
    entry({ exercise: 'Run', cardio: { mins: 30, dist: 5, unit: 'km' } }),
    entry({ exercise: 'Bench Press' }),
    entry({ exercise: '   ', sets: [[5, 40]] }),
  ], CAT);
  eq(c.exercises.length, 1, 'only the lift can be run');
  eq(c.skipped.length, 3, 'and the other three are reported rather than dropped on the floor');
  const run = c.skipped.find((s) => s.exercise === 'Run');
  ok(!!run && /Cardio tab/.test(run.reason), 'the bike ride says where its own timer is');
  const bench = c.skipped.find((s) => s.exercise === 'Bench Press');
  ok(!!bench && /No sets were recorded/.test(bench.reason), 'an entry with no sets says so');
  ok(c.skipped.some((s) => s.exercise === ''), 'and an entry with no movement name is still accounted for');
}

// Rows a jsonb column can hold and no build ever wrote. Counted, never coerced.
{
  const bad = { t: T, exercise: 'Back Squat', sets: [[0, 50], [NaN, 50], ['8', 50], [10, 50]] } as unknown as WorkoutEntry;
  const c = one(bad);
  eq(c.exercises.length, 1, 'the readable set still makes a movement');
  eq(c.exercises[0].sets, 2, "a zero and a NaN are not sets; a numeric string '8' is a number and is");
  eq(c.unreadableSets, 2, 'and the two that could not be read are counted');
}

{
  const c = one({ t: T, exercise: 'Back Squat', sets: [[0, 0]] } as WorkoutEntry);
  eq(c.exercises.length, 0, 'a movement whose every set is unreadable is not offered');
  eq(c.skipped.length, 1, 'it is reported instead');
  eq(c.unreadableSets, 1, 'and its sets are still counted');
}

// The shapes that would throw. Nothing here may crash the Train tab.
{
  const empty = repeatSession([], CAT);
  eq(empty.exercises.length, 0, 'an empty session converts to an empty list');
  eq(repeatSession(null, CAT).exercises.length, 0, 'and so does a null one');
  const junk = repeatSession([
    null as unknown as WorkoutEntry,
    { t: T, exercise: 'Back Squat', sets: 'nonsense' } as unknown as WorkoutEntry,
  ], CAT);
  eq(junk.exercises.length, 0, 'junk rows are refused rather than thrown on');
  eq(junk.skipped.length, 1, 'and the one that named a movement says why');
}

/* ── keys ─────────────────────────────────────────────────────────────────── */

{
  // The same movement twice in one session is two rows, and two rows sharing a
  // key would collide in every per-exercise map on the screen.
  const c = repeatSession([
    entry({ exercise: 'Back Squat', sets: [[5, 100]] }),
    entry({ exercise: 'Back Squat', sets: [[8, 80]] }),
  ], CAT);
  eq(c.exercises.length, 2, 'both are offered');
  ok(c.exercises[0].key !== c.exercises[1].key, 'and they do not share a key');
  ok(c.exercises.every((e) => e.key.indexOf('custom-') !== 0),
    'and no repeated movement is mistaken for one the member added to their plan');
}

/* ── the log split into sessions ──────────────────────────────────────────── */

{
  const log: WorkoutEntry[] = [
    { t: '2026-09-01T07:00:00.000Z', exercise: 'Back Squat', sets: [[5, 100], [5, 100]] },
    { t: '2026-09-01T07:00:00.000Z', exercise: 'Pull-up', sets: [[10, 0]], bw: [true] },
    { t: '2026-09-03T19:00:00.000Z', exercise: 'Bench Press', sets: [[8, 60]] },
    // Same day, a different session. Two sessions, not one.
    { t: '2026-09-03T07:00:00.000Z', exercise: 'Plank', sets: [[45, 0]], timed: [true] },
    // Cardio only: nothing the barbell runner can be handed.
    { t: '2026-09-05T07:00:00.000Z', exercise: 'Run', cardio: { mins: 30, dist: 5, unit: 'km' } },
  ];
  const ss = loggedSessions(log);
  eq(ss.length, 3, 'three sessions have something to repeat; the bike ride does not');
  eq(ss[0].t, '2026-09-03T19:00:00.000Z', 'newest first');
  eq(ss[1].t, '2026-09-03T07:00:00.000Z', 'and two sessions on one day stay two, in the order they happened');
  eq(ss[2].movements, 2, 'the oldest session has two movements');
  eq(ss[2].sets, 3, 'and three sets across them');
  eq(sessionSummary(ss[2]), '2 movements · 3 sets', 'which is what the row says');
  eq(sessionSummary(ss[0]), '1 movement · 1 set', 'and one of each is singular');
  ok(!ss.some((s) => s.entries.some((e) => e.exercise === 'Run')), 'a cardio-only session is not offered as a lift to repeat');
}

// The day is the LOCAL one. A 21:00 session in a gym east of Greenwich is not
// tomorrow, and a bare date is never parsed.
{
  const ss = loggedSessions([{ t: '2026-09-08T18:30:00.000Z', exercise: 'Back Squat', sets: [[5, 100]] }]);
  const d = ss[0].day;
  ok(d != null && /^\d{4}-\d{2}-\d{2}$/.test(d), 'the day is a plain calendar key');
  eq(d, new Date('2026-09-08T18:30:00.000Z').getFullYear()
    + '-' + String(new Date('2026-09-08T18:30:00.000Z').getMonth() + 1).padStart(2, '0')
    + '-' + String(new Date('2026-09-08T18:30:00.000Z').getDate()).padStart(2, '0'),
    'and it is the day the member was in the gym, in their own timezone');
}

{
  eq(loggedSessions(null).length, 0, 'an unread log is handled — and the CALLER must not read it as an empty one');
  eq(loggedSessions([]).length, 0, 'an empty log is empty');
  const odd = loggedSessions([
    { exercise: 'Back Squat', sets: [[5, 100]] } as unknown as WorkoutEntry,
    { t: '', exercise: 'Bench Press', sets: [[5, 60]] },
  ]);
  eq(odd.length, 0, 'an entry with no instant belongs to no session and does not invent one');
}

/* ── the round trip the screen actually makes ─────────────────────────────── */

{
  // Everything the runner asks of an exercise, asked of a converted one. A
  // field that comes back undefined where the runner indexes into it is how the
  // empty-list crash in src/lib/startGate.ts happened.
  const s: PastSession = loggedSessions([
    { t: T, exercise: 'Back Squat', sets: [[5, 100], [5, 102.5]] },
    { t: T, exercise: 'Plank', sets: [[45, 0]], timed: [true] },
  ])[0];
  const c = repeatSession(s.entries, CAT);
  eq(c.exercises.length, 2, 'the session converts whole');
  for (const ex of c.exercises) {
    ok(typeof ex.key === 'string' && ex.key.length > 0, 'every movement has a key');
    ok(typeof ex.name === 'string' && ex.name.length > 0, 'every movement has a name');
    ok(typeof ex.group === 'string' && ex.group.length > 0, 'every movement has a group to print');
    ok(Array.isArray(ex.alternatives), 'every movement has an alternatives array to index');
    eq(setCount(ex), expandSets(ex).length, 'and its count and its table say the same number');
  }
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
const demo = repeatSession([
  { t: T, exercise: 'Pull-up', sets: [[10, 0], [8, 20]], bw: [true, true] },
  { t: T, exercise: 'Run', cardio: { mins: 30, dist: 5, unit: 'km' } },
], CAT);
console.log(`repeatSession: ok (${demo.exercises.length} movement offered, ${demo.bodyweightSets} bodyweight sets carried with no load, ${demo.skipped.length} reported rather than dropped)`);
