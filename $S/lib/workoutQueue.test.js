"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The queue's rules for the busiest write in the app. Compile with tsc, run
// with node.
//
// Five failures are guarded here and none of them is arithmetic. Each one has a
// name and each one costs somebody a session they actually did.
//
//   1. A CORRUPT CACHE READ AS AN EMPTY ONE. `readQueue` must say `read: false`
//      for bytes it could not understand, and the caller must latch its cache
//      off on that. Collapse it to "the queue is empty" and the next write
//      serialises a list that cannot contain the unread entries straight over
//      the top of them — one truncated write during a crash takes every unsent
//      session on the phone with it, permanently and silently. This is the
//      write-side twin of `serverRows` in offlineQueue.test.ts.
//
//   2. AN ENTRY WITH NO ID READ AS A STORED ONE. `isQueued` answers from the
//      id, and "no id" has to mean "nothing has stored this". The opposite
//      reading makes an unsent session invisible to the count, to the cache and
//      to the retry all at once — the exact silence src/ui/workoutLog.tsx was
//      rewritten to end.
//
//   3. A LOCAL ID USED AS A PRIMARY KEY. `serverId` returns null for one,
//      because `.eq('id', 'local:…')` matches nothing and PostgREST reports
//      that as a SUCCESSFUL statement that changed no rows.
//
//   4. THE WRONG ENTRY ADOPTING A RETURNED ID. `adoptIds` matches on
//      (timestamp, exercise) — the only thing a queued entry and its row share
//      — and must not repoint an entry that is already stored, whose id is the
//      server's answer already.
//
//   5. A REFUSAL TAKING GOOD ROWS WITH IT. `dropRefused` matches on the same
//      pair rather than on the id, because an id-keyed drop would remove every
//      OTHER id-less row — somebody's unsent sessions — alongside the one
//      refusal. And it may only ever drop queued entries: a stored row sharing
//      a key is real, and removing it shows a history with a hole that comes
//      back at the next launch.
const workoutQueue_1 = require("./workoutQueue");
const workoutRow_1 = require("./workoutRow");
const wellnessSync_1 = require("./wellnessSync");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const T1 = '2026-09-01T18:00:00.000Z';
const T2 = '2026-08-31T18:00:00.000Z';
const UID = '11111111-1111-1111-1111-111111111111';
const SERVER = '22222222-2222-2222-2222-222222222222';
const entry = (over = {}) => ({ t: T1, exercise: 'Bench Press', sets: [[8, 60], [8, 60]], ...over });
/* ── 2 + 3 · what an id proves ─────────────────────────────────────────── */
{
    ok((0, workoutQueue_1.isQueued)(entry()), 'an entry with no id at all has never been stored');
    ok((0, workoutQueue_1.isQueued)(entry({ id: (0, wellnessSync_1.localId)() })), 'a local id is a device id, not a server one');
    ok(!(0, workoutQueue_1.isQueued)(entry({ id: SERVER })), 'a uuid came back from the server');
    // The trap, stated as its own assertion: this is the reading that makes an
    // unsent session invisible everywhere at once.
    ok((0, workoutQueue_1.isQueued)({ t: T1, exercise: 'Squat' }), 'an id-less entry is queued, never "already saved"');
    eq((0, workoutQueue_1.serverId)(entry()), null, 'no id is no primary key');
    eq((0, workoutQueue_1.serverId)(entry({ id: `${wellnessSync_1.LOCAL_PREFIX}abc.1` })), null, 'a local id must never reach .eq(id) — PostgREST calls a filter that matches nothing a success');
    eq((0, workoutQueue_1.serverId)(entry({ id: SERVER })), SERVER, 'a server id is the primary key');
    // isQueued and serverId are two readings of one fact and must never disagree:
    // an entry cannot be both queued and addressable by primary key.
    for (const e of [entry(), entry({ id: (0, wellnessSync_1.localId)() }), entry({ id: SERVER })]) {
        ok((0, workoutQueue_1.isQueued)(e) === ((0, workoutQueue_1.serverId)(e) === null), 'queued and "has a primary key" are exact opposites');
    }
}
/* ── 1 · a queue that was not read is not an empty queue ───────────────── */
{
    // Nothing has ever been queued. A real answer, and the ordinary one.
    const none = (0, workoutQueue_1.readQueue)(null);
    ok(none.read, 'a cache that has never been written IS an answer');
    eq(none.entries.length, 0, 'and it holds nothing');
    ok((0, workoutQueue_1.readQueue)(undefined).read, 'so is a missing key');
    ok((0, workoutQueue_1.readQueue)('').read, 'so is an empty string');
    // Written empty. Still an answer — the difference from the case below is the
    // whole subject of this file.
    const emptied = (0, workoutQueue_1.readQueue)('[]');
    ok(emptied.read, 'a queue written empty is empty');
    eq(emptied.entries.length, 0, 'holding nothing');
    // NOT an answer. Both of these used to be a `catch { }` producing exactly the
    // same value as the two cases above.
    ok(!(0, workoutQueue_1.readQueue)('{"not":"an array"}').read, 'an object is not a queue and we did not read one');
    ok(!(0, workoutQueue_1.readQueue)('[{"performed_at":').read, 'a truncated write is not an empty queue');
    ok(!(0, workoutQueue_1.readQueue)('nonsense').read, 'nor is a cache written by something else');
    // And the entries are empty in the unread case too — which is exactly why
    // `read` has to be consulted rather than the length.
    eq((0, workoutQueue_1.readQueue)('nope').entries.length, 0, 'an unread queue and an empty one hold the same nothing; only `read` tells them apart');
}
{
    // The round trip: what `toQueueRows` writes is what `readQueue` gets back.
    const q = entry({ id: (0, wellnessSync_1.localId)(), feel: ['ok', 'hard'], kcal: 210, sessionMins: 47 });
    const back = (0, workoutQueue_1.readQueue)(JSON.stringify((0, workoutQueue_1.toQueueRows)(UID, [q])));
    ok(back.read, 'our own serialisation reads back');
    eq(back.entries.length, 1, 'one entry in, one out');
    const r = back.entries[0];
    eq(r.id, q.id, 'the local id survives — entryToRow drops `id`, and this puts it back');
    eq(r.t, q.t, 'the instant survives');
    eq(r.exercise, q.exercise, 'the movement survives');
    eq(JSON.stringify(r.sets), JSON.stringify(q.sets), 'the sets survive');
    eq(JSON.stringify(r.feel), JSON.stringify(q.feel), 'the per-set RPE survives — the field workoutRow.ts lost for months');
    eq(r.kcal, q.kcal, 'the energy figure survives');
    eq(r.sessionMins, q.sessionMins, 'and the session length, so a queued session carries its own duration up');
}
{
    // Only the queued entries are written. The cache is not a history: the server
    // holds that, and a second copy would be a large write on every set logged.
    const rows = (0, workoutQueue_1.toQueueRows)(UID, [entry({ id: SERVER }), entry({ t: T2, id: (0, wellnessSync_1.localId)() })]);
    eq(rows.length, 1, 'a stored entry is not written to the queue');
    eq(rows[0].performed_at, T2, 'and the queued one is');
    eq(rows[0].user_id, UID, 'stamped with the account whose queue it is');
    // Written through entryToRow, so a column added there is added here.
    eq(JSON.stringify(rows[0]), JSON.stringify({ ...(0, workoutRow_1.entryToRow)(UID, entry({ t: T2 })), id: rows[0].id }), 'the row is entryToRow’s row plus the local id, and nothing else');
    // A stored row that somehow reaches the cache is dropped on the way back in,
    // not sent again.
    const withStored = (0, workoutQueue_1.readQueue)(JSON.stringify([{ ...(0, workoutRow_1.entryToRow)(UID, entry()), id: SERVER }]));
    ok(withStored.read, 'the read succeeded');
    eq(withStored.entries.length, 0, 'a row already carrying a server id is not queued work');
}
{
    // One unusable element does not condemn the rest. `read` staying true is what
    // lets the good rows be rewritten without the bad one.
    const good = { ...(0, workoutRow_1.entryToRow)(UID, entry()), id: (0, wellnessSync_1.localId)() };
    const q = (0, workoutQueue_1.readQueue)(JSON.stringify([null, 42, { nothing: true }, good]));
    ok(q.read, 'one bad element is not evidence the others are unreadable');
    eq(q.entries.length, 1, 'and the readable one comes through');
    eq(q.entries[0].exercise, 'Bench Press', 'intact');
}
/* ── 4 · the returned row finds its entry ──────────────────────────────── */
{
    const a = entry({ id: (0, wellnessSync_1.localId)(), exercise: 'Bench Press' });
    const b = entry({ id: (0, wellnessSync_1.localId)(), exercise: 'Row' });
    const list = [a, b];
    const next = (0, workoutQueue_1.adoptIds)(list, [{ id: SERVER, performed_at: T1, exercise: 'Row' }]);
    eq(next[0].id, a.id, 'the entry the row was not for keeps its local id');
    eq(next[1].id, SERVER, 'and the one it was for takes the server’s');
    ok((0, workoutQueue_1.isQueued)(next[0]) && !(0, workoutQueue_1.isQueued)(next[1]), 'so exactly one of them is still waiting');
    // Only the id. The server's rendering of the instant is NOT adopted: sessions
    // are grouped and timed by that exact string above this file, and re-cutting
    // it would move a member's session out from under them.
    const shifted = (0, workoutQueue_1.adoptIds)([a], [{ id: SERVER, performed_at: T1, exercise: 'Bench Press' }]);
    eq(shifted[0].t, T1, 'the timestamp is this device’s, before and after');
    eq(JSON.stringify(shifted[0].sets), JSON.stringify(a.sets), 'and nothing else is taken from the row either');
}
{
    // A row for an entry that is already stored must not repoint it. Two rows can
    // share a timestamp and a movement — a session logged and then logged again —
    // and the stored one's id is the server's own answer.
    const stored = entry({ id: SERVER });
    const other = '33333333-3333-3333-3333-333333333333';
    const next = (0, workoutQueue_1.adoptIds)([stored], [{ id: other, performed_at: T1, exercise: 'Bench Press' }]);
    eq(next[0].id, SERVER, 'a stored entry keeps the id the server gave it');
    // Rows with nothing to match on are ignored rather than guessed at.
    eq((0, workoutQueue_1.adoptIds)([entry({ id: 'local:x' })], [{ id: null, performed_at: T1, exercise: 'Bench Press' }])[0].id, 'local:x', 'a returned row with no id adopts nothing');
    eq((0, workoutQueue_1.adoptIds)([entry({ id: 'local:x' })], [{ id: SERVER, performed_at: null, exercise: 'Bench Press' }])[0].id, 'local:x', 'nor one with no timestamp to match on');
    const untouched = [entry({ id: 'local:x' })];
    ok((0, workoutQueue_1.adoptIds)(untouched, []) === untouched, 'no rows back means the list is handed straight through');
}
/* ── 5 · a refusal takes only what was refused ─────────────────────────── */
{
    const refused = entry({ id: (0, wellnessSync_1.localId)(), exercise: 'Bench Press' });
    const keeper = entry({ t: T2, id: (0, wellnessSync_1.localId)(), exercise: 'Bench Press' });
    const stored = entry({ id: SERVER, exercise: 'Bench Press' });
    const next = (0, workoutQueue_1.dropRefused)([refused, keeper, stored], [refused]);
    eq(next.length, 2, 'one entry was refused, so one entry left');
    ok(!next.includes(refused), 'the refused one is gone — it would be refused again forever');
    ok(next.includes(keeper), 'yesterday’s unsent session is not collateral');
    ok(next.includes(stored), 'and a stored row sharing the key is real: removing it shows a hole that comes back');
    // The id-keyed version of this is the bug. Two id-less entries would both
    // match a `new Set([undefined])`, so refusing one would silently delete the
    // other — and id-less entries are, by definition, the ones nothing has saved.
    const nameless = { t: T1, exercise: 'Squat' };
    const alsoNameless = { t: T2, exercise: 'Deadlift' };
    const after = (0, workoutQueue_1.dropRefused)([nameless, alsoNameless], [nameless]);
    eq(after.length, 1, 'refusing one id-less entry drops one id-less entry');
    eq(after[0].exercise, 'Deadlift', 'and not the other one');
    const same = [refused];
    ok((0, workoutQueue_1.dropRefused)(same, []) === same, 'nothing refused means the list is handed straight through');
}
/* ── the response that was lost on the way back ────────────────────────── */
{
    // At-least-once delivery, which is the ordinary shape of a phone in a gym:
    // the rows were written and the answer never arrived, so `classifyWrite`
    // correctly called it 'unsent' and the entry stayed queued. Next launch, the
    // server's copy comes back — and without this the session is shown twice and
    // then sent a THIRD time.
    const queued = [entry({ id: (0, wellnessSync_1.localId)(), exercise: 'Bench Press' }), entry({ id: (0, wellnessSync_1.localId)(), exercise: 'Row' })];
    const stored = [entry({ id: SERVER, exercise: 'Bench Press' })];
    const left = (0, workoutQueue_1.withoutStored)(queued, stored);
    eq(left.length, 1, 'the half the server already has stops waiting');
    eq(left[0].exercise, 'Row', 'and the half it does not have is still waiting');
    // Only STORED rows count as held. A second queued copy of the same key is not
    // evidence that anybody has it.
    eq((0, workoutQueue_1.withoutStored)(queued, [entry({ id: (0, wellnessSync_1.localId)(), exercise: 'Bench Press' })]).length, 2, 'another queued entry is not the server holding it');
    // A different instant is a different session, however the movement is named.
    eq((0, workoutQueue_1.withoutStored)([entry({ t: T2, id: (0, wellnessSync_1.localId)() })], [entry({ id: SERVER })]).length, 1, 'the same lift on another day is another session');
    eq((0, workoutQueue_1.withoutStored)([], stored).length, 0, 'nothing queued is nothing to drop');
    eq((0, workoutQueue_1.withoutStored)(queued, []).length, 2, 'and an empty server read drops nothing — that read may simply have failed');
}
/* ── order, and the sessions a drain walks ─────────────────────────────── */
{
    const older = entry({ t: T2, id: 'a' });
    const newer = entry({ t: T1, id: 'a' });
    ok((0, workoutQueue_1.byNewest)(newer, older) < 0, 'newest first');
    ok((0, workoutQueue_1.byNewest)(older, newer) > 0, 'and oldest last');
    // The tie-break exists so a list cannot reorder itself between renders.
    const x = entry({ id: 'aaa' });
    const y = entry({ id: 'bbb' });
    ok((0, workoutQueue_1.byNewest)(x, y) !== 0 && (0, workoutQueue_1.byNewest)(y, x) !== 0, 'two entries at one instant still have an order');
    ok((0, workoutQueue_1.byNewest)(x, y) === -(0, workoutQueue_1.byNewest)(y, x), 'and it is the same order read from either side');
    // Matches the server's own `performed_at desc, id desc`, so re-sorting a list
    // that came from the server leaves it exactly as it arrived.
    ok((0, workoutQueue_1.byNewest)(y, x) < 0, 'the higher id sorts first within an instant, as `id desc` does');
    // An entry with no id sorts last within its instant — where an unidentified
    // row belongs, and deterministically rather than by luck.
    ok((0, workoutQueue_1.byNewest)(x, entry()) < 0, 'an identified entry precedes an unidentified one at the same instant');
    eq((0, workoutQueue_1.sessionKey)({ t: T1, exercise: 'Row' }), `${T1}|Row`, 'a session key is the instant and the movement');
    ok((0, workoutQueue_1.sessionKey)({ t: T1, exercise: 'Row' }) !== (0, workoutQueue_1.sessionKey)({ t: T2, exercise: 'Row' }), 'the same movement in two sessions is two keys');
}
{
    // A drain walks whole sessions, oldest first: a session is the unit a member
    // thinks in, and eight round trips on wifi that has just come back is eight
    // chances for half a push day to land.
    const list = [
        entry({ t: T1, id: (0, wellnessSync_1.localId)(), exercise: 'Bench Press' }),
        entry({ t: T1, id: (0, wellnessSync_1.localId)(), exercise: 'Row' }),
        entry({ t: T2, id: (0, wellnessSync_1.localId)(), exercise: 'Squat' }),
        entry({ t: '2026-08-30T18:00:00.000Z', id: SERVER, exercise: 'Deadlift' }),
    ];
    const sessions = (0, workoutQueue_1.queuedSessions)(list);
    eq(sessions.length, 2, 'three queued entries across two sessions is two sends');
    eq(sessions[0], T2, 'oldest first — the work that has waited longest goes first');
    eq(sessions[1], T1, 'then the newer one');
    ok(!sessions.includes('2026-08-30T18:00:00.000Z'), 'a session the server already has is not re-sent');
    eq((0, workoutQueue_1.queuedSessions)([]).length, 0, 'an empty list is no sessions');
    eq((0, workoutQueue_1.queuedSessions)([entry({ id: SERVER })]).length, 0, 'and a fully stored list is no sessions either');
}
/* ── the cache key is per account ──────────────────────────────────────── */
{
    ok((0, workoutQueue_1.queueCacheKey)(UID) !== (0, workoutQueue_1.queueCacheKey)(SERVER), 'two accounts on one gym phone must not share a queue — the failure there is one member’s session sent under another member’s name');
    ok((0, workoutQueue_1.queueCacheKey)(UID).includes(UID), 'and the key says whose it is');
}
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('workoutQueue: ok');
