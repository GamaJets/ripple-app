// One movement followed through a record, and the five ways that goes wrong.
// Compile with tsc, run with node.
//
// Everything defended here is a figure or a sentence that would look completely
// ordinary on a screen while being false about somebody's training:
//
// 1. A day logged as four rows a second apart is ONE outing. The live record
//    holds exactly that — the same squat at 01:34:16.643, :17.677, :18.110 and
//    :18.427 — and read by timestamp it becomes four points on a progress chart
//    with three movements of nothing between them: a plateau drawn out of a
//    double tap.
//
// 2. A bodyweight day has NO top load and NO volume, not zero of either. The
//    movement in load across it is therefore unmeasurable rather than flat, and
//    "no change" is a different thing to tell somebody than "we cannot say".
//
// 3. A read that failed produces no trend, and a read that came back at the row
//    cap produces no count and no lifetime claim. "First on record" over a
//    prefix of an unknown set is a statement about training nobody read.
//
// 4. There is one answer to "are these the same movement" and it is
//    `exerciseSlug`. Bench-Press, bench press and BENCH PRESS are one lift.
//
// 5. Nothing in the module says which direction is good, and nothing gives a
//    movement of nothing a sign. Both are `deltaLabel`'s to decide, and the
//    last section proves the two compose.

import {
  exerciseOutings, exerciseIndex, matchExercises, exerciseTrend, readCoversRecord,
  type ExerciseOuting,
} from './exerciseHistory';
import type { BodyweightHistory } from './bodyweightSets';
import { est1RM } from './streaks';
import { deltaLabel, deltaSign, deltaMoved } from './deltaLabel';
import { liftDeltaIn, est1RMIn } from './units';
import type { WorkoutEntry } from './mockData';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** A local-noon timestamp for a day, so the day key is the day whatever the
 *  timezone — the suite runs under three of them (see `test:zones`). */
const at = (day: string, time = '12:00:00') => `${day}T${time}`;

const entry = (day: string, exercise: string, sets: [number, number][], time?: string): WorkoutEntry =>
  ({ t: at(day, time), exercise, sets });

/* ── 1 · a day is a day, however many times it was saved ──────────────────── */

// The live shape: one squat workout written as four rows under a second.
const doubleTapped: WorkoutEntry[] = [
  entry('2026-03-02', 'Back Squat', [[5, 100]], '01:34:16.643'),
  entry('2026-03-02', 'Back Squat', [[5, 100]], '01:34:17.677'),
  entry('2026-03-02', 'Back Squat', [[5, 100]], '01:34:18.110'),
  entry('2026-03-02', 'Back Squat', [[5, 100]], '01:34:18.427'),
];
const tapped = exerciseOutings(doubleTapped, 'Back Squat');
eq(tapped.length, 1, 'four rows a second apart on one day are one outing, not four');
eq(tapped[0].setCount, 4, 'and every set of them is kept — the outing is folded, not deduplicated');
eq(tapped[0].reps, 20, 'with the reps totalled across the rows');
eq(tapped[0].entryCount, 4,
  'and the day says how many entries it was folded from, because folding is not deduplicating — '
  + 'twelve sets of the same three is a true count of the record and an overstatement of the afternoon');

// The same folding under the ordinary version: sets logged, a walk, more sets.
const splitDay: WorkoutEntry[] = [
  entry('2026-03-02', 'Bench Press', [[8, 60], [8, 60]], '09:00:00'),
  entry('2026-03-02', 'Bench Press', [[6, 65]], '09:31:00'),
];
const split = exerciseOutings(splitDay, 'Bench Press');
eq(split.length, 1, 'sets logged twice in one day are one outing');
eq(split[0].setCount, 3, 'holding every set');
eq(split[0].topLoadKg, 65, 'and the heaviest load of the day, not of the first entry');
eq(split[0].at, at('2026-03-02', '09:31:00'), 'stamped with the newest moment of the day');
eq(split[0].entryCount, 2, 'and the ordinary two-goes day carries the same count of entries');

/* ── 2 · a bodyweight day is not a day of nothing ─────────────────────────── */

