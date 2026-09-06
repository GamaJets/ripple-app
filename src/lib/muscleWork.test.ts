// Work per muscle, and the six ways counting it overstates somebody's training.
// Compile with tsc, run with node.
//
//   THE SPLIT        a prime mover and an assistant are not the same set
//   NOT ADDITIVE     one set reaches five muscles and is still one set
//   NO WEIGHTED KG   a kilogram is a measurement and may not be halved
//   THE GAPS         unmatched, unattributed and undrawn are three problems
//   THE READ         partial is a floor and is worded as one
//   THE PICTURE      relative shading has to say what full brightness is
import {
  muscleWorkBoard, effortFor, windowNote, gapNote, undrawnNote, diagramShading,
  SECONDARY_SHARE, RANKING_BASIS, EMPTY_WORK_BOARD, type MuscledExercise,
} from './muscleWork';
import type { BodyweightHistory } from './bodyweightSets';
import type { WorkoutEntry } from './mockData';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const at = (day: string, hour = 12) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour, 0, 0, 0).toISOString();
};
const NOW = Date.parse(at('2026-09-01'));
const WEEK = 7 * 86_400_000;

/** Spellings and pairings taken from production rows, so the shapes under test
 *  are the shapes that exist rather than ones invented for a test. */
const CATALOGUE: MuscledExercise[] = [
  {
    id: 'back-squat', name: 'Back Squat',
    primaryMuscles: ['quadriceps', 'gluteus maximus'],
    secondaryMuscles: ['hamstrings', 'erector spinae', 'adductors'],
  },
  {
    id: 'bench-press', name: 'Bench Press',
    primaryMuscles: ['pectoralis major'],
    secondaryMuscles: ['anterior deltoid', 'triceps brachii'],
  },
  {
    // `serratus anterior` is a real secondary on 40 production rows and the
    // artwork has no layer for it. It is here so the undrawn path is exercised
    // by the case that actually fires rather than by an invented name.
    id: 'barbell-row', name: 'Barbell Row',
    primaryMuscles: ['latissimus dorsi', 'rhomboids'],
    secondaryMuscles: ['biceps brachii', 'trapezius', 'serratus anterior'],
  },
  {
    id: 'lateral-raise', name: 'Lateral Raise',
    primaryMuscles: ['lateral deltoid'],
    secondaryMuscles: ['anterior deltoid', 'trapezius'],
  },
  {
    id: 'plank', name: 'Plank',
    primaryMuscles: ['rectus abdominis'],
    secondaryMuscles: ['transverse abdominis'],
  },
  {
    // A hand-written catalogue repeats itself. This row names the trapezius
    // twice, once in each column.
    id: 'shrug', name: 'Shrug',
    primaryMuscles: ['trapezius'],
    secondaryMuscles: ['trapezius', 'forearm flexors'],
  },
  // In the catalogue, with no muscles recorded. Seven production rows are this.
  { id: 'mystery-machine', name: 'Mystery Machine', primaryMuscles: [], secondaryMuscles: [] },
];

const HISTORY: BodyweightHistory = [{ t: at('2026-01-01'), v: 80 }];
const win = (extra: Record<string, unknown> = {}) =>
  ({ sinceMs: NOW - WEEK, nowMs: NOW, history: HISTORY, ...extra });

