"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// One tap, one write. Compile with tsc, run with node.
//
// The bug this guards: `<Cta label="Send Check-in" onPress={submit} wide />`
// with no guard behind it, over an async submit that awaits two network writes
// before it says anything. Two taps in that window file two check-ins into the
// coach's inbox for one week, and on app/(client)/measurements.tsx two entries
// for one morning that nobody can then see or delete.
const submitOnce_1 = require("./submitOnce");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const settle = () => new Promise((r) => { setImmediate(() => r()); });
/** A job that only settles when told, so the window between the tap and the
 *  alert can be held open the way a slow network holds it open. */
const held = () => {
    let done = () => { };
    const p = new Promise((r) => { done = r; });
    return { p, done };
};
(async () => {
    /* ── the second tap, inside the same frame ───────────────────────────── */
    {
        // The case a `useState` busy flag does NOT catch: two synchronous calls,
        // before React has re-rendered anything. This is the assertion the whole
        // file is for.
        const busyLog = [];
        const gate = (0, submitOnce_1.makeSubmitGate)({ setBusy: (b) => busyLog.push(b) });
        let ran = 0;
        const job = held();
        const first = gate.run(() => { ran += 1; return job.p; });
        const second = gate.run(() => { ran += 1; return job.p; });
        await settle();
        eq(ran, 1, 'a second tap in the same frame does not start a second write');
        ok(gate.busy(), 'the gate is shut while the first write is in flight');
        ok(gate.blocked(), 'and it knows it turned a tap away, so a screen can say so');
        job.done();
        await first;
        await second;
        eq(ran, 1, 'and the turned-away tap is DROPPED, never queued to run afterwards');
        eq(busyLog.join(','), 'true,false', 'busy went up once and came down once');
        ok(!gate.busy(), 'the gate is open again once the write settles');
    }
    /* ── the tap that comes after ────────────────────────────────────────── */
    {
        const gate = (0, submitOnce_1.makeSubmitGate)({ setBusy: () => { } });
        let ran = 0;
        await gate.run(() => { ran += 1; });
        await gate.run(() => { ran += 1; });
        eq(ran, 2, 'a member who sends, waits, and sends again really does send twice');
        ok(!gate.blocked(), 'a tap that was allowed through is not reported as blocked');
    }
    /* ── a job that throws ───────────────────────────────────────────────── */
    {
        // A gate left shut by a throw is a button that never works again, and the
        // member's only way out is to kill the app.
        const seen = [];
        const gate = (0, submitOnce_1.makeSubmitGate)({ setBusy: () => { }, onError: (e) => seen.push(e) });
        const boom = new Error('the server hung up');
        let threw = false;
        try {
            await gate.run(() => { throw boom; });
        }
        catch {
            threw = true;
        }
        ok(!threw, 'a throw does not escape into the gesture handler and take the screen down');
        eq(seen[0], boom, 'it is reported instead');
        ok(!gate.busy(), 'and the gate is open again');
        let ran = 0;
        await gate.run(() => { ran += 1; });
        eq(ran, 1, 'the button still works after a failed submit');
    }
    /* ── a job that rejects ──────────────────────────────────────────────── */
    {
        const seen = [];
        const gate = (0, submitOnce_1.makeSubmitGate)({ setBusy: () => { }, onError: (e) => seen.push(e) });
        const refused = new Error('row-level security');
        await gate.run(() => Promise.reject(refused));
        eq(seen[0], refused, 'a rejected write is reported, not swallowed silently');
        ok(!gate.busy(), 'and the gate reopens');
    }
    /* ── a synchronous job ───────────────────────────────────────────────── */
    {
        const busyLog = [];
        const gate = (0, submitOnce_1.makeSubmitGate)({ setBusy: (b) => busyLog.push(b) });
        let ran = 0;
        await gate.run(() => { ran += 1; });
        eq(ran, 1, 'a job that returns nothing still runs');
        eq(busyLog.join(','), 'true,false', 'and still raises and lowers busy');
    }
    /* ── three taps ──────────────────────────────────────────────────────── */
    {
        const gate = (0, submitOnce_1.makeSubmitGate)({ setBusy: () => { } });
        let ran = 0;
        const job = held();
        const ps = [gate.run(() => { ran += 1; return job.p; }),
            gate.run(() => { ran += 1; return job.p; }),
            gate.run(() => { ran += 1; return job.p; })];
        await settle();
        eq(ran, 1, 'a member drumming on the button still sends one check-in');
        job.done();
        await Promise.all(ps);
        eq(ran, 1, 'and still one after it lands');
    }
    /* ── the ceiling that is deliberately absent ─────────────────────────── */
    {
        // src/lib/pullRefresh.ts re-arms its gesture after twenty seconds. This
        // must NOT: a pull is idempotent and a submit is not, so a gate that
        // reopened on a timer would file the second check-in itself, with nobody
        // tapping anything. The write is guaranteed to settle by the transport
        // ceiling in src/lib/requestTimeout.ts instead.
        const gate = (0, submitOnce_1.makeSubmitGate)({ setBusy: () => { } });
        let ran = 0;
        const job = held();
        void gate.run(() => { ran += 1; return job.p; });
        await settle();
        // Simulate every timer in the world firing.
        await new Promise((r) => { setTimeout(() => r(), 5); });
        void gate.run(() => { ran += 1; return job.p; });
        await settle();
        eq(ran, 1, 'nothing reopens the gate on time alone while the write is still out there');
        job.done();
    }
    if (errors.length) {
        console.error(errors.join('\n'));
        process.exit(1);
    }
    console.log('submitOnce: ok — one tap, one write');
})();
