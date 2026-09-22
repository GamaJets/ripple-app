// Four answers stay four answers, and a confidence nobody gave stays absent.
//
// Run: npx tsx src/lib/readerAnswer.test.ts
// (Not in `npm test` yet — package.json and tsconfig.test.json are managed
// centrally and this lane may not edit either. The two lines to add are in the
// lane report, alongside modelAnswer.test.ts, which carries the same note.)
import {
  readFoodReply, FOOD_READ_SAY, foodReadSay, namedGaps,
  readMealResult, readMachineResult,
  type FoodRead,
} from './readerAnswer';

const errors: string[] = [];
const eq = (got: unknown, want: unknown, what: string) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) errors.push(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const ok = (cond: boolean, what: string) => { if (!cond) errors.push(what); };
const why = (r: FoodRead) => (r.ok ? '(read ok)' : r.why);

/* ── (1) the reader did not answer ──────────────────────────────────────── */

eq(why(readFoodReply({ answered: false, body: null })), 'no-answer',
  'a call that produced no body at all is the reader not answering');
eq(why(readFoodReply({ answered: true, body: { error: 'x', why: 'truncated' } })), 'no-answer',
  'a truncated reply is the reader not answering');
eq(why(readFoodReply({ answered: true, body: { error: 'x', why: 'empty' } })), 'no-answer',
  'so is an empty one');
eq(why(readFoodReply({ answered: true, body: { error: 'x', why: 'unreadable' } })), 'no-answer',
  'so is one the gateway could not read');
eq(why(readFoodReply({ answered: true, body: { error: 'x', why: 'function-failed' } })), 'no-answer',
  'and so is the function itself falling over before any reader saw the words');
eq(why(readFoodReply({ answered: true, body: { error: 'Sign in to Repple to log food this way.' } })), 'no-answer',
  'a door that refused before the reader saw anything is a reader that did not answer, not a shape this app cannot read');

/* ── (2) the answer did not parse ───────────────────────────────────────── */

eq(why(readFoodReply({ answered: true, body: { error: 'x', why: 'no-json' } })), 'unreadable-answer',
  'an answer in prose is an answer this app could not read');
eq(why(readFoodReply({ answered: true, body: { error: 'x', why: 'unparseable' } })), 'unreadable-answer',
  'so is a half-written object');
eq(why(readFoodReply({ answered: true, body: { error: 'x', why: 'not-an-object' } })), 'unreadable-answer',
  'so is an answer that parsed into something that is not a field bag');

/* ── (3) the reader named no food — a READ, not a failure ───────────────── */

const none = readFoodReply({ answered: true, body: { items: [], unreadableItems: 0, estimated: true, note: 'The reader read your description and did not name any food in it.' } });
ok(none.ok, 'an empty list is a read that worked: the reader read the words and named nothing');
if (none.ok) {
  eq(none.items.length, 0, 'and it names no food');
  ok(none.note !== null, 'the reader’s own note about it survives the wire');
}
eq(foodReadSay(none).title, FOOD_READ_SAY['none-named'].title,
  'and the member is told the none-named sentence rather than one of the three failures');

/* ── (4) an answer of the wrong shape, which used to wear (3)’s clothes ─── */

eq(why(readFoodReply({ answered: true, body: { error: 'x', why: 'not-a-list' } })), 'unexpected-shape',
  'a wrong-shaped answer is its own outcome and must not read as a description with no food in it');
eq(why(readFoodReply({ answered: true, body: { foods: [] } })), 'unexpected-shape',
  'a 200 with no items list and no sentence on it is the same thing arriving without a `why`');
ok(why(readFoodReply({ answered: true, body: { error: 'x', why: 'not-a-list' } }))
  !== why(readFoodReply({ answered: true, body: { items: [] } })),
  'the wrong-shaped answer and the description with no food in it are NOT the same outcome');

const allNoise = readFoodReply({ answered: true, body: { items: ['nonsense', 42] } });
ok(allNoise.ok, 'a list of things this app cannot read is still a list that arrived');
eq(foodReadSay(allNoise).title, FOOD_READ_SAY['unexpected-shape'].title,
  'but a list whose every entry was unreadable is NOT the reader naming no food, and must not be said as though it were');

/* ── the four sentences ─────────────────────────────────────────────────── */

const four = [FOOD_READ_SAY['no-answer'], FOOD_READ_SAY['unreadable-answer'],
  FOOD_READ_SAY['unexpected-shape'], FOOD_READ_SAY['none-named']];
eq(new Set(four.map((s) => s.body)).size, 4, 'four outcomes, four different sentences');
eq(new Set(four.map((s) => s.title)).size, 4, 'and four different titles');

const named = FOOD_READ_SAY['none-named'];
ok(!/sorry|unfortunately|error|failed|failure|problem|could not|cannot|wrong|broken/i.test(named.body + ' ' + named.title),
  'the reader naming no food is a real answer and is not worded as a failure');
ok(/did not name any food/i.test(named.body),
  'and it says what actually happened — a read of the description, not a claim about the plate');
for (const s of four) {
  ok(/type the figures in yourself|type/i.test(s.body), `every outcome leaves the member a way forward: ${s.title}`);
}

/* ── which figures the reader did not give ──────────────────────────────── */

const partial = readFoodReply({ answered: true, body: { items: [{ name: 'Soup', kcal: 180 }] } });
ok(partial.ok, 'a food with only calories is still a food the reader named');
if (partial.ok) {
  eq(partial.items[0].notGiven, ['protein', 'carbs', 'fat'], 'and the three it did not give are named');
  eq(partial.items[0].protein, null, 'an absent protein figure is null, NEVER 0 — a zero-protein meal is a measurement');
  eq(namedGaps(partial.items[0].notGiven), 'protein, carbs or fat', 'and the member is told which, in words');
}
eq(namedGaps([]), '', 'a reader that gave everything leaves no clause to print');
eq(namedGaps(['fat']), 'fat', 'one gap is one word');

const noisy = readFoodReply({ answered: true, body: { items: [{ name: 'Toast', kcal: 90, protein: 3, carbs: 15, fat: 1 }, 'nonsense', {}] } });
if (noisy.ok) {
  eq(noisy.items.length, 1, 'entries that are not foods are not shown as blank foods');
  eq(noisy.unreadableItems, 2, 'they are COUNTED, because a member handed back less than they typed must be told');
  eq(noisy.items[0].notGiven, [], 'a food the reader priced in full names no gaps');
}

const stringy = readFoodReply({ answered: true, body: { items: [{ name: 'Rice', kcal: '210', protein: '4 g' }] } });
if (stringy.ok) {
  eq(stringy.items[0].kcal, 210, 'a stringified number is still a number — models stringify JSON numbers');
  eq(stringy.items[0].notGiven, ['carbs', 'fat'], 'and a figure read out of a string is not a gap');
}

/* ── the confidence nobody produced ─────────────────────────────────────── */

const mealNoConf = readMealResult({ name: 'Burrito', kcal: 740, protein: 30, carbs: 80, fat: 28 });
eq(mealNoConf?.confidence, null,
  'a reader that offered no confidence is not a reader that was 0.6 sure');
eq(mealNoConf?.kcal, 740, 'and the figures it DID give are unaffected');

const mealConf = readMealResult({ name: 'Burrito', kcal: 740, confidence: 0.3 });
eq(mealConf?.confidence, 0.3, 'a confidence the reader gave is carried exactly as given');
eq(mealConf?.protein, null, 'and the macros it did not give stay absent rather than becoming zero');

const mealZeroConf = readMealResult({ name: 'Burrito', kcal: 740, confidence: 0 });
eq(mealZeroConf?.confidence, 0,
  'a reader that says it is certain of NOTHING has said something, and 0 is that statement — not an absence');

eq(readMealResult({ name: 'Burrito', protein: 30 }), null,
  'no calorie figure is no meal: there is nothing here to build a log row from');
eq(readMealResult(null), null, 'and a result that is not an object is not a meal');
eq(readMealResult({ kcal: 400 })?.name, 'Meal', 'an unnamed meal keeps the neutral name the screens already use');

const machineNoConf = readMachineResult({ name: 'Lat Pulldown', muscleGroup: 'Back' });
eq(machineNoConf?.confidence, null, 'the same rule on the machine reader');
eq(machineNoConf?.isCardio, false, 'and isCardio is true only when the reader said true');
eq(readMachineResult({ muscleGroup: 'Back', confidence: 0.9 }), null,
  'a machine with no name is not a machine, however confident the reader was about it');

/* ── report ─────────────────────────────────────────────────────────────── */

if (errors.length) {
  console.error(`readerAnswer: ${errors.length} failure(s)`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exitCode = 1;
} else {
  console.log('readerAnswer: ok');
}
