// What a handset owes the messages the server refused. Compile with tsc, run
// with node.
//
// Five failures are guarded here, and the first is the reason the file exists:
//
//   1. `refused` COLLAPSING INTO `stored`. A refused message is dropped from
//      the outbox, so its "waiting to send" mark disappears — and a row with no
//      mark is exactly what a delivered message looks like. The record has to
//      keep it, and the sentence has to say it will NOT be sent again, because
//      "waiting to send" would be the same lie the other way round.
//
//   2. A COUNT WITH NO DENOMINATOR. A refusal for a conversation that is not on
//      the list must be counted and said to be off-screen, not marked nowhere.
//
//   3. AN UNREAD RECORD READ AS AN EMPTY ONE. If the store could not be read,
//      the absence of marks is not evidence, including when the count is zero.
//
//   4. A TIME INVENTED FOR A MESSAGE THAT CARRIES NONE. An unreadable stamp
//      must not become "just now", and must not displace a readable one.
//
//   5. A DEVICE-GLOBAL KEY HOLDING SOMEBODY'S WORDS. The store holds message
//      bodies; a key without an account in it shows them to whoever signs in
//      next.
import {
  MAX_REFUSED, REFUSED_MESSAGES_PREFIX, dropRefusal, isRefusedMessagesKey, readRefusedMessages,
  recordRefusal, refusedBodyNote, refusedByThread, refusedForThread, refusedMessagesKey,
  refusedScreenNote, refusedThreadNote, unaddressedRefused, writeRefusedMessages,
  type RefusedMessage,
} from './refusedMessages';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const A = 'client-a';
const B = 'client-b';
const UID = '11111111-1111-1111-1111-111111111111';
const OTHER_UID = '22222222-2222-2222-2222-222222222222';
const NOW = Date.parse('2026-09-14T12:00:00.000Z');

const r = (id: string, clientId: string, at: string, body = 'come at 7'): RefusedMessage =>
  ({ id, clientId, sender: 'coach', body, at });

/* ── 1 · the refusal is kept, and says it will not be retried ───────────── */

{
  const note = refusedThreadNote({ count: 1, newestAt: '2026-09-14T09:00:00.000Z' }, NOW);
  ok(!!note && /refused/.test(note), 'a refused reply is described as refused');
  ok(!!note && /not been delivered/.test(note), 'and as not delivered');
  ok(!!note && /will not be sent again/.test(note), 'and says it will NOT be retried — "waiting to send" would be the same lie the other way round');
  ok(!!note && !/waiting/i.test(note), 'and never borrows the queue’s word for it');
  ok(!!note && /3 hours ago/.test(note), 'and says how long the person has believed otherwise');

  const two = refusedThreadNote({ count: 2, newestAt: null }, NOW);
  ok(!!two && two.startsWith('2 '), 'two says two');
  ok(!!two && /They will not be sent again/.test(two), 'and agrees with itself about number');
  ok(!!two && !/ago/.test(two), 'and says no age for a refusal that carried no readable stamp');

  eq(refusedThreadNote(undefined, NOW), null, 'a row with nothing refused draws no mark');
  eq(refusedThreadNote({ count: 0, newestAt: null }, NOW), null, 'and neither does a zero that reached here');
  const noClock = refusedThreadNote({ count: 1, newestAt: '2026-09-14T09:00:00.000Z' });
  ok(!!noClock && !/ago/.test(noClock), 'with no clock the age is left off rather than guessed');
}

/* ── the record itself ─────────────────────────────────────────────────── */

