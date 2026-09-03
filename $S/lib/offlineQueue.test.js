"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The queue's two decisions. Compile with tsc, run with node.
//
// Three bugs are guarded here, and none of them is arithmetic.
//
// The first is the one src/ui/loadStatus.ts exists for, arriving through the
// merge rather than through the status: `serverRows` must hand back null for a
// FAILED read and [] for an EMPTY one. Collapse them and `mergeLog` treats the
// server's silence as authority, and a client who logged three meals in a
// basement gym loses them the moment the next read fails. The mutation check at
// the bottom of this file proves the assertion is actually watching that line
// rather than sitting beside it.
//
// The second is retrying a row the server has already refused. A CHECK
// constraint or an RLS policy will say the same thing to the same bytes every
// time, so a refusal that gets queued is a row that is never sent, never
// dropped, and counted in front of the client as "1 waiting" for the life of
// the install. The food log shipped exactly this: every AI-described meal was
// refused by `food_logs_via_check`, indistinguishably from being offline.
//
// The third is a write that PostgREST narrowed to zero rows. It does not fail.
// `error` is null, nothing was written, and a caller that checks only `error`
// files it as stored.
const offlineQueue_1 = require("./offlineQueue");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const LOCAL = 'local:';
const isUnsent = (id) => id.startsWith(LOCAL);
/* ── serverRows: a failed read is not an empty one ──────────────────────── */
{
    // The read failed. Nothing was learnt. null, so the merge keeps every local
    // row — including ones carrying server ids, which are not disproved by a
    // question nobody answered.
    eq((0, offlineQueue_1.serverRows)({ message: 'Network request failed' }, null), null, 'a failed read learns nothing');
    eq((0, offlineQueue_1.serverRows)({ code: '42501' }, null), null, 'a refused read learns nothing either');
    // The trap: an error AND rows. supabase-js can hand back a partial body with
    // an error set, and `data ?? []` would take it.
    eq((0, offlineQueue_1.serverRows)({ code: '42501' }, [{ id: 'a' }]), null, 'rows alongside an error are not an answer');
}
{
    // The read succeeded and the server holds nothing. That IS an answer, and the
    // merge is entitled to act on it.
    const r = (0, offlineQueue_1.serverRows)(null, []);
    ok(r !== null, 'an empty answer is still an answer');
    eq(r?.length, 0, 'and it is empty');
}
{
    // Undefined rows with no error: PostgREST returning a null body for a query
    // that matched nothing. Same meaning as [].
    const r = (0, offlineQueue_1.serverRows)(null, undefined);
    ok(r !== null, 'a null body with no error is an empty answer, not a failed one');
    eq(r?.length, 0, 'holding no rows');
    eq((0, offlineQueue_1.serverRows)(undefined, [{ id: 'a' }])?.length, 1, 'rows come through when nothing went wrong');
}
/* ── classifyWrite: refused, unsent, stored ─────────────────────────────── */
{
    // Stored. The row came back, so something wrote it.
    eq((0, offlineQueue_1.classifyWrite)(null, 1), 'stored', 'a row back with no error is stored');
    eq((0, offlineQueue_1.classifyWrite)(undefined, 3), 'stored', 'three rows back likewise');
}
{
    // The zero-row write. This is the one that looks like success.
    eq((0, offlineQueue_1.classifyWrite)(null, 0), 'refused', 'a write that returned no rows wrote nothing');
    ok((0, offlineQueue_1.classifyWrite)(null, 0) !== 'stored', 'and must never be filed as stored');
    // Not queued either: offering the same row to the same policy again gets the
    // same nothing.
    ok((0, offlineQueue_1.classifyWrite)(null, 0) !== 'unsent', 'nor queued forever against a policy that will not budge');
}
{
    // Offline. No code, no status — a fetch that never completed.
    const off = { message: 'TypeError: Network request failed' };
    eq((0, offlineQueue_1.classifyWrite)(off, null), 'unsent', 'a transport failure is unsent, and is kept');
    eq((0, offlineQueue_1.classifyWrite)({ message: 'Failed to fetch' }, null), 'unsent', 'whatever the runtime calls it');
    // A throw the caller caught, with nothing to show for it.
    eq((0, offlineQueue_1.classifyWrite)(null, null), 'unsent', 'no answer at all is unsent');
}
{
    // The database answered and said no. These are refusals and are dropped.
    eq((0, offlineQueue_1.classifyWrite)({ code: '42501' }, null), 'refused', 'RLS refused the row');
    eq((0, offlineQueue_1.classifyWrite)({ code: '23514' }, null), 'refused', 'a CHECK constraint refused it');
    eq((0, offlineQueue_1.classifyWrite)({ code: '23505' }, null), 'refused', 'a unique index refused it');
    eq((0, offlineQueue_1.classifyWrite)({ code: '23503' }, null), 'refused', 'a foreign key refused it');
    eq((0, offlineQueue_1.classifyWrite)({ code: 'PGRST116' }, null), 'refused', "PostgREST's own answer about the row counts too");
}
{
    // The database exists and is not currently able to take the row. Kept.
    eq((0, offlineQueue_1.classifyWrite)({ code: '08006' }, null), 'unsent', 'a connection failure is not a refusal of the row');
    eq((0, offlineQueue_1.classifyWrite)({ code: '57014' }, null), 'unsent', 'nor is a statement timeout');
    eq((0, offlineQueue_1.classifyWrite)({ code: '57P01' }, null), 'unsent', 'nor an admin shutdown');
    // An expired token refuses this attempt and nothing about the row. The next
    // launch signs in again, which is exactly what an unsent row waits for.
    eq((0, offlineQueue_1.classifyWrite)({ code: 'PGRST301' }, null), 'unsent', 'an expired JWT is answered by the next launch, not by dropping the row');
}
{
    // Statuses, where supabase-js gives one instead of a SQLSTATE.
    eq((0, offlineQueue_1.classifyWrite)({ status: 403 }, null), 'refused', '403 is the server declining the row');
    eq((0, offlineQueue_1.classifyWrite)({ status: 400 }, null), 'refused', 'so is 400');
    eq((0, offlineQueue_1.classifyWrite)({ status: 409 }, null), 'refused', 'so is a conflict');
    eq((0, offlineQueue_1.classifyWrite)({ status: 429 }, null), 'unsent', 'a rate limit is the server saying later, which is what this queue is for');
    eq((0, offlineQueue_1.classifyWrite)({ status: 408 }, null), 'unsent', 'a timeout may even have written the row; it is not thrown away');
    eq((0, offlineQueue_1.classifyWrite)({ status: 425 }, null), 'unsent', 'nor is "too early" a verdict on the row');
    eq((0, offlineQueue_1.classifyWrite)({ status: 504 }, null), 'unsent', 'a gateway timeout is the gateway, not the row');
    // React Native's XHR reports a dead connection as status 0 rather than as a
    // thrown fetch, so this is the shape a basement gym actually produces on some
    // devices. Every one of these writes would be discarded if a status below 400
    // counted as a refusal.
    eq((0, offlineQueue_1.classifyWrite)({ status: 0 }, null), 'unsent', 'status 0 is no connection, which is exactly what this queue is for');
    eq((0, offlineQueue_1.classifyWrite)({ status: 204 }, null), 'unsent', 'nothing under 400 is the server declining the row');
    eq((0, offlineQueue_1.classifyWrite)({ status: 500 }, null), 'unsent', 'a server fault says nothing about the row');
    eq((0, offlineQueue_1.classifyWrite)({ status: 503 }, null), 'unsent', 'nor does a gateway with its hands full');
    // A status wins over a code, because it is the outer, more recent fact.
    eq((0, offlineQueue_1.classifyWrite)({ status: 503, code: '42501' }, null), 'unsent', 'a 5xx wrapping a stale code is still a 5xx');
}
{
    // An error shape nobody anticipated. The safe side keeps the client's work.
    eq((0, offlineQueue_1.classifyWrite)({ code: 'wat' }, null), 'unsent', 'an unrecognised code is not evidence of a refusal');
    eq((0, offlineQueue_1.classifyWrite)({ code: '' }, null), 'unsent', 'and neither is an empty one');
}
/* ── days: local, and yesterday is not today ────────────────────────────── */
{
    // Built from local getters, so this holds in every zone the suite runs in
    // (test:zones runs it in three, two of them either side of UTC).
    const noon = new Date(2026, 7, 31, 12, 0, 0);
    const late = new Date(2026, 7, 31, 23, 30, 0);
    const early = new Date(2026, 7, 31, 0, 15, 0);
    eq((0, offlineQueue_1.dayOf)(noon.toISOString(), noon), '2026-08-31', 'midday is its own day');
    eq((0, offlineQueue_1.dayOf)(late.toISOString(), late), '2026-08-31', 'and so is half past eleven at night');
    eq((0, offlineQueue_1.dayOf)(early.toISOString(), early), '2026-08-31', 'and quarter past midnight');
    eq((0, offlineQueue_1.todayKey)(noon), '2026-08-31', 'today is the day it is');
    // An unreadable timestamp falls back to now rather than to NaN, which would
    // render "NaN-NaN-NaN" and match no day at all.
    eq((0, offlineQueue_1.dayOf)('not a date', noon), '2026-08-31', 'an unreadable stamp does not become NaN');
}
{
    const t = new Date(2026, 7, 31, 10, 0, 0);
    const yest = new Date(2026, 7, 30, 21, 0, 0);
    const entries = [
        { id: 'local:1', at: yest.toISOString() }, // logged offline last night
        { id: 'local:2', at: t.toISOString() }, // logged offline this morning
        { id: 'uuid-a', at: t.toISOString() }, // on the server, today
        { id: 'uuid-b', at: yest.toISOString() }, // on the server, yesterday
    ];
    const today = (0, offlineQueue_1.todayKey)(t);
    const mine = (0, offlineQueue_1.forDay)(entries, today, t);
    eq(mine.length, 2, "today's list holds only today's rows");
    ok(mine.every((e) => e.id === 'local:2' || e.id === 'uuid-a'), 'and they are the right two');
    ok(!mine.some((e) => e.id === 'local:1'), "last night's unsent meal does not eat today's calories");
    const owed = (0, offlineQueue_1.staleForDay)(entries, today, isUnsent, t);
    eq(owed.length, 1, 'but it is still owed to the server');
    eq(owed[0]?.id, 'local:1', 'and it is the unsent one');
    ok(!owed.some((e) => e.id === 'uuid-b'), "yesterday's stored row is not owed to anybody");
}
/* ── counting, and what is said about the count ─────────────────────────── */
{
    eq((0, offlineQueue_1.unsentCount)(['local:1', 'uuid-a', 'local:2'], isUnsent), 2, 'two of the three are waiting');
    eq((0, offlineQueue_1.unsentCount)(['uuid-a', 'uuid-b'], isUnsent), 0, 'nothing waiting is zero');
    eq((0, offlineQueue_1.unsentCount)([], isUnsent), 0, 'an empty list owes nothing');
    eq((0, offlineQueue_1.unsentNote)(0, 'meal'), null, 'nothing to say when nothing is waiting');
    eq((0, offlineQueue_1.unsentNote)(-1, 'meal'), null, 'and a negative count is not a sentence either');
    ok(((0, offlineQueue_1.unsentNote)(1, 'meal') ?? '').startsWith('1 meal '), 'one is singular');
    ok(((0, offlineQueue_1.unsentNote)(3, 'meal') ?? '').includes('3 meals '), 'three is plural');
    ok(((0, offlineQueue_1.unsentNote)(2, 'check-in', 'check-ins') ?? '').includes('2 check-ins'), 'an irregular plural is given, not guessed');
    // The sentence has one job beyond being grammatical: it must not let anybody
    // believe the thing has been delivered.
    const note = (0, offlineQueue_1.unsentNote)(1, 'check-in', 'check-ins') ?? '';
    ok(!/\bsent\b(?!\s+yet)/.test(note), 'the note never says the row was sent');
    ok(note.includes('not sent yet'), 'it says the opposite, in those words');
}
/* ── the mutation check ─────────────────────────────────────────────────── */
//
// `serverRows` is one line and the whole offline story rests on it, so the
// assertions above are re-run here against a deliberately broken copy — the
// exact wrong version, `data ?? []`, that scripts/check-reads.mjs exists to
// catch. If the broken copy passes what the real one passed, then those
// assertions are not watching this behaviour and every green run above means
// nothing.
{
    const broken = (_error, rows) => rows ?? [];
    const failedRead = broken({ message: 'Network request failed' }, null);
    ok(failedRead !== null, 'the broken copy is broken in the way described (it answers a failed read)');
    // Compared on NULLNESS, not on identity. `!==` between two arrays is true for
    // two empty ones as well, so an identity comparison here would pass under the
    // very mutation it claims to catch — which is the failure mode this whole
    // block was written to rule out, reintroduced inside it.
    const isFailure = (r) => r === null;
    ok(isFailure((0, offlineQueue_1.serverRows)({ message: 'Network request failed' }, null)) !== isFailure(failedRead), 'a failed read and an empty read are distinguishable — if this ever holds for both, the assertions above are asleep');
    // And the reverse mutation: collapsing an empty answer to a failure would
    // leave stale local rows on screen forever, so that direction is checked too.
    const alsoBroken = (_error, _rows) => null;
    ok(isFailure((0, offlineQueue_1.serverRows)(null, [])) !== isFailure(alsoBroken(null, [])), 'an empty answer is not folded into a failure either');
}
/* ── the day a screen is still judged against hours later ───────────────── */
//
// The defect: `useMemo(() => todayKey(), [])` freezes the day at MOUNT, and a
// phone screen is not remounted by being backgrounded. Insurance that expired
// on Monday read as current on Thursday.
{
    const noon = new Date(2026, 7, 31, 12, 0, 0);
    eq((0, offlineQueue_1.msUntilNextLocalDay)(noon), 12 * 60 * 60 * 1000, 'midday is twelve hours from the roll-over');
    const nearly = new Date(2026, 7, 31, 23, 59, 59, 0);
    eq((0, offlineQueue_1.msUntilNextLocalDay)(nearly), 1000, 'a second to go is a second');
    const justAfter = new Date(2026, 7, 31, 0, 0, 0, 0);
    eq((0, offlineQueue_1.msUntilNextLocalDay)(justAfter), 24 * 60 * 60 * 1000, 'and midnight itself is a whole day from the next');
    // Whatever the zone and whatever the date, waiting exactly this long lands on
    // a DIFFERENT day, and never on a timer that fires instantly.
    for (const at of [
        new Date(2026, 0, 1, 0, 0, 0, 1), new Date(2026, 2, 29, 1, 30, 0),
        new Date(2026, 9, 25, 1, 30, 0), new Date(2026, 11, 31, 23, 0, 0),
        new Date(2027, 1, 28, 12, 0, 0),
    ]) {
        const ms = (0, offlineQueue_1.msUntilNextLocalDay)(at);
        ok(ms > 0, `the wait is never zero or negative at ${at.toISOString()}`);
        ok(ms <= 25 * 60 * 60 * 1000, `and never more than a long day at ${at.toISOString()}`);
        const then = new Date(at.getTime() + ms);
        ok((0, offlineQueue_1.todayKey)(then) !== (0, offlineQueue_1.todayKey)(at), `waiting it out changes the day at ${at.toISOString()}`);
    }
}
if (errors.length) {
    console.error(`offlineQueue: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    for (const e of errors)
        console.error(`  ✗ ${e}`);
    process.exit(1);
}
console.log('offlineQueue: ok');
