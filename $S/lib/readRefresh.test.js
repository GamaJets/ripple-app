"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// When a failed READ gets tried again. Compile with tsc, run with node.
//
// src/lib/offlineFlush.test.ts holds the same four registry hazards for the
// write side and they all apply here unchanged. What is additionally at stake
// in this file is the part the write side does not have — a policy about WHICH
// provider is asked and WHEN — and every one of those decisions is a way to
// make a member's phone worse rather than better:
//
//   1. RE-READING WHAT ALREADY WORKED. The point of this is recovery, not
//      refresh. A pass that asks the seven providers that are fine along with
//      the one that failed spends a member's data on a connection that has just
//      come back, and redraws seven screens that were correct.
//
//   2. RE-READING WHAT IS STILL IN FLIGHT. 'loading' means a request is out
//      there now. Starting a second one is a duplicate on the worst possible
//      connection, and on the providers that merge server rows with a device
//      queue it is a race over one list.
//
//   3. NEVER GIVING UP. An 'error' that is a row-level-security refusal is
//      permanent, and looks from here exactly like an 'error' that is a
//      basement. Without a ceiling the phone re-runs a doomed read for ever.
//
//   4. GIVING UP FOR EVER. The mirror of 3, and the worse one: a member who
//      exhausted the ceiling underground must get their attempts back the
//      moment there is signal, or the feature has made things worse than the
//      spinner it replaced.
//
//   5. READING BEFORE SENDING. A member's own logged sets are on the phone and
//      not on the server. A read that lands first shows them the server's view
//      without their work in it.
//
//   6. FIRING EVERYTHING AT ONCE. Eight cold requests into a connection that
//      has just been restored is how half of them time out, and each timeout is
//      thirty seconds (src/lib/requestTimeout.ts) before anything is on screen.
const readRefresh_1 = require("./readRefresh");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/** No reachability, no write queue, no timers. Every pass in this file is
 *  driven by injected parts so the assertions are about the policy and not
 *  about how fast node happens to be. */
