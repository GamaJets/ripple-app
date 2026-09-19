// The third state, for the eight kinds that are not chat. Compile with tsc, run
// with node.
//
// Five failures are guarded here, and the first three are the ones a lane has
// actually shipped in this tree before:
//
//   1. A REFUSED ITEM REPORTED AS WAITING TO SEND. `refused` and `unsent` are
//      opposite promises — one says nothing will ever be sent, the other says it
//      will go on the next launch — and a flush that treats a refusal as
//      something to retry makes the queue say "waiting to send" forever about a
//      write the server has already declined.
//
//   2. A REFUSAL THAT REACHES NO SCREEN. `stored` and `refused` are both
//      dropped from the queue, correctly, and that shared drop is exactly what
//      makes a declined write look like a delivered one. The record is the only
//      thing left that knows it happened, so the drop and the record are ONE
//      decision.
//
//   3. AN UNREADABLE PAYLOAD RETRIED FOREVER. Nothing can send bytes nothing can
//      parse. Calling that `unsent` keeps it in the queue, counted, on every
//      reconnect for the life of the install.
//
//   4. A DEVICE STORE ONE ACCOUNT INHERITS FROM ANOTHER. A gym handset is signed
//      in and out all day; a key with no account in it shows one person's
//      refusals to the next.
//
//   5. AN UNREAD STORE ANSWERING "NOTHING OF YOURS WAS REFUSED". A failed read
//      is not an empty record, and the sentence has to say which it was.
import {
  MAX_REFUSED_INTENTS, REFUSED_INTENTS_PREFIX, UNREADABLE_PAYLOAD,
  dropRefusedIntent, flushStep, isRefusedIntentsKey, readRefusedIntents,
  recordRefusedIntent, refusedIntentKinds, refusedIntentNote, refusedIntentsKey,
  refusedIntentsOfKind, refusedIntentsScreenNote, writeRefusedIntents,
  type RefusedIntent,
} from './refusedIntents';
import { OUTBOX_KINDS, outboxNote, lapsedNote, type OutboxKind } from './outbox';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const UID = 'ab5e1d4c-0000-4000-8000-000000000001';
const r = (id: string, kind: OutboxKind, at = '2026-09-14T09:00:00.000Z'): RefusedIntent => ({ id, kind, at });

/* ── 1 · the three states, told apart by the flush ──────────────────────── */

{
  eq(flushStep('goal', 'stored'), 'drop', 'a write that is on the server comes out of the queue with nothing to say');
  eq(flushStep('goal', 'unsent'), 'retry-later',
    'a write nobody answered stays in the queue — that is what the word unsent promises');
  eq(flushStep('goal', 'refused'), 'drop-and-record',
    'a write the server declined ALSO comes out, and the drop is the last moment anything knows it existed');

  // The mutation this is here to fail: `refused` treated as something to retry.
  ok(flushStep('scan', 'refused') !== 'retry-later',
    'a refusal must never be left in the queue — it is refused every time it is offered, and the screen would read "waiting to send" for the life of the install');
  // And its mirror: a silence treated as a verdict.
  ok(flushStep('scan', 'unsent') !== 'drop-and-record',
    'and a silence must never be recorded as a refusal — the server has not said anything about it');

  for (const k of OUTBOX_KINDS) {
    eq(flushStep(k, 'unsent'), 'retry-later', `every kind keeps an unanswered ${k} in the queue`);
    eq(flushStep(k, 'stored'), 'drop', `and takes a stored ${k} out`);
  }
}

/* ── 2 · every kind's refusal is recorded, except the one kept elsewhere ── */

{
  for (const k of OUTBOX_KINDS) {
    if (k === 'message') continue;
    eq(flushStep(k, 'refused'), 'drop-and-record',
      `a refused ${k} is written down — dropping it silently is the defect, and nothing else will ever raise it`);
  }
  eq(flushStep('message', 'refused'), 'drop',
    'a refused message is NOT recorded here: src/lib/refusedMessages.ts already keeps it with the words, and two notices about one event read as two events');
}

