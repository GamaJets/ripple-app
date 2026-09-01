// A hold is a hold, and it is never forty-five of anything.
// Compile with tsc, run with node.
//
// The defect this suite is written against is the app refusing its own
// prescription. `buildProgram` writes '45 sec' planks and '30 sec/side' side
// planks; the isometric set method's blurb says "the reps column is seconds";
// and both log paths refused anything that was not a positive whole number of
// reps. What people typed instead was 45 into a reps box, and from that moment
// the record says they performed forty-five plank repetitions.
//
// Every block below is one way that could come back:
//
//   THE FLAG        a hold is testimony, never inferred from a big number
//   READING ONE     what a prescription is asking for, and what a member typed
//   NOT REPS        holds are out of every rep count and every rep record
//   NOT TONNAGE     seconds × kilograms is not a mass moved
//   NOT A 1RM       Epley over a stopwatch is not a strength figure
//   THE HOLD BOARD  what a hold IS worth, stated in its own units
//   ROUND TRIP      the flag survives the trip to a database row
import {
  isTimedSet, hasTimedSet, prescribedSeconds, isTimedPrescription, readHold,
  holdLabel, timedSetLabel, entryHoldSeconds, holdRecords, MAX_HOLD_SECONDS,
} from './timedSets';
import { entryTonnage, repRecords, type BodyweightHistory } from './bodyweightSets';
import { personalRecords, weekStats } from './streaks';
import { entryToRow, rowToEntry, PERSISTED_FIELDS } from './workoutRow';
import { exerciseOutings } from './exerciseHistory';
import type { WorkoutEntry } from './mockData';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** Local midday, so every assertion means the same thing in the three
 *  timezones `npm run test:zones` runs this under. */
const at = (day: string, hour = 12) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour, 0, 0, 0).toISOString();
};

const HISTORY: BodyweightHistory = [{ t: at('2026-01-10'), v: 80 }];

/* ── THE FLAG ─────────────────────────────────────────────────────────────
 *
 * A hold is said, not guessed. A big first number is not evidence: 'AMRAP 100'
 * is a hundred reps and a set of 45 push-ups is 45 push-ups.
 */
{
  const guessed: WorkoutEntry = { t: at('2026-06-01'), exercise: 'Push-up', sets: [[45, 0]] };
  eq(isTimedSet(guessed, 0), false, 'a large rep count is not a hold — 45 push-ups are 45 push-ups');
  eq(hasTimedSet(guessed), false, 'and an entry with no flag has no holds in it');

  const said: WorkoutEntry = { t: at('2026-06-01'), exercise: 'Plank', sets: [[45, 0]], timed: [true] };
  eq(isTimedSet(said, 0), true, 'a hold is a hold once the person has said so');
  eq(hasTimedSet(said), true, 'and the entry knows it holds one');

  const mixed: WorkoutEntry = { t: at('2026-06-01'), exercise: 'Ab Circuit', sets: [[12, 0], [40, 0]], timed: [false, true] };
  eq(isTimedSet(mixed, 0), false, 'the flag is per set, not per exercise');
  eq(isTimedSet(mixed, 1), true, 'so twelve crunches and a forty-second hold are one entry');
  eq(isTimedSet(mixed, 5), false, 'a set past the end of the flags is not a hold');
}

