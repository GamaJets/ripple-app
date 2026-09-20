// How a movement's name is spelled when it is written down. Compile with tsc,
// run with node.
//
// The bugs these guard are both in the live database. Ten `workouts` rows held
// the coach's typed text instead of the catalogue's name — three of them
// ("Calf raise", "Hip abduction", "Shoulder press") slug to rows the catalogue
// spells in Title Case — and a movement the catalogue has never heard of went
// into the shared library exactly as typed, beside 615 rows that are not.
import { titleCaseName, canonicalExerciseName } from './exerciseName';
import { exerciseSlug } from './exerciseId';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the three real ones, and the row that started it ──────────────────── */

eq(titleCaseName('Calf raise'), 'Calf Raise', 'Calf raise gets its second word');
eq(titleCaseName('Hip abduction'), 'Hip Abduction', 'Hip abduction gets its second word');
eq(titleCaseName('Shoulder press'), 'Shoulder Press', 'Shoulder press gets its second word');
eq(titleCaseName('overhead press'), 'Overhead Press', 'the press that lit no shoulder');

/* ── first word, last word, and the small ones in between ──────────────── */

eq(titleCaseName('bent over row to the chest'), 'Bent over Row to the Chest',
  'four-letter prepositions and articles stay down mid-name');
eq(titleCaseName('up'), 'Up', 'a small word that is the only word is still capitalised');
eq(titleCaseName('press up'), 'Press Up', 'a small word LAST is capitalised');
eq(titleCaseName('to failure'), 'To Failure', 'a small word FIRST is capitalised');
eq(titleCaseName('farmer carry with kettlebells'), 'Farmer Carry with Kettlebells',
  '"with" is four letters and stays down');
eq(titleCaseName('step behind lunge'), 'Step Behind Lunge',
  'a five-letter preposition is capitalised');

/* ── hyphens: first element always, tail only when it is not a particle ── */

eq(titleCaseName('bent-over row'), 'Bent-over Row', 'a hyphen tail that is a preposition stays down');
eq(titleCaseName('warm-up'), 'Warm-up', 'a hyphen tail stays down even as the last word');
eq(titleCaseName('push-up'), 'Push-up', 'so does the commonest one in the catalogue');
eq(titleCaseName('full-body circuit'), 'Full-Body Circuit', 'a hyphen tail that is a noun goes up');
eq(titleCaseName('single-leg rdl'), 'Single-Leg RDL', 'and the acronym after it');

/* ── digits and acronyms ───────────────────────────────────────────────── */

eq(titleCaseName('1 arm plated row'), '1 Arm Plated Row', 'a leading digit is a word and the next one still capitalises');
eq(titleCaseName('ez-bar lying triceps extension'), 'EZ-Bar Lying Triceps Extension',
  'the bar is EZ, not Ez');
eq(titleCaseName('trx row'), 'TRX Row', 'a known acronym typed in lower case');
eq(titleCaseName('TRX Row'), 'TRX Row', 'and one typed correctly is left alone');
eq(titleCaseName('DB bench press'), 'DB Bench Press', 'capitals already chosen survive');
eq(titleCaseName('McGill curl-up'), 'McGill Curl-up', 'an internal capital is a decision somebody made');
eq(titleCaseName('barbell hip thrust'), 'Barbell Hip Thrust', 'three plain words');

/* ── a keyboard left on caps lock is not a decision ────────────────────── */

eq(titleCaseName('BENCH PRESS'), 'Bench Press', 'an all-capitals name is re-cased');
eq(titleCaseName('EZ-BAR ROW'), 'EZ-Bar Row', 'and the acronym inside it survives that');

/* ── nothing typed ─────────────────────────────────────────────────────── */

eq(titleCaseName(''), '', 'an empty name stays empty');
eq(titleCaseName('   '), '', 'and so does whitespace');
eq(titleCaseName('  calf   raise  '), 'Calf Raise', 'runs of spaces collapse');

/* ── the identity can never move ───────────────────────────────────────── */

for (const raw of ['Calf raise', 'SHOULDER PRESS', 'bent-over row', '1 arm plated row', 'ez-bar row']) {
  eq(exerciseSlug(titleCaseName(raw)), exerciseSlug(raw), `${raw} keeps its slug through title casing`);
}

/* ── the catalogue's own name wins ─────────────────────────────────────── */

const CAT = [
  { id: 'calf-raise', name: 'Calf Raise' },
  { id: 'hip-abduction', name: 'Hip Abduction' },
  { id: 'shoulder-press', name: 'Shoulder Press' },
  { id: 'heel-flicks', name: 'Heel Flicks', synonyms: ['butt kicks', 'heel kick'] },
  // A synonym that IS another row's id must never redirect that row.
  { id: 'back-squat', name: 'Back Squat', synonyms: ['front squat'] },
  { id: 'front-squat', name: 'Front Squat' },
  // The same synonym claimed twice: the catalogue cannot say which was meant.
  { id: 'good-morning', name: 'Good Morning', synonyms: ['hinge'] },
  { id: 'hip-hinge', name: 'Hip Hinge', synonyms: ['hinge'] },
];

eq(canonicalExerciseName('Calf raise', CAT), 'Calf Raise', 'a typed name resolves to the catalogue spelling');
eq(canonicalExerciseName('shoulder press', CAT), 'Shoulder Press', 'case and nothing else differed');
eq(canonicalExerciseName('HIP ABDUCTION', CAT), 'Hip Abduction', 'and capitals too');
eq(canonicalExerciseName('butt kicks', CAT), 'Heel Flicks', 'an exact synonym stores the row it names');
eq(canonicalExerciseName('Butt Kicks', CAT), 'Heel Flicks', 'a synonym is matched by slug, so case is nothing');
eq(canonicalExerciseName('front squat', CAT), 'Front Squat',
  'a synonym that is another row id does not redirect that row');
eq(canonicalExerciseName('hinge', CAT), 'Hinge',
  'a synonym two rows claim resolves to neither, and is title-cased as its own name');

/* ── and when it does not resolve, it is still spelled properly ────────── */

eq(canonicalExerciseName('zercher squat', CAT), 'Zercher Squat', 'a movement nobody has heard of');
eq(canonicalExerciseName('kettlebell windmill', []), 'Kettlebell Windmill',
  'an unread catalogue is not a reason to store sentence case');
eq(canonicalExerciseName('  ', CAT), '', 'nothing typed resolves to nothing');
// Near-misses are refused, exactly as videoForExercise refuses them: a set
// filed against a movement nobody did is stated as fact everywhere after.
eq(canonicalExerciseName('calf raises', CAT), 'Calf Raises', 'a plural is a different name, not a near-miss');
eq(canonicalExerciseName('shoulder pres', CAT), 'Shoulder Pres', 'and so is a typo');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('exerciseName: ok');
