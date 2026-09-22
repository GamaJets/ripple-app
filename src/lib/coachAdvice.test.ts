// A coach's advice, all of it. Compile with tsc, run with node.
//
// The member has only ever seen `coachNotes[0]` clipped at four lines on their
// dashboard, so every sentence below is one the product has never printed.
// Three of them would cost something:
//
//   · "your coach hasn't written you anything" over a read that failed. That is
//     the exact failure src/ui/feedback.tsx's own header records — "a client
//     whose coach had written them three notes was told their coach had said
//     nothing" — and the four statuses exist because of it.
//   · a COUNT over a 'partial' read. That provider reads under `capLimit()`
//     (src/lib/rowCap.ts) and genuinely reports 'partial' at the ceiling, so
//     this is not a theoretical branch.
//   · a sentence with a hole where the coach's name should be. The name comes
//     from a separate read that can fail on its own, and
//     scripts/check-prose.mjs exists because a screen shipped having lost the
//     first word of its sentence to exactly this.
import { sortAdvice, coachAdviceNote, adviceStampLine, type AdviceNote } from './coachAdvice';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const note = (p: Partial<AdviceNote> = {}): AdviceNote => ({
  id: 'n1',
  at: '2026-03-04T09:00:00.000Z',
  body: 'Keep the bar over mid-foot, and stop at eight even if nine is there.',
  ...p,
});

/* ── 1. order ─────────────────────────────────────────────────────────────*/

{
  const rows = [
    note({ id: 'b', at: '2026-01-01T00:00:00.000Z' }),
    note({ id: 'a', at: '2026-06-01T00:00:00.000Z' }),
    note({ id: 'c', at: '2026-03-01T00:00:00.000Z' }),
  ];
  eq(sortAdvice(rows).map((n) => n.id).join(''), 'acb', 'newest first');
  eq(rows.map((n) => n.id).join(''), 'bac', 'the caller’s array is not reordered under them');

  const withJunk = sortAdvice([
    note({ id: 'junk', at: '' }),
    note({ id: 'real', at: '2026-02-01T00:00:00.000Z' }),
  ]);
  eq(withJunk[0]?.id, 'real', 'a stamp that will not parse sorts last rather than to the top');

  // The provider merges reads into a map and puts an optimistic write at the
  // front, so ties are real. A list that reshuffles itself between renders looks
  // like a list that is changing when nothing has.
  const tied = [note({ id: 'y' }), note({ id: 'z' })];
  eq(sortAdvice(tied).map((n) => n.id).join(''), 'zy', 'the id breaks a tie, so the order is stable');
}

/* ── 2. the sentence above the list ───────────────────────────────────────*/

{
  const failed = coachAdviceNote('error', 0, 'Sam');
  ok(!/hasn’t written/.test(failed), 'a failed read never says the coach has written nothing');

  const part = coachAdviceNote('partial', 3, 'Sam');
  ok(!/\b3\b/.test(part), 'no count is stated over a read known to be short');
  ok(/not all of them/.test(part), 'a prefix is named as a prefix');

  const loading = coachAdviceNote('loading', 0, 'Sam');
  ok(!/hasn’t written/.test(loading), 'a read still in flight never asserts an empty set');

  const none = coachAdviceNote('ready', 0, 'Sam');
  ok(/hasn’t written/.test(none), 'a completed read with nothing in it may say so');

  eq(coachAdviceNote('ready', 1, 'Sam'), 'One note from Sam.', 'one note is not "1 notes"');
  ok(/^4 notes from Sam/.test(coachAdviceNote('ready', 4, 'Sam')), 'more than one is plural and carries its figure');

  eq(new Set([failed, part, loading, none, coachAdviceNote('ready', 4, 'Sam')]).size, 5,
    'five situations, five sentences');
}

/* ── 3. no hole where the name goes ───────────────────────────────────────*/

{
  // The name comes from `my_coach_profile()`, which is a separate read and can
  // fail on its own. Every branch has to survive that.
  for (const s of (['loading', 'ready', 'partial', 'error'] as const)) {
    const line = coachAdviceNote(s, 2, null);
    // `undefined` / `null` printed raw, and an em dash standing WHERE THE NAME
    // GOES — at the start of a sentence or hard against a following comma. An
    // em dash between two clauses is punctuation and is left alone; the shape
    // scripts/check-prose.mjs is about is the one that replaces a word.
    ok(!/undefined|null/.test(line), `${s}: never a variable printed raw`);
    ok(!/^\s*—|—\s*[,.]/.test(line), `${s}: no dash standing in for a name`);
    ok(line.trim() === line && !/ {2}/.test(line), `${s}: no double space where a name was meant to be`);
    ok(line.length > 0, `${s}: something is always said`);
  }
  ok(/your coach/.test(coachAdviceNote('ready', 2, null)),
    'with no name we fall back to the relationship, which is true and is not a name');
  ok(!/your coach/.test(coachAdviceNote('ready', 2, 'Sam')),
    'with a name we use it rather than saying both');
}

/* ── 4. the stamp ─────────────────────────────────────────────────────────*/

eq(adviceStampLine(null), null,
  'a date that would not read costs the line, not the note it sits under');
eq(adviceStampLine('4 March 2026'), 'Written 4 March 2026',
  'the date arrives already formatted, because the locale is the reader’s');

declare const process: { exit(code: number): void };
console.log(errors.length ? 'COACH ADVICE FAILURES:\n' + errors.join('\n') : 'coachAdvice: ok — a failed read never says your coach wrote nothing, a prefix is never counted, and no sentence is built around a missing name');
if (errors.length) process.exit(1);
