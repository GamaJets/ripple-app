// The two properties of RepDB's programme data that will be destroyed by the
// obvious code, and the four that are ordinary care.
//
// ── The two that matter ───────────────────────────────────────────────────
//
// 1. `reps` IS TEXT. Eleven of the twenty-six live values parse as an integer
//    and fifteen do not, and the dangerous half is not the NaN — it is
//    `parseInt('30s') === 30`, which succeeds and turns a thirty-second plank
//    into thirty repetitions. So the assertions below drive every live shape
//    through the label functions and require the string back verbatim.
//
// 2. `rest_seconds` OF 0 IS AN INSTRUCTION. A complex is performed back-to-back
//    and zero says so. `rest || null`, `rest ? … : …` and `Math.max(1, rest)`
//    all erase it, and all three read as tidying. The tests separate zero from
//    null in both directions: zero must produce words, null must produce
//    nothing.
//
// Compile with tsc, run with node. `ok`/`eq` into an array, exit at the END, so
// one run reports every failure rather than the first.
import {
  parseDays, parseTemplateRow, localisedText, templateFallbackNote, daysFallBack,
  goalLabel, difficultyLabel, tagLabel, frequencyLabel, restLabel, setsLabel, exerciseSpoken,
  exerciseCount, shapeLine, unreadableNote, exerciseIdsIn,
  filterTemplates, isFiltering, goalsPresent, difficultiesPresent,
  FREQUENCY_BANDS, NO_FILTER, TEMPLATE_GOALS, TEMPLATE_DIFFICULTIES,
  type WorkoutTemplate, type Localised,
} from './workoutTemplates';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const L = (en: string | null, de: string | null = null, es: string | null = null): Localised => ({ en, de, es });

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'stronglifts-5x5',
  source: 'repdb',
  goal: 'strength',
  difficulty: 'beginner',
  frequency_per_week: 3,
  tags: ['strength', '5x5'],
  name_en: '5×5 Strength — Linear Progression',
  name_de: '5×5 Kraft — Lineare Progression',
  name_es: '5×5 Fuerza — Progresión Lineal',
  description_en: 'Five sets of five on the big lifts.',
  description_de: null,
  description_es: null,
  days: [
    {
      name_en: 'Workout A', name_de: 'Training A', name_es: 'Entrenamiento A',
      exercises: [
        { exercise_id: 'back-squat', sets: 5, reps: '5', rest_seconds: 180, notes_en: 'Add 2.5 kg each session.', notes_de: null, notes_es: null },
        { exercise_id: 'bench-press', sets: 5, reps: '5', rest_seconds: 180 },
      ],
    },
  ],
  ...over,
});

/* ── 1 · reps is text, and is never a number ───────────────────────────────
 *
 * The live set, in full, from the 7 September 2026 probe. Every one of these
 * must survive parse and label unchanged. The two that would silently succeed
 * under parseInt are '30s' (→ 30) and '10/leg' (→ 10); the assertion is not
 * that they fail to parse, it is that nothing tried.
 */
{
  const LIVE_REPS = [
    '3', '5', '6', '8', '10', '12', '15', '20',
    '6-8', '8-10', '8-12', '8-15', '10-12', '10-15', '12-15', '15-20',
    '30s', '45s', '60s', '30-60s',
    '5/side', '8/side', '10/side', '15/side', '10/leg',
    'AMRAP',
  ];
  for (const reps of LIVE_REPS) {
    const parsed = parseDays([{ name_en: 'D', exercises: [{ exercise_id: 'plank', sets: 3, reps, rest_seconds: 60 }] }]);
    eq(parsed.days[0].exercises[0].reps, reps, `"${reps}" survives the parse verbatim`);
    eq(setsLabel(3, reps), `3 × ${reps}`, `"${reps}" is printed, not computed`);
    ok(exerciseSpoken('Plank', 3, reps, 60).includes(reps), `"${reps}" is spoken`);
  }
  // The specific two that a parse would get WRONG rather than merely fail on.
  eq(setsLabel(4, '30s'), '4 × 30s', 'a thirty-second hold is not thirty repetitions');
  eq(setsLabel(3, '10/leg'), '3 × 10/leg', 'ten per leg is not ten');
  eq(setsLabel(3, 'AMRAP'), '3 × AMRAP', 'AMRAP is an instruction, not a missing number');
  // Either half alone is still worth printing; neither half is nothing.
  eq(setsLabel(3, null), '3 sets', 'a set count with no reps still says how many');
  eq(setsLabel(1, null), '1 set', 'one set is singular');
  eq(setsLabel(null, 'AMRAP'), 'AMRAP', 'an instruction with no set count is still the instruction');
  eq(setsLabel(null, null), null, 'a row that records neither prints nothing');
  eq(setsLabel(3, '   '), '3 sets', 'a blank reps string is an absent one');
}

