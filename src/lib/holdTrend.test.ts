// A hold's line, and the line it must never be drawn on. Compile with tsc, run
// with node.
//
// The bug this guards is in two halves and both are on app/(client)/trends.tsx:
//
//   1. `bestOf` fed `sets[i][0]` to `est1RM` without asking whether that number
//      was reps or seconds, so a plank charted as an estimated 1-rep max — a
//      strength figure computed from a stopwatch, on the same axis as a bench
//      press and big enough to flatten it.
//   2. There was no hold chart at all. The longest-hold BOARD on Records has
//      existed since holds were logged; a member whose dead hang went 20 s to
//      70 s across four months had one number and no line.
import { holdSeries, heldMovements, liftedMovements, hasLiftedSet, holdChangeSecs, holdLoadNote } from './holdTrend';
import type { WorkoutEntry } from './mockData';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** A logged entry. Local midday, so no test here is sitting on a date line by
 *  accident — the date-line case gets its own entry below, deliberately. */
const at = (day: string, exercise: string, sets: [number, number][], timed?: boolean[], bw?: boolean[]): WorkoutEntry =>
  ({ t: `${day}T12:00:00.000Z`, exercise, sets, timed, bw });

/* ── a hold has a line ─────────────────────────────────────────────────── */

const hangs: WorkoutEntry[] = [
  at('2026-05-04', 'dead hang', [[20, 0]], [true], [true]),
  at('2026-06-01', 'dead hang', [[35, 0]], [true], [true]),
  at('2026-07-06', 'dead hang', [[48, 0]], [true], [true]),
  at('2026-08-03', 'dead hang', [[70, 0]], [true], [true]),
];
eq(holdSeries(hangs, 'dead hang').map((p) => p.secs).join(','), '20,35,48,70',
  'four months of hangs draw four points, oldest first');
eq(holdChangeSecs(holdSeries(hangs, 'dead hang')), 50,
  'and the change across them is fifty seconds, which is the thing the board could never say');

/* ── the fold: a day is the unit, not a saved row ──────────────────────── */

// One afternoon, saved three times — which is what the runner does when
// somebody logs, walks away, and comes back. Three rows, one Tuesday.
const oneAfternoon: WorkoutEntry[] = [
  { t: '2026-05-04T09:00:00.000Z', exercise: 'plank', sets: [[40, 0]], timed: [true] },
  { t: '2026-05-04T09:20:00.000Z', exercise: 'plank', sets: [[55, 0]], timed: [true] },
  { t: '2026-05-04T09:35:00.000Z', exercise: 'plank', sets: [[45, 0]], timed: [true] },
];
eq(holdSeries(oneAfternoon, 'plank').length, 1, 'three saves on one day are one point, not a plateau drawn out of a double tap');
eq(holdSeries(oneAfternoon, 'plank')[0].secs, 55, "and that point is the day's longest hold");

// A tie on seconds is broken by what was on top, exactly as holdRecords does
// it. Settling it by whichever row was saved last would report a bare hold on a
// day that also had a loaded one.
const tiedDay: WorkoutEntry[] = [
  { t: '2026-05-04T09:00:00.000Z', exercise: 'plank', sets: [[60, 10]], timed: [true] },
  { t: '2026-05-04T09:30:00.000Z', exercise: 'plank', sets: [[60, 0]], timed: [true] },
];
eq(holdSeries(tiedDay, 'plank')[0].loadKg, 10, 'a tie on seconds is broken by the load, so a plate is never lost to a later bare set');

/* ── the axis: a day key, not an instant ───────────────────────────────── */

// An evening hold in a UTC+2 gym. `slice(0, 10)` on this instant reads
// '2026-05-04' in some zones and '2026-05-05' in others; the codebase's own
// `dayKeyOf` reads the local day, and the series is sorted on THAT — so the
// points never come out in a different order from the labels drawn under them.
const evening: WorkoutEntry[] = [
  { t: '2026-05-04T21:30:00.000Z', exercise: 'plank', sets: [[30, 0]], timed: [true] },
  { t: '2026-05-05T22:10:00.000Z', exercise: 'plank', sets: [[44, 0]], timed: [true] },
];
const eveningDays = holdSeries(evening, 'plank').map((p) => p.day);
ok(eveningDays.length === 2 && eveningDays[0] < eveningDays[1],
  'two evening holds land on two days and stay in order');
ok(holdSeries(evening, 'plank').every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.day)),
  'every point carries a bare calendar day, which is compared as a string and never parsed as UTC');

/* ── nothing is invented ───────────────────────────────────────────────── */

