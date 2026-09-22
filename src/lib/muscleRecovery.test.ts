// Time since a muscle was last trained — and the four sentences it is not.
// Compile with tsc, run with node.
//
//   THE VOCABULARY   no state of the body is claimed anywhere in the API
//   THE BOUNDS       exact, at most, at least, unknown — and they differ
//   NEVER "NEVER"    a 30-day window cannot say what happened in year one
//   THE CALENDAR     "yesterday" survives a 23-hour day and a 25-hour one
import {
  restMap, restFor, restLine, restBand, restMapNote,
  REST_MEANS, REST_BANDS, type MuscleRest,
} from './muscleRecovery';
import { muscleWorkBoard, type MuscledExercise } from './muscleWork';
import type { WorkoutEntry } from './mockData';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const at = (day: string, hour = 12) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour, 0, 0, 0).toISOString();
};
const NOW = Date.parse(at('2026-09-01', 9));
const MONTH = 30 * 86_400_000;

const CATALOGUE: MuscledExercise[] = [
  {
    id: 'back-squat', name: 'Back Squat',
    primaryMuscles: ['quadriceps'], secondaryMuscles: ['hamstrings'],
  },
  {
    id: 'bench-press', name: 'Bench Press',
    primaryMuscles: ['pectoralis major'], secondaryMuscles: ['triceps brachii'],
  },
  { id: 'calf-raise', name: 'Calf Raise', primaryMuscles: ['soleus'], secondaryMuscles: [] },
];

const board = (log: WorkoutEntry[], extra: Record<string, unknown> = {}) =>
  muscleWorkBoard(log, CATALOGUE, { sinceMs: NOW - MONTH, nowMs: NOW, ...extra });

const LOG: WorkoutEntry[] = [
  { t: at('2026-08-31', 19), exercise: 'Back Squat', sets: [[5, 100], [5, 100]] },
  { t: at('2026-08-25', 12), exercise: 'Bench Press', sets: [[5, 80]] },
];

/* ── THE VOCABULARY ───────────────────────────────────────────────────────
 *
 * The one assertion this whole module exists to refuse. Checked on the shape
 * rather than by reading the file, so a later hand adding `recovered: true`
 * fails here rather than in review.
 */
{
  const r = restFor(board(LOG), 'quadriceps');
  const keys = Object.keys(r).join(' ').toLowerCase();
  ok(!keys.includes('recover') && !keys.includes('ready') && !keys.includes('fresh')
    && !keys.includes('fatigue'),
    `nothing on a rest row claims a state of the body — keys are ${keys}`);
  ok(REST_MEANS.includes('not a measure of how recovered you are'),
    'and the sentence that goes with it says outright what it is not');
  ok(!restLine(r).toLowerCase().includes('recover'),
    'no line this module produces uses the word');
}

/* ── THE BOUNDS ───────────────────────────────────────────────────────────
 *
 * Four cases. A screen printing all four the same way states three things it
 * does not know.
 */
{
  // exact: a whole read, and a set was found.
  const b = board(LOG);
  const quads = restFor(b, 'quadriceps');
  eq(quads.bound, 'exact', 'a whole read with a hit is exact');
  eq(quads.days, 1, 'last night is one day ago');
  eq(quads.band, 'yesterday', 'which is yesterday');
  eq(restLine(quads), 'Trained yesterday.', 'and it is said plainly');
  eq(quads.lastDaySets, 2, 'with the sets of that day beside it');

  // atLeast: a whole read, no set in the window. The gap is at least the
  // window and may be years — so the sentence names the window.
  const soleus = restFor(b, 'soleus');
  eq(soleus.bound, 'atLeast', 'a whole read with no hit bounds the gap from below');
  eq(soleus.band, 'notInWindow', 'and it is its own band, not "a week or more"');
  eq(soleus.days, 30, 'the figure is the window');
  eq(restLine(soleus), 'Not trained in the last 30 days.', 'and the sentence is about the window');
  ok(!restLine(soleus).toLowerCase().includes('never'),
    'the word "never" appears nowhere: this app has members with three years behind the window');

  // atMost: a truncated read with a hit. A row that did not come back could be
  // MORE recent, so the figure is a ceiling.
  const short = board(LOG, { logStatus: 'partial' });
  const sq = restFor(short, 'quadriceps');
  eq(sq.bound, 'atMost', 'a prefix read with a hit bounds the gap from above');
  ok(restLine(sq).includes('may be more recent'),
    'and the sentence says which way it is uncertain');

  // unknown: a truncated read with NO hit. This is the one that looks exactly
  // like an untrained muscle and is not one.
  const missing = restFor(short, 'soleus');
  eq(missing.bound, 'unknown', 'a prefix read with no hit cannot say anything');
  eq(missing.days, null, 'so there is no figure');
  eq(restLine(missing), 'We cannot say when this was last trained.',
    'and the screen says so rather than telling somebody to train a muscle they worked this morning');

  // A failed read is not a rest figure at all.
  const failed = restFor(board(LOG, { logStatus: 'error' }), 'quadriceps');
  eq(failed.bound, 'unknown', 'a failed read knows nothing');
  eq(failed.days, null, 'and asserts no gap');
  const pending = restFor(board(LOG, { logStatus: 'loading' }), 'quadriceps');
  eq(pending.bound, 'unknown', 'and neither does one still in flight');
}

