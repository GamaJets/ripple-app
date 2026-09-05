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
  FLOOR_CAP, actLine, dropSent, enqueueAct, floorFullLine, floorPendingNote, floorQueueKey,
  flushResultLine, keptOfflineLine, readFloorQueue, refusedLine, registerVisibilityLine, singleFlight,
  supersedeKey,
  type FloorAct, type QueuedAct,
} from './floorQueue';

// Failed until it is proved otherwise. The last section of this file asserts
// on promises, and a suite that starts at 0 reports a hang as a pass: node
// exits quietly the moment the loop drains, with nothing printed and nothing
// checked. Cleared on the last line.
process.exitCode = 1;

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const q = (id: string, act: FloorAct, at = '2026-09-01T10:00:00.000Z'): QueuedAct => ({ id, at, act });

const TICK = (userId: string, present: boolean): FloorAct =>
  ({ kind: 'class-attendance', classId: 'c1', userId, memberName: 'Sam', present });
const LOG = (clientId: string, n: number, stamp = '2026-09-01T18:00:00.000Z'): FloorAct =>
  ({ kind: 'session-log', clientId, clientName: 'Sam', entries: Array.from({ length: n }, (_, i) => ({ i, t: stamp })) });
const OUTCOME = (sessionId: string, outcome: string | null): FloorAct =>
  ({ kind: 'session-outcome', sessionId, clientName: 'Sam', outcome });

/* ── the key is per account ─────────────────────────────────────────────── */

// A gym's front-desk phone is signed in and out all day. A shared key would
// flush one trainer's attendance under the next trainer's name.
ok(floorQueueKey('a').includes('a'), 'the key names the account');
ok(floorQueueKey('a') !== floorQueueKey('b'), 'two accounts do not share a queue');

/* ── a state supersedes; an event never does ────────────────────────────── */

eq(supersedeKey(TICK('u1', true)), 'class:c1:u1', 'a tick is a state, keyed on the member in the class');
eq(supersedeKey(OUTCOME('s1', 'completed')), 'session:s1', 'an outcome is a state, keyed on the session');

/* ── and the log, which is keyed on its contents ────────────────────────── */

// THE one that must not collapse. Two logged sessions for one client are two
// hours of somebody's training, and merging them deletes one. They cannot
// agree on this key: `logStamp` in src/lib/sessionWhen.ts carries the second
// and millisecond of saving into every entry, so two sessions typed on the same
// evening differ even when the exercises and the sets are identical.
ok(supersedeKey(LOG('u1', 3, '2026-09-01T18:00:00.100Z'))
  !== supersedeKey(LOG('u1', 3, '2026-09-01T18:00:00.200Z')),
  'two sessions a moment apart are two sessions');
ok(supersedeKey(LOG('u1', 3)) !== supersedeKey(LOG('u1', 4)),
  'and so are two with different work in them');
ok(supersedeKey(LOG('u1', 3)) !== supersedeKey(LOG('u2', 3)),
  'the same hour against two clients is two writes');

// And the one that MUST collapse, which is why the key exists at all: the same
// entries offered a second time because the first offer was never answered. A
// lost acknowledgement used to put the same hour in a client's history twice,
// and neither the client nor the coach can tell which of the two to delete.
eq(supersedeKey(LOG('u1', 3)), supersedeKey(LOG('u1', 3)),
  'the same session offered twice is one session');

let queue: QueuedAct[] = [];
queue = enqueueAct(queue, q('1', TICK('u1', true))).queue;
queue = enqueueAct(queue, q('2', TICK('u2', true))).queue;
queue = enqueueAct(queue, q('3', TICK('u1', false), '2026-09-01T10:05:00.000Z')).queue;
eq(queue.length, 2, 'ticking one member twice queues one decision, not two');
eq(queue[0].id, '3', 'and it is the latest one');
// Position is when the decision was first made, so a trainer working down a
// class list does not watch rows jump while they correct one.
eq(queue[1].act.kind === 'class-attendance' && queue[1].act.userId, 'u2',
  'the other member keeps their place in the list');
