"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The last thing this phone knew. Compile with tsc, run with node.
//
// Four failures are guarded here, and three of them put a wrong sentence in
// front of somebody standing in a gym:
//
//   1. AN UNREADABLE CACHE READ AS AN EMPTY ONE. `rows: null` means we learnt
//      nothing; `rows: []` means the server genuinely had none. The same
//      distinction src/lib/offlineQueue.ts · `serverRows` draws for a network
//      read, drawn again for the device — because a caller that collapses them
//      renders "no classes are scheduled" off a truncated file.
//
//   2. A CACHED LIST SHOWN WITHOUT ITS AGE. `cachedAtLine` is the label that
//      stops a member turning up to a class that was cancelled yesterday. It
//      must return null rather than invent an age it does not know.
//
//   3. A STALE COPY SHOWN AS THOUGH IT WERE CURRENT. `withinHorizon` is what
//      each caller uses to decline; a stamp it cannot read must not pass.
//
//   4. A ROUND TRIP THAT CHANGES THE ROWS. Whatever a provider puts in comes
//      back out, or the cache is a second, quieter source of truth.
const readCache_1 = require("./readCache");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const UID = '11111111-1111-1111-1111-111111111111';
const NOW = Date.parse('2026-09-02T12:00:00.000Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
/* ── keys ──────────────────────────────────────────────────────────────── */
{
    ok((0, readCache_1.cacheKey)('classes', UID).includes(UID), 'a cache is per account');
    ok((0, readCache_1.cacheKey)('classes', UID) !== (0, readCache_1.cacheKey)('sessions', UID), 'and per read: one key for two reads is one read overwriting the other');
}
/* ── 1 + 4 · what comes back ───────────────────────────────────────────── */
{
    const rows = [{ id: 'a', title: 'Spin' }, { id: 'b', title: 'Yoga' }];
    const back = (0, readCache_1.readCache)((0, readCache_1.packCache)(rows, ago(60000)));
    eq(back.rows?.length, 2, 'the rows survive');
    eq(back.rows?.[1].title, 'Yoga', 'in order and intact');
    eq(back.at, ago(60000), 'with the moment the server answered');
    eq((0, readCache_1.readCache)(null).rows, null, 'a key that was never written taught us nothing');
    eq((0, readCache_1.readCache)('{ not json').rows, null, 'and neither did bytes nobody could parse');
    eq((0, readCache_1.readCache)('[1,2,3]').rows, null, 'nor a shape this file never wrote');
    eq((0, readCache_1.readCache)('{"rows":"nope","at":"x"}').rows, null, 'nor rows that are not a list');
    const empty = (0, readCache_1.readCache)((0, readCache_1.packCache)([], ago(1000)));
    ok(Array.isArray(empty.rows), 'an empty cached answer is an ANSWER');
    eq(empty.rows?.length, 0, 'and it is empty');
    // The mutation this pair exists to catch: `rows ?? []` anywhere in readCache
    // would make these two indistinguishable, and the caller would state an
    // unread cache as a fact about the gym.
    ok(((0, readCache_1.readCache)('{ not json').rows === null) !== (empty.rows === null), 'a cache that could not be read and one that is genuinely empty stay distinguishable');
    const stamped = (0, readCache_1.readCache)((0, readCache_1.packCache)([{ id: 'a' }], 'not a date'));
    eq(stamped.at, 'not a date', 'a stamp is returned as written; judging it is cachedAtLine\'s job, not the reader\'s');
}
/* ── 2 · the label ─────────────────────────────────────────────────────── */
{
    eq((0, readCache_1.cachedAtLine)(null, NOW), null, 'no stamp, no sentence');
    eq((0, readCache_1.cachedAtLine)('not a date', NOW), null, 'an unreadable stamp must not become an invented age');
    ok(((0, readCache_1.cachedAtLine)(ago(30000), NOW) ?? '').includes('a moment ago'), 'seconds old reads as a moment');
    ok(((0, readCache_1.cachedAtLine)(ago(12 * 60000), NOW) ?? '').includes('12 minutes ago'), 'minutes are minutes');
    ok(((0, readCache_1.cachedAtLine)(ago(3 * 3600000), NOW) ?? '').includes('3 hours ago'), 'hours are hours');
    ok(((0, readCache_1.cachedAtLine)(ago(3600000), NOW) ?? '').includes('1 hour ago'), 'and one hour is singular');
    ok(((0, readCache_1.cachedAtLine)(ago(50 * 3600000), NOW) ?? '').includes('2 days ago'), 'days are days');
    ok(((0, readCache_1.cachedAtLine)(ago(26 * 3600000), NOW) ?? '').includes('1 day ago'), 'and one day is singular');
    for (const age of [30000, 12 * 60000, 3 * 3600000, 50 * 3600000]) {
        ok(((0, readCache_1.cachedAtLine)(ago(age), NOW) ?? '').includes('Not confirmed'), 'every one of them says the list is not confirmed current, because that is the point of the label');
    }
    ok(((0, readCache_1.cachedAtLine)(new Date(NOW + 60000).toISOString(), NOW) ?? '').length > 0, 'a phone whose clock is ahead still gets a sentence, rather than an unlabelled list');
}
/* ── 3 · the horizon ───────────────────────────────────────────────────── */
{
    ok((0, readCache_1.withinHorizon)(ago(60000), NOW), 'a minute old is worth showing');
    ok((0, readCache_1.withinHorizon)(ago(readCache_1.DEFAULT_HORIZON_MS - 1000), NOW), 'so is just inside the week');
    ok(!(0, readCache_1.withinHorizon)(ago(readCache_1.DEFAULT_HORIZON_MS + 1000), NOW), 'just outside it is not');
    ok(!(0, readCache_1.withinHorizon)(null, NOW), 'and an absent stamp is never within it: an unlabelled stale list is the failure this file prevents');
    ok(!(0, readCache_1.withinHorizon)('not a date', NOW), 'nor an unreadable one');
    ok((0, readCache_1.withinHorizon)(ago(2 * 3600000), NOW, 3600000) === false, 'a caller may choose a tighter horizon');
    ok((0, readCache_1.withinHorizon)(new Date(NOW + 3600000).toISOString(), NOW), 'a clock set ahead keeps the member their only copy');
}
if (errors.length) {
    console.error(`readCache: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    for (const e of errors)
        console.error(`  ✗ ${e}`);
    process.exit(1);
}
console.log('readCache: ok');
