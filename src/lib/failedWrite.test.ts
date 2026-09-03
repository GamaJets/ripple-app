// A write that timed out is not a write that was refused.
// Compile with tsc, run with node.
//
// The suite exists because the sentence is the product here. There is no
// behaviour to assert beyond "which of the three", and the thing that actually
// broke was a claim in English — "Nothing was saved", said about a request
// nobody answered. So the assertions below are mostly about words: that the two
// states with evidence assert, that the one without does not, and that nothing
// can quietly soften either.
import {
  writeFate, failedWriteSentence, failedWriteNote, mayRetryWrite, mayAssertUnchanged,
  type WriteSubject,
} from './failedWrite';
import { requestTimeoutError, CALL_CEILING_MS } from './requestTimeout';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const PAYMENT: WriteSubject = {
  what: 'That payment',
  unchanged: 'the money is not in the gym record',
  howToCheck: 'Reload this page and look for it in the payment list before entering it again.',
};

/* ── classification ────────────────────────────────────────────────────── */

{
  // A refusal. supabase-js RESOLVES with these rather than throwing, but a
  // caller that re-throws `error` hands exactly this shape to a catch.
  eq(writeFate({ code: '23514', message: 'violates check constraint' }), 'refused',
    'a CHECK constraint is the server having read the row and said no');
  eq(writeFate({ code: '42501', message: 'row-level security' }), 'refused', 'and so is RLS');
  eq(writeFate({ status: 400, message: 'bad request' }), 'refused', 'and so is a 4xx');
  eq(writeFate({ code: 'PGRST116', message: 'no rows' }), 'refused', 'and so is PostgREST answering');
}

{
  // Our own ceiling. This is the whole reason the file exists.
  const err = requestTimeoutError('https://x.supabase.co/rest/v1/gym_payments', 'POST', CALL_CEILING_MS);
  eq(writeFate(err), 'unanswered', 'a request WE gave up waiting for tells us nothing about the row');
  eq(mayRetryWrite('unanswered'), false, 'so a plain retry button is not offered');
  eq(mayAssertUnchanged('unanswered'), false, 'and nothing on the screen may claim the row is absent');
}

{
  // A 5xx and a statement timeout are the server existing without answering
  // about this row. Not a refusal, and not proof of nothing.
  eq(writeFate({ status: 503, message: 'service unavailable' }), 'unanswered',
    'a 503 is the server up and not having answered about the row');
  eq(writeFate({ status: 408, message: 'request timeout' }), 'unanswered', 'and 408 is a timeout by another route');
  eq(writeFate({ code: '57014', message: 'statement timeout' }), 'unanswered',
    'and a Postgres statement timeout may have rolled back or may not have reached us');
}

{
  // A bare browser fetch failure. It carries no code and no status, and it is
  // the same object whether the socket never opened or the reply was cut off
  // halfway — so it is NOT evidence that nothing happened.
  const bare = Object.assign(new TypeError('Failed to fetch'), {});
  eq(writeFate(bare), 'unanswered', 'a bare fetch failure is ambiguous and is treated as such');
  // Unless the screen knows the device was already offline, which is the one
  // piece of positive evidence that nothing was sent.
  eq(writeFate(bare, { online: false }), 'unreachable', 'a device that was offline sent nothing');
  eq(writeFate(bare, { online: true }), 'unanswered', 'and being online does not make it a refusal');
  eq(writeFate(bare, { online: null }), 'unanswered', 'nor does not having asked');
  // Offline beats even a refusal-shaped error: if nothing was sent, nothing was
  // refused, and the shape came from somewhere else.
  eq(writeFate({ code: '23514' }, { online: false }), 'unreachable',
    'nothing was sent, so nothing was refused');
}

eq(writeFate(null), 'unanswered', 'a throw with nothing in it explains nothing');
eq(writeFate(undefined), 'unanswered', 'and neither does no throw at all');

/* ── the three sentences ───────────────────────────────────────────────── */