/* ── THE SPLIT ─────────────────────────────────────────────────────────────
 *
 * A prime mover takes the whole set; an assistant takes SECONDARY_SHARE of it.
 * The score is dimensionless and the set counts are real, and the two must not
 * be confusable.
 */
{
  const log: WorkoutEntry[] = [
    { t: at('2026-08-30'), exercise: 'Back Squat', sets: [[5, 100], [5, 100], [5, 100]] },
  ];
  const b = muscleWorkBoard(log, CATALOGUE, win());
  const quads = effortFor(b, 'quadriceps');
  const hams = effortFor(b, 'hamstrings');
  eq(quads?.primarySets, 3, 'the prime mover took three real sets');
  eq(quads?.secondarySets, 0, 'and assisted in none of them');
  eq(quads?.primaryEquivalentSets, 3, 'so its score is three');
  eq(hams?.primarySets, 0, 'the assistant was the main muscle in nothing');
  eq(hams?.secondarySets, 3, 'and assisted in three');
  eq(hams?.primaryEquivalentSets, 3 * SECONDARY_SHARE, 'so it scores half of three');
  ok((quads?.primaryEquivalentSets ?? 0) > (hams?.primaryEquivalentSets ?? 0),
    'and doing outranks assisting at the same number of sets, which is the whole point');

  // The ordering, which is what SECONDARY_SHARE exists to protect. Three
  // assisting sets must not beat two of doing.
  const mixed = muscleWorkBoard([
    { t: at('2026-08-30'), exercise: 'Back Squat', sets: [[5, 100], [5, 100], [5, 100]] },
    { t: at('2026-08-30'), exercise: 'Bench Press', sets: [[5, 60], [5, 60]] },
  ], CATALOGUE, win());
  ok((effortFor(mixed, 'pectoralis major')?.primaryEquivalentSets ?? 0)
    > (effortFor(mixed, 'hamstrings')?.primaryEquivalentSets ?? 0),
    'two sets of pressing outrank three sets of assisting');
}

/* ── NOT ADDITIVE ─────────────────────────────────────────────────────────
 *
 * One set of back squats is five muscles and one set. `setsCounted` is the
 * figure a screen prints; the sum of the rows is not and never was.
 */
{
  const b = muscleWorkBoard(
    [{ t: at('2026-08-30'), exercise: 'Back Squat', sets: [[5, 100], [5, 100], [5, 100]] }],
    CATALOGUE, win(),
  );
  eq(b.muscles.length, 5, 'the squat reached five muscles');
  eq(b.setsCounted, 3, 'and the member did three sets');
  const summed = b.muscles.reduce((n, m) => n + m.primarySets + m.secondarySets, 0);
  eq(summed, 15, 'summing the rows gives fifteen, which is why the board carries setsCounted');
}

/* A row that names the same muscle twice takes it once. Without the guard a
 * shrug would give the trapezius a set AND half a set off one movement — a
 * score above what doing the exercise outright is worth. */
{
  const b = muscleWorkBoard(
    [{ t: at('2026-08-30'), exercise: 'Shrug', sets: [[10, 40], [10, 40]] }],
    CATALOGUE, win(),
  );
  const traps = effortFor(b, 'trapezius');
  eq(traps?.primarySets, 2, 'the trapezius is the prime mover twice');
  eq(traps?.secondarySets, 0, 'and is not also its own assistant');
  eq(traps?.primaryEquivalentSets, 2, 'so it scores two, not three');
}

/* ── NO WEIGHTED KILOGRAM ─────────────────────────────────────────────────
 *
 * The tonnages are the tonnage of the SETS, unweighted, split by role. Halving
 * one would assert that the hamstrings moved a mass nobody measured.
 */
{
  const b = muscleWorkBoard(
    [{ t: at('2026-08-30'), exercise: 'Back Squat', sets: [[5, 100]] }],
    CATALOGUE, win(),
  );
  eq(effortFor(b, 'quadriceps')?.primaryVolumeKg, 500, 'the prime mover carries the whole tonnage');
  eq(effortFor(b, 'quadriceps')?.secondaryVolumeKg, null,
    'and nothing in the other column, which is null rather than zero');
  eq(effortFor(b, 'hamstrings')?.secondaryVolumeKg, 500,
    'the assistant carries the same tonnage, unhalved — it is the tonnage of the sets');
  eq(effortFor(b, 'hamstrings')?.primaryVolumeKg, null, 'and none as a prime mover');
}