/* ── 3 · an unreadable payload ─────────────────────────────────────────── */

{
  eq(UNREADABLE_PAYLOAD, 'refused',
    'a stored payload this build cannot parse is refused, not unsent — nothing can ever send bytes nothing can read');
  eq(flushStep('day-plan', UNREADABLE_PAYLOAD), 'drop-and-record',
    'so it leaves the queue and the member is told, rather than being retried on every reconnect for ever');
}

/* ── 4 · whose record it is ────────────────────────────────────────────── */

{
  eq(refusedIntentsKey(UID), `${REFUSED_INTENTS_PREFIX}${UID}`, 'the key carries the account');
  eq(refusedIntentsKey(null), null, 'nobody signed in is no key at all — never a shared one');
  eq(refusedIntentsKey(''), null, 'and neither is a blank id');
  eq(refusedIntentsKey('   '), null, 'or a whitespace one');
  eq(refusedIntentsKey('unknown'), null,
    "and not the literal 'unknown', which src/ui/clientData.tsx settles on before the auth read lands and which would give every signed-out session on the handset one shared key");
  ok(isRefusedIntentsKey(`${REFUSED_INTENTS_PREFIX}${UID}`), 'a key in the family is recognised');
  ok(!isRefusedIntentsKey(REFUSED_INTENTS_PREFIX), 'the bare prefix is not somebody’s record');
  ok(!isRefusedIntentsKey('outbox:v1:' + UID), 'and the outbox itself is a different family');
}

/* ── 5 · reading the store back ────────────────────────────────────────── */

{
  eq(readRefusedIntents(null).length, 0, 'nothing stored is no refusals');
  eq(readRefusedIntents('not json').length, 0, 'and neither is a blob that will not parse');
  eq(readRefusedIntents('{"id":"a"}').length, 0, 'or one that is not a list');

  const kept = readRefusedIntents(JSON.stringify([
    { id: 'a', kind: 'goal', at: '2026-09-14T09:00:00.000Z' },
    { id: '', kind: 'goal', at: '2026-09-14T09:00:00.000Z' },
    { id: 'a', kind: 'scan', at: '2026-09-14T09:00:00.000Z' },
    { id: 'c', kind: 'not-a-kind', at: '2026-09-14T09:00:00.000Z' },
    { id: 'd', kind: 'glucose', at: 'whenever' },
  ]));
  eq(kept.length, 2, 'an entry with no id, a repeat of one already read, and a kind this build has no noun for are all dropped');
  eq(kept[0].id, 'a', 'the first sighting of an id is the one kept');
  eq(kept[0].kind, 'goal', 'with its own kind');
  eq(kept[1].at, '', 'a stamp that will not parse is kept as no stamp — it must never become the moment of the read');

  const round = readRefusedIntents(writeRefusedIntents([r('a', 'goal'), r('b', 'scan')]));
  eq(round.length, 2, 'what is written is what comes back');
  eq(round[1].kind, 'scan', 'kind and all');
}

/* ── 6 · adding, capping and dismissing ────────────────────────────────── */

{
  let list: RefusedIntent[] = [];
  list = recordRefusedIntent(list, r('a', 'goal'));
  list = recordRefusedIntent(list, r('b', 'session-request'));
  eq(list.length, 2, 'two refusals are two entries');
  list = recordRefusedIntent(list, r('a', 'goal', '2026-09-14T10:00:00.000Z'));
  eq(list.length, 2, 'the same id twice is one entry, not two things that did not happen');
  eq(list[1].id, 'a', 'and it moves to the end as the newest');

  eq(recordRefusedIntent(list, { id: '', kind: 'goal', at: '' }).length, 2,
    'an entry nobody could dismiss is not kept');
  eq(recordRefusedIntent(list, { id: 'z', kind: 'nope' as OutboxKind, at: '' }).length, 2,
    'and neither is one this build has no sentence for');

  let full: RefusedIntent[] = [];
  for (let i = 0; i < MAX_REFUSED_INTENTS + 3; i += 1) full = recordRefusedIntent(full, r(`i${i}`, 'glucose'));
  eq(full.length, MAX_REFUSED_INTENTS, 'the record is capped');
  eq(full[0].id, 'i3', 'and it is the OLDEST that goes — the newest refusal is the one still worth acting on');

  eq(dropRefusedIntent(list, 'a').length, 1, 'a refusal the person has read comes off the device');
  eq(dropRefusedIntent(list, 'missing').length, 2, 'and dismissing one that is not there changes nothing');
}

