// The queue behind the three coach screens used on a gym floor. Compile with
// tsc, run with node.
//
// The bugs these guard, all three of which cost somebody money or an hour of
// their training:
//
//   · a queued write reported as saved. A trainer who believes the gym has the
//     attendance does not check it, and they are paid on it.
//   · a queue that could not be READ treated as an empty queue, so the next
//     write overwrites it and every session already on the phone is gone.
//   · a refused write kept in the queue forever, retried on every launch and
//     counted as "waiting to send" for the life of the install.
import {
  actLine, dropSent, enqueueAct, floorPendingNote, floorQueueKey, keptOfflineLine,
  readFloorQueue, refusedLine, supersedeKey, type FloorAct, type QueuedAct,
} from './floorQueue';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const q = (id: string, act: FloorAct, at = '2026-09-01T10:00:00.000Z'): QueuedAct => ({ id, at, act });

const TICK = (userId: string, present: boolean): FloorAct =>
  ({ kind: 'class-attendance', classId: 'c1', userId, memberName: 'Sam', present });
const LOG = (clientId: string, n: number): FloorAct =>
  ({ kind: 'session-log', clientId, clientName: 'Sam', entries: Array.from({ length: n }, (_, i) => ({ i })) });
const OUTCOME = (sessionId: string, outcome: string): FloorAct =>
  ({ kind: 'session-outcome', sessionId, clientName: 'Sam', outcome });

/* ── the key is per account ─────────────────────────────────────────────── */

// A gym's front-desk phone is signed in and out all day. A shared key would
// flush one trainer's attendance under the next trainer's name.
ok(floorQueueKey('a').includes('a'), 'the key names the account');
ok(floorQueueKey('a') !== floorQueueKey('b'), 'two accounts do not share a queue');

/* ── a state supersedes; an event never does ────────────────────────────── */

eq(supersedeKey(TICK('u1', true)), 'class:c1:u1', 'a tick is a state, keyed on the member in the class');
eq(supersedeKey(OUTCOME('s1', 'completed')), 'session:s1', 'an outcome is a state, keyed on the session');
// THE one that must not collapse. Two logged sessions for one client are two
// hours of somebody's training, and merging them deletes one.
eq(supersedeKey(LOG('u1', 3)), null, 'a logged session is an event and is never superseded');

let queue: QueuedAct[] = [];
queue = enqueueAct(queue, q('1', TICK('u1', true)));
queue = enqueueAct(queue, q('2', TICK('u2', true)));
queue = enqueueAct(queue, q('3', TICK('u1', false), '2026-09-01T10:05:00.000Z'));
eq(queue.length, 2, 'ticking one member twice queues one decision, not two');
eq(queue[0].id, '3', 'and it is the latest one');
// Position is when the decision was first made, so a trainer working down a
// class list does not watch rows jump while they correct one.
eq(queue[1].act.kind === 'class-attendance' && queue[1].act.userId, 'u2',
  'the other member keeps their place in the list');
eq(queue[0].act.kind === 'class-attendance' && queue[0].act.present, false, 'the last answer wins');

let logs: QueuedAct[] = [];
logs = enqueueAct(logs, q('1', LOG('u1', 3)));
logs = enqueueAct(logs, q('2', LOG('u1', 4)));
eq(logs.length, 2, 'two sessions for one client stay two sessions');

/* ── a sent act leaves by its id ────────────────────────────────────────── */

eq(dropSent(queue, '3').length, 1, 'a sent act leaves the queue');
eq(dropSent(queue, 'nope').length, 2, 'and an id that is not there removes nothing');
// Two ticks for two members compare equal on everything a shallow check would
// look at, so the id is what identifies them.
const twoTicks = [q('a', TICK('u1', true)), q('b', TICK('u2', true))];
eq(dropSent(twoTicks, 'a')[0].id, 'b', 'the right one leaves');

/* ── THE rule: a queue that has not been read is not an empty queue ─────── */

eq(readFloorQueue(null).read, true, 'nothing ever queued is a real answer');
eq(readFloorQueue(null).acts.length, 0, 'and it holds nothing');
eq(readFloorQueue('').read, true, 'so is an empty string');
eq(readFloorQueue('[]').read, true, 'a queue written empty IS empty');

// These are the ones that must not look the same. `read: false` is what stops
// the next write overwriting a queue full of somebody's morning.
eq(readFloorQueue('not json at all').read, false, 'bytes nobody can parse are not an answer');
eq(readFloorQueue('{"kind":"whatever"}').read, false, 'an object where an array belongs is not an answer');
eq(readFloorQueue('null').read, false, 'a literal null is not an array');
eq(readFloorQueue('"[]"').read, false, 'a string that looks like an array is not one');