/* A bodyweight set nobody can price is work that happened and is in no
 * tonnage — the same answer bodyweightSets.ts gives, carried per muscle. */
{
  const b = muscleWorkBoard(
    [{ t: at('2026-08-30'), exercise: 'Bench Press', sets: [[10, 0]], bw: [true] }],
    CATALOGUE, { sinceMs: NOW - WEEK, nowMs: NOW, history: [] },
  );
  eq(effortFor(b, 'pectoralis major')?.primarySets, 1, 'a member nobody has weighed still pressed');
  eq(effortFor(b, 'pectoralis major')?.primaryVolumeKg, null, 'with no tonnage behind it');
  eq(effortFor(b, 'pectoralis major')?.unpricedSets, 1, 'and the board says a set is missing from the figure');
}

/* A hold is a set and is not a tonnage. Same rule as muscleVolume.ts. */
{
  const b = muscleWorkBoard(
    [{ t: at('2026-08-30'), exercise: 'Plank', sets: [[45, 0]], timed: [true] }],
    CATALOGUE, win(),
  );
  eq(effortFor(b, 'rectus abdominis')?.primarySets, 1, 'a 45-second plank is one set of core work');
  eq(effortFor(b, 'rectus abdominis')?.primaryVolumeKg, null, 'and 45 seconds times nothing is not a mass');
  eq(b.setsCounted, 1, 'and it counts as one set performed');
}

/* Cardio has no muscle in the catalogue's sense and is not filed under one. */
{
  const b = muscleWorkBoard(
    [{ t: at('2026-08-30'), exercise: 'Back Squat', cardio: { mins: 30, dist: 5, unit: 'km' }, kcal: 200 }],
    CATALOGUE, win(),
  );
  eq(b.muscles.length, 0, 'a run with no sets reaches no muscle');
  eq(b.setsCounted, 0, 'and is not a set');
}

/* ── THE GAPS ─────────────────────────────────────────────────────────────
 *
 * Three different holes, three different sentences, three different owners.
 */
{
  const log: WorkoutEntry[] = [
    { t: at('2026-08-30'), exercise: 'Barbell Row', sets: [[8, 60], [8, 60]] },
    { t: at('2026-08-30'), exercise: 'Mystery Machine', sets: [[10, 30]] },
    { t: at('2026-08-30'), exercise: 'Zercher Good Morning', sets: [[5, 50]] },
  ];
  const b = muscleWorkBoard(log, CATALOGUE, win({ catalogueStatus: 'ready' }));

  eq(b.unmatched.join(','), 'Zercher Good Morning', 'a movement we have never heard of is named');
  eq(b.unmatchedSets, 1, 'with the sets it cost');
  eq(b.unattributed.join(','), 'Mystery Machine',
    'a movement in our catalogue with no muscles on it is a separate problem');
  eq(b.unattributedSets, 1, 'also counted in sets');
  eq(b.setsCounted, 2, 'and neither is in the sets this board could file');

  // Undrawn: counted everywhere, in no picture.
  eq(b.undrawn.join(','), 'serratus anterior',
    'the serratus is counted and cannot be drawn, so it is reported as undrawn');
  ok((effortFor(b, 'serratus anterior')?.secondarySets ?? 0) > 0,
    'and it is still on the board with its work on it');
  eq(effortFor(b, 'serratus anterior')?.drawn, false, 'flagged as not drawable');
  eq(effortFor(b, 'rhomboids')?.drawn, true,
    'the rhomboids ARE reachable, by approximation, so they are not undrawn');
  ok(b.approximations.some((s) => s.includes('trapezius')),
    'and the approximation they arrive by is stated');

  const g = gapNote(b) ?? '';
  ok(g.includes('Zercher Good Morning') && g.includes('Mystery Machine'),
    'both holes are named in the sentence');
  ok(g.includes('not in the exercise catalogue') && g.includes('records no muscles'),
    'and they are described as the two different problems they are');
  ok((undrawnNote(b) ?? '').includes('serratus anterior'),
    'the picture caveat is its own sentence, because it is a caveat on the picture');
  eq(undrawnNote(muscleWorkBoard(
    [{ t: at('2026-08-30'), exercise: 'Back Squat', sets: [[5, 100]] }], CATALOGUE, win())), null,
    'a week the artwork can draw entirely carries no such caveat');
}

