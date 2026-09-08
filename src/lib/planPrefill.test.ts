import {
  planOffer, prefillCount, prefillDay, prefillExercise, prefillLine, prefillTally, targetLine,
} from './planPrefill';
import type { Program, ProgramDay, ProgramExercise } from './programs';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};

const E = (name: string, sets: number, reps: string, extra: Partial<ProgramExercise> = {}): ProgramExercise => ({
  key: name.toLowerCase().replace(/\s+/g, '-'), name, group: 'Legs', sets, reps, alternatives: [], ...extra,
});
const day = (name: string, focus: string, exercises: ProgramExercise[]): ProgramDay => ({
  day: name, focus, exercises,
});
const program = (days: ProgramDay[]): Program => ({ title: 'Block', focus: [], note: '', days });

/* ── the rule this file exists for ─────────────────────────────────────────
 *
 * A plan's target is not a performed set. `parseInt('30s')` is 30 and that is
 * the failure that SUCCEEDS — a thirty-second plank written into somebody's
 * record as thirty repetitions, by their coach, where they cannot delete it.
 */
eq(prefillExercise(E('Plank', 3, '30s')).sets[0],
  { target: '30s', kind: 'hold', reps: null, loadKg: null },
  'a hold in seconds seeds NO reps — parseInt("30s") is thirty and this screen writes repetitions');
eq(prefillExercise(E('Side Plank', 1, '45 sec', { loadKg: 10 })).sets[0],
  { target: '45 sec', kind: 'hold', reps: null, loadKg: 10 },
  'and the load on the belt still comes across, because a load is already a number');
eq(prefillExercise(E('Back Squat', 1, '6-8', { loadKg: 60 })).sets[0],
  { target: '6-8', kind: 'open', reps: null, loadKg: 60 },
  'a range is carried as the coach wrote it and seeds nothing — not six, not seven, not eight');
eq(prefillExercise(E('Pull-up', 1, 'AMRAP')).sets[0],
  { target: 'AMRAP', kind: 'open', reps: null, loadKg: null },
  'nor does AMRAP become a number');
eq(prefillExercise(E('Lunge', 1, '10/leg')).sets[0],
  { target: '10/leg', kind: 'open', reps: null, loadKg: null },
  'nor does "10/leg", which parseInt reads as ten and which is twenty');
eq(prefillExercise(E('Row', 1, '  ')).sets[0],
  { target: null, kind: 'unstated', reps: null, loadKg: null },
  'a blank prescription is unstated rather than an empty target');
eq(prefillExercise(E('Bench Press', 1, '10', { loadKg: 60 })).sets[0],
  { target: '10', kind: 'count', reps: 10, loadKg: 60 },
  'a single whole number is the one thing definite enough to seed');
eq(prefillExercise(E('Push-up', 1, '12')).sets[0],
  { target: '12', kind: 'count', reps: 12, loadKg: null },
  'and an unprescribed load stays NULL — a stored 0 and a load nobody wrote cannot be told apart later');
eq(prefillExercise(E('Ghost', 1, '10', { loadKg: Number.NaN })).sets[0].loadKg, null,
  'a load that is not a finite number is no load, not a zero');

// The set COUNT comes across, and a coach's per-set table comes across as the
// rows they wrote rather than as copies of the first one.
eq(prefillExercise(E('Back Squat', 3, '5', { loadKg: 60 })).sets.length, 3, 'three sets are three rows');
eq(prefillExercise(E('Back Squat', 3, '5', {
  loadKg: 60,
  setRows: [{ reps: '5', loadKg: 60 }, { reps: '5', loadKg: 65 }, { reps: '3', loadKg: 70 }],
})).sets.map((s) => [s.reps, s.loadKg]),
[[5, 60], [5, 65], [3, 70]],
'a ramp arrives as three different rows, through the one reader that owns set rows');
eq(prefillExercise(E('Nothing', 0, '10')).sets, [], 'a movement with no sets has no rows');

// ── the day ───────────────────────────────────────────────────────────────
const push = day('Mon', 'Push', [E('Bench Press', 3, '8', { loadKg: 60 }), E('Plank', 2, '30s')]);
eq(prefillDay(push).exercises.map((e) => e.name), ['Bench Press', 'Plank'],
  'the day comes across in the coach’s own order, under the English identity that gets written');
eq(prefillCount(push), 2, 'and the number on the chip is that same count');
const nameless = day('Tue', 'Pull', [E('', 3, '8'), E('Barbell Row', 3, '8')]);
eq(prefillDay(nameless).exercises.length, 1, 'a movement with no name cannot be logged against and is dropped');
eq(prefillDay(nameless).dropped, 1, 'and is COUNTED, because a day that is quietly short is a session logged wrong');
eq(prefillDay(null).exercises, [], 'no day is no rows');
eq(prefillDay({ day: 'Wed', focus: 'Legs', exercises: null as unknown as ProgramExercise[] }).exercises, [],
  'and a day whose exercises are not an array is read as none rather than thrown over');

// ── what the coach is told about the blanks ───────────────────────────────
const tally = prefillTally(prefillDay(push));
eq(tally, { exercises: 2, sets: 5, seeded: 3, open: 0, holds: 2 }, 'every row is accounted for by kind');
ok(prefillLine(prefillDay(push)).includes('2 exercises and 5 sets'),
  'the line says what landed');
ok(prefillLine(prefillDay(push)).includes('holds written in seconds'),
  'and names the holds, so a blank box is never read as the screen having failed');