{
  let list: RefusedMessage[] = [];
  list = recordRefusal(list, r('i1', A, '2026-09-14T09:00:00.000Z'));
  list = recordRefusal(list, r('i2', B, '2026-09-14T10:00:00.000Z'));
  eq(list.length, 2, 'two refusals are two entries');
  list = recordRefusal(list, r('i1', A, '2026-09-14T09:00:00.000Z'));
  eq(list.length, 2, 'the same refusal recorded twice is one entry, not two refusals of one message');
  eq(dropRefusal(list, 'i1').length, 1, 'a refusal the person has read comes out');
  eq(dropRefusal(list, 'nope').length, 2, 'and an id nobody holds changes nothing');
  eq(recordRefusal(list, r('', A, '2026-09-14T09:00:00.000Z')).length, 2, 'an entry with no id is refused — nothing could ever dismiss it');

  let full: RefusedMessage[] = [];
  for (let i = 0; i < MAX_REFUSED + 5; i += 1) full = recordRefusal(full, r(`x${i}`, A, '2026-09-14T09:00:00.000Z'));
  eq(full.length, MAX_REFUSED, 'the store is capped');
  eq(full[full.length - 1].id, `x${MAX_REFUSED + 4}`, 'and the newest refusal is the one kept');
  eq(full[0].id, 'x5', 'the oldest is the one dropped');
}

/* ── 4 · stamps ────────────────────────────────────────────────────────── */

{
  const g = refusedByThread([r('i1', A, 'not a date'), r('i2', A, '2026-09-14T07:00:00.000Z')]);
  eq(g.get(A)?.count, 2, 'a refusal with an unreadable stamp is still a refusal');
  eq(g.get(A)?.newestAt, '2026-09-14T07:00:00.000Z', 'and never displaces a readable stamp');
  const only = refusedByThread([r('i1', A, 'not a date')]);
  eq(only.get(A)?.newestAt, null, 'a thread whose only refusal has no readable stamp reports no time rather than inventing one');
  eq(only.get(A)?.count, 1, 'while still being counted');
  const newest = refusedByThread([r('i1', A, '2026-09-14T07:00:00.000Z'), r('i2', A, '2026-09-14T11:00:00.000Z')]);
  eq(newest.get(A)?.newestAt, '2026-09-14T11:00:00.000Z', 'the newest stamp is the one kept, whatever order they arrive in');

  const parsed = readRefusedMessages(JSON.stringify([{ id: 'i1', clientId: A, sender: 'coach', body: 'x', at: 'nonsense' }]));
  eq(parsed[0].at, '', 'a stamp that will not parse is read back as no stamp at all');
}

/* ── the ones with no thread on them ───────────────────────────────────── */

{
  const list = [r('i1', A, '2026-09-14T09:00:00.000Z'), r('i2', '', '2026-09-14T09:00:00.000Z', '')];
  eq(refusedByThread(list).size, 1, 'a refusal whose payload could not be read is on no row');
  eq(unaddressedRefused(list), 1, 'and is counted separately rather than dropped in silence');
}

/* ── 2 + 3 · the screen-level sentence ─────────────────────────────────── */

{
  const shown = new Set([A, B]);
  eq(refusedScreenNote([], 'ready', shown), null, 'a read record with nothing in it says nothing');

  const all = refusedScreenNote([r('i1', A, '2026-09-14T09:00:00.000Z')], 'ready', shown);
  ok(!!all && /1 message was refused/.test(all), 'one refusal says so');
  ok(!!all && /never delivered/.test(all), 'and says nobody got it');
  ok(!!all && !/ of /.test(all), 'with no denominator when every one of them is on a row the reader can see');

  const some = refusedScreenNote(
    [r('i1', A, '2026-09-14T09:00:00.000Z'), r('i2', 'client-gone', '2026-09-14T09:00:00.000Z')],
    'ready', shown);
  ok(!!some && /1 of 2/.test(some), 'a refusal for a conversation that is not on the list says its denominator');

  const unread = refusedScreenNote([], 'partial', shown);
  ok(!!unread && /could not read/.test(unread), 'a record that could not be read is said out loud, even with a count of zero');
  eq(refusedScreenNote([], 'error', shown), unread, 'a failed read of it says the same');
  const none = refusedScreenNote(null, 'ready', shown);
  ok(!!none && /could not say/.test(none), 'and so does a screen with no record above it at all');
  eq(refusedScreenNote(null, 'loading', shown), null, 'but a device still being read says nothing — the doubt has not been established yet');
  eq(refusedScreenNote([r('i1', A, '2026-09-14T09:00:00.000Z')], 'loading', shown), null, 'and neither does a half-read one with something in it');
}