/* ── THE READ ─────────────────────────────────────────────────────────────
 *
 * `isWhole`, not `!== error`. A partial read is a floor and the caption says so.
 */
{
  const log: WorkoutEntry[] = [{ t: at('2026-08-30'), exercise: 'Back Squat', sets: [[5, 100]] }];
  const whole = muscleWorkBoard(log, CATALOGUE, win({ catalogueStatus: 'ready' }));
  eq(whole.status, 'ready', 'two whole reads are a whole board');
  eq(whole.isFloor, false, 'and its figures are totals');
  ok((windowNote(whole) ?? '').includes('last 7 days'), 'captioned with the window it was asked for');

  const short = muscleWorkBoard(log, CATALOGUE, win({ logStatus: 'partial' }));
  eq(short.status, 'partial', 'a truncated log makes the whole board partial');
  eq(short.isFloor, true, 'so every figure on it is a floor');
  ok((windowNote(short) ?? '').includes('at least'),
    'and the caption says so in the words, rather than printing a total');

  const failed = muscleWorkBoard(log, CATALOGUE, win({ logStatus: 'error' }));
  eq(failed.status, 'error', 'a failed read outranks everything');
  ok((windowNote(failed) ?? '').includes('could not read'),
    'and says the screen is not about the member');
  eq(windowNote(muscleWorkBoard(log, CATALOGUE, win({ logStatus: 'loading' }))), null,
    'a read still in flight says nothing at all rather than saying nothing was found');

  // An empty board under a PREFIX read is not an empty window. Absence is what
  // a truncated read manufactures for free, and this is the one caption that
  // would have asserted it.
  ok((windowNote(muscleWorkBoard([], CATALOGUE, win())) ?? '').includes('Nothing is logged'),
    'a whole read of an empty week may say the week was empty');
  const shortEmpty = windowNote(muscleWorkBoard([], CATALOGUE, win({ logStatus: 'partial' }))) ?? '';
  ok(!shortEmpty.includes('Nothing is logged') && shortEmpty.includes('read in part'),
    'a prefix read that found nothing may not — it says the read was short instead');

  // Absence needs a whole catalogue: the vocabulary is the list an absence
  // would be asserted against.
  eq(whole.vocabulary?.includes('soleus'), false, 'the vocabulary is what the catalogue holds');
  ok((whole.vocabulary?.length ?? 0) >= 12, 'which here is every muscle named on any row');
  eq(muscleWorkBoard(log, CATALOGUE, win({ catalogueStatus: 'partial' })).vocabulary, null,
    'and it is withheld entirely when the catalogue read was a prefix');
}

/* An entry outside the window, and one whose timestamp will not parse, are
 * both left out — the second entirely, never filed under today. */
{
  const b = muscleWorkBoard([
    { t: at('2026-08-30'), exercise: 'Back Squat', sets: [[5, 100]] },
    { t: at('2026-08-01'), exercise: 'Bench Press', sets: [[5, 60]] },
    { t: 'not a date', exercise: 'Plank', sets: [[30, 0]], timed: [true] },
  ], CATALOGUE, win());
  eq(b.setsCounted, 1, 'only the set inside the window is counted');
  eq(effortFor(b, 'pectoralis major'), null, 'last month is not this week');
  eq(effortFor(b, 'rectus abdominis'), null, 'and an unreadable timestamp is not today');
}

/* `coveredFromMs` is where the RECORD starts, which is not where the window
 * does. "Since the first day on record" over 84 days of a three-year history
 * has shipped here; this is what a caption needs to avoid repeating it. */
{
  const b = muscleWorkBoard(
    [{ t: at('2026-08-30'), exercise: 'Back Squat', sets: [[5, 100]] }], CATALOGUE, win(),
  );
  eq(b.coveredFromMs, Date.parse(at('2026-08-30')), 'the record starts at the oldest counted set');
  ok(b.coveredFromMs !== b.sinceMs, 'and that is two days after the window opened');
  eq(muscleWorkBoard([], CATALOGUE, win()).coveredFromMs, null, 'an empty window covers nothing');
}

