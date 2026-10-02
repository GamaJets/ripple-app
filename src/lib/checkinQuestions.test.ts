// A coach's own check-in questions.
//
// The assertions are mostly about the two ways this could cost a coach the
// signal they built it for: refusing a whole check-in over one stray
// character, and losing the answers to a question somebody stopped asking.
//
// Compile with tsc, then run under plain node.
import {
  promptText, unitText, questionRefusal, liveQuestions, answerValue, answerLine,
  questionsNote, MAX_LIVE_QUESTIONS, PROMPT_MAX, QUESTION_RATING_MAX,
  type Question,
} from './checkinQuestions';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

const q = (over: Partial<Question> = {}): Question =>
  ({ id: 'q1', prompt: 'How did the knee feel?', kind: 'rating', unit: null, position: 0, retiredAt: null, ...over });

/* ── what may be asked ────────────────────────────────────────────────────── */

eq(promptText('  How did the   knee feel?  '), 'How did the knee feel?', 'a prompt is tidied, not retyped');
eq(promptText('   '), null, 'whitespace is not a question');
eq(promptText(null), null, 'and neither is nothing');
eq(promptText('x'.repeat(400))?.length, PROMPT_MAX, 'an over-long prompt is capped rather than refused');

// A unit belongs to a figure. On a rating it would be a second scale, and on a
// sentence it is nothing.
eq(unitText('cm', 'number'), 'cm', 'a number question keeps its unit');
eq(unitText('cm', 'rating'), null, 'a rating has no unit');
eq(unitText('cm', 'text'), null, 'and neither does a sentence');

{
  const empty = questionRefusal({ prompt: '   ', live: 0 })!;
  ok(/Write the question first/.test(empty), 'an empty question is refused with something to do about it');
  eq(questionRefusal({ prompt: 'How is the knee?', live: 0 }), null, 'an ordinary one is not refused');
  const full = questionRefusal({ prompt: 'One more', live: MAX_LIVE_QUESTIONS })!;
  ok(new RegExp(String(MAX_LIVE_QUESTIONS)).test(full), 'the cap is stated with its number in it');
  ok(/answers stay/.test(full), 'and says retiring one keeps the answers, which is the thing people fear');
}

/* ── live and retired ─────────────────────────────────────────────────────── */

{
  const all = [
    q({ id: 'b', position: 2 }),
    q({ id: 'a', position: 1 }),
    q({ id: 'old', position: 0, retiredAt: '2026-01-01T00:00:00Z' }),
  ];
  const live = liveQuestions(all);
  eq(live.length, 2, 'a retired question is not asked again');
  eq(live.map((x) => x.id).join(','), 'a,b', 'and the rest are in the order they are asked');
  // The retired one is still in the list it was read from: a client's history
  // needs the question a two-month-old answer was given to.
  eq(all.length, 3, 'retiring does not remove it from what was read');
  eq(liveQuestions(null).length, 0, 'a failed read asks nothing rather than throwing');
}

/* ── an unanswered question is a skip, never a refusal ────────────────────── */

{
  eq(answerValue('rating', 4)?.rating, 4, 'a rating is a rating');
  eq(answerValue('rating', '4')?.rating, 4, 'typed as a string, still a rating');
  eq(answerValue('rating', 0), null, 'nought is not on a 1-5 scale, so it is a skip');
  eq(answerValue('rating', 9), null, 'and neither is nine');
  eq(answerValue('rating', ''), null, 'an untouched rating is a skip');

  eq(answerValue('number', '82.4')?.number, 82.4, 'a figure is kept');
  eq(answerValue('number', '82,4')?.number, 82.4, 'a decimal comma is a decimal point, not a refusal');
  eq(answerValue('number', '82.456')?.number, 82.46, 'and is rounded to what the column stores');
  eq(answerValue('number', 'about 82'), null, 'a figure that will not read is a skip');

  eq(answerValue('text', '  knee was fine  ')?.text, 'knee was fine', 'a sentence is tidied');
  eq(answerValue('text', '   '), null, 'an empty sentence is a skip');

  // The whole point: none of the above is an error. A stray character must not
  // cost somebody their whole check-in.
  for (const k of ['rating', 'number', 'text'] as const) {
    eq(answerValue(k, undefined), null, `${k}: nothing answered is null and not a throw`);
    eq(answerValue(k, ''), null, `${k}: an untouched box is a skip`);
  }
  // Nought is a real answer to a number question — "how many days did you miss"
  // — and must survive, which is why the empty check is separate from it.
  eq(answerValue('number', '0')?.number, 0, 'a typed zero is an answer, not a skip');
}

// Exactly one value column, every time — the same rule the check constraint in
// part 3380 enforces.
{
  for (const [k, raw] of [['rating', 3], ['number', '12'], ['text', 'fine']] as const) {
    const v = answerValue(k, raw)!;
    const set = [v.rating, v.number, v.text].filter((x) => x != null).length;
    eq(set, 1, `${k}: exactly one value column is set`);
  }
}

/* ── how an answer reads back ─────────────────────────────────────────────── */

{
  eq(answerLine(q(), { questionId: 'q1', rating: 4, number: null, text: null }), `4/${QUESTION_RATING_MAX}`, 'a rating reads on its scale');
  eq(answerLine(q({ kind: 'number', unit: 'cm' }), { questionId: 'q1', rating: null, number: 82, text: null }), '82 cm', 'a figure carries its unit');
  eq(answerLine(q({ kind: 'number', unit: null }), { questionId: 'q1', rating: null, number: 82, text: null }), '82', 'and reads fine without one');
  eq(answerLine(q({ kind: 'text' }), { questionId: 'q1', rating: null, number: null, text: 'knee fine' }), 'knee fine', 'a sentence is their own words');
  // Unanswered is null, so a screen can draw "not answered" rather than a
  // blank: those are different facts and only one of them is a value.
  eq(answerLine(q(), null), null, 'no answer, no line');
  eq(answerLine(q(), { questionId: 'q1', rating: null, number: null, text: null }), null, 'and an empty answer is no answer');
  // A value in the wrong column for the kind is not rendered as if it were
  // right: a row like that is a defect and a screen must not paper over it.
  eq(answerLine(q({ kind: 'rating' }), { questionId: 'q1', rating: null, number: 4, text: null }), null,
    'a figure is not read as a rating just because a rating was asked for');
}

/* ── the sentence under the coach's list ──────────────────────────────────── */

eq(questionsNote(0), null, 'no questions, nothing to explain');
ok(/under the six/.test(questionsNote(1) ?? ''), 'one question says where it sits');
ok(/answer already given/.test(questionsNote(3) ?? ''), 'and what retiring costs, which is nothing');

if (errors.length) {
  console.error(`checkinQuestions.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('checkinQuestions: ok (a stray character is a skip and not a refusal, a retired question keeps its answers, and exactly one value column is ever set)');
