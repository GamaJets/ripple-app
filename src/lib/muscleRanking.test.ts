// Most- and least-trained muscles, and the line between a measurement and a
// silence. Compile with tsc, run with node.
//
//   TWO LISTS      "least trained" is evidence; "untrained" is an assertion
//   THE GATE       untrained is null under a short read of either side
//   THE OVERLAP    a short board must not print one muscle at both ends
//   THE LINE       a row prints real sets, never the ranking score
import { muscleRankings, rankingNotes, rankingLine, RANK_ROWS } from './muscleRanking';
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
const NOW = Date.parse(at('2026-09-01'));
const WEEK = 7 * 86_400_000;

const CATALOGUE: MuscledExercise[] = [
  {
    id: 'back-squat', name: 'Back Squat',
    primaryMuscles: ['quadriceps', 'gluteus maximus'],
    secondaryMuscles: ['hamstrings', 'erector spinae'],
  },
  {
    id: 'bench-press', name: 'Bench Press',
    primaryMuscles: ['pectoralis major'],
    secondaryMuscles: ['anterior deltoid', 'triceps brachii'],
  },
  { id: 'calf-raise', name: 'Calf Raise', primaryMuscles: ['soleus'], secondaryMuscles: [] },
  // The id IS the slug of the name — `exerciseSlug('Bicep Curl')`. Written out
  // because getting it wrong sends the movement to `unmatched` and quietly
  // makes its muscle look untrained, which is the failure this file is about.
  { id: 'bicep-curl', name: 'Bicep Curl', primaryMuscles: ['biceps brachii'], secondaryMuscles: [] },
  { id: 'crunch', name: 'Crunch', primaryMuscles: ['rectus abdominis'], secondaryMuscles: [] },
];

const LOG: WorkoutEntry[] = [
  { t: at('2026-08-30'), exercise: 'Back Squat', sets: [[5, 100], [5, 100], [5, 100], [5, 100]] },
  { t: at('2026-08-31'), exercise: 'Bench Press', sets: [[5, 80], [5, 80]] },
  { t: at('2026-08-31'), exercise: 'Bicep Curl', sets: [[10, 15]] },
];

const board = (extra: Record<string, unknown> = {}) =>
  muscleWorkBoard(LOG, CATALOGUE, { sinceMs: NOW - WEEK, nowMs: NOW, ...extra });

/* ── TWO LISTS ────────────────────────────────────────────────────────────
 *
 * Every row of `least` is a muscle that was worked. A muscle that was not
 * worked is never in it, however lightly the list is scraped.
 */
{
  const b = board();
  const r = muscleRankings(b, { rows: 2 });
  eq(r.most[0].muscle, 'gluteus maximus', 'four sets of squatting leads');
  eq(r.most[0].primaryEquivalentSets, 4, 'at four prime-mover sets');
  eq(r.most.length, 2, 'and the top is as long as it was asked to be');

  ok(r.least.every((m) => m.primarySets + m.secondarySets > 0),
    'every muscle in the bottom list actually did something');
  ok(!r.least.some((m) => m.muscle === 'soleus'),
    'a muscle with nothing against it is not the least-trained one — it is not in the list');
  ok((r.untrained ?? []).includes('soleus'),
    'it is in `untrained`, which is a different claim in a different place');
  ok((r.untrained ?? []).includes('rectus abdominis'), 'along with everything else untouched');
  eq((r.untrained ?? []).length, 2, 'and only those two');

  // Ordered up from the least, so the first row is the thing to look at.
  eq(r.least[0].muscle, 'triceps brachii', 'the lightest is first');
  ok(r.least[0].primaryEquivalentSets <= r.least[1].primaryEquivalentSets,
    'and the list climbs from there');
}

