"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// When a screen last heard from the server. Compile with tsc, run with node.
//
// Four things are held here, and the first two are the ones that put a wrong
// sentence in front of a member:
//
//   1. A FAILED READ DOES NOT MOVE THE STAMP. `src/ui/fetched.tsx` states the
//      rule and this is where it is enforced: the figures on screen still came
//      from the earlier read, and stamping the failure would say they are
//      current.
//   2. A READ IN FLIGHT DOES NOT MOVE IT EITHER. Same reason, and it is the
//      one a naive "stamp whenever the status changes" gets wrong.
//   3. A READ THAT LANDED DOES MOVE IT — including a re-read that never passed
//      through 'loading', which is why the payload identity is watched.
//   4. NOTHING ELSE ALLOCATES. `nextStamp` returns the object it was handed
//      when nothing changed, because this feeds a React setter and an
//      equal-but-new object is a re-render. That is the loop this codebase
//      spent a night finding; see src/lib/dismissedSet.ts.
const readStamp_1 = require("./readStamp");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const T0 = 1700000000000;
const rows = ['a'];
/* ── what counts as an answer ──────────────────────────────────────────── */
{
    ok((0, readStamp_1.landed)('ready'), 'the server answered');
    ok((0, readStamp_1.landed)('partial'), 'a short answer is still an answer — the rows are real');
    ok(!(0, readStamp_1.landed)('loading'), 'still in flight is not an answer');
    ok(!(0, readStamp_1.landed)('error'), 'and a refusal certainly is not');
}
/* ── the first landing ─────────────────────────────────────────────────── */
{
    const start = (0, readStamp_1.noStamp)('loading', null);
    eq(start.at, null, 'nothing read yet is null, which <Fetched> says as "Reading…" rather than as an age');
    const done = (0, readStamp_1.nextStamp)(start, 'ready', rows, T0);
    eq(done.at, T0, 'the read landing is the stamp');
}
{
    // Every provider with USE_SUPABASE off, and any read that resolves before the
    // screen mounts. Without rule 2 in nextStamp these sit at "Reading…" for ever
    // over figures that are on screen.
    const start = (0, readStamp_1.noStamp)('ready', rows);
    eq((0, readStamp_1.nextStamp)(start, 'ready', rows, T0).at, T0, 'a provider already landed on the first render is stamped, not left saying "Reading…"');
}
/* ── 1 + 2 · a failure and a retry leave it alone ──────────────────────── */
{
    let s = (0, readStamp_1.nextStamp)((0, readStamp_1.noStamp)('loading'), 'ready', rows, T0);
    s = (0, readStamp_1.nextStamp)(s, 'error', rows, T0 + 60000);
    eq(s.at, T0, 'a failed read leaves the stamp on the read the figures actually came from');
    s = (0, readStamp_1.nextStamp)(s, 'loading', rows, T0 + 90000);
    eq(s.at, T0, 'and so does the retry while it is in flight');
    s = (0, readStamp_1.nextStamp)(s, 'error', rows, T0 + 120000);
    eq(s.at, T0, 'and the retry failing again');
    s = (0, readStamp_1.nextStamp)(s, 'ready', rows, T0 + 150000);
    eq(s.at, T0 + 150000, 'only the read that lands moves it');
}
{
    // The reconnect path: src/lib/readRefresh.ts re-runs a failed read the moment
    // there is signal, with nobody touching the screen. That is exactly when the
    // difference between "a second ago" and "before you came downstairs" matters.
    let s = { at: T0, status: 'error', token: rows };
    s = (0, readStamp_1.nextStamp)(s, 'ready', rows, T0 + 3600000);
    eq(s.at, T0 + 3600000, 'a silent recovery moves the stamp, which is the whole reason the stamp is worth showing now');
}
/* ── 3 · a re-read that never said 'loading' ───────────────────────────── */
{
    const fresh = ['a', 'b'];
    let s = { at: T0, status: 'ready', token: rows };
    s = (0, readStamp_1.nextStamp)(s, 'ready', fresh, T0 + 300000);
    eq(s.at, T0 + 300000, 'a new answer under an unchanged status is still a new answer');
    ok(s.token === fresh, 'and the payload it was worked out from is carried');
}
{
    // 'ready' → 'partial' is a different claim about the same read landing.
    let s = { at: T0, status: 'ready', token: rows };
    s = (0, readStamp_1.nextStamp)(s, 'partial', rows, T0 + 10000);
    eq(s.at, T0 + 10000, 'a read that came back short still came back');
}
/* ── 4 · nothing changed, nothing allocated ────────────────────────────── */
{
    const s = { at: T0, status: 'ready', token: rows };
    eq((0, readStamp_1.nextStamp)(s, 'ready', rows, T0 + 1000), s, 'an unchanged render returns the object already held — an equal copy is a re-render');
    const failed = { at: T0, status: 'error', token: rows };
    eq((0, readStamp_1.nextStamp)(failed, 'error', rows, T0 + 1000), failed, 'and that holds for a screen sitting on a failed read, which is where it is most likely to sit');
    let held = { at: T0, status: 'ready', token: rows };
    const first = held;
    for (let i = 0; i < 50; i += 1)
        held = (0, readStamp_1.nextStamp)(held, 'ready', rows, T0 + i);
    eq(held, first, 'fifty renders with no news produce one object: fifty is React’s nested-update ceiling');
}
/* ── the Refresh control's own label ───────────────────────────────────── */
{
    ok((0, readStamp_1.stampBusy)('loading'), 'a read in flight is busy');
    ok(!(0, readStamp_1.stampBusy)('error'), 'a failed read is finished, not still trying — a button stuck on "Refreshing…" says otherwise');
    ok(!(0, readStamp_1.stampBusy)('ready'), 'nor is a landed one');
    ok(!(0, readStamp_1.stampBusy)('partial'), 'nor a short one');
}
if (errors.length) {
    console.error(`readStamp: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    for (const e of errors)
        console.error(`  ✗ ${e}`);
    process.exit(1);
}
console.log('readStamp: ok');