const chins: WorkoutEntry[] = [entry('2026-03-04', 'Pull-up', [[10, 0], [8, 0]])];
const chinOut = exerciseOutings(chins, 'Pull-up')[0];
eq(chinOut.volumeKg, null, 'a bodyweight outing has no tonnage — null, never a well-formed 0');
eq(chinOut.topLoadKg, null, 'and no top load');
eq(chinOut.topReps, null, 'so no reps at a top load either');
eq(chinOut.best1RMKg, null, 'and no estimated max, which would be an estimate off nothing');
eq(chinOut.setCount, 2, 'the sets themselves are real and counted');
eq(chinOut.bodyweightSets, 2, 'and named as the ones carrying no load');
eq(chinOut.reps, 18, 'with the reps counted, which is the whole record of a chin-up day');
eq(chinOut.sets[0][1], null, 'the load on a bodyweight set reads as absent rather than as 0 kg');
eq(chinOut.entryCount, 1, 'and a day logged once says one, so nothing is flagged that does not need it');

// A blank row somebody tabbed past is not a set of no reps.
const blanks = exerciseOutings([entry('2026-03-05', 'Row', [[0, 40], [10, 40]])], 'Row')[0];
eq(blanks.setCount, 1, 'a row with no reps is not a set');
eq(blanks.volumeKg, 400, 'and contributes nothing to the tonnage');

// An exercise logged with no sets at all leaves no outing to draw.
eq(exerciseOutings([{ t: at('2026-03-06'), exercise: 'Plank' }], 'Plank').length, 0,
  'a movement logged with nothing done to it produces no outing rather than an empty one');

/* ── 3 · the arithmetic is the app's own, in the app's own unit ───────────── */

const bench = exerciseOutings([entry('2026-03-07', 'Bench Press', [[8, 60], [5, 80], [3, 85]])], 'Bench Press')[0];
eq(bench.topLoadKg, 85, 'the top load is the heaviest touched');
eq(bench.topReps, 3, 'and the reps are the ones done at it');
eq(bench.volumeKg, 8 * 60 + 5 * 80 + 3 * 85, 'volume is Σ reps × load in kilograms');
eq(bench.best1RMKg, Math.max(est1RM(60, 8), est1RM(80, 5), est1RM(85, 3)),
  'and the estimated max is `est1RM` from src/lib/streaks.ts — the app has one 1RM formula and this is not a second');
eq(bench.bestSet?.loadKg, 85, 'the set behind the estimate is named, so no estimate stands on its own');
eq(bench.bestSet?.reps, 3, 'reps and all — 85 × 3 estimates higher than 80 × 5, and the screen prints the set that did it');

// Reps at the top load: the best of them, whichever order they were done in.
eq(exerciseOutings([entry('2026-03-08', 'Squat', [[3, 100], [5, 100]])], 'Squat')[0].topReps, 5,
  'the reps at the top load are the most achieved there');
eq(exerciseOutings([entry('2026-03-08', 'Squat', [[5, 100], [3, 100]])], 'Squat')[0].topReps, 5,
  'and the best of them, not the last of them');
eq(exerciseOutings([entry('2026-03-08', 'Squat', [[3, 100], [8, 60]])], 'Squat')[0].topReps, 3,
  'reps done at a LIGHTER load are not reps at the top load, however many of them there were');

// The two figures a mis-set threshold would quietly discard.
const single = exerciseOutings([entry('2026-03-09', 'Deadlift', [[1, 180]])], 'Deadlift')[0];
eq(single.setCount, 1, 'a single is a set — the only thing not counted is a row with no reps at all');
eq(single.best1RMKg, est1RM(180, 1), 'and it estimates a max like any other');
const light = exerciseOutings([entry('2026-03-09', 'Curl', [[10, 1]])], 'Curl')[0];
eq(light.topLoadKg, 1, 'a load of one kilogram is a load — only the absence of one is bodyweight');
eq(light.bodyweightSets, 0, 'so it is not counted as a set that carried nothing');

// A trail is one movement's, and not a log with the filter fallen off.
const twoLifts = [
  entry('2026-03-10', 'Squat', [[5, 100]]),
  entry('2026-03-10', 'Bench Press', [[5, 60]]),
];
const squatOnly = exerciseOutings(twoLifts, 'Squat')[0];
eq(exerciseOutings(twoLifts, 'Squat').length, 1, 'asking for one movement returns one movement');
eq(squatOnly.name, 'Squat', 'and it is the one that was asked for');
eq(squatOnly.setCount, 1, 'holding only its own sets');
eq(squatOnly.volumeKg, 500, 'so the day\'s other lifts are not quietly folded into its tonnage');

// A row with no timestamp at all belongs to no outing, dated or otherwise.
eq(exerciseOutings([{ t: '', exercise: 'Squat', sets: [[5, 100]] }], 'Squat').length, 0,
  'an entry with no timestamp produces no outing rather than an undated one');