/* ── 2 · zero rest is an instruction, absent rest is silence ───────────── */
{
  eq(restLabel(0), 'Straight into the next', 'zero seconds is a coaching instruction and says so');
  eq(restLabel(null), null, 'no rest recorded prints nothing at all');
  ok(restLabel(0) !== restLabel(null), 'a complex and an unrecorded rest are two different sentences');
  eq(restLabel(45), '45 sec rest', 'under a minute stays in seconds');
  eq(restLabel(60), '1 min rest', 'a minute is a minute');
  eq(restLabel(180), '3 min rest', 'how a coach says a hundred and eighty');
  eq(restLabel(300), '5 min rest', 'the longest rest in the catalogue');
  eq(restLabel(90), '1 min 30 sec rest', 'a minute and a half is not "1.5 min"');
  // The parse half of the same property: 0 must arrive as 0, not as null.
  const complex = parseDays([{ name_en: 'Complex', exercises: [{ exercise_id: 'kettlebell-swing', sets: 5, reps: '5', rest_seconds: 0 }] }]);
  eq(complex.days[0].exercises[0].restSeconds, 0, 'zero survives the parse as zero');
  const silent = parseDays([{ name_en: 'D', exercises: [{ exercise_id: 'plank', sets: 3, reps: '30s' }] }]);
  eq(silent.days[0].exercises[0].restSeconds, null, 'an absent rest is null and not zero');
  ok(exerciseSpoken('Kettlebell Swing', 5, '5', 0).includes('Straight into the next'),
    'a screen reader is told about the zero too');
}

/* ── 3 · a missing set count is not a set count of zero ─────────────────── */
{
  const p = parseDays([{ name_en: 'D', exercises: [{ exercise_id: 'plank', reps: '30s', rest_seconds: 30 }] }]);
  eq(p.days[0].exercises[0].sets, null, 'an absent set count is null, not Number(undefined)');
  eq(setsLabel(null, '30s'), '30s', 'and never renders as "0 sets"');
  const bad = parseDays([{ name_en: 'D', exercises: [{ exercise_id: 'plank', sets: 'three', reps: '8', rest_seconds: 30 }] }]);
  eq(bad.days[0].exercises[0].sets, null, 'a set count that is not a number is absent, not NaN');
  eq(setsLabel(bad.days[0].exercises[0].sets, '8'), '8', 'and the row still prints the instruction it does have');
}

/* ── 4 · the parse drops what it cannot read, and COUNTS it ─────────────── */
{
  const p = parseDays([
    {
      name_en: 'Workout A',
      exercises: [
        { exercise_id: 'back-squat', sets: 5, reps: '5', rest_seconds: 180 },
        { sets: 3, reps: '8', rest_seconds: 60 },        // no id at all
        { exercise_id: '   ', sets: 3, reps: '8' },      // whitespace id
        'not an object',
      ],
    },
    { name_en: 'Workout B', exercises: [] },
  ]);
  eq(p.days.length, 2, 'a day with no readable exercises is kept, not renumbered away');
  eq(p.days[0].exercises.length, 1, 'only the movement that names something is listed');
  eq(p.dropped, 3, 'and the three that could not be read are counted, not swallowed');
  eq(parseDays(null).days.length, 0, 'a null days column is no days');
  eq(parseDays(null).dropped, 0, 'and nothing was dropped, because nothing was there');
  eq(parseDays({ name_en: 'not an array' }).days.length, 0, 'a days column that is not an array is no days');
  const noExercises = parseDays([{ name_en: 'Workout A' }]);
  eq(noExercises.days.length, 1, 'a day object with no exercises array is still a day');
  eq(noExercises.days[0].exercises.length, 0, 'with nothing in it');
}