eq(queue[0].act.kind === 'class-attendance' && queue[0].act.present, false, 'the last answer wins');

let logs: QueuedAct[] = [];
logs = enqueueAct(logs, q('1', LOG('u1', 3))).queue;
logs = enqueueAct(logs, q('2', LOG('u1', 4))).queue;
eq(logs.length, 2, 'two sessions for one client stay two sessions');
logs = enqueueAct(logs, q('3', LOG('u1', 3))).queue;
eq(logs.length, 2, 'and the same session offered again does not become a third');
eq(logs[0].id, '3', 'the re-offer takes the place of the one it repeats');

/* ── the queue is bounded, and a supersede is never what fills it ───────── */
//
// This was the only queue in the app without a cap, and it holds the largest
// payloads: a session log is an entire hour of training and it APPENDS, where a
// tick and an outcome fold onto their own supersede keys. src/lib/outbox.ts
// states the hazard for its own two hundred — "AsyncStorage on Android is one
// SQLite row per key and a runaway queue is a write that starts failing" — and
// here the failure is silent: `persist` catches, the coach's afternoon looks
// fine, and the next launch reads back the last write that succeeded.

{
  let full: QueuedAct[] = [];
  for (let i = 0; i < FLOOR_CAP; i++) full = enqueueAct(full, q(`f${i}`, LOG(`u${i}`, 3))).queue;
  eq(full.length, FLOOR_CAP, 'the cap is reached exactly');

  const past = enqueueAct(full, q('late', LOG('u999', 3)));
  eq(past.added, false, 'PAST THE CAP IT REFUSES — a coach can be told that, and an eviction is silent loss');
  eq(past.queue.length, FLOOR_CAP, 'and the queue is unchanged');
  eq(past.queue[0].id, 'f0', 'so Monday morning is still on the phone rather than pushed out by Friday');
  ok(!past.queue.some((e) => e.id === 'late'), 'the act that was refused is the one that was not kept');

  // The load-bearing half. A correction to something already queued does not
  // make the queue longer, and refusing one at the cap would mean a trainer who
  // fixed a mark watched the WRONG one go up — the exact failure `supersedeKey`
  // exists to prevent.
  let ticks: QueuedAct[] = [];
  for (let i = 0; i < FLOOR_CAP; i++) ticks = enqueueAct(ticks, q(`t${i}`, TICK(`m${i}`, true))).queue;
  const corrected = enqueueAct(ticks, q('fix', TICK('m0', false)));
  eq(corrected.added, true, 'A SUPERSEDE IS ALWAYS ALLOWED, CAP OR NO CAP — it replaces rather than grows');
  eq(corrected.queue.length, FLOOR_CAP, 'and the queue is the same length afterwards');
  eq(corrected.queue[0].act.kind === 'class-attendance' && corrected.queue[0].act.present, false,
    'with the trainer’s corrected answer in it, not the one they changed their mind about');

  // A retraction at the cap is the sharpest case of the same thing: it must
  // never be the one act that cannot be kept.
  let outcomes: QueuedAct[] = [];
  for (let i = 0; i < FLOOR_CAP; i++) outcomes = enqueueAct(outcomes, q(`o${i}`, OUTCOME(`s${i}`, 'no_show'))).queue;
  const undone = enqueueAct(outcomes, q('undo', OUTCOME('s0', null)));
  eq(undone.added, true, 'a coach taking back a "no show" is never refused for want of room');
  eq((undone.queue[0]?.act as { outcome: string | null }).outcome, null, 'and it is the retraction that is left');

  // What the coach is told when nothing was kept. Three different facts, three
  // different sentences, and none of them may be mistaken for another.
  const said = floorFullLine('This session');
  ok(/not saved/i.test(said) && /not waiting to send/i.test(said),
    'the full line says plainly that nothing was kept and nothing is coming');
  ok(!/server/i.test(said), 'and never claims a server read it — no server has seen this');
  ok(said !== refusedLine('This session', null), 'it is not the refusal sentence');
  ok(said !== keptOfflineLine('This session'), 'and it is not the kept-on-this-phone sentence, which promises a send');
}

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