/* ── 7 · grouping, the way a screen draws it ───────────────────────────── */

{
  const list = [r('a', 'goal'), r('b', 'scan'), r('c', 'goal')];
  eq(refusedIntentsOfKind(list, 'goal').length, 2, 'two goals were refused');
  eq(refusedIntentsOfKind(list, 'day-plan').length, 0, 'and no planned days');
  eq(refusedIntentKinds(list).join(','), 'goal,scan', 'one line per kind, in the order they were refused, with no kind twice');
  eq(refusedIntentKinds([]).length, 0, 'an empty record draws nothing');
}

/* ── 8 · the sentences, and the promise they must not make ─────────────── */

{
  eq(refusedIntentNote(0, 'goal'), null, 'nothing refused is no banner about nothing');

  for (const k of OUTBOX_KINDS) {
    const one = refusedIntentNote(1, k);
    ok(!!one, `every kind has a sentence — ${k}`);
    ok(!!one && !/waiting to send/i.test(one),
      `a refused ${k} is never described as waiting to send: nothing is waiting and nothing will be sent`);
    ok(!!one && /not be tried again/.test(one),
      `and a refused ${k} says plainly that it will not be retried`);
    ok(!!one && /Nothing reached anyone/.test(one),
      `and that nobody has it — a member whose ${k} was refused must not believe it landed`);
  }

  const many = refusedIntentNote(3, 'glucose');
  ok(!!many && /3 blood sugar readings/.test(many), 'several of one kind are counted and named in the member’s own words');

  // The two sentences either side of this one, which must stay different: the
  // outbox's promise, and the lapse notice's statement about time.
  const waiting = outboxNote(1, 'goal');
  ok(!!waiting && /not sent yet/.test(waiting), 'the outbox note still promises a goal will go up');
  ok(!!refusedIntentNote(1, 'goal') && refusedIntentNote(1, 'goal') !== waiting,
    'and the refusal note is not that sentence');
  ok(!/waiting to send for too long/.test(refusedIntentNote(1, 'goal') ?? ''),
    'nor the lapse one — the server was reached and said no, which is not a statement about time');
  ok(/waiting to send for too long/.test(lapsedNote('goal')),
    'which is what the lapse sentence does say, so the two cannot be swapped without the member being told the wrong reason');
}

/* ── 9 · the screen-level sentence, and the zero nobody measured ────────── */

{
  eq(refusedIntentsScreenNote([], 'loading'), null, 'nothing is claimed while the device is still being read');
  eq(refusedIntentsScreenNote([], 'ready'), null, 'a record that was read and is empty says nothing');

  const one = refusedIntentsScreenNote([r('a', 'goal')], 'ready');
  ok(!!one && /refused by the server and never sent/.test(one), 'one refusal says so');
  const two = refusedIntentsScreenNote([r('a', 'goal'), r('b', 'scan')], 'ready');
  ok(!!two && /^2 things/.test(two), 'and several are counted');

  const unread = refusedIntentsScreenNote(null, 'ready');
  ok(!!unread && /could not say/.test(unread),
    'a device with no record at all must not answer "nothing of yours was refused"');
  eq(refusedIntentsScreenNote([], 'error'), unread,
    'and a read that failed says the same, even with a count of zero — a failed read is not an empty list');
  const partial = refusedIntentsScreenNote([r('a', 'goal')], 'partial');
  ok(!!partial && /could not read everything/.test(partial),
    "a partly-read record is never presented as the whole of it, and 'partial' is never counted or called empty");
}

if (errors.length) {
  console.error(`refusedIntents: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('refusedIntents: ok');