/* ── an entry no sender can take is dropped, and the rest survives ──────── */

const mixed = JSON.stringify([
  { id: '1', at: '2026-09-01T10:00:00.000Z', act: TICK('u1', true) },
  { id: '2', at: '2026-09-01T10:00:00.000Z', act: { kind: 'class-attendance', classId: 'c1' } },
  { id: '3', at: 'not a date', act: TICK('u2', true) },
  { id: '', at: '2026-09-01T10:00:00.000Z', act: TICK('u3', true) },
  { id: '5', at: '2026-09-01T10:00:00.000Z', act: { kind: 'a-kind-from-the-future' } },
  { id: '6', at: '2026-09-01T10:00:00.000Z', act: LOG('u4', 2) },
  'not even an object',
]);
const read = readFloorQueue(mixed);
eq(read.read, true, 'the array itself parsed, so the rest of it is known good');
eq(read.acts.map((a) => a.id).join(','), '1,6',
  'entries no sender could take are dropped and the good ones survive');
// The lossy branch, stated: an entry that would throw on every flush blocks
// everything queued behind it forever.
eq(readFloorQueue(JSON.stringify([{ id: '1', at: '2026-09-01T10:00:00.000Z', act: LOG('u1', 0) }])).acts.length, 0,
  'a session log with no exercises has nothing to send');

// A round trip through JSON keeps everything a sender needs.
const round = readFloorQueue(JSON.stringify(queue));
eq(round.read, true, 'a queue this module wrote is a queue it can read');
eq(round.acts.length, queue.length, 'and nothing falls out of it on the way');

/* ── nothing here ever claims a write reached anybody ───────────────────── */

eq(floorPendingNote(0), null, 'an empty queue draws no banner saying nothing is wrong');
const one = floorPendingNote(1)!;
const many = floorPendingNote(3)!;
ok(/1 change/.test(one), 'one change is a change');
ok(/3 changes/.test(many), 'three are changes');
for (const line of [one, many]) {
  ok(/on this phone/.test(line), 'the note says where the work is');
  // The word "sent" appears, and only ever negated. This is the delicate
  // sentence offlineQueue.ts states once: the work is not lost, and it has not
  // reached anybody either. A trainer whose attendance is in this queue must
  // not read it as the gym having it.
  ok(/not sent yet/.test(line), 'and says plainly that it has not gone anywhere');
  ok(!/\bsent to\b|your gym has|has reached|delivered/.test(line),
    'never claiming it reached anybody');
}

const kept = keptOfflineLine('That tick');
ok(/has not reached the server/.test(kept), 'a kept write says it has not arrived');
ok(/nobody else can see it/.test(kept), 'and that nobody else can see it — this is the payroll one');
ok(/goes up next time/.test(kept), 'while making clear it is not lost');
ok(!/\bsaved\b(?!\s+on this phone)/.test(kept), 'the word "saved" is only ever "saved on this phone"');

/* ── and a refusal is never dressed up as a queue ───────────────────────── */

const refused = refusedLine('That tick', 'They are not on your roster.');
ok(/not waiting to send/.test(refused), 'a refused write says it is not queued');
ok(/declined/.test(refused), 'and that the server answered');
ok(refused.includes('They are not on your roster.'), 'carrying the reason the caller already had');
// A refusal with no reason still says the important half.
const bare = refusedLine('That tick', null);
ok(/not waiting to send/.test(bare), 'even with no reason to give');
ok(!/undefined|null/.test(bare), 'and never renders a missing reason as a word');
ok(!/null/.test(refusedLine('That tick', '   ')), 'nor a blank one');

/* ── the pending list reads as things a coach recognises ────────────────── */

eq(actLine(LOG('u1', 3)), '3 exercises for Sam', 'a queued session names what and for whom');
eq(actLine(LOG('u1', 1)), '1 exercise for Sam', 'and counts in the singular');
eq(actLine({ kind: 'session-log', clientId: 'u1', clientName: null, entries: [{}] }), '1 exercise for a client',
  'a client with no name is described rather than left as a gap');
eq(actLine(TICK('u1', true)), 'Sam marked present', 'a tick says which way it went');
eq(actLine(TICK('u1', false)), 'Sam marked absent', 'both ways');
eq(actLine({ kind: 'class-attendance', classId: 'c', userId: 'u', memberName: '  ', present: true }), 'A member marked present',
  'a blank name is not rendered as a sentence starting with a space');
eq(actLine(OUTCOME('s1', 'no_show')), 'Sam’s session marked no show', 'an outcome reads as words, not as a column value');
eq(actLine({ kind: 'session-outcome', sessionId: 's', clientName: null, outcome: 'completed' }), 'A session marked completed',
  'and names the session when it cannot name the client');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('floorQueue: ok');
