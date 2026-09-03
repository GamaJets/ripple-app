"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The four rules in sharedRead.ts, each asserted in the only form that can
// catch it being false. Compile with tsc, run with node.
//
// ── How the timing is held still ──────────────────────────────────────────
//
// Nothing here sleeps and nothing here races. Every read is a DEFERRED — a
// promise this file resolves by hand — so "two callers arrive while one read is
// in flight" is not a hope about scheduling, it is two calls made before
// `settle()` is invoked. The clock is injected for the same reason: the expiry
// window is asserted by moving a number, so this suite means the same thing on
// a fast machine, a loaded CI worker, and under all six zones of
// `npm run test:zones` (it constructs no Date at all).
//
// ── What is deliberately NOT asserted ─────────────────────────────────────
//
// The identity of the promise object. Two callers joining one flight is a claim
// about how many times `run` was invoked, not about whether they were handed
// the same reference — an implementation that copied the answer would be just
// as correct, and a test that pinned the reference would be testing the code
// rather than the rule.
const sharedRead_1 = require("./sharedRead");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/** A read whose landing this file decides. `runs` is how the sharing is
 *  measured: joining a flight means `run` was not invoked a second time. */
function deferrable() {
    let runs = 0;
    const settles = [];
    const run = () => {
        runs += 1;
        return new Promise((resolve) => { settles.push(resolve); });
    };
    return {
        run,
        get runs() { return runs; },
        /**
         * Land the nth request still outstanding (oldest first).
         *
         * Records a failure rather than throwing when there is no nth request. A
         * mutant that makes FEWER round trips than it should is the interesting
         * kind, and a throw here would take the suite down before the assertion
         * that says which rule it broke had a chance to be reported.
         */
        settle(o, n = 0) {
            const f = settles[n];
            if (!f) {
                errors.push(`nothing outstanding to settle at ${n} — a read that should have happened did not`);
                return;
            }
            f(o);
        },
    };
}
/** Let every already-resolved promise's continuations run. Four turns, because
 *  the implementation awaits inside an async wrapper. */
const flush = async () => { for (let i = 0; i < 4; i++)
    await Promise.resolve(); };
