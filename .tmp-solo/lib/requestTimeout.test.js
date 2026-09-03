"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// A hung request, driven against a clock that only moves when the test says so.
//
// ── Why the tests are the deliverable here ─────────────────────────────────
//
// This is the one thing in the codebase whose bug is invisible until somebody
// is standing in a basement. Nothing about a request with no timeout looks
// wrong in the source, nothing about it fails a type check, and the failure it
// produces — a screen that says "loading" for ever on a network that is
// associated but dead — cannot be reproduced at a desk. So the assertions below
// are the only place the behaviour is actually pinned, and they are written to
// fail loudly if any of the four pieces is taken back out:
//
//   1. the ceiling exists and fires;
//   2. it does NOT fire on a slow-but-real response, which is the mistake that
//      would break every user on a working connection at once;
//   3. the abort it fires is read as a TRANSPORT failure, so the app marks
//      itself unreachable — a 4xx must not, because those two sentences send a
//      person to two different places;
//   4. the timer is cleared on the way out, on every path.
//
// The clock is fake for the obvious reason — the ceiling case would otherwise
// be a thirty-second test — and for a less obvious one: a real timer makes
// "was this cancelled?" a race, and the whole point of assertion 4 is that it
// is not.
//
// Compile with tsc, run with node.
const requestTimeout_1 = require("./requestTimeout");
const pullRefresh_1 = require("./pullRefresh");
const reachability_1 = require("./reachability");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── the fakes ─────────────────────────────────────────────────────────── */
/**
 * Timers that only fire when the test advances. `live()` is the leak detector:
 * a timer that was scheduled and never cleared is still counted, so assertion 4
 * is a number rather than a hope.
 */
function fakeTimers() {
    let now = 0;
    let seq = 0;
    const armed = new Map();
    return {
        setTimer: (fn, ms) => {
            const id = ++seq;
            armed.set(id, { at: now + ms, fn });
            return id;
        },
        clearTimer: (h) => { armed.delete(h); },
        /** How many timers are still armed. Zero is the only right answer at rest. */
        live: () => armed.size,
        scheduled: () => seq,
        advance: (ms) => {
            const target = now + ms;
            for (;;) {
                let nextId = -1;
                let nextAt = Infinity;
                armed.forEach((t, id) => { if (t.at < nextAt) {
                    nextAt = t.at;
                    nextId = id;
                } });
                if (nextId < 0 || nextAt > target)
                    break;
                const t = armed.get(nextId);
                armed.delete(nextId);
                now = t.at;
                t.fn();
            }
            now = target;
        },
    };
}
/** Let every already-resolved promise run its continuations. */
const settle = async () => { for (let i = 0; i < 8; i += 1)
    await Promise.resolve(); };
/** A response that is not one of ours, so identity assertions mean something. */
const responseWith = (status) => ({ status, ok: status < 400 });
/**
 * A fetch that behaves like the real one on a dead network: it goes out, and it
 * never comes back — unless something aborts the signal, at which point it
 * rejects the way a transport does.
 */