const base = { canRead: () => true, flushFirst: () => undefined, pause: async () => { }, pauseMs: 0 };
const provider = (status, onRefetch) => ({
    status,
    refetch: () => { onRefetch?.(); },
});
async function run() {
    /* ── 1 + 2 · which providers are asked ───────────────────────────────── */
    {
        (0, readRefresh_1.resetRefreshers)();
        const asked = [];
        (0, readRefresh_1.registerRefresh)('failed', provider(() => 'error', () => asked.push('failed')));
        (0, readRefresh_1.registerRefresh)('working', provider(() => 'ready', () => asked.push('working')));
        (0, readRefresh_1.registerRefresh)('inflight', provider(() => 'loading', () => asked.push('inflight')));
        (0, readRefresh_1.registerRefresh)('truncated', provider(() => 'partial', () => asked.push('truncated')));
        const p = await (0, readRefresh_1.refreshStale)('reconnect', base);
        eq(asked.join(','), 'failed', 'only the provider that actually failed is read again');
        eq(p.skipped.sort().join(','), 'inflight,truncated,working', 'the other three are recorded as skipped, not silently ignored');
        eq(p.declined, false, 'and the pass itself ran');
    }
    /* ── the four statuses, stated on their own ──────────────────────────── */
    {
        eq((0, readRefresh_1.needsRefetch)('error'), true, "'error' is the only status worth asking again");
        eq((0, readRefresh_1.needsRefetch)('loading'), false, "'loading' is a read already in flight");
        eq((0, readRefresh_1.needsRefetch)('ready'), false, "'ready' worked; re-reading it is a refresh, not a recovery");
        eq((0, readRefresh_1.needsRefetch)('partial'), false, "'partial' is a truncation the same query will reproduce");
    }
    /* ── 5 · writes go before reads ──────────────────────────────────────── */
    {
        (0, readRefresh_1.resetRefreshers)();
        const order = [];
        (0, readRefresh_1.registerRefresh)('log', provider(() => 'error', () => order.push('read')));
        await (0, readRefresh_1.refreshStale)('reconnect', { ...base, flushFirst: () => { order.push('write'); } });
        eq(order.join(','), 'write,read', "the member's queued sets are sent before the read that would show a server view without them");
    }
    {
        (0, readRefresh_1.resetRefreshers)();
        let read = false;
        (0, readRefresh_1.registerRefresh)('log', provider(() => 'error', () => { read = true; }));
        await (0, readRefresh_1.refreshStale)('reconnect', { ...base, flushFirst: () => Promise.reject(new Error('still refused')) });
        eq(read, true, 'a queue that will not send does not stop a read that would');
    }
    /* ── 3 · the ceiling ─────────────────────────────────────────────────── */
    {
        (0, readRefresh_1.resetRefreshers)();
        let reads = 0;
        // A provider that is permanently refused: it never leaves 'error'.
        (0, readRefresh_1.registerRefresh)('rls', provider(() => 'error', () => { reads += 1; }));
        for (let i = 0; i < 8; i += 1)
            await (0, readRefresh_1.refreshStale)('manual', base);
        eq(reads, 8, "a person asking is never told no — 'manual' has no ceiling");
        (0, readRefresh_1.resetRefreshers)();
        reads = 0;
        (0, readRefresh_1.registerRefresh)('rls', provider(() => 'error', () => { reads += 1; }));
        // Foreground passes, spaced far enough apart that the gap is not what stops them.
        let clock = 0;
        for (let i = 0; i < 8; i += 1) {
            clock += readRefresh_1.FOREGROUND_GAP_MS * 2;
            await (0, readRefresh_1.refreshStale)('foreground', { ...base, now: () => clock });
        }
        eq(reads, readRefresh_1.MAX_ATTEMPTS, 'a read that is permanently refused stops being re-run after the ceiling');
        const last = await (0, readRefresh_1.refreshStale)('foreground', { ...base, now: () => clock + readRefresh_1.FOREGROUND_GAP_MS * 2 });
        eq(last.givenUp.join(','), 'rls', 'and the pass says which provider it has given up on rather than pretending it was fine');
    }
    /* ── 4 · and gets its attempts back on a real edge ───────────────────── */
    {
        (0, readRefresh_1.resetRefreshers)();
        let reads = 0;
        (0, readRefresh_1.registerRefresh)('basement', provider(() => 'error', () => { reads += 1; }));
        let clock = 0;
        for (let i = 0; i < 5; i += 1) {
            clock += readRefresh_1.FOREGROUND_GAP_MS * 2;
            await (0, readRefresh_1.refreshStale)('foreground', { ...base, now: () => clock });
        }
        eq(reads, readRefresh_1.MAX_ATTEMPTS, 'the ceiling held while nothing had changed');
        await (0, readRefresh_1.refreshStale)('reconnect', { ...base, now: () => clock });
        eq(reads, readRefresh_1.MAX_ATTEMPTS + 1, 'the signal coming back is new information, and buys the read its attempts again');
        eq((0, readRefresh_1.attemptsFor)('basement'), 1, 'counted from zero after the edge, not carried over');
    }
    /* ── an attempt is spent even when the refetch throws ────────────────── */
    {
        (0, readRefresh_1.resetRefreshers)();
        let reads = 0;
        (0, readRefresh_1.registerRefresh)('throws', {
            status: () => 'error',
            refetch: () => { reads += 1; throw new Error('reload blew up'); },
        });
        (0, readRefresh_1.registerRefresh)('after', provider(() => 'error'));
        let clock = 0;
        for (let i = 0; i < 6; i += 1) {
            clock += readRefresh_1.FOREGROUND_GAP_MS * 2;
            const p = await (0, readRefresh_1.refreshStale)('foreground', { ...base, now: () => clock });
            if (i === 0)
                eq(p.ran.join(','), 'throws,after', 'a refetch that throws does not stop the providers behind it');
        }
        eq(reads, readRefresh_1.MAX_ATTEMPTS, 'a refetch that throws still burns an attempt, or the ceiling only bounds the polite failures');
    }
    /* ── a provider that recovers starts counting from zero again ────────── */
    {
        (0, readRefresh_1.resetRefreshers)();
        let st = 'error';
        let reads = 0;
        (0, readRefresh_1.registerRefresh)('flaky', provider(() => st, () => { reads += 1; }));
        let clock = 0;
        const fg = async () => {
            clock += readRefresh_1.FOREGROUND_GAP_MS * 2;
            return (0, readRefresh_1.refreshStale)('foreground', { ...base, now: () => clock });
        };
        await fg();
        await fg();
        eq((0, readRefresh_1.attemptsFor)('flaky'), 2, 'two failures counted');
        st = 'ready';
        await fg();
        eq((0, readRefresh_1.attemptsFor)('flaky'), 0, 'seeing it work clears the count');
        st = 'error';
        await fg();
        await fg();
        await fg();
        eq(reads, 5, 'so the next failure gets a full ceiling of its own rather than inheriting the old one');
    }
    /* ── the foreground floor ────────────────────────────────────────────── */
    {
        eq((0, readRefresh_1.mayRunNow)('foreground', 0, readRefresh_1.FOREGROUND_GAP_MS - 1), false, 'flicking back to the app twice in a second does not re-read twice');
        eq((0, readRefresh_1.mayRunNow)('foreground', 0, readRefresh_1.FOREGROUND_GAP_MS), true, 'and does once the floor has passed');
        eq((0, readRefresh_1.mayRunNow)('reconnect', 0, 0), true, 'the reconnect edge is never rate limited — it is the one carrying news');
        eq((0, readRefresh_1.mayRunNow)('manual', 0, 0), true, 'nor is a person asking');
        eq((0, readRefresh_1.attemptsAllow)('manual', 99), true, 'a person asking is never given up on');
        eq((0, readRefresh_1.attemptsAllow)('foreground', readRefresh_1.MAX_ATTEMPTS - 1), true, 'under the ceiling');
        eq((0, readRefresh_1.attemptsAllow)('foreground', readRefresh_1.MAX_ATTEMPTS), false, 'at the ceiling');
    }
    {
        (0, readRefresh_1.resetRefreshers)();
        let reads = 0;
        (0, readRefresh_1.registerRefresh)('a', provider(() => 'error', () => { reads += 1; }));
        let clock = 1000000;
        await (0, readRefresh_1.refreshStale)('foreground', { ...base, now: () => clock });
        const second = await (0, readRefresh_1.refreshStale)('foreground', { ...base, now: () => clock + 1000 });
        eq(reads, 1, 'a second foreground a second later does not run');
        eq(second.declined, true, 'and says so rather than reporting an empty pass as a successful one');
    }
    /* ── nothing is attempted while we know we cannot reach the server ───── */
    {
        (0, readRefresh_1.resetRefreshers)();
        let reads = 0;
        (0, readRefresh_1.registerRefresh)('a', provider(() => 'error', () => { reads += 1; }));
        const p = await (0, readRefresh_1.refreshStale)('reconnect', { ...base, canRead: () => false });
        eq(reads, 0, 'under a known-offline phone every refetch would fail and cost an attempt for nothing');
        eq(p.declined, true, 'and the pass reports that it declined');
        eq((0, readRefresh_1.attemptsFor)('a'), 0, 'a pass that never ran must not spend the ceiling');
    }
    /* ── 6 · staggered, not fired all at once ────────────────────────────── */
    {
        (0, readRefresh_1.resetRefreshers)();
        const paused = [];
        for (const k of ['a', 'b', 'c'])
            (0, readRefresh_1.registerRefresh)(k, provider(() => 'error'));
        await (0, readRefresh_1.refreshStale)('reconnect', {
            ...base, pauseMs: 250, pause: async (ms) => { paused.push(ms); },
        });
        eq(paused.length, 2, 'three providers are separated by two pauses — the first goes immediately');
        eq(paused.every((m) => m === 250), true, 'and each pause is the interval asked for');
    }
    /* ── single flight, and the trigger that arrives mid-pass ────────────── */
    {
        (0, readRefresh_1.resetRefreshers)();
        let reads = 0;
        let release = () => { };
        const gate = new Promise((r) => { release = r; });
        (0, readRefresh_1.registerRefresh)('slow', {
            status: () => 'error',
            refetch: async () => { reads += 1; await gate; },
        });
        const first = (0, readRefresh_1.refreshStale)('manual', base);
        await Promise.resolve();
        const second = (0, readRefresh_1.refreshStale)('manual', base);
        eq(first === second, true, 'a trigger during a pass joins it rather than starting a second over the same providers');
        release();
        await first;
        eq(reads, 2, 'and is not dropped either: one more pass runs, because a provider may have failed after this one read its status');
    }
    /* ── registration, the four hazards the write side already states ───── */
    {
        (0, readRefresh_1.resetRefreshers)();
        eq((0, readRefresh_1.refresherCount)(), 0, 'nothing is registered to begin with');
        let which = '';
        const offFirst = (0, readRefresh_1.registerRefresh)('log', provider(() => 'error', () => { which = 'first'; }));
        (0, readRefresh_1.registerRefresh)('log', provider(() => 'error', () => { which = 'second'; }));
        eq((0, readRefresh_1.refresherCount)(), 1, 'the same key replaces rather than accumulating');
        await (0, readRefresh_1.refreshStale)('manual', base);
        eq(which, 'second', 'and it is the latest registration that runs, not the closure over the previous account');
        offFirst();
        eq((0, readRefresh_1.refresherCount)(), 1, "an unregister from the superseded effect must not delete the registration that took it over");
    }
    {
        (0, readRefresh_1.resetRefreshers)();
        let reads = 0;
        const off = (0, readRefresh_1.registerRefresh)('gone', provider(() => 'error', () => { reads += 1; }));
        off();
        await (0, readRefresh_1.refreshStale)('manual', base);
        eq(reads, 0, 'an unmounted provider is not asked to set state on a tree that is gone');
    }
    {
        // The harder half: unmounted DURING the pass. The batch is a snapshot taken
        // before the first refetch, so a screen that navigates away mid-recovery —
        // which is the ordinary thing to do when a screen has been failing — leaves
        // a dead entry in that snapshot. Calling it sets state on a tree that is
        // gone, which is a warning in dev and a leak in production.
        (0, readRefresh_1.resetRefreshers)();
        let laterRan = false;
        let offLater = () => { };
        (0, readRefresh_1.registerRefresh)('first', {
            status: () => 'error',
            refetch: () => { offLater(); },
        });
        offLater = (0, readRefresh_1.registerRefresh)('later', provider(() => 'error', () => { laterRan = true; }));
        await (0, readRefresh_1.refreshStale)('manual', base);
        eq(laterRan, false, 'a provider that unmounted while the pass was running is not called from the snapshot');
    }
    /* ── noteEdge on its own, for the sign-out path ──────────────────────── */
    {
        (0, readRefresh_1.resetRefreshers)();
        (0, readRefresh_1.registerRefresh)('a', provider(() => 'error'));
        await (0, readRefresh_1.refreshStale)('manual', base);
        eq((0, readRefresh_1.attemptsFor)('a'), 1, 'one attempt spent');
        (0, readRefresh_1.noteEdge)();
        eq((0, readRefresh_1.attemptsFor)('a'), 0, 'and clearing the counters does not need a pass to be run');
    }
    (0, readRefresh_1.resetRefreshers)();
    if (errors.length) {
        console.error(`readRefresh: ${errors.length} failure(s)`);
        for (const e of errors)
            console.error(`  · ${e}`);
        process.exit(1);
    }
    console.log('readRefresh: ok');
}
void run();