/* ── THE MAP ──────────────────────────────────────────────────────────────
 *
 * Untouched muscles are the point of the screen and the rows most able to lie.
 */
{
  const whole = restMap(board(LOG));
  eq(whole[0].muscle, 'soleus', 'the longest gap is first, which is the order it is read in');
  eq(whole[0].bound, 'atLeast', 'and it is an untouched muscle');
  ok(whole.some((r) => r.muscle === 'triceps brachii'),
    'a muscle that only ever assisted still gets a row — it is real work');
  eq(whole.length, 5, 'every muscle the catalogue knows is on the map');

  // A partial catalogue cannot supply the list an absence is asserted against.
  const noVocab = restMap(board(LOG, { catalogueStatus: 'partial' }));
  ok(!noVocab.some((r) => r.muscle === 'soleus'),
    'without a whole catalogue the untouched muscles are missing rather than asserted');
  eq(noVocab.length, 4, 'only the muscles with work on them are listed');
  ok((restMapNote(board(LOG, { catalogueStatus: 'partial' })) ?? '').includes('missing from this map'),
    'and the map says why they are missing, so their absence is not read as "you trained everything"');

  // A partial LOG cannot support "no set named it" either, even with a whole
  // catalogue — the missing row may be the one that names it.
  const shortLog = restMap(board(LOG, { logStatus: 'partial' }));
  ok(!shortLog.some((r) => r.bound === 'atLeast'),
    'a truncated log asserts no absence at all');
  ok((restMapNote(board(LOG, { logStatus: 'partial' })) ?? '').includes('more recently'),
    'and the note over the map says the whole map may be stale');

  ok((restMapNote(board(LOG)) ?? '').includes('not in that time rather than not ever'),
    'the whole-read note draws the line between the window and the record');
  eq(restMapNote(board(LOG, { logStatus: 'loading' })), null, 'a map still loading says nothing');
  ok((restMapNote(board(LOG, { logStatus: 'error' })) ?? '').includes('not about you'),
    'and a failed one says it is not about the member');
}

/* ── THE CALENDAR ─────────────────────────────────────────────────────────
 *
 * Days, not 86,400,000 ms. A set at 19:00 last night is "yesterday" at 09:00
 * this morning, and it stays yesterday across a clock change.
 */
{
  eq(restBand(0), 'today', 'nought days is today');
  eq(restBand(REST_BANDS.yesterday), 'yesterday', 'one is yesterday');
  eq(restBand(2), 'twoToThree', 'two is the short band');
  eq(restBand(REST_BANDS.twoToThree), 'twoToThree', 'and so is its upper edge');
  eq(restBand(REST_BANDS.twoToThree + 1), 'fourToSix', 'four opens the next one');
  eq(restBand(REST_BANDS.fourToSix), 'fourToSix', 'six closes it');
  eq(restBand(REST_BANDS.fourToSix + 1), 'aWeekOrMore', 'and seven is a week or more');

  // 14 hours elapsed, and it must read as a day rather than as today.
  const q = restFor(board(LOG), 'quadriceps');
  eq(q.hours, 14, 'the raw gap is fourteen hours');
  eq(q.days, 1, 'and the calendar says one day, which is what a person says');

  // Same morning, so today, whatever hour it was.
  const today = restFor(board([
    { t: at('2026-09-01', 6), exercise: 'Back Squat', sets: [[5, 100]] },
  ]), 'quadriceps');
  eq(today.days, 0, 'a set three hours ago is today');
  eq(restLine(today), 'Trained today.', 'and says so');

  // The DST crossings the day arithmetic in streaks.ts is anchored at noon
  // for. A local day is 23 hours once a year and 25 once, so subtracting a
  // fixed 86,400,000 gets one of them wrong: 25 hours reads as 1.04 days and 23
  // as 0.96, and only the rounding saves it — until two of them stack up.
  //
  // The dates below are chosen so that a real transition is crossed under a
  // zone `test:zones` actually runs: 8 March and 1 November 2026 for
  // America/Los_Angeles, 25 October and 29 March for the European zones this
  // is also read in. Both ends of every pair are the same wall-clock hour, so
  // the answer has to be a whole number of days in every zone on earth.
  const across = (fromDay: string, toDay: string): MuscleRest => {
    const now = Date.parse(at(toDay, 9));
    const b = muscleWorkBoard(
      [{ t: at(fromDay, 9), exercise: 'Back Squat', sets: [[5, 100]] }],
      CATALOGUE, { sinceMs: now - MONTH, nowMs: now },
    );
    return restFor(b, 'quadriceps');
  };
  eq(across('2026-10-24', '2026-10-26').days, 2, 'two calendar days across an autumn clock change');
  eq(across('2026-03-28', '2026-03-30').days, 2, 'and two across a spring one');
  eq(across('2026-10-25', '2026-10-26').days, 1, 'a single 25-hour day is one day');
  eq(across('2026-03-29', '2026-03-30').days, 1, 'and a single 23-hour day is one day');
  eq(across('2026-03-07', '2026-03-09').days, 2, 'two across the American spring forward');
  eq(across('2026-03-08', '2026-03-09').days, 1, 'and its single 23-hour day is one day');
  eq(across('2026-10-31', '2026-11-02').days, 2, 'two across the American fall back');
  eq(across('2026-11-01', '2026-11-02').days, 1, 'and its single 25-hour day is one day');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('muscleRecovery.test.ts ok');