/* ── THE GATE ─────────────────────────────────────────────────────────────
 *
 * Absence is the one thing a short read produces for free. `untrained` is null
 * — not empty — under a short read of EITHER side, because empty means "you
 * have trained everything", which is a finding.
 */
{
  eq(muscleRankings(board({ catalogueStatus: 'partial' })).untrained, null,
    'a truncated catalogue cannot supply the list an absence is asserted against');
  eq(muscleRankings(board({ logStatus: 'partial' })).untrained, null,
    'and a truncated log cannot support "no set named it"');
  eq(muscleRankings(board({ logStatus: 'error' })).untrained, null, 'nor can a failed one');
  eq(muscleRankings(board({ logStatus: 'loading' })).untrained, null,
    'nor one that has not come back');
  ok(Array.isArray(muscleRankings(board()).untrained),
    'and two whole reads do supply it, as a list rather than a null');

  // The sentences. Both short-read cases have to explain the missing section,
  // and they are two different failures.
  const catShort = board({ catalogueStatus: 'partial' });
  ok(rankingNotes(catShort, muscleRankings(catShort))
    .some((s) => s.includes('whole exercise catalogue')),
    'a short catalogue says it was the catalogue');
  const logShort = board({ logStatus: 'partial' });
  const logNotes = rankingNotes(logShort, muscleRankings(logShort));
  ok(logNotes.some((s) => s.includes('log was read in part')),
    'a short log says it was the log');
  ok(logNotes.some((s) => s.includes('at least')),
    'and the window caption above it says the counts are floors');

  const whole = board();
  const notes = rankingNotes(whole, muscleRankings(whole));
  ok(notes.some((s) => s.includes('assists')),
    'a whole board still explains the weighting the order was built on');
  ok(!notes.some((s) => s.includes('cannot list the muscles')),
    'and does not apologise for a section it managed to produce');

  eq(rankingNotes(board({ logStatus: 'loading' }), muscleRankings(board({ logStatus: 'loading' })))
    .some((s) => s.includes('cannot list')), false,
    'a board still loading explains nothing, because nothing has been claimed yet');
}

/* ── THE OVERLAP ──────────────────────────────────────────────────────────
 *
 * Six muscles into a five-and-five layout puts four of them in both lists. A
 * screen printing both would show the same muscle as most and least trained.
 */
{
  const b = board();
  eq(b.muscles.length, 8, 'eight muscles were touched this week');
  eq(muscleRankings(b).overlapping, true,
    `eight muscles do not fill two lists of ${RANK_ROWS}, so a screen shows one`);
  eq(muscleRankings(b, { rows: 2 }).overlapping, false,
    'two and two out of eight do not meet, so both lists may be shown');
  eq(muscleRankings(muscleWorkBoard([], CATALOGUE, { sinceMs: NOW - WEEK, nowMs: NOW }))
    .overlapping, false,
    'and an empty board is not "overlapping", it is empty');
}

/* ── THE LINE ─────────────────────────────────────────────────────────────
 *
 * `primaryEquivalentSets` orders the list. It is dimensionless and must never
 * reach a member with the word "sets" after it.
 */
{
  const b = board();
  const quads = b.muscles.find((m) => m.muscle === 'quadriceps')!;
  const hams = b.muscles.find((m) => m.muscle === 'hamstrings')!;
  const tri = b.muscles.find((m) => m.muscle === 'triceps brachii')!;

  eq(rankingLine(quads), '4 sets as the main muscle.', 'a prime mover reports its real sets');
  eq(hams.primaryEquivalentSets, 2, 'the hamstrings score two');
  eq(rankingLine(hams), '4 sets assisting — nothing that trained it directly.',
    'and the line reports the four sets they were in, not the two they scored');
  ok(!rankingLine(hams).includes('2 set'),
    'the score never reaches the sentence, because nobody did two sets of hamstrings');
  eq(rankingLine(tri), '2 sets assisting — nothing that trained it directly.',
    'a muscle that only ever assisted says so rather than showing a bare number');

  const mixed = muscleWorkBoard([
    ...LOG,
    { t: at('2026-08-31'), exercise: 'Crunch', sets: [[20, 0]] },
    { t: at('2026-08-29'), exercise: 'Back Squat', sets: [[5, 100]] },
  ], CATALOGUE, { sinceMs: NOW - WEEK, nowMs: NOW });
  const bothRoles = mixed.muscles.find((m) => m.muscle === 'quadriceps')!;
  eq(rankingLine(bothRoles), '5 sets as the main muscle.', 'and a five-set week reads as five');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('muscleRanking.test.ts ok');