/* ── 5 · a row with no identity does not become a programme ─────────────── */
{
  ok(parseTemplateRow(row()) !== null, 'a live-shaped row parses');
  eq(parseTemplateRow(row({ id: null })), null, 'a row with no id is not a programme');
  eq(parseTemplateRow(row({ name_en: null })), null, 'a row with no English name is not a programme');
  eq(parseTemplateRow(null), null, 'null is not a programme');
  eq(parseTemplateRow('stronglifts'), null, 'a string is not a programme');
  const t = parseTemplateRow(row())!;
  eq(t.id, 'stronglifts-5x5', 'the id is carried');
  eq(t.goal, 'strength', 'the goal is carried');
  eq(t.frequencyPerWeek, 3, 'the one cadence figure the data has is carried');
  eq(t.tags.length, 2, 'the tags are carried');
  eq(t.unreadableEntries, 0, 'a clean row reports nothing unreadable');
  // An unknown goal is carried as itself rather than filed under a neighbour.
  eq(parseTemplateRow(row({ goal: 'power-endurance' }))!.goal, 'power-endurance',
    'a goal this build has not met is kept, not defaulted');
  eq(parseTemplateRow(row({ frequency_per_week: null }))!.frequencyPerWeek, null,
    'an absent cadence is null and not zero');
  eq(parseTemplateRow(row({ tags: 'strength' }))!.tags.length, 0,
    'a tags column that is not an array yields no tags rather than a crash');
}

/* ── 6 · language falls back through exactly one step, and says so ──────── */
{
  const name = L('5×5 Strength', '5×5 Kraft', '5×5 Fuerza');
  eq(localisedText(name, 'de')!.text, '5×5 Kraft', 'a German reader gets the German name');
  eq(localisedText(name, 'de')!.isFallback, false, 'and it is not flagged, because it is not a fallback');
  eq(localisedText(name, null)!.text, '5×5 Strength', 'an English reader gets the English name');
  eq(localisedText(name, null)!.isFallback, false, 'English shown to an English reader is the answer, not a fallback');

  const partly = L('Five sets of five.', null, 'Cinco series de cinco.');
  eq(localisedText(partly, 'de')!.text, 'Five sets of five.', 'no German means the English one');
  eq(localisedText(partly, 'de')!.isFallback, true, 'and it is FLAGGED, or it reads as a translation nobody made');
  eq(localisedText(partly, 'de')!.locale, 'en', 'and it says which language it is actually in');
  eq(localisedText(partly, 'es')!.isFallback, false, 'the Spanish reader has Spanish');
  // One step and no further: a German reader never gets Spanish.
  ok(localisedText(partly, 'de')!.text !== 'Cinco series de cinco.', 'German does not fall back to Spanish');

  const none = L(null, null, null);
  eq(localisedText(none, null), null, 'a string that exists in no language is nothing, not an empty string');
  eq(localisedText(none, 'de'), null, 'in any language');
  eq(localisedText(L('  '), null), null, 'and a whitespace-only string is absent too');
  // The German-only case: no English at all, but the reader's language is there.
  eq(localisedText(L(null, 'Nur Deutsch'), 'de')!.text, 'Nur Deutsch', 'a translation with no English is still shown');
}

/* ── 7 · the fallback sentence names which parts are English ────────────── */
{
  const en = { text: 'x', locale: 'en', isFallback: false };
  const fb = { text: 'x', locale: 'en', isFallback: true };
  eq(templateFallbackNote(en, en, false), null, 'nothing fell back, so nothing is said');
  ok(templateFallbackNote(fb, en, false)!.includes('its name'), 'a fallen-back name is named');
  ok(!templateFallbackNote(fb, en, false)!.includes('description'), 'and the description is not implicated');
  ok(templateFallbackNote(fb, fb, false)!.includes('its name and its description'), 'two parts read as a pair');
  const all = templateFallbackNote(fb, fb, true)!;
  ok(all.includes('its name, its description and some of what is written against the days'),
    'three parts read as a list');
  ok(templateFallbackNote(null, null, true)!.includes('days'),
    'days alone is still worth saying');
  ok(templateFallbackNote(fb, en, false)!.includes(' is shown in English'), 'one part is singular');
  ok(templateFallbackNote(fb, fb, false)!.includes(' are shown in English'), 'two parts are plural');

  const days = [{
    name: L('Workout A', 'Training A', 'Entrenamiento A'),
    exercises: [{ exerciseId: 'back-squat', sets: 5, reps: '5', restSeconds: 180, notes: L('Add weight.', null, null) }],
  }];
  eq(daysFallBack(days, null), false, 'an English reader is never falling back');
  eq(daysFallBack(days, 'de'), true, 'an untranslated NOTE counts, not only an untranslated day name');
  eq(daysFallBack([{ name: L('A', 'A-de', 'A-es'), exercises: [] }], 'de'), false,
    'a fully translated day does not raise the flag');
}