/* ── the outcome a coach took back ──────────────────────────────────────── */
//
// The defect: marking went through this queue and the undo went straight to the
// server. Offline — the condition the queue exists for — the undo threw and the
// queue then flushed the "no show" the coach had retracted in front of the
// client, onto their record and onto payroll.

eq(supersedeKey(OUTCOME('s1', null)), 'session:s1',
  'a retraction keys on the same session as the mark it takes back');

{
  // Offline: the mark is queued, then taken back. Nothing false may be left to
  // send, and the queue must not grow a second entry for one session.
  const marked = enqueueAct([], q('a', OUTCOME('s1', 'no_show'))).queue;
  const taken = enqueueAct(marked, q('b', OUTCOME('s1', null))).queue;
  eq(taken.length, 1, 'taking it back replaces the queued mark rather than queueing behind it');
  eq((taken[0]?.act as { outcome: string | null }).outcome, null,
    'and what is left on the phone is the retraction, not the "no show"');
  ok(!taken.some((e) => (e.act as { outcome: string | null }).outcome === 'no_show'),
    'the outcome the coach retracted is not waiting to be sent');
}

{
  // A retraction for a session with nothing queued is an act in its own right:
  // the mark reached the server, and the clear has to as well.
  const only = enqueueAct([q('a', OUTCOME('s2', 'completed'))], q('b', OUTCOME('s1', null))).queue;
  eq(only.length, 2, 'a retraction of a sent mark is queued rather than dropped');
}

{
  // It comes back off the device as something this build can send. Stored as
  // null and read back as null — not as an act to be silently discarded.
  const raw = JSON.stringify([q('a', OUTCOME('s1', null))]);
  const back = readFloorQueue(raw);
  eq(back.read, true, 'a stored retraction is readable');
  eq(back.acts.length, 1, 'and survives the round trip through the device');
  eq((back.acts[0]?.act as { outcome: string | null }).outcome, null, 'still as a retraction');
}

eq(actLine(OUTCOME('s1', null)), 'Sam’s session — outcome taken back',
  'and the pending list says it was taken back, never "marked null"');
eq(actLine({ kind: 'session-outcome', sessionId: 's', clientName: null, outcome: null }),
  'A session — outcome taken back', 'with the session named when the client cannot be');

/* ── what a pressed send button reports ─────────────────────────────────── */

// Nothing to do says nothing at all, rather than raising an alert about it.
eq(flushResultLine({ sent: 0, refused: 0, kept: 0 }), null, 'an empty flush is silent');

const allSent = flushResultLine({ sent: 3, refused: 0, kept: 0 }) ?? '';
ok(/3 changes went up/.test(allSent), 'a clean flush says how many reached the server');
ok(!/phone/.test(allSent), 'and does not mention a phone that is now carrying nothing');
eq(flushResultLine({ sent: 1, refused: 0, kept: 0 }), '1 change went up.', 'counted in the singular');

// The one that must not read as "still waiting". A refused act has been dropped
// and pressing send again will never move it.
const dropped = flushResultLine({ sent: 0, refused: 2, kept: 0 }) ?? '';
ok(/declined/.test(dropped), 'a refusal says the server answered');
ok(/no longer waiting to send/.test(dropped), 'and that it is not queued any more');

// And the one that must not read as a failure of the tap.
const still = flushResultLine({ sent: 0, refused: 0, kept: 1 }) ?? '';
ok(/nobody answered/.test(still), 'an unreachable server is named as such');
ok(/still on this phone/.test(still), 'and the work is said to be kept');
ok(/tried again/.test(still), 'and that it will be retried');

// All three at once keeps all three, because they happened to different acts.
const mixedFlush = flushResultLine({ sent: 1, refused: 1, kept: 1 }) ?? '';
ok(/went up/.test(mixedFlush) && /declined/.test(mixedFlush) && /nobody answered/.test(mixedFlush),
  'a mixed flush reports every arm rather than the most recent one');
