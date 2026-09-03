"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// When a queued write actually gets sent. Compile with tsc, run with node.
//
// The registry in src/lib/offlineQueue.ts is four lines of state and every one
// of them is a way to lose or duplicate somebody's session:
//
//   1. TWO FLUSHES AT ONCE. Coming back to the foreground and the first
//      successful request usually happen within the same second, and both fire
//      a flush. Two concurrent passes over one queue is how a workout that was
//      logged once ends up on the server twice, a day apart, with no way to
//      tell which row is real.
//
//   2. A TRIGGER SWALLOWED BY THE ONE IN FLIGHT. The opposite failure. A
//      reconnect that arrives while a pass is halfway through must not be
//      dropped — the provider it would have helped may already have read its
//      queue and moved on.
//
//   3. ONE PROVIDER TAKING THE REST DOWN. A flusher that throws must not stop
//      the queues after it in the list from being sent.
//
//   4. A STALE REGISTRATION SENDING THE WRONG ACCOUNT'S QUEUE. Providers
//      register from an effect that re-runs on every auth revision. Registering
//      by key has to REPLACE, and an unregister from a later unmount must not
//      delete a registration that has already been taken over.
const offlineQueue_1 = require("./offlineQueue");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const tick = () => new Promise((r) => setTimeout(r, 0));
async function run() {
    /* ── 4 · registration ────────────────────────────────────────────────── */
    {
        (0, offlineQueue_1.resetFlushers)();
        eq((0, offlineQueue_1.flusherCount)(), 0, 'nothing is registered to begin with');
        let which = '';
        const offFirst = (0, offlineQueue_1.registerFlush)('workouts', () => { which = 'first'; });
        (0, offlineQueue_1.registerFlush)('workouts', () => { which = 'second'; });
        eq((0, offlineQueue_1.flusherCount)(), 1, 'the same key replaces rather than accumulating');
        await (0, offlineQueue_1.flushAll)();
        eq(which, 'second', 'and it is the latest registration that runs, not the closure over the previous account');
        offFirst();
        eq((0, offlineQueue_1.flusherCount)(), 1, 'an unregister from the superseded effect must not delete the live one');
    }
    /* ── 3 · one bad provider ────────────────────────────────────────────── */
    {
        (0, offlineQueue_1.resetFlushers)();
        const ran = [];
        (0, offlineQueue_1.registerFlush)('a', () => { ran.push('a'); throw new Error('no signal'); });
        (0, offlineQueue_1.registerFlush)('b', async () => { ran.push('b'); return Promise.reject(new Error('refused')); });
        (0, offlineQueue_1.registerFlush)('c', () => { ran.push('c'); });
        const n = await (0, offlineQueue_1.flushAll)();
        eq(ran.join(','), 'a,b,c', 'a throwing flusher does not stop the queues behind it');
        eq(n, 3, 'and all three are reported as run');
    }
    /* ── 1 + 2 · single flight ───────────────────────────────────────────── */
    {
        (0, offlineQueue_1.resetFlushers)();
        let passes = 0;
        let release = () => { };
        (0, offlineQueue_1.registerFlush)('slow', () => {
            passes += 1;
            return new Promise((res) => { release = res; });
        });
        const first = (0, offlineQueue_1.flushAll)();
        await tick();
        ok((0, offlineQueue_1.isFlushing)(), 'a pass is in flight');
        eq(passes, 1, 'and it has started the provider once');
        // The foreground trigger arriving on top of the reconnect trigger.
        const second = (0, offlineQueue_1.flushAll)();
        ok(first === second, 'a second call while one is in flight does not start a second pass');
        eq(passes, 1, 'and specifically does not call the provider again concurrently');
        release();
        await tick();
        await tick();
        eq(passes, 2, 'but it is not dropped either: one more pass runs once the first finishes');
        release();
        await first;
        await tick();
        ok(!(0, offlineQueue_1.isFlushing)(), 'and then it settles');
        // Three calls stacked on one in-flight pass still produce exactly one
        // follow-up, not three.
        (0, offlineQueue_1.resetFlushers)();
        passes = 0;
        (0, offlineQueue_1.registerFlush)('slow', () => { passes += 1; return new Promise((res) => { release = res; }); });
        const p = (0, offlineQueue_1.flushAll)();
        await tick();
        (0, offlineQueue_1.flushAll)();
        (0, offlineQueue_1.flushAll)();
        (0, offlineQueue_1.flushAll)();
        release();
        await tick();
        await tick();
        release();
        await p;
        await tick();
        eq(passes, 2, 'three overlapping triggers collapse to one follow-up pass, not three');
    }
    /* ── a flush with nothing registered is not an error ─────────────────── */
    {
        (0, offlineQueue_1.resetFlushers)();
        eq(await (0, offlineQueue_1.flushAll)(), 0, 'an app with no queues flushes nothing and says so');
    }
    (0, offlineQueue_1.resetFlushers)();
    if (errors.length) {
        console.error(`offlineFlush: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
        for (const e of errors)
            console.error(`  ✗ ${e}`);
        process.exit(1);
    }
    console.log('offlineFlush: ok');
}
void run().catch((e) => { console.error(e); process.exit(1); });