/* ── 8 · labels, including the values this build has never met ──────────── */
{
  eq(goalLabel('strength'), 'Strength', 'a known goal has a label');
  eq(goalLabel('hypertrophy'), 'Muscle', 'and the label is the word a member uses');
  eq(goalLabel('STRENGTH'), 'Strength', 'stored case does not make a second goal');
  eq(goalLabel('power-endurance'), 'Power Endurance', 'an unknown goal renders as itself, title-cased');
  eq(goalLabel(''), '', 'and an empty one renders as nothing rather than as a guess');
  eq(difficultyLabel('advanced'), 'Advanced', 'a known level has a label');
  eq(difficultyLabel('elite'), 'Elite', 'an unknown level renders as itself');
  eq(tagLabel('push_pull_legs'), 'Push Pull Legs', 'a tag is title-cased for the row of labels it sits in');
  for (const g of TEMPLATE_GOALS) ok(goalLabel(g).length > 0, `${g} has a label`);
  for (const d of TEMPLATE_DIFFICULTIES) ok(difficultyLabel(d).length > 0, `${d} has a label`);

  eq(frequencyLabel(3), '3 days a week', 'the one cadence figure the data has');
  eq(frequencyLabel(1), 'Once a week', 'one is not "1 days"');
  eq(frequencyLabel(7), '7 days a week', 'the mobility routine is daily and says so');
  eq(frequencyLabel(null), null, 'a programme that does not state a cadence says nothing');
  eq(frequencyLabel(0), null, 'and zero a week is not a cadence either');
}

/* ── 9 · counting only what the row holds ───────────────────────────────── */
{
  const t = parseTemplateRow(row())!;
  eq(exerciseCount(t), 2, 'the movements across every day');
  eq(shapeLine(t), '1 day · 2 exercises', 'singular day, plural exercises');
  const two = parseTemplateRow(row({
    days: [
      { name_en: 'A', exercises: [{ exercise_id: 'back-squat', sets: 5, reps: '5', rest_seconds: 180 }] },
      { name_en: 'B', exercises: [{ exercise_id: 'deadlift', sets: 1, reps: '5', rest_seconds: 180 }] },
    ],
  }))!;
  eq(shapeLine(two), '2 days · 2 exercises', 'plural day, plural exercises');
  eq(shapeLine(parseTemplateRow(row({ days: [] }))!), null,
    'a programme with no days prints nothing rather than "0 days"');
  const oneEx = parseTemplateRow(row({
    days: [{ name_en: 'A', exercises: [{ exercise_id: 'plank', sets: 3, reps: '30s', rest_seconds: 30 }] }],
  }))!;
  eq(shapeLine(oneEx), '1 day · 1 exercise', 'one exercise is singular');
  const empty = parseTemplateRow(row({ days: [{ name_en: 'A', exercises: [] }] }))!;
  eq(shapeLine(empty), '1 day', 'a day with nothing in it counts the day and not the nothing');

  eq(unreadableNote(t), null, 'a clean programme says nothing about unreadable rows');
  const short = parseTemplateRow(row({
    days: [{ name_en: 'A', exercises: [{ sets: 3, reps: '8' }] }],
  }))!;
  ok(unreadableNote(short)!.startsWith('One movement'), 'one dropped entry reads as one');
  const shorter = parseTemplateRow(row({
    days: [{ name_en: 'A', exercises: [{ sets: 3 }, { reps: '8' }] }],
  }))!;
  ok(unreadableNote(shorter)!.startsWith('2 movements'), 'two dropped entries read as two');

  eq(exerciseIdsIn([t]).join(','), 'back-squat,bench-press', 'the ids, in the order first met');
  eq(exerciseIdsIn([t, t]).length, 2, 'and each one only once across programmes');
  eq(exerciseIdsIn([]).length, 0, 'no programmes name no movements');
}