/* ── 4 · one vocabulary, and it is exerciseSlug ───────────────────────────── */

const spellings: WorkoutEntry[] = [
  entry('2026-03-01', 'bench press', [[10, 50]]),
  entry('2026-03-03', 'Bench-Press', [[8, 55]]),
  entry('2026-03-05', 'BENCH PRESS', [[6, 60]]),
];
const spelled = exerciseOutings(spellings, 'Bench Press');
eq(spelled.length, 3, 'three spellings of one movement are one movement');
eq(spelled[0].name, 'BENCH PRESS', 'shown under the spelling most recently used');
eq(exerciseOutings(spellings, 'bench-press').length, 3, 'and the query is slugged the same way the record is');
eq(exerciseOutings(spellings, '   ').length, 0, 'a query that slugs to nothing matches nothing rather than everything');

const index = exerciseIndex([
  ...spellings,
  entry('2026-03-06', 'Leg Press', [[12, 200]]),
  entry('2026-02-01', 'Pull-up', [[10, 0]]),
]);
eq(index.length, 3, 'the index holds one row per movement');
eq(index[0].name, 'Leg Press', 'most recently trained first — an A–Z would put Ab Wheel above last night');
eq(index[0].days, 1, 'with the days it was done');
eq(index[1].days, 3, 'folded the same way the trail is');
eq(index[1].best1RMKg, est1RM(60, 6), 'the index carries the best estimated max across every outing of a movement');
eq(index[1].topLoadKg, 60, 'and the heaviest load ever touched');
eq(index[1].lastDay, '2026-03-05', 'and the day it was last done');
eq(index[1].lastAt, at('2026-03-05'), 'timestamped with the newest moment, not the oldest');
eq(index[2].best1RMKg, null, 'a bodyweight movement carries no estimated max in the index either');

// Two movements last done on the same day fall back to their names, so the
// order is settled rather than left to whatever the map happened to hold.
const sameDay = exerciseIndex([entry('2026-04-01', 'Squat', [[5, 100]]), entry('2026-04-01', 'Bench Press', [[5, 60]])]);
eq(sameDay[0].name, 'Bench Press', 'movements trained on the same day sort by name rather than by insertion order');

// The live record is the reason this case exists. One real client's 31 logged
// workouts are 15 cycles, 6 walks, 5 unnamed activities and one squat session
// saved four times — and `sets` is null on every one of the cardio rows. An
// index built only out of set-carrying movements would have answered a coach
// searching "cycling" with "nothing logged matches that", about somebody who
// cycles four times a week.
const cardio = exerciseIndex([
  { t: at('2026-08-25'), exercise: 'Cycling' },
  { t: at('2026-08-27'), exercise: 'cycling' },
  { t: at('2026-08-29'), exercise: 'Cycling' },
  entry('2026-08-30', 'Squats Each S', [[3, 11.5], [15, 11.5], [25, 11.5]]),
]);
eq(cardio.length, 2, 'a movement logged without sets is still a movement somebody did');
eq(matchExercises(cardio, 'cycling').length, 1, 'and is still findable by name');
eq(matchExercises(cardio, 'cycling')[0].days, 3, 'with the days it was actually done');
eq(matchExercises(cardio, 'cycling')[0].daysWithSets, 0,
  'and a separate figure saying none of them carried sets, so no screen has to guess');
eq(matchExercises(cardio, 'cycling')[0].best1RMKg, null, 'an hour on a bike estimates no 1RM');
eq(exerciseOutings([{ t: at('2026-08-25'), exercise: 'Cycling' }], 'Cycling').length, 0,
  'while the reps-and-loads trail behind it is honestly empty rather than padded with nothing');
eq(matchExercises(cardio, 'squats')[0].daysWithSets, 1, 'a lift that did carry sets says so on the same field');

eq(matchExercises(index, 'bench').length, 1, 'a search narrows to the movement asked for');
eq(matchExercises(index, 'press bench')[0]?.name, 'BENCH PRESS', 'word order is not part of the question');
eq(matchExercises(index, 'bench press').length, 1,
  'and every word must appear — "bench press" does not return every leg press in the book');
eq(matchExercises(index, '').length, 3, 'an empty box is not a filter');
eq(matchExercises(index, 'deadlift').length, 0, 'a movement nobody has done returns nothing rather than everything');

/* ── 5 · what a failed and a truncated read may say ───────────────────────── */

