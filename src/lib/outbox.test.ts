// The durable queue for the surfaces that never had one. Compile with tsc, run
// with node.
//
// Five failures are guarded here. Each one is a thing somebody typed:
//
//   1. AN UNREADABLE OUTBOX READ AS AN EMPTY ONE. Same rule, same reason, as
//      src/lib/workoutQueue.ts and src/lib/offlineQueue.ts · `serverRows`:
//      bytes nobody could parse are not "nothing is waiting". Collapse them and
//      the next write serialises a list that cannot contain the unseen intents
//      over the top of them, and a week of offline messages goes in one line.
//
//   2. A CAP THAT EVICTS. The obvious cap drops the oldest item to make room.
//      That is silent loss chosen by a constant. `addItem` must refuse and say
//      so, leaving the caller something it can put in front of a person.
//
//   3. A LAPSED INTENT SENT ANYWAY, OR DROPPED SILENTLY. Anything with an
//      expiry has to come out of the live list AND be handed back, because the
//      member believes it happened.
//
//   4. MESSAGES SENT OUT OF ORDER. Two messages typed in a basement are a
//      conversation. Replayed newest-first they are a different one.
//
//   5. A NOTE THAT CLAIMS DELIVERY. The copy has to say the work is safe
//      without implying anybody has read it — the exact line
//      src/lib/offlineQueue.ts · `unsentNote` walks, for the same reason.
import {
  OUTBOX_CAP, OUTBOX_KINDS, addItem, bumpTry, dropItem, inOrder, isOutboxKind, kindNoun, lapsedNote,
  newItem, ofKind, outboxKey, outboxNote, partitionLapsed, readOutbox, type OutboxItem,
} from './outbox';
import { isPending } from './wellnessSync';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const UID = '11111111-1111-1111-1111-111111111111';

/* ── ids and keys ──────────────────────────────────────────────────────── */

{
  const a = newItem('message', { body: 'hi' });
  const b = newItem('message', { body: 'hi' });
  ok(a.id !== b.id, 'two intents made in the same millisecond are still two intents');
  ok(isPending(a.id), 'an outbox id is a local id: nothing may mistake it for a server key');
  eq(a.tries, 0, 'a new intent has not been tried');
  eq(a.expiresAt, null, 'and does not expire unless somebody says so');
  ok(outboxKey(UID).includes(UID), 'the outbox is per account, so two people sharing a phone do not inherit each other');
}

/* ── 1 · reading the device ────────────────────────────────────────────── */

{
  eq(readOutbox(null).read, true, 'a key that was never written is a real empty queue');
  eq(readOutbox(null).items.length, 0, 'and it holds nothing');
  eq(readOutbox('{ not json').read, false, 'bytes nobody could parse are NOT an empty queue');
  eq(readOutbox('{"kind":"message"}').read, false, 'and neither is something that is not a list');

  const good = newItem('measurement', { waist: 80 });
  const raw = JSON.stringify([good, { id: 'x', at: '2026-01-01T00:00:00.000Z', kind: 'not-a-kind' }, { kind: 'message' }]);
  const back = readOutbox(raw);
  eq(back.read, true, 'a row this file could not use is not a file it could not read');
  eq(back.items.length, 1, 'the unusable rows are dropped');
  eq(back.items[0].id, good.id, 'and the good one survives intact');
  eq(back.items[0].kind, 'measurement', 'with its kind');
  eq((back.items[0].payload as any).waist, 80, 'and its payload');

  ok(isOutboxKind('message'), 'the union is what the handler registry is keyed on');
  ok(!isOutboxKind('booking'), 'and a seat somebody else can take is not in it');
  ok(!isOutboxKind('injury'), 'nor a profile write, which src/ui/clientData.tsx re-sends from state');
}

{
  // Round trip: what is written is what comes back, including tries.
  const one = { ...newItem('pt-approval', { id: 's9' }), tries: 3 };
  const back = readOutbox(JSON.stringify([one]));
  eq(back.items[0].tries, 3, 'the attempt count survives a relaunch, or the diagnostics lie');
}

/* ── 2 · the cap refuses rather than evicts ────────────────────────────── */

{
  let list: OutboxItem[] = [];
  const first = newItem('measurement', { waist: 1 });
  list = addItem(list, first).list;
  for (let i = 1; i < OUTBOX_CAP; i++) list = addItem(list, newItem('measurement', { waist: i + 1 })).list;
  eq(list.length, OUTBOX_CAP, 'the cap is reached exactly');
  const res = addItem(list, newItem('measurement', { waist: 999 }));
  eq(res.added, false, 'and the next one is refused, not swallowed');
  eq(res.list.length, OUTBOX_CAP, 'the list is unchanged');
  ok(res.list[0].id === first.id, 'and specifically the OLDEST intent was not evicted to make room');
}