/* ── READING ONE ──────────────────────────────────────────────────────────
 *
 * The prescription is prose, because that is what three years of stored
 * programmes are and what a coach types today.
 */
{
  eq(prescribedSeconds('45 sec'), 45, "the app's own plank prescription reads as forty-five seconds");
  eq(prescribedSeconds('30 sec/side'), 30, 'and its side plank as thirty');
  eq(prescribedSeconds('90s'), 90, 'the short spelling counts');
  eq(prescribedSeconds('1 min'), 60, 'so does a minute');
  eq(prescribedSeconds('1 min 30'), 90, 'and a minute with seconds after it is ninety, not thirty');
  eq(prescribedSeconds('2 min hold'), 120, 'words after the figure do not stop it being read');
  eq(prescribedSeconds('30-45 sec'), 30,
    'a range takes the first figure — the one that has to be reached — because seeding the top of it asks somebody to fail');
  eq(prescribedSeconds('12'), null, 'a bare number is reps and stays reps');
  eq(prescribedSeconds('8-10'), null, 'and so is a bare rep range');
  eq(prescribedSeconds(''), null, 'nothing asks for nothing');
  eq(prescribedSeconds(undefined), null, 'and an absent prescription is not a hold');
  eq(isTimedPrescription('45 sec'), true, 'the predicate agrees with the parser');
  eq(isTimedPrescription('10'), false, 'in both directions');

  // What a member types, which is a different problem: it must be refused
  // rather than coerced, exactly as `readLift` refuses a mistyped load.
  const good = readHold('45');
  ok(good.ok && good.secs === 45, 'a typed 45 is forty-five seconds');
  const clock = readHold('1:30');
  ok(clock.ok && clock.secs === 90, 'and 1:30 is ninety, because that is how anybody reads a clock');
  ok(!readHold('').ok, 'an empty box is refused rather than logged as a hold of nothing');
  ok(!readHold('4 5').ok, 'a fumbled figure is refused rather than parsed to 4');
  ok(!readHold('0').ok, 'a hold of no seconds is not a hold');
  ok(!readHold(String(MAX_HOLD_SECONDS + 1)).ok, 'and 4500 for 45 is refused with a reason rather than recorded');
  const refused = readHold('abc');
  ok(!refused.ok && /seconds/i.test(refused.reason), 'and the refusal says what to type instead');
}

/* ── NOT REPS ─────────────────────────────────────────────────────────────
 *
 * The whole point. A hold is out of every rep total and every rep record,
 * because 45 seconds is not 45 of anything.
 */
{
  const plank: WorkoutEntry = { t: at('2026-06-02'), exercise: 'Plank', sets: [[45, 0], [40, 0]], timed: [true, true], bw: [true, true] };
  const pullup: WorkoutEntry = { t: at('2026-06-02'), exercise: 'Pull-up', sets: [[12, 0]], bw: [true] };

  const reps = repRecords([plank, pullup]);
  eq(reps.length, 1, 'a plank does not appear on the reps board at all');
  eq(reps[0].exercise, 'Pull-up', 'and the twelve pull-ups are not outranked by a forty-five second hold');

  const outing = exerciseOutings([plank], 'Plank', HISTORY)[0];
  eq(outing.reps, 0, 'the day has no reps in it, because none were done');
  eq(outing.holdSeconds, 85, 'and eighty-five seconds of holding, which is the record of it');
  eq(outing.setCount, 2, 'both sets happened and both are counted as sets');
  eq(outing.timedSets, 2, 'and the outing says how many of them were holds');
  eq(outing.sets.length, 0, 'no held set is in the repped list, where a screen would print "45 ×"');
  eq(outing.holds.length, 2, 'they are in the holds list instead');
}

/* ── NOT TONNAGE ──────────────────────────────────────────────────────────
 *
 * A plate held for forty-five seconds is not four hundred and fifty
 * kilograms, and no total in this product may say it is.
 */
{
  const weighted: WorkoutEntry = { t: at('2026-06-03'), exercise: 'Plank', sets: [[45, 10]], timed: [true] };
  const tonn = entryTonnage(weighted, HISTORY);
  eq(tonn.kg, 0, '45 seconds under 10 kg contributes no tonnage — seconds times kilograms is not a mass');
  eq(tonn.unknownSets, 0,
    'and it is not counted as work the total could not price either: it is work the total is not about');

  const squats: WorkoutEntry = { t: at('2026-06-03'), exercise: 'Back Squat', sets: [[5, 100]] };
  const week = weekStats([weighted, squats], Date.parse(at('2026-06-04')), HISTORY);
  eq(week.volumeKg, 500, "the week's tonnage is the squats and nothing else");
  eq(week.unpricedSets, 0, 'with nothing reported as missing from it');
}

/* ── NOT A 1RM ────────────────────────────────────────────────────────────
 *
 * Epley takes reps. Handed seconds it returns a strength figure computed from
 * a stopwatch, which would put a plank at the top of a records board.
 */
{
  const held: WorkoutEntry = { t: at('2026-06-04'), exercise: 'Plank', sets: [[120, 20]], timed: [true] };
  const bench: WorkoutEntry = { t: at('2026-06-04'), exercise: 'Bench Press', sets: [[5, 80]] };
  const prs = personalRecords([held, bench], HISTORY);
  eq(prs.length, 1, 'a hold sets no estimated one-rep max');
  eq(prs[0].exercise, 'Bench Press', 'so the bench is the record and a two-minute plank is not an 100 kg lift');

  const trail = exerciseOutings([held], 'Plank', HISTORY)[0];
  eq(trail.best1RMKg, null, 'and the movement trail has no estimate for it either');
  eq(trail.volumeKg, null, 'nor a tonnage — null, never a well-formed 0');
  eq(trail.topLoadKg, null, 'and no top load, which would be a load nobody repped');
}