/* ── 5 · whose record it is ────────────────────────────────────────────── */

{
  const mine = refusedMessagesKey(UID);
  ok(mine !== null, 'a signed-in account has a key');
  ok(mine !== refusedMessagesKey(OTHER_UID), 'and it is not the next person’s — this store holds message bodies');
  ok(!!mine && mine.startsWith(REFUSED_MESSAGES_PREFIX), 'the family is recognisable');
  ok(!!mine && isRefusedMessagesKey(mine), 'and the predicate agrees');
  ok(!isRefusedMessagesKey(REFUSED_MESSAGES_PREFIX), 'the bare prefix is not a key — it would be device-global wearing a scoped shape');
  eq(refusedMessagesKey(null), null, 'a signed-out device keeps nothing');
  eq(refusedMessagesKey(''), null, 'an empty id is not an account');
  eq(refusedMessagesKey('   '), null, 'nor is whitespace');
  eq(refusedMessagesKey('unknown'), null, '“unknown” is what a resolver says when it could not tell, and it is refused by name');
}

/* ── reading the words back ────────────────────────────────────────────── */

{
  const list = [
    r('i1', A, '2026-09-14T09:00:00.000Z', 'first'),
    r('i2', A, '2026-09-14T11:00:00.000Z', 'second'),
    r('i3', B, '2026-09-14T10:00:00.000Z', 'someone else'),
  ];
  const forA = refusedForThread(list, A);
  eq(forA.length, 2, 'only this conversation’s refusals');
  eq(forA[0].body, 'second', 'newest first — this is not the conversation, it is what did not join it');
  eq(refusedForThread(list, null).length, 0, 'a screen with no thread key gets none');
  eq(refusedForThread(list, 'nobody').length, 0, 'and so does one nothing was refused for');

  const note = refusedBodyNote(list[1], NOW);
  ok(/Not delivered/.test(note), 'the line above the words says they did not go');
  ok(/copy them/.test(note), 'and that they are about to be lost if nothing is done');
  const empty = refusedBodyNote({ ...list[1], body: '   ' }, NOW);
  ok(/not recoverable/.test(empty), 'a message whose words could not be read says so rather than drawing a blank line');
}

/* ── the store round-trips ─────────────────────────────────────────────── */

{
  const list = [r('i1', A, '2026-09-14T09:00:00.000Z', 'come at 7')];
  const back = readRefusedMessages(writeRefusedMessages(list));
  eq(back.length, 1, 'what is written is what is read');
  eq(back[0].body, 'come at 7', 'and the words survive the trip — they are the whole point of the store');
  eq(readRefusedMessages('not json').length, 0, 'an unreadable blob is no refusals');
  eq(readRefusedMessages(null).length, 0, 'and so is nothing at all');
  eq(readRefusedMessages('{"id":"i1"}').length, 0, 'a stored object that is not a list is no refusals');
  eq(readRefusedMessages(JSON.stringify([{ clientId: A }])).length, 0, 'an entry with no id is dropped');
  eq(readRefusedMessages(JSON.stringify([{ id: 'i1', sender: 'nonsense' }]))[0].sender, 'client', 'a sender this build does not know is narrowed, never widened');
  eq(readRefusedMessages(JSON.stringify([{ id: 'i1' }, { id: 'i1' }])).length, 1, 'a duplicated id is one entry');
}

if (errors.length) {
  console.error(`refusedMessages: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('refusedMessages: ok');