/* The last DAY, not the last row. One gym visit writes several rows with
 * several timestamps — see WeekStats.days. */
{
  const b = muscleWorkBoard([
    { t: at('2026-08-31', 16), exercise: 'Back Squat', sets: [[5, 100], [5, 100]] },
    { t: at('2026-08-31', 17), exercise: 'Back Squat', sets: [[5, 100]] },
    { t: at('2026-08-29', 17), exercise: 'Back Squat', sets: [[5, 100], [5, 100], [5, 100], [5, 100]] },
  ], CATALOGUE, win());
  const quads = effortFor(b, 'quadriceps');
  eq(quads?.lastDay, '2026-08-31', 'the last day is the last day');
  eq(quads?.lastDaySets, 3, 'and both saves of that visit are in its set count');
  eq(quads?.primarySets, 7, 'while the window keeps all seven');
}

/* ── THE PICTURE ──────────────────────────────────────────────────────────
 *
 * muscleMap's two rules, seen through a real board, plus the one thing a
 * relative shading cannot say for itself.
 */
{
  const b = muscleWorkBoard([
    { t: at('2026-08-30'), exercise: 'Back Squat', sets: [[5, 100], [5, 100], [5, 100], [5, 100]] },
    { t: at('2026-08-30'), exercise: 'Lateral Raise', sets: [[12, 8]] },
  ], CATALOGUE, win());
  const d = diagramShading(b);
  eq(d.hasWork, true, 'there is a picture to draw');
  eq(d.fullScaleAt, 4, 'full brightness is the hardest-worked muscle in the window');
  eq(d.byLayer.vastus_lateralis, 1, 'the quadriceps are the darkest thing on the body');
  eq(d.byLayer.rectus_femoris, 1, 'and every layer of them, not a stripe');

  // Collapse: the lateral deltoid is a prime mover once (1.0) and the anterior
  // deltoid assists once (0.5). One shoulder, and it takes the LARGER.
  eq(d.byLayer.deltoids, 1 / 4, 'three deltoid names on one shoulder take the largest, not the sum');
  ok(!('serratus' in d.byLayer), 'a muscle with no layer lights nothing');

  // The caveat a picture cannot carry: a deload week and a brutal one draw the
  // same darkest red without it.
  const light = muscleWorkBoard(
    [{ t: at('2026-08-30'), exercise: 'Back Squat', sets: [[5, 100]] }], CATALOGUE, win(),
  );
  eq(diagramShading(light).byLayer.vastus_lateralis, 1,
    'one set is also full brightness, which is why the scale is published');
  eq(diagramShading(light).fullScaleAt, 1, 'and it says the scale was one set');

  // A fixed ceiling, for two windows drawn side by side.
  eq(diagramShading(light, { fullScaleAt: 4 }).byLayer.vastus_lateralis, 1 / 4,
    'a shared ceiling makes the light week look like the light week it was');
  eq(diagramShading(b, { fullScaleAt: 2 }).byLayer.vastus_lateralis, 1,
    'and a ceiling below the peak clamps rather than running past full');

  const none = diagramShading(muscleWorkBoard([], CATALOGUE, win()));
  eq(none.hasWork, false, 'an empty window has no picture');
  eq(Object.keys(none.byLayer).length, 0, 'and an unlit body is not drawn as a rest week by accident');
}

/* The score is a ranking device and says so wherever it is shown. */
{
  ok(RANKING_BASIS.includes('assists') && RANKING_BASIS.includes('rather than a measurement'),
    'the basis sentence names the weighting and refuses the word measurement');
  eq(EMPTY_WORK_BOARD.vocabulary, null, 'an empty board asserts no absence');
  eq(EMPTY_WORK_BOARD.status, 'loading', 'and claims nothing has been read');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('muscleWork.test.ts ok');
