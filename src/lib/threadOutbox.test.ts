// What a thread list owes the words still on the handset. Compile with tsc,
// run with node.
//
// Four failures are guarded here, and the first is the reason the file exists:
//
//   1. A QUEUED REPLY RENDERED AS NOTHING AT ALL. A coach's inbox is drawn
//      from the server, so a reply typed with no signal is invisible there —
//      the thread still reads as the client's last word, and the coach either
//      believes they did not answer or believes they did.
//
//   2. A COUNT WITH NO DENOMINATOR. "3 waiting" over a list that shows two of
//      them is the shape this codebase keeps finding: the sentence has to say
//      how many of the held messages are on a row the reader can see.
//
//   3. AN UNREAD QUEUE READ AS AN EMPTY ONE. If the device's outbox could not
//      be read, the ABSENCE of marks is not evidence, and the screen has to say
//      so — including, and especially, when the count it has is zero.
//
//   4. A TIME INVENTED FOR A WORD THAT CARRIES NONE. An unreadable stamp must
//      not become "just now", and must not displace a readable one.
import {
  outboxThreadsNote, queuedByThread, queuedThreadNote, queuedTotal, unaddressedQueued,
  type QueuedWord,
} from './threadOutbox';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const A = 'client-a';
const B = 'client-b';
const w = (clientId: string, at: string): QueuedWord => ({ clientId, at });

/* ── 1 · the words are found, and grouped by the thread they are for ────── */

{
  const words = [
    w(A, '2026-09-14T09:00:00.000Z'),
    w(B, '2026-09-14T09:05:00.000Z'),
    w(A, '2026-09-14T08:00:00.000Z'),
  ];
  const g = queuedByThread(words);
  eq(g.size, 2, 'two threads are holding something');
  eq(g.get(A)?.count, 2, 'and one of them is holding two');
  eq(g.get(A)?.oldestAt, '2026-09-14T08:00:00.000Z', 'the oldest stamp is the one kept, whatever order they arrive in');
  eq(g.get('nobody'), undefined, 'a thread holding nothing has no entry, rather than an entry saying zero');
  eq(queuedTotal(words), 3, 'the total is every word on the phone');
}

{
  eq(queuedThreadNote(undefined), null, 'a row with nothing queued draws no mark');
  eq(queuedThreadNote({ count: 0, oldestAt: null }), null, 'and neither does a zero that somehow reached here');
  const one = queuedThreadNote({ count: 1, oldestAt: '2026-09-14T09:00:00.000Z' });
  ok(!!one && /waiting to send/.test(one), 'one queued reply says it is waiting');
  ok(!!one && /cannot see it yet/.test(one), 'and says the client cannot see it — a count on its own reads as an unread badge');
  const two = queuedThreadNote({ count: 2, oldestAt: null });
  ok(!!two && two.startsWith('2 '), 'two says two');
  ok(!!two && /cannot see them yet/.test(two), 'and still says nobody has them');
}

/* ── and how long it has been waiting, which was collected and never said ── */

{
  const NOW = Date.parse('2026-09-14T12:00:00.000Z');
  const aged = queuedThreadNote({ count: 1, oldestAt: '2026-09-12T12:00:00.000Z' }, NOW);
  ok(!!aged && /It has been waiting 2 days\./.test(aged), 'a reply stuck on the handset for two days says so — undated it reads as one typed a moment ago');
  const many = queuedThreadNote({ count: 3, oldestAt: '2026-09-14T09:00:00.000Z' }, NOW);
  ok(!!many && /The oldest has been waiting 3 hours\./.test(many), 'and a thread holding several is timed by the oldest of them');

  const noClock = queuedThreadNote({ count: 1, oldestAt: '2026-09-12T12:00:00.000Z' });
  ok(!!noClock && !/waiting 2/.test(noClock), 'with no clock the age is left off rather than guessed');
  const noStamp = queuedThreadNote({ count: 1, oldestAt: null }, NOW);
  ok(!!noStamp && !/has been waiting/.test(noStamp), 'and a word that carried no readable stamp gets no age either');
  const future = queuedThreadNote({ count: 1, oldestAt: '2026-09-15T12:00:00.000Z' }, NOW);
  ok(!!future && !/has been waiting/.test(future), 'a stamp in the future is a clock disagreeing with itself, not an age');
  const unreadable = queuedThreadNote({ count: 1, oldestAt: 'not a date' }, NOW);
  ok(!!unreadable && !/has been waiting/.test(unreadable), 'and neither is one that will not parse');
}

/* ── 4 · stamps ────────────────────────────────────────────────────────── */

{
  const g = queuedByThread([w(A, 'not a date'), w(A, '2026-09-14T07:00:00.000Z')]);
  eq(g.get(A)?.count, 2, 'a word with an unreadable stamp is still a word on the phone');
  eq(g.get(A)?.oldestAt, '2026-09-14T07:00:00.000Z', 'and never displaces a readable stamp');
  const only = queuedByThread([w(A, 'not a date')]);
  eq(only.get(A)?.oldestAt, null, 'a thread whose only word has no readable stamp reports no time rather than inventing one');
  eq(only.get(A)?.count, 1, 'while still being counted');
}

/* ── the ones with no thread on them ───────────────────────────────────── */

{
  const words = [w(A, '2026-09-14T09:00:00.000Z'), w('', '2026-09-14T09:00:00.000Z'), w('  ', 'x')];
  eq(queuedByThread(words).size, 1, 'a word with no thread key is on no row');
  eq(unaddressedQueued(words), 2, 'and is counted separately rather than dropped in silence');
  eq(queuedTotal(words), 3, 'so the two halves add up to the queue');
}

/* ── 2 + 3 · the screen-level sentence ─────────────────────────────────── */

{
  const shown = new Set([A, B]);
  eq(outboxThreadsNote([], 'ready', shown), null, 'a read outbox with nothing in it says nothing');

  const all = outboxThreadsNote([w(A, '2026-09-14T09:00:00.000Z')], 'ready', shown);
  ok(!!all && /1 message is waiting to send/.test(all), 'one held message says so');
  ok(!!all && /Nobody has been sent it yet/.test(all), 'and says nobody has it');
  ok(!!all && !/ of /.test(all), 'with no denominator when every one of them is on a row the coach can see');

  const some = outboxThreadsNote(
    [w(A, '2026-09-14T09:00:00.000Z'), w('client-gone', '2026-09-14T09:00:00.000Z')],
    'ready', shown);
  ok(!!some && /1 of 2/.test(some), 'a message addressed to a thread that is not on the list says its denominator');
}

{
  const shown = new Set([A]);
  const unread = outboxThreadsNote([], 'partial', shown);
  ok(!!unread && /could not read/.test(unread), 'an outbox that could not be read is said out loud, even with a count of zero');
  eq(outboxThreadsNote([], 'error', shown), unread, 'a failed read of it says the same');
  const none = outboxThreadsNote(null, 'ready', shown);
  ok(!!none && /could not say/.test(none), 'and so does a screen with no outbox above it at all');
}

if (errors.length) {
  console.error(`threadOutbox: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('threadOutbox: ok');