const trail = exerciseOutings([
  entry('2026-03-01', 'Bench Press', [[10, 50]]),
  entry('2026-03-08', 'Bench Press', [[8, 55]]),
  entry('2026-03-15', 'Bench Press', [[8, 60]]),
], 'Bench Press');

eq(exerciseTrend(null, 'ready').state, 'unreadable', 'a null read is unreadable, whatever the status says');
eq(exerciseTrend(trail, 'error').state, 'unreadable', 'and an error is unreadable even holding rows');
eq(exerciseTrend([], 'loading').state, 'unreadable',
  'a question nobody has finished asking is not an answer of "never done"');
eq(exerciseTrend([], 'ready').state, 'none', 'an empty read that landed IS "never done", and says so');
eq(exerciseTrend([], 'ready').outingCount, 0, 'which is a real count of nought, not a dash');

const whole = exerciseTrend(trail, 'ready');
eq(whole.state, 'some', 'a read with rows in it has some');
eq(whole.outingCount, 3, 'counted, because the read was whole');
eq(whole.whole, true, 'and the screen is told nothing fell off the end of it');
eq(whole.latest?.day, '2026-03-15', 'the newest outing is the newest');
eq(whole.best?.day, '2026-03-15', 'and the best is the best');

// Two days at exactly the same estimated max: the most recent one is named,
// because "she is still there" is what a coach asked, and "she was there in
// March" reads as a lift she has since lost.
const tied = exerciseTrend(exerciseOutings([
  entry('2026-03-01', 'Squat', [[5, 100]]),
  entry('2026-03-15', 'Squat', [[5, 100]]),
], 'Squat'), 'ready');
eq(tied.best?.day, '2026-03-15', 'a best matched again is credited to the day it was matched');

const partial = exerciseTrend(trail, 'partial');
eq(partial.state, 'some', 'a truncated read still has real outings in it');
eq(partial.outings.length, 3, 'which are all listed — a prefix of real days is real days');
eq(partial.outingCount, null, 'but never counted: a subtotal wearing a total\'s label is worse than a dash');
eq(partial.whole, false, 'and the screen is told it may not say "first on record"');
eq(partial.latest?.day, '2026-03-15',
  'the newest is still safe to state — the read is ordered newest first, so truncation cannot remove it');

/* ── 5b · a read that was not cut, and was not the record either ───────────
 *
 * The defect `whole` could not see. app/(trainer)/client-training.tsx narrows
 * its query to twelve weeks IN ORDER to get under PostgREST's ceiling, so the
 * answer comes back short of the cap and the status is 'ready' — correctly,
 * because nothing was truncated. The coach then followed the screen's own
 * instruction, tapped 12 Weeks, and read "Best Est. 1RM 150 kg", "Since the
 * First Day on Record" and "20 of the 34 movements on record" about a client
 * who had benched 165 kg in March, with no truncation flag anywhere — because
 * there was nothing to flag. The read was complete. It was not the record.
 *
 * So `whole` and `coversRecord` are separate answers and a windowed read is
 * the first without the second. */

const windowed = exerciseTrend(trail, { status: 'ready', windowDays: 84 });
eq(windowed.whole, true, 'a windowed read is genuinely UNCUT: nothing fell off the end of it');
eq(windowed.outingCount, 3, 'so the days it returned may be counted');
eq(windowed.coversRecord, false, 'but it does not cover the record, and nothing may be worded as a lifetime');
eq(windowed.recordOutingCount, null,
  'so the figure a screen prints as "N days" beside the movement is withheld rather than quoting the window at the record');
eq(windowed.best?.day, '2026-03-15',
  'the best in the window is still named — it is a real day, it is simply not "the best on record"');

const everything = exerciseTrend(trail, { status: 'ready', windowDays: null });
eq(everything.coversRecord, true, 'a read that asked for everything and came back uncut IS the record');
eq(everything.recordOutingCount, 3, 'and its count may be printed as one');

eq(exerciseTrend(trail, { status: 'partial', windowDays: null }).coversRecord, false,
  'a truncated read of everything is still not everything: both halves have to hold');
eq(exerciseTrend([], { status: 'ready', windowDays: 84 }).recordOutingCount, null,
  'and an empty window is not "never done" — the client may simply not have done it since June');
eq(exerciseTrend([], { status: 'ready', windowDays: 84 }).outingCount, 0,
  'though nought days in the window is a true count of the window');