ok(prefillLine(prefillDay(day('Mon', 'Push', [E('Squat', 2, '6-8')]))).includes('not state as a single number'),
  'a range is accounted for in its own words');
ok(prefillLine(prefillDay(nameless)).includes('no name'), 'and so is a movement that had to be dropped');
ok(prefillLine(prefillDay(day('Mon', 'Push', []))).includes('nothing to put on the sheet'),
  'an empty day says so rather than claiming a count of zero exercises landed');
eq(targetLine('6-8'), 'Plan: 6-8', 'the caption is the coach’s own words');
eq(targetLine(null), null,
  'and where they wrote nothing there is no caption, rather than "Plan:" with a hole after it');
eq(targetLine('   '), null, 'nor for a row that is only whitespace');

/* ── four reasons there is nothing to offer, and they are four sentences ──
 *
 * The distinction this whole codebase turns on. A coach told "they have no
 * programme" when the truth is "the read did not land" writes the session from
 * memory and stops trusting the screen.
 */
const MON = '2026-09-07'; // a Monday
const TUE = '2026-09-08';
const one = program([push]);

const loading = planOffer(null, null, MON, 'loading', 'Ana');
const failed = planOffer(null, null, MON, 'error', 'Ana');
const truncated = planOffer(null, null, MON, 'partial', 'Ana');
const unassigned = planOffer(null, null, MON, 'ready', 'Ana');
const emptyProg = planOffer(program([day('Mon', 'Push', [])]), null, MON, 'ready', 'Ana');
eq([loading.state, failed.state, truncated.state, unassigned.state, emptyProg.state],
  ['loading', 'unreadable', 'unreadable', 'none', 'empty'],
  'still reading, could not read, none assigned and nothing written are four different answers');
ok(new Set([loading.line, failed.line, unassigned.line, emptyProg.line]).size === 4,
  'and four different sentences — the whole point is that a coach can tell them apart');
ok(!loading.line.includes('not assigned') && !failed.line.includes('not assigned'),
  'neither a read in flight nor a read that failed may say the client has no programme');
ok(failed.line.includes('not a client without a programme'),
  'the failed read says what it is instead');
ok(unassigned.line.includes('You have not assigned Ana a programme'),
  'and only a read that landed says the client has none');
eq([loading.days.length, failed.days.length, unassigned.days.length, emptyProg.days.length], [0, 0, 0, 0],
  'none of the four offers a day to load');
eq(emptyProg.state, 'empty', 'a programme whose day has no movements on it is empty, not a rest day');
ok(emptyProg.line.includes('no exercises written'), 'and says so in those words');

// ── and the day the coach picks ───────────────────────────────────────────
const ready = planOffer(one, null, MON, 'ready', 'Ana');
eq(ready.state, 'ready', 'a written programme is offered');
eq(ready.days.map((d) => [d.label, d.exercises, d.scheduled]), [['Mon · Push', 2, true]],
  'the chip carries what it would add and whether the date schedules it');
eq(ready.scheduledKey, '0:0', 'the scheduled day is named so the screen can pre-select it');
// A coach writing up the Friday session they ran on a Wednesday still gets the
// picker: the offer is the WEEK, not only the day the date happens to fall on.
const offDay = planOffer(one, null, TUE, 'ready', 'Ana');
eq(offDay.state, 'ready', 'a day the programme schedules nothing on still offers the week');
eq(offDay.scheduledKey, null, 'with nothing pre-selected');
ok(offDay.line.includes('schedules nothing on this day'), 'and says why nothing is chosen for them');
eq(offDay.days.length, 1, 'and the days of that week are all still there to pick from');

// Two days both called Push are two chips, because the key is the position.
const twice = planOffer(program([push, day('Thu', 'Push', [E('Incline Press', 3, '8')])]), null, MON, 'ready', 'Ana');
eq(twice.days.map((d) => d.key), ['0:0', '0:1'],
  'days are keyed by week and position, so two days with one name stay two days');
eq(twice.days.filter((d) => d.scheduled).length, 1, 'and exactly one of them is the scheduled one');

// A plan resolved from a read that did not land is offered WITH the caveat, not
// withheld: the programme is real, it is simply not known to be the newest.
const stale = planOffer(one, null, MON, 'error', 'Ana');
eq(stale.state, 'ready', 'a programme in hand under a failed read is still a programme');
ok((stale.caveat ?? '').length > 0, 'and carries the caveat saying it is the last copy this phone had');
eq(ready.caveat, null, 'while a confirmed read carries none');

// The week of a block is counted by the resolver that owns it — this file adds
// no second answer to which week a date falls in.
const block: Program = {
  ...program([push]),
  weeks: [
    { days: [push] },
    { days: [day('Mon', 'Deload', [E('Back Squat', 2, '5', { loadKg: 40 })])] },
  ],
};
const wk2 = planOffer(block, '2026-08-31', '2026-09-07', 'ready', 'Ana');
eq(wk2.days.map((d) => d.label), ['Mon · Deload'], 'the second week of a block is the week that is offered');
eq(wk2.days.map((d) => d.key), ['1:0'],
  'and its key names that week — a key of just the position would tell a coach who moved the date '
  + 'that a day of week two was already on the sheet');
ok((wk2.weekLabel ?? '').includes('2'), 'and the week is named, so the coach can see which one they are loading');
eq(ready.weekLabel, null, 'a one-week programme names no week, because there is nothing to count');

if (errors.length) { errors.forEach((e) => console.error('FAIL', e)); process.exit(1); }
console.log('planPrefill ok — the coach’s own session, offered back with the targets shown and no rep number invented');