/* ── THE HOLD BOARD ───────────────────────────────────────────────────────
 *
 * What a hold IS worth. Reps at bodyweight got its own board for the same
 * reason: the honest record of work that cannot be priced is the work.
 */
{
  const log: WorkoutEntry[] = [
    { t: at('2026-05-01'), exercise: 'Plank', sets: [[60, 0]], timed: [true], bw: [true] },
    { t: at('2026-05-08'), exercise: 'Plank', sets: [[60, 10]], timed: [true], bw: [true] },
    { t: at('2026-05-15'), exercise: 'Plank', sets: [[90, 0]], timed: [true], bw: [true] },
    { t: at('2026-05-15'), exercise: 'Wall Sit', sets: [[45, 0]], timed: [true], bw: [true] },
    { t: at('2026-05-15'), exercise: 'Pull-up', sets: [[12, 0]], bw: [true] },
  ];
  const board = holdRecords(log);
  eq(board.length, 2, 'one row per movement that was held, and nothing that was not');
  eq(board[0].exercise, 'Plank', 'longest first');
  eq(board[0].secs, 90, 'and it is the longest hold, not the heaviest');
  eq(board[1].exercise, 'Wall Sit', 'with the shorter movement behind it');

  const tied = holdRecords([
    { t: at('2026-05-01'), exercise: 'Plank', sets: [[60, 0]], timed: [true] },
    { t: at('2026-05-02'), exercise: 'Plank', sets: [[60, 10]], timed: [true] },
  ]);
  eq(tied[0].loadKg, 10, 'a tie on seconds is broken by the load, so a belted hold is not shown as the same achievement');
  eq(tied.length, 1, 'and one movement keeps one row');

  eq(entryHoldSeconds(log[0]), 60, 'an entry knows how long it was held for');
  eq(entryHoldSeconds(log[4]), 0, 'and a set of pull-ups was held for no time at all, which is not a measurement');
}

/* ── HOW IT READS ─────────────────────────────────────────────────────────── */
{
  eq(holdLabel(45), '45 s', 'under a minute stays in seconds, which is how a hold is prescribed');
  eq(holdLabel(90), '1:30', 'and over one reads as a clock');
  eq(holdLabel(725), '12:05', 'with the seconds padded, so 12:05 is not shown as 12:5');
  eq(timedSetLabel(45, null, false), '45 s hold', 'a plain hold says what it was');
  eq(timedSetLabel(45, null, true), '45 s hold at bodyweight', 'a bodyweight hold says whose weight it was');
  eq(timedSetLabel(45, '10 kg', true), '45 s hold at bodyweight +10 kg',
    'and a belted one distinguishes the plate from the person, which is the whole of why both flags exist');
  eq(timedSetLabel(45, '10 kg', false), '45 s hold with 10 kg', 'while a held dumbbell is just held');
}

/* ── ROUND TRIP ───────────────────────────────────────────────────────────
 *
 * `feel` and `zones` were both read back on the way in and silently dropped on
 * the way out for months. A flag that changes what a stored number MEANS is
 * the worst possible field to lose that way: the row survives and says
 * forty-five reps.
 */
{
  ok(PERSISTED_FIELDS.includes('timed'), 'the flag is on the list of fields that must survive a trip to the database');
  const e: WorkoutEntry = { t: at('2026-06-05'), exercise: 'Plank', sets: [[45, 10]], timed: [true], bw: [true] };
  const back = rowToEntry(entryToRow('user-1', e));
  eq(JSON.stringify(back.timed), JSON.stringify([true]), 'and it survives one');
  const row = entryToRow('user-1', { t: at('2026-06-05'), exercise: 'Row', sets: [[10, 40]] }) as unknown as Record<string, unknown>;
  ok('timed' in row && row.timed === null,
    'an absent flag is sent as null rather than omitted, so an edit can clear it');
  eq(rowToEntry({ performed_at: at('2026-06-05'), exercise: 'Row', sets: [[10, 40]] }).timed, undefined,
    'and a row from before the column reads back as nobody having been asked');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('timedSets.test.ts ok');
