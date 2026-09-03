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
  mergeLapsed, newRowId, outboxLapsedKey,
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

{
  // A hole in the list, which JSON.stringify of a sparse array really does
  // produce. The row guard has to SKIP these; reaching for `.kind` on one
  // throws, the throw is caught by the same handler that catches unparseable
  // bytes, and the whole queue comes back `read: false` — so one null entry
  // stops the device writing at all and every intent behind it sits there
  // until the app is reinstalled. One bad row is not an unreadable file.
  const good = newItem('goal', { kind: 'weight' });
  const withHoles = readOutbox(`[null, ${JSON.stringify(good)}, 7, "text"]`);
  eq(withHoles.read, true, 'a null entry among the rows is a bad ROW, not a file that could not be read');
  eq(withHoles.items.length, 1, 'it and the other non-objects are skipped');
  eq(withHoles.items[0].id, good.id, 'and the real intent behind them still comes back');
}

{
  // The two coerced fields, neither of which any other assertion here supplies
  // in a broken form.
  const at = '2026-09-01T09:00:00.000Z';
  const row = (o: Record<string, unknown>) =>
    readOutbox(JSON.stringify([{ id: 'i1', kind: 'message', at, payload: null, ...o }])).items[0];

  eq(row({ tries: 'seven' }).tries, 0,
    'a tries count that is not a number reads as none tried — a phone that has never sent must not report an attempt it never made');
  eq(row({}).tries, 0, 'and so does one that was never written');

  // `expiresAt` is what `partitionLapsed` reads, and it is the only thing
  // standing between a lapsing intent and being replayed weeks late. Dropping
  // a real expiry is the dangerous direction: the intent then never lapses.
  eq(row({ expiresAt: at }).expiresAt, at, 'a written expiry survives the relaunch, or the intent never lapses and is replayed long after it stopped meaning anything');
  eq(row({ expiresAt: 1_759_000_000 }).expiresAt, null, 'and an expiry of the wrong shape is no expiry rather than a value nothing can parse');
  eq(row({}).expiresAt, null, 'an intent with no expiry keeps none');
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
  // The boundary itself, which the fixture above steps around by a second on
  // each side. `<=` and `<` differ only at the instant an expiry equals now,
  // and an intent whose moment has exactly arrived has stopped meaning
  // anything — sending it is the thing the expiry was set to prevent.
  const onTheDot = newItem('pt-approval', { id: 's4' }, { expiresAt: new Date(now).toISOString() });
  const edge = partitionLapsed([onTheDot], now);
  eq(edge.lapsed.length, 1, 'an expiry that has exactly arrived HAS lapsed — the boundary is inclusive');
  eq(edge.live.length, 0, 'and it is not still offered for sending');
  const aMsLeft = partitionLapsed([newItem('pt-approval', { id: 's5' }, { expiresAt: new Date(now + 1).toISOString() })], now);
  eq(aMsLeft.lapsed.length, 0, 'and one millisecond before it, it has not');

  ok(lapsedNote('pt-approval').includes('not sent'), 'and the member is told plainly that it did not happen');
  ok(!/will be sent|we will/i.test(lapsedNote('message')), 'a lapsed intent must not promise anything further');
}

/* ── 3a · the id that makes a replay safe ──────────────────────────────── */
//
// At-least-once delivery: the insert lands, the answer is lost, `classifyWrite`
// says 'unsent' and the intent is offered again. Whether the member ends up
// with one row or two comes down to who chose the key, so this is the whole of
// the difference between a queue and a duplicating machine.

{
  const id = newRowId();
  ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id),
    `A ROW ID MUST BE A UUID THE COLUMN WILL TAKE — got "${id}"`);
  const seen = new Set<string>();
  for (let i = 0; i < 5000; i++) seen.add(newRowId());
  eq(seen.size, 5000, 'and two rows must never be given the same one');
}

/* ── 3b · the notice outlives the process ──────────────────────────────── */
//
// A lapsed intent is out of `outboxKey` the instant it lapses — it must never
// be sent — so from that line onwards the lapse notice is the ONLY record it
// ever existed. Held in React state alone it was a member being told only if
// they happened to look at the home screen before the process next ended, and
// a swipe-away or an OS reclaim took Tuesday's planned day with it in silence.
// `mergeLapsed` is what goes to the device, so what it keeps is what somebody
// actually gets told.

