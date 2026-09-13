// Acceptance counts on a coach's own paperwork. Compile with tsc, run with node.
//
// The thing guarded here is that no number is produced from a read that either
// failed or came back short. src/lib/coachDocs.ts already argues this for the
// named list — "All 12 of your clients have accepted this" out of twelve rows
// of nineteen is how a coach trains the other seven believing they are covered
// — and a bare "4 have accepted" on the row above it is the same claim with
// less context, which makes it worse rather than safer.
import {
  ACCEPTANCE_COUNTS_UNCOUNTABLE_NOTE, COUNTABLE_DOCUMENTS_CAP,
  acceptedCount, acceptedLine, acceptedNeedsMark, tallyAcceptances,
} from './docAcceptance';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const WAIVER = '11111111-1111-1111-1111-111111111111';
const PARQ = '22222222-2222-2222-2222-222222222222';

/* ── the tally ────────────────────────────────────────────────────────────── */

eq(tallyAcceptances(null), null, 'a read that produced nothing produces no tally, never an empty one');
eq(tallyAcceptances(undefined), null, 'and neither does a missing one');

{
  const t = tallyAcceptances([
    { document_id: WAIVER }, { document_id: WAIVER }, { document_id: PARQ },
  ]);
  eq(t?.[WAIVER], 2, 'two rows against the waiver are two people');
  eq(t?.[PARQ], 1, 'and one against the par-form is one');
}

{
  const t = tallyAcceptances([{ document_id: null }, { document_id: 7 }, { document_id: '   ' }, {}]);
  eq(Object.keys(t ?? {}).length, 0,
    'a row we cannot attribute is dropped rather than counted against some other document');
}

/* ── nothing is counted over a read that is not the whole set ─────────────── */

{
  const t = tallyAcceptances([{ document_id: WAIVER }, { document_id: WAIVER }]);
  eq(acceptedCount(t, WAIVER, true), 2, 'a whole read states the count');
  eq(acceptedCount(t, WAIVER, false), null, 'a truncated one states nothing at all');
  eq(acceptedCount(null, WAIVER, true), null, 'and a failed read states nothing however whole it claims to be');
  eq(acceptedCount(t, PARQ, true), 0,
    'a document with no rows in a COMPLETED tally really has had none — that is the one honest zero');
}

/* ── the words ────────────────────────────────────────────────────────────── */

eq(acceptedLine(null, true), null, 'no count, no line — the screen says why once, above the list');
eq(acceptedLine(1, true), '1 person has accepted this', 'one is a person');
eq(acceptedLine(4, true), '4 people have accepted this', 'four are people');
eq(acceptedLine(0, true), 'Nobody has accepted this yet',
  'nobody, on a document they are being asked to accept');
eq(acceptedLine(0, false), 'Nobody has accepted this — you are not asking them to',
  'and on one they are not, the reason is said rather than left to read as a roster ignoring their coach');

eq(acceptedNeedsMark(0, true), true, 'a required document nobody has signed is what the coach came here for');
eq(acceptedNeedsMark(0, false), false, 'an optional one with no acceptances is not a problem');
eq(acceptedNeedsMark(3, true), false, 'and a signed one is not either');
eq(acceptedNeedsMark(null, true), false, 'a count we do not have raises no alarm — it is not a zero');

/* ── the two constants the screen leans on ────────────────────────────────── */

ok(COUNTABLE_DOCUMENTS_CAP > 0 && Number.isInteger(COUNTABLE_DOCUMENTS_CAP),
  'the request-length cap is a whole number of documents');
ok(!/\b(all|every|everyone)\b/i.test(ACCEPTANCE_COUNTS_UNCOUNTABLE_NOTE),
  'the note for an uncountable read claims nothing about how many anybody is');
ok(ACCEPTANCE_COUNTS_UNCOUNTABLE_NOTE.includes('has changed'),
  'and says the acceptances themselves are untouched, because a coach reading an error here re-sends paperwork');

if (errors.length) {
  console.error(`docAcceptance: ${errors.length} failure(s)`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('docAcceptance: ok');