ok(!/undefined|NaN/.test(mixedFlush), 'and never renders a count as a word');

/* ── who can see a register that is still on the phone ──────────────────── */

// Rule 1 of this module, on the screen it was written for. The footnote under
// the class register said "Your gym owner sees attendance per class for
// payroll" unconditionally — including while this queue held every tick — and
// a trainer who believes the gym has the attendance does not check it.
const clear = registerVisibilityLine(0, true);
ok(/Your gym owner sees attendance/.test(clear), 'an empty queue may say the gym has it');

const waiting = registerVisibilityLine(3, true);
ok(/still on this phone/.test(waiting), 'a queue with ticks in it says where they are');
ok(/cannot see/.test(waiting), 'and that the gym cannot see them');
ok(/3/.test(waiting), 'and how many');
eq(/1 check-in is/.test(registerVisibilityLine(1, true)), true, 'counted in the singular');

// A queue that could not be READ is not an empty queue, so neither answer may
// be given.
const unknown = registerVisibilityLine(0, false);
ok(!/Your gym owner sees attendance/.test(unknown), 'an unread queue never claims the gym has it');
ok(/not known/.test(unknown), 'it says the answer is unknown');


/* ── one drain at a time ────────────────────────────────────────────────── */

// The cold launch that sent every act twice. app/(trainer)/_layout.tsx mounts
// `FloorQueueSync` and the screen under it mounts `useFloorQueue`, so two
// callers reach `flushAll` in the same commit — and nothing leaves `acts` until
// after the first await, so both took the same batch. Two of the three acts
// survive being sent twice; a session log does not, and the client ends up with
// the hour in their history twice with no way to delete either.
//
// Asynchronous, so the epilogue is inside it: these assertions are about
// promises, and a suite whose checks are still pending when node's loop drains
// reports a hang as a pass.
async function drainsOnce(): Promise<void> {
  const flight = singleFlight<number>();
  let starts = 0;
  let release: (() => void) | null = null;
  const job = () => {
    starts += 1;
    return new Promise<number>((res) => { release = () => res(starts); });
  };

  const first = flight.run('coach-a', job);
  const second = flight.run('coach-a', job);
  eq(starts, 1, 'a second caller for the same account does not start a second pass');
  eq(flight.busy(), 'coach-a', 'the gate names whose pass is in flight');
  ok(first === second, 'it is handed the pass already running, not a new one');

  release!();
  eq(await first, 1, 'both callers get that pass\'s answer');
  eq(await second, 1, 'both of them, not just the one that started it');
  eq(flight.busy(), null, 'the gate opens once the pass has settled');

  // Chained, not joined: a pass asked for after the last one settled is a fresh
  // one, or a coach pressing send twice would be told nothing happened.
  const third = flight.run('coach-a', job);
  eq(starts, 2, 'a pass asked for after the previous one settled runs');
  release!();
  await third;

  // A gym's front-desk phone signs in and out all day. One coach's drain must
  // never be handed back to the next coach as though it were theirs.
  let bStarts = 0;
  const a = flight.run('coach-a', () => new Promise<number>((res) => { release = () => res(0); }));
  const b = flight.run('coach-b', () => { bStarts += 1; return Promise.resolve(0); });
  ok(a !== b, 'a different account does not join somebody else\'s pass');
  eq(bStarts, 1, 'it runs its own');
  release!();
  await a; await b;

  // A throwing pass must not leave the gate shut. A latch held by a failure is
  // a queue that never drains again until the app is killed.
  let threw = false;
  try { await flight.run('coach-c', async () => { throw new Error('no signal'); }); } catch { threw = true; }
  ok(threw, 'a pass that throws still rejects its callers');
  eq(flight.busy(), null, 'and does not leave the gate shut behind it');
}

void drainsOnce().then(() => {
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('floorQueue: ok');
  process.exitCode = 0;
}, (e) => { console.error(e); process.exit(1); });