eq(holdSeries([{ t: 'not a date', exercise: 'plank', sets: [[45, 0]], timed: [true] }], 'plank').length, 0,
  'an unreadable timestamp is dropped rather than filed under today or plotted at the epoch');
eq(holdSeries([at('2026-05-04', 'plank', [[0, 0]], [true])], 'plank').length, 0,
  'a zero-second hold is not a measurement and does not become a point');
eq(holdSeries([at('2026-05-04', 'plank', [[Number.NaN, 0]], [true])], 'plank').length, 0,
  'nor is a hold whose seconds will not read as a number');
eq(holdChangeSecs(holdSeries([at('2026-05-04', 'plank', [[45, 0]], [true])], 'plank')), null,
  'one hold is not a direction of travel, so the change is null rather than zero');
eq(holdChangeSecs(holdSeries([at('2026-05-04', 'plank', [[60, 0]], [true]), at('2026-06-04', 'plank', [[60, 0]], [true])], 'plank')), 0,
  'but a hold that genuinely has not moved reports no change, which is a measurement and not a gap');

/* ── a hold and a lift never share an axis ─────────────────────────────── */

// The log that caused this. One entry, two sets: a 45-second plank and a set of
// eight squats. Under the old `bestOf` the plank's 45 went into est1RM as a rep
// count.
const mixedDay = at('2026-05-04', 'plank and squat', [[45, 10], [8, 100]], [true, false]);
eq(hasLiftedSet(mixedDay), true, 'an entry holding one hold and one lift has lifted something');
eq(hasLiftedSet(at('2026-05-04', 'plank', [[45, 0]], [true])), false,
  'an entry that is nothing but a hold has not, and must not reach a chart captioned "estimated 1-rep max"');
eq(hasLiftedSet(at('2026-05-04', 'plank', [[45, 0]])), true,
  'a set with no flag at all is an ordinary set — absent is not false-for-every-set, it is nobody was asked');

const mixedLog: WorkoutEntry[] = [
  at('2026-05-04', 'plank', [[45, 0]], [true]),
  at('2026-05-05', 'bench press', [[8, 80]]),
  at('2026-05-06', 'plank and squat', [[45, 10], [8, 100]], [true, false]),
];
eq(heldMovements(mixedLog).join(','), 'plank,plank and squat', 'the hold chart offers only movements that were held');
eq(liftedMovements(mixedLog).join(','), 'bench press,plank and squat', 'and the strength chart offers only movements that were lifted');
ok(!liftedMovements(mixedLog).includes('plank'), 'a plank is never a chip on the strength chart');
ok(!heldMovements(mixedLog).includes('bench press'), 'and a bench press is never a chip on the hold chart');

// A movement trained both ways appears on both, which is right: the held sets
// have a duration and the lifted ones have a load, and each chart draws the
// half it is about.
ok(heldMovements(mixedLog).includes('plank and squat') && liftedMovements(mixedLog).includes('plank and squat'),
  'a movement trained both ways is on both charts, each drawing the sets it is about');

// The hold series of that mixed movement contains the plank's 45 seconds and
// nothing of the squat — the 8 is repetitions and 8 seconds is not a hold
// anybody did.
const mixedSeries = holdSeries(mixedLog, 'plank and squat');
eq(mixedSeries.length, 1, 'the hold line of a mixed movement has one point that day');
eq(mixedSeries[0].secs, 45, 'and it is the seconds held, never the reps performed');

/* ── what the line does not say ────────────────────────────────────────── */

eq(holdLoadNote(holdSeries(hangs, 'dead hang')), null, 'a line of bare holds needs no caveat');
const sometimesLoaded = holdSeries([
  at('2026-05-04', 'plank', [[60, 0]], [true]),
  at('2026-06-04', 'plank', [[60, 10]], [true]),
  at('2026-07-04', 'plank', [[70, 0]], [true]),
], 'plank');
const note = holdLoadNote(sometimesLoaded);
ok(note != null && note.includes('1 of these days carried'), 'a line whose holds were not all bare says which of them carried weight');
ok(note != null && !/kg|lb/.test(note), 'and says it without a load figure, because a pure rule does not know the reader’s unit');
eq(holdLoadNote(holdSeries([
  at('2026-05-04', 'plank', [[60, 10]], [true]),
  at('2026-06-04', 'plank', [[70, 10]], [true]),
], 'plank')), null, 'a line that carried weight throughout is comparing like with like and needs no caveat either');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('holdTrend: ok — a hold has a line of its own, in seconds');