/* ── drop and bump ─────────────────────────────────────────────────────── */

{
  const a = newItem('message', { body: 'one' });
  const b = newItem('message', { body: 'two' });
  const list = [a, b];
  eq(dropItem(list, a.id).length, 1, 'a stored intent comes out');
  eq(dropItem(list, a.id)[0].id, b.id, 'and takes nothing with it');
  eq(dropItem(list, 'nobody').length, 2, 'dropping an id that is not there changes nothing');
  const bumped = bumpTry(list, b.id);
  eq(bumped[1].tries, 1, 'a try is counted');
  eq(bumped[0].tries, 0, 'on the one that was tried and no other');
}

/* ── 3 · lapsing ───────────────────────────────────────────────────────── */

{
  const now = Date.parse('2026-09-02T12:00:00.000Z');
  const live = newItem('measurement', { waist: 80 });
  const gone = newItem('pt-approval', { id: 's1' }, { expiresAt: '2026-09-02T11:59:59.000Z' });
  const stillGood = newItem('pt-approval', { id: 's2' }, { expiresAt: '2026-09-03T00:00:00.000Z' });
  const junk = newItem('pt-approval', { id: 's3' }, { expiresAt: 'not a date' });
  const p = partitionLapsed([live, gone, stillGood, junk], now);
  eq(p.lapsed.length, 1, 'only the one that is actually past its moment lapses');
  eq(p.lapsed[0].id, gone.id, 'and it is that one');
  eq(p.live.length, 3, 'the rest are still worth sending');
  ok(p.live.some((i) => i.id === junk.id), 'an expiry this file could not read is treated as no expiry, never as already lapsed');
  ok(lapsedNote('pt-approval').includes('not sent'), 'and the member is told plainly that it did not happen');
  ok(!/will be sent|we will/i.test(lapsedNote('message')), 'a lapsed intent must not promise anything further');
}

/* ── 4 · order ─────────────────────────────────────────────────────────── */

{
  const older = newItem('message', { body: 'first' }, { at: '2026-09-01T10:00:00.000Z' });
  const newer = newItem('message', { body: 'second' }, { at: '2026-09-01T10:05:00.000Z' });
  const other = newItem('measurement', { waist: 80 }, { at: '2026-09-01T09:00:00.000Z' });
  const msgs = ofKind([newer, other, older], 'message');
  eq(msgs.length, 2, 'one kind at a time');
  eq((msgs[0].payload as any).body, 'first', 'oldest first: a thread replayed backwards is a different conversation');
  eq(inOrder([newer, other, older])[0].id, other.id, 'and across kinds it is still the order they happened in');
}

/* ── 5 · the copy ──────────────────────────────────────────────────────── */

{
  eq(outboxNote(0, 'message'), null, 'nothing waiting draws no banner');
  const one = outboxNote(1, 'measurement') ?? '';
  ok(one.includes('measurement') && !one.includes('measurements'), 'one is singular');
  ok((outboxNote(2, 'measurement') ?? '').includes('measurements'), 'two is plural');
  ok(one.includes('not sent yet'), 'the sentence says it has not gone');
  ok(!/sent to your coach|delivered|read/i.test(one), 'and never implies anybody has seen it');
  ok(one.includes('this phone'), 'while making clear the work is not lost');
  eq(kindNoun('pt-approval').many, 'session approvals', 'every kind has a noun, so no sentence can be assembled without one');
}

// ── 6. A KIND WITH NO SENTENCE ───────────────────────────────────────────
//
// `OUTBOX_KINDS` is what app/(client)/dashboard.tsx walks to draw "still on
// this phone" and "was not sent". A kind added to the union but not to the list
// is an intent that queues, lapses and is discarded with nothing on any screen
// about it — which is the whole failure these sentences were written for, so it
// is asserted rather than trusted.
{
  eq(OUTBOX_KINDS.length, 3, 'the list has one entry per kind in the union');
  for (const k of OUTBOX_KINDS) {
    ok(isOutboxKind(k), `${k} is recognised coming back off the disk`);
    const n = kindNoun(k);
    ok(!!n.one && !!n.many, `${k} has a singular and a plural to be named by`);
    ok((outboxNote(1, k) ?? '').includes(n.one), `${k} names itself in the waiting line`);
    ok(lapsedNote(k).includes(n.one), `${k} names itself in the lapsed line`);
  }
  eq(outboxNote(0, 'message'), null, 'nothing waiting draws no line at all');
  ok(!isOutboxKind('booking'), 'and a booking is still not a kind — see the header for why');
}

if (errors.length) {
  console.error(`outbox: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('outbox: ok');