// Silence fails closed. A caller that passes a bare status has said nothing
// about its window, and a coverage claim nobody made is not a coverage claim —
// defaulting the other way is exactly the assumption that put twelve weeks
// under the words "on record".
eq(whole.coversRecord, false, 'a bare LoadStatus says nothing about the window, so it licenses nothing');
eq(readCoversRecord('ready'), false, 'not even the healthiest one');
eq(readCoversRecord(undefined), false, 'and neither does saying nothing at all');
eq(readCoversRecord({ status: 'ready', windowDays: null }), true, 'only both halves together do');
eq(readCoversRecord({ status: 'ready', windowDays: 0 }), false,
  'a window of zero days is still a window — it is not the same value as "everything"');

// The same distinction on the search index, whose `days` had no flag beside it
// at all while `outingCount` had one: under a twelve-week read a movement
// somebody has done for three years listed "84 days" as a fact about them.
{
  const log = [
    entry('2026-03-01', 'Bench Press', [[10, 50]]),
    entry('2026-03-08', 'Bench Press', [[8, 55]]),
  ];
  const cut = exerciseIndex(log, [], 'partial')[0];
  eq(cut.days, 2, 'the count of what was READ is always available and always true of the read');
  eq(cut.recordDays, null, 'and the same figure offered as a fact about the person is withheld');
  eq(exerciseIndex(log, [], { status: 'ready', windowDays: 84 })[0].recordDays, null,
    'a whole read of a window is not a fact about the record either');
  eq(exerciseIndex(log, [], { status: 'ready', windowDays: null })[0].recordDays, 2,
    'only a whole read of everything is');
  eq(exerciseIndex(log)[0].recordDays, null, 'and a caller that says nothing gets nothing');
  eq(exerciseIndex(log)[0].days, 2, 'while still getting the honest figure about its own read');
}

/* ── 6 · movement is a number of kilograms, and never a verdict ───────────── */

eq(whole.sinceLast.from?.day, '2026-03-08', 'the movement names the outing it is measured from');
eq(whole.sinceLast.topLoadKg, 5, 'and is the difference in kilograms, which is what the table stores');
eq(whole.sinceFirst.from?.day, '2026-03-01', 'the long movement measures from the earliest outing read');
eq(whole.sinceFirst.topLoadKg, 10, 'over the whole trail');
eq(whole.sinceFirst.est1RMKg, est1RM(60, 8) - est1RM(50, 10), 'estimated maxes move by their own difference');
eq(whole.sinceLast.reps, 0, 'a count that has not moved is 0 here — the module states the fact and no more');

const alone = exerciseTrend(exerciseOutings([entry('2026-03-01', 'Row', [[10, 40]])], 'Row'), 'ready');
eq(alone.sinceLast.from, null, 'a first-ever outing has nothing to be measured against');
eq(alone.sinceLast.topLoadKg, null, 'so its movement is absent rather than zero');
eq(alone.sinceFirst.from, null, 'and it is not measured against itself, which would be a movement of nothing');

// A bodyweight day between two loaded ones: the load movement across it is
// unmeasurable, and that must not collapse to "no change".
const mixed = exerciseTrend(exerciseOutings([
  entry('2026-03-01', 'Dip', [[8, 20]]),
  entry('2026-03-08', 'Dip', [[12, 0]]),
], 'Dip'), 'ready');
eq(mixed.sinceLast.topLoadKg, null, 'a load that cannot be compared is null, not 0');
eq(mixed.sinceLast.reps, 4, 'while the reps, which CAN be compared, still are');
ok(deltaLabel(mixed.sinceLast.topLoadKg, { since: '1 Mar', unit: 'kg' }) === 'No earlier reading',
  'and null reads as "no earlier reading" rather than as a flat line');

// The composition the module exists to make possible: kilograms in, the
// reader's unit and the wording out, decided by deltaLabel and nobody else.
const flat = exerciseTrend(exerciseOutings([
  entry('2026-03-01', 'Squat', [[5, 100]]),
  entry('2026-03-08', 'Squat', [[5, 100]]),
], 'Squat'), 'ready');
eq(flat.sinceLast.topLoadKg, 0, 'a lift that held is a movement of exactly nothing');
eq(deltaSign(flat.sinceLast.topLoadKg), '', 'which carries no sign');
eq(deltaMoved(flat.sinceLast.topLoadKg), false, 'and did not move');
eq(deltaLabel(liftDeltaIn(flat.sinceLast.topLoadKg, 'lb'), { since: '1 Mar', unit: 'lb' }), 'No change since 1 Mar',
  'so a member on a fat-loss block whose bench held is told it held, in their own unit, with no arrow on it');