// ── A suite that never finishes must not pass ─────────────────────────────
//
// Everything below awaits promises this file settles by hand. A mutant that
// makes FEWER round trips than it should leaves one of them unsettled — and
// node exits 0 when the event loop empties, so an unfinished suite would be a
// silent green. Found by mutating `forget` so it no longer drops an in-flight
// read: the run printed nothing at all and exited 0.
//
// So failure is the default and success has to be reached.
process.exitCode = 1;
async function main() {
    /* ── rule: one flight, one round trip ─────────────────────────────────── */
    {
        const d = deferrable();
        const s = (0, sharedRead_1.createSharedRead)();
        const a = s.read('u1', d.run);
        const b = s.read('u1', d.run);
        const c = s.read('u1', d.run);
        eq(d.runs, 1, 'three callers arriving while one read is in flight make one round trip');
        d.settle({ ok: true, value: 'Ada' });
        const [ra, rb, rc] = await Promise.all([a, b, c]);
        eq(ra.ok && ra.value, 'Ada', 'the first caller gets the row');
        eq(rb.ok && rb.value, 'Ada', 'and so does the second');
        eq(rc.ok && rc.value, 'Ada', 'and the third — one answer, not three');
    }
    /* ── rule 1: a failure reaches EVERY caller that joined ───────────────── */
    //
    // The whole point of the shape. If a shared read swallowed the failure into
    // the first caller, the other three providers would carry on holding
    // 'loading' for ever, or worse, fall through to 'ready' over a null row.
    {
        const d = deferrable();
        const s = (0, sharedRead_1.createSharedRead)();
        const boom = { code: '42501', message: 'refused' };
        const a = s.read('u1', d.run);
        const b = s.read('u1', d.run);
        d.settle({ ok: false, error: boom });
        const [ra, rb] = await Promise.all([a, b]);
        eq(ra.ok, false, 'the caller that started the read is told it failed');
        eq(rb.ok, false, 'and so is the caller that joined it');
        eq(!ra.ok && ra.error, boom, 'with the error itself, not a flattened null row');
        eq(!rb.ok && rb.error, boom, 'the same error, so both can report it under their own name');
    }
    /* ── and a THROW is a failure, not a rejection ────────────────────────── */
    //
    // A fetch that throws used to be four unhandled rejections, one per provider.
    {
        const s = (0, sharedRead_1.createSharedRead)();
        const thrown = new Error('no network');
        const a = s.read('u1', async () => { throw thrown; });
        const b = s.read('u1', async () => { throw thrown; });
        const [ra, rb] = await Promise.all([a, b]);
        eq(ra.ok, false, 'a throw out of the read is an outcome');
        eq(!ra.ok && ra.error, thrown, 'carrying what was thrown');
        eq(!rb.ok && rb.error, thrown, 'and the joined caller gets it through the same branch');
    }
    /* ── rule 2: a failure is never held ──────────────────────────────────── */
    //
    // clientData.tsx retries a failed profile read three times, two seconds
    // apart, because arming its push effect over a failed read overwrites the
    // server's copy with defaults. A cached refusal would make all three attempts
    // one attempt and that retry a lie.
    {
        const t = 1000;
        const d = deferrable();
        const s = (0, sharedRead_1.createSharedRead)({ now: () => t });
        const a = s.read('u1', d.run);
        d.settle({ ok: false, error: 'first' });
        const ra = await a;
        eq(ra.ok, false, 'the first attempt failed');
        await flush();
        const b = s.read('u1', d.run);
        eq(d.runs, 2, 'the retry immediately afterwards is a REAL second round trip');
        d.settle({ ok: true, value: 'Ada' }, 1);
        const rb = await b;
        eq(rb.ok && rb.value, 'Ada', 'and it gets the answer the first attempt could not');
    }
    /* ── rule 3: a held answer expires ────────────────────────────────────── */
    {
        let t = 1000;
        const d = deferrable();
        const s = (0, sharedRead_1.createSharedRead)({ freshMs: 5000, now: () => t });
        const a = s.read('u1', d.run);
        d.settle({ ok: true, value: 'Ada' });
        await a;
        await flush();
        t = 1000 + 4999;
        const b = await s.read('u1', d.run);
        eq(d.runs, 1, 'a provider mounting a moment later is served the answer already read');
        eq(b.ok && b.value, 'Ada', 'and it is the same answer, which is the point');
        t = 1000 + 5000;
        const c = s.read('u1', d.run);
        eq(d.runs, 2, 'at the window it is stale and read again — this is not a cache');
        d.settle({ ok: true, value: 'Grace' }, 1);
        const rc = await c;
        eq(rc.ok && rc.value, 'Grace', 'and the newer answer wins');
    }
    /* ── a window of zero shares only what genuinely overlaps ─────────────── */
    {
        let t = 0;
        const d = deferrable();
        const s = (0, sharedRead_1.createSharedRead)({ freshMs: 0, now: () => t });
        const a = s.read('u1', d.run);
        const b = s.read('u1', d.run);
        eq(d.runs, 1, 'with no window at all, two overlapping callers still make one round trip');
        d.settle({ ok: true, value: 'Ada' });
        await Promise.all([a, b]);
        await flush();
        void s.read('u1', d.run);
        eq(d.runs, 2, 'and nothing is held afterwards');
    }
    /* ── rule 4: forget drops a read already in flight ────────────────────── */
    //
    // The sequence this is about: four providers read the row; the member edits
    // their name; the write lands; something re-reads. A request that left BEFORE
    // the write is about to answer with the old name, and holding that would put
    // the old name back on three screens.
    {
        const t = 1000;
        const d = deferrable();
        const s = (0, sharedRead_1.createSharedRead)({ freshMs: 60000, now: () => t });
        const a = s.read('u1', d.run); // left before the write
        s.forget('u1'); // the write lands
        const b = s.read('u1', d.run); // asked after it
        eq(d.runs, 2, 'a caller arriving after the write does NOT join the read that predates it');
        // The post-write read lands FIRST and the overtaken one straggles in after
        // it. That order is the whole point: the other way round, a hold that
        // wrongly accepted the stale answer would be papered over a moment later by
        // the fresh one and nothing would be visible. A slow request that left
        // before a write and arrives after it is an ordinary thing on a phone.
        d.settle({ ok: true, value: 'new name' }, 1);
        const rb = await b;
        eq(rb.ok && rb.value, 'new name', 'the read asked after the write gets the new row');
        await flush();
        d.settle({ ok: true, value: 'old name' }, 0);
        const ra = await a;
        eq(ra.ok && ra.value, 'old name', 'the caller that was already awaiting still gets its answer — a successful write must not become a failed read');
        await flush();
        const c = await s.read('u1', d.run);
        eq(d.runs, 2, 'and nothing needed re-reading');
        eq(c.ok && c.value, 'new name', 'the straggler was DISCARDED rather than held — otherwise the old name goes back on every screen');
    }
    /* ── forget with no key drops everything ──────────────────────────────── */
    {
        const t = 1000;
        const d1 = deferrable();
        const d2 = deferrable();
        const s = (0, sharedRead_1.createSharedRead)({ freshMs: 60000, now: () => t });
        const a = s.read('u1', d1.run);
        d1.settle({ ok: true, value: 'Ada' });
        await a;
        const b = s.read('u2', d2.run);
        d2.settle({ ok: true, value: 'Grace' });
        await b;
        await flush();
        s.forget();
        void s.read('u1', d1.run);
        void s.read('u2', d2.run);
        eq(d1.runs, 2, 'signing out drops the first key');
        eq(d2.runs, 2, 'and the second');
    }
    /* ── two people, one handset: keys never share ────────────────────────── */
    //
    // A shared phone in a gym. The bug this forecloses is the one the whole
    // change is about, aimed at the wrong person: one member's name served to
    // another member's providers.
    {
        const t = 1000;
        const d = deferrable();
        const s = (0, sharedRead_1.createSharedRead)({ freshMs: 60000, now: () => t });
        const a = s.read('member-a', d.run);
        d.settle({ ok: true, value: 'Ada' });
        const ra = await a;
        eq(ra.ok && ra.value, 'Ada', 'the first member reads their own row');
        await flush();
        const b = s.read('member-b', d.run);
        eq(d.runs, 2, 'the second member on the same handset gets their OWN read, never the held one');
        d.settle({ ok: true, value: 'Grace' }, 1);
        const rb = await b;
        eq(rb.ok && rb.value, 'Grace', 'and their own answer');
    }
    /* ── a null row is a real answer and is held like any other ───────────── */
    //
    // A coach has no `clients` row. That is permanent, normal, and NOT a failure
    // — if null were treated as "nothing to hold", every coach would re-read a
    // row that does not exist on every provider, for ever.
    {
        const t = 1000;
        const d = deferrable();
        const s = (0, sharedRead_1.createSharedRead)({ freshMs: 60000, now: () => t });
        const a = s.read('coach', d.run);
        d.settle({ ok: true, value: null });
        const ra = await a;
        eq(ra.ok, true, 'no row is a successful read');
        await flush();
        const b = await s.read('coach', d.run);
        eq(d.runs, 1, 'and it is held, so the absence is not re-read by every provider in turn');
        eq(b.ok && b.value, null, 'null out, exactly as null in');
    }
    /* ── the shipped window ───────────────────────────────────────────────── */
    //
    // Stated as an assertion because the argument for the number is the whole
    // defence of the shape: it covers providers mounting in the same second of a
    // cold launch and nothing else. A window of minutes would be a cache holding
    // somebody's old name.
    ok(sharedRead_1.SAME_LAUNCH_MS > 0 && sharedRead_1.SAME_LAUNCH_MS <= 10000, `the shipped window is a launch fan-out and not a cache — got ${sharedRead_1.SAME_LAUNCH_MS}ms`);
}
main().then(() => {
    if (errors.length) {
        console.error(`sharedRead.test: ${errors.length} failure(s)`);
        for (const e of errors)
            console.error(`  · ${e}`);
        process.exit(1);
    }
    console.log('sharedRead.test: ok');
    process.exitCode = 0;
}, (e) => {
    console.error('sharedRead.test: threw', e);
    process.exit(1);
});
// And a hang says so rather than sitting there. Unref'd where the runtime
// offers it — under node it does, and the cast is because this file is compiled
// by BOTH tsconfigs and React Native's `setTimeout` is typed as returning a
// number. Belt and braces over the line above: that one already turns an
// unfinished run into an exit 1 the moment the event loop empties, which is how
// this class of mutant actually shows up.