{
  const a = newItem('day-plan', { d: 1 }, { at: '2026-09-01T09:00:00.000Z' });
  const b = newItem('day-plan', { d: 2 }, { at: '2026-09-02T09:00:00.000Z' });
  const g = newItem('goal', { kind: 'weight' }, { at: '2026-09-01T08:00:00.000Z' });

  // One line per kind is what app/(client)/dashboard.tsx draws, and
  // `lapsedNote` is singular whatever the count, so a second notice of the same
  // kind could not change a word on any screen.
  const folded = mergeLapsed([a], [b, g]);
  eq(folded.length, 2, 'ONE NOTICE PER KIND — three lapsed planned days are one thing to say');
  eq(folded.filter((i) => i.kind === 'day-plan').length, 1, 'the planned days fold together');
  eq(folded.find((i) => i.kind === 'day-plan')!.id, b.id, 'and the newest is the one kept');
  ok(folded.some((i) => i.kind === 'goal'), 'a different kind is a different sentence and survives');

  // The launch that matters: a notice already on the device, and a fresh lapse
  // of another kind found on the same read. Neither may push the other out.
  const held = mergeLapsed([], [a]);
  const afterLaunch = mergeLapsed(held, [g]);
  eq(afterLaunch.length, 2, 'a new lapse does not clear one the member has not acknowledged yet');

  // The tie, which every fixture above avoids by using distinct moments. Two
  // planned days lapsing in the same millisecond is what a single flush of a
  // queue that went offline at one moment actually looks like, and the stated
  // rule is that the later ARRIVAL wins — `>=` rather than `>`. Between two
  // notices reading the identical sentence it decides nothing a member can
  // see, which is exactly why it would go unnoticed if it silently reversed:
  // the id it keeps is the id the dashboard dismisses, so the wrong one
  // sticking is a notice that cannot be cleared.
  const sameMoment = '2026-09-04T09:00:00.000Z';
  const older = newItem('day-plan', { d: 3 }, { at: sameMoment });
  const newer = newItem('day-plan', { d: 4 }, { at: sameMoment });
  eq(mergeLapsed([older], [newer]).find((i) => i.kind === 'day-plan')!.id, newer.id,
    'on an exact tie the later arrival wins');
  eq(mergeLapsed([newer], [older]).find((i) => i.kind === 'day-plan')!.id, older.id,
    'which is a fact about arrival order and not about the two ids');

  // Bounded by the union, not by a number: a phone in a drawer for a month
  // cannot accumulate notices faster than there are kinds of write.
  let piled: ReturnType<typeof mergeLapsed> = [];
  for (let i = 0; i < 500; i++) {
    piled = mergeLapsed(piled, [newItem(OUTBOX_KINDS[i % OUTBOX_KINDS.length], { i })]);
  }
  eq(piled.length, OUTBOX_KINDS.length, 'and it can never hold more than one of each');
  eq(piled.map((i) => i.kind).join(','), OUTBOX_KINDS.join(','),
    'drawn in the union order, so the home screen puts the same line in the same place every launch');

  // Two accounts on one phone must not inherit each other's notices, which is
  // the same rule `outboxKey` keeps for the work itself.
  ok(outboxLapsedKey('u1') !== outboxLapsedKey('u2'), 'the notices are keyed per account');
  ok(outboxLapsedKey('u1') !== outboxKey('u1'), 'and they are not the outbox — an unread outbox must not lose them');
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
  eq(kindNoun('day-plan').one, 'planned day', 'and the noun is the member’s word for the thing, not the table’s');
}

// ── 6. A KIND WITH NO SENTENCE ───────────────────────────────────────────
//
// `OUTBOX_KINDS` is what app/(client)/dashboard.tsx walks to draw "still on
// this phone" and "was not sent". A kind added to the union but not to the list
// is an intent that queues, lapses and is discarded with nothing on any screen
// about it — which is the whole failure these sentences were written for, so it
// is asserted rather than trusted.
{
  eq(OUTBOX_KINDS.length, 9, 'the list has one entry per kind in the union');
  for (const k of OUTBOX_KINDS) {
    ok(isOutboxKind(k), `${k} is recognised coming back off the disk`);
    const n = kindNoun(k);
    ok(!!n.one && !!n.many, `${k} has a singular and a plural to be named by`);
    ok((outboxNote(1, k) ?? '').includes(n.one), `${k} names itself in the waiting line`);
    ok(lapsedNote(k).includes(n.one), `${k} names itself in the lapsed line`);
  }
  eq(outboxNote(0, 'message'), null, 'nothing waiting draws no line at all');
  ok(!isOutboxKind('booking'), 'and a booking is still not a kind — see the header for why');
  // The newest kind, named the way the member would name it. A coach's waiver
  // accepted with no signal is the one whose sentence gets read at a door.
  ok(isOutboxKind('coach-doc-accept'), 'a coach document acceptance survives the round trip through storage');
  eq(kindNoun('coach-doc-accept').one, 'signed document', 'and it is a signed document to the member, not an acceptance row');
  ok((outboxNote(1, 'coach-doc-accept') ?? '').includes('not sent yet'), 'the waiting line does not claim the coach has it');
  // A body scan. It was named in the file's own list of writes that may NOT
  // wait, under "anything carrying a file" — and a scan write carries none: six
  // columns of numbers, and the photograph of the printout never leaves the
  // phone. The member typed those numbers off a sheet standing in a corner of a
  // gym with no signal, and the alternative to a queue was typing them again.
  ok(isOutboxKind('scan'), 'a body scan survives the round trip through storage');
  eq(kindNoun('scan').one, 'body scan', 'and it is a body scan to the member, not a scans row');
  ok((outboxNote(1, 'scan') ?? '').includes('not sent yet'), 'the waiting line does not claim it is on their record');
  // Asking a coach for an hour they have not opened. It sits one line under the
  // exclusion that appears to forbid it — "BOOKING A CLASS OR A PT SLOT" — and
  // the header argues at length why the scarcity that clause is about does not
  // exist here: nothing is held, so there is no seat for anybody to take first.
  // Both halves are asserted, because the day somebody reads the exclusion
  // literally and deletes this kind, the member in a basement gym loses what
  // they typed.
  ok(isOutboxKind('session-request'), 'a session request survives the round trip through storage');
  ok(!isOutboxKind('booking'), 'while a booking is still not a kind, which is the distinction the header draws');
  eq(kindNoun('session-request').one, 'session request', 'and it is a request to the member, never a booking');
  ok(!/book/i.test(outboxNote(1, 'session-request') ?? ''), 'the waiting line never uses the word book');
  ok(!/book/i.test(lapsedNote('session-request')), 'and neither does the one that says it did not go');
}

if (errors.length) {
  console.error(`outbox: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('outbox: ok');