// The span is converted once, at the boundary, never the two ends separately.
eq(liftDeltaIn(whole.sinceFirst.topLoadKg, 'lb'), 22, '10 kg reads as 22 lb as a span, at the half-pound the plates justify');
eq(est1RMIn(whole.sinceFirst.est1RMKg, 'kg'), est1RM(60, 8) - est1RM(50, 10),
  'and an estimated max keeps the whole-kilogram grain it was derived at');

/* ── 7 · a date that will not parse invents no day ────────────────────────── */

const broken = exerciseOutings([
  entry('2026-03-01', 'Curl', [[10, 15]]),
  { t: 'not a date', exercise: 'Curl', sets: [[10, 20]] },
], 'Curl');
eq(broken.length, 2, 'an unreadable timestamp keeps its outing — the sets in it are real');
eq(broken[1].day, null, 'with no day, rather than being filed under today');
eq(broken[0].day, '2026-03-01', 'and it sorts after every outing that does have one');

// Three, so the comparator is exercised from both sides: a movement with no
// readable date must sink whichever end of the list it started at.
const brokenIndex = exerciseIndex([
  entry('2020-01-01', 'Row', [[10, 40]]),
  { t: 'not a date', exercise: 'Curl', sets: [[10, 20]] },
  entry('2021-01-01', 'Press', [[10, 30]]),
]);
eq(brokenIndex[0].name, 'Press', 'the most recently trained movement leads');
eq(brokenIndex[1].name, 'Row', 'then the older one');
eq(brokenIndex[2].name, 'Curl', 'and a movement with no readable date anywhere sorts last in a list headed "most recent"');
eq(brokenIndex[2].lastDay, null, 'admitting it has no last day rather than borrowing one');

/* ── 8 · the outings a screen draws are the ones it was given ─────────────── */

const listed: ExerciseOuting[] = whole.outings;
ok(listed.every((o, i) => i === 0 || (listed[i - 1].day ?? '') >= (o.day ?? '')),
  'outings come back newest first, stated here rather than inherited from a query in a file this does not own');

declare const process: { exit(code: number): void };
console.log(errors.length ? 'EXERCISE HISTORY FAILURES:\n' + errors.join('\n') : 'ALL EXERCISE HISTORY TESTS PASSED');
/* ── 6 · a bodyweight day IS priced, once there is a body to price it with ──
 *
 * This module was left unconverted when `bw` landed, and the result was one
 * movement reading two ways off the same rows: the Records board priced a
 * pull-up at the member's weight on the day, and this trail showed the same
 * set with no load, no volume and no estimate. A coach and a client standing
 * next to each other, looking at the same lift on two screens.
 */
{
  const HIST: BodyweightHistory = [
    { t: at('2026-01-10'), v: 96 },
    { t: at('2026-05-04'), v: 88 },
  ];
  const chin: WorkoutEntry = { t: at('2026-05-10'), exercise: 'Pull-up', sets: [[10, 0], [8, 20]], bw: [true, true] };

  const unweighed = exerciseOutings([chin], 'Pull-up')[0];
  eq(unweighed.volumeKg, null, 'with no weight on record a bodyweight day still has no tonnage');
  eq(unweighed.unpricedSets, 2, 'and says how many sets are not in the figure rather than counting them as nought');

  const priced = exerciseOutings([chin], 'Pull-up', HIST)[0];
  eq(priced.volumeKg, 10 * 88 + 8 * 108, 'the sets are priced at the body that did them, plus the belt');
  eq(priced.topLoadKg, 108, 'the belted set is the heaviest thing lifted, not the 20 kg on it');
  eq(priced.unpricedSets, 0, 'nothing is missing from the total');
  eq(priced.bodyweightSets, 2, 'and both are still named as the bodyweight sets they were');
  ok(priced.best1RMKg != null, 'a calisthenics day now carries an estimated max, as the Records board already did');

  // The weight ON OR BEFORE the day, never after. A January set is not priced
  // at May's body, or every chart of the past would move whenever somebody
  // steps on a scale.
  const january = exerciseOutings([{ t: at('2026-02-01'), exercise: 'Pull-up', sets: [[10, 0]], bw: [true] }], 'Pull-up', HIST)[0];
  eq(january.volumeKg, 960, 'a February set is priced at January\'s weigh-in, which is the last one before it');
}

if (errors.length) process.exit(1);
