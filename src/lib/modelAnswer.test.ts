// The three ways an answer comes to nothing must stay three things.
//
// Run: npx tsx src/lib/modelAnswer.test.ts
// (Not in `npm test` yet — package.json and tsconfig.test.json are managed
// centrally and this lane may not edit either. The two lines to add are in
// the lane report.)
import {
  readModelJson, answerProblem, numberOrNull, notGivenAmong, figuresAmong,
  readNutritionItems, NUTRITION_FIGURES,
} from './modelAnswer';

const errors: string[] = [];
const eq = (got: unknown, want: unknown, what: string) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) errors.push(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const ok = (cond: boolean, what: string) => { if (!cond) errors.push(what); };

/* ── the three failures are three values ────────────────────────────────── */

const prose = readModelJson('I cannot see any food in this image.');
eq(prose.ok, false, 'an answer in prose is not an object');
eq((prose as { why: string }).why, 'no-json', 'and the reason is that it holds no JSON at all — which is the answer, not a failure to answer');

const half = readModelJson('Here you go: {"name":"Burrito","kcal":740,');
eq(half.ok, false, 'a half-written object does not read');
eq((half as { why: string }).why, 'unparseable', 'and it is named as malformed rather than as prose');

const wordsOnly = readModelJson('There is no food in this photo.');
eq((wordsOnly as { why: string }).why, 'no-json', 'an answer with no brace anywhere is prose, and prose is the answer');

// The same first-brace-to-last-brace span both functions always used: one
// object wrapped in a list still reads as that object. Asserted so that a
// later tightening of the span has to be a decision rather than a surprise.
const wrapped = readModelJson('[{"a":1}]');
ok(wrapped.ok, 'a single object inside a list still reads as that object');

const arrayOfObjects = readModelJson('[{"a":1},{"b":2}]');
eq(arrayOfObjects.ok, false, 'a list of objects is not the field bag any caller asked for');
eq((arrayOfObjects as { why: string }).why, 'unparseable', 'the brace span of a list is not valid JSON on its own');

const real = readModelJson('Sure!\n{"items":[{"name":"Coke","kcal":139}]}\nHope that helps.');
ok(real.ok, 'an object inside prose is still an object');
eq((real as { value: Record<string, unknown> }).value.items !== undefined, true, 'and its fields are there');

eq(readModelJson(null).ok, false, 'a non-string answer does not throw');
eq(readModelJson('').ok, false, 'and neither does an empty one');

// The whole point of the file: the three reasons may never share a sentence.
ok(answerProblem('no-json') !== answerProblem('unparseable'), 'prose and malformed do not share one sentence');
ok(answerProblem('unparseable') !== answerProblem('not-an-object'), 'malformed and wrong-shape do not share one sentence');
ok(answerProblem('no-json') !== answerProblem('not-an-object'), 'prose and wrong-shape do not share one sentence');
ok(answerProblem('no-json').length > 20, 'and each of them says something a member can act on');

/* ── a zero is a measurement; an absence is not ─────────────────────────── */

eq(numberOrNull(0), 0, 'a real zero survives — it is a figure');
eq(numberOrNull(undefined), null, 'an absent figure is null and never 0');
eq(numberOrNull(null), null, 'an explicit null is null');
eq(numberOrNull('76.2 kg'), 76.2, 'a stringified number with its unit still reads');
eq(numberOrNull('28%'), 28, 'and so does a percentage');
eq(numberOrNull('not printed'), null, 'a sentence is not a figure');
eq(numberOrNull(''), null, 'and neither is an empty string');
eq(numberOrNull('-3'), -3, 'a negative reads');
eq(numberOrNull(NaN), null, 'NaN is not a figure — it compares false against every bound and then prints');
eq(numberOrNull(Infinity), null, 'and neither is an infinity');
eq(numberOrNull({ kcal: 4 }), null, 'an object is not a figure');

/* ── what the model did not give is NAMED ───────────────────────────────── */

eq(
  notGivenAmong({ kcal: 740, protein: 31 }, NUTRITION_FIGURES),
  ['carbs', 'fat'],
  'the figures the prompt asked for and the answer omitted are named, not silently null',
);
eq(notGivenAmong({ kcal: 0 }, ['kcal']), [], 'a measured zero is given, not missing');
eq(
  figuresAmong({ weightKg: '76.2', bodyFatPct: null }, ['weightKg', 'bodyFatPct']),
  { weightKg: 76.2, bodyFatPct: null },
  'every asked-for figure comes back keyed, as a number or as null',
);

/* ── "no food here" is an answer; a wrong shape is not ──────────────────── */

const named = readNutritionItems({ items: [{ name: 'Burrito', kcal: 740, protein: 31 }] });
ok(named.ok, 'a list of foods reads');
if (named.ok) {
  eq(named.items.length, 1, 'and the food is in it');
  eq(named.items[0].carbs, null, 'a macro the reader did not give is null');
  eq(named.items[0].notGiven, ['carbs', 'fat'], 'and it is named, so the screen can ask rather than assume');
  eq(named.unreadableItems, 0, 'nothing in that list was unreadable');
}

const none = readNutritionItems({ items: [] });
ok(none.ok, 'a description the reader found no food in is a successful read');
if (none.ok) eq(none.items.length, 0, 'that named no foods');

const wrongShape = readNutritionItems({ error: 'I could not tell what that was' });
eq(wrongShape.ok, false, 'an answer with no items list is a SHAPE failure');
eq((wrongShape as { why: string }).why, 'not-a-list', 'and it is named as one');
// The defect, stated as an assertion: these two must not be the same value.
ok(
  JSON.stringify(none) !== JSON.stringify(wrongShape),
  'a description with no food in it and an answer this app could not read are different outcomes',
);

const noisy = readNutritionItems({ items: [{ name: 'Coke', kcal: 139 }, 'chips', null, {}] });
ok(noisy.ok, 'a list with junk in it still yields the foods it does hold');
if (noisy.ok) {
  eq(noisy.items.length, 1, 'the readable food is kept');
  eq(noisy.unreadableItems, 3, 'and the entries that could not be read are COUNTED rather than dropped in silence');
}

const nameless = readNutritionItems({ items: [{ kcal: 200 }] });
if (nameless.ok) {
  eq(nameless.items.length, 1, 'a food with figures and no name is still a food');
  eq(nameless.items[0].name, 'Food', 'given the neutral name the app already uses');
}

/* ── report ─────────────────────────────────────────────────────────────── */

if (errors.length) {
  console.error(`modelAnswer: ${errors.length} failure(s)`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exitCode = 1;
} else {
  console.log('modelAnswer: ok');
}