{
  const refusedText = failedWriteSentence('refused', PAYMENT, 'duplicate key value');
  ok(refusedText.includes('That payment was NOT saved'), `the refusal names the write — got ${refusedText}`);
  ok(refusedText.includes('duplicate key value'), 'and repeats the database’s own reason');
  ok(refusedText.includes('Nothing was written'), 'and asserts, because it may');
  ok(refusedText.includes('the money is not in the gym record'), 'and says what is therefore true');
  ok(!refusedText.includes(PAYMENT.howToCheck), 'and does not send anybody to check something settled');
}

{
  const unreachableText = failedWriteSentence('unreachable', PAYMENT, 'you are offline');
  ok(unreachableText.includes('never left this device'), `the unsent case says so — got ${unreachableText}`);
  ok(unreachableText.includes('Nothing was sent'), 'and asserts, because it may');
  ok(unreachableText.includes('the money is not in the gym record'), 'and says what is therefore true');
}

{
  const unknownText = failedWriteSentence('unanswered', PAYMENT, 'No reply within 30s for POST /rest/v1 — request timed out.');
  ok(unknownText.includes('was sent and nothing came back'), `the ambiguous case says what happened — got ${unknownText}`);
  ok(/cannot tell you whether it went through/.test(unknownText), 'and refuses to say whether it worked');
  ok(/only the\s+reply lost/.test(unknownText) || unknownText.includes('reply lost'),
    'and names the case that makes it ambiguous');
  ok(unknownText.includes('Do not enter it again'), 'and stops the duplicate the old wording invited');
  ok(unknownText.includes(PAYMENT.howToCheck), 'and hands over the one actionable thing it has');

  // THE ASSERTION THIS FILE IS FOR. The ambiguous sentence must not contain any
  // of the claims the console used to make from a thrown write.
  for (const lie of ['Nothing was saved', 'Nothing was written', 'Nothing was sent',
    'Nothing was taken back', 'still stands in full', 'is unchanged', 'was NOT saved']) {
    ok(!unknownText.includes(lie),
      `“${lie}” is a claim about the database and this state has none — got ${unknownText}`);
  }
}

{
  // The three are three. A screen that printed the same words for all of them
  // would have gained a module and lost nothing else.
  const three = new Set([
    failedWriteSentence('refused', PAYMENT, 'x'),
    failedWriteSentence('unreachable', PAYMENT, 'x'),
    failedWriteSentence('unanswered', PAYMENT, 'x'),
  ]);
  eq(three.size, 3, 'the three states produce three sentences');
}

/* ── punctuation, so a call site does not have to think about it ───────── */

{
  const withStop = failedWriteSentence('refused', PAYMENT, 'it was refused.');
  ok(!withStop.includes('refused..'), `a reason that ends in a full stop does not gain a second — got ${withStop}`);
  const withoutStop = failedWriteSentence('refused', PAYMENT, 'it was refused');
  ok(withoutStop.includes('it was refused.'), 'and one that does not, gains one');
  const noReason = failedWriteSentence('refused', PAYMENT, null);
  ok(noReason.includes('the database refused the write.'),
    `a silent error still produces a whole sentence — got ${noReason}`);
  const trailing = failedWriteSentence('refused', { ...PAYMENT, what: 'That payment.', unchanged: 'nothing moved.' }, 'no');
  ok(trailing.includes('That payment was NOT saved'), 'a subject written with a full stop still opens the sentence');
  ok(trailing.includes('so nothing moved.'), 'and a clause written with one is still joined by “so”');
}

/* ── the whole thing, from a catch ─────────────────────────────────────── */

{
  const err = requestTimeoutError('https://x.supabase.co/rest/v1/gym_payments', 'POST', CALL_CEILING_MS);
  const note = failedWriteNote(err, PAYMENT);
  ok(note.includes('was sent and nothing came back'), 'a caught timeout produces the ambiguous sentence');
  ok(note.includes('30s'), 'carrying the ceiling that fired, so a reader knows how long we waited');
  ok(!note.includes('gym_payments') || note.includes('/rest/v1/gym_payments'),
    'and the URL is the redacted path requestTimeout already produces, not a query string of ids');

  const refusedNote = failedWriteNote({ code: '23505', message: 'duplicate key' }, PAYMENT);
  ok(refusedNote.includes('Nothing was written'), 'and a caught refusal still says so plainly');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('failedWrite: ok');