/* ── 10 · filtering, and the row with no cadence ────────────────────────── */
{
  const mk = (id: string, goal: string, difficulty: string, freq: number | null): WorkoutTemplate =>
    parseTemplateRow(row({ id, goal, difficulty, frequency_per_week: freq }))!;
  const all = [
    mk('a', 'strength', 'beginner', 3),
    mk('b', 'hypertrophy', 'intermediate', 6),
    mk('c', 'mobility', 'beginner', 7),
    mk('d', 'endurance', 'intermediate', 4),
    mk('e', 'core', 'beginner', null),
  ];

  eq(isFiltering(NO_FILTER), false, 'nothing chosen is not filtering');
  eq(filterTemplates(all, NO_FILTER).length, 5, 'and nothing is filtered out');
  ok(isFiltering({ ...NO_FILTER, goal: 'strength' }), 'a goal is filtering');
  ok(isFiltering({ ...NO_FILTER, difficulty: 'beginner' }), 'a level is filtering');
  ok(isFiltering({ ...NO_FILTER, frequency: 'upto3' }), 'a cadence is filtering');

  eq(filterTemplates(all, { ...NO_FILTER, goal: 'strength' }).map((t) => t.id).join(','), 'a', 'by goal');
  eq(filterTemplates(all, { ...NO_FILTER, difficulty: 'beginner' }).map((t) => t.id).join(','), 'a,c,e', 'by level');
  eq(filterTemplates(all, { ...NO_FILTER, frequency: 'upto3' }).map((t) => t.id).join(','), 'a', 'up to three days');
  eq(filterTemplates(all, { ...NO_FILTER, frequency: '4to5' }).map((t) => t.id).join(','), 'd', 'four to five days');
  eq(filterTemplates(all, { ...NO_FILTER, frequency: '6plus' }).map((t) => t.id).join(','), 'b,c', 'six days or more');
  eq(filterTemplates(all, { goal: 'strength', difficulty: 'intermediate', frequency: null }).length, 0,
    'the three filters are an AND, not an OR');

  // The property this function exists to get right: a programme with no stated
  // cadence must not be swept into a band it never claimed.
  for (const b of FREQUENCY_BANDS) {
    ok(!filterTemplates(all, { ...NO_FILTER, frequency: b.key }).some((t) => t.id === 'e'),
      `a programme with no cadence is not filed under ${b.label}`);
  }
  ok(filterTemplates(all, NO_FILTER).some((t) => t.id === 'e'),
    'and it is still listed when no band is chosen');
  // Every band the data can produce is reachable: no live value falls in a gap.
  for (const n of [1, 2, 3, 4, 5, 6, 7, 14]) {
    const hits = FREQUENCY_BANDS.filter((b) => n >= b.min && (b.max == null || n <= b.max));
    eq(hits.length, 1, `${n} a week falls in exactly one band`);
  }

  eq(goalsPresent(all).join(','), 'strength,hypertrophy,endurance,core,mobility',
    'the goals present, in the house order rather than in row order');
  eq(difficultiesPresent(all).join(','), 'beginner,intermediate',
    'only the levels actually present — a chip that filters to nothing says a programme was removed');
  eq(goalsPresent([]).length, 0, 'no programmes offer no chips');
  const odd = [...all, mk('f', 'power-endurance', 'elite', 3)];
  eq(goalsPresent(odd)[goalsPresent(odd).length - 1], 'power-endurance',
    'a goal this build has not met is offered last rather than dropped');
  eq(difficultiesPresent(odd)[difficultiesPresent(odd).length - 1], 'elite',
    'and so is an unknown level');
}

/* ── 11 · what a screen reader is told about a row ──────────────────────── */
{
  eq(exerciseSpoken('Back Squat', 5, '5', 180), 'Back Squat, 5 sets of 5, 3 min rest',
    'the whole row, as a sentence — a label REPLACES the lines beneath it');
  eq(exerciseSpoken('Plank', 3, '30s', 0), 'Plank, 3 sets of 30s, Straight into the next',
    'including the instruction not to rest');
  eq(exerciseSpoken('Plank', 1, '60s', null), 'Plank, 1 set of 60s',
    'and nothing is said about a rest the programme does not state');
  eq(exerciseSpoken('Burpee', null, 'AMRAP', null), 'Burpee, AMRAP', 'a set count we do not have is not spoken');
  eq(exerciseSpoken('Burpee', null, null, null), 'Burpee', 'a row with only a name is only a name');
  // Not the multiplication sign: VoiceOver reads "5 × 5" as "5 times 5".
  ok(!exerciseSpoken('Back Squat', 5, '5', 180).includes('×'), 'the sign that is read as arithmetic is not spoken');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`workoutTemplates: ok (${TEMPLATE_GOALS.length} goals, ${FREQUENCY_BANDS.length} cadence bands)`);