function neverAnswers() {
    const calls = [];
    const fn = (input, init) => {
        calls.push({ input, init });
        return new Promise((_res, rej) => {
            const sig = init && init.signal;
            const bail = () => { const e = new Error('Aborted'); e.name = 'AbortError'; rej(e); };
            // Real fetch rejects straight away on a signal that is already aborted,
            // rather than waiting for an event that has already been and gone.
            if (sig && sig.aborted) {
                bail();
                return;
            }
            if (sig && typeof sig.addEventListener === 'function') {
                sig.addEventListener('abort', () => {
                    const e = new Error('Aborted');
                    e.name = 'AbortError';
                    rej(e);
                });
            }
        });
    };
    return { fn, calls, count: () => calls.length };
}
const REST = 'https://p.supabase.co/rest/v1/workouts?select=*&client_id=eq.abc';
/* ── 1 · which ceiling, and is the number defensible ───────────────────── */
{
    eq((0, requestTimeout_1.kindForUrl)(REST), 'call', 'a row read is a call');
    eq((0, requestTimeout_1.kindForUrl)('https://p.supabase.co/auth/v1/token?grant_type=refresh_token'), 'call', 'a token refresh is a call');
    eq((0, requestTimeout_1.kindForUrl)('https://p.supabase.co/functions/v1/ocr-scan'), 'transfer', 'an edge function may be a model thinking');
    eq((0, requestTimeout_1.kindForUrl)('https://p.supabase.co/storage/v1/object/exercise-videos/a/b.mp4'), 'transfer', 'an object body is bytes on the wire');
    eq((0, requestTimeout_1.kindForUrl)('https://p.supabase.co/storage/v1/object/sign/docs/a.pdf'), 'call', 'a signed-URL request is a few hundred bytes of JSON wearing a storage path');
    eq((0, requestTimeout_1.kindForUrl)('https://p.supabase.co/storage/v1/object/list/photos'), 'call', 'and so is a listing');
    eq((0, requestTimeout_1.kindForUrl)('https://world.openfoodfacts.org/api/v2/search?q=oats'), 'call', 'an unrecognised host gets the SHORTER ceiling, because unknown is not evidence of slowness');
    eq((0, requestTimeout_1.kindForUrl)('not a url at all'), 'call', 'and so does something that is not a URL');
    eq((0, requestTimeout_1.ceilingFor)(REST), requestTimeout_1.CALL_CEILING_MS, 'a call gets the call ceiling');
    eq((0, requestTimeout_1.ceilingFor)('https://p.supabase.co/functions/v1/vision-analyze'), requestTimeout_1.TRANSFER_CEILING_MS, 'a transfer gets the long one');
    // The number itself, pinned at both ends so a later edit has to argue with
    // the header rather than quietly slide it.
    ok(requestTimeout_1.CALL_CEILING_MS >= 20000, 'under twenty seconds starts cutting off honest EDGE reads, and ONE false verdict flips the whole app to offline');
    ok(requestTimeout_1.CALL_CEILING_MS <= 60000, 'over a minute the wait has stopped being information');
    ok(requestTimeout_1.CALL_CEILING_MS > pullRefresh_1.MAX_SPIN_MS, 'the spinner ceiling must fire FIRST — the gesture comes back, then the truth lands');
    ok(requestTimeout_1.TRANSFER_CEILING_MS > requestTimeout_1.CALL_CEILING_MS, 'a video is allowed longer than a row read');
    ok(requestTimeout_1.TRANSFER_CEILING_MS < 150000, "and less than Supabase's own 150s edge-function wall clock");
}
/* ── 2 · the error is the right SHAPE ──────────────────────────────────── */
{
    const e = (0, requestTimeout_1.requestTimeoutError)(REST, 'get', requestTimeout_1.CALL_CEILING_MS);
    ok((0, requestTimeout_1.isRequestTimeout)(e), 'our ceiling is recognisable as ours');
    ok(!(0, requestTimeout_1.isRequestTimeout)(new Error('Network request failed')), 'a plain transport failure is not a timeout');
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    ok(!(0, requestTimeout_1.isRequestTimeout)(abort), "and neither is somebody else's abort");
    ok(!(0, requestTimeout_1.isRequestTimeout)(null), 'nothing is not a timeout');
    // The reason this matters: reachability's own classifier discards aborts, and
    // an unlabelled timeout would be discarded with them — the app would wait
    // thirty seconds for nothing and still believe it was online.
    ok((0, reachability_1.isTransportFailure)(e), 'a timeout IS evidence of a network that did not carry the request');
    ok(!(0, reachability_1.isTransportFailure)(abort), 'while a real abort still is not');
    ok(!/abort/i.test(e.message), "the message must not say 'abort', which reachability reads as ours-and-therefore-nothing");
    ok(/timed out/i.test(e.message), 'it says what happened');
    ok(e.message.includes('/rest/v1/workouts'), 'and which endpoint, which is the diagnostic value');
    ok(!e.message.includes('client_id'), 'but not the query string: an error message ends up in a crash report');
    eq(e.ceilingMs, requestTimeout_1.CALL_CEILING_MS, 'and it records which ceiling was in force');
}
/* ── 3 · readers ───────────────────────────────────────────────────────── */
{
    eq((0, requestTimeout_1.urlOf)('https://x.test/a'), 'https://x.test/a', 'a string URL');
    eq((0, requestTimeout_1.urlOf)({ url: 'https://x.test/b', method: 'POST' }), 'https://x.test/b', 'a Request object');
    eq((0, requestTimeout_1.methodOf)(REST, { method: 'post' }), 'POST', 'the init wins and is upper-cased');
    eq((0, requestTimeout_1.methodOf)({ url: REST, method: 'DELETE' }), 'DELETE', 'a Request carries its own');
    eq((0, requestTimeout_1.methodOf)(REST), 'GET', 'and fetch defaults to GET, so we do');
}
/* ── 4 · the retry rule, pinned in BOTH directions ─────────────────────── */
{
    ok((0, requestTimeout_1.retryOnTimeout)('GET'), 'a read has no effect to duplicate, so it may go again');
    ok((0, requestTimeout_1.retryOnTimeout)('head'), 'nor has a HEAD, whatever case it arrives in');
    ok(!(0, requestTimeout_1.retryOnTimeout)('POST'), 'a POST may have committed before its reply was lost — sending it twice books the class twice');
    ok(!(0, requestTimeout_1.retryOnTimeout)('PATCH'), 'and a PATCH the same');
    ok(!(0, requestTimeout_1.retryOnTimeout)('PUT'), "PostgREST's PUT is an upsert, so HTTP's idempotence is not the app's");
    ok(!(0, requestTimeout_1.retryOnTimeout)('DELETE'), 'and offlineQueue already refuses to repeat an ambiguous destructive write');
    eq((0, requestTimeout_1.maxAttempts)('GET'), 2, 'once more, not until it works: after thirty seconds of silence TCP has already retried throughout');
    eq((0, requestTimeout_1.maxAttempts)('POST'), 1, 'a write is sent exactly once');
}
/* ── everything below needs a clock and an await ───────────────────────── */
void (async () => {
    /* ── 5 · a request that never settles is cut off AT the ceiling ─────── */
    {
        const t = fakeTimers();
        const net = neverAnswers();
        const f = (0, requestTimeout_1.withRequestTimeout)(net.fn, { setTimer: t.setTimer, clearTimer: t.clearTimer });
        let outcome = 'pending';
        void f(REST).then((r) => { outcome = r; }, (e) => { outcome = e; });
        await settle();
        eq(outcome, 'pending', 'nothing has happened yet');
        t.advance(requestTimeout_1.CALL_CEILING_MS - 1);
        await settle();
        eq(outcome, 'pending', 'and nothing happens one millisecond early — the ceiling is a ceiling, not a hint');
        t.advance(1);
        await settle();
        ok((0, requestTimeout_1.isRequestTimeout)(outcome), 'at the ceiling it fails, as a timeout');
        eq(t.live(), 0, 'and the timer is gone');
        const sig = net.calls[0].init.signal;
        ok(sig && sig.aborted === true, 'the socket is released too, not just the caller');
    }
    /* ── 6 · a slow-but-REAL response is not touched ────────────────────── */
    {
        // The mistake this guards is the expensive one. A ceiling that clips a
        // working connection does not fail one read: reachability flips the whole
        // app to 'offline' on a single verdict, so every screen changes its
        // sentences for somebody whose network is fine.
        const t = fakeTimers();
        const res = responseWith(200);
        let release = null;
        const slow = (_i, init) => new Promise((resolve) => { release = () => resolve(res); void init; });
        const f = (0, requestTimeout_1.withRequestTimeout)(slow, { setTimer: t.setTimer, clearTimer: t.clearTimer });
        let got = 'pending';
        const p = f(REST).then((r) => { got = r; }, (e) => { got = e; });
        t.advance(requestTimeout_1.CALL_CEILING_MS - 1);
        await settle();
        eq(got, 'pending', 'still in flight, and still allowed to be');
        release();
        await p;
        ok(got === res, 'a response that arrives inside the ceiling is handed back, the same object');
        eq(t.live(), 0, 'and the ceiling timer is cleared on the SUCCESS path — a leaked timer per request is its own bug');
        eq(t.scheduled(), 1, 'exactly one timer was ever armed');
    }
    /* ── 7 · a transfer gets the longer ceiling, in practice ────────────── */
    {
        const t = fakeTimers();
        const net = neverAnswers();
        const f = (0, requestTimeout_1.withRequestTimeout)(net.fn, { setTimer: t.setTimer, clearTimer: t.clearTimer });
        let out = 'pending';
        void f('https://p.supabase.co/storage/v1/object/exercise-videos/a.mp4', { method: 'POST' })
            .then((r) => { out = r; }, (e) => { out = e; });
        await settle();
        t.advance(requestTimeout_1.CALL_CEILING_MS + 1);
        await settle();
        eq(out, 'pending', 'an upload is not failed at the row-read ceiling — that would break every video away from home broadband');
        t.advance(requestTimeout_1.TRANSFER_CEILING_MS);
        await settle();
        ok((0, requestTimeout_1.isRequestTimeout)(out), 'but it does end');
    }
    /* ── 8 · the caller's own signal still works, and is not ours ───────── */
    {
        const t = fakeTimers();
        const net = neverAnswers();
        const f = (0, requestTimeout_1.withRequestTimeout)(net.fn, { setTimer: t.setTimer, clearTimer: t.clearTimer });
        const outer = new AbortController();
        let out = 'pending';
        void f(REST, { signal: outer.signal }).then((r) => { out = r; }, (e) => { out = e; });
        await settle();
        ok(net.calls[0].init.signal !== outer.signal, 'the request carries our controller');
        outer.abort();
        await settle();
        ok(out !== 'pending', "a screen unmounting still cancels its read — the caller's signal is chained, not dropped");
        ok(!(0, requestTimeout_1.isRequestTimeout)(out), 'and what it produces is NOT a timeout');
        ok(!(0, reachability_1.isTransportFailure)(out), 'so the app learns nothing about the network from somebody navigating away');
        eq(t.live(), 0, 'the ceiling timer is cleared on the abort path too');
    }
    /* ── 9 · a signal already aborted never opens a socket ──────────────── */
    {
        const t = fakeTimers();
        const net = neverAnswers();
        const f = (0, requestTimeout_1.withRequestTimeout)(net.fn, { setTimer: t.setTimer, clearTimer: t.clearTimer });
        const dead = new AbortController();
        dead.abort();
        let out = 'pending';
        void f(REST, { signal: dead.signal }).then((r) => { out = r; }, (e) => { out = e; });
        await settle();
        ok(out !== 'pending', 'a caller who has already given up is not made to wait thirty seconds');
        eq(t.live(), 0, 'and nothing is left armed');
    }
    /* ── 10 · the caller is freed even with no AbortController at all ───── */
    {
        // Belt is the controller; braces is the race. A runtime whose fetch ignores
        // the signal — or has no AbortController, which is why src/ui/reachability
        // guards for it — must still stop waiting, because waiting for ever is the
        // entire defect.
        const g = globalThis;
        const saved = g.AbortController;
        delete g.AbortController;
        try {
            const t = fakeTimers();
            const net = neverAnswers();
            const f = (0, requestTimeout_1.withRequestTimeout)(net.fn, { setTimer: t.setTimer, clearTimer: t.clearTimer });
            let out = 'pending';
            void f(REST).then((r) => { out = r; }, (e) => { out = e; });
            await settle();
            ok(net.calls[0].init === undefined, 'with no controller, the init is passed through untouched');
            t.advance(requestTimeout_1.CALL_CEILING_MS);
            await settle();
            ok((0, requestTimeout_1.isRequestTimeout)(out), 'and the caller is STILL freed at the ceiling');
            eq(t.live(), 0, 'timer cleared');
        }
        finally {
            g.AbortController = saved;
        }
    }
    /* ── 11 · what the app believes, which is the point of all of it ───── */
    const fast = { call: 1000, transfer: 4000 };
    // 11a — a hung read marks the app unreachable, and does it at the FIRST
    // ceiling rather than after the retry.
    {
        (0, reachability_1.resetReach)();
        const t = fakeTimers();
        const net = neverAnswers();
        const f = (0, reachability_1.observedFetch)(net.fn, { setTimer: t.setTimer, clearTimer: t.clearTimer, ceilings: fast });
        let out = 'pending';
        void f(REST).then((r) => { out = r; }, (e) => { out = e; });
        await settle();
        eq((0, reachability_1.currentReach)(), 'unknown', 'before the ceiling the app claims nothing, which is right');
        t.advance(fast.call);
        await settle();
        eq((0, reachability_1.currentReach)(), 'offline', 'the FIRST timeout marks the app unreachable — the banner does not wait for a retry to finish');
        eq(net.count(), 2, 'and the read goes again, because a GET has nothing to duplicate');
        eq(out, 'pending', 'while the caller is still waiting on the second attempt');
        t.advance(fast.call);
        await settle();
        ok((0, requestTimeout_1.isRequestTimeout)(out), 'which also ends');
        eq(net.count(), 2, 'once more, not until it works');
        eq((0, reachability_1.reachState)().failures, 2, 'both attempts filed their own verdict');
        eq(t.live(), 0, 'no timer survives either attempt');
        ok(/signal/.test((0, reachability_1.retryLine)((0, reachability_1.currentReach)())), 'and the sentence a person reads points at their signal, which is where the problem is');
    }
    // 11b — a write is sent exactly once, however long it hangs.
    {
        (0, reachability_1.resetReach)();
        const t = fakeTimers();
        const net = neverAnswers();
        const f = (0, reachability_1.observedFetch)(net.fn, { setTimer: t.setTimer, clearTimer: t.clearTimer, ceilings: fast });
        let out = 'pending';
        void f(REST, { method: 'POST', body: '{}' }).then((r) => { out = r; }, (e) => { out = e; });
        await settle();
        t.advance(fast.call);
        await settle();
        ok((0, requestTimeout_1.isRequestTimeout)(out), 'the write gives up at the ceiling');
        eq(net.count(), 1, 'and is NOT sent again: it may already have committed, and nothing here carries an idempotency key');
        eq((0, reachability_1.currentReach)(), 'offline', 'the app has still learnt from it');
    }
    // 11c — a refusal is not a dead network, and never has been.
    {
        (0, reachability_1.resetReach)();
        const t = fakeTimers();
        const denied = responseWith(403);
        let n = 0;
        const f = (0, reachability_1.observedFetch)(async () => { n += 1; return denied; }, { setTimer: t.setTimer, clearTimer: t.clearTimer, ceilings: fast });
        const got = await f(REST);
        ok(got === denied, 'the response comes back untouched — no caller can tell the wrapper is there');
        eq((0, reachability_1.currentReach)(), 'online', 'a 4xx is the server TALKING, so the app is reachable');
        eq(n, 1, 'and a refusal is emphatically not retried');
        ok(!/check your connection/i.test((0, reachability_1.retryLine)((0, reachability_1.currentReach)())), 'nobody is sent to their router over a policy the server applied');
        ok(/did not accept/.test((0, reachability_1.retryLine)((0, reachability_1.currentReach)())), 'they are told the server answered');
        eq(t.live(), 0, 'timer cleared on the ordinary success path, which is every request the app makes');
    }
    // 11d — a timeout and a refusal are distinguishable at every layer.
    {
        (0, reachability_1.resetReach)();
        const t = fakeTimers();
        const net = neverAnswers();
        const f = (0, reachability_1.observedFetch)(net.fn, { setTimer: t.setTimer, clearTimer: t.clearTimer, ceilings: fast });
        let timeoutErr = null;
        const p = f(REST, { method: 'POST' }).catch((e) => { timeoutErr = e; });
        await settle();
        t.advance(fast.call);
        await p;
        const offlineLine = (0, reachability_1.retryLine)((0, reachability_1.currentReach)());
        (0, reachability_1.resetReach)();
        const g = (0, reachability_1.observedFetch)(async () => responseWith(409), { setTimer: t.setTimer, clearTimer: t.clearTimer, ceilings: fast });
        await g(REST, { method: 'POST' });
        const onlineLine = (0, reachability_1.retryLine)((0, reachability_1.currentReach)());
        ok((0, requestTimeout_1.isRequestTimeout)(timeoutErr), 'layer 1 · the thrown value says which it was');
        ok((0, reachability_1.isTransportFailure)(timeoutErr), 'layer 2 · the classifier agrees it is the network');
        ok(offlineLine !== onlineLine, 'layer 3 · and the two produce different sentences');
        ok(/nothing was sent/.test(offlineLine), 'a timed-out write says nothing was sent');
        ok(!/nothing was sent/.test(onlineLine), 'a refused one must never claim that — it WAS sent, and declined');
    }
    // 11e — the retry earns its keep: a read that gets through second time.
    {
        (0, reachability_1.resetReach)();
        const t = fakeTimers();
        const good = responseWith(200);
        let n = 0;
        const flaky = (_i, init) => {
            n += 1;
            if (n === 1) {
                return new Promise((_r, rej) => {
                    const s = init && init.signal;
                    if (s && typeof s.addEventListener === 'function') {
                        s.addEventListener('abort', () => { const e = new Error('Aborted'); e.name = 'AbortError'; rej(e); });
                    }
                });
            }
            return Promise.resolve(good);
        };
        const f = (0, reachability_1.observedFetch)(flaky, { setTimer: t.setTimer, clearTimer: t.clearTimer, ceilings: fast });
        let out = 'pending';
        const p = f(REST).then((r) => { out = r; }, (e) => { out = e; });
        await settle();
        t.advance(fast.call);
        await p;
        ok(out === good, 'the second connection got through, and the caller never knew');
        eq((0, reachability_1.currentReach)(), 'online', 'and the app is back to believing the truth');
        eq(t.live(), 0, 'with nothing left armed');
    }
    // 11f — a screen that unmounts mid-read teaches the app nothing, and is not
    // chased with a second request.
    {
        (0, reachability_1.resetReach)();
        const t = fakeTimers();
        const net = neverAnswers();
        const f = (0, reachability_1.observedFetch)(net.fn, { setTimer: t.setTimer, clearTimer: t.clearTimer, ceilings: fast });
        const outer = new AbortController();
        let out = 'pending';
        const p = f(REST, { signal: outer.signal }).then((r) => { out = r; }, (e) => { out = e; });
        await settle();
        outer.abort();
        await p;
        ok(out !== 'pending', 'the read ends');
        eq((0, reachability_1.currentReach)(), 'unknown', 'and the app has learnt nothing about the network from somebody navigating');
        eq(net.count(), 1, 'a cancelled read is not retried — it was not a timeout');
        eq(t.live(), 0, 'timer cleared');
    }
    (0, reachability_1.resetReach)();
    if (errors.length) {
        console.error(`requestTimeout: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
        for (const e of errors)
            console.error(`  ✗ ${e}`);
        process.exit(1);
    }
    console.log('requestTimeout: ok');
})().catch((e) => { console.error(e); process.exit(1); });
